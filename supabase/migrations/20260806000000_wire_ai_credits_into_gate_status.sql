-- Consumable AI credits, wired into the free-tier caps and premium pool
-- (this session's own task). Discovery confirmed FIRST, before writing
-- anything, per this project's own established discipline, and the task's
-- own "likely greenfield, confirm don't assume" instruction turned out to
-- matter: this is NOT greenfield.
--
-- Already live, all built 2026-07-29, same day as the caps/pool session
-- this migration extends:
--   - `users.ai_credits` (integer, default 0), `ai_credit_purchases` and
--     `ai_credit_ledger` tables (migration `20260804000000`).
--   - `try_consume_ai_credit(p_user_id, p_reason)`, an atomic, self-
--     checked (`auth.uid() = p_user_id`) SECURITY DEFINER RPC, granted to
--     `authenticated` (migrations `20260804000000`/`20260804000001`),
--     already explicitly "written generically so any future capped
--     function can call it the same way" per its own header comment.
--   - `credit_ai_purchase(p_user_id, p_credits, p_reason)`, service-role
--     only, called only after real receipt validation succeeds.
--   - `validate-ai-credit-purchase` Edge Function: real server-side
--     Apple `verifyReceipt` / Google Android Publisher API validation,
--     never trusts the client's own purchase-success callback, exactly
--     one product (`ai_credits_50`, $1.99 for 50 credits, price itself
--     set in App Store Connect/Play Console, never hardcoded), idempotent
--     on `transaction_id` (unique), fails closed with no configured
--     platform secret rather than ever crediting on an unverifiable
--     receipt.
--   - `src/lib/ai-credits.ts` (`purchaseAiCreditPack`, real
--     `react-native-iap@12.15.6` integration, never finishes/consumes the
--     platform transaction until the server has confirmed and credited
--     it) and a real blocked-state purchase card already live in
--     `home.tsx`.
--   - Consumption already wired into ONE function:
--     `generate-match-suggestions`' own per-user path calls
--     `try_consume_ai_credit` directly when its daily cap is hit and a
--     real candidate is still available, `effectiveCap = dailyCap + 1`.
--
-- The real, confirmed gap: `try_consume_ai_credit` was never called from
-- anywhere else. The 5 free-tier-capped functions and the premium pool
-- (`get_ai_gate_status`/`record_ai_usage`, migration `20260805000000`,
-- built the same day but never wired to credits) and
-- generate-personality-narrative's separate 1/day retake cap all had no
-- credit fallback at all, a blocked account there had no way to unblock
-- itself with a purchased credit the way a blocked generate-match-
-- suggestions account already could.
--
-- Fixed by extending get_ai_gate_status itself, not duplicating "check
-- credits" logic into all 6 call sites separately: every branch that
-- would otherwise return allowed:false now first attempts
-- try_consume_ai_credit for that same user, and only falls through to the
-- real blocked response if that also fails (zero credits). Since all 6
-- Edge Functions already call this one function and already branch on
-- `gate.allowed === false`, this required editing exactly one function,
-- zero Edge Function code changes. The consumed credit funds exactly ONE
-- extra action past whatever cap/pool blocked it, the underlying counter
-- is untouched (record_ai_usage still adds its own occurrence/cost
-- afterward), so a second blocked request needs a second credit, matching
-- generate-match-suggestions' own already-established "one credit buys
-- one extra action" semantics exactly.
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
  v_consumed boolean;
  v_credits_remaining integer;
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
      v_consumed := public.try_consume_ai_credit(p_user_id, p_function_name || ':daily_cap');
      if v_consumed then
        select ai_credits into v_credits_remaining from public.users where id = p_user_id;
        return jsonb_build_object(
          'allowed', true,
          'tier', case when v_is_premium then 'premium' else 'free' end,
          'usedCredit', true,
          'aiCredits', v_credits_remaining
        );
      end if;
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
      v_consumed := public.try_consume_ai_credit(p_user_id, p_function_name || ':' || v_cap.window_type || '_cap');
      if v_consumed then
        select ai_credits into v_credits_remaining from public.users where id = p_user_id;
        return jsonb_build_object('allowed', true, 'tier', 'free', 'usedCredit', true, 'aiCredits', v_credits_remaining);
      end if;
      return jsonb_build_object(
        'allowed', false,
        'tier', 'free',
        'reason', case when v_cap.window_type = 'day' then 'daily_cap_reached' else 'weekly_cap_reached' end,
        'resets_at', case when v_cap.window_type = 'day' then v_window_start + interval '1 day' else v_window_start + interval '7 days' end
      );
    end if;
    return jsonb_build_object('allowed', true, 'tier', 'free');
  end if;

  -- Premium: shared monthly dollar pool.
  select premium_pool_period_start, premium_pool_spent_usd into v_pool_period_start, v_pool_spent
    from public.users where id = p_user_id;

  if v_pool_period_start is null or now() >= v_pool_period_start + interval '30 days' then
    v_pool_spent := 0;
  end if;

  if v_pool_spent >= v_pool_cap then
    v_consumed := public.try_consume_ai_credit(p_user_id, p_function_name || ':pool');
    if v_consumed then
      select ai_credits into v_credits_remaining from public.users where id = p_user_id;
      return jsonb_build_object(
        'allowed', true,
        'tier', 'premium',
        'usedCredit', true,
        'aiCredits', v_credits_remaining,
        'pool_spent_usd', v_pool_spent,
        'pool_cap_usd', v_pool_cap
      );
    end if;
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

-- Grant unchanged (already `authenticated` from 20260805000000), CREATE OR
-- REPLACE above doesn't touch it, restated here only for clarity that
-- this migration doesn't need a new grant.
grant execute on function public.get_ai_gate_status(uuid, text) to authenticated;
