-- 2026-10-09 (3): only an approved selfie counts.
-- Safe to run more than once.
--
-- Reverses part of 20261009000002: a selfie that is still waiting for the
-- founder's review no longer lets someone say Interested or send a first
-- message. The check is still once per account: once approved it counts
-- for every connection, and two people who already talked can reconnect
-- without it. While a selfie waits for review, saying Interested returns
-- 'selfie_pending' (not 'not_verified'), so the app can say "waiting for
-- review" instead of sending the person back to the selfie page.

create or replace function public.selfie_check_done(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (select 1 from public.users where id = p_user and selfie_verified_at is not null)
      or exists (select 1 from public.selfie_checks where user_id = p_user and status = 'approved');
$$;

grant execute on function public.selfie_check_done(uuid) to authenticated;

create or replace function public.express_interest(p_other_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid := auth.uid();
  v_connection_id uuid;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if v_caller = p_other_user_id then raise exception 'Cannot connect to yourself'; end if;

  -- Once per account, approved only. Two people who already talked never
  -- need it to say hello again.
  if not public.selfie_check_done(v_caller)
     and not public.users_have_chatted(v_caller, p_other_user_id) then
    if exists (select 1 from public.selfie_checks where user_id = v_caller and status = 'pending') then
      raise exception 'selfie_pending';
    end if;
    raise exception 'not_verified';
  end if;
  if not public.is_user_active(v_caller) then raise exception 'suspended'; end if;
  if not public.is_user_active(p_other_user_id) then raise exception 'unavailable'; end if;
  if exists (
    select 1 from public.blocks b
    where (b.blocker_id = v_caller and b.blocked_id = p_other_user_id)
       or (b.blocker_id = p_other_user_id and b.blocked_id = v_caller)
  ) then
    raise exception 'blocked';
  end if;

  insert into public.interests (from_user_id, to_user_id)
  values (v_caller, p_other_user_id)
  on conflict do nothing;

  if not exists (select 1 from public.interests where from_user_id = p_other_user_id and to_user_id = v_caller) then
    return jsonb_build_object('mutual', false);
  end if;

  v_connection_id := public.create_connection_with_capacity_check(p_other_user_id);
  return jsonb_build_object('mutual', true, 'connection_id', v_connection_id);
end;
$$;

grant execute on function public.express_interest(uuid) to authenticated;

create or replace function public.limen_db_version()
returns text
language sql
immutable
as $$ select '20261009000003'::text $$;

grant execute on function public.limen_db_version() to anon, authenticated;

notify pgrst, 'reload schema';
