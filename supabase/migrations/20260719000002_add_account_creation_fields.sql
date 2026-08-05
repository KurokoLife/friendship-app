-- Fix #1 of 23 (July 19 reconciliation session): Account Creation gap.
-- No onboarding screen has ever written display_name or birthdate (both
-- columns already existed, unwritten, since 20260711000005), there is no
-- email column anywhere, and no min/max friend age preference anywhere.
-- This migration adds the missing schema; the onboarding screens that
-- populate it are added separately in the client code.

-- Email lives on `users`, mirroring exactly where `phone` already lives
-- on that same table (a copy of the auth-layer value, not the source of
-- truth, same pattern `phone` already established: gender-identity.tsx
-- copies auth.users.phone into users.phone on its own upsert). Nullable,
-- not unique: email verification is encouraged, not required (per the
-- given spec, only display_name and birthdate are explicitly "required"),
-- so existing accounts and anyone who skips it must remain valid.
alter table public.users
  add column if not exists email text;

-- Adult-eligibility (18+) enforced server-side too, not just client-side
-- at submission, using current_date so it reflects the real age at the
-- moment the row is written, not a fixed snapshot. profiles.birthdate
-- itself already existed (nullable, unwritten by any screen until now),
-- left nullable here since real accounts (seed data aside) don't have
-- one yet and must not be locked out of using the app while this rolls
-- out, the check only applies once a birthdate is actually provided.
alter table public.profiles
  drop constraint if exists profiles_birthdate_adult_check;

alter table public.profiles
  add constraint profiles_birthdate_adult_check
  check (birthdate is null or birthdate <= current_date - interval '18 years');

-- Min/max friend age preference: a HARD eligibility filter (same tier as
-- gender/pause compatibility), not a scoring bonus, per the given spec.
-- NOT NULL with permissive defaults (18/100, effectively "no real
-- restriction") rather than nullable: every account, old and new, gets a
-- usable value immediately, so the hard filter added below is a genuine
-- no-op for anyone who hasn't deliberately narrowed it, never a silent
-- mass-exclusion the moment this ships.
alter table public.profiles
  add column if not exists min_friend_age integer not null default 18,
  add column if not exists max_friend_age integer not null default 100;

alter table public.profiles
  drop constraint if exists profiles_min_friend_age_check;
alter table public.profiles
  add constraint profiles_min_friend_age_check check (min_friend_age >= 18 and min_friend_age <= 100);

alter table public.profiles
  drop constraint if exists profiles_max_friend_age_check;
alter table public.profiles
  add constraint profiles_max_friend_age_check check (max_friend_age >= 18 and max_friend_age <= 100);

alter table public.profiles
  drop constraint if exists profiles_friend_age_range_check;
alter table public.profiles
  add constraint profiles_friend_age_range_check check (min_friend_age <= max_friend_age);

-- Public age band, computed server-side from birthdate, the ONLY
-- age-related value ever exposed through discovery_profiles/browse_
-- profiles/compatible_candidates_for (see the next migration): exact
-- age and birthdate are removed from all three entirely, not just
-- omitted from what the client happens to ask for. A raw, selectable
-- age/birthdate column on a view granted to `authenticated` is a real
-- privacy hole regardless of what the app's own UI chooses to request,
-- the same standard this project already applied to Big Five scores
-- (big_five_proximity_score, 20260716000003): never expose the
-- underlying value, only a derived, safe one.
-- Bands per blueprint Section 9: 18-24, 25-29, 30s, 40s, 50s, 60s, 70+.
create or replace function public.age_band(p_birthdate date)
returns text
language sql
immutable
as $$
  select case
    when p_birthdate is null then null
    else (
      select case
        when age < 18 then 'Under 18'
        when age <= 24 then '18-24'
        when age <= 29 then '25-29'
        when age <= 39 then '30s'
        when age <= 49 then '40s'
        when age <= 59 then '50s'
        when age <= 69 then '60s'
        else '70+'
      end
      from (select extract(year from age(current_date::timestamptz, p_birthdate::timestamptz))::integer as age) a
    )
  end;
$$;
