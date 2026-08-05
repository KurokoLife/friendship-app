-- Premium subscription purchases, same shape and same non-negotiable
-- contract as ai_credit_purchases/validate-ai-credit-purchase (2026-07-29):
-- a client reporting "I bought this" is never sufficient on its own,
-- every request re-verifies the purchase against Apple's or Google's own
-- servers before touching is_premium/premium_until, and the actual grant
-- only ever happens inside credit_premium_purchase, service-role only,
-- never reachable directly by a client.
--
-- Real, disclosed limitation, not solved here: this app has no App Store
-- Server Notifications / Google Play RTDN webhook receiver, so a
-- renewal that happens while the user never reopens the app is invisible
-- to this backend. What this migration DOES handle correctly: every time
-- the app is opened with an active subscription, the client re-validates
-- (see src/lib/premium.ts's restorePremiumPurchase), and each genuinely
-- new transaction_id (a fresh purchase or a renewal Apple/Google issue a
-- new transaction for) extends premium_until via the already-existing
-- grant_premium_days (built for the referral system, 20260803000000,
-- "extend from the later of now or existing expiry"), reused as-is
-- rather than duplicated.
create table public.premium_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id),
  platform text not null check (platform in ('ios', 'android')),
  product_id text not null,
  transaction_id text not null unique,
  receipt_data text not null,
  status text not null default 'pending' check (status in ('pending', 'validated', 'credited', 'invalid', 'failed')),
  created_at timestamptz not null default now(),
  validated_at timestamptz
);

alter table public.premium_purchases enable row level security;

create policy "Users can read their own premium purchase history"
  on public.premium_purchases for select
  using (auth.uid() = user_id);

-- Idempotent by construction (same convention as credit_ai_purchase):
-- always safe to call, callers should still check status first to avoid
-- redundant work, but calling twice for the same transaction_id cannot
-- double-grant since grant_premium_days is itself only called once per
-- real validated transaction (validate-premium-purchase checks for an
-- existing 'credited' row before ever calling this).
create or replace function public.credit_premium_purchase(p_user_id uuid, p_days integer default 30)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.grant_premium_days(p_user_id, p_days);
end;
$$;

grant execute on function public.credit_premium_purchase(uuid, integer) to service_role;
