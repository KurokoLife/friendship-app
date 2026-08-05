-- Investigation, 2026-08-13: a connection transitioning to 'blocked' or
-- 'inactive' left any already-fired no_ghost_prompts row (and any
-- unresolved meetup_checkins row) sitting around untouched, no code path
-- anywhere cleared either table on that transition. Confirmed live and
-- systemic across every real way a connection reaches either status, not
-- isolated to the Jordan Blake/David Chen case that surfaced it:
--   - block_user() -> 'blocked': never clears either table.
--   - unblock_user() -> 'inactive': never clears either table (this is
--     the exact case that surfaced the bug, see the 2026-08-11 session).
--   - set_connection_inactive() (S1's "Close and make room for
--     another") -> 'inactive': never clears either table (the caller
--     dismisses the ONE prompt that triggered it, but not any other
--     lingering row, and never touches meetup_checkins at all).
--   - run_no_ghost_check()'s own 168-hour auto-close -> 'inactive':
--     never clears the R1/R2/R3/S1 rows it itself inserted at earlier
--     thresholds in the very same function run.
--
-- A second, more severe bug found in the same investigation: neither
-- run_no_ghost_check()/run_no_ghost_check_all() nor
-- run_meetup_checkin_check()/run_meetup_checkin_check_all() ever
-- excluded 'blocked' from their own eligibility guards (only
-- 'paused'/'inactive'/'passed' were excluded), so a blocked connection
-- with real message history keeps accumulating brand-new R1/R2/R3/S1
-- and meetup_checkins rows on every future cron run, indefinitely, not
-- just carrying forward one stale row from before the block.
--
-- UI exposure differs by surface: Inbox's "A reply is overdue" label
-- (inbox.tsx) is correctly suppressed for 'blocked' today (its own
-- section-bucketing checks connection_status first), but NOT for
-- 'inactive', which is the literal leak this investigation was asked to
-- confirm. The Thread screen's meetup checkin/outcome cards are already
-- suppressed for both 'blocked' and 'inactive' (2026-08-11 session), so
-- meetup_checkins has no live UI leak today, but the same underlying
-- data-hygiene and continued-generation bugs apply to it identically,
-- and nothing guarantees no future surface (Inbox, a notification, a
-- Dev tab summary) reads it without the same status check.
--
-- Fixed at the root rather than patched per call site: one trigger,
-- fired on any transition INTO 'blocked' or 'inactive' regardless of
-- which of the four paths above caused it, plus a guard-list fix on both
-- evaluators so a blocked connection stops accumulating new rows going
-- forward. no_ghost_prompts is deleted unconditionally, matching the
-- existing clear_no_ghost_on_new_message trigger's own precedent (a
-- full delete on the connection's own natural "this is now stale"
-- event, not a soft dismiss, and not something anything in this
-- codebase currently treats as a permanent historical log, a new
-- message already wipes it the same way). meetup_checkins only deletes
-- unresolved rows (resolved_at is null): an already-resolved row is a
-- real historical fact (whether meetup_count incremented already
-- happened via resolve_meetup_checkin, independent of this row's own
-- continued existence), not a stale prompt asking for action, so it's
-- deliberately preserved.

-- Retroactive cleanup: connections already sitting in either state
-- right now, confirmed via the same investigation to include real,
-- currently-misleading rows (not hypothetical).
delete from public.no_ghost_prompts
where connection_id in (select id from public.connections where status in ('blocked', 'inactive'));

delete from public.meetup_checkins
where resolved_at is null
  and connection_id in (select id from public.connections where status in ('blocked', 'inactive'));

create or replace function public.clear_prompts_on_connection_closed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('blocked', 'inactive') and (old.status is distinct from new.status) then
    delete from public.no_ghost_prompts where connection_id = new.id;
    delete from public.meetup_checkins where connection_id = new.id and resolved_at is null;
  end if;
  return new;
end;
$$;

drop trigger if exists connections_clear_prompts_on_closed on public.connections;
create trigger connections_clear_prompts_on_closed
after update of status on public.connections
for each row
execute function public.clear_prompts_on_connection_closed();

-- Stop generating new prompts for a blocked connection going forward,
-- the second bug found above. Bodies otherwise byte-identical to the
-- live versions (confirmed via pg_get_functiondef before writing this),
-- only 'blocked' added to each existing guard list.
create or replace function public.run_no_ghost_check(p_connection_id uuid, p_now timestamp with time zone default now())
returns void
language plpgsql
security definer
set search_path = public
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

  if v_status is not null and v_status in ('paused', 'inactive', 'passed', 'blocked') then
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
set search_path = public
as $$
declare
  v_conn record;
begin
  for v_conn in
    select id from public.connections
    where status is null or status not in ('paused', 'inactive', 'passed', 'blocked')
  loop
    perform public.run_no_ghost_check(v_conn.id, p_now);
  end loop;
end;
$$;

create or replace function public.run_meetup_checkin_check(p_connection_id uuid, p_now timestamp with time zone default now())
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conn record;
begin
  select last_plan_activity_at, user_a_id, user_b_id, status
  into v_conn
  from public.connections
  where id = p_connection_id;

  if not found or v_conn.last_plan_activity_at is null then
    return 'no_activity_recorded';
  end if;

  if v_conn.status is not null and v_conn.status in ('paused', 'inactive', 'passed', 'blocked') then
    return 'connection_not_eligible';
  end if;

  if p_now - v_conn.last_plan_activity_at < interval '7 days' then
    return 'not_enough_time_elapsed';
  end if;

  if exists (select 1 from public.meetup_checkins where connection_id = p_connection_id) then
    return 'already_fired_this_cycle';
  end if;

  insert into public.meetup_checkins (connection_id, user_id, fired_at)
  values
    (p_connection_id, v_conn.user_a_id, p_now),
    (p_connection_id, v_conn.user_b_id, p_now);

  return 'fired';
end;
$$;

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
    where last_plan_activity_at is not null
      and (status is null or status not in ('paused', 'inactive', 'passed', 'blocked'))
  loop
    perform public.run_meetup_checkin_check(v_conn.id, p_now);
  end loop;
end;
$$;
