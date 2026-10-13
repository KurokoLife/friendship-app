-- 2026-10-13: graduation no longer needs a meeting pace to be set.
-- Safe to run twice. Founder decision (docs/DECISIONS.md, Graduation).
--
-- The ready check ("Could you two keep this going outside Limen?") came
-- only when a pace had been set in the plan card, which quietly blocked
-- people who never tapped "Set your pace", without telling them why. The
-- meetups themselves show the rhythm. Everything else is unchanged: 6+
-- meetups, the first 8+ weeks ago, each person planned 2+; decision point
-- at 10 meetups or 6 months. Twice a month reaches the ready check in
-- about 3 months.
-- limen_db_version() -> 20261013000000.

create or replace function public.graduation_stage(p_connection_id uuid, p_viewer_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conn record;
  v_occurred integer;
  v_first_date date;
  v_a_proposals integer;
  v_b_proposals integer;
  v_r record;
  v_has_r boolean;
begin
  select * into v_conn from public.connections
  where id = p_connection_id and (user_a_id = p_viewer_id or user_b_id = p_viewer_id);
  if not found or v_conn.status in ('graduated', 'blocked', 'ended', 'passed') then
    return null;
  end if;

  select count(*), min(coalesce(occurred_date, confirmed_date, proposed_date))
    into v_occurred, v_first_date
  from public.meetups where connection_id = p_connection_id and status = 'occurred';

  select count(*) filter (where root.proposed_by = v_conn.user_a_id),
         count(*) filter (where root.proposed_by = v_conn.user_b_id)
    into v_a_proposals, v_b_proposals
  from public.meetups root
  where root.connection_id = p_connection_id
    and coalesce(root.plan_root_id, root.id) = root.id
    and exists (
      select 1 from public.meetups v
      where coalesce(v.plan_root_id, v.id) = root.id
        and v.status not in ('cancelled', 'rescheduled'));


  select * into v_r from public.graduation_readiness
  where connection_id = p_connection_id and user_id = p_viewer_id;
  v_has_r := found;

  -- Decision point: 10 meetups, or 6 months since the connection began.
  if v_occurred >= 10 or now() >= v_conn.created_at + interval '6 months' then
    if v_occurred < 1 then
      return null; -- never met: no-ghost / restart flows handle this, not graduation
    end if;
    if not v_has_r or coalesce(v_r.stage, '') <> 'decision_point' then
      return 'decision_point';
    end if;
    -- Answered at the decision point: ask again every 60 days.
    if v_r.created_at < now() - interval '60 days' then
      return 'decision_point';
    end if;
    return null;
  end if;

  -- Earliest point: ready check.
  if v_occurred >= 6
     and v_first_date is not null and v_first_date <= (now() - interval '56 days')::date
     and v_a_proposals >= 2 and v_b_proposals >= 2 then
    if not v_has_r or v_r.created_at < now() - interval '28 days' then
      return 'ready_check';
    end if;
  end if;

  return null;
end;
$$;

grant execute on function public.graduation_stage(uuid, uuid) to authenticated;

create or replace function public.limen_db_version()
returns text
language sql
stable
as $function$ select '20261013000000'::text $function$;
grant execute on function public.limen_db_version() to anon, authenticated;
