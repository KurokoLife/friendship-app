-- "Quick Tests" section (Dev tab, __DEV__-only): one-tap end-to-end tests
-- for no-ghost, meetup checkin, and meetup-confirmation/graduation. Each
-- wraps the SAME real evaluator functions the granular tools already call
-- (run_no_ghost_check, run_meetup_checkin_check), it does not duplicate
-- their logic, only adds a reset step beforehand and a rich, cross-
-- participant report afterward.
--
-- The report step is why these need to be real SECURITY DEFINER functions
-- rather than a client-side sequence of the existing granular RPCs: both
-- no_ghost_prompts and meetup_checkins are self-row SELECT RLS (confirmed
-- directly via pg_policies before writing this), so whichever account is
-- signed in in the Dev tab cannot see a prompt/checkin row that landed on
-- the OTHER participant. A thin wrapper that also reads back the result
-- (bypassing that self-row restriction, the same way dev_get_connection_info
-- already does for gender/last-sender) is the only way to show a
-- genuinely complete "who it fired for" report from one session.

-- 1. No-ghost end-to-end: clears existing prompt state for the connection
-- (same delete dev_reset_no_ghost already does), runs the real evaluator
-- with a fixed +40 hour offset, then reports which trigger(s) fired and
-- for whom. 40 hours is a deliberate choice, not arbitrary: both possible
-- R1 thresholds (20h for a "Same day" responder, 36h otherwise) are under
-- 40, while R2's 72h threshold is not, so this offset reliably fires
-- exactly R1, a single, unambiguous, real outcome to report, rather than
-- a threshold that might fire zero, one, or several triggers depending on
-- the specific connection's data.
create or replace function public.dev_test_no_ghost_end_to_end(p_connection_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fake_now timestamptz := now() + interval '40 hours';
  v_last_sender uuid;
  v_status_after text;
  v_fired jsonb;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not exists (
    select 1 from public.connections c
    where c.id = p_connection_id and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
  ) then
    raise exception 'Not a participant of this connection';
  end if;

  delete from public.no_ghost_prompts where connection_id = p_connection_id;

  select sender_id into v_last_sender
  from public.messages
  where connection_id = p_connection_id
  order by created_at desc
  limit 1;

  if v_last_sender is null then
    return jsonb_build_object('has_messages', false);
  end if;

  perform public.run_no_ghost_check(p_connection_id, v_fake_now);

  select coalesce(jsonb_agg(jsonb_build_object(
           'trigger_id', np.trigger_id,
           'user_id', np.user_id,
           'display_name', p.display_name,
           'role', case when np.user_id = c.user_a_id then 'A' else 'B' end
         ) order by np.trigger_id), '[]'::jsonb)
  into v_fired
  from public.no_ghost_prompts np
  join public.connections c on c.id = np.connection_id
  left join public.profiles p on p.user_id = np.user_id
  where np.connection_id = p_connection_id;

  select status into v_status_after from public.connections where id = p_connection_id;

  return jsonb_build_object(
    'has_messages', true,
    'hours_offset', 40,
    'last_sender_id', v_last_sender,
    'fired', v_fired,
    'status_after', v_status_after
  );
end;
$$;

-- 2. Meetup checkin end-to-end: clears existing checkin rows (same delete
-- dev_reset_meetup_checkins already does), clears any pending next-meetup
-- proposal (so a real, still-open date proposal on the connection can't
-- cause a spurious 'date_pending_confirmation' abort, matching what a
-- tester would otherwise have to clear by hand first), backdates
-- last_plan_activity_at past the real 7-day threshold, runs the real
-- evaluator, and reports its real outcome plus (when it fired) both
-- participants' names.
create or replace function public.dev_test_meetup_checkin_end_to_end(p_connection_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result text;
  v_checkins jsonb;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not exists (
    select 1 from public.connections c
    where c.id = p_connection_id and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
  ) then
    raise exception 'Not a participant of this connection';
  end if;

  delete from public.meetup_checkins where connection_id = p_connection_id;

  update public.connections
  set last_plan_activity_at = now() - interval '200 hours',
      next_meetup_date = null,
      next_meetup_status = null,
      next_meetup_proposed_by = null
  where id = p_connection_id;

  select public.run_meetup_checkin_check(p_connection_id, now()) into v_result;

  if v_result = 'fired' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'user_id', mc.user_id,
             'display_name', p.display_name
           )), '[]'::jsonb)
    into v_checkins
    from public.meetup_checkins mc
    left join public.profiles p on p.user_id = mc.user_id
    where mc.connection_id = p_connection_id;
  else
    v_checkins := null;
  end if;

  return jsonb_build_object('outcome', v_result, 'checkins', v_checkins);
end;
$$;

