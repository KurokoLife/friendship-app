-- 2026-10-18: a shared language is required to be suggested. Safe to run twice.
--
-- Founder: if two people don't speak the same language, they can't talk.
-- compatible_candidates_for now only returns people who share at least one
-- language with the viewer ("Other" alone doesn't count). Matching points
-- changed in generate-match-suggestions (meeting pace 40, interests 40,
-- friendship type 20); "what brings you here" is free text now and is never
-- scored.
--
-- Profiles with no language yet (all test accounts so far) get English, so
-- nobody silently disappears from Discover. Joining now asks for languages.
-- Also fixes the Test tab "Meetup today" tool after 10pm (dev_meetup_test).
-- limen_db_version() -> 20261018000000.

update public.profiles
set languages = array['English']
where coalesce(array_length(languages, 1), 0) = 0;

CREATE OR REPLACE FUNCTION public.compatible_candidates_for(p_user_id uuid)
 RETURNS TABLE(user_id uuid, display_name text, age_band text, life_transitions text[], activity_interests jsonb, "values" text[], hangout_people_preference text, hangout_type_preference text[], meeting_freq text, communication_freq text, personal_statement text, languages text[], friendship_type text, communication_style_openness text, location_city text, location_state text, location_country text, distance_miles double precision, show_life_transitions boolean, interested_in_viewer boolean, ghosting_penalized boolean, friendship_types text[], previously_suggested boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    u.id as user_id,
    p.display_name,
    public.age_band(p.birthdate) as age_band,
    p.life_transitions,
    p.activity_interests,
    p."values",
    p.hangout_people_preference,
    p.hangout_type_preference,
    p.meeting_freq,
    p.communication_freq,
    p.personal_statement,
    p.languages,
    p.friendship_type,
    p.communication_style_openness,
    p.location_city,
    p.location_state,
    p.location_country,
    case
      when viewer_p.location_lat is null or viewer_p.location_lng is null
        or p.location_lat is null or p.location_lng is null then null
      else 3959 * acos(least(1, greatest(-1,
        sin(radians(viewer_p.location_lat)) * sin(radians(p.location_lat))
        + cos(radians(viewer_p.location_lat)) * cos(radians(p.location_lat))
          * cos(radians(p.location_lng) - radians(viewer_p.location_lng))
      )))
    end as distance_miles,
    p.show_life_transitions,
    public.interest_is_open(u.id, p_user_id) as interested_in_viewer,
    public.is_ghosting_penalized(u.id) as ghosting_penalized,
    p.friendship_types,
    exists (select 1 from public.match_suggestions s where s.user_id = p_user_id and s.candidate_id = u.id) as previously_suggested
  from users u
  join profiles p on p.user_id = u.id
  join users viewer on viewer.id = p_user_id
  join profiles viewer_p on viewer_p.user_id = viewer.id
  where u.id <> p_user_id
    and public.genders_match(viewer.gender_identity, viewer.meet_genders, u.gender_identity, u.meet_genders)
    and (u.paused_until is null or u.paused_until <= now())
    and u.suspended_at is null
    and p.photo_url is not null
    and not exists (
      select 1 from public.blocks b
      where (b.blocker_id = p_user_id and b.blocked_id = u.id)
         or (b.blocker_id = u.id and b.blocked_id = p_user_id)
    )
    and (
      viewer_p.location_lat is null or viewer_p.location_lng is null
      or p.location_lat is null or p.location_lng is null
      or 3959 * acos(least(1, greatest(-1,
          sin(radians(viewer_p.location_lat)) * sin(radians(p.location_lat))
          + cos(radians(viewer_p.location_lat)) * cos(radians(p.location_lat))
            * cos(radians(p.location_lng) - radians(viewer_p.location_lng))
        ))) <= viewer_p.search_radius_miles
    )
    and (
      p.birthdate is null or viewer_p.birthdate is null
      or (
        extract(year from age(current_date::timestamptz, p.birthdate::timestamptz))::integer
          between viewer_p.min_friend_age and viewer_p.max_friend_age
        and extract(year from age(current_date::timestamptz, viewer_p.birthdate::timestamptz))::integer
          between p.min_friend_age and p.max_friend_age
      )
    )
    -- 2026-10-18: two people are suggested to each other only if they
    -- share at least one language ("Other" alone doesn't count).
    and exists (
      select 1 from unnest(coalesce(p.languages, '{}'::text[])) l
      where l <> 'Other' and l = any(coalesce(viewer_p.languages, '{}'::text[]))
    )
    -- 2026-10-10: new people only, and only people with room.
    and public.has_room(u.id)
    and not public.pair_had_chat(p_user_id, u.id)
    and not exists (
      select 1 from public.connections c
      where c.user_a_id = p_user_id and c.user_b_id = u.id and c.status = 'passed'
    )
    and not public.save_is_open(p_user_id, u.id)
    and not public.interest_is_open(p_user_id, u.id)
    and not exists (
      select 1 from public.match_suggestions s
      where s.user_id = p_user_id and s.candidate_id = u.id and s.created_at > now() - interval '21 days'
    );
$function$;

-- Test tab fix: "Meetup today" after 10pm set the time to 12:00 AM.
CREATE OR REPLACE FUNCTION public.dev_meetup_test(p_connection_id uuid, p_action text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_conn public.connections%rowtype;
  v_other uuid;
  v_m public.meetups%rowtype;
  v_tz text := 'America/Los_Angeles';
  v_local timestamp;
  v_today date;
  v_start time;
  v_date date;
  v_id uuid;
  v_created boolean := false;
  v_result text;
begin
  if v_caller is null then raise exception 'Not signed in'; end if;
  if not exists (select 1 from public.users where id = v_caller and is_admin)
     and not exists (
       select 1 from auth.users
       where id = v_caller
         and ltrim(coalesce(phone, ''), '+') in (
           '15555500101','15555500102','15555500103','15555500104','15555500105',
           '15555500106','15555500107','15555500108','15555500109')) then
    raise exception 'Test tools are only for admins and test accounts';
  end if;

  select * into v_conn from public.connections
  where id = p_connection_id and (user_a_id = v_caller or user_b_id = v_caller);
  if not found then raise exception 'You are not part of that chat'; end if;
  v_other := case when v_conn.user_a_id = v_caller then v_conn.user_b_id else v_conn.user_a_id end;

  if p_action = 'past' then
    v_date := (now() at time zone v_tz)::date - 7 * (coalesce(v_conn.meetup_count, 0) + 1);
    insert into public.meetups (connection_id, proposed_date, proposed_by, confirmed_date, confirmed_at, confirmed_by, time_zone, place, activity)
    values (p_connection_id, v_date, v_caller, v_date, now(), v_other, v_tz, 'Test meetup', 'Coffee')
    returning id into v_id;
    update public.meetups set plan_root_id = v_id, status = 'confirmed' where id = v_id;
    update public.meetups set status = 'occurred', occurred_date = v_date, date_status = 'confirmed' where id = v_id;
    perform public.record_friendship_event(p_connection_id, 'meetup_occurred', null,
      jsonb_build_object('meetup_id', v_id, 'test', true));
    return format('Added a meetup on %s to the history. Open the chat and tap "See history".', to_char(v_date, 'Mon DD'));
  end if;

  if p_action not in ('tomorrow', 'today', 'happened') then
    raise exception 'Unknown test';
  end if;

  select * into v_m from public.meetups
  where connection_id = p_connection_id and status in ('proposed','confirmed')
  order by created_at desc, id desc limit 1;

  if not found then
    insert into public.meetups (connection_id, proposed_date, proposed_by, time_zone, start_time, place, activity)
    values (p_connection_id, (now() at time zone v_tz)::date + 1, v_caller, v_tz, time '18:00', 'Test cafe', 'Coffee')
    returning * into v_m;
    update public.meetups set plan_root_id = v_m.id where id = v_m.id;
    v_created := true;
  end if;

  v_tz := public.meetup_tz(v_m.time_zone);
  v_local := now() at time zone v_tz;
  v_today := v_local::date;

  if p_action = 'tomorrow' then
    update public.meetups
    set status = 'confirmed', proposed_date = v_today + 1, confirmed_date = v_today + 1,
        confirmed_at = now() - interval '7 hours', confirmed_by = coalesce(confirmed_by, v_other)
    where id = v_m.id;
    delete from public.meetup_prompt_responses where meetup_id = v_m.id and prompt = 'still_on';
    v_result := 'The meetup is now tomorrow. Open the chat (as either person) to see "Still on?".';

  elsif p_action = 'today' then
    if v_local::time < time '05:00' then
      raise exception 'The morning-of card shows from 5am. Try again later today.';
    end if;
    if v_local::time >= time '23:00' then
      raise exception 'It is too late in the day to test this. Try again tomorrow morning.';
    end if;
    -- 2026-10-18: after 10pm, "two hours from now" wrapped past midnight
    -- to 12:00 AM (already over), so the morning-of card never showed.
    v_start := case when v_local::time >= time '21:55' then time '23:55'
                    else (date_trunc('hour', v_local) + interval '2 hours')::time end;
    update public.meetups
    set status = 'confirmed', proposed_date = v_today, confirmed_date = v_today, start_time = v_start,
        confirmed_at = now() - interval '1 day', confirmed_by = coalesce(confirmed_by, v_other)
    where id = v_m.id;
    delete from public.meetup_prompt_responses where meetup_id = v_m.id and prompt in ('still_on', 'feeling');
    v_result := format('The meetup is now today at %s. Open the chat to see the morning-of card.', to_char(v_start, 'HH12:MI AM'));

  else -- happened
    if not public.is_connection_automation_eligible(v_conn.status) then
      raise exception 'This chat is %, so "Did you meet?" is not asked here.', v_conn.status;
    end if;
    update public.meetups
    set status = 'confirmed', proposed_date = v_today - 1, confirmed_date = v_today - 1,
        confirmed_at = coalesce(confirmed_at, now() - interval '2 days'), confirmed_by = coalesce(confirmed_by, v_other)
    where id = v_m.id;
    delete from public.meetup_occurrence_reports where meetup_id = v_m.id;
    delete from public.connection_interventions
    where connection_id = p_connection_id and intervention_type = 'meetup_occurrence_check' and status = 'pending';
    perform public.run_meetup_occurrence_check_v2(p_connection_id, now() + interval '1 day');
    v_result := 'The meetup is now yesterday. Open the chat (as either person) to see "Did you meet?".';
  end if;

  if v_created then
    v_result := 'No plan in this chat, so a test plan was made. ' || v_result;
  end if;
  return v_result;
end;
$function$;

create or replace function public.limen_db_version()
returns text
language sql
stable
as $function$ select '20261018000000'::text $function$;
grant execute on function public.limen_db_version() to anon, authenticated;
