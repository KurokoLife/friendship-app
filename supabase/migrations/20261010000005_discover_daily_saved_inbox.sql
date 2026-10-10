-- 2026-10-10: Discover one person a day, Interested and Saved close after
-- 30 days, paused chats count toward the 3, hide a blocked chat.
-- Safe to run twice. Founder decisions, docs/DECISIONS.md section 4.
--
--   A. Paused chats count toward the 3 active conversations (they show in
--      the Active tab). connection_counts() counts a paused chat as active.
--      A chat opened from a saved row now gets status 'pending' like any
--      other new chat.
--   B. Who can be suggested (compatible_candidates_for): never anyone you
--      have had a chat with (any state), never anyone with 3 active chats,
--      never anyone you passed on, saved, or said Interested to (within 30
--      days), and not someone shown to you in the last 21 days. Someone who
--      was shown before and let go comes back later, at the bottom.
--   C. Discover: one new person a day (in the person's own time zone), at
--      most 3 waiting, nobody while you have 3 active chats.
--      get_discover(tz) says what to show; discover_next_candidates and
--      discover_add are used by the generate-match-suggestions function.
--   D. Interested closes after 30 days if it doesn't become mutual. A
--      closed interest no longer counts for a match, no longer moves you
--      up, and is shown once ("has come to a close") in Saved. At most 5
--      open at a time. Saying Interested again later starts a new 30 days.
--   E. Saved: at most 5, each closes after 30 days, and a person leaves
--      Saved as soon as you've had a chat with them. save_for_later().
--   F. hidden_chats: the person who blocked can hide that chat from Inbox.
--   G. limen_db_version() -> 20261010000005.

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------

-- True when these two people have ever had a chat, in any state.
create or replace function public.pair_had_chat(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.connections c
    where ((c.user_a_id = p_a and c.user_b_id = p_b) or (c.user_a_id = p_b and c.user_b_id = p_a))
      and (
        c.status in ('pending', 'active', 'paused', 'ended', 'inactive', 'graduated', 'blocked')
        or exists (select 1 from public.messages m where m.connection_id = c.id)
      )
  )
  or public.mutual_interest_exists(p_a, p_b);
$$;
revoke execute on function public.pair_had_chat(uuid, uuid) from public, anon, authenticated;

create or replace function public.interest_is_open(p_from uuid, p_to uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.interests
    where from_user_id = p_from and to_user_id = p_to and created_at > now() - interval '30 days'
  );
$$;
revoke execute on function public.interest_is_open(uuid, uuid) from public, anon, authenticated;

create or replace function public.save_is_open(p_user uuid, p_other uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.connections c
    where c.user_a_id = p_user and c.user_b_id = p_other and c.saved = true
      and coalesce(c.saved_at, now()) > now() - interval '30 days'
  );
$$;
revoke execute on function public.save_is_open(uuid, uuid) from public, anon, authenticated;

-- The same two checks for the signed-in person only, for the Saved view.
create or replace function public.i_had_chat_with(p_other uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$ select public.pair_had_chat(auth.uid(), p_other); $$;
grant execute on function public.i_had_chat_with(uuid) to authenticated;

create or replace function public.my_interest_is_open(p_other uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$ select public.interest_is_open(auth.uid(), p_other); $$;
grant execute on function public.my_interest_is_open(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- A. Paused chats count toward the 3
-- ---------------------------------------------------------------------

create or replace function public.connection_counts(p_user uuid)
returns table (active_count integer, pending_count integer)
language sql
stable
security definer
set search_path to 'public'
as $$
  with mine as (
    select
      c.status = 'paused' as is_paused,
      exists (select 1 from public.messages m where m.connection_id = c.id and m.sender_id = p_user) as i_wrote,
      exists (select 1 from public.messages m where m.connection_id = c.id and m.sender_id <> p_user) as they_wrote
    from public.connections c
    where (c.user_a_id = p_user or c.user_b_id = p_user)
      and (c.status is null or c.status not in ('passed', 'inactive', 'blocked', 'ended', 'graduated'))
  )
  select
    count(*) filter (where is_paused or (i_wrote and they_wrote))::integer,
    count(*) filter (where not is_paused and i_wrote and not they_wrote)::integer
  from mine;
$$;
revoke execute on function public.connection_counts(uuid) from public, anon, authenticated;

create or replace function public.has_room(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce((select active_count < 3 from public.connection_counts(p_user)), true);
$$;
revoke execute on function public.has_room(uuid) from public, anon, authenticated;

create or replace function public.create_connection_with_capacity_check(p_other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid := auth.uid();
  v_existing_id uuid;
  v_existing_status text;
  v_new_id uuid;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if v_caller = p_other_user_id then raise exception 'Cannot connect to yourself'; end if;
  if not public.is_user_active(v_caller) then raise exception 'suspended'; end if;
  if not public.is_user_active(p_other_user_id) then raise exception 'unavailable'; end if;
  if exists (
    select 1 from public.blocks b
    where (b.blocker_id = v_caller and b.blocked_id = p_other_user_id)
       or (b.blocker_id = p_other_user_id and b.blocked_id = v_caller)
  ) then
    raise exception 'blocked';
  end if;

  select id, status into v_existing_id, v_existing_status
  from public.connections
  where (user_a_id = v_caller and user_b_id = p_other_user_id)
     or (user_a_id = p_other_user_id and user_b_id = v_caller)
  order by (status is not null and status not in ('passed')) desc, created_at desc
  limit 1;

  if v_existing_id is not null then
    if v_existing_status = 'blocked' then raise exception 'blocked'; end if;
    if v_existing_status = 'ended' then raise exception 'ended'; end if;
    -- A saved or passed row, or a chat that closed: opening it counts like
    -- starting a new one, so it can't take anyone past the limit.
    if v_existing_status is null or v_existing_status in ('inactive', 'passed') then
      perform public.check_connection_capacity(v_caller);
      update public.connections set status = 'pending', opened_at = now(), saved = false where id = v_existing_id;
    end if;
    return v_existing_id;
  end if;

  perform public.check_connection_capacity(v_caller);

  insert into public.connections (user_a_id, user_b_id, status, opened_at)
  values (v_caller, p_other_user_id, 'pending', now())
  returning id into v_new_id;
  return v_new_id;
end;
$$;
grant execute on function public.create_connection_with_capacity_check(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- B. Who can be suggested
-- ---------------------------------------------------------------------

drop function if exists public.compatible_candidates_for(uuid);
create function public.compatible_candidates_for(p_user_id uuid)
returns table(
  user_id uuid,
  display_name text,
  age_band text,
  life_transitions text[],
  activity_interests jsonb,
  "values" text[],
  hangout_people_preference text,
  hangout_type_preference text[],
  meeting_freq text,
  communication_freq text,
  personal_statement text,
  languages text[],
  friendship_type text,
  communication_style_openness text,
  location_city text,
  location_state text,
  location_country text,
  distance_miles double precision,
  show_life_transitions boolean,
  interested_in_viewer boolean,
  ghosting_penalized boolean,
  friendship_types text[],
  previously_suggested boolean
)
language sql
stable security definer
set search_path to 'public'
as $function$
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

revoke all on function public.compatible_candidates_for(uuid) from public, anon, authenticated;
grant execute on function public.compatible_candidates_for(uuid) to service_role;

-- ---------------------------------------------------------------------
-- C. Discover: one a day, at most 3 waiting, nobody while full
-- ---------------------------------------------------------------------

create or replace function public._safe_tz(p_tz text)
returns text
language sql
stable
as $$
  select case when exists (select 1 from pg_timezone_names where name = p_tz) then p_tz else 'America/Los_Angeles' end;
$$;

-- The suggestions someone sees right now: the newest 3 that are still
-- open (not passed, saved, or Interested; no chat; the person still has
-- room and still fits).
create or replace function public.discover_open_suggestions(p_user uuid)
returns table (candidate_id uuid, reasoning text, human_detail text, created_at timestamptz)
language sql
stable
security definer
set search_path to 'public'
as $$
  with latest as (
    select distinct on (s.candidate_id) s.candidate_id, s.reasoning, s.human_detail, s.created_at
    from public.match_suggestions s
    where s.user_id = p_user
    order by s.candidate_id, s.created_at desc
  )
  select l.candidate_id, l.reasoning, l.human_detail, l.created_at
  from latest l
  join public.users u on u.id = l.candidate_id
  where u.suspended_at is null
    and (u.paused_until is null or u.paused_until <= now())
    and not exists (
      select 1 from public.blocks b
      where (b.blocker_id = p_user and b.blocked_id = l.candidate_id)
         or (b.blocker_id = l.candidate_id and b.blocked_id = p_user)
    )
    and public.has_room(l.candidate_id)
    and not public.pair_had_chat(p_user, l.candidate_id)
    and not exists (
      select 1 from public.connections c
      where c.user_a_id = p_user and c.user_b_id = l.candidate_id and c.status = 'passed'
    )
    and not public.save_is_open(p_user, l.candidate_id)
    and not public.interest_is_open(p_user, l.candidate_id)
    -- Let go after the 3 newer ones arrive, or after 21 days.
    and l.created_at > now() - interval '21 days'
  order by l.created_at desc
  limit 3;
$$;
revoke execute on function public.discover_open_suggestions(uuid) from public, anon, authenticated;

create or replace function public.discover_can_add(p_user uuid, p_tz text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.has_room(p_user)
     and not exists (
       select 1 from public.match_suggestions s
       where s.user_id = p_user
         and s.created_at >= (date_trunc('day', now() at time zone public._safe_tz(p_tz)) at time zone public._safe_tz(p_tz))
     );
$$;
revoke execute on function public.discover_can_add(uuid, text) from public, anon, authenticated;

-- What Discover shows for the signed-in person.
create or replace function public.get_discover(p_tz text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_user uuid := auth.uid();
  v_tz text := public._safe_tz(p_tz);
  v_items jsonb;
begin
  if v_user is null then return jsonb_build_object('full', false, 'can_add', false, 'items', '[]'::jsonb); end if;
  if not public.has_room(v_user) then
    return jsonb_build_object('full', true, 'can_add', false, 'items', '[]'::jsonb);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'candidate_id', o.candidate_id, 'reasoning', o.reasoning,
           'human_detail', o.human_detail, 'created_at', o.created_at)
           order by o.created_at desc), '[]'::jsonb)
    into v_items
  from public.discover_open_suggestions(v_user) o;
  return jsonb_build_object(
    'full', false,
    'can_add', public.discover_can_add(v_user, v_tz),
    'items', v_items,
    'next_at', (date_trunc('day', now() at time zone v_tz) + interval '1 day') at time zone v_tz
  );
end;
$$;
grant execute on function public.get_discover(text) to authenticated;

-- For the suggestions function: who could be today's new person (empty
-- when nobody should be added today).
create or replace function public.discover_next_candidates(p_user_id uuid, p_tz text default null)
returns table (candidate_id uuid, interested_in_viewer boolean, ghosting_penalized boolean, previously_suggested boolean)
language sql
stable
security definer
set search_path to 'public'
as $$
  select c.user_id, c.interested_in_viewer, c.ghosting_penalized, c.previously_suggested
  from public.compatible_candidates_for(p_user_id) c
  where public.discover_can_add(p_user_id, p_tz);
$$;
revoke all on function public.discover_next_candidates(uuid, text) from public, anon, authenticated;
grant execute on function public.discover_next_candidates(uuid, text) to service_role;

-- Adds today's one new person, checking again that it's allowed.
create or replace function public.discover_add(
  p_user_id uuid, p_candidate_id uuid, p_reasoning text, p_human_detail text, p_tz text default null
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.discover_can_add(p_user_id, p_tz) then return false; end if;
  if not exists (select 1 from public.compatible_candidates_for(p_user_id) c where c.user_id = p_candidate_id) then
    return false;
  end if;
  insert into public.match_suggestions (user_id, candidate_id, reasoning, human_detail, suggested_date)
  values (p_user_id, p_candidate_id, coalesce(nullif(btrim(p_reasoning), ''), 'You might enjoy getting to know each other.'),
          p_human_detail, (now() at time zone public._safe_tz(p_tz))::date)
  on conflict (user_id, candidate_id, suggested_date) do nothing;
  return true;
end;
$$;
revoke all on function public.discover_add(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.discover_add(uuid, uuid, text, text, text) to service_role;

-- ---------------------------------------------------------------------
-- D. Interested closes after 30 days, at most 5 open
-- ---------------------------------------------------------------------

alter table public.interests add column if not exists closure_seen_at timestamptz;

create or replace function public.express_interest(p_other_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid := auth.uid();
  v_connection_id uuid;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if v_caller = p_other_user_id then raise exception 'Cannot connect to yourself'; end if;

  if not public.selfie_check_done(v_caller)
     and not public.users_have_chatted(v_caller, p_other_user_id) then
    if exists (select 1 from public.selfie_checks where user_id = v_caller and status = 'pending') then
      raise exception 'selfie_pending';
    end if;
    raise exception 'not_verified';
  end if;
  if not public.is_user_active(v_caller) then raise exception 'suspended'; end if;
  if not public.is_user_active(p_other_user_id) then raise exception 'unavailable'; end if;
  if exists (
    select 1 from public.blocks b
    where (b.blocker_id = v_caller and b.blocked_id = p_other_user_id)
       or (b.blocker_id = p_other_user_id and b.blocked_id = v_caller)
  ) then
    raise exception 'blocked';
  end if;

  -- At most 5 open at a time (not counting this person).
  if not public.interest_is_open(v_caller, p_other_user_id) and (
    select count(*) from public.interests i
    where i.from_user_id = v_caller and i.created_at > now() - interval '30 days'
      and not public.pair_had_chat(v_caller, i.to_user_id)
  ) >= 5 then
    raise exception 'interest_cap_reached';
  end if;

  -- A new Interested, or a fresh one after an old one closed.
  insert into public.interests (from_user_id, to_user_id)
  values (v_caller, p_other_user_id)
  on conflict (from_user_id, to_user_id) do update
    set created_at = now(), closure_seen_at = null
    where public.interests.created_at <= now() - interval '30 days';

  if not public.interest_is_open(p_other_user_id, v_caller) then
    return jsonb_build_object('mutual', false);
  end if;

  v_connection_id := public.create_connection_with_capacity_check(p_other_user_id);
  return jsonb_build_object('mutual', true, 'connection_id', v_connection_id);
end;
$$;
grant execute on function public.express_interest(uuid) to authenticated;

-- Saved tab: open Interested (waiting) and closed ones not yet shown.
create or replace function public.my_interests()
returns table (other_user_id uuid, display_name text, age_band text, created_at timestamptz, closes_at timestamptz, state text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select i.to_user_id, p.display_name, public.age_band(p.birthdate), i.created_at,
         i.created_at + interval '30 days',
         case when i.created_at > now() - interval '30 days' then 'open' else 'closed' end
  from public.interests i
  join public.profiles p on p.user_id = i.to_user_id
  join public.users u on u.id = i.to_user_id
  where i.from_user_id = auth.uid()
    and not public.pair_had_chat(auth.uid(), i.to_user_id)
    and not exists (
      select 1 from public.blocks b
      where (b.blocker_id = auth.uid() and b.blocked_id = i.to_user_id)
         or (b.blocker_id = i.to_user_id and b.blocked_id = auth.uid())
    )
    and (i.created_at > now() - interval '30 days' or i.closure_seen_at is null)
  order by i.created_at desc;
$$;
grant execute on function public.my_interests() to authenticated;

create or replace function public.ack_interest_closures()
returns void
language sql
security definer
set search_path to 'public'
as $$
  update public.interests set closure_seen_at = now()
  where from_user_id = auth.uid() and created_at <= now() - interval '30 days' and closure_seen_at is null;
$$;
grant execute on function public.ack_interest_closures() to authenticated;

-- ---------------------------------------------------------------------
-- E. Saved: at most 5, 30 days, gone once you've had a chat
-- ---------------------------------------------------------------------

create or replace function public.save_for_later(p_other_user_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if public.save_is_open(v_caller, p_other_user_id) then return 'saved'; end if;
  if (
    select count(*) from public.connections c
    where c.user_a_id = v_caller and c.saved = true
      and coalesce(c.saved_at, now()) > now() - interval '30 days'
      and not public.pair_had_chat(v_caller, c.user_b_id)
  ) >= 5 then
    return 'full';
  end if;
  insert into public.connections (user_a_id, user_b_id, saved, saved_at)
  values (v_caller, p_other_user_id, true, now())
  on conflict (user_a_id, user_b_id) do update set saved = true, saved_at = now();
  return 'saved';
end;
$$;
grant execute on function public.save_for_later(uuid) to authenticated;

create or replace view public.saved_profiles as
SELECT c.id AS connection_id,
    c.user_b_id AS user_id,
    c.saved_at,
    p.display_name,
    age_band(p.birthdate) AS age_band,
    CASE WHEN p.show_life_transitions THEN p.life_transitions ELSE '{}'::text[] END AS life_transitions,
    p.personal_statement
   FROM connections c
     JOIN users u ON u.id = c.user_b_id
     JOIN profiles p ON p.user_id = c.user_b_id
     JOIN users viewer ON viewer.id = auth.uid()
     JOIN profiles viewer_p ON viewer_p.user_id = viewer.id
  WHERE c.user_a_id = auth.uid()
    AND c.saved = true
    AND coalesce(c.saved_at, now()) > now() - interval '30 days'
    AND NOT public.i_had_chat_with(c.user_b_id)
    AND NOT public.my_interest_is_open(c.user_b_id)
    AND genders_match(viewer.gender_identity, viewer.meet_genders, u.gender_identity, u.meet_genders)
    AND u.suspended_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.blocks b
      WHERE (b.blocker_id = auth.uid() AND b.blocked_id = u.id)
         OR (b.blocker_id = u.id AND b.blocked_id = auth.uid())
    )
    AND (p.birthdate IS NULL OR viewer_p.birthdate IS NULL OR EXTRACT(year FROM age(CURRENT_DATE::timestamp with time zone, p.birthdate::timestamp with time zone))::integer >= viewer_p.min_friend_age AND EXTRACT(year FROM age(CURRENT_DATE::timestamp with time zone, p.birthdate::timestamp with time zone))::integer <= viewer_p.max_friend_age AND EXTRACT(year FROM age(CURRENT_DATE::timestamp with time zone, viewer_p.birthdate::timestamp with time zone))::integer >= p.min_friend_age AND EXTRACT(year FROM age(CURRENT_DATE::timestamp with time zone, viewer_p.birthdate::timestamp with time zone))::integer <= p.max_friend_age);

-- ---------------------------------------------------------------------
-- F. Hide a chat you blocked
-- ---------------------------------------------------------------------

create table if not exists public.hidden_chats (
  user_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid not null references public.connections(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, connection_id)
);
alter table public.hidden_chats enable row level security;
drop policy if exists "Own hidden chats" on public.hidden_chats;
create policy "Own hidden chats" on public.hidden_chats
  for all using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.connections c
      where c.id = hidden_chats.connection_id and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
    )
  );
grant select, insert, delete on public.hidden_chats to authenticated;

-- ---------------------------------------------------------------------
-- G. Version
-- ---------------------------------------------------------------------

create or replace function public.limen_db_version()
returns text
language sql
stable
as $function$ select '20261010000005'::text $function$;
grant execute on function public.limen_db_version() to anon, authenticated;
