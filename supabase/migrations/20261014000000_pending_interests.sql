-- 2026-10-14: Pending in Inbox. Safe to run twice.
--
-- Founder: "Interested" must always save the person somewhere, even while
-- your selfie check waits for review or hasn't been done yet. Now:
--   - Anyone can say Interested. It is saved and shows in Inbox, Pending.
--   - The chat opens only when BOTH said Interested AND both selfies are
--     approved (or the two already talked before). Until then the pair
--     waits in Pending, and each person sees why ("once your selfie is
--     approved", or "once X's selfie check is done").
--   - One-sided interest is still never shown to the other person.
--   - Still at most 5 open, each closes after 30 days.
-- open_ready_interests() opens any pair that has become ready (a selfie
-- was approved, or room freed up); the Inbox calls it on every visit.
-- limen_db_version() -> 20261014000000.

-- A real chat between the two (any state), not counting a mutual
-- Interested that is still waiting to open. pair_had_chat counts that too,
-- which is right for Discover but not for Pending.
create or replace function public.pair_had_real_chat(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.connections c
    where ((c.user_a_id = p_a and c.user_b_id = p_b) or (c.user_a_id = p_b and c.user_b_id = p_a))
      and (
        c.status in ('pending', 'active', 'paused', 'ended', 'inactive', 'graduated', 'blocked')
        or exists (select 1 from public.messages m where m.connection_id = c.id)
      )
  );
$$;
revoke execute on function public.pair_had_real_chat(uuid, uuid) from public, anon, authenticated;

-- Can these two open a chat as far as the selfie rule goes?
create or replace function public.pair_selfies_ok(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.users_have_chatted(p_a, p_b)
      or (public.selfie_check_done(p_a) and public.selfie_check_done(p_b));
$$;
revoke execute on function public.pair_selfies_ok(uuid, uuid) from public, anon, authenticated;

-- Tries to open the chat for the caller and p_other. Returns the chat id,
-- or null when someone has no room right now (it stays in Pending).
create or replace function public._try_open_pair(p_other uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  return public.create_connection_with_capacity_check(p_other);
exception
  when others then
    if sqlerrm in ('active_cap_reached', 'pending_cap_reached') then return null; end if;
    raise;
end;
$$;
revoke execute on function public._try_open_pair(uuid) from public, anon, authenticated;

create or replace function public.my_selfie_state()
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
    when public.selfie_check_done(auth.uid()) then 'approved'
    else coalesce((select status from public.selfie_checks where user_id = auth.uid()), 'none')
  end;
$$;
grant execute on function public.my_selfie_state() to authenticated;

create or replace function public.express_interest(p_other_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid := auth.uid();
  v_connection_id uuid;
  v_selfie text;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if v_caller = p_other_user_id then raise exception 'Cannot connect to yourself'; end if;
  if not public.is_user_active(v_caller) then raise exception 'suspended'; end if;
  if not public.is_user_active(p_other_user_id) then raise exception 'unavailable'; end if;
  if exists (
    select 1 from public.blocks b
    where (b.blocker_id = v_caller and b.blocked_id = p_other_user_id)
       or (b.blocker_id = p_other_user_id and b.blocked_id = v_caller)
  ) then
    raise exception 'blocked';
  end if;
  if exists (
    select 1 from public.connections c
    where ((c.user_a_id = v_caller and c.user_b_id = p_other_user_id) or (c.user_a_id = p_other_user_id and c.user_b_id = v_caller))
      and c.status = 'ended'
  ) then
    raise exception 'ended';
  end if;

  -- At most 5 open at a time (not counting this person).
  if not public.interest_is_open(v_caller, p_other_user_id) and (
    select count(*) from public.interests i
    where i.from_user_id = v_caller and i.created_at > now() - interval '30 days'
      and not public.pair_had_real_chat(v_caller, i.to_user_id)
  ) >= 5 then
    raise exception 'interest_cap_reached';
  end if;

  insert into public.interests (from_user_id, to_user_id)
  values (v_caller, p_other_user_id)
  on conflict (from_user_id, to_user_id) do update
    set created_at = now(), closure_seen_at = null
    where public.interests.created_at <= now() - interval '30 days';

  v_selfie := public.my_selfie_state();

  if not public.interest_is_open(p_other_user_id, v_caller) then
    return jsonb_build_object('mutual', false, 'selfie', v_selfie);
  end if;

  if not public.pair_selfies_ok(v_caller, p_other_user_id) then
    return jsonb_build_object('mutual', true, 'waiting',
      case when v_selfie <> 'approved' then 'my_selfie' else 'their_selfie' end, 'selfie', v_selfie);
  end if;

  v_connection_id := public._try_open_pair(p_other_user_id);
  if v_connection_id is null then
    return jsonb_build_object('mutual', true, 'waiting', 'room', 'selfie', v_selfie);
  end if;
  return jsonb_build_object('mutual', true, 'connection_id', v_connection_id, 'selfie', v_selfie);
end;
$$;
grant execute on function public.express_interest(uuid) to authenticated;

-- Opens every waiting pair of the caller's that is now ready. Returns how
-- many opened.
create or replace function public.open_ready_interests()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_me uuid := auth.uid();
  r record;
  v_n integer := 0;
begin
  if v_me is null then return 0; end if;
  if not public.is_user_active(v_me) then return 0; end if;
  for r in
    select i.to_user_id as other
    from public.interests i
    join public.interests j on j.from_user_id = i.to_user_id and j.to_user_id = v_me
    where i.from_user_id = v_me
      and public.interest_is_open(v_me, i.to_user_id)
      and public.interest_is_open(i.to_user_id, v_me)
      and not public.pair_had_real_chat(v_me, i.to_user_id)
      and public.is_user_active(i.to_user_id)
      and public.pair_selfies_ok(v_me, i.to_user_id)
      and not exists (
        select 1 from public.blocks b
        where (b.blocker_id = v_me and b.blocked_id = i.to_user_id) or (b.blocker_id = i.to_user_id and b.blocked_id = v_me)
      )
      and not exists (
        select 1 from public.connections c
        where ((c.user_a_id = v_me and c.user_b_id = i.to_user_id) or (c.user_a_id = i.to_user_id and c.user_b_id = v_me))
          and c.status = 'ended'
      )
  loop
    if public._try_open_pair(r.other) is not null then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end;
$$;
grant execute on function public.open_ready_interests() to authenticated;

-- Inbox, Pending: the caller's own Interested, newest first. state:
--   waiting       one-sided so far (the other person is never told)
--   my_selfie     both interested, the caller's selfie isn't approved yet
--   their_selfie  both interested, the other person's selfie isn't done
--   room          both interested and ready, but someone is at the chat limit
--   closed        closed after 30 days (shown once, then acknowledged)
drop function if exists public.my_pending();
create or replace function public.my_pending()
returns table (other_user_id uuid, display_name text, age_band text, created_at timestamptz, closes_at timestamptz, state text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select i.to_user_id, p.display_name, public.age_band(p.birthdate), i.created_at,
         i.created_at + interval '30 days',
         case
           when i.created_at <= now() - interval '30 days' then 'closed'
           when not public.interest_is_open(i.to_user_id, auth.uid()) then 'waiting'
           when public.users_have_chatted(auth.uid(), i.to_user_id) then 'room'
           when not public.selfie_check_done(auth.uid()) then 'my_selfie'
           when not public.selfie_check_done(i.to_user_id) then 'their_selfie'
           else 'room'
         end
  from public.interests i
  join public.profiles p on p.user_id = i.to_user_id
  where i.from_user_id = auth.uid()
    and not public.pair_had_real_chat(auth.uid(), i.to_user_id)
    and not exists (
      select 1 from public.blocks b
      where (b.blocker_id = auth.uid() and b.blocked_id = i.to_user_id)
         or (b.blocker_id = i.to_user_id and b.blocked_id = auth.uid())
    )
    and (i.created_at > now() - interval '30 days' or i.closure_seen_at is null)
  order by i.created_at desc;
$$;
grant execute on function public.my_pending() to authenticated;

create or replace function public.limen_db_version()
returns text
language sql
stable
as $function$ select '20261014000000'::text $function$;
grant execute on function public.limen_db_version() to anon, authenticated;
