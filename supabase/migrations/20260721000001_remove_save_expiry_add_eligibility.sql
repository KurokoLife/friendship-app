-- Fix #4 of 23: removes the 14-day save expiry (blueprint Section 8,
-- locked decision: "Do not pressure users with artificial expiration"),
-- replaces it with auto-removal when a saved profile becomes ineligible.
--
-- Verified live before writing this: the 14-day expiry was not a stale
-- doc claim, it was a genuinely live mechanism (cron job 'expire-old-
-- saves', confirmed active via cron.job, plus a matching countdown badge
-- in saved.tsx, "N days left"/"Expires today"), despite AGENTS.md
-- claiming this was already corrected to have no expiry. Neither doc was
-- right; this migration is the actual fix, not just a documentation
-- correction.
select cron.unschedule('expire-old-saves');

drop function if exists public.expire_old_saves();

-- Deleted accounts: already handled correctly with no code needed here,
-- confirmed live. profiles/connections both reference auth.users(id) on
-- delete cascade, so a deleted account's connections row (the save
-- itself) is removed by the database, not just hidden, before this view
-- or function ever runs.
--
-- Blocked accounts: Report/Block (Fix #13) doesn't exist anywhere in
-- this codebase yet, confirmed live (no table, column, or RLS policy
-- for it). Not building placeholder block-checking logic ahead of that
-- feature, this is a real, flagged dependency, not an oversight: once
-- Fix #13 ships, its block representation needs to be added to both
-- prune_ineligible_saves() below and the saved_profiles view's WHERE
-- clause, the same way the age/gender checks are added here.
--
-- Ineligible (age/gender): the one part of this fix that's genuinely
-- new. A saved profile can still legitimately fall outside the SAME hard
-- eligibility layer Fix #1 already enforces for discovery_profiles/
-- browse_profiles (mutual gender preference, mutual age range), for
-- example if either person's own preferences change after the save was
-- made. This is deliberately narrower than "compatibility drift": the
-- view's own original design (20260714000000) already decided that
-- values/activity/interest drift should NOT remove a save, "a save is a
-- deliberate past signal, it shouldn't vanish just because the saved
-- person has since drifted out of mutual discovery compatibility." That
-- reasoning is preserved and untouched here, this only adds the HARD
-- eligibility layer (the same tier as gender/age in blueprint Section
-- 9's matching hierarchy), not the scored compatibility layer.
create or replace view public.saved_profiles as
select
  c.id as connection_id,
  c.user_b_id as user_id,
  c.saved_at,
  p.display_name,
  public.age_band(p.birthdate) as age_band,
  p.life_transitions,
  p.personal_statement
from public.connections c
join public.users u on u.id = c.user_b_id
join public.profiles p on p.user_id = c.user_b_id
join public.users viewer on viewer.id = auth.uid()
join public.profiles viewer_p on viewer_p.user_id = viewer.id
where c.user_a_id = auth.uid()
  and c.saved = true
  and u.gender_identity = viewer.matching_preference
  and u.matching_preference = viewer.gender_identity
  and (
    p.birthdate is null or viewer_p.birthdate is null
    or (
      extract(year from age(current_date::timestamptz, p.birthdate::timestamptz))::integer
        between viewer_p.min_friend_age and viewer_p.max_friend_age
      and extract(year from age(current_date::timestamptz, viewer_p.birthdate::timestamptz))::integer
        between p.min_friend_age and p.max_friend_age
    )
  );

grant select on public.saved_profiles to authenticated;

-- Eventual-consistency cleanup, same daily 3am slot the old time-based
-- expiry used, repurposed rather than left running a since-removed
-- concept. The view above already filters ineligible saves out
-- immediately at read time, this additionally flips the underlying
-- `saved` flag itself for real accounting, so a later preference change
-- that would make the pair eligible again requires a fresh, deliberate
-- re-save rather than silently resurrecting a stale one.
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

select cron.schedule(
  'prune-ineligible-saves',
  '0 3 * * *',
  $$select public.prune_ineligible_saves();$$
);
