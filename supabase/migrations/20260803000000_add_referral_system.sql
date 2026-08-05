-- Referral reward system. Confirmed genuinely unbuilt before this
-- migration, not just undocumented: grepped the whole repo for
-- "referral"/"referred_by"/"referral_code", the only match anywhere was
-- AGENTS.md's own "Missing from original F-numbering" note ("Referral
-- system... zero matching code anywhere"). `public.users` had no related
-- columns (confirmed via information_schema before writing this).
--
-- Premium storage, confirmed before building on top of it: `users.is_premium`
-- is a flat boolean, default false, no expiry column, no subscription
-- table, no billing/IAP integration anywhere (Capacity System, Fix #3).
-- There is currently no concept of a temporary or expiring premium grant
-- for ANYONE in this codebase, real subscriber or not, `is_premium` has
-- always meant "permanently true until someone manually flips it back."
-- The task's own recommended behavior ("extend their existing expiry")
-- presupposes an expiry mechanism that doesn't exist yet. `premium_until`
-- below is the minimal addition needed to make time-boxed grants possible
-- at all, added to the SAME `users` table `is_premium` already lives on,
-- not a new parallel subscription system. Every existing consumer of
-- `is_premium` (capacity checks, match-suggestion caps) is deliberately
-- left untouched and keeps reading the plain boolean unchanged, a daily
-- cron below is what keeps `is_premium` truthful once a temporary grant's
-- `premium_until` passes, rather than requiring every read site to also
-- learn about a second column.

alter table public.users
  add column if not exists referral_code text unique,
  add column if not exists referred_by uuid references public.users (id),
  add column if not exists was_referred_reward_claimed boolean not null default false,
  add column if not exists referred_someone_reward_claimed boolean not null default false,
  add column if not exists premium_until timestamptz;

create index if not exists users_referred_by_idx on public.users (referred_by) where referred_by is not null;

-- Deliberately excludes visually ambiguous characters (0/O, 1/I/L) since
-- this code is meant to be typed or read aloud, not just copy-pasted.
create or replace function public.generate_referral_code()
returns text
language plpgsql
as $$
declare
  chars text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  result text;
begin
  result := '';
  for i in 1..8 loop
    result := result || substr(chars, floor(random() * length(chars) + 1)::int, 1);
  end loop;
  return result;
end;
$$;

-- Assigns a code the moment a users row is first created, from whichever
-- of the several existing screens happens to create it first
-- (gender-identity.tsx, index.tsx's email-confirmation path, or
-- profile-basics.tsx's own referral-code-redeeming upsert below), so
-- "every account gets a unique code" holds regardless of onboarding
-- order. A handful of retries on the (extremely unlikely, at this app's
-- real scale) chance of a collision against the unique constraint, rather
-- than trusting one random draw is always unique.
create or replace function public.users_assign_referral_code()
returns trigger
language plpgsql
as $$
declare
  candidate text;
  attempt integer := 0;
begin
  if new.referral_code is not null then
    return new;
  end if;
  loop
    candidate := public.generate_referral_code();
    attempt := attempt + 1;
    if not exists (select 1 from public.users where referral_code = candidate) then
      new.referral_code := candidate;
      return new;
    end if;
    if attempt >= 10 then
      raise exception 'Could not generate a unique referral code after 10 attempts';
    end if;
  end loop;
end;
$$;

drop trigger if exists users_set_referral_code on public.users;
create trigger users_set_referral_code
  before insert on public.users
  for each row execute function public.users_assign_referral_code();

-- Backfill: any users row that already existed before this migration
-- (every real seed/test account) gets a code too, the trigger above only
-- fires on future inserts.
update public.users set referral_code = public.generate_referral_code() where referral_code is null;

-- Resolves a referral code to the referring account's id and records it
-- on the caller's OWN row. A SECURITY DEFINER RPC, not a plain client
-- upsert, for two real reasons: (1) users' own SELECT RLS is self-row
-- only, a client can never look up "whose code is this" by querying
-- `users` directly, this function is the only way to resolve a code at
-- all; (2) enforces two business rules atomically that a plain client
-- upsert could not be trusted to enforce on its own: no self-referral,
-- and referred_by can only ever be set once (redeeming a second code
-- later can't silently swap who gets credit for a real referral).
create or replace function public.redeem_referral_code(p_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_referrer_id uuid;
  v_already_set boolean;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select referred_by is not null into v_already_set from public.users where id = auth.uid();
  if coalesce(v_already_set, false) then
    return false;
  end if;

  select id into v_referrer_id from public.users where referral_code = upper(trim(p_code));
  if v_referrer_id is null or v_referrer_id = auth.uid() then
    return false;
  end if;

  update public.users set referred_by = v_referrer_id where id = auth.uid();
  return true;
end;
$$;

grant execute on function public.redeem_referral_code(text) to authenticated;

-- Shared "grant N days of premium" logic, reusable beyond just referrals.
-- Confirms what happens to an account that already has active premium,
-- per the task's own explicit instruction, rather than assuming: if
-- is_premium is already true AND premium_until is set (a real, tracked
-- temporary grant, whether from an earlier referral reward or any future
-- feature using this same column), extends from the LATER of "now" or
-- their current expiry, so a still-active grant genuinely gets 30 more
-- days on top rather than losing unused time. If is_premium is already
-- true but premium_until is null, that's this app's only representation
-- of a permanent/manually-set grant (no real billing integration exists
-- anywhere in this codebase to have set a real expiring subscription),
-- deliberately left untouched rather than retroactively imposing an
-- expiry on a grant that never had one, exactly the "don't conflict with
-- real billing" case the task warned about. Never called directly by a
-- client, only from the reward-granting functions below.
create or replace function public.grant_premium_days(p_user_id uuid, p_days integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_premium boolean;
  v_until timestamptz;
begin
  select is_premium, premium_until into v_is_premium, v_until from public.users where id = p_user_id;

  if v_is_premium and v_until is null then
    return;
  end if;

  if v_is_premium and v_until is not null then
    update public.users
    set premium_until = greatest(v_until, now()) + (p_days || ' days')::interval
    where id = p_user_id;
  else
    update public.users
    set is_premium = true, premium_until = now() + (p_days || ' days')::interval
    where id = p_user_id;
  end if;
end;
$$;

-- Daily sweep keeping is_premium truthful once a tracked temporary grant's
-- premium_until passes. Every existing consumer of is_premium (capacity
-- checks, generate-match-suggestions' dailyCap) reads the plain boolean
-- unchanged, this is what makes that safe rather than requiring every
-- read site to also learn about premium_until.
create or replace function public.expire_premium_grants()
returns void
language sql
security definer
set search_path = public
as $$
  update public.users
  set is_premium = false
  where is_premium = true and premium_until is not null and premium_until < now();
$$;

-- Qualification gate (task's own wording): onboarding complete
-- (behavioral_tracking_disclosed_at is not null, the same "onboarding is
-- fully done" signal the 2026-07-28 friendship-experience trigger already
-- uses) AND still shows real activity at the 30-day mark. "At the 30-day
-- mark" is read as: 30 real days have passed since signup (auth.users.
-- created_at, the actual account-creation moment, not public.users' own
-- created_at which can be set moments later in the same onboarding
-- session depending on which screen happens to create that row first),
-- AND the existing GoTrue-managed last_sign_in_at (the same activity
-- signal the 2026-07-28 batch-refresh cost fix already uses) falls within
-- the final few days of that window, not just once on day one and never
-- again. The exact grace window (3 days) is a judgment call, not given a
-- specific number by the task, documented here rather than picked
-- silently.
create or replace function public.referral_reward_qualifies(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_onboarding_done timestamptz;
  v_signup_at timestamptz;
  v_last_sign_in timestamptz;
begin
  select behavioral_tracking_disclosed_at into v_onboarding_done from public.users where id = p_user_id;
  if v_onboarding_done is null then
    return false;
  end if;

  select created_at, last_sign_in_at into v_signup_at, v_last_sign_in from auth.users where id = p_user_id;
  if v_signup_at is null then
    return false;
  end if;

  if now() < v_signup_at + interval '30 days' then
    return false;
  end if;

  return v_last_sign_in is not null and v_last_sign_in >= (v_signup_at + interval '30 days' - interval '3 days');
end;
$$;

-- The main per-referred-account evaluator. Grants up to two rewards in
-- one pass: the referred account's own was_referred reward (always
-- checked first, this account's own qualification is what the whole
-- check is gated on), and the referrer's referred_someone reward (only
-- if the referrer hasn't already claimed theirs, from this or any other
-- referral, "not shared, not a pool", each account's own flag is
-- independent). Idempotent, safe to call repeatedly: once
-- was_referred_reward_claimed is true, later calls for the same account
-- return early and grant nothing further.
create or replace function public.check_and_grant_referral_reward_for(p_referred_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_referred_by uuid;
  v_already_claimed boolean;
  v_referrer_claimed boolean;
begin
  select referred_by, was_referred_reward_claimed
  into v_referred_by, v_already_claimed
  from public.users where id = p_referred_user_id;

  if v_referred_by is null then
    return 'not_referred';
  end if;
  if v_already_claimed then
    return 'already_claimed';
  end if;
  if not public.referral_reward_qualifies(p_referred_user_id) then
    return 'not_yet_qualified';
  end if;

  perform public.grant_premium_days(p_referred_user_id, 30);
  update public.users set was_referred_reward_claimed = true where id = p_referred_user_id;

  select referred_someone_reward_claimed into v_referrer_claimed from public.users where id = v_referred_by;
  if coalesce(v_referrer_claimed, true) = false then
    perform public.grant_premium_days(v_referred_by, 30);
    update public.users set referred_someone_reward_claimed = true where id = v_referred_by;
    return 'granted_both';
  end if;

  return 'granted_referred_only';
end;
$$;

create or replace function public.run_referral_reward_check_all()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user record;
begin
  for v_user in
    select id from public.users where referred_by is not null and was_referred_reward_claimed = false
  loop
    perform public.check_and_grant_referral_reward_for(v_user.id);
  end loop;
end;
$$;

-- Dev-only, participant-checked (mirrors dev_run_meetup_checkin_check's
-- own shape): lets the signed-in account force-run the real check against
-- itself, the exact function the daily cron calls, no shortcuts. Backdating
-- signup/last_sign_in_at for a test is done via direct SQL against
-- auth.users during testing (the same convention already used for
-- last_sign_in_at in the July 28 batch-refresh cost fix and
-- behavioral_tracking_disclosed_at in the friendship-experience session),
-- not a dedicated dev RPC, since testing this feature happens through the
-- CLI/direct database access, not the Dev tab UI.
create or replace function public.dev_run_referral_reward_check(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'Can only run this against your own account';
  end if;
  return public.check_and_grant_referral_reward_for(p_user_id);
end;
$$;

grant execute on function public.dev_run_referral_reward_check(uuid) to authenticated;

select cron.schedule(
  'referral-reward-check',
  '0 6 * * *',
  $$select public.run_referral_reward_check_all();$$
);

select cron.schedule(
  'expire-premium-grants',
  '15 6 * * *',
  $$select public.expire_premium_grants();$$
);
