-- Onboarding and safety round (2026-10-04). Decisions: docs/DECISIONS.md
-- sections 1-3. Apply after 20261003000000 and 20261003000001.
--
-- What this does, in order:
--   A. Identity: multi-select "who you'd like to meet" (meet_genders),
--      mutual match helper, retire the "who can message first" step.
--   B. Profile: life-transition visibility switch, extra photos, data
--      remaps for merged options (life transitions, values, activities,
--      hangout types).
--   C. Safety columns on users (selfie verified, admin, suspended) and a
--      guard so a client can never set them on its own row.
--   D. Mutual "Interested" gate (interests table, express_interest RPC).
--   E. Selfie check (selfie_checks table, private storage bucket).
--   F. Ghosting rule (ghosting_events, recorded at the 7-day auto-close).
--   G. Discovery views and the batch candidate function rewritten for
--      all of the above.
--   H. Messages first-message gate: mutual interest + verified + not
--      suspended.
--   I. Dev helpers, seed accounts only.

-- ---------------------------------------------------------------------
-- A. Identity
-- ---------------------------------------------------------------------

alter table public.users add column if not exists meet_genders text[];

alter table public.users drop constraint if exists users_meet_genders_check;
alter table public.users add constraint users_meet_genders_check check (
  meet_genders is null
  or (cardinality(meet_genders) >= 1
      and meet_genders <@ array['woman', 'man', 'non_binary', 'everyone']::text[])
);

-- Backfill from the old single-choice matching_preference. The retired
-- 'transgender' and 'queer' preferences map to 'everyone' (the closest
-- non-exclusionary reading). gender_identity keeps its old constraint so
-- legacy values stay valid, but the app now only offers woman / man /
-- non_binary; an account with a legacy value only matches people who
-- chose 'everyone' until it picks again in Identity.
update public.users
set meet_genders = case matching_preference
    when 'woman' then array['woman']
    when 'man' then array['man']
    when 'non_binary' then array['non_binary']
    when 'transgender' then array['everyone']
    when 'queer' then array['everyone']
    else null
  end
where meet_genders is null and matching_preference is not null;

-- Mutual: each person's gender must be in the other's meet list (or the
-- other chose 'everyone').
create or replace function public.genders_match(
  p_a_gender text, p_a_meet text[], p_b_gender text, p_b_meet text[]
) returns boolean
language sql
immutable
as $$
  select coalesce(
    p_a_meet is not null and p_b_meet is not null
    and ('everyone' = any(p_a_meet) or p_b_gender = any(p_a_meet))
    and ('everyone' = any(p_b_meet) or p_a_gender = any(p_b_meet)),
    false
  );
$$;

-- "Who can message you first" is retired: the mutual Interested gate
-- (section D) replaces it. Everyone becomes 'anyone' so the old
-- first_message_allowed_by_preference check is always true.
update public.users set messaging_preference = 'anyone'
where messaging_preference is distinct from 'anyone';

-- ---------------------------------------------------------------------
-- B. Profile
-- ---------------------------------------------------------------------

alter table public.profiles add column if not exists show_life_transitions boolean not null default true;
alter table public.profiles add column if not exists extra_photo_urls text[] not null default '{}';
alter table public.profiles drop constraint if exists profiles_extra_photo_urls_check;
alter table public.profiles add constraint profiles_extra_photo_urls_check
  check (cardinality(extra_photo_urls) <= 2);

-- Life transitions: two options merged into one.
update public.profiles
set life_transitions = (
  select array_agg(distinct t order by t)
  from unnest(life_transitions) as t0(raw)
  cross join lateral (
    select case
      when raw in ('Divorce or separation', 'Starting over after a long relationship')
        then 'Divorce, separation, or the end of a long relationship'
      else raw
    end as t
  ) m
)
where life_transitions && array['Divorce or separation', 'Starting over after a long relationship']::text[];

