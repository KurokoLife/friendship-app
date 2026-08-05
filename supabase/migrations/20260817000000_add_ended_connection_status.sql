-- Honest Exit becomes a real action. Previously, both real exit entry
-- points (the no-ghost R2/R3 escalation card's "End the connection"
-- option, and the meetup-outcome "rough" card's "End the connection"
-- option) only ever inserted a message, they never touched
-- connections.status. This meant messaging never actually stopped, no
-- prompt/evaluator ever recognized the connection as closed, and the
-- meetup-suggestion banner could keep firing right alongside a rough-
-- outcome exit card, a real, confirmed UX contradiction.
--
-- New status chosen: 'ended'. Distinct from 'blocked' (a safety action,
-- unilateral, ambiguous to the blocked party) and 'inactive' (an
-- auto-close, an unblock, or S1's "close and make room", none of which
-- represent a considered decision by either participant to leave). Both
-- participants see the same honest copy for 'ended', matching Honest
-- Exit's own existing sender/receiver text, not Block's ambiguous
-- framing.

-- 1. Add 'ended' to the status check constraint.
alter table public.connections drop constraint connections_status_check;
alter table public.connections add constraint connections_status_check
  check (status is null or status = any (array['pending','active','passed','inactive','paused','blocked','ended']));

-- 2. Atomic "end the connection" RPC. Mirrors block_user()'s own
-- "one call does the whole atomic thing" pattern: the message insert and
-- the status update happen inside a single SECURITY DEFINER function, not
-- two separate client calls where the second could be skipped. Message
-- type is always 'honest_exit', matching both existing call sites (the
-- no-ghost escalation card's exit option, the meetup-outcome not_good
-- card's exit option), both of which already require a real, user-edited
-- message before this is reachable.
create or replace function public.end_connection_with_message(
  p_connection_id uuid,
  p_content text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid;
begin
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1 from public.connections c
    where c.id = p_connection_id
      and (c.user_a_id = v_caller or c.user_b_id = v_caller)
  ) then
    raise exception 'Not a participant of this connection';
  end if;

  if p_content is null or length(trim(p_content)) = 0 then
    raise exception 'A message is required to end this connection';
  end if;

  insert into public.messages (connection_id, sender_id, content, type)
  values (p_connection_id, v_caller, p_content, 'honest_exit');

  update public.connections set status = 'ended' where id = p_connection_id;
end;
$$;
grant execute on function public.end_connection_with_message(uuid, text) to authenticated;

-- 3. Reopening restriction. 'inactive' reopens with zero friction (any
-- call to create_connection_with_capacity_check silently flips it back to
-- 'pending'). 'ended' represents a deliberate decision to leave, so the
-- bar is meaningfully higher: create_connection_with_capacity_check now
-- raises a distinct 'ended' exception instead of silently reopening it,
-- and the only way back in is this separate, explicitly-named RPC, which
-- the client only ever calls after a real, extra confirmation step (not
-- from the default "Say hello" tap). Full parity with
-- create_connection_with_capacity_check's own capacity checks, since this
-- is still subject to the same active/pending caps as any other new
-- connection.
create or replace function public.create_connection_with_capacity_check(p_other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid;
  v_existing_id uuid;
  v_existing_status text;
  v_is_premium boolean;
  v_active_cap integer;
  v_pending_cap integer;
  v_active_count integer;
  v_pending_count integer;
  v_new_id uuid;
begin
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Not authenticated';
  end if;
  if v_caller = p_other_user_id then
    raise exception 'Cannot connect to yourself';
  end if;

  if exists (
    select 1 from public.blocks b
    where (b.blocker_id = v_caller and b.blocked_id = p_other_user_id)
       or (b.blocker_id = p_other_user_id and b.blocked_id = v_caller)
  ) then
    raise exception 'blocked';
  end if;

  select id, status into v_existing_id, v_existing_status
  from public.connections
  where (user_a_id = v_caller and user_b_id = p_other_user_id)
     or (user_a_id = p_other_user_id and user_b_id = v_caller)
  limit 1;

  if v_existing_id is not null then
    if v_existing_status = 'blocked' then
      raise exception 'blocked';
    end if;
    if v_existing_status = 'ended' then
      raise exception 'ended';
    end if;
    if v_existing_status is distinct from 'active' then
      update public.connections set status = 'pending' where id = v_existing_id;
    end if;
    return v_existing_id;
  end if;

  select coalesce(is_premium, false) into v_is_premium from public.users where id = v_caller;
  v_active_cap := case when v_is_premium then 8 else 4 end;
  v_pending_cap := case when v_is_premium then 8 else 5 end;

  select count(*) into v_active_count
  from public.connections c
  where (c.user_a_id = v_caller or c.user_b_id = v_caller)
    and (c.status is null or c.status not in ('passed', 'inactive', 'paused', 'blocked', 'ended'))
    and exists (select 1 from public.messages m where m.connection_id = c.id and m.sender_id = v_caller)
    and exists (select 1 from public.messages m where m.connection_id = c.id and m.sender_id <> v_caller);

  select count(*) into v_pending_count
  from public.connections c
  where (c.user_a_id = v_caller or c.user_b_id = v_caller)
    and (c.status is null or c.status not in ('passed', 'inactive', 'paused', 'blocked', 'ended'))
    and exists (select 1 from public.messages m where m.connection_id = c.id and m.sender_id = v_caller)
    and not exists (select 1 from public.messages m where m.connection_id = c.id and m.sender_id <> v_caller);

  if v_active_count >= v_active_cap then
    raise exception 'active_cap_reached';
  end if;
  if v_pending_count >= v_pending_cap then
    raise exception 'pending_cap_reached';
  end if;

  insert into public.connections (user_a_id, user_b_id, status)
  values (v_caller, p_other_user_id, 'pending')
  returning id into v_new_id;

  return v_new_id;
end;
$$;

create or replace function public.reinitiate_ended_connection(p_other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid;
  v_existing_id uuid;
  v_existing_status text;
  v_is_premium boolean;
  v_active_cap integer;
  v_pending_cap integer;
  v_active_count integer;
  v_pending_count integer;
begin
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Not authenticated';
  end if;

  if exists (
    select 1 from public.blocks b
    where (b.blocker_id = v_caller and b.blocked_id = p_other_user_id)
       or (b.blocker_id = p_other_user_id and b.blocked_id = v_caller)
  ) then
    raise exception 'blocked';
  end if;

  select id, status into v_existing_id, v_existing_status
  from public.connections
  where (user_a_id = v_caller and user_b_id = p_other_user_id)
     or (user_a_id = p_other_user_id and user_b_id = v_caller)
  limit 1;

  -- Deliberately narrow: this RPC only ever reopens a genuinely 'ended'
  -- connection. It is not a general-purpose alternate path into
  -- create_connection_with_capacity_check, a brand-new connection or any
  -- other status keeps using that function exactly as before.
  if v_existing_id is null or v_existing_status is distinct from 'ended' then
    raise exception 'not_ended';
  end if;

  select coalesce(is_premium, false) into v_is_premium from public.users where id = v_caller;
  v_active_cap := case when v_is_premium then 8 else 4 end;
  v_pending_cap := case when v_is_premium then 8 else 5 end;

  select count(*) into v_active_count
  from public.connections c
  where (c.user_a_id = v_caller or c.user_b_id = v_caller)
    and (c.status is null or c.status not in ('passed', 'inactive', 'paused', 'blocked', 'ended'))
    and exists (select 1 from public.messages m where m.connection_id = c.id and m.sender_id = v_caller)
    and exists (select 1 from public.messages m where m.connection_id = c.id and m.sender_id <> v_caller);

  select count(*) into v_pending_count
  from public.connections c
  where (c.user_a_id = v_caller or c.user_b_id = v_caller)
    and (c.status is null or c.status not in ('passed', 'inactive', 'paused', 'blocked', 'ended'))
    and exists (select 1 from public.messages m where m.connection_id = c.id and m.sender_id = v_caller)
    and not exists (select 1 from public.messages m where m.connection_id = c.id and m.sender_id <> v_caller);

  if v_active_count >= v_active_cap then
    raise exception 'active_cap_reached';
  end if;
  if v_pending_count >= v_pending_cap then
    raise exception 'pending_cap_reached';
  end if;

  update public.connections set status = 'pending' where id = v_existing_id;
  return v_existing_id;
end;
$$;
grant execute on function public.reinitiate_ended_connection(uuid) to authenticated;

-- 4. Ending also frees capacity, same as blocked/inactive already do.
create or replace function public.my_connection_capacity()
returns table(is_premium boolean, active_count integer, active_cap integer, pending_count integer, pending_cap integer)
language sql
stable
as $$
  select
    u.is_premium,
    (
      select count(*)::integer from public.connections c
      where (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
        and (c.status is null or c.status not in ('passed', 'inactive', 'paused', 'blocked', 'ended'))
        and exists (select 1 from public.messages m where m.connection_id = c.id and m.sender_id = auth.uid())
        and exists (select 1 from public.messages m where m.connection_id = c.id and m.sender_id <> auth.uid())
    ) as active_count,
    case when u.is_premium then 8 else 4 end as active_cap,
    (
      select count(*)::integer from public.connections c
      where (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
        and (c.status is null or c.status not in ('passed', 'inactive', 'paused', 'blocked', 'ended'))
        and exists (select 1 from public.messages m where m.connection_id = c.id and m.sender_id = auth.uid())
        and not exists (select 1 from public.messages m where m.connection_id = c.id and m.sender_id <> auth.uid())
    ) as pending_count,
    case when u.is_premium then 8 else 5 end as pending_cap
  from public.users u
  where u.id = auth.uid();
$$;

-- 5. Extend the stale-prompt trigger (20260813000000) so 'ended' clears
-- no_ghost_prompts and unresolved meetup_checkins the same way blocked/
-- inactive already do, preventing the exact class of bug already fixed
-- for those two statuses from recurring here.
create or replace function public.clear_prompts_on_connection_closed()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.status in ('blocked', 'inactive', 'ended') and (old.status is distinct from new.status) then
    delete from public.no_ghost_prompts where connection_id = new.id;
    delete from public.meetup_checkins where connection_id = new.id and resolved_at is null;
  end if;
  return new;
end;
$$;

-- 6. Extend both evaluators' guard lists so an ended connection never
-- generates a new no-ghost prompt or check-in cycle, same class of bug
-- already found and fixed for 'blocked' (20260813000000).
create or replace function public.run_no_ghost_check(p_connection_id uuid, p_now timestamp with time zone default now())
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_last record;
  v_sender uuid;
  v_recipient uuid;
  v_status text;
  v_recipient_response_time text;
  v_r1_threshold interval;
  v_elapsed interval;
begin
  select c.status
  into v_status
  from public.connections c
  where c.id = p_connection_id;

  if v_status is not null and v_status in ('paused', 'inactive', 'passed', 'blocked', 'ended') then
    return;
  end if;

  select m.sender_id, m.created_at
  into v_last
  from public.messages m
  where m.connection_id = p_connection_id
  order by m.created_at desc
  limit 1;

  if not found then
    return;
  end if;

  v_sender := v_last.sender_id;

  select case when c.user_a_id = v_sender then c.user_b_id else c.user_a_id end
  into v_recipient
  from public.connections c
  where c.id = p_connection_id;

  if v_recipient is null then
    return;
  end if;

  v_elapsed := p_now - v_last.created_at;

  select p.response_time
  into v_recipient_response_time
  from public.profiles p
  where p.user_id = v_recipient;

  v_r1_threshold := case when v_recipient_response_time = 'Same day' then interval '20 hours' else interval '36 hours' end;

  if v_elapsed >= v_r1_threshold then
    insert into public.no_ghost_prompts (connection_id, user_id, trigger_id, fired_at)
    values (p_connection_id, v_recipient, 'R1', p_now)
    on conflict (connection_id, user_id, trigger_id) do nothing;
  end if;

  if v_elapsed >= interval '72 hours' then
    insert into public.no_ghost_prompts (connection_id, user_id, trigger_id, fired_at)
    values (p_connection_id, v_recipient, 'R2', p_now)
    on conflict (connection_id, user_id, trigger_id) do nothing;
  end if;

  if v_elapsed >= interval '120 hours' then
    insert into public.no_ghost_prompts (connection_id, user_id, trigger_id, fired_at)
    values (p_connection_id, v_recipient, 'R3', p_now)
    on conflict (connection_id, user_id, trigger_id) do nothing;
  end if;

  if v_elapsed >= interval '125 hours' then
    insert into public.no_ghost_prompts (connection_id, user_id, trigger_id, fired_at)
    values (p_connection_id, v_sender, 'S1', p_now)
    on conflict (connection_id, user_id, trigger_id) do nothing;
  end if;

  if v_elapsed >= interval '168 hours' and v_status is distinct from 'inactive' then
    update public.connections set status = 'inactive' where id = p_connection_id;
  end if;
end;
$$;

create or replace function public.run_no_ghost_check_all(p_now timestamp with time zone default now())
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_conn record;
begin
  for v_conn in
    select id from public.connections
    where status is null or status not in ('paused', 'inactive', 'passed', 'blocked', 'ended')
  loop
    perform public.run_no_ghost_check(v_conn.id, p_now);
  end loop;
end;
$$;

create or replace function public.run_meetup_checkin_check(p_connection_id uuid, p_now timestamp with time zone default now())
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_conn record;
  v_date_driven boolean;
begin
  select last_plan_activity_at, user_a_id, user_b_id, status, next_meetup_date, next_meetup_status
  into v_conn
  from public.connections
  where id = p_connection_id;

  if not found then
    return 'no_activity_recorded';
  end if;

  if v_conn.status is not null and v_conn.status in ('paused', 'inactive', 'passed', 'blocked', 'ended') then
    return 'connection_not_eligible';
  end if;

  v_date_driven := v_conn.next_meetup_status = 'confirmed' and v_conn.next_meetup_date is not null;

  if not v_date_driven and v_conn.last_plan_activity_at is null then
    return 'no_activity_recorded';
  end if;

  if exists (select 1 from public.meetup_checkins where connection_id = p_connection_id) then
    return 'already_fired_this_cycle';
  end if;

  if v_date_driven then
    if (p_now at time zone 'utc')::date <= v_conn.next_meetup_date then
      return 'not_enough_time_elapsed';
    end if;
  else
    if p_now - v_conn.last_plan_activity_at < interval '7 days' then
      return 'not_enough_time_elapsed';
    end if;
  end if;

  insert into public.meetup_checkins (connection_id, user_id, fired_at)
  values
    (p_connection_id, v_conn.user_a_id, p_now),
    (p_connection_id, v_conn.user_b_id, p_now);

  if v_date_driven then
    update public.connections
    set next_meetup_date = null, next_meetup_status = null, next_meetup_proposed_by = null
    where id = p_connection_id;
  end if;

  return 'fired';
end;
$$;

create or replace function public.run_meetup_checkin_check_all(p_now timestamp with time zone default now())
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_conn record;
begin
  for v_conn in
    select id from public.connections
    where (last_plan_activity_at is not null or (next_meetup_status = 'confirmed' and next_meetup_date is not null))
      and (status is null or status not in ('paused', 'inactive', 'passed', 'blocked', 'ended'))
  loop
    perform public.run_meetup_checkin_check(v_conn.id, p_now);
  end loop;
end;
$$;

-- 7. Messaging must actually stop for an ended connection, at the RLS
-- layer, not just the client hiding the compose box. Same
-- drop-and-recreate-with-one-more-exclusion pattern the photo gate
-- (20260807000000) and the messaging_preference gate (20260814000000)
-- both already used on this exact policy.
drop policy if exists "Participants can send messages in their connection" on public.messages;
create policy "Participants can send messages in their connection"
  on public.messages for insert
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.connections c
      where c.id = messages.connection_id
        and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
        and c.status is distinct from 'blocked'
        and c.status is distinct from 'inactive'
        and c.status is distinct from 'ended'
    )
    and (
      connection_has_any_message(connection_id)
      or (
        exists (select 1 from public.profiles pr where pr.user_id = auth.uid() and pr.photo_url is not null)
        and first_message_allowed_by_preference(connection_id, auth.uid())
      )
    )
  );
