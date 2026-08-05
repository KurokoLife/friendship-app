-- Free-tier per-function usage caps and the premium shared monthly dollar
-- pool. Discovery confirmed first (see PROGRESS.md's 2026-07-29 session,
-- second entry): the only real usage cap anywhere in this codebase before
-- this migration is the DAILY cap on generate-match-suggestions (2 free /
-- 5 premium, Fix #3), which this migration deliberately does not touch.
-- No other AI function had any cap, free or premium, and there was no
-- "premium monthly pool" concept anywhere, confirmed by grepping for
-- usage-counter/reset-logic patterns across supabase/functions and
-- supabase/migrations.

-- Free-tier caps, data-driven rather than hardcoded per call site, so
-- get_ai_gate_status and record_ai_usage both read the same source of
-- truth. Not exposed via PostgREST (no grants to anon/authenticated),
-- read only from inside the SECURITY DEFINER functions below.
create table public.ai_function_caps (
  function_name text primary key,
  window_type text not null check (window_type in ('day', 'week')),
  free_limit integer not null
);

insert into public.ai_function_caps (function_name, window_type, free_limit) values
  ('generate-reply-draft', 'day', 3),
  ('generate-activity-suggestions', 'week', 1),
  ('generate-connection-analysis', 'week', 1),
  ('organize-remember-entry', 'week', 2),
  ('summarize-remember-timeline', 'week', 2);
-- generate-personality-narrative is deliberately NOT in this table: its
-- 1/day retake cap applies to BOTH tiers and is handled as a special case
-- in both functions below, separate from both the free-cap table and the
-- premium pool. generate-match-suggestions is also deliberately absent,
-- unchanged, governed by its own existing daily cap (Fix #3).

-- One row per successful free-tier (or personality-narrative-retake,
-- either tier) call, the same "plain event log, counted by window" shape
-- match_suggestions' own suggested_date cap uses conceptually, just
-- generalized across functions. No client write policy, only
-- record_ai_usage (SECURITY DEFINER) inserts, matching the no_ghost_prompts/
-- meetup_checkins convention for anything a client must never forge.
create table public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id),
  function_name text not null,
  created_at timestamptz not null default now()
);

alter table public.ai_usage_events enable row level security;

create policy "Users can read their own AI usage events"
  on public.ai_usage_events for select
  using (auth.uid() = user_id);

create index ai_usage_events_user_function_created_idx
  on public.ai_usage_events (user_id, function_name, created_at);

-- Premium pool state lives on users, same table is_premium/premium_until/
-- ai_credits already live on (2026-08-03/04 sessions), not a parallel
-- table. premium_pool_period_start is null until the first pool-gated call
-- a premium account ever makes, then anchors a rolling 30-day cycle from
-- that point, deliberately NOT calendar-month: there is no real billing/
-- subscription-renewal date anywhere in this codebase to align to
-- (premium_until is an expiry, extended by referral grants in 30-day
-- increments, not a recurring subscription anchor), and a rolling window
-- from first real usage is the simplest scheme that also satisfies "a
-- user who upgrades mid-cycle gets pool-based limits going forward" for
-- free: their first pool-gated call after upgrading starts their own
-- cycle, there's nothing to reconcile against a stale free-tier cap.
alter table public.users
  add column if not exists premium_pool_period_start timestamptz,
  add column if not exists premium_pool_spent_usd numeric(10, 6) not null default 0;

-- Audit trail for premium pool spend, one row per pool-gated call, same
-- no-client-write convention as ai_credit_ledger. Real numeric(10,6) cost
-- in USD, not a flat per-call count, per the given spec's own requirement.
create table public.ai_pool_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id),
  function_name text not null,
  cost_usd numeric(10, 6) not null,
  created_at timestamptz not null default now()
);

alter table public.ai_pool_ledger enable row level security;

create policy "Users can read their own AI pool ledger"
  on public.ai_pool_ledger for select
  using (auth.uid() = user_id);

