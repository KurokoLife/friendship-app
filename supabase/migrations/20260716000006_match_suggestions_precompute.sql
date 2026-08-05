-- Fix 7: pre-computation architecture for Discovery. Previously
-- generate-match-suggestions was called on every home.tsx page load; even
-- with its existing same-day cache check, that still meant a network round
-- trip to the Edge Function and several DB queries just to find out
-- nothing needed to change. With many users this is slow and, worse,
-- expensive (a Claude call per user per day the first time they load
-- Discover that day). The fix: the client reads match_suggestions
-- directly for the common case (instant, no Edge Function call at all),
-- and a pg_cron job refreshes everyone's cache in the background every 6
-- hours so it's usually already warm by the time someone opens the app.

-- match_suggestions already has created_at (confirmed live), used from
-- here on as the actual freshness signal (a rolling 24h window), replacing
-- suggested_date's calendar-day semantics, kept only for display/history,
-- no longer the gating condition.

-- A service-role batch job can't use discovery_profiles as-is, that view's
-- WHERE clause is built entirely around auth.uid(), which is null under a
-- service-role connection (no real session), so it would silently return
-- zero rows for everyone rather than computing real compatibility. This
-- function is the same gender/pause compatibility check, parameterized
-- on an explicit user id instead of relying on auth.uid(), for exactly
-- that batch use case. Security definer, but deliberately NOT granted to
-- `authenticated`, only ever called from the Edge Function's service-role
-- client, a regular user calling this directly could otherwise pull an
-- arbitrary other user's full compatible-candidate list.
create or replace function public.compatible_candidates_for(p_user_id uuid)
returns table (
  user_id uuid,
  display_name text,
  age integer,
  life_transitions text[],
  activity_interests jsonb,
  "values" text[],
  hangout_people_preference text,
  hangout_type_preference text[],
  meeting_freq text,
  communication_freq text,
  personal_statement text,
  current_situation text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    u.id as user_id,
    p.display_name,
    extract(year from age(current_date::timestamptz, p.birthdate::timestamptz))::integer as age,
    p.life_transitions,
    p.activity_interests,
    p."values",
    p.hangout_people_preference,
    p.hangout_type_preference,
    p.meeting_freq,
    p.communication_freq,
    p.personal_statement,
    p.current_situation
  from users u
  join profiles p on p.user_id = u.id
  join users viewer on viewer.id = p_user_id
  where u.id <> p_user_id
    and u.gender_identity = viewer.matching_preference
    and u.matching_preference = viewer.gender_identity
    and (u.paused_until is null or u.paused_until <= now());
$$;

-- Cache invalidation: whenever life_transitions or values changes
-- meaningfully, the cached suggestions (and their written reasoning,
-- which cites the OLD values) are stale, delete them so the next load
-- regenerates instead of showing suggestions grounded in data that no
-- longer matches the profile. A plain AFTER UPDATE trigger, not something
-- the client has to remember to call itself.
create or replace function public.invalidate_match_suggestions_on_profile_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.life_transitions is distinct from old.life_transitions)
     or (new."values" is distinct from old."values") then
    delete from public.match_suggestions where user_id = new.user_id;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_invalidate_match_suggestions on public.profiles;
create trigger profiles_invalidate_match_suggestions
  after update on public.profiles
  for each row
  execute function public.invalidate_match_suggestions_on_profile_change();
