-- Meetup plans (2026-10-08): time, place, what you'll do, moving a plan,
-- and the meetup prompts (day before, morning of, after).
--
-- Decisions (founder, 2026-10-07):
-- * A meetup is a plan: date (required), time, place and "what we'll do"
--   (optional, nudged). Missing details are asked once more the day before.
-- * Either person can change the plan at any time, any number of times. A
--   change is a new version the other person confirms with one tap. While a
--   change waits, the old plan is off ("Being moved") and its reminders
--   stop, so nobody shows up to a plan the other already dropped.
-- * Filling in a detail that was missing (time or place) does not need a
--   re-confirm; changing a detail that was already agreed does.
-- * Every reminder follows the latest confirmed version automatically.
-- * After a plan has been moved 3 times, each person gets one gentle,
--   private note. No penalty for moving.
-- * "Did you meet?" now comes 3 hours after the start time, or the next
--   morning when no time was set (was: 2 days after the date).
--
-- Times are stored as the local wall-clock time plus the proposer's time
-- zone, so "10:00 AM" stays 10:00 AM for both people (they live within
-- driving distance of each other). Rows without a time zone fall back to
-- America/Los_Angeles, the pilot's home zone.

-- ------------------------------------------------------------------
-- 1. Plan details on meetups
-- ------------------------------------------------------------------
alter table public.meetups add column if not exists start_time time;
alter table public.meetups add column if not exists place text;
alter table public.meetups add column if not exists activity text;
alter table public.meetups add column if not exists time_zone text;
alter table public.meetups add column if not exists move_count integer not null default 0;
alter table public.meetups add column if not exists plan_root_id uuid references public.meetups(id) on delete set null;

alter table public.meetups drop constraint if exists meetups_place_length;
alter table public.meetups add constraint meetups_place_length check (place is null or char_length(place) <= 120);
alter table public.meetups drop constraint if exists meetups_activity_length;
alter table public.meetups add constraint meetups_activity_length check (activity is null or char_length(activity) <= 120);

update public.meetups set plan_root_id = id where plan_root_id is null;

create or replace function public.meetup_tz(p_tz text)
returns text
language sql
immutable
as $$
  select coalesce(nullif(p_tz, ''), 'America/Los_Angeles');
$$;

-- When the meetup starts, as a real moment in time. With no time set, the
-- start of that day in the meetup's own time zone.
create or replace function public.meetup_start_at(p_date date, p_time time, p_tz text)
returns timestamptz
language sql
stable
as $$
  select (p_date + coalesce(p_time, time '00:00')) at time zone public.meetup_tz(p_tz);
$$;

-- ------------------------------------------------------------------
-- 2. Propose / change a plan
-- ------------------------------------------------------------------
drop function if exists public.propose_meetup(uuid, date);

