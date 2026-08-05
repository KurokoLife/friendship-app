-- Item 4, 2026-08-16: the next-meetup date UI. A real, optional date a
-- connection can plan around, layered on top of the existing milestone/
-- elapsed-time system (2026-07-28 redesign) rather than replacing it.
-- "No date ever set falls back to exactly today's behavior" is the
-- literal constraint this whole migration is built to satisfy: every
-- existing connection with no next_meetup_date continues through the
-- unmodified last_plan_activity_at + 7 days path, byte-for-byte.
--
-- Schema: three columns on connections (not a separate table), matching
-- last_plan_activity_at's own precedent of a single mutable per-
-- connection value rather than an event log, since only ONE meetup can
-- be planned at a time. next_meetup_date/next_meetup_status are always
-- both null or both set together (no separate "cleared" status value,
-- same null-means-absent convention remember_entries.meetup_date
-- already uses).
alter table public.connections
  add column if not exists next_meetup_date date,
  add column if not exists next_meetup_status text check (next_meetup_status in ('proposed', 'confirmed')),
  add column if not exists next_meetup_proposed_by uuid references auth.users(id);

-- propose_next_meetup: also used for rescheduling (spec: "Rescheduling
-- reverts to proposed, needs one re-confirm tap") — calling this again
-- on an already-confirmed date unconditionally resets status back to
-- 'proposed' and updates proposed_by to the new caller, no separate
-- "reschedule" RPC needed, one code path covers both. SECURITY DEFINER
-- for the same reason pause_connection/resume_connection/
-- set_connection_inactive already are: connections' own UPDATE RLS only
-- lets user_a_id write directly, and either participant needs to be
-- able to propose. Also touches last_plan_activity_at (proposing a date
-- is real planning activity) and clears any stale unresolved
-- meetup_checkins, mirroring record_plan_activity's own exact reasoning
-- ("a fresh cycle starting over") for the same kind of event.
create or replace function public.propose_next_meetup(p_connection_id uuid, p_date date)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1 from public.connections c
    where c.id = p_connection_id
      and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
  ) then
    raise exception 'Not a participant of this connection';
  end if;

  update public.connections
  set next_meetup_date = p_date,
      next_meetup_status = 'proposed',
      next_meetup_proposed_by = auth.uid(),
      last_plan_activity_at = now()
  where id = p_connection_id;

  delete from public.meetup_checkins where connection_id = p_connection_id;
end;
$$;

grant execute on function public.propose_next_meetup(uuid, date) to authenticated;

-- confirm_next_meetup: only the participant who did NOT propose it may
-- confirm, same "can't confirm your own plan" rule the original
-- propose_meetup/confirm_meetup system already established before the
-- 2026-07-28 redesign removed it, reinstated here since mutual
-- confirmation is exactly what this feature is (one tap, not a full
-- re-propose).
create or replace function public.confirm_next_meetup(p_connection_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proposed_by uuid;
  v_status text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select next_meetup_proposed_by, next_meetup_status into v_proposed_by, v_status
  from public.connections c
  where c.id = p_connection_id
    and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid());

  if not found then
    raise exception 'Not a participant of this connection';
  end if;

  if v_status is distinct from 'proposed' then
    raise exception 'No proposed date to confirm';
  end if;

  if v_proposed_by = auth.uid() then
    raise exception 'The proposer cannot also confirm their own date';
  end if;

  update public.connections set next_meetup_status = 'confirmed' where id = p_connection_id;
end;
$$;

grant execute on function public.confirm_next_meetup(uuid) to authenticated;

-- Day-of feeling check ack. A private, per-user, per-date-cycle record
-- (own-row RLS, matching first_meetup_feelings' exact established
-- pattern), deliberately keyed by meetup_date rather than a single
-- once-ever row: unlike first_meetup_feelings (fires once per
-- connection, ever, on the very first "Let's plan something"
-- engagement), this is meant to recur for every future confirmed date,
-- and keying by date means a new meetup cycle automatically gets its
-- own fresh, un-acked row with no explicit clearing logic needed.
-- `feeling` only accepts 'neutral' today, a real column ready for real
-- values later rather than a boolean, per the given "Neutral placeholder,
-- real video routing deferred" scope, not inventing options that don't
-- exist yet.
create table public.next_meetup_feelings (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.connections(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  meetup_date date not null,
  feeling text not null default 'neutral' check (feeling in ('neutral')),
  created_at timestamptz not null default now(),
  unique (connection_id, user_id, meetup_date)
);

alter table public.next_meetup_feelings enable row level security;

create policy "Users can read their own next-meetup feelings"
  on public.next_meetup_feelings for select
  using (auth.uid() = user_id);

create policy "Users can insert their own next-meetup feelings"
  on public.next_meetup_feelings for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.connections c
      where c.id = connection_id
        and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
    )
  );

-- run_meetup_checkin_check: the one real behavior change, gated so the
-- "no date ever set" case is provably unaffected. v_date_driven is only
-- ever true when a real confirmed date exists; every branch below falls
-- through to the exact original last_plan_activity_at + 7 days logic
-- otherwise, byte-for-byte, confirmed by re-reading the live function
-- via pg_get_functiondef before writing this rather than reconstructing
-- it from memory.
create or replace function public.run_meetup_checkin_check(p_connection_id uuid, p_now timestamp with time zone default now())
returns text
language plpgsql
security definer
set search_path = public
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

  if v_conn.status is not null and v_conn.status in ('paused', 'inactive', 'passed', 'blocked') then
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
    -- Day-AFTER the confirmed date, in the database's own UTC session,
    -- matching this project's own established elapsed-time convention
    -- (F17/F21's identical reasoning, cited in both those features' own
    -- migration comments) rather than any one participant's local
    -- timezone.
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

  -- Once the date-driven cycle actually fires, clear the confirmed slot
  -- so the thread's own "Next meetup" indicator naturally resets to "no
  -- meetup planned" instead of continuing to show a date whose own
  -- check-in has already started. Only touched when IT was the reason
  -- this fired, the 7-day fallback path never had a confirmed date to
  -- clear in the first place.
  if v_date_driven then
    update public.connections
    set next_meetup_date = null, next_meetup_status = null, next_meetup_proposed_by = null
    where id = p_connection_id;
  end if;

  return 'fired';
end;
$$;

-- run_meetup_checkin_check_all: widened to also sweep connections whose
-- only real activity signal is a confirmed next_meetup_date (a
-- connection could in principle have that without last_plan_activity_at
-- predating it in some edge case, though propose_next_meetup always
-- sets both together in practice; this is the honest, complete
-- condition rather than relying on that always being true). The
-- no-date, no-plan-activity case is still correctly excluded entirely,
-- unchanged.
create or replace function public.run_meetup_checkin_check_all(p_now timestamp with time zone default now())
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conn record;
begin
  for v_conn in
    select id from public.connections
    where (last_plan_activity_at is not null or (next_meetup_status = 'confirmed' and next_meetup_date is not null))
      and (status is null or status not in ('paused', 'inactive', 'passed', 'blocked'))
  loop
    perform public.run_meetup_checkin_check(v_conn.id, p_now);
  end loop;
end;
$$;
