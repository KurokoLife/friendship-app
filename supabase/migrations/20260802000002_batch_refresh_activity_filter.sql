-- Fix 7's batch refresh (generate-match-suggestions, runBatchRefresh)
-- unconditionally regenerated every real user's match_suggestions cache
-- every 6 hours, confirmed live via direct code read: `select id,
-- is_premium from public.users` has no WHERE clause, no activity/recency
-- signal, no filter of any kind beyond skipping a user with no profiles
-- row yet. A user who signed up once and never returned still gets a
-- full Claude generation attempt every 6 hours, indefinitely.
--
-- Checked for an existing activity signal before adding anything new:
-- public.users has no last-active/last-login column of its own, but
-- auth.users.last_sign_in_at (standard GoTrue-managed) already exists and
-- is already genuinely updated by this project's real sign-in path
-- (devSignInAs's verifyOtp call, confirmed live against real rows). No
-- new tracking infrastructure needed.
--
-- auth.users is not exposed through PostgREST (Supabase never puts `auth`
-- in the exposed schema list, service role does not change this, that's
-- a schema-exposure setting, not an RLS bypass), so the batch refresh's
-- service-role client can't join it directly via `.from(...)`. A plain
-- SQL function, same shape and security-definer convention as
-- compatible_candidates_for (20260716000006), bridges this, executing as
-- its owner rather than being limited by PostgREST's schema exposure.
-- Deliberately service_role only, not granted to authenticated/anon:
-- sign-in recency isn't something any ordinary client should be able to
-- query about any user.
--
-- Confirmed safe before this was added, per the earlier live
-- investigation: the on-demand fallback in home.tsx is fully independent
-- of this cron, it doesn't check any cron-only state, it just reads
-- match_suggestions directly and calls this same function's normal
-- per-user path when the cache is empty or older than 24h. A user
-- excluded from this filter still gets a correct, freshly-generated
-- result the next time they open Discover, at a normal generation wait
-- instead of an instant cached one, exactly the same fallback that
-- already covers a brand-new user before their first-ever cron cycle.
create or replace function public.batch_refresh_eligible_users(p_days integer default 7)
returns table (id uuid, is_premium boolean)
language sql
security definer
set search_path = public
stable
as $$
  select u.id, u.is_premium
  from public.users u
  join auth.users au on au.id = u.id
  where au.last_sign_in_at is not null
    and au.last_sign_in_at >= now() - (p_days || ' days')::interval;
$$;

grant execute on function public.batch_refresh_eligible_users(integer) to service_role;
