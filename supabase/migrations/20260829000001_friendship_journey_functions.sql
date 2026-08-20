-- Friendship Journey rebuild — Phase 3, step 2: the full RPC/function layer.
--
-- Implements every function in FRIENDSHIP_JOURNEY_DESIGN.md. Nothing in this
-- migration touches, modifies, or disables any existing function, table, or
-- cron job. Two real discrepancies from the design doc were found and fixed
-- during implementation, both flagged in the final report rather than
-- silently patched:
--   1. The reconciliation section never actually specified the "both say No"
--      case, even though both the meetups.status check constraint
--      ('not_occurred') and the friendship_events table ("meetup_not_occurred
--      ... both reports agree no") already implied it existed. Implemented
--      now: both-No -> status = 'not_occurred', a clean mutual negative,
--      distinct from 'unresolved' (genuine ambiguity/disagreement/no-response).
--   2. The design doc's single 'meetup_not_occurred' event name was ambiguous
--      between "both agreed it didn't happen" and "timed out unresolved" --
--      two different facts. Split into 'meetup_not_occurred' (mutual no) and
--      a new 'meetup_occurrence_unresolved' event (disagreement or timeout),
--      so the shared event log doesn't conflate two different outcomes under
--      one name.
--
-- No new pg_cron schedules are created here. Every evaluator below is a
-- plain, directly-callable function (p_now-parameterized, matching this
-- project's own established evaluator convention), invoked only by explicit
-- test calls in this phase -- never on an automatic timer -- so nothing here
-- can generate a real production intervention until cutover explicitly wires
-- it into cron.

-- ============================================================
-- Single source of truth for "is this connection excluded from automation",
-- replacing the 9 duplicated exclusion arrays found drifted in Phase 1.
-- ============================================================
create or replace function public.is_connection_automation_eligible(p_status text)
returns boolean
language sql
immutable
as $$
  select p_status is null or p_status not in ('paused','inactive','blocked','ended','graduated','passed');
$$;

-- ============================================================
-- Stage progression (design doc §4)
-- ============================================================
create or replace function public.advance_friendship_stage(p_connection_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_status text;
  v_user_a uuid;
  v_user_b uuid;
  v_original_stage text;
  v_current text;
  v_occurred_count integer;
  v_moved boolean;
begin
  select status, user_a_id, user_b_id, friendship_stage
  into v_status, v_user_a, v_user_b, v_original_stage
  from public.connections where id = p_connection_id;

  if not found then
    return null;
  end if;
  if not public.is_connection_automation_eligible(v_status) then
    return null;
  end if;

  v_current := v_original_stage;
  select count(*) into v_occurred_count from public.meetups
    where connection_id = p_connection_id and status = 'occurred';

  loop
    v_moved := false;

    if v_current is null and exists (select 1 from public.messages where connection_id = p_connection_id) then
      v_current := 'first_contact'; v_moved := true;

    elsif v_current = 'first_contact'
      and exists (select 1 from public.messages where connection_id = p_connection_id and sender_id = v_user_a)
      and exists (select 1 from public.messages where connection_id = p_connection_id and sender_id = v_user_b) then
      v_current := 'conversation'; v_moved := true;

    elsif v_current = 'conversation'
      and exists (select 1 from public.meetups where connection_id = p_connection_id) then
      v_current := 'first_meetup_planning'; v_moved := true;

    -- Fixed during testing: was "sequence_number = 1 and status = 'occurred'".
    -- sequence_number increments on every reschedule, so the literal
    -- first-ever-proposed meetup can be rescheduled/cancelled and never
    -- occur, permanently blocking this transition even once a LATER meetup
    -- genuinely occurs. Uses the same count-based check as every other
    -- occurred-meetup-driven transition below instead.
    elsif v_current = 'first_meetup_planning' and v_occurred_count >= 1 then
      v_current := 'post_first_meetup'; v_moved := true;

    elsif v_current = 'post_first_meetup'
      and exists (select 1 from public.second_look_responses where connection_id = p_connection_id and response = 'yes') then
      v_current := 'early_friendship'; v_moved := true;

    elsif v_current = 'early_friendship' and v_occurred_count >= 2 then
      v_current := 'repeated_time'; v_moved := true;

    elsif v_current = 'repeated_time'
      and exists (select 1 from public.rhythm_preferences where connection_id = p_connection_id) then
      v_current := 'rhythm_established'; v_moved := true;
    end if;

    if v_current in ('repeated_time', 'rhythm_established') and v_occurred_count >= 5
       and v_current is distinct from 'graduation_eligible' then
      v_current := 'graduation_eligible'; v_moved := true;
    end if;

    exit when not v_moved;
  end loop;

  if v_current is distinct from v_original_stage then
    update public.connections
    set friendship_stage = v_current, friendship_stage_changed_at = now()
    where id = p_connection_id;

    insert into public.friendship_events (connection_id, actor_user_id, event_type, payload)
    values (p_connection_id, null, 'stage_changed',
      jsonb_build_object('from_stage', v_original_stage, 'to_stage', v_current));

    return v_current;
  end if;

  return null;
end;
$$;

-- ============================================================
-- is_self_sustaining -- reversible signal, deliberately decoupled from
-- friendship_stage (design doc §4a, Decision 10). Never called from within
-- advance_friendship_stage, never reads friendship_stage.
-- ============================================================
create or replace function public.evaluate_self_sustaining(p_connection_id uuid, p_now timestamptz default now())
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user_a uuid;
  v_user_b uuid;
  v_reciprocal boolean;
  v_organic boolean;
  v_quiet boolean;
  v_enough_history boolean;
  v_result boolean;
begin
  select user_a_id, user_b_id into v_user_a, v_user_b
  from public.connections where id = p_connection_id;
  if not found then
    return false;
  end if;

  v_reciprocal := exists (select 1 from public.meetups where connection_id = p_connection_id and proposed_by = v_user_a)
              and exists (select 1 from public.meetups where connection_id = p_connection_id and proposed_by = v_user_b);

  -- coalesce(x = false, false): true ONLY when a most-recent qualifying
  -- proposal exists AND is explicitly prompted_by_limen = false. An empty
  -- subquery (NULL) or an explicit true both fail the check.
  --
  -- Bug found and fixed during TC3 testing (2026-08-09): two meetup rows
  -- inserted within the same transaction can share an identical
  -- created_at (a known transaction-scoped now() artifact, the same class
  -- already fixed once in run_no_ghost_check_v2's own tiebreak), making
  -- "order by created_at desc limit 1" non-deterministic. Unlike that
  -- earlier fix (which used the messages table's own id as an arbitrary
  -- but deterministic tiebreak), meetups has a semantically meaningful,
  -- strictly-monotonic-per-connection tiebreak already: sequence_number,
  -- computed server-side as max(existing)+1 at insert time (see
  -- set_meetup_sequence_number()). Using it here is more correct than a
  -- synthetic id tiebreak, not just deterministic.
  v_organic := coalesce(
    (select prompted_by_limen from public.meetups
     where connection_id = p_connection_id and status in ('proposed','confirmed','occurred')
     order by created_at desc, sequence_number desc limit 1) = false,
    false
  );

  v_quiet := not exists (
    select 1 from public.connection_interventions
    where connection_id = p_connection_id
      and (intervention_type like 'no_ghost_%' or intervention_type = 'conversation_restart_prompt')
      and (status = 'pending' or created_at > p_now - interval '30 days')
  );

  v_enough_history := (select count(*) from public.meetups where connection_id = p_connection_id and status = 'occurred') >= 2;

  v_result := v_reciprocal and v_organic and v_quiet and v_enough_history;

  update public.connections
  set is_self_sustaining = v_result, is_self_sustaining_updated_at = p_now
  where id = p_connection_id;

  return v_result;
end;
$$;

create or replace function public.evaluate_self_sustaining_all(p_now timestamptz default now())
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_conn record;
begin
  for v_conn in
    select id from public.connections where status is null or public.is_connection_automation_eligible(status)
  loop
    perform public.evaluate_self_sustaining(v_conn.id, p_now);
  end loop;
end;
$$;

-- ============================================================
-- The shared event log writer (design doc §2)
-- ============================================================
create or replace function public.record_friendship_event(
  p_connection_id uuid,
  p_event_type text,
  p_actor_user_id uuid default null,
  p_payload jsonb default '{}'::jsonb
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not exists (select 1 from public.connections where id = p_connection_id) then
    raise exception 'Connection not found';
  end if;

  if p_actor_user_id is not null and not exists (
    select 1 from public.connections c
    where c.id = p_connection_id and (c.user_a_id = p_actor_user_id or c.user_b_id = p_actor_user_id)
  ) then
    raise exception 'actor_user_id is not a participant of this connection';
  end if;

  insert into public.friendship_events (connection_id, actor_user_id, event_type, payload)
  values (p_connection_id, p_actor_user_id, p_event_type, p_payload);

  return public.advance_friendship_stage(p_connection_id);
end;
$$;

-- ============================================================
-- The priority queue (design doc §6)
-- ============================================================
create or replace function public.raise_intervention(
  p_connection_id uuid,
  p_intervention_type text,
  p_target_user_id uuid default null,
  p_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
begin
  select id into v_id from public.connection_interventions
  where connection_id = p_connection_id
    and intervention_type = p_intervention_type
    and target_user_id is not distinct from p_target_user_id
    and (status = 'pending' or (status = 'snoozed' and snoozed_until > now()))
  limit 1;

  if v_id is not null then
    return v_id;
  end if;

  insert into public.connection_interventions (connection_id, target_user_id, intervention_type, payload)
  values (p_connection_id, p_target_user_id, p_intervention_type, p_payload)
  returning id into v_id;

  return v_id;
end;
$$;

-- get_active_intervention: auth.uid() must equal p_viewer_id, full stop --
-- a genuine judgment call beyond what the design doc's own pseudocode
-- signature specified, flagged in the final report. This matches every
-- existing self-row-only prompt table's RLS in this codebase (a client can
-- ask "what's active for ME," never probe what's showing to the other
-- participant); testing the OTHER participant's view means signing in as
-- them via the Dev tab's existing session-switching mechanism, the same
-- established pattern this project already uses everywhere else.
--
-- Fixed while wiring the frontend: originally hard-excluded only
-- status='blocked'. That stopped the stored interventions (already cleared
-- by the closed-connection trigger regardless), but the four COMPUTED-on-
-- read types (meetup_confirm_needed, pre_meetup_support,
-- graduation_checkpoint, meetup_date_reconciliation) have no stored row to
-- clear, so nothing stopped them surfacing on an inactive/ended/paused/
-- graduated connection. Uses is_connection_automation_eligible(), the same
-- single source of truth as every other evaluator, instead of a narrower,
-- hand-picked check.
create or replace function public.get_active_intervention(p_connection_id uuid, p_viewer_id uuid)
returns table (
  intervention_type text,
  source text,
  intervention_id uuid,
  payload jsonb
)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_status text;
  v_meetup record;
begin
  if auth.uid() is distinct from p_viewer_id then
    raise exception 'Can only query your own active intervention';
  end if;

  select status into v_status from public.connections
  where id = p_connection_id and (user_a_id = p_viewer_id or user_b_id = p_viewer_id);

  if not found then
    return;
  end if;
  if not public.is_connection_automation_eligible(v_status) then
    return;
  end if;

  -- rank 1: no-ghost
  return query
  select ci.intervention_type, 'stored'::text, ci.id, ci.payload
  from public.connection_interventions ci
  where ci.connection_id = p_connection_id
    and ci.target_user_id = p_viewer_id
    and ci.status = 'pending'
    and ci.intervention_type in ('no_ghost_r1','no_ghost_r2','no_ghost_r3','no_ghost_s1')
  order by case ci.intervention_type
    when 'no_ghost_s1' then 4 when 'no_ghost_r3' then 3
    when 'no_ghost_r2' then 2 when 'no_ghost_r1' then 1 else 0 end desc
  limit 1;
  if found then return; end if;

  -- rank 2: meetup_confirm_needed (computed live)
  select * into v_meetup from public.meetups
  where connection_id = p_connection_id and status = 'proposed'
  order by created_at desc limit 1;
  if found and v_meetup.proposed_by <> p_viewer_id then
    intervention_type := 'meetup_confirm_needed';
    source := 'computed';
    intervention_id := v_meetup.id;
    payload := jsonb_build_object('meetup_id', v_meetup.id, 'proposed_date', v_meetup.proposed_date);
    return next;
    return;
  end if;

  -- rank 2: pre_meetup_support (computed live)
  select * into v_meetup from public.meetups
  where connection_id = p_connection_id and status = 'confirmed'
    and confirmed_date between current_date and current_date + 1
  order by created_at desc limit 1;
  if found then
    intervention_type := 'pre_meetup_support';
    source := 'computed';
    intervention_id := v_meetup.id;
    payload := jsonb_build_object('meetup_id', v_meetup.id, 'confirmed_date', v_meetup.confirmed_date);
    return next;
    return;
  end if;

  -- ranks 3-7: stored interventions, in priority order
  return query
  select ci.intervention_type, 'stored'::text, ci.id, ci.payload
  from public.connection_interventions ci
  where ci.connection_id = p_connection_id
    and (ci.target_user_id = p_viewer_id or ci.target_user_id is null)
    and ci.status = 'pending'
    and ci.intervention_type in (
      'meetup_occurrence_check','post_meetup_reflection','second_look_prompt',
      'conversation_restart_prompt','rhythm_reminder'
    )
  order by case ci.intervention_type
    when 'meetup_occurrence_check' then 3
    when 'post_meetup_reflection' then 4
    when 'second_look_prompt' then 5
    when 'conversation_restart_prompt' then 6
    when 'rhythm_reminder' then 7
    else 99 end asc
  limit 1;
  if found then return; end if;

  -- rank 8: graduation_checkpoint (computed live)
  if exists (select 1 from public.connections c where c.id = p_connection_id and c.meetup_count >= 5)
    and not exists (select 1 from public.graduation_readiness where connection_id = p_connection_id and user_id = p_viewer_id)
  then
    intervention_type := 'graduation_checkpoint';
    source := 'computed';
    intervention_id := null;
    payload := '{}'::jsonb;
    return next;
    return;
  end if;

  -- rank 9: meetup_date_reconciliation (computed live, lowest priority)
  select m.* into v_meetup from public.meetups m
  where m.connection_id = p_connection_id and m.date_status = 'disputed'
    and not exists (select 1 from public.meetup_date_resolutions r where r.meetup_id = m.id and r.status = 'pending')
  order by m.created_at asc limit 1;
  if found then
    intervention_type := 'meetup_date_reconciliation';
    source := 'computed';
    intervention_id := v_meetup.id;
    payload := jsonb_build_object('meetup_id', v_meetup.id);
    return next;
    return;
  end if;

  return;
end;
$$;

-- ============================================================
-- Meetups: propose / confirm / cancel (design doc §5)
-- ============================================================
create or replace function public.propose_meetup(p_connection_id uuid, p_date date)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid := auth.uid();
  v_existing_id uuid;
  v_prompted boolean;
  v_new_id uuid;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if not exists (
    select 1 from public.connections c
    where c.id = p_connection_id and (c.user_a_id = v_caller or c.user_b_id = v_caller)
  ) then
    raise exception 'Not a participant of this connection';
  end if;

  select id into v_existing_id from public.meetups
  where connection_id = p_connection_id and status in ('proposed','confirmed')
  order by created_at desc limit 1;

  select exists (
    select 1 from public.connection_interventions
    where connection_id = p_connection_id and target_user_id = v_caller and status = 'pending'
  ) into v_prompted;

  insert into public.meetups (connection_id, proposed_date, proposed_by, prompted_by_limen)
  values (p_connection_id, p_date, v_caller, v_prompted)
  returning id into v_new_id;

  if v_existing_id is not null then
    update public.meetups set status = 'rescheduled', superseded_by = v_new_id where id = v_existing_id;
    perform public.record_friendship_event(p_connection_id, 'meetup_rescheduled', v_caller,
      jsonb_build_object('old_meetup_id', v_existing_id, 'new_meetup_id', v_new_id, 'date', p_date));
  else
    perform public.record_friendship_event(p_connection_id, 'meetup_proposed', v_caller,
      jsonb_build_object('meetup_id', v_new_id, 'date', p_date));
  end if;

  return v_new_id;
end;
$$;

create or replace function public.confirm_meetup(p_meetup_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid := auth.uid();
  v_meetup record;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;

  select m.*, c.user_a_id, c.user_b_id into v_meetup
  from public.meetups m join public.connections c on c.id = m.connection_id
  where m.id = p_meetup_id and (c.user_a_id = v_caller or c.user_b_id = v_caller);
  if not found then raise exception 'Not a participant of this meetup''s connection'; end if;
  if v_meetup.status <> 'proposed' then raise exception 'No proposed date to confirm'; end if;
  if v_meetup.proposed_by = v_caller then raise exception 'The proposer cannot also confirm their own date'; end if;

  update public.meetups
  set status = 'confirmed', confirmed_date = proposed_date, confirmed_at = now(), confirmed_by = v_caller
  where id = p_meetup_id;

  perform public.record_friendship_event(v_meetup.connection_id, 'meetup_confirmed', v_caller,
    jsonb_build_object('meetup_id', p_meetup_id, 'date', v_meetup.proposed_date));
end;
$$;

create or replace function public.cancel_meetup(p_meetup_id uuid, p_concern_resolution text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid := auth.uid();
  v_meetup record;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;

  select m.*, m.connection_id as conn_id into v_meetup
  from public.meetups m
  where m.id = p_meetup_id and exists (
    select 1 from public.connections c
    where c.id = m.connection_id and (c.user_a_id = v_caller or c.user_b_id = v_caller)
  );
  if not found then raise exception 'Not a participant of this meetup''s connection'; end if;
  if v_meetup.status not in ('proposed','confirmed') then
    raise exception 'Only a proposed or confirmed meetup can be cancelled';
  end if;

  update public.meetups set status = 'cancelled' where id = p_meetup_id;

  if p_concern_resolution is not null then
    update public.pre_meetup_concerns
    set resolution = p_concern_resolution
    where meetup_id = p_meetup_id and user_id = v_caller and resolution is null;
  end if;

  perform public.record_friendship_event(v_meetup.conn_id, 'meetup_cancelled', v_caller,
    jsonb_build_object('meetup_id', p_meetup_id));
end;
$$;

-- ============================================================
-- Occurrence reporting + reconciliation, all cases (design doc §5)
-- ============================================================
create or replace function public.report_meetup_occurrence(
  p_meetup_id uuid, p_reported_yes boolean, p_reported_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid := auth.uid();
  v_meetup record;
  v_other_id uuid;
  v_my_report record;
  v_other_report record;
  v_other_found boolean;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if p_reported_yes and p_reported_date is not null and p_reported_date > current_date then
    raise exception 'reported_date cannot be in the future';
  end if;

  select m.*, c.user_a_id, c.user_b_id into v_meetup
  from public.meetups m join public.connections c on c.id = m.connection_id
  where m.id = p_meetup_id and (c.user_a_id = v_caller or c.user_b_id = v_caller);
  if not found then raise exception 'Not a participant of this meetup''s connection'; end if;
  if v_meetup.status not in ('confirmed', 'unresolved') then
    raise exception 'This meetup is not awaiting an occurrence report';
  end if;
  if v_meetup.confirmed_date is null or v_meetup.confirmed_date > current_date then
    raise exception 'Cannot report occurrence before the confirmed date has passed';
  end if;

  v_other_id := case when v_meetup.user_a_id = v_caller then v_meetup.user_b_id else v_meetup.user_a_id end;

  insert into public.meetup_occurrence_reports (meetup_id, reporter_id, reported_yes, reported_date)
  values (p_meetup_id, v_caller, p_reported_yes, case when p_reported_yes then p_reported_date else null end)
  on conflict (meetup_id, reporter_id)
  do update set reported_yes = excluded.reported_yes, reported_date = excluded.reported_date, created_at = now();

  update public.connection_interventions
  set status = 'resolved', resolved_at = now()
  where connection_id = v_meetup.connection_id and target_user_id = v_caller
    and intervention_type = 'meetup_occurrence_check' and status = 'pending';

  select * into v_other_report from public.meetup_occurrence_reports
  where meetup_id = p_meetup_id and reporter_id = v_other_id;
  v_other_found := found;

  if not v_other_found then
    return jsonb_build_object('resolved', false, 'waiting_on_other', true);
  end if;

  select * into v_my_report from public.meetup_occurrence_reports
  where meetup_id = p_meetup_id and reporter_id = v_caller;

  if v_my_report.reported_yes and v_other_report.reported_yes then
    if v_my_report.reported_date = v_other_report.reported_date then
      update public.meetups
      set status = 'occurred', date_status = 'confirmed', occurred_date = v_my_report.reported_date
      where id = p_meetup_id;
    else
      update public.meetups
      set status = 'occurred', date_status = 'disputed', occurred_date = null
      where id = p_meetup_id;
    end if;

    perform public.record_friendship_event(v_meetup.connection_id, 'meetup_occurred', null,
      jsonb_build_object('meetup_id', p_meetup_id, 'sequence_number', v_meetup.sequence_number));

    perform public.raise_intervention(v_meetup.connection_id, 'post_meetup_reflection', v_meetup.user_a_id,
      jsonb_build_object('meetup_id', p_meetup_id));
    perform public.raise_intervention(v_meetup.connection_id, 'post_meetup_reflection', v_meetup.user_b_id,
      jsonb_build_object('meetup_id', p_meetup_id));

    return jsonb_build_object('resolved', true, 'status', 'occurred');

  elsif not v_my_report.reported_yes and not v_other_report.reported_yes then
    update public.meetups set status = 'not_occurred' where id = p_meetup_id;
    perform public.record_friendship_event(v_meetup.connection_id, 'meetup_not_occurred', null,
      jsonb_build_object('meetup_id', p_meetup_id));
    return jsonb_build_object('resolved', true, 'status', 'not_occurred');

  else
    update public.meetups set status = 'unresolved' where id = p_meetup_id;
    perform public.record_friendship_event(v_meetup.connection_id, 'meetup_occurrence_unresolved', null,
      jsonb_build_object('meetup_id', p_meetup_id));
    return jsonb_build_object('resolved', true, 'status', 'unresolved');
  end if;
end;
$$;

-- ============================================================
-- Meetup date resolution: shared by an initial dispute and a later
-- correction (design doc §5, cases 2 and 5)
-- ============================================================
create or replace function public.propose_meetup_date_resolution(p_meetup_id uuid, p_proposed_date date)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid := auth.uid();
  v_meetup record;
  v_reason text;
  v_id uuid;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if p_proposed_date > current_date then raise exception 'proposed_date cannot be in the future'; end if;

  select m.* into v_meetup
  from public.meetups m
  where m.id = p_meetup_id and exists (
    select 1 from public.connections c where c.id = m.connection_id and (c.user_a_id = v_caller or c.user_b_id = v_caller)
  );
  if not found then raise exception 'Not a participant of this meetup''s connection'; end if;

  if v_meetup.date_status = 'disputed' then
    v_reason := 'initial_dispute';
  elsif v_meetup.date_status = 'confirmed' then
    v_reason := 'correction';
  else
    raise exception 'This meetup has no resolved occurrence yet';
  end if;

  if exists (select 1 from public.meetup_date_resolutions where meetup_id = p_meetup_id and status = 'pending') then
    raise exception 'A date resolution is already pending for this meetup';
  end if;

  insert into public.meetup_date_resolutions (meetup_id, proposed_by, proposed_date, reason)
  values (p_meetup_id, v_caller, p_proposed_date, v_reason)
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.resolve_meetup_date_resolution(p_resolution_id uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid := auth.uid();
  v_res record;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;

  select r.*, m.connection_id into v_res
  from public.meetup_date_resolutions r
  join public.meetups m on m.id = r.meetup_id
  where r.id = p_resolution_id;
  if not found then raise exception 'Resolution not found'; end if;
  if v_res.status <> 'pending' then raise exception 'Already resolved'; end if;
  if v_res.proposed_by = v_caller then raise exception 'The proposer cannot approve their own date resolution'; end if;
  if not exists (
    select 1 from public.connections c
    where c.id = v_res.connection_id and (c.user_a_id = v_caller or c.user_b_id = v_caller)
  ) then
    raise exception 'Not a participant of this connection';
  end if;

  update public.meetup_date_resolutions
  set status = case when p_approve then 'approved' else 'declined' end, resolved_at = now()
  where id = p_resolution_id;

  if p_approve then
    update public.meetups
    set occurred_date = v_res.proposed_date, date_status = 'confirmed'
    where id = v_res.meetup_id;

    perform public.record_friendship_event(v_res.connection_id, 'meetup_date_resolved', null,
      jsonb_build_object('meetup_id', v_res.meetup_id));
  end if;
end;
$$;

-- ============================================================
-- Pause / resume with a defined defer window (design doc §8, Decision 3).
-- Reuses the EXISTING pause_connection()/resume_connection() primitives
-- rather than duplicating their logic -- neither is modified here.
-- ============================================================
create or replace function public.pause_connection_with_duration(p_connection_id uuid, p_paused_until timestamptz default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if not exists (
    select 1 from public.connections c
    where c.id = p_connection_id and (c.user_a_id = v_caller or c.user_b_id = v_caller)
  ) then
    raise exception 'Not a participant of this connection';
  end if;

  perform public.pause_connection(p_connection_id);

  insert into public.connection_pause_details (connection_id, paused_by, paused_until)
  values (p_connection_id, v_caller, p_paused_until)
  on conflict (connection_id) do update set paused_by = excluded.paused_by, paused_until = excluded.paused_until, created_at = now();

  update public.connection_interventions
  set status = 'resolved', resolved_at = now()
  where connection_id = p_connection_id and status = 'pending'
    and intervention_type in ('no_ghost_r1','no_ghost_r2','no_ghost_r3','no_ghost_s1');

  perform public.record_friendship_event(p_connection_id, 'connection_paused', v_caller, '{}'::jsonb);
end;
$$;

create or replace function public.resume_connection_early(p_connection_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if not exists (
    select 1 from public.connections c
    where c.id = p_connection_id and (c.user_a_id = v_caller or c.user_b_id = v_caller)
  ) then
    raise exception 'Not a participant of this connection';
  end if;

  perform public.resume_connection(p_connection_id);
  delete from public.connection_pause_details where connection_id = p_connection_id;
  perform public.record_friendship_event(p_connection_id, 'connection_resumed', v_caller, '{}'::jsonb);
end;
$$;

-- Fix found during testing: the existing resume_connection() requires
-- auth.uid() to be a real, authenticated participant (correct for its own
-- real caller, the manual "Resume" button), which makes it unusable from a
-- system/cron-driven sweep with no acting user. This performs the
-- equivalent status update directly, matching the same pattern
-- run_no_ghost_check_v2's own auto-close branch already correctly uses.
create or replace function public.run_pause_auto_resume_sweep(p_now timestamptz default now())
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row record;
begin
  for v_row in
    select connection_id from public.connection_pause_details
    where paused_until is not null and paused_until < p_now
  loop
    update public.connections set status = 'active' where id = v_row.connection_id and status = 'paused';
    delete from public.connection_pause_details where connection_id = v_row.connection_id;
    perform public.record_friendship_event(v_row.connection_id, 'connection_resumed', null, '{}'::jsonb);
  end loop;
end;
$$;

-- ============================================================
-- No-ghost v2 -- same timing math as the existing (untouched) evaluator,
-- rewired onto raise_intervention / is_connection_automation_eligible.
-- Not cron-scheduled by this migration.
-- ============================================================
create or replace function public.run_no_ghost_check_v2(p_connection_id uuid, p_now timestamptz default now())
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_status text;
  v_last record;
  v_sender uuid;
  v_recipient uuid;
  v_recipient_response_time text;
  v_r1_threshold interval;
  v_elapsed interval;
  v_fired text := 'none';
begin
  select status into v_status from public.connections where id = p_connection_id;
  if not found or not public.is_connection_automation_eligible(v_status) then
    return 'connection_not_eligible';
  end if;

  -- Tiebreak fix found during testing: two messages inserted in immediate
  -- succession within the same transaction can share an identical created_at
  -- (now() is stable within one transaction). order by created_at alone left
  -- Postgres free to pick either row on a tie; adding id desc as a
  -- deterministic secondary key removes that ambiguity.
  select m.sender_id, m.created_at into v_last
  from public.messages m where m.connection_id = p_connection_id
  order by m.created_at desc, m.id desc limit 1;
  if not found then return 'no_messages'; end if;

  v_sender := v_last.sender_id;
  select case when c.user_a_id = v_sender then c.user_b_id else c.user_a_id end
  into v_recipient from public.connections c where c.id = p_connection_id;

  v_elapsed := p_now - v_last.created_at;

  select p.response_time into v_recipient_response_time
  from public.profiles p where p.user_id = v_recipient;
  v_r1_threshold := case when v_recipient_response_time = 'Same day' then interval '20 hours' else interval '36 hours' end;

  if v_elapsed >= v_r1_threshold then
    perform public.raise_intervention(p_connection_id, 'no_ghost_r1', v_recipient, '{}'::jsonb);
    v_fired := 'r1';
  end if;
  if v_elapsed >= interval '72 hours' then
    perform public.raise_intervention(p_connection_id, 'no_ghost_r2', v_recipient, '{}'::jsonb);
    v_fired := 'r2';
  end if;
  if v_elapsed >= interval '120 hours' then
    perform public.raise_intervention(p_connection_id, 'no_ghost_r3', v_recipient, '{}'::jsonb);
    v_fired := 'r3';
  end if;
  if v_elapsed >= interval '125 hours' then
    perform public.raise_intervention(p_connection_id, 'no_ghost_s1', v_sender, '{}'::jsonb);
    v_fired := 's1';
  end if;
  if v_elapsed >= interval '168 hours' and v_status is distinct from 'inactive' then
    update public.connections set status = 'inactive' where id = p_connection_id;
    perform public.record_friendship_event(p_connection_id, 'conversation_became_inactive', null, '{}'::jsonb);
    v_fired := 'auto_closed';
  end if;

  return v_fired;
end;
$$;

create or replace function public.run_no_ghost_check_v2_all(p_now timestamptz default now())
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_conn record;
begin
  for v_conn in
    select id from public.connections where status is null or public.is_connection_automation_eligible(status)
  loop
    perform public.run_no_ghost_check_v2(v_conn.id, p_now);
  end loop;
end;
$$;

-- ============================================================
-- Meetup occurrence check v2 -- raises the intervention, and implements the
-- provisional 7-day one-sided timeout (design doc §13a Decision 9).
-- ============================================================
-- Fixed during testing: originally picked only the single most-recent (by
-- confirmed_date) 'confirmed'/'unresolved' meetup, but a connection can have
-- several independently-resolved meetups in history at once. A fresh
-- 'confirmed' meetup awaiting its first check could be shadowed by an
-- unrelated, already-'unresolved' meetup that merely happened to have a more
-- recent confirmed_date. Loops over every meetup genuinely needing action.
create or replace function public.run_meetup_occurrence_check_v2(p_connection_id uuid, p_now timestamptz default now())
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_status text;
  v_meetup record;
  v_report_count integer;
  v_any_action text := 'no_meetup_awaiting_occurrence';
begin
  select status into v_status from public.connections where id = p_connection_id;
  if not found or not public.is_connection_automation_eligible(v_status) then
    return 'connection_not_eligible';
  end if;

  for v_meetup in
    select m.*, c.user_a_id, c.user_b_id
    from public.meetups m join public.connections c on c.id = m.connection_id
    where m.connection_id = p_connection_id and m.status = 'confirmed'
      and m.confirmed_date is not null and m.confirmed_date < (p_now at time zone 'utc')::date
  loop
    select count(*) into v_report_count from public.meetup_occurrence_reports where meetup_id = v_meetup.id;

    if v_report_count = 0 then
      perform public.raise_intervention(p_connection_id, 'meetup_occurrence_check', v_meetup.user_a_id,
        jsonb_build_object('meetup_id', v_meetup.id));
      perform public.raise_intervention(p_connection_id, 'meetup_occurrence_check', v_meetup.user_b_id,
        jsonb_build_object('meetup_id', v_meetup.id));
      v_any_action := 'fired';

    elsif v_report_count = 1 and p_now - (v_meetup.confirmed_date::timestamptz) >= interval '7 days' then
      update public.meetups set status = 'unresolved' where id = v_meetup.id;
      perform public.record_friendship_event(p_connection_id, 'meetup_occurrence_unresolved', null,
        jsonb_build_object('meetup_id', v_meetup.id));
      update public.connection_interventions
        set status = 'expired'
        where connection_id = p_connection_id and intervention_type = 'meetup_occurrence_check'
          and status = 'pending' and payload->>'meetup_id' = v_meetup.id::text;
      v_any_action := 'timed_out_unresolved';
    end if;
  end loop;

  return v_any_action;
end;
$$;

create or replace function public.run_meetup_occurrence_check_v2_all(p_now timestamptz default now())
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_conn record;
begin
  for v_conn in
    select distinct m.connection_id as id
    from public.meetups m
    join public.connections c on c.id = m.connection_id
    where m.status in ('confirmed', 'unresolved')
      and public.is_connection_automation_eligible(c.status)
  loop
    perform public.run_meetup_occurrence_check_v2(v_conn.id, p_now);
  end loop;
end;
$$;

-- ============================================================
-- Conversation restart (Case B), design doc §6a
-- ============================================================
create or replace function public.run_conversation_restart_check_v2(p_connection_id uuid, p_now timestamptz default now())
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_conn record;
  v_last_message_at timestamptz;
  v_has_a boolean;
  v_has_b boolean;
  v_threshold interval;
begin
  select status, user_a_id, user_b_id, is_self_sustaining into v_conn
  from public.connections where id = p_connection_id;
  if not found or not public.is_connection_automation_eligible(v_conn.status) then
    return 'connection_not_eligible';
  end if;

  select exists (select 1 from public.messages where connection_id = p_connection_id and sender_id = v_conn.user_a_id) into v_has_a;
  select exists (select 1 from public.messages where connection_id = p_connection_id and sender_id = v_conn.user_b_id) into v_has_b;
  if not (v_has_a and v_has_b) then
    return 'not_two_sided_conversation';
  end if;

  if exists (
    select 1 from public.connection_interventions
    where connection_id = p_connection_id and status = 'pending'
      and intervention_type in ('no_ghost_r1','no_ghost_r2','no_ghost_r3','no_ghost_s1')
  ) then
    return 'no_ghost_takes_priority';
  end if;

  if exists (select 1 from public.meetups where connection_id = p_connection_id and status in ('proposed','confirmed')) then
    return 'meetup_already_scheduled';
  end if;

  select max(created_at) into v_last_message_at from public.messages where connection_id = p_connection_id;

  v_threshold := case when v_conn.is_self_sustaining then interval '10 days' else interval '5 days' end;
  if p_now - v_last_message_at < v_threshold then
    return 'not_enough_time_elapsed';
  end if;

  perform public.raise_intervention(p_connection_id, 'conversation_restart_prompt', v_conn.user_a_id, '{}'::jsonb);
  perform public.raise_intervention(p_connection_id, 'conversation_restart_prompt', v_conn.user_b_id, '{}'::jsonb);
  return 'fired';
end;
$$;

create or replace function public.run_conversation_restart_check_v2_all(p_now timestamptz default now())
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_conn record;
begin
  for v_conn in
    select id from public.connections where status is null or public.is_connection_automation_eligible(status)
  loop
    perform public.run_conversation_restart_check_v2(v_conn.id, p_now);
  end loop;
end;
$$;

-- ============================================================
-- Rhythm reminder -- both the initial-collection eligibility (structural
-- gap floor, no chosen day count, design doc Decision 6) and the recurring
-- cadence-mapped reminder.
-- ============================================================
create or replace function public.run_rhythm_reminder_check(p_connection_id uuid, p_now timestamptz default now())
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_status text;
  v_user_a uuid;
  v_user_b uuid;
  v_user_id uuid;
  v_pref record;
  v_recent_meetups date[];
  v_last_occurred date;
  v_cadence_days interval;
begin
  select status, user_a_id, user_b_id into v_status, v_user_a, v_user_b
  from public.connections where id = p_connection_id;
  if not found or not public.is_connection_automation_eligible(v_status) then
    return;
  end if;

  select array_agg(occurred_date) into v_recent_meetups
  from (
    select occurred_date from public.meetups
    where connection_id = p_connection_id and status = 'occurred' and occurred_date is not null
    order by occurred_date desc limit 2
  ) x;

  select max(occurred_date) into v_last_occurred
  from public.meetups where connection_id = p_connection_id and status = 'occurred' and occurred_date is not null;

  foreach v_user_id in array array[v_user_a, v_user_b]
  loop
    select * into v_pref from public.rhythm_preferences
    where connection_id = p_connection_id and user_id = v_user_id;

    if not found then
      if array_length(v_recent_meetups, 1) = 2 and v_recent_meetups[1] <> v_recent_meetups[2] then
        perform public.raise_intervention(p_connection_id, 'rhythm_reminder', v_user_id,
          jsonb_build_object('mode', 'initial'));
      end if;
    else
      if v_pref.cadence <> 'not_sure' and v_last_occurred is not null then
        v_cadence_days := case v_pref.cadence
          when 'weekly' then interval '10 days'
          when 'few_weeks' then interval '21 days'
          when 'monthly' then interval '35 days'
          when 'occasional' then interval '60 days'
        end;
        if p_now - (v_last_occurred::timestamptz) >= v_cadence_days then
          perform public.raise_intervention(p_connection_id, 'rhythm_reminder', v_user_id,
            jsonb_build_object('mode', 'recurring', 'cadence', v_pref.cadence));
        end if;
      end if;
    end if;
  end loop;
end;
$$;

create or replace function public.run_rhythm_reminder_check_all(p_now timestamptz default now())
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_conn record;
begin
  for v_conn in
    select id from public.connections where status is null or public.is_connection_automation_eligible(status)
  loop
    perform public.run_rhythm_reminder_check(v_conn.id, p_now);
  end loop;
end;
$$;

-- ============================================================
-- Private submission functions: second look, post-meetup reflection,
-- rhythm preference, graduation readiness, pre-meetup concerns
-- ============================================================
create or replace function public.submit_second_look_response(p_connection_id uuid, p_response text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid := auth.uid();
  v_class text;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if p_response not in ('yes','maybe_later','no') then raise exception 'Unknown response'; end if;
  if not exists (
    select 1 from public.connections c
    where c.id = p_connection_id and (c.user_a_id = v_caller or c.user_b_id = v_caller)
  ) then
    raise exception 'Not a participant of this connection';
  end if;

  insert into public.second_look_responses (connection_id, user_id, response)
  values (p_connection_id, v_caller, p_response)
  on conflict (connection_id, user_id) do update set response = excluded.response, created_at = now();

  v_class := case p_response when 'yes' then 'advance' when 'maybe_later' then 'defer' else 'decline' end;
  perform public.record_friendship_event(p_connection_id, 'second_look_responded', v_caller,
    jsonb_build_object('response_class', v_class));

  update public.connection_interventions
  set status = 'resolved', resolved_at = now()
  where connection_id = p_connection_id and target_user_id = v_caller
    and intervention_type = 'second_look_prompt' and status = 'pending';
end;
$$;

create or replace function public.submit_post_meetup_reflection(p_meetup_id uuid, p_response text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid := auth.uid();
  v_meetup record;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if p_response not in ('know_better','open_to_another','still_figuring','dont_continue') then
    raise exception 'Unknown response';
  end if;

  select m.*, m.connection_id as conn_id into v_meetup
  from public.meetups m
  where m.id = p_meetup_id and exists (
    select 1 from public.connections c where c.id = m.connection_id and (c.user_a_id = v_caller or c.user_b_id = v_caller)
  );
  if not found then raise exception 'Not a participant of this meetup''s connection'; end if;
  if v_meetup.status <> 'occurred' then raise exception 'This meetup has no confirmed occurrence yet'; end if;

  insert into public.private_post_meetup_reflections (connection_id, user_id, meetup_id, response)
  values (v_meetup.conn_id, v_caller, p_meetup_id, p_response)
  on conflict (connection_id, user_id, meetup_id) do update set response = excluded.response, created_at = now();

  perform public.record_friendship_event(v_meetup.conn_id, 'post_meetup_reflection_submitted', v_caller,
    jsonb_build_object('meetup_id', p_meetup_id));

  update public.connection_interventions
  set status = 'resolved', resolved_at = now()
  where connection_id = v_meetup.conn_id and target_user_id = v_caller
    and intervention_type = 'post_meetup_reflection' and status = 'pending'
    and payload->>'meetup_id' = p_meetup_id::text;

  if p_response in ('know_better','open_to_another') then
    perform public.raise_intervention(v_meetup.conn_id, 'second_look_prompt', v_caller,
      jsonb_build_object('meetup_id', p_meetup_id));
  end if;
end;
$$;

create or replace function public.submit_rhythm_preference(p_connection_id uuid, p_cadence text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if p_cadence not in ('weekly','few_weeks','monthly','occasional','not_sure') then
    raise exception 'Unknown cadence';
  end if;
  if not exists (
    select 1 from public.connections c
    where c.id = p_connection_id and (c.user_a_id = v_caller or c.user_b_id = v_caller)
  ) then
    raise exception 'Not a participant of this connection';
  end if;

  insert into public.rhythm_preferences (connection_id, user_id, cadence)
  values (p_connection_id, v_caller, p_cadence)
  on conflict (connection_id, user_id) do update set cadence = excluded.cadence, updated_at = now();

  perform public.record_friendship_event(p_connection_id, 'rhythm_preference_set', v_caller, '{}'::jsonb);

  update public.connection_interventions
  set status = 'resolved', resolved_at = now()
  where connection_id = p_connection_id and target_user_id = v_caller
    and intervention_type = 'rhythm_reminder' and status = 'pending';
end;
$$;

-- graduation_mutual fires only from here, only when BOTH independently read
-- 'mostly_on_our_own'. The other participant's own answer or its mere
-- existence is never revealed via this function's return value (it has none).
create or replace function public.submit_graduation_readiness(p_connection_id uuid, p_readiness text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid := auth.uid();
  v_other_id uuid;
  v_other_readiness text;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if p_readiness not in ('still_helpful','mostly_on_our_own','not_sure') then
    raise exception 'Unknown readiness value';
  end if;

  select case when user_a_id = v_caller then user_b_id else user_a_id end into v_other_id
  from public.connections where id = p_connection_id and (user_a_id = v_caller or user_b_id = v_caller);
  if not found then raise exception 'Not a participant of this connection'; end if;

  insert into public.graduation_readiness (connection_id, user_id, readiness)
  values (p_connection_id, v_caller, p_readiness)
  on conflict (connection_id, user_id) do update set readiness = excluded.readiness, created_at = now();

  select readiness into v_other_readiness from public.graduation_readiness
  where connection_id = p_connection_id and user_id = v_other_id;

  if p_readiness = 'mostly_on_our_own' and v_other_readiness = 'mostly_on_our_own' then
    perform public.record_friendship_event(p_connection_id, 'graduation_mutual', null, '{}'::jsonb);
  end if;
end;
$$;

create or replace function public.submit_pre_meetup_concern(p_meetup_id uuid, p_concern text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid := auth.uid();
  v_conn_id uuid;
  v_id uuid;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if p_concern not in ('awkwardness','low_energy','plan_too_big','safety','other') then
    raise exception 'Unknown concern';
  end if;

  select m.connection_id into v_conn_id from public.meetups m
  where m.id = p_meetup_id and exists (
    select 1 from public.connections c where c.id = m.connection_id and (c.user_a_id = v_caller or c.user_b_id = v_caller)
  );
  if v_conn_id is null then raise exception 'Not a participant of this meetup''s connection'; end if;

  insert into public.pre_meetup_concerns (connection_id, user_id, meetup_id, concern)
  values (v_conn_id, v_caller, p_meetup_id, p_concern)
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.resolve_pre_meetup_concern(p_concern_id uuid, p_resolution text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if p_resolution not in ('reassured','plan_simplified','cancelled','blocked','rescheduled') then
    raise exception 'Unknown resolution';
  end if;

  update public.pre_meetup_concerns
  set resolution = p_resolution
  where id = p_concern_id and user_id = v_caller;

  if not found then raise exception 'Concern not found or not yours'; end if;
end;
$$;

-- ============================================================
-- Supporting triggers, all additive -- none replace or modify an existing
-- trigger. Both coexist harmlessly with the untouched old system's own
-- clear_no_ghost_on_new_message / clear_prompts_on_connection_closed.
-- ============================================================
create or replace function public.bump_meetup_count_on_occurred()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.status = 'occurred' and (old.status is distinct from new.status) then
    update public.connections set meetup_count = meetup_count + 1 where id = new.connection_id;
  elsif old.status = 'occurred' and new.status <> 'occurred' then
    update public.connections set meetup_count = greatest(meetup_count - 1, 0) where id = new.connection_id;
  end if;
  return new;
end;
$$;

create trigger meetups_bump_meetup_count
  after update of status on public.meetups
  for each row execute function public.bump_meetup_count_on_occurred();

create or replace function public.clear_v2_interventions_on_new_message()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_had_restart boolean;
begin
  select exists (
    select 1 from public.connection_interventions
    where connection_id = new.connection_id and status = 'pending'
      and intervention_type = 'conversation_restart_prompt'
  ) into v_had_restart;

  update public.connection_interventions
  set status = 'resolved', resolved_at = now()
  where connection_id = new.connection_id
    and status = 'pending'
    and intervention_type in ('no_ghost_r1','no_ghost_r2','no_ghost_r3','no_ghost_s1','conversation_restart_prompt');

  if v_had_restart then
    perform public.record_friendship_event(new.connection_id, 'conversation_restarted', new.sender_id, '{}'::jsonb);
  end if;

  return new;
end;
$$;

create trigger messages_clear_v2_interventions
  after insert on public.messages
  for each row execute function public.clear_v2_interventions_on_new_message();

create or replace function public.clear_interventions_on_connection_closed()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.status in ('blocked','inactive','ended','graduated') and (old.status is distinct from new.status) then
    update public.connection_interventions
    set status = 'resolved', resolved_at = now()
    where connection_id = new.id and status = 'pending';
  end if;
  return new;
end;
$$;

create trigger connections_clear_v2_interventions_on_closed
  after update of status on public.connections
  for each row execute function public.clear_interventions_on_connection_closed();

-- ============================================================
-- One master sweep, calling every evaluator in sequence -- convenient for
-- testing everything in one call, and what an eventual cron job would call
-- at cutover. NOT scheduled by this migration.
-- ============================================================
create or replace function public.run_friendship_journey_sweep_all(p_now timestamptz default now())
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public.run_no_ghost_check_v2_all(p_now);
  perform public.run_meetup_occurrence_check_v2_all(p_now);
  perform public.run_conversation_restart_check_v2_all(p_now);
  perform public.run_rhythm_reminder_check_all(p_now);
  perform public.evaluate_self_sustaining_all(p_now);
  perform public.run_pause_auto_resume_sweep(p_now);
end;
$$;
