-- 2026-10-09, fixes and additions found in testing:
-- 1. Meetup places can now be picked from a map search. The place keeps
--    its name, street address and map position, so the plan card and the
--    calendar invite can open it in Google Maps or Apple Maps.
-- 2. Changing only "what you'll do" no longer counts as moving the plan
--    (it used to ask the other person to confirm again and showed "Moved
--    once" with the same date, time and place).
-- 3. Each person's meeting pace ("how often would you like to get
--    together?") can be shown in the chat. Your own answer is shown to you;
--    when both of you picked the same pace, both of you see that you agree.
--    A different answer is never shown to the other person.
-- 4. Someone you already had a chat with can always be viewed (unless
--    either of you blocked the other), so "Visit their profile to say hello
--    again" works even when they no longer match your search filters.
-- 5. A version check, so the Test tab can say when a database update
--    hasn't been run yet.

-- ------------------------------------------------------------------
-- 1. Place details
-- ------------------------------------------------------------------
alter table public.meetups add column if not exists place_address text;
alter table public.meetups add column if not exists place_lat double precision;
alter table public.meetups add column if not exists place_lng double precision;
alter table public.meetups drop constraint if exists meetups_place_address_length;
alter table public.meetups add constraint meetups_place_address_length
  check (place_address is null or char_length(place_address) <= 200);

drop function if exists public.propose_meetup(uuid, date, time, text, text, text);

create or replace function public.propose_meetup(
  p_connection_id uuid,
  p_date date,
  p_start_time time default null,
  p_place text default null,
  p_activity text default null,
  p_time_zone text default null,
  p_place_address text default null,
  p_place_lat double precision default null,
  p_place_lng double precision default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid := auth.uid();
  v_existing public.meetups%rowtype;
  v_has_existing boolean;
  v_prompted boolean;
  v_new_id uuid;
  v_tz text;
  v_place text := nullif(btrim(coalesce(p_place, '')), '');
  v_activity text := nullif(btrim(coalesce(p_activity, '')), '');
  v_address text := nullif(btrim(coalesce(p_place_address, '')), '');
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if not exists (
    select 1 from public.connections c
    where c.id = p_connection_id and (c.user_a_id = v_caller or c.user_b_id = v_caller)
  ) then
    raise exception 'Not a participant of this connection';
  end if;

  v_tz := case when exists (select 1 from pg_timezone_names where name = p_time_zone) then p_time_zone else null end;
  if p_date < (now() at time zone public.meetup_tz(v_tz))::date then
    raise exception 'Pick a date that is today or later';
  end if;

  -- The plan this one replaces. A confirmed plan whose day has passed is
  -- not replaced: it is waiting for "Did you meet?" and stays as it is.
  select * into v_existing from public.meetups
  where connection_id = p_connection_id
    and (status = 'proposed'
         or (status = 'confirmed' and confirmed_date >= (now() at time zone public.meetup_tz(time_zone))::date))
  order by created_at desc, id desc limit 1;
  v_has_existing := found;

  select exists (
    select 1 from public.connection_interventions
    where connection_id = p_connection_id and target_user_id = v_caller and status = 'pending'
  ) into v_prompted;

  insert into public.meetups (
    connection_id, proposed_date, proposed_by, prompted_by_limen,
    start_time, place, activity, time_zone, move_count, plan_root_id,
    place_address, place_lat, place_lng
  )
  values (
    p_connection_id, p_date, v_caller, v_prompted,
    p_start_time, v_place, v_activity, coalesce(v_tz, case when v_has_existing then v_existing.time_zone end),
    case when v_has_existing
      then v_existing.move_count + (case when v_existing.status = 'confirmed' then 1 else 0 end)
      else 0 end,
    case when v_has_existing then coalesce(v_existing.plan_root_id, v_existing.id) else null end,
    case when v_place is null then null else v_address end,
    case when v_place is null then null else p_place_lat end,
    case when v_place is null then null else p_place_lng end
  )
  returning id into v_new_id;

  if not v_has_existing then
    update public.meetups set plan_root_id = v_new_id where id = v_new_id;
  end if;

  if v_has_existing then
    update public.meetups set status = 'rescheduled', superseded_by = v_new_id where id = v_existing.id;
    perform public.record_friendship_event(p_connection_id, 'meetup_rescheduled', v_caller,
      jsonb_build_object('old_meetup_id', v_existing.id, 'new_meetup_id', v_new_id, 'date', p_date));
  else
    perform public.record_friendship_event(p_connection_id, 'meetup_proposed', v_caller,
      jsonb_build_object('meetup_id', v_new_id, 'date', p_date));
  end if;

  return v_new_id;
end;
$$;

grant execute on function public.propose_meetup(uuid, date, time, text, text, text, text, double precision, double precision) to authenticated;

drop function if exists public.add_meetup_details(uuid, time, text, text);

create or replace function public.add_meetup_details(
  p_meetup_id uuid,
  p_start_time time default null,
  p_place text default null,
  p_activity text default null,
  p_place_address text default null,
  p_place_lat double precision default null,
  p_place_lng double precision default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid := auth.uid();
  v_meetup record;
  v_new_place text := nullif(btrim(coalesce(p_place, '')), '');
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  select m.* into v_meetup
  from public.meetups m join public.connections c on c.id = m.connection_id
  where m.id = p_meetup_id and (c.user_a_id = v_caller or c.user_b_id = v_caller);
  if not found then raise exception 'Not a participant of this meetup''s connection'; end if;
  if v_meetup.status not in ('proposed','confirmed') then
    raise exception 'This plan can no longer be changed';
  end if;

  update public.meetups set
    start_time = coalesce(start_time, p_start_time),
    place_address = case when place is null and v_new_place is not null
      then nullif(btrim(coalesce(p_place_address, '')), '') else place_address end,
    place_lat = case when place is null and v_new_place is not null then p_place_lat else place_lat end,
    place_lng = case when place is null and v_new_place is not null then p_place_lng else place_lng end,
    place = coalesce(place, v_new_place),
    activity = coalesce(activity, nullif(btrim(coalesce(p_activity, '')), ''))
  where id = p_meetup_id;
end;
$$;

grant execute on function public.add_meetup_details(uuid, time, text, text, text, double precision, double precision) to authenticated;

-- ------------------------------------------------------------------
-- 2. Changing only "what you'll do"
-- ------------------------------------------------------------------
-- Same date, time and place: nothing to re-confirm, so it is updated in
-- place. Either person can change it (it shows on both cards right away).
create or replace function public.update_meetup_activity(p_meetup_id uuid, p_activity text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid := auth.uid();
  v_meetup record;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  select m.* into v_meetup
  from public.meetups m join public.connections c on c.id = m.connection_id
  where m.id = p_meetup_id and (c.user_a_id = v_caller or c.user_b_id = v_caller);
  if not found then raise exception 'Not a participant of this meetup''s connection'; end if;
  if v_meetup.status not in ('proposed','confirmed') then
    raise exception 'This plan can no longer be changed';
  end if;
  update public.meetups set activity = nullif(btrim(coalesce(p_activity, '')), '') where id = p_meetup_id;
end;
$$;

grant execute on function public.update_meetup_activity(uuid, text) to authenticated;

-- The plan card's data, now with the place's address and map position.
create or replace function public.get_meetup_plan(p_connection_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid := auth.uid();
  v_conn public.connections%rowtype;
  v_other uuid;
  v_m public.meetups%rowtype;
  v_prev public.meetups%rowtype;
  v_has_prev boolean := false;
  v_tz text;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  select * into v_conn from public.connections
  where id = p_connection_id and (user_a_id = v_caller or user_b_id = v_caller);
  if not found then return null; end if;
  v_other := case when v_conn.user_a_id = v_caller then v_conn.user_b_id else v_conn.user_a_id end;

  select * into v_m from public.meetups
  where connection_id = p_connection_id and status in ('proposed','confirmed')
    and coalesce(confirmed_date, proposed_date) >= (now() at time zone public.meetup_tz(time_zone))::date
  order by created_at desc, id desc limit 1;

  if not found then
    return jsonb_build_object('meetup', null, 'meetup_count', v_conn.meetup_count);
  end if;

  v_tz := public.meetup_tz(v_m.time_zone);

  if v_m.status = 'proposed' then
    select * into v_prev from public.meetups
    where coalesce(plan_root_id, id) = coalesce(v_m.plan_root_id, v_m.id)
      and id <> v_m.id and status = 'rescheduled' and confirmed_date is not null
    order by created_at desc, id desc
    limit 1;
    v_has_prev := found;
  end if;

  return jsonb_build_object(
    'meetup_count', v_conn.meetup_count,
    'local_today', (now() at time zone v_tz)::date,
    'meetup', jsonb_build_object(
      'id', v_m.id,
      'status', v_m.status,
      'date', coalesce(v_m.confirmed_date, v_m.proposed_date),
      'start_time', to_char(v_m.start_time, 'HH24:MI'),
      'place', v_m.place,
      'place_address', v_m.place_address,
      'place_lat', v_m.place_lat,
      'place_lng', v_m.place_lng,
      'activity', v_m.activity,
      'time_zone', v_tz,
      'proposed_by', v_m.proposed_by,
      'move_count', v_m.move_count,
      'plan_root_id', coalesce(v_m.plan_root_id, v_m.id),
      'previous', case when v_has_prev then jsonb_build_object(
          'date', v_prev.confirmed_date,
          'start_time', to_char(v_prev.start_time, 'HH24:MI'),
          'place', v_prev.place) else null end,
      'other_still_on', exists (
        select 1 from public.meetup_prompt_responses r
        where r.meetup_id = v_m.id and r.user_id = v_other and r.prompt = 'still_on' and r.answer = 'still_on'),
      'my_still_on', (
        select r.answer from public.meetup_prompt_responses r
        where r.meetup_id = v_m.id and r.user_id = v_caller and r.prompt = 'still_on'),
      'many_moves_answered', exists (
        select 1 from public.meetup_prompt_responses r
        where r.meetup_id = coalesce(v_m.plan_root_id, v_m.id) and r.user_id = v_caller and r.prompt = 'many_moves')
    )
  );
end;
$$;

grant execute on function public.get_meetup_plan(uuid) to authenticated;

-- ------------------------------------------------------------------
-- 3. Meeting pace in the chat
-- ------------------------------------------------------------------
create or replace function public.get_pace_summary(p_connection_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid := auth.uid();
  v_conn public.connections%rowtype;
  v_other uuid;
  v_mine text;
  v_theirs text;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  select * into v_conn from public.connections
  where id = p_connection_id and (user_a_id = v_caller or user_b_id = v_caller);
  if not found then return null; end if;
  v_other := case when v_conn.user_a_id = v_caller then v_conn.user_b_id else v_conn.user_a_id end;
  select cadence into v_mine from public.rhythm_preferences where connection_id = p_connection_id and user_id = v_caller;
  select cadence into v_theirs from public.rhythm_preferences where connection_id = p_connection_id and user_id = v_other;
  return jsonb_build_object(
    'mine', v_mine,
    -- Only ever true or false; the other person's answer itself is never returned.
    'both_same', v_mine is not null and v_mine <> 'not_sure' and v_mine = v_theirs,
    'meetup_count', v_conn.meetup_count
  );
end;
$$;

grant execute on function public.get_pace_summary(uuid) to authenticated;

-- ------------------------------------------------------------------
-- 4. Profiles of people you already had a chat with
-- ------------------------------------------------------------------
-- Same columns as discovery_profiles, without the search filters (gender,
-- distance, age range, photo), which can stop matching after a chat ends.
-- Blocked either way, or a suspended account, still hides the profile.
create or replace view public.connected_profiles as
select u.id as user_id,
    u.gender_identity,
    u.matching_preference,
    p.display_name,
    public.age_band(p.birthdate) as age_band,
    case when p.show_life_transitions then p.life_transitions else '{}'::text[] end as life_transitions,
    p.activity_interests,
    p."values",
    p.hangout_people_preference,
    p.hangout_type_preference,
    p.communication_freq,
    p.meeting_freq,
    p.response_time,
    p.personal_statement,
    p.bar_preference,
    p.photo_url,
    p.completion_pct,
    p.dealbreakers,
    p.personality_16p,
    case when p.show_life_transitions then p.life_transitions_other else null::text end as life_transitions_other,
    p.values_other,
    p.location_city,
    p.location_state,
    p.location_country,
    p.location_lat,
    p.location_lng,
    p.ethnicity,
    p.ethnicity_other,
    p.languages,
    p.languages_other,
    p.friendship_type,
    p.communication_style_openness,
    case
      when viewer_p.location_lat is null or viewer_p.location_lng is null or p.location_lat is null or p.location_lng is null then null::double precision
      else 3959::double precision * acos(least(1::double precision, greatest(-1::double precision,
        sin(radians(viewer_p.location_lat)) * sin(radians(p.location_lat))
        + cos(radians(viewer_p.location_lat)) * cos(radians(p.location_lat)) * cos(radians(p.location_lng) - radians(viewer_p.location_lng)))))
    end as distance_miles,
    p.availability,
    p.communication_modes,
    p.extra_photo_urls,
    (u.selfie_verified_at is not null) as selfie_verified,
    u.social_linked,
    p.friendship_types
from public.users u
join public.profiles p on p.user_id = u.id
join public.profiles viewer_p on viewer_p.user_id = auth.uid()
where u.id <> auth.uid()
  and u.suspended_at is null
  and exists (
    select 1 from public.connections c
    where (c.user_a_id = auth.uid() and c.user_b_id = u.id) or (c.user_a_id = u.id and c.user_b_id = auth.uid())
  )
  and not exists (
    select 1 from public.blocks b
    where (b.blocker_id = auth.uid() and b.blocked_id = u.id) or (b.blocker_id = u.id and b.blocked_id = auth.uid())
  );

grant select on public.connected_profiles to authenticated;

-- ------------------------------------------------------------------
-- 5. Database version, read by the Test tab
-- ------------------------------------------------------------------
create or replace function public.limen_db_version()
returns text
language sql
immutable
as $$ select '20261009000000'::text $$;

grant execute on function public.limen_db_version() to anon, authenticated;

notify pgrst, 'reload schema';
