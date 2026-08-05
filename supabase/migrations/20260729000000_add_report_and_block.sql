-- Report & Block, per AGENTS.md's Missing-From-Original-F-Numbering list
-- (Full Report & Block, 8 categories, Block instantly stops visibility and
-- messaging, reporting never requires continued contact, emergency
-- guidance and evidence handling). Safety-critical, not a routine feature.
--
-- LEGAL/COMPLIANCE FLAG, not assumed silently: this migration makes no
-- retention or deletion decision for report data. Reports are stored
-- indefinitely by default here, the same standing this app already gives
-- no_ghost_prompts and other behavioral records, nothing here auto-expires
-- or auto-deletes a report. Whether safety reports need a real retention
-- policy (a minimum hold period, a maximum, redaction rules) is a genuine
-- legal question this migration does not answer, flagged here and in
-- PROGRESS.md rather than decided unilaterally.

-- reports: reporter-initiated, immutable once filed (no update policy).
-- connection_id is nullable and ON DELETE SET NULL, a report must survive
-- the connection it was filed from being altered or removed later, the
-- report itself is the durable safety record, not the connection row.
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users (id) on delete cascade,
  reported_id uuid not null references auth.users (id) on delete cascade,
  connection_id uuid references public.connections (id) on delete set null,
  category text not null check (
    category in (
      'fake_identity',
      'harassment',
      'romantic_sexual_misuse',
      'hate',
      'scam',
      'unsafe_meetup',
      'impersonation',
      'other'
    )
  ),
  detail text,
  also_blocked boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.reports enable row level security;

create policy "Reporters can read their own reports"
  on public.reports for select
  using (auth.uid() = reporter_id);

-- No client insert/update/delete policy: reports are written only through
-- file_report() below (SECURITY DEFINER), the same no-client-write
-- convention no_ghost_prompts/meetup_checkins already established in this
-- project, and are never editable once filed, matching "reporting never
-- requires continued contact" (nothing about the flow depends on the
-- report itself being revisited or amended).

-- blocks: unilateral, one row per direction. Bidirectional effect (both
-- people stop seeing each other) is enforced by every consumer checking
-- both directions, not by writing two rows, so "who blocked whom" stays
-- knowable for the blocker's own reference without exposing it to the
-- blocked person (RLS below only ever lets a user read rows where they
-- are the blocker).
create table public.blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references auth.users (id) on delete cascade,
  blocked_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (blocker_id, blocked_id)
);

alter table public.blocks enable row level security;

create policy "Users can read their own blocks"
  on public.blocks for select
  using (auth.uid() = blocker_id);

-- No client insert/delete policy: only block_user() below writes here,
-- same reasoning as reports.

-- Formal 'blocked' connection status, alongside the existing pending/
-- active/passed/inactive/paused. A blocked connection is not just hidden,
-- it is a real, durable status every other status-aware query in this app
-- (capacity counting, messaging RLS, connection creation) now has to
-- account for, the same way 'paused' already was.
alter table public.connections drop constraint connections_status_check;
alter table public.connections add constraint connections_status_check
  check (status is null or status = any (array['pending', 'active', 'passed', 'inactive', 'paused', 'blocked']));

