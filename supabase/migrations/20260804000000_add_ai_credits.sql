-- Consumable AI top-up packs. Discovery confirmed first, before writing
-- any of this (see PROGRESS.md's 2026-07-29 session):
-- - Zero IAP infrastructure existed: no react-native-iap/expo-in-app-
--   purchases/RevenueCat anywhere, no purchase/credit table, no Apple/
--   Google validation secrets configured. Genuinely greenfield.
-- - The "premium monthly pool" this feature was meant to sit alongside
--   never existed: the only real usage cap anywhere in this codebase is
--   a DAILY cap (2 free / 5 premium) on exactly one function,
--   generate-match-suggestions (Fix #3). No other AI function has any
--   cap. Credits are built to integrate with that real cap, and to be
--   reusable by any future capped function, not hard-wired to only ever
--   work with match suggestions specifically.

alter table public.users
  add column if not exists ai_credits integer not null default 0;

-- Audit trail and idempotency guard for every purchase attempt, not just
-- successful ones, a failed/invalid attempt still gets a row so there's a
-- real record of what was tried. transaction_id is unique so a client
-- retry (or a replayed receipt) can never credit the same real purchase
-- twice, the actual mechanism that makes "never trust the client alone"
-- true even if the client calls this twice for one purchase.
create table public.ai_credit_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id),
  platform text not null check (platform in ('ios', 'android')),
  product_id text not null,
  transaction_id text not null unique,
  receipt_data text not null,
  status text not null default 'pending' check (status in ('pending', 'validated', 'credited', 'invalid', 'failed')),
  credits_granted integer,
  created_at timestamptz not null default now(),
  validated_at timestamptz
);

alter table public.ai_credit_purchases enable row level security;

create policy "Users can read their own purchase history"
  on public.ai_credit_purchases for select
  using (auth.uid() = user_id);

-- Deliberately no client insert/update policy: every row is written only
-- by validate-ai-credit-purchase (service role), a client reporting "I
-- bought this" directly into this table would be exactly the "trust the
-- client alone" failure mode this feature exists to avoid.

-- Plain transaction log, self-row read only, same no-client-write
-- convention. Every credit or debit (a purchase, or a consumed action)
-- gets a row, so a support/debugging question ("where did my credits go")
-- has a real answer instead of just a final balance.
create table public.ai_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id),
  delta integer not null,
  reason text not null,
  created_at timestamptz not null default now()
);

alter table public.ai_credit_ledger enable row level security;

create policy "Users can read their own credit ledger"
  on public.ai_credit_ledger for select
  using (auth.uid() = user_id);

-- The one, reusable consumption primitive "usable across any of the
-- pool-gated/capped functions" is meant to call. Atomic (single UPDATE
-- with a WHERE guard, not a read-then-write, so two concurrent calls
-- can't both succeed against the same last credit), returns whether it
-- actually consumed one. Today only generate-match-suggestions calls
-- this (the only function with a real cap to fall back from), written
-- generically so any future capped function can call it the same way.
create or replace function public.try_consume_ai_credit(p_user_id uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_consumed boolean;
begin
  update public.users
  set ai_credits = ai_credits - 1
  where id = p_user_id and ai_credits > 0
  returning true into v_consumed;

  if coalesce(v_consumed, false) then
    insert into public.ai_credit_ledger (user_id, delta, reason) values (p_user_id, -1, p_reason);
  end if;

  return coalesce(v_consumed, false);
end;
$$;

grant execute on function public.try_consume_ai_credit(uuid, text) to service_role;

-- Called only from validate-ai-credit-purchase after real receipt
-- validation has already succeeded, never reachable from a client
-- directly (service_role only). Credits never expire, this is a plain
-- balance increment, no expiry column, matching the given spec exactly.
create or replace function public.credit_ai_purchase(p_user_id uuid, p_credits integer, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.users set ai_credits = ai_credits + p_credits where id = p_user_id;
  insert into public.ai_credit_ledger (user_id, delta, reason) values (p_user_id, p_credits, p_reason);
end;
$$;

grant execute on function public.credit_ai_purchase(uuid, integer, text) to service_role;
