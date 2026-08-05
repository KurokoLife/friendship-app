-- Narrow, explicitly-scoped fraud tooling, per instruction: lightweight
-- SIGNALS for later manual review, never a hard block, and only the two
-- named patterns (same-device multi-onboarding, suspiciously fast
-- referral-completion clustering). Payment fraud detection, report-abuse
-- detection, and ML/automated catfish detection are all deliberately out
-- of scope here, logged as deferred future work in PROGRESS.md, not
-- built, not silently dropped either.
--
-- Phone-uniqueness, investigated rather than assumed: confirmed live via
-- `select indexdef from pg_indexes where schemaname='auth' and
-- tablename='users'` that `users_phone_key` is a real UNIQUE INDEX on
-- auth.users.phone. GoTrue's own phone-OTP flow already enforces one
-- account per verified phone number at the database level, nothing to
-- build for that half of this item.
--
-- "Short window" for both signals below: 48 hours, a judgment call (the
-- task's own text offered 24-48h and left the choice here). Reasoning:
-- 24h risks false negatives for a real abuse pattern spanning two
-- calendar days in different timezones (a real user's "same day" can
-- cross a UTC day boundary); wide enough to catch a realistic
-- multi-account setup session without being so wide it starts flagging
-- coincidental, unrelated real users.

create table public.onboarding_device_ids (
  user_id uuid primary key references public.users (id),
  device_id text not null,
  created_at timestamptz not null default now()
);

create index onboarding_device_ids_device_idx on public.onboarding_device_ids (device_id);

alter table public.onboarding_device_ids enable row level security;

create policy "Users can write their own device id"
  on public.onboarding_device_ids for insert
  with check (auth.uid() = user_id);

create policy "Users can read their own device id"
  on public.onboarding_device_ids for select
  using (auth.uid() = user_id);

-- No client access at all, by design, not even self-row: this is an
-- internal review signal about an account, not something the account
-- holder is meant to see about themselves (same reasoning `reports`
-- already established for the reporter/reported relationship). Read
-- only via direct database access by whoever manually reviews these.
create table public.fraud_signals (
  id uuid primary key default gen_random_uuid(),
  signal_type text not null check (signal_type in ('device_clustering', 'referral_pattern')),
  primary_user_id uuid not null references public.users (id),
  related_user_id uuid not null references public.users (id),
  detail jsonb,
  created_at timestamptz not null default now()
);

alter table public.fraud_signals enable row level security;
-- Deliberately zero policies: RLS enabled with no grants means even
-- `authenticated` gets nothing, matching "not visible to the account
-- itself" above. Only reachable via this migration's own SECURITY
-- DEFINER trigger function and direct database access.

-- Fires once, at the real "onboarding just completed" transition
-- (behavioral_tracking_disclosed_at going from null to set), the same
-- moment readiness-commitment.tsx's own "Yes, I'm ready" write already
-- happens, not on every profile edit afterward.
create or replace function public.check_fraud_signals()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device_id text;
  v_other record;
begin
  -- Signal 1: multiple accounts completing onboarding from the same
  -- device within the window.
  select device_id into v_device_id from public.onboarding_device_ids where user_id = new.id;
  if v_device_id is not null then
    for v_other in
      select d2.user_id as id, u2.behavioral_tracking_disclosed_at
      from public.onboarding_device_ids d2
      join public.users u2 on u2.id = d2.user_id
      where d2.device_id = v_device_id
        and d2.user_id <> new.id
        and u2.behavioral_tracking_disclosed_at is not null
        and abs(extract(epoch from (u2.behavioral_tracking_disclosed_at - new.behavioral_tracking_disclosed_at))) <= 48 * 3600
    loop
      insert into public.fraud_signals (signal_type, primary_user_id, related_user_id, detail)
      values (
        'device_clustering',
        new.id,
        v_other.id,
        jsonb_build_object('device_id', v_device_id, 'window_hours', 48)
      );
    end loop;
  end if;

  -- Signal 2: this referrer's other referred accounts also completing
  -- onboarding unusually close together in time (protects the referral
  -- reward system's real financial exposure specifically, not a general
  -- account-fraud check).
  if new.referred_by is not null then
    for v_other in
      select id, behavioral_tracking_disclosed_at from public.users
      where referred_by = new.referred_by
        and id <> new.id
        and behavioral_tracking_disclosed_at is not null
        and abs(extract(epoch from (behavioral_tracking_disclosed_at - new.behavioral_tracking_disclosed_at))) <= 48 * 3600
    loop
      insert into public.fraud_signals (signal_type, primary_user_id, related_user_id, detail)
      values (
        'referral_pattern',
        new.referred_by,
        new.id,
        jsonb_build_object('other_referred_user', v_other.id, 'window_hours', 48)
      );
    end loop;
  end if;

  return new;
end;
$$;

drop trigger if exists users_check_fraud_signals on public.users;
create trigger users_check_fraud_signals
  after update of behavioral_tracking_disclosed_at on public.users
  for each row
  when (old.behavioral_tracking_disclosed_at is null and new.behavioral_tracking_disclosed_at is not null)
  execute function public.check_fraud_signals();
