-- 2026-10-26: Rebuild stage 2, Joining (docs/context/05_LIMEN_REBUILD.md,
-- "Joining (decided)"). Safe to run twice. limen_db_version() -> 20261026000001.
--
--   1. joining_answers: one private row per person with
--      - hardest: "What's hardest about friendship for you right now?"
--        (any number of fixed keys) and hardest_other (their own words),
--      - goals: "Here's where Limen can help" (fixed keys),
--      - when each joining step was finished (to pick up where they left off),
--      - meet_offer_hidden_at: "Not now" on the Your circle card that offers
--        the profile.
--      Only the person can read or change it. Never used for matching,
--      never shown to anyone else.
--   2. Someone who didn't choose "Meet someone new" is never suggested to
--      anyone (compatible_candidates_for). People with no row (everyone who
--      joined before this) count as having chosen it.

-- 1. Private answers -----------------------------------------------------------
create table if not exists public.joining_answers (
  user_id uuid primary key references public.users(id) on delete cascade,
  hardest text[] not null default '{}',
  hardest_other text,
  goals text[],
  hardest_at timestamptz,
  friends_at timestamptz,
  goals_at timestamptz,
  meet_offer_hidden_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.joining_answers drop constraint if exists joining_answers_hardest_keys;
alter table public.joining_answers add constraint joining_answers_hardest_keys check (
  hardest <@ array['meeting_new', 'keeping_in_touch', 'plans_happen', 'friendly_to_real', 'reconnecting',
                   'always_reaching_out', 'not_sure_wanted', 'dont_know_me', 'finding_time', 'other']::text[]);
alter table public.joining_answers drop constraint if exists joining_answers_goals_keys;
alter table public.joining_answers add constraint joining_answers_goals_keys check (
  goals is null or goals <@ array['keep_in_touch', 'reconnect', 'meet_new', 'plans', 'patterns']::text[]);
alter table public.joining_answers drop constraint if exists joining_answers_other_length;
alter table public.joining_answers add constraint joining_answers_other_length check (
  hardest_other is null or char_length(hardest_other) <= 300);

alter table public.joining_answers enable row level security;
drop policy if exists "Joining answers: own read" on public.joining_answers;
create policy "Joining answers: own read" on public.joining_answers
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "Joining answers: own add" on public.joining_answers;
create policy "Joining answers: own add" on public.joining_answers
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "Joining answers: own change" on public.joining_answers;
create policy "Joining answers: own change" on public.joining_answers
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "Joining answers: own remove" on public.joining_answers;
create policy "Joining answers: own remove" on public.joining_answers
  for delete to authenticated using (user_id = auth.uid());
revoke all on public.joining_answers from anon;
grant select, insert, update, delete on public.joining_answers to authenticated;

-- Did this person choose "Meet someone new"? No row = joined before stage 2 = yes.
create or replace function public.wants_to_meet_new(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    (select j.goals is null or 'meet_new' = any(j.goals) from public.joining_answers j where j.user_id = p_user_id),
    true);
$$;
revoke all on function public.wants_to_meet_new(uuid) from public, anon, authenticated;

-- 2. Only people who chose "Meet someone new" are suggested ---------------------
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
    -- 2026-10-26: only people who chose "Meet someone new" while joining.
    and public.wants_to_meet_new(u.id)
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

create or replace function public.limen_db_version()
returns text
language sql
stable
as $function$ select '20261026000001'::text $function$;
grant execute on function public.limen_db_version() to anon, authenticated;
