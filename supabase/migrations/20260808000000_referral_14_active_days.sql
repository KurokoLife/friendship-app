-- Referral "active" gate rebuilt from a single last_sign_in_at snapshot to
-- 14 distinct calendar days of real app activity within the 30 days since
-- signup.
--
-- Investigated before building anything, per instruction: does this app
-- have any usable login HISTORY beyond auth.users.last_sign_in_at (a
-- single, overwritten timestamp, structurally incapable of answering
-- "how many distinct days")? Checked both real candidates live, not
-- assumed:
--   - auth.audit_log_entries (GoTrue's own audit trail, the theoretically
--     "right" place for this): queried directly, zero rows exist in this
--     project despite this session alone generating dozens of real
--     sign-ins across multiple real calendar days. Whatever writes this
--     table isn't populating it here, confirmed empirically, not just
--     "seems risky."
--   - auth.sessions (one row per session grant, has a real created_at):
--     DOES have real rows and, unlike audit_log_entries, is genuinely
--     populated (confirmed live against a real, heavily-reauthenticated
--     seed account: distinct created_at timestamps across four separate
--     days). But it is not a durable history either, GoTrue prunes
--     expired/superseded sessions out of this table over time, so a
--     day-3 sign-in's row is not guaranteed to still exist when checking
--     on day 30. Unsuitable for a rolling 30-day count for the same
--     reason last_sign_in_at was: no durable retention.
-- Both internal GoTrue tables are also undocumented, unstable
-- implementation details Supabase does not contract to keep queryable or
-- unpruned, a bad foundation for logic gating a real 30-day Premium
-- grant. Conclusion: build a small, app-owned, durable log instead, the
-- only approach that is genuinely accurate rather than an approximation.

-- One row per (user, calendar day) they were verified present in the app
-- with a real session. Deliberately NOT keyed to referral_by/anything
-- referral-specific, this is a general "was this account used today"
-- fact, referral is just its first and only consumer today. UTC-anchored
-- (active_date is set server-side, see record_active_day below), matching
-- every other day-boundary convention already in this codebase (the free-
-- tier daily caps' date_trunc('day', now() at time zone 'utc')).
create table public.referral_signin_days (
  user_id uuid not null references public.users (id),
  active_date date not null,
  primary key (user_id, active_date)
);

alter table public.referral_signin_days enable row level security;

create policy "Users can read their own active days"
  on public.referral_signin_days for select
  using (auth.uid() = user_id);

-- No client insert policy: writes only ever go through record_active_day
-- below, which is the only thing that can set active_date, specifically
-- so a client can never backdate or fast-forward its own distinct-day
-- count by passing an arbitrary date. Same no-client-write convention as
-- no_ghost_prompts/meetup_checkins for anything a client must never be
-- able to forge, this one's forgeable value would directly inflate a real
-- Premium reward.
create or replace function public.record_active_day()
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.referral_signin_days (user_id, active_date)
  values (auth.uid(), (now() at time zone 'utc')::date)
  on conflict (user_id, active_date) do nothing;
$$;

grant execute on function public.record_active_day() to authenticated;

-- Qualification gate rebuilt: onboarding complete (unchanged), the full
-- 30 days must have elapsed since real signup (unchanged), and now at
-- least 14 DISTINCT rows in referral_signin_days fall within
-- [signup_date, signup_date + 30], replacing the single "last sign-in
-- fell in the final 3 days" check entirely, not layered alongside it,
-- per the given requirement ("not just one sign-in near the end, and not
-- just one sign-in at the start").
create or replace function public.referral_reward_qualifies(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_onboarding_done timestamptz;
  v_signup_at timestamptz;
  v_active_days integer;
begin
  select behavioral_tracking_disclosed_at into v_onboarding_done from public.users where id = p_user_id;
  if v_onboarding_done is null then
    return false;
  end if;

  select created_at into v_signup_at from auth.users where id = p_user_id;
  if v_signup_at is null then
    return false;
  end if;

  if now() < v_signup_at + interval '30 days' then
    return false;
  end if;

  select count(*) into v_active_days
  from public.referral_signin_days
  where user_id = p_user_id
    and active_date >= v_signup_at::date
    and active_date <= (v_signup_at + interval '30 days')::date;

  return v_active_days >= 14;
end;
$$;
