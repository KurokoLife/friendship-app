-- Bug fix: the Dev tab's "Meetup milestone testing" appeared completely
-- broken (backdate + run evaluator produced no checkin card on either
-- participant's Chat screen). Reproduced directly, confirmed the real
-- cause before writing anything: run_meetup_checkin_check silently
-- returns early whenever the connection's status is paused/inactive/
-- passed (a deliberate, correct guard, matching no-ghost's own evaluator
-- exactly), but it returned void, so dev_run_meetup_checkin_check and
-- the Dev tab's status message both claimed success regardless of
-- whether anything actually happened. Confirmed live that this is not a
-- one-off bad pick: every currently selectable seed connection (the ones
-- with real messages, the only ones the Dev tab's picker can show) is
-- either 'inactive' or 'blocked' from this project's own accumulated
-- testing history, so the exact reported steps fail the same way for
-- ANY thread a tester currently picks, not just an unlucky one. The
-- underlying schema/evaluator/Chat-UI wiring (get_meetup_checkin_status,
-- MeetupCheckinCard, MeetupOutcomeCard) was checked directly and is
-- correct, this is a dev-tooling visibility bug, not a rebuild.

drop function if exists public.run_meetup_checkin_check(uuid, timestamptz);
drop function if exists public.dev_run_meetup_checkin_check(uuid, timestamptz);

-- Same logic as before, now returns a real outcome instead of void, so
-- callers that care (the dev tool) can tell the difference between
-- "fired," "nothing to do yet," and "blocked," instead of all three
-- looking identical. run_meetup_checkin_check_all still calls this via
-- `perform`, which discards the return value, so the real hourly cron
-- path is unaffected either way.
create or replace function public.run_meetup_checkin_check(p_connection_id uuid, p_now timestamptz default now())
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

  if v_conn.status is not null and v_conn.status in ('paused', 'inactive', 'passed') then
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

create or replace function public.dev_run_meetup_checkin_check(p_connection_id uuid, p_now timestamptz)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result text;
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

  select public.run_meetup_checkin_check(p_connection_id, p_now) into v_result;
  return v_result;
end;
$$;

-- Dev-only: flips a connection's status back to 'active' so a stuck test
-- thread (inactive, or paused with no other test path back to active)
-- can actually be used to exercise the checkin evaluator. Deliberately
-- refuses a 'blocked' connection, unlike pause/inactive this is a real
-- safety feature (Report & Block), a dev convenience button should not
-- be able to quietly undo it, pick a different thread instead.
create or replace function public.dev_reactivate_connection_for_testing(p_connection_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select status into v_status from public.connections
  where id = p_connection_id
    and (user_a_id = auth.uid() or user_b_id = auth.uid());

  if not found then
    raise exception 'Not a participant of this connection';
  end if;

  if v_status = 'blocked' then
    raise exception 'This connection is blocked, pick a different thread to test with instead of reactivating it.';
  end if;

  update public.connections set status = 'active' where id = p_connection_id;
end;
$$;

grant execute on function public.run_meetup_checkin_check(uuid, timestamptz) to authenticated;
grant execute on function public.dev_run_meetup_checkin_check(uuid, timestamptz) to authenticated;
grant execute on function public.dev_reactivate_connection_for_testing(uuid) to authenticated;
