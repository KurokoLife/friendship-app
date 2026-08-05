-- Real bug found: run_meetup_checkin_check's v_date_driven flag is only
-- true once next_meetup_status = 'confirmed', never for 'proposed'. A
-- proposed-but-not-yet-confirmed date therefore fell all the way through
-- to the elapsed-time fallback branch (last_plan_activity_at + 7 days,
-- built for a genuinely different case, "plans discussed, no date ever
-- proposed, time has passed"), which has no awareness a real, live
-- proposal is still sitting there waiting on the other participant. A
-- connection could get a "how did it go" check-in while a real,
-- unconfirmed, not-yet-passed date was still pending, confirmed
-- reproducible against the live function before this fix.
--
-- Fix: a genuinely 'proposed' (not yet confirmed) date now blocks the
-- elapsed-time fallback outright, distinct from 'no_activity_recorded'
-- so the real reason is visible to callers (including the Dev tab's own
-- outcome-message display). The legitimate no-date-ever-proposed case is
-- untouched: next_meetup_status is null there, not 'proposed', so it
-- still reaches the unchanged 7-day fallback exactly as before.
create or replace function public.run_meetup_checkin_check(p_connection_id uuid, p_now timestamptz default now())
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

  if v_conn.status is not null and v_conn.status in ('paused', 'inactive', 'passed', 'blocked', 'ended') then
    return 'connection_not_eligible';
  end if;

  v_date_driven := v_conn.next_meetup_status = 'confirmed' and v_conn.next_meetup_date is not null;

  if not v_date_driven and v_conn.next_meetup_status = 'proposed' then
    return 'date_pending_confirmation';
  end if;

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