-- Pre-flight gate, read-only, called by each of the 5 pool/cap-gated
-- functions BEFORE calling Anthropic, so a blocked call never spends real
-- API cost. auth.uid() = p_user_id enforced inside the function itself
-- (SECURITY DEFINER bypasses RLS, this check is what makes it safe to
-- grant to `authenticated` directly, same fix already applied to
-- try_consume_ai_credit in 20260804000001).
--
-- generate-personality-narrative's retake cap (1/day, BOTH tiers,
-- deliberately separate from the pool) is checked first and short-circuits
-- before any tier/pool logic, since it applies identically regardless of
-- is_premium.
--
-- Daily caps reset at UTC midnight (date_trunc('day', now() at time zone
-- 'utc')), matching generate-match-suggestions' own existing
-- suggested_date convention exactly (new Date().toISOString().slice(0,10)
-- is also a UTC calendar day). Weekly caps use a rolling 7-day window
-- (now() - interval '7 days'), NOT a calendar week, matching this
-- codebase's own established elapsed-time convention for "roughly a week"
-- features (meetup_checkins' 168-hour threshold, no_ghost_prompts'
-- hour-based bands) rather than introducing a new ISO-week concept that
-- doesn't exist anywhere else in this app. Both decisions are explicit,
-- not left implicit, per the task's own instruction.
create or replace function public.get_ai_gate_status(p_user_id uuid, p_function_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_premium boolean;
  v_cap record;
  v_window_start timestamptz;
  v_used integer;
  v_pool_period_start timestamptz;
  v_pool_spent numeric(10, 6);
  v_pool_cap constant numeric(10, 6) := 3.00;
begin
  if auth.uid() is distinct from p_user_id then
    raise exception 'Not authorized to check usage for another user';
  end if;

  select is_premium into v_is_premium from public.users where id = p_user_id;
  v_is_premium := coalesce(v_is_premium, false);

  if p_function_name = 'generate-personality-narrative' then
    v_window_start := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
    select count(*) into v_used from public.ai_usage_events
      where user_id = p_user_id and function_name = p_function_name and created_at >= v_window_start;
    if v_used >= 1 then
      return jsonb_build_object(
        'allowed', false,
        'tier', case when v_is_premium then 'premium' else 'free' end,
        'reason', 'daily_cap_reached',
        'resets_at', v_window_start + interval '1 day'
      );
    end if;
    return jsonb_build_object('allowed', true, 'tier', case when v_is_premium then 'premium' else 'free' end);
  end if;

  if not v_is_premium then
    select * into v_cap from public.ai_function_caps where function_name = p_function_name;
    if v_cap is null then
      -- Not a capped function (e.g. generate-match-suggestions, which
      -- keeps its own separate Fix #3 cap): never block here.
      return jsonb_build_object('allowed', true, 'tier', 'free');
    end if;

    if v_cap.window_type = 'day' then
      v_window_start := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
    else
      v_window_start := now() - interval '7 days';
    end if;

    select count(*) into v_used from public.ai_usage_events
      where user_id = p_user_id and function_name = p_function_name and created_at >= v_window_start;

    if v_used >= v_cap.free_limit then
      return jsonb_build_object(
        'allowed', false,
        'tier', 'free',
        'reason', case when v_cap.window_type = 'day' then 'daily_cap_reached' else 'weekly_cap_reached' end,
        'resets_at', case when v_cap.window_type = 'day' then v_window_start + interval '1 day' else v_window_start + interval '7 days' end
      );
    end if;
    return jsonb_build_object('allowed', true, 'tier', 'free');
  end if;

  -- Premium: shared monthly dollar pool, no per-function limit.
  select premium_pool_period_start, premium_pool_spent_usd into v_pool_period_start, v_pool_spent
    from public.users where id = p_user_id;

  if v_pool_period_start is null or now() >= v_pool_period_start + interval '30 days' then
    -- Cycle hasn't started yet, or has rolled over: report as fresh. The
    -- actual reset (writing period_start/spent back to the users row)
    -- only happens in record_ai_usage, this read-only function never
    -- mutates state.
    v_pool_spent := 0;
  end if;

  if v_pool_spent >= v_pool_cap then
    return jsonb_build_object(
      'allowed', false,
      'tier', 'premium',
      'reason', 'pool_exhausted',
      'pool_spent_usd', v_pool_spent,
      'pool_cap_usd', v_pool_cap,
      'resets_at', coalesce(v_pool_period_start, now()) + interval '30 days'
    );
  end if;

  return jsonb_build_object(
    'allowed', true,
    'tier', 'premium',
    'pool_spent_usd', v_pool_spent,
    'pool_cap_usd', v_pool_cap
  );
end;
$$;

grant execute on function public.get_ai_gate_status(uuid, text) to authenticated;

-- Records a genuinely completed call (never called for a call the gate
-- above already blocked). For generate-personality-narrative retakes (both
-- tiers) and every free-tier capped function, this is a plain occurrence
-- log, p_cost_usd is accepted but ignored, matching the given spec's "flat
-- call count" framing for free tier. For a premium pool-gated function,
-- rolls the 30-day cycle if it has expired (or never started) and adds the
-- real p_cost_usd to the running total, logging to the ledger either way.
create or replace function public.record_ai_usage(p_user_id uuid, p_function_name text, p_cost_usd numeric default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_premium boolean;
  v_pool_period_start timestamptz;
begin
  if auth.uid() is distinct from p_user_id then
    raise exception 'Not authorized to record usage for another user';
  end if;

  select is_premium, premium_pool_period_start into v_is_premium, v_pool_period_start
    from public.users where id = p_user_id;

  if p_function_name = 'generate-personality-narrative' or not coalesce(v_is_premium, false) then
    insert into public.ai_usage_events (user_id, function_name) values (p_user_id, p_function_name);
    return;
  end if;

  if v_pool_period_start is null or now() >= v_pool_period_start + interval '30 days' then
    update public.users set premium_pool_period_start = now(), premium_pool_spent_usd = 0 where id = p_user_id;
  end if;

  update public.users set premium_pool_spent_usd = premium_pool_spent_usd + coalesce(p_cost_usd, 0) where id = p_user_id;
  insert into public.ai_pool_ledger (user_id, function_name, cost_usd) values (p_user_id, p_function_name, coalesce(p_cost_usd, 0));
end;
$$;

grant execute on function public.record_ai_usage(uuid, text, numeric) to authenticated;