create or replace function public.propose_meetup(
  p_connection_id uuid,
  p_date date,
  p_start_time time default null,
  p_place text default null,
  p_activity text default null,
  p_time_zone text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid := auth.uid();
  v_existing public.meetups%rowtype;
  v_has_existing boolean;
  v_prompted boolean;
  v_new_id uuid;
  v_tz text;
  v_place text := nullif(btrim(coalesce(p_place, '')), '');
  v_activity text := nullif(btrim(coalesce(p_activity, '')), '');
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if not exists (
    select 1 from public.connections c
    where c.id = p_connection_id and (c.user_a_id = v_caller or c.user_b_id = v_caller)
  ) then
    raise exception 'Not a participant of this connection';
  end if;

  v_tz := case when exists (select 1 from pg_timezone_names where name = p_time_zone) then p_time_zone else null end;
  if p_date < (now() at time zone public.meetup_tz(v_tz))::date then
    raise exception 'Pick a date that is today or later';
  end if;

  -- The plan this one replaces. A confirmed plan whose day has passed is
  -- not replaced: it is waiting for "Did you meet?" and stays as it is.
  select * into v_existing from public.meetups
  where connection_id = p_connection_id
    and (status = 'proposed'
         or (status = 'confirmed' and confirmed_date >= (now() at time zone public.meetup_tz(time_zone))::date))
  order by created_at desc, id desc limit 1;
  v_has_existing := found;

  select exists (
    select 1 from public.connection_interventions
    where connection_id = p_connection_id and target_user_id = v_caller and status = 'pending'
  ) into v_prompted;

  insert into public.meetups (
    connection_id, proposed_date, proposed_by, prompted_by_limen,
    start_time, place, activity, time_zone, move_count, plan_root_id
  )
  values (
    p_connection_id, p_date, v_caller, v_prompted,
    p_start_time, v_place, v_activity, coalesce(v_tz, case when v_has_existing then v_existing.time_zone end),
    case when v_has_existing
      then v_existing.move_count + (case when v_existing.status = 'confirmed' then 1 else 0 end)
      else 0 end,
    case when v_has_existing then coalesce(v_existing.plan_root_id, v_existing.id) else null end
  )
  returning id into v_new_id;

  if not v_has_existing then
    update public.meetups set plan_root_id = v_new_id where id = v_new_id;
  end if;

  if v_has_existing then
    update public.meetups set status = 'rescheduled', superseded_by = v_new_id where id = v_existing.id;
    perform public.record_friendship_event(p_connection_id, 'meetup_rescheduled', v_caller,
      jsonb_build_object('old_meetup_id', v_existing.id, 'new_meetup_id', v_new_id, 'date', p_date));
  else
    perform public.record_friendship_event(p_connection_id, 'meetup_proposed', v_caller,
      jsonb_build_object('meetup_id', v_new_id, 'date', p_date));
  end if;

  return v_new_id;
end;
$$;

grant execute on function public.propose_meetup(uuid, date, time, text, text, text) to authenticated;

-- Fill in a detail that is still missing (time, place, what you'll do).
-- Never overwrites a detail already set, so it never needs a re-confirm.
create or replace function public.add_meetup_details(
  p_meetup_id uuid,
  p_start_time time default null,
  p_place text default null,
  p_activity text default null
)
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
  select m.* into v_meetup
  from public.meetups m join public.connections c on c.id = m.connection_id
  where m.id = p_meetup_id and (c.user_a_id = v_caller or c.user_b_id = v_caller);
  if not found then raise exception 'Not a participant of this meetup''s connection'; end if;
  if v_meetup.status not in ('proposed','confirmed') then
    raise exception 'This plan can no longer be changed';
  end if;

  update public.meetups set
    start_time = coalesce(start_time, p_start_time),
    place = coalesce(place, nullif(btrim(coalesce(p_place, '')), '')),
    activity = coalesce(activity, nullif(btrim(coalesce(p_activity, '')), ''))
  where id = p_meetup_id;
end;
$$;

grant execute on function public.add_meetup_details(uuid, time, text, text) to authenticated;

-- ------------------------------------------------------------------
-- 3. Answers to the meetup prompts
-- ------------------------------------------------------------------
-- still_on:   the day before. 'still_on' is shared with the other person
--             (so each knows the other is coming). 'needs_move' is private.
-- feeling:    the morning of. Always private.
-- many_moves: the note after 3 moves, keyed to the plan's first version
--             (plan_root_id) so it is shown once per plan. Private.
create table if not exists public.meetup_prompt_responses (
  meetup_id uuid not null references public.meetups(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  prompt text not null check (prompt in ('still_on', 'feeling', 'many_moves')),
  answer text not null,
  created_at timestamptz not null default now(),
  primary key (meetup_id, user_id, prompt)
);

alter table public.meetup_prompt_responses enable row level security;
drop policy if exists "Users can read their own meetup prompt answers" on public.meetup_prompt_responses;
create policy "Users can read their own meetup prompt answers"
  on public.meetup_prompt_responses for select using (auth.uid() = user_id);
-- No client write policy: only respond_to_meetup_prompt() writes here.

create or replace function public.respond_to_meetup_prompt(p_meetup_id uuid, p_prompt text, p_answer text)
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
    select 1 from public.meetups m join public.connections c on c.id = m.connection_id
    where m.id = p_meetup_id and (c.user_a_id = v_caller or c.user_b_id = v_caller)
  ) then
    raise exception 'Not a participant of this meetup''s connection';
  end if;

  if not (
    (p_prompt = 'still_on' and p_answer in ('still_on', 'needs_move'))
    or (p_prompt = 'feeling' and p_answer in ('looking_forward', 'nervous', 'thinking_cancel', 'going_anyway', 'moving', 'cancelling'))
    or (p_prompt = 'many_moves' and p_answer in ('keep', 'leave_open', 'end'))
  ) then
    raise exception 'Unknown answer';
  end if;

  insert into public.meetup_prompt_responses (meetup_id, user_id, prompt, answer)
  values (p_meetup_id, v_caller, p_prompt, p_answer)
  on conflict (meetup_id, user_id, prompt)
  do update set answer = excluded.answer, created_at = now();
end;
$$;

grant execute on function public.respond_to_meetup_prompt(uuid, text, text) to authenticated;

-- ------------------------------------------------------------------
-- 4. The current plan for a chat, in one call
-- ------------------------------------------------------------------
create or replace function public.get_meetup_plan(p_connection_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid := auth.uid();
  v_conn public.connections%rowtype;
  v_other uuid;
  v_m public.meetups%rowtype;
  v_prev public.meetups%rowtype;
  v_has_prev boolean := false;
  v_tz text;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  select * into v_conn from public.connections
  where id = p_connection_id and (user_a_id = v_caller or user_b_id = v_caller);
  if not found then return null; end if;
  v_other := case when v_conn.user_a_id = v_caller then v_conn.user_b_id else v_conn.user_a_id end;

  -- The current plan. Plans whose day has passed are left out: a
  -- confirmed one is waiting for "Did you meet?", a proposed one expired.
  select * into v_m from public.meetups
  where connection_id = p_connection_id and status in ('proposed','confirmed')
    and coalesce(confirmed_date, proposed_date) >= (now() at time zone public.meetup_tz(time_zone))::date
  order by created_at desc, id desc limit 1;

  if not found then
    return jsonb_build_object('meetup', null, 'meetup_count', v_conn.meetup_count);
  end if;

  v_tz := public.meetup_tz(v_m.time_zone);

  -- The version this one replaced, when it had been agreed ("Being moved").
  if v_m.status = 'proposed' then
    -- The most recent agreed version of this same plan, if any. Walks past
    -- edits the proposer made to their own unconfirmed change.
    select * into v_prev from public.meetups
    where coalesce(plan_root_id, id) = coalesce(v_m.plan_root_id, v_m.id)
      and id <> v_m.id and status = 'rescheduled' and confirmed_date is not null
    order by created_at desc, id desc
    limit 1;
    v_has_prev := found;
  end if;

  return jsonb_build_object(
    'meetup_count', v_conn.meetup_count,
    'local_today', (now() at time zone v_tz)::date,
    'meetup', jsonb_build_object(
      'id', v_m.id,
      'status', v_m.status,
      'date', coalesce(v_m.confirmed_date, v_m.proposed_date),
      'start_time', to_char(v_m.start_time, 'HH24:MI'),
      'place', v_m.place,
      'activity', v_m.activity,
      'time_zone', v_tz,
      'proposed_by', v_m.proposed_by,
      'move_count', v_m.move_count,
      'plan_root_id', coalesce(v_m.plan_root_id, v_m.id),
      'previous', case when v_has_prev then jsonb_build_object(
          'date', v_prev.confirmed_date,
          'start_time', to_char(v_prev.start_time, 'HH24:MI'),
          'place', v_prev.place) else null end,
      'other_still_on', exists (
        select 1 from public.meetup_prompt_responses r
        where r.meetup_id = v_m.id and r.user_id = v_other and r.prompt = 'still_on' and r.answer = 'still_on'),
      'my_still_on', (
        select r.answer from public.meetup_prompt_responses r
        where r.meetup_id = v_m.id and r.user_id = v_caller and r.prompt = 'still_on'),
      'many_moves_answered', exists (
        select 1 from public.meetup_prompt_responses r
        where r.meetup_id = coalesce(v_m.plan_root_id, v_m.id) and r.user_id = v_caller and r.prompt = 'many_moves')
    )
  );
end;
$$;

grant execute on function public.get_meetup_plan(uuid) to authenticated;

-- ------------------------------------------------------------------
-- 5. One card at a time: the day-before and morning-of prompts
-- ------------------------------------------------------------------
-- Rank 2 used to be a single "pre_meetup_support" card that came back on
-- every reload (it had no answered state). Now:
--   meetup_still_on    the day before, until answered. Not shown when the
--                      plan was only just confirmed (under 6 hours ago).
--   pre_meetup_support the morning of (from 5am local), until answered or
--                      until the start time passes (5pm with no time).
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
  v_grad_stage text;
  v_status text;
  v_meetup record;
  v_tz text;
  v_local_now timestamp;
  v_local_today date;
  v_payload jsonb;
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

  -- rank 2: the day-before and morning-of meetup prompts (computed live)
  select * into v_meetup from public.meetups
  where connection_id = p_connection_id and status = 'confirmed'
  order by created_at desc, id desc limit 1;
  if found then
    v_tz := public.meetup_tz(v_meetup.time_zone);
    v_local_now := now() at time zone v_tz;
    v_local_today := v_local_now::date;
    v_payload := jsonb_build_object(
      'meetup_id', v_meetup.id,
      'confirmed_date', v_meetup.confirmed_date,
      'start_time', to_char(v_meetup.start_time, 'HH24:MI'),
      'place', v_meetup.place,
      'activity', v_meetup.activity);

    if v_meetup.confirmed_date = v_local_today + 1
       and coalesce(v_meetup.confirmed_at, now()) < now() - interval '6 hours'
       and not exists (
         select 1 from public.meetup_prompt_responses r
         where r.meetup_id = v_meetup.id and r.user_id = p_viewer_id and r.prompt = 'still_on') then
      intervention_type := 'meetup_still_on';
      source := 'computed';
      intervention_id := v_meetup.id;
      payload := v_payload;
      return next;
      return;
    end if;

    if v_meetup.confirmed_date = v_local_today
       and v_local_now::time >= time '05:00'
       and v_local_now::time < coalesce(v_meetup.start_time, time '17:00')
       and not exists (
         select 1 from public.meetup_prompt_responses r
         where r.meetup_id = v_meetup.id and r.user_id = p_viewer_id and r.prompt = 'feeling') then
      intervention_type := 'pre_meetup_support';
      source := 'computed';
      intervention_id := v_meetup.id;
      payload := v_payload;
      return next;
      return;
    end if;
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
  v_grad_stage := public.graduation_stage(p_connection_id, p_viewer_id);
  if v_grad_stage is not null then
    intervention_type := 'graduation_checkpoint';
    source := 'computed';
    intervention_id := null;
    select jsonb_build_object('stage', v_grad_stage, 'meetup_count', c.meetup_count) into payload
      from public.connections c where c.id = p_connection_id;
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

-- ------------------------------------------------------------------
-- 6. "Did you meet?" sooner: 3 hours after the start time, or 9am the
--    next morning when no time was set (was: 2 days after the date)
-- ------------------------------------------------------------------
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
  v_payload jsonb;
begin
  select status into v_status from public.connections where id = p_connection_id;
  if not found or not public.is_connection_automation_eligible(v_status) then
    return 'connection_not_eligible';
  end if;

  for v_meetup in
    select m.*, c.user_a_id, c.user_b_id
    from public.meetups m join public.connections c on c.id = m.connection_id
    where m.connection_id = p_connection_id and m.status = 'confirmed'
      and m.confirmed_date is not null
      and p_now >= case
        when m.start_time is not null
          then public.meetup_start_at(m.confirmed_date, m.start_time, m.time_zone) + interval '3 hours'
        else public.meetup_start_at(m.confirmed_date + 1, time '09:00', m.time_zone)
      end
  loop
    select count(*) into v_report_count from public.meetup_occurrence_reports where meetup_id = v_meetup.id;
    v_payload := jsonb_build_object(
      'meetup_id', v_meetup.id,
      'confirmed_date', v_meetup.confirmed_date,
      'start_time', to_char(v_meetup.start_time, 'HH24:MI'),
      'place', v_meetup.place);

    if v_report_count = 0 then
      perform public.raise_intervention(p_connection_id, 'meetup_occurrence_check', v_meetup.user_a_id, v_payload);
      perform public.raise_intervention(p_connection_id, 'meetup_occurrence_check', v_meetup.user_b_id, v_payload);
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

-- ------------------------------------------------------------------
-- 7. "They didn't show up" as a private reason after a missed meetup
-- ------------------------------------------------------------------
alter table public.meetup_cancellation_reasons drop constraint if exists meetup_cancellation_reasons_reason_check;
alter table public.meetup_cancellation_reasons add constraint meetup_cancellation_reasons_reason_check
  check (reason in ('schedule_conflict','circumstances_changed','lost_interest','other','no_show'));

-- ------------------------------------------------------------------
-- 8. Graduation: a moved plan is one proposal, not several
-- ------------------------------------------------------------------
-- graduation_stage's "each person proposed 2+ meetups" counted every
-- version of a moved plan. Now it counts each plan once (by who first
-- proposed it), ignoring cancelled plans.
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
  v_has_rhythm boolean;
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

  select exists (select 1 from public.rhythm_preferences where connection_id = p_connection_id)
    into v_has_rhythm;

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
     and v_a_proposals >= 2 and v_b_proposals >= 2
     and v_has_rhythm then
    if not v_has_r or v_r.created_at < now() - interval '28 days' then
      return 'ready_check';
    end if;
  end if;

  return null;
end;
$$;

grant execute on function public.graduation_stage(uuid, uuid) to authenticated;
