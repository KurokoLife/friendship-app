-- try_consume_ai_credit was granted service_role only in the previous
-- migration, correct for the moment it was written but too narrow now
-- that generate-match-suggestions' own per-user path (deliberately NOT
-- using the service role, see that function's own header comment, every
-- query runs as the calling user so normal RLS applies) needs to call it
-- directly. Adding a self-check (only ever consume the CALLER's own
-- credit) before widening the grant to `authenticated`, granting the
-- unrestricted version broadly would let any signed-in user decrement
-- any other account's balance by passing a different p_user_id, caught
-- before this ever shipped, not after.
create or replace function public.try_consume_ai_credit(p_user_id uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_consumed boolean;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'Can only consume your own credits';
  end if;

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

grant execute on function public.try_consume_ai_credit(uuid, text) to authenticated;