-- block_user: idempotent (unique constraint, on conflict do nothing), and
-- immediately flips any existing connection between the two people to
-- 'blocked'. Deliberately does not require an existing connection, a user
-- can block someone from a profile they have never messaged.
create or replace function public.block_user(p_blocked_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid;
begin
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Not authenticated';
  end if;
  if v_caller = p_blocked_id then
    raise exception 'Cannot block yourself';
  end if;

  insert into public.blocks (blocker_id, blocked_id)
  values (v_caller, p_blocked_id)
  on conflict (blocker_id, blocked_id) do nothing;

  update public.connections
  set status = 'blocked'
  where (user_a_id = v_caller and user_b_id = p_blocked_id)
     or (user_a_id = p_blocked_id and user_b_id = v_caller);
end;
$$;

grant execute on function public.block_user(uuid) to authenticated;

-- file_report: the report row plus, only when the caller explicitly
-- chose it (p_also_block, defaulted false here, the client is the one
-- that pre-selects true for safety-relevant categories per the given
-- product spec, never silently forced), the same block_user() logic in
-- the same call, so "report and block" is one atomic action, not two
-- separate steps the reporter has to remember to also do.
create or replace function public.file_report(
  p_reported_id uuid,
  p_connection_id uuid,
  p_category text,
  p_detail text,
  p_also_block boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid;
  v_report_id uuid;
begin
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Not authenticated';
  end if;
  if v_caller = p_reported_id then
    raise exception 'Cannot report yourself';
  end if;
  if p_category not in (
    'fake_identity', 'harassment', 'romantic_sexual_misuse', 'hate',
    'scam', 'unsafe_meetup', 'impersonation', 'other'
  ) then
    raise exception 'Unknown category: %', p_category;
  end if;
  -- A connection_id, if given, must actually belong to the caller, this
  -- is the same participant check every other connection-scoped RPC in
  -- this project already applies, a report can't be filed attached to
  -- someone else's conversation.
  if p_connection_id is not null and not exists (
    select 1 from public.connections c
    where c.id = p_connection_id
      and (c.user_a_id = v_caller or c.user_b_id = v_caller)
  ) then
    raise exception 'Not your connection';
  end if;

  insert into public.reports (reporter_id, reported_id, connection_id, category, detail, also_blocked)
  values (v_caller, p_reported_id, p_connection_id, p_category, nullif(trim(p_detail), ''), p_also_block)
  returning id into v_report_id;

  if p_also_block then
    perform public.block_user(p_reported_id);
  end if;

  return v_report_id;
end;
$$;

grant execute on function public.file_report(uuid, uuid, text, text, boolean) to authenticated;

-- discovery_profiles, browse_profiles, saved_profiles, and
-- compatible_candidates_for all recreated below with a block exclusion
-- added at the same tier as the existing gender/pause compatibility
-- check, the tightest existing precedent for "a hard, non-negotiable
-- eligibility filter" in this schema. Column lists are unchanged, only
-- the WHERE clause gained a bidirectional NOT EXISTS check.

create or replace view public.discovery_profiles as
SELECT u.id AS user_id,
    u.gender_identity,
    u.matching_preference,
    p.display_name,
    age_band(p.birthdate) AS age_band,
    p.life_transitions,
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
    p.current_situation,
    p.life_transitions_other,
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
    p.communication_style_expression,
    p.communication_style_openness,
        CASE
            WHEN viewer_p.location_lat IS NULL OR viewer_p.location_lng IS NULL OR p.location_lat IS NULL OR p.location_lng IS NULL THEN NULL::double precision
            ELSE 3959::double precision * acos(LEAST(1::double precision, GREATEST('-1'::integer::double precision, sin(radians(viewer_p.location_lat)) * sin(radians(p.location_lat)) + cos(radians(viewer_p.location_lat)) * cos(radians(p.location_lat)) * cos(radians(p.location_lng) - radians(viewer_p.location_lng)))))
        END AS distance_miles
   FROM users u
     JOIN profiles p ON p.user_id = u.id
     JOIN users viewer ON viewer.id = auth.uid()
     JOIN profiles viewer_p ON viewer_p.user_id = viewer.id
  WHERE u.id <> auth.uid()
    AND u.gender_identity = viewer.matching_preference
    AND u.matching_preference = viewer.gender_identity
    AND (u.paused_until IS NULL OR u.paused_until <= now())
    AND NOT EXISTS (
      SELECT 1 FROM public.blocks b
      WHERE (b.blocker_id = auth.uid() AND b.blocked_id = u.id)
         OR (b.blocker_id = u.id AND b.blocked_id = auth.uid())
    )
    AND (viewer_p.location_lat IS NULL OR viewer_p.location_lng IS NULL OR p.location_lat IS NULL OR p.location_lng IS NULL OR (3959::double precision * acos(LEAST(1::double precision, GREATEST('-1'::integer::double precision, sin(radians(viewer_p.location_lat)) * sin(radians(p.location_lat)) + cos(radians(viewer_p.location_lat)) * cos(radians(p.location_lat)) * cos(radians(p.location_lng) - radians(viewer_p.location_lng)))))) <= viewer_p.search_radius_miles::double precision)
    AND (p.birthdate IS NULL OR viewer_p.birthdate IS NULL OR EXTRACT(year FROM age(CURRENT_DATE::timestamp with time zone, p.birthdate::timestamp with time zone))::integer >= viewer_p.min_friend_age AND EXTRACT(year FROM age(CURRENT_DATE::timestamp with time zone, p.birthdate::timestamp with time zone))::integer <= viewer_p.max_friend_age AND EXTRACT(year FROM age(CURRENT_DATE::timestamp with time zone, viewer_p.birthdate::timestamp with time zone))::integer >= p.min_friend_age AND EXTRACT(year FROM age(CURRENT_DATE::timestamp with time zone, viewer_p.birthdate::timestamp with time zone))::integer <= p.max_friend_age);

create or replace view public.browse_profiles as
SELECT u.id AS user_id,
    u.gender_identity,
    u.matching_preference,
    p.display_name,
    age_band(p.birthdate) AS age_band,
    p.life_transitions,
    p.life_transitions_other,
    p.activity_interests,
    p."values",
    p.values_other,
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
    p.current_situation,
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
    p.communication_style_expression,
    p.communication_style_openness,
        CASE
            WHEN viewer_p.location_lat IS NULL OR viewer_p.location_lng IS NULL OR p.location_lat IS NULL OR p.location_lng IS NULL THEN NULL::double precision
            ELSE 3959::double precision * acos(LEAST(1::double precision, GREATEST('-1'::integer::double precision, sin(radians(viewer_p.location_lat)) * sin(radians(p.location_lat)) + cos(radians(viewer_p.location_lat)) * cos(radians(p.location_lat)) * cos(radians(p.location_lng) - radians(viewer_p.location_lng)))))
        END AS distance_miles
   FROM users u
     JOIN profiles p ON p.user_id = u.id
     JOIN users viewer ON viewer.id = auth.uid()
     JOIN profiles viewer_p ON viewer_p.user_id = viewer.id
  WHERE u.id <> auth.uid()
    AND u.gender_identity = viewer.matching_preference
    AND u.matching_preference = viewer.gender_identity
    AND (u.paused_until IS NULL OR u.paused_until <= now())
    AND NOT EXISTS (
      SELECT 1 FROM public.blocks b
      WHERE (b.blocker_id = auth.uid() AND b.blocked_id = u.id)
         OR (b.blocker_id = u.id AND b.blocked_id = auth.uid())
    )
    AND (viewer_p.location_lat IS NULL OR viewer_p.location_lng IS NULL OR p.location_lat IS NULL OR p.location_lng IS NULL OR (3959::double precision * acos(LEAST(1::double precision, GREATEST('-1'::integer::double precision, sin(radians(viewer_p.location_lat)) * sin(radians(p.location_lat)) + cos(radians(viewer_p.location_lat)) * cos(radians(p.location_lat)) * cos(radians(p.location_lng) - radians(viewer_p.location_lng)))))) <= viewer_p.search_radius_miles::double precision)
    AND (p.birthdate IS NULL OR viewer_p.birthdate IS NULL OR EXTRACT(year FROM age(CURRENT_DATE::timestamp with time zone, p.birthdate::timestamp with time zone))::integer >= viewer_p.min_friend_age AND EXTRACT(year FROM age(CURRENT_DATE::timestamp with time zone, p.birthdate::timestamp with time zone))::integer <= viewer_p.max_friend_age AND EXTRACT(year FROM age(CURRENT_DATE::timestamp with time zone, viewer_p.birthdate::timestamp with time zone))::integer >= p.min_friend_age AND EXTRACT(year FROM age(CURRENT_DATE::timestamp with time zone, viewer_p.birthdate::timestamp with time zone))::integer <= p.max_friend_age);

create or replace view public.saved_profiles as
SELECT c.id AS connection_id,
    c.user_b_id AS user_id,
    c.saved_at,
    p.display_name,
    age_band(p.birthdate) AS age_band,
    p.life_transitions,
    p.personal_statement
   FROM connections c
     JOIN users u ON u.id = c.user_b_id
     JOIN profiles p ON p.user_id = c.user_b_id
     JOIN users viewer ON viewer.id = auth.uid()
     JOIN profiles viewer_p ON viewer_p.user_id = viewer.id
  WHERE c.user_a_id = auth.uid()
    AND c.saved = true
    AND u.gender_identity = viewer.matching_preference
    AND u.matching_preference = viewer.gender_identity
    AND NOT EXISTS (
      SELECT 1 FROM public.blocks b
      WHERE (b.blocker_id = auth.uid() AND b.blocked_id = u.id)
         OR (b.blocker_id = u.id AND b.blocked_id = auth.uid())
    )
    AND (p.birthdate IS NULL OR viewer_p.birthdate IS NULL OR EXTRACT(year FROM age(CURRENT_DATE::timestamp with time zone, p.birthdate::timestamp with time zone))::integer >= viewer_p.min_friend_age AND EXTRACT(year FROM age(CURRENT_DATE::timestamp with time zone, p.birthdate::timestamp with time zone))::integer <= viewer_p.max_friend_age AND EXTRACT(year FROM age(CURRENT_DATE::timestamp with time zone, viewer_p.birthdate::timestamp with time zone))::integer >= p.min_friend_age AND EXTRACT(year FROM age(CURRENT_DATE::timestamp with time zone, viewer_p.birthdate::timestamp with time zone))::integer <= p.max_friend_age);

-- prune_ineligible_saves gains the same block clause, matching AGENTS.md's
-- own flagged F14 dependency ("both need a block-status clause added once
-- Fix #13 ships"), this is that fix.
create or replace function public.prune_ineligible_saves()
returns void
language sql
security definer
as $$
  update public.connections c
  set saved = false
  from public.users u, public.users viewer, public.profiles p, public.profiles viewer_p
  where c.saved = true
    and u.id = c.user_b_id
    and viewer.id = c.user_a_id
    and p.user_id = u.id
    and viewer_p.user_id = viewer.id
    and (
      u.gender_identity is distinct from viewer.matching_preference
      or u.matching_preference is distinct from viewer.gender_identity
      or exists (
        select 1 from public.blocks b
        where (b.blocker_id = c.user_a_id and b.blocked_id = c.user_b_id)
           or (b.blocker_id = c.user_b_id and b.blocked_id = c.user_a_id)
      )
      or (
        p.birthdate is not null and viewer_p.birthdate is not null
        and (
          extract(year from age(current_date::timestamptz, p.birthdate::timestamptz))::integer
            not between viewer_p.min_friend_age and viewer_p.max_friend_age
          or extract(year from age(current_date::timestamptz, viewer_p.birthdate::timestamptz))::integer
            not between p.min_friend_age and p.max_friend_age
        )
      )
    );
$$;

-- compatible_candidates_for (the service-role batch match-refresh path)
-- gains the same block exclusion, otherwise a blocked user could still
-- surface in the batch cron's AI match suggestions even though the
-- per-user cache-hit path (discovery_profiles) already excludes them.
create or replace function public.compatible_candidates_for(p_user_id uuid)
returns table(
  user_id uuid, display_name text, age_band text, life_transitions text[],
  activity_interests jsonb, "values" text[], hangout_people_preference text,
  hangout_type_preference text[], meeting_freq text, communication_freq text,
  personal_statement text, current_situation text, languages text[],
  friendship_type text, communication_style_expression text,
  communication_style_openness text, location_city text, location_state text,
  location_country text, distance_miles double precision
)
language sql
stable
security definer
set search_path = public
as $$
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
    p.current_situation,
    p.languages,
    p.friendship_type,
    p.communication_style_expression,
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
    end as distance_miles
  from users u
  join profiles p on p.user_id = u.id
  join users viewer on viewer.id = p_user_id
  join profiles viewer_p on viewer_p.user_id = viewer.id
  where u.id <> p_user_id
    and u.gender_identity = viewer.matching_preference
    and u.matching_preference = viewer.gender_identity
    and (u.paused_until is null or u.paused_until <= now())
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
    );
$$;

-- my_connection_capacity: 'blocked' added to the excluded-status list for
-- both active and pending counts, alongside the existing passed/inactive/
-- paused, so blocking a connection genuinely frees the slot, the same way
-- closing or pausing one already does.
create or replace function public.my_connection_capacity()
returns table(is_premium boolean, active_count integer, active_cap integer, pending_count integer, pending_cap integer)
language sql
stable
as $$
  select
    u.is_premium,
    (
      select count(*)::integer from public.connections c
      where (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
        and (c.status is null or c.status not in ('passed', 'inactive', 'paused', 'blocked'))
        and exists (select 1 from public.messages m where m.connection_id = c.id and m.sender_id = auth.uid())
        and exists (select 1 from public.messages m where m.connection_id = c.id and m.sender_id <> auth.uid())
    ) as active_count,
    case when u.is_premium then 8 else 4 end as active_cap,
    (
      select count(*)::integer from public.connections c
      where (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
        and (c.status is null or c.status not in ('passed', 'inactive', 'paused', 'blocked'))
        and exists (select 1 from public.messages m where m.connection_id = c.id and m.sender_id = auth.uid())
        and not exists (select 1 from public.messages m where m.connection_id = c.id and m.sender_id <> auth.uid())
    ) as pending_count,
    case when u.is_premium then 8 else 5 end as pending_cap
  from public.users u
  where u.id = auth.uid();
$$;

-- create_connection_with_capacity_check: two changes.
-- (1) A real bug caught while building this, not part of the original
-- ask: the existing-connection branch unconditionally reset any non-
-- 'active' status back to 'pending' on reuse, which would have silently
-- un-blocked a blocked connection the moment either party's client next
-- called this function (e.g. the blocked person revisiting the other's
-- profile and tapping Say hello). Now raises instead, blocking a genuinely
-- new connection is refused the same as reusing a blocked one.
-- (2) A brand-new pair with no existing connection row is also checked,
-- both directions, before any insert.
create or replace function public.create_connection_with_capacity_check(p_other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid;
  v_existing_id uuid;
  v_existing_status text;
  v_is_premium boolean;
  v_active_cap integer;
  v_pending_cap integer;
  v_active_count integer;
  v_pending_count integer;
  v_new_id uuid;
begin
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Not authenticated';
  end if;
  if v_caller = p_other_user_id then
    raise exception 'Cannot connect to yourself';
  end if;

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
  limit 1;

  if v_existing_id is not null then
    if v_existing_status = 'blocked' then
      raise exception 'blocked';
    end if;
    if v_existing_status is distinct from 'active' then
      update public.connections set status = 'pending' where id = v_existing_id;
    end if;
    return v_existing_id;
  end if;

  select coalesce(is_premium, false) into v_is_premium from public.users where id = v_caller;
  v_active_cap := case when v_is_premium then 8 else 4 end;
  v_pending_cap := case when v_is_premium then 8 else 5 end;

  -- Active: real bidirectional message exchange on a connection that
  -- isn't in a terminal or frozen state. 'inactive' is this app's only
  -- real "closed" state today (Graduation doesn't exist yet, confirmed,
  -- its status value must be added here once it does).
  select count(*) into v_active_count
  from public.connections c
  where (c.user_a_id = v_caller or c.user_b_id = v_caller)
    and (c.status is null or c.status not in ('passed', 'inactive', 'paused', 'blocked'))
    and exists (select 1 from public.messages m where m.connection_id = c.id and m.sender_id = v_caller)
    and exists (select 1 from public.messages m where m.connection_id = c.id and m.sender_id <> v_caller);

  -- Pending: the caller has sent at least one message and the other
  -- participant has sent none yet, "sent, awaiting reply" per the given
  -- spec, an incoming unanswered Say Hi from someone else never counts
  -- against the recipient's own pending-sent cap.
  select count(*) into v_pending_count
  from public.connections c
  where (c.user_a_id = v_caller or c.user_b_id = v_caller)
    and (c.status is null or c.status not in ('passed', 'inactive', 'paused', 'blocked'))
    and exists (select 1 from public.messages m where m.connection_id = c.id and m.sender_id = v_caller)
    and not exists (select 1 from public.messages m where m.connection_id = c.id and m.sender_id <> v_caller);

  if v_active_count >= v_active_cap then
    raise exception 'active_cap_reached';
  end if;
  if v_pending_count >= v_pending_cap then
    raise exception 'pending_cap_reached';
  end if;

  insert into public.connections (user_a_id, user_b_id, status)
  values (v_caller, p_other_user_id, 'pending')
  returning id into v_new_id;

  return v_new_id;
end;
$$;

-- Messages INSERT RLS: a block-status check added at the database layer,
-- not just hidden client-side. Sending is refused once a connection is
-- 'blocked', in either direction, defense in depth the same way this
-- project already prefers RLS/view-level enforcement over trusting a
-- client not to call an API it technically still could.
drop policy "Participants can send messages in their connection" on public.messages;
create policy "Participants can send messages in their connection"
  on public.messages for insert
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.connections c
      where c.id = messages.connection_id
        and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
        and (c.status is distinct from 'blocked')
    )
  );