-- Values: 10 near-duplicates removed.
update public.profiles
set "values" = array(
  select v from unnest("values") as v
  where v not in ('Authenticity', 'Security', 'Compassion', 'Generosity', 'Connection',
                  'Wisdom', 'Openness', 'Playfulness', 'Resilience', 'Patience')
)
where "values" && array['Authenticity', 'Security', 'Compassion', 'Generosity', 'Connection',
                        'Wisdom', 'Openness', 'Playfulness', 'Resilience', 'Patience']::text[];

-- Hangout types: two renamed.
update public.profiles
set hangout_type_preference = array(
  select case v
    when 'Co-working style' then 'Side by side (working, reading)'
    when 'Homebody' then 'Low-key at home'
    else v end
  from unnest(hangout_type_preference) as v
)
where hangout_type_preference && array['Co-working style', 'Homebody']::text[];

-- Activities: 40 categories become 32. Category keys are remapped and
-- de-duplicated; follow-up details of merged categories are combined
-- under the new key (later keys win on a field-name clash; old field
-- names the new questions don't ask still display as plain values).
create or replace function public._remap_activity_key(p_key text) returns text
language sql immutable as $$
  select case p_key
    when 'live_music' then 'live_shows'
    when 'theater_performing_arts' then 'live_shows'
    when 'comedy_live_shows' then 'live_shows'
    when 'yoga_pilates' then 'yoga_wellness'
    when 'wellness_mindfulness' then 'yoga_wellness'
    when 'nightlife' then 'drinks_nightlife'
    when 'wine_cocktails_beer' then 'drinks_nightlife'
    when 'cooking' then 'cooking_grilling'
    when 'bbq_grilling' then 'cooking_grilling'
    when 'reading' then 'reading_podcasts'
    when 'podcasts_audiobooks' then 'reading_podcasts'
    when 'history_learning' then 'learning_growth'
    when 'self_improvement' then 'learning_growth'
    when 'volunteering' then 'volunteering_causes'
    when 'environmental_activism' then 'volunteering_causes'
    when 'arts_culture' then 'museums_galleries'
    else p_key
  end;
$$;

update public.profiles p
set activity_interests = jsonb_strip_nulls(jsonb_build_object(
  'categories', (
    select coalesce(jsonb_agg(k order by first_pos), '[]'::jsonb)
    from (
      select public._remap_activity_key(c) as k, min(ord) as first_pos
      from jsonb_array_elements_text(coalesce(p.activity_interests->'categories', '[]'::jsonb))
        with ordinality as e(c, ord)
      group by 1
    ) cats
  ),
  'details', (
    -- every old detail object that maps to the same new key is merged
    select coalesce(jsonb_object_agg(nk, merged), '{}'::jsonb)
    from (
      select dd.nk, jsonb_object_agg(f.key, f.value) as merged
      from (
        select public._remap_activity_key(d.key) as nk, d.value as dv
        from jsonb_each(coalesce(p.activity_interests->'details', '{}'::jsonb)) d
        where jsonb_typeof(d.value) = 'object'
      ) dd
      cross join lateral jsonb_each(dd.dv) f
      group by dd.nk
    ) det
  ),
  'other', p.activity_interests->'other'
))
where p.activity_interests is not null;

drop function public._remap_activity_key(text);

-- ---------------------------------------------------------------------
-- C. Safety columns on users, protected from client writes
-- ---------------------------------------------------------------------

alter table public.users add column if not exists selfie_verified_at timestamptz;
alter table public.users add column if not exists is_admin boolean not null default false;
alter table public.users add column if not exists suspended_at timestamptz;

-- users has self-row INSERT/UPDATE RLS, so without this a signed-in
-- person could mark their own account verified or admin. Only
-- SECURITY DEFINER functions (current_user = owner), the service role,
-- and the dashboard can change these three columns.
create or replace function public.protect_user_safety_columns()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.selfie_verified_at := null;
      new.is_admin := false;
      new.suspended_at := null;
    else
      new.selfie_verified_at := old.selfie_verified_at;
      new.is_admin := old.is_admin;
      new.suspended_at := old.suspended_at;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists users_protect_safety_columns on public.users;
create trigger users_protect_safety_columns
  before insert or update on public.users
  for each row execute function public.protect_user_safety_columns();

create or replace function public.is_user_active(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (select 1 from public.users where id = p_user_id and suspended_at is null);
$$;

-- ---------------------------------------------------------------------
-- D. Mutual "Interested" gate
-- ---------------------------------------------------------------------

create table if not exists public.interests (
  from_user_id uuid not null references auth.users (id) on delete cascade,
  to_user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (from_user_id, to_user_id),
  check (from_user_id <> to_user_id)
);

alter table public.interests enable row level security;
-- You can see only your own outgoing interest. Nobody can ever see that
-- someone else is interested in them (one-sided interest stays private).
drop policy if exists "Own outgoing interests" on public.interests;
create policy "Own outgoing interests" on public.interests
  for select using (auth.uid() = from_user_id);

create or replace function public.mutual_interest_exists(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (select 1 from public.interests where from_user_id = p_a and to_user_id = p_b)
     and exists (select 1 from public.interests where from_user_id = p_b and to_user_id = p_a);
$$;

create or replace function public.connection_has_mutual_interest(p_connection_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce((
    select public.mutual_interest_exists(c.user_a_id, c.user_b_id)
    from public.connections c where c.id = p_connection_id
  ), false);
$$;

-- Records the caller's interest. Returns {mutual: false} until the other
-- person says Interested too, then opens the connection (same capacity
-- rules as before) and returns {mutual: true, connection_id}.
-- Errors: not_verified, suspended, blocked, unavailable, plus the
-- capacity errors from create_connection_with_capacity_check.
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

  if not exists (select 1 from public.users where id = v_caller and selfie_verified_at is not null) then
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

  insert into public.interests (from_user_id, to_user_id)
  values (v_caller, p_other_user_id)
  on conflict do nothing;

  if not exists (select 1 from public.interests where from_user_id = p_other_user_id and to_user_id = v_caller) then
    return jsonb_build_object('mutual', false);
  end if;

  v_connection_id := public.create_connection_with_capacity_check(p_other_user_id);
  return jsonb_build_object('mutual', true, 'connection_id', v_connection_id);
end;
$$;

grant execute on function public.express_interest(uuid) to authenticated;

create or replace function public.withdraw_interest(p_other_user_id uuid)
returns void
language sql
security definer
set search_path to 'public'
as $$
  delete from public.interests where from_user_id = auth.uid() and to_user_id = p_other_user_id;
$$;

grant execute on function public.withdraw_interest(uuid) to authenticated;

-- Mutually-interested connections with no message yet, so Inbox can show
-- "You both chose to connect" (inbox_conversations only lists
-- conversations that already have a message).
create or replace view public.new_mutual_connections as
select
  c.id as connection_id,
  case when c.user_a_id = auth.uid() then c.user_b_id else c.user_a_id end as other_user_id,
  p.display_name,
  p.photo_url,
  c.created_at
from public.connections c
join public.profiles p
  on p.user_id = case when c.user_a_id = auth.uid() then c.user_b_id else c.user_a_id end
where (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
  and (c.status is null or c.status not in ('blocked', 'ended', 'passed', 'inactive'))
  and not exists (select 1 from public.messages m where m.connection_id = c.id)
  and public.mutual_interest_exists(c.user_a_id, c.user_b_id);

grant select on public.new_mutual_connections to authenticated;

-- ---------------------------------------------------------------------
-- E. Selfie check (manual review, option A)
-- ---------------------------------------------------------------------

create table if not exists public.selfie_checks (
  user_id uuid primary key references auth.users (id) on delete cascade,
  pose text not null,
  storage_path text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  consent_at timestamptz not null,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz
);

alter table public.selfie_checks enable row level security;
drop policy if exists "Own selfie check" on public.selfie_checks;
create policy "Own selfie check" on public.selfie_checks
  for select using (auth.uid() = user_id);

create or replace function public.submit_selfie_check(p_pose text, p_storage_path text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if p_storage_path is null or split_part(p_storage_path, '/', 1) <> v_caller::text then
    raise exception 'invalid_path';
  end if;
  insert into public.selfie_checks (user_id, pose, storage_path, status, consent_at, submitted_at, reviewed_at)
  values (v_caller, p_pose, p_storage_path, 'pending', now(), now(), null)
  on conflict (user_id) do update
    set pose = excluded.pose,
        storage_path = excluded.storage_path,
        status = 'pending',
        consent_at = excluded.consent_at,
        submitted_at = excluded.submitted_at,
        reviewed_at = null;
end;
$$;

grant execute on function public.submit_selfie_check(text, text) to authenticated;

-- Private bucket. People upload into a folder named after their own user
-- id. Nobody can read selfies back through the API; the selfie-review
-- edge function (service role) reads them for review and deletes them.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('selfie-checks', 'selfie-checks', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do nothing;

drop policy if exists "Upload own selfie check" on storage.objects;
create policy "Upload own selfie check" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'selfie-checks' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------
-- F. Ghosting rule
-- ---------------------------------------------------------------------

create table if not exists public.ghosting_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  connection_id uuid references public.connections (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists ghosting_events_user_idx on public.ghosting_events (user_id, created_at desc);
alter table public.ghosting_events enable row level security;
-- No client policies at all: never shown, never readable.

-- 2+ silent auto-closes within 60 days puts someone last in suggestions
-- until 30 days after their most recent one.
create or replace function public.is_ghosting_penalized(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select (select count(*) from public.ghosting_events
          where user_id = p_user_id and created_at >= now() - interval '60 days') >= 2
     and exists (select 1 from public.ghosting_events
                 where user_id = p_user_id and created_at >= now() - interval '30 days');
$$;

revoke all on function public.is_ghosting_penalized(uuid) from public, anon, authenticated;

-- Same evaluator as 20260901000000, plus one line: at the 7-day
-- auto-close, record a ghosting event for the person who never replied.
create or replace function public.run_no_ghost_check_v2(p_connection_id uuid, p_now timestamptz default now())
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_status text;
  v_last record;
  v_sender uuid;
  v_recipient uuid;
  v_elapsed interval;
  v_fired text := 'none';
begin
  select status into v_status from public.connections where id = p_connection_id;
  if not found or not public.is_connection_automation_eligible(v_status) then
    return 'connection_not_eligible';
  end if;

  select m.sender_id, m.created_at into v_last
  from public.messages m where m.connection_id = p_connection_id
  order by m.created_at desc, m.id desc limit 1;
  if not found then return 'no_messages'; end if;

  v_sender := v_last.sender_id;
  select case when c.user_a_id = v_sender then c.user_b_id else c.user_a_id end
  into v_recipient from public.connections c where c.id = p_connection_id;

  v_elapsed := p_now - v_last.created_at;

  if v_elapsed >= interval '24 hours' then
    perform public.raise_intervention(p_connection_id, 'no_ghost_r1', v_recipient, '{}'::jsonb);
    v_fired := 'r1';
  end if;
  if v_elapsed >= interval '72 hours' then
    perform public.raise_intervention(p_connection_id, 'no_ghost_r2', v_recipient, '{}'::jsonb);
    v_fired := 'r2';
  end if;
  if v_elapsed >= interval '120 hours' then
    perform public.raise_intervention(p_connection_id, 'no_ghost_r3', v_recipient, '{}'::jsonb);
    v_fired := 'r3';
  end if;
  if v_elapsed >= interval '125 hours' then
    perform public.raise_intervention(p_connection_id, 'no_ghost_s1', v_sender, '{}'::jsonb);
    v_fired := 's1';
  end if;
  if v_elapsed >= interval '168 hours' and v_status is distinct from 'inactive' then
    update public.connections set status = 'inactive' where id = p_connection_id;
    perform public.record_friendship_event(p_connection_id, 'conversation_became_inactive', null, '{}'::jsonb);
    insert into public.ghosting_events (user_id, connection_id, created_at)
    values (v_recipient, p_connection_id, p_now);
    v_fired := 'auto_closed';
  end if;

  return v_fired;
end;
$$;

-- ---------------------------------------------------------------------
-- G. Discovery views and batch candidate function
-- ---------------------------------------------------------------------
-- CREATE OR REPLACE keeps every existing column in place (same names and
-- order) and appends new ones at the end. Changes: the gender check uses
-- meet_genders via genders_match(), suspended accounts are hidden, and
-- life_transitions comes back empty when the person hid it.

create or replace view public.discovery_profiles as
 SELECT u.id AS user_id,
    u.gender_identity,
    u.matching_preference,
    p.display_name,
    age_band(p.birthdate) AS age_band,
    CASE WHEN p.show_life_transitions THEN p.life_transitions ELSE '{}'::text[] END AS life_transitions,
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
    CASE WHEN p.show_life_transitions THEN p.life_transitions_other ELSE NULL END AS life_transitions_other,
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
        CASE
            WHEN viewer_p.location_lat IS NULL OR viewer_p.location_lng IS NULL OR p.location_lat IS NULL OR p.location_lng IS NULL THEN NULL::double precision
            ELSE 3959::double precision * acos(LEAST(1::double precision, GREATEST('-1'::integer::double precision, sin(radians(viewer_p.location_lat)) * sin(radians(p.location_lat)) + cos(radians(viewer_p.location_lat)) * cos(radians(p.location_lat)) * cos(radians(p.location_lng) - radians(viewer_p.location_lng)))))
        END AS distance_miles,
    p.availability,
    p.communication_modes,
    p.extra_photo_urls,
    (u.selfie_verified_at IS NOT NULL) AS selfie_verified,
    u.social_linked
   FROM users u
     JOIN profiles p ON p.user_id = u.id
     JOIN users viewer ON viewer.id = auth.uid()
     JOIN profiles viewer_p ON viewer_p.user_id = viewer.id
  WHERE u.id <> auth.uid()
    AND genders_match(viewer.gender_identity, viewer.meet_genders, u.gender_identity, u.meet_genders)
    AND (u.paused_until IS NULL OR u.paused_until <= now())
    AND u.suspended_at IS NULL
    AND p.photo_url IS NOT NULL
    AND NOT (EXISTS ( SELECT 1 FROM blocks b
          WHERE b.blocker_id = auth.uid() AND b.blocked_id = u.id OR b.blocker_id = u.id AND b.blocked_id = auth.uid()))
    AND (viewer_p.location_lat IS NULL OR viewer_p.location_lng IS NULL OR p.location_lat IS NULL OR p.location_lng IS NULL OR (3959::double precision * acos(LEAST(1::double precision, GREATEST('-1'::integer::double precision, sin(radians(viewer_p.location_lat)) * sin(radians(p.location_lat)) + cos(radians(viewer_p.location_lat)) * cos(radians(p.location_lat)) * cos(radians(p.location_lng) - radians(viewer_p.location_lng)))))) <= viewer_p.search_radius_miles::double precision)
    AND (p.birthdate IS NULL OR viewer_p.birthdate IS NULL OR EXTRACT(year FROM age(CURRENT_DATE::timestamp with time zone, p.birthdate::timestamp with time zone))::integer >= viewer_p.min_friend_age AND EXTRACT(year FROM age(CURRENT_DATE::timestamp with time zone, p.birthdate::timestamp with time zone))::integer <= viewer_p.max_friend_age AND EXTRACT(year FROM age(CURRENT_DATE::timestamp with time zone, viewer_p.birthdate::timestamp with time zone))::integer >= p.min_friend_age AND EXTRACT(year FROM age(CURRENT_DATE::timestamp with time zone, viewer_p.birthdate::timestamp with time zone))::integer <= p.max_friend_age);

create or replace view public.browse_profiles as
 SELECT u.id AS user_id,
    u.gender_identity,
    u.matching_preference,
    p.display_name,
    age_band(p.birthdate) AS age_band,
    CASE WHEN p.show_life_transitions THEN p.life_transitions ELSE '{}'::text[] END AS life_transitions,
    CASE WHEN p.show_life_transitions THEN p.life_transitions_other ELSE NULL END AS life_transitions_other,
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
        CASE
            WHEN viewer_p.location_lat IS NULL OR viewer_p.location_lng IS NULL OR p.location_lat IS NULL OR p.location_lng IS NULL THEN NULL::double precision
            ELSE 3959::double precision * acos(LEAST(1::double precision, GREATEST('-1'::integer::double precision, sin(radians(viewer_p.location_lat)) * sin(radians(p.location_lat)) + cos(radians(viewer_p.location_lat)) * cos(radians(p.location_lat)) * cos(radians(p.location_lng) - radians(viewer_p.location_lng)))))
        END AS distance_miles,
    p.availability,
    p.communication_modes
   FROM users u
     JOIN profiles p ON p.user_id = u.id
     JOIN users viewer ON viewer.id = auth.uid()
     JOIN profiles viewer_p ON viewer_p.user_id = viewer.id
  WHERE u.id <> auth.uid()
    AND genders_match(viewer.gender_identity, viewer.meet_genders, u.gender_identity, u.meet_genders)
    AND (u.paused_until IS NULL OR u.paused_until <= now())
    AND u.suspended_at IS NULL
    AND p.photo_url IS NOT NULL
    AND NOT (EXISTS ( SELECT 1 FROM blocks b
          WHERE b.blocker_id = auth.uid() AND b.blocked_id = u.id OR b.blocker_id = u.id AND b.blocked_id = auth.uid()))
    AND (viewer_p.location_lat IS NULL OR viewer_p.location_lng IS NULL OR p.location_lat IS NULL OR p.location_lng IS NULL OR (3959::double precision * acos(LEAST(1::double precision, GREATEST('-1'::integer::double precision, sin(radians(viewer_p.location_lat)) * sin(radians(p.location_lat)) + cos(radians(viewer_p.location_lat)) * cos(radians(p.location_lat)) * cos(radians(p.location_lng) - radians(viewer_p.location_lng)))))) <= viewer_p.search_radius_miles::double precision)
    AND (p.birthdate IS NULL OR viewer_p.birthdate IS NULL OR EXTRACT(year FROM age(CURRENT_DATE::timestamp with time zone, p.birthdate::timestamp with time zone))::integer >= viewer_p.min_friend_age AND EXTRACT(year FROM age(CURRENT_DATE::timestamp with time zone, p.birthdate::timestamp with time zone))::integer <= viewer_p.max_friend_age AND EXTRACT(year FROM age(CURRENT_DATE::timestamp with time zone, viewer_p.birthdate::timestamp with time zone))::integer >= p.min_friend_age AND EXTRACT(year FROM age(CURRENT_DATE::timestamp with time zone, viewer_p.birthdate::timestamp with time zone))::integer <= p.max_friend_age);

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
    AND genders_match(viewer.gender_identity, viewer.meet_genders, u.gender_identity, u.meet_genders)
    AND u.suspended_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.blocks b
      WHERE (b.blocker_id = auth.uid() AND b.blocked_id = u.id)
         OR (b.blocker_id = u.id AND b.blocked_id = auth.uid())
    )
    AND (p.birthdate IS NULL OR viewer_p.birthdate IS NULL OR EXTRACT(year FROM age(CURRENT_DATE::timestamp with time zone, p.birthdate::timestamp with time zone))::integer >= viewer_p.min_friend_age AND EXTRACT(year FROM age(CURRENT_DATE::timestamp with time zone, p.birthdate::timestamp with time zone))::integer <= viewer_p.max_friend_age AND EXTRACT(year FROM age(CURRENT_DATE::timestamp with time zone, viewer_p.birthdate::timestamp with time zone))::integer >= p.min_friend_age AND EXTRACT(year FROM age(CURRENT_DATE::timestamp with time zone, viewer_p.birthdate::timestamp with time zone))::integer <= p.max_friend_age);

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
      not public.genders_match(viewer.gender_identity, viewer.meet_genders, u.gender_identity, u.meet_genders)
      or u.suspended_at is not null
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

create or replace view public.my_public_preview as
select
  u.id as user_id,
  p.display_name,
  age_band(p.birthdate) as age_band,
  p.location_city,
  p.location_state,
  case when p.show_life_transitions then p.life_transitions else '{}'::text[] end as life_transitions,
  case when p.show_life_transitions then p.life_transitions_other else null end as life_transitions_other,
  p.values,
  p.values_other,
  p.activity_interests,
  p.hangout_people_preference,
  p.hangout_type_preference,
  p.communication_freq,
  p.meeting_freq,
  p.response_time,
  p.friendship_type,
  p.communication_style_openness,
  p.availability,
  p.communication_modes,
  p.languages,
  p.languages_other,
  p.ethnicity,
  p.ethnicity_other,
  p.personal_statement,
  p.bar_preference,
  p.dealbreakers,
  p.personality_16p,
  p.photo_url,
  p.extra_photo_urls,
  (u.selfie_verified_at is not null) as selfie_verified,
  u.social_linked
from users u
join profiles p on p.user_id = u.id
where u.id = auth.uid();

-- Batch candidate function: return shape changes, so drop and recreate.
-- Returns the RAW life_transitions (scoring still counts hidden ones)
-- plus show_life_transitions so the caller can keep hidden ones out of
-- any text, and two ordering signals. Service role only: it was
-- callable by any signed-in user before (Supabase grants EXECUTE on new
-- functions by default), which let anyone read another person's pool.
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
  ghosting_penalized boolean
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
    exists (select 1 from public.interests i where i.from_user_id = u.id and i.to_user_id = p_user_id) as interested_in_viewer,
    public.is_ghosting_penalized(u.id) as ghosting_penalized
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
    );
$function$;

revoke all on function public.compatible_candidates_for(uuid) from public, anon, authenticated;
grant execute on function public.compatible_candidates_for(uuid) to service_role;

-- ---------------------------------------------------------------------
-- H. Messages: first message needs mutual interest + a verified sender;
-- any message needs a non-suspended sender.
-- ---------------------------------------------------------------------

drop policy if exists "Participants can send messages in their connection" on public.messages;
create policy "Participants can send messages in their connection"
  on public.messages for insert
  with check (
    sender_id = auth.uid()
    and public.is_user_active(auth.uid())
    and exists (
      select 1 from public.connections c
      where c.id = messages.connection_id
        and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
        and c.status is distinct from 'blocked'
        and c.status is distinct from 'inactive'
        and c.status is distinct from 'ended'
    )
    and (
      connection_has_any_message(connection_id)
      or (
        exists (select 1 from public.profiles pr where pr.user_id = auth.uid() and pr.photo_url is not null)
        and exists (select 1 from public.users us where us.id = auth.uid() and us.selfie_verified_at is not null)
        and public.connection_has_mutual_interest(connection_id)
      )
    )
  );

-- Suspended accounts cannot open new connections either.
create or replace function public.create_connection_with_capacity_check(p_other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid;
  v_existing_id uuid;
  v_existing_status text;
  v_active_cap integer := 3;
  v_pending_cap integer := 5;
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
  if not public.is_user_active(v_caller) then
    raise exception 'suspended';
  end if;
  if not public.is_user_active(p_other_user_id) then
    raise exception 'unavailable';
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
    if v_existing_status = 'ended' then
      raise exception 'ended';
    end if;
    if v_existing_status is distinct from 'active' then
      update public.connections set status = 'pending' where id = v_existing_id;
    end if;
    return v_existing_id;
  end if;

  select count(*) into v_active_count
  from public.connections c
  where (c.user_a_id = v_caller or c.user_b_id = v_caller)
    and (c.status is null or c.status not in ('passed', 'inactive', 'paused', 'blocked', 'ended', 'graduated'))
    and exists (select 1 from public.messages m where m.connection_id = c.id and m.sender_id = v_caller)
    and exists (select 1 from public.messages m where m.connection_id = c.id and m.sender_id <> v_caller);

  select count(*) into v_pending_count
  from public.connections c
  where (c.user_a_id = v_caller or c.user_b_id = v_caller)
    and (c.status is null or c.status not in ('passed', 'inactive', 'paused', 'blocked', 'ended', 'graduated'))
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

-- ---------------------------------------------------------------------
-- I. Dev helpers, seed accounts only (refuse any real account)
-- ---------------------------------------------------------------------

create or replace function public._is_seed_account(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.users
    where id = p_user_id
      and ltrim(coalesce(phone, ''), '+') in (
        '15555500101', '15555500102', '15555500103', '15555500104', '15555500105',
        '15555500106', '15555500107', '15555500108', '15555500109'
      )
  );
$$;

-- Marks the caller's own seed account selfie-verified (skips review).
create or replace function public.dev_mark_selfie_verified(p_verified boolean default true)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public._is_seed_account(auth.uid()) then
    raise exception 'Seed accounts only';
  end if;
  update public.users
  set selfie_verified_at = case when p_verified then now() else null end
  where id = auth.uid();
end;
$$;

grant execute on function public.dev_mark_selfie_verified(boolean) to authenticated;

-- Records Interested in both directions for a connection the caller is in,
-- so a seed thread can be tested without signing in as both people.
create or replace function public.dev_force_mutual_interest(p_connection_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_a uuid;
  v_b uuid;
begin
  select user_a_id, user_b_id into v_a, v_b from public.connections where id = p_connection_id;
  if v_a is null then raise exception 'Connection not found'; end if;
  if auth.uid() not in (v_a, v_b) then raise exception 'Not a participant'; end if;
  if not (public._is_seed_account(v_a) and public._is_seed_account(v_b)) then
    raise exception 'Seed accounts only';
  end if;
  insert into public.interests (from_user_id, to_user_id) values (v_a, v_b) on conflict do nothing;
  insert into public.interests (from_user_id, to_user_id) values (v_b, v_a) on conflict do nothing;
end;
$$;

grant execute on function public.dev_force_mutual_interest(uuid) to authenticated;

-- Dev resets also clear Interested, so a reset account starts clean
-- (interests reference users, not connections, so deleting connections
-- alone would leave old interest behind and instantly re-open chats).
create or replace function public.dev_reset_my_matches()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  delete from public.connections where user_a_id = auth.uid() or user_b_id = auth.uid();
  delete from public.match_suggestions where user_id = auth.uid();
  delete from public.interests where from_user_id = auth.uid() or to_user_id = auth.uid();
end;
$$;

grant execute on function public.dev_reset_my_matches() to authenticated;

create or replace function public.dev_clear_seed_interests()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_count integer;
begin
  if not public._is_seed_account(auth.uid()) then
    raise exception 'Seed accounts only';
  end if;
  delete from public.interests
  where public._is_seed_account(from_user_id) or public._is_seed_account(to_user_id);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.dev_clear_seed_interests() to authenticated;
