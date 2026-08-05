-- Fix #3 of 23: capacity system (blueprint Sections 8/9/25, locked
-- decision). Verified live before writing this: no premium/tier column
-- existed anywhere (grepped users/profiles), no daily suggestion cap,
-- no active-conversation cap, no pending-Say-Hi cap, no ranking boost
-- tied to premium/social_linked (confirmed by reading the full scoring
-- model in generate-match-suggestions, none of its functions reference
-- either field). All of it was genuinely missing, not just undocumented
-- like Fix #1/#2 turned out to be.
--
-- Real, separate, pre-existing gap found while designing this: nothing
-- in this codebase has ever transitioned a connection's status to
-- 'active' (confirmed live, zero rows with status = 'active' in the
-- database). "Active conversation" is therefore computed here directly
-- from real message exchange (messages from both participants), exactly
-- matching the given spec's own definition ("once a connection has
-- messages flowing both directions, it counts toward the cap"), rather
-- than depending on a status value nothing ever sets. Not fixing the
-- unrelated pending-to-active status gap here, out of scope for this
-- fix, flagged in PROGRESS.md instead.

-- Premium/subscription tier: no billing integration exists in this
-- project (no RevenueCat/Stripe/IAP library in package.json, confirmed
-- before adding this), so this is the underlying flag a future
-- Premium/Upgrade screen (AGENTS.md, confirmed unbuilt) would set via a
-- real payment webhook. Lives on `users`, matching where `verified`/
-- `social_linked` already live, same "account-level fact" category.
alter table public.users
  add column if not exists is_premium boolean not null default false;

-- Replaces the client-side select-then-insert in getOrCreateConnectionId
-- (src/lib/connections.ts). SECURITY DEFINER so the cap check and the
-- insert happen atomically from the server's own perspective, matching
-- every other write-RPC in this project rather than trusting a client
-- to have checked its own cap first. Reusing an EXISTING connection
-- (either direction) is exempt from the cap entirely, only a genuinely
-- NEW connection counts as "initiating a new conversation" per the
-- given spec ("browsing itself is unlimited, initiating a NEW
-- conversation... must respect the cap").
create or replace function public.create_connection_with_capacity_check(p_other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
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

  select id, status into v_existing_id, v_existing_status
  from public.connections
  where (user_a_id = v_caller and user_b_id = p_other_user_id)
     or (user_a_id = p_other_user_id and user_b_id = v_caller)
  limit 1;

  if v_existing_id is not null then
    if v_existing_status is distinct from 'active' then
      update public.connections set status = 'pending' where id = v_existing_id;
    end if;
    return v_existing_id;
  end if;

  select coalesce(is_premium, false) into v_is_premium from public.users where id = v_caller;
  v_active_cap := case when v_is_premium then 8 else 4 end;
  v_pending_cap := case when v_is_premium then 8 else 5 end;

  -- Active: real bidirectional message exchange on a connection that
  -- isn't in a terminal or frozen state. 'inactive' is this app's only
  -- real "closed" state today (Graduation doesn't exist yet, confirmed,
  -- its status value must be added here once it does).
  select count(*) into v_active_count
  from public.connections c
  where (c.user_a_id = v_caller or c.user_b_id = v_caller)
    and (c.status is null or c.status not in ('passed', 'inactive', 'paused'))
    and exists (select 1 from public.messages m where m.connection_id = c.id and m.sender_id = v_caller)
    and exists (select 1 from public.messages m where m.connection_id = c.id and m.sender_id <> v_caller);

  -- Pending: the caller has sent at least one message and the other
  -- participant has sent none yet, "sent, awaiting reply" per the given
  -- spec, an incoming unanswered Say Hi from someone else never counts
  -- against the recipient's own pending-sent cap.
  select count(*) into v_pending_count
  from public.connections c
  where (c.user_a_id = v_caller or c.user_b_id = v_caller)
    and (c.status is null or c.status not in ('passed', 'inactive', 'paused'))
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

grant execute on function public.create_connection_with_capacity_check(uuid) to authenticated;

-- Read-only, for the Inbox capacity indicator ("Show remaining
-- suggestion and conversation capacity calmly", blueprint's global
-- interaction rules). SECURITY INVOKER deliberately, not DEFINER: it
-- takes no parameters and always operates on auth.uid(), so existing
-- RLS on connections/messages/users (each already scoped to
-- participant-only or own-row) does the real access control here, this
-- function is just a convenience aggregation, not a privilege escalation.
create or replace function public.my_connection_capacity()
returns table (
  is_premium boolean,
  active_count integer,
  active_cap integer,
  pending_count integer,
  pending_cap integer
)
language sql
security invoker
stable
as $$
  select
    u.is_premium,
    (
      select count(*)::integer from public.connections c
      where (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
        and (c.status is null or c.status not in ('passed', 'inactive', 'paused'))
        and exists (select 1 from public.messages m where m.connection_id = c.id and m.sender_id = auth.uid())
        and exists (select 1 from public.messages m where m.connection_id = c.id and m.sender_id <> auth.uid())
    ) as active_count,
    case when u.is_premium then 8 else 4 end as active_cap,
    (
      select count(*)::integer from public.connections c
      where (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
        and (c.status is null or c.status not in ('passed', 'inactive', 'paused'))
        and exists (select 1 from public.messages m where m.connection_id = c.id and m.sender_id = auth.uid())
        and not exists (select 1 from public.messages m where m.connection_id = c.id and m.sender_id <> auth.uid())
    ) as pending_count,
    case when u.is_premium then 8 else 5 end as pending_cap
  from public.users u
  where u.id = auth.uid();
$$;

grant execute on function public.my_connection_capacity() to authenticated;