-- 3. Meetup-confirmation + graduation end-to-end: pushes a connection
-- through real, mutually-confirmed meetups up to a target meetup_count
-- (default the real graduation threshold, 5), then reports whether the
-- real shouldShowGraduationPrompt condition is now met.
--
-- Genuine design constraint, not a shortcut taken for convenience: the
-- real mutual-confirm mechanism (resolve_meetup_checkin, then
-- resolve_meetup_confirmation) requires two DIFFERENT signed-in
-- identities, one to report and one to confirm, both gated on auth.uid()
-- matching the row's own owner. A single Dev-tab session is only ever
-- signed in as one of them, so this cannot literally call those two RLS-
-- gated functions for both sides without a real account switch between
-- every single cycle. Rather than either (a) requiring the tester to
-- manually switch accounts mid-test, defeating "push through several
-- meetups in one tap", or (b) a shortcut that directly sets meetup_count/
-- inserts into meetup_log, bypassing the mechanism entirely, this
-- function performs the IDENTICAL state transitions resolve_meetup_checkin
-- and resolve_meetup_confirmation perform (same tables, same columns, same
-- confirmation-request/meetup_log/meetup_count writes), just from one
-- SECURITY DEFINER context instead of two separate RLS-scoped calls. This
-- follows an already-established precedent in this exact codebase:
-- dev_send_backdated_message already lets a verified participant act as
-- EITHER side of a connection (an explicit p_sender_id, not just the
-- caller's own auth.uid()) for the same reason. Reporter is always user_a,
-- confirmer always user_b, outcome always 'went_well', a deliberate,
-- documented simplification since this test's purpose is exercising the
-- meetup_count/graduation threshold, not reciprocal-initiation coverage.
create or replace function public.dev_test_graduation_end_to_end(p_connection_id uuid, p_target_count integer default 5)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_a uuid;
  v_user_b uuid;
  v_current_count integer;
  v_needed integer;
  v_run_result text;
  v_reporter_checkin uuid;
  v_confirmer_checkin uuid;
  v_confirmer_resolved timestamptz;
  v_request_id uuid;
  v_pending_exists boolean;
  v_completed integer := 0;
  v_final record;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select user_a_id, user_b_id, meetup_count
  into v_user_a, v_user_b, v_current_count
  from public.connections
  where id = p_connection_id and (user_a_id = auth.uid() or user_b_id = auth.uid());
  if not found then
    raise exception 'Not a participant of this connection';
  end if;

  v_needed := greatest(p_target_count - v_current_count, 0);

  for i in 1..v_needed loop
    delete from public.meetup_checkins where connection_id = p_connection_id;

    update public.connections
    set last_plan_activity_at = now() - interval '200 hours',
        next_meetup_date = null,
        next_meetup_status = null,
        next_meetup_proposed_by = null
    where id = p_connection_id;

    select public.run_meetup_checkin_check(p_connection_id, now()) into v_run_result;

    if v_run_result <> 'fired' then
      return jsonb_build_object(
        'completed_cycles', v_completed,
        'target_reached', false,
        'abort_reason', v_run_result
      );
    end if;

    select id into v_reporter_checkin
    from public.meetup_checkins where connection_id = p_connection_id and user_id = v_user_a;
    select id, resolved_at into v_confirmer_checkin, v_confirmer_resolved
    from public.meetup_checkins where connection_id = p_connection_id and user_id = v_user_b;

    -- Mirrors resolve_meetup_checkin's own body exactly, for the reporter side.
    update public.meetup_checkins set outcome = 'went_well', resolved_at = now() where id = v_reporter_checkin;
    if v_confirmer_resolved is null then
      update public.meetup_checkins set other_reported_outcome = 'went_well' where id = v_confirmer_checkin;
    end if;

    select exists (
      select 1 from public.meetup_confirmation_requests r
      where r.connection_id = p_connection_id and r.resolved_at is null and r.dismissed_at is null
    ) into v_pending_exists;

    if not v_pending_exists then
      insert into public.meetup_confirmation_requests (
        connection_id, reporter_id, confirmer_id, source_checkin_id, reported_outcome, reported_meetup_date
      ) values (
        p_connection_id, v_user_a, v_user_b, v_reporter_checkin, 'went_well', (now() at time zone 'utc')::date
      );
    end if;

    select id into v_request_id
    from public.meetup_confirmation_requests
    where connection_id = p_connection_id and resolved_at is null
    order by created_at desc
    limit 1;

    -- Mirrors resolve_meetup_confirmation's own body exactly, for the confirmer side.
    update public.meetup_confirmation_requests
    set resolution = 'confirmed', resolved_at = now()
    where id = v_request_id;

    insert into public.meetup_log (connection_id, meetup_date, outcome)
    values (p_connection_id, (now() at time zone 'utc')::date, 'went_well');

    update public.connections set meetup_count = meetup_count + 1 where id = p_connection_id;

    v_completed := v_completed + 1;
  end loop;

  select meetup_count, status, graduation_dismissed_at_count
  into v_final
  from public.connections where id = p_connection_id;

  return jsonb_build_object(
    'completed_cycles', v_completed,
    'target_reached', true,
    'final_meetup_count', v_final.meetup_count,
    'status', v_final.status,
    'graduation_dismissed_at_count', v_final.graduation_dismissed_at_count
  );
end;
$$;
