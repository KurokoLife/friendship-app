-- Limen v2 (2026-10-03). See docs/LIMEN_V2_DECISIONS.md.
--
-- 1. Flat capacity for everyone: 3 active connections, 5 pending hellos.
--    Premium no longer buys capacity (choice overload / commitment
--    research; founder's stated values).
-- 2. AI gating: one flat cap per function for everyone, no Premium pool,
--    no paid AI credits. Adds the new reflection-coach function's cap.
-- 3. "How I like care": a free-text profile field, shown only to people
--    you're connected with, never used for matching.
-- 4. Graduation spec: the Friendship Journey checkpoint becomes the only
--    graduation mechanism. Earliest point: 6+ occurred meetups, first one
--    8+ weeks ago, each person proposed 2+ meetups, a rhythm is set.
--    Decision point: 10 meetups or 6 months since the connection began.
--    Private answers, graduation happens only on a mutual yes.
--
-- NOTE for the founder: function bodies below were copied from their
-- latest committed definitions and changed only where marked. If your
-- local, uncommitted migration (20260831000000, video guidance) redefines
-- any of these same functions, re-check before applying.

-- ------------------------------------------------------------------
-- 1. Capacity: flat 3 active / 5 pending (was 4/8 active, 5/8 pending)
-- ------------------------------------------------------------------
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
  v_active_cap := 3;
  v_pending_cap := 5;

  select count(*) into v_active_count
  from public.connections c
  where (c.user_a_id = v_caller or c.user_b_id = v_caller)
    and (c.status is null or c.status not in ('passed', 'inactive', 'paused', 'blocked', 'ended', 'graduated'))
    and exists (select 1 from public.messages m where m.connection_id = c.id and m.sender_id = v_caller)
    and exists (select 1 from public.messages m where m.connection_id = c.id and m.sender_id <> v_caller);

  select count(*) into v_pending_count
  from public.connections c
  where (c.user_a_id = v_caller or c.user_b_id = v_caller)
    and (c.status is null or c.status not in ('passed', 'inactive', 'paused', 'blocked', 'ended', 'graduated'))
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
  v_active_cap := 3;
  v_pending_cap := 5;

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
        and (c.status is null or c.status not in ('passed', 'inactive', 'paused', 'blocked', 'ended', 'graduated'))
        and exists (select 1 from public.messages m where m.connection_id = c.id and m.sender_id = auth.uid())
        and exists (select 1 from public.messages m where m.connection_id = c.id and m.sender_id <> auth.uid())
    ) as active_count,
    3 as active_cap,
    (
      select count(*)::integer from public.connections c
      where (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
        and (c.status is null or c.status not in ('passed', 'inactive', 'paused', 'blocked', 'ended', 'graduated'))
        and exists (select 1 from public.messages m where m.connection_id = c.id and m.sender_id = auth.uid())
        and not exists (select 1 from public.messages m where m.connection_id = c.id and m.sender_id <> auth.uid())
    ) as pending_count,
    5 as pending_cap
  from public.users u
  where u.id = auth.uid();
$$;

-- ------------------------------------------------------------------
-- 2. AI gating: same cap for everyone, no pool, no credits
-- ------------------------------------------------------------------
insert into public.ai_function_caps (function_name, window_type, free_limit) values
  ('reflection-coach', 'day', 10)
on conflict (function_name) do update set window_type = excluded.window_type, free_limit = excluded.free_limit;

create or replace function public.get_ai_gate_status(p_user_id uuid, p_function_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cap record;
  v_window_start timestamptz;
  v_used integer;
  v_limit integer;
  v_window text;
begin
  if auth.uid() is distinct from p_user_id then
    raise exception 'Not authorized to check usage for another user';
  end if;

  -- 'everyone' (not 'free') on purpose: clients only show an "Upgrade to
  -- Premium" link when tier = 'free', and there is nothing to upgrade to.
  if p_function_name = 'generate-personality-narrative' then
    v_limit := 1; v_window := 'day';
  else
    select * into v_cap from public.ai_function_caps where function_name = p_function_name;
    if v_cap is null then
      return jsonb_build_object('allowed', true, 'tier', 'everyone');
    end if;
    v_limit := v_cap.free_limit; v_window := v_cap.window_type;
  end if;

  if v_window = 'day' then
    v_window_start := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  else
    v_window_start := now() - interval '7 days';
  end if;

  select count(*) into v_used from public.ai_usage_events
    where user_id = p_user_id and function_name = p_function_name and created_at >= v_window_start;

  if v_used >= v_limit then
    return jsonb_build_object(
      'allowed', false,
      'tier', 'everyone',
      'reason', case when v_window = 'day' then 'daily_cap_reached' else 'weekly_cap_reached' end,
      'resets_at', case when v_window = 'day' then v_window_start + interval '1 day' else v_window_start + interval '7 days' end
    );
  end if;
  return jsonb_build_object('allowed', true, 'tier', 'everyone');
end;
$$;

grant execute on function public.get_ai_gate_status(uuid, text) to authenticated;

create or replace function public.record_ai_usage(p_user_id uuid, p_function_name text, p_cost_usd numeric default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is distinct from p_user_id then
    raise exception 'Not authorized to record usage for another user';
  end if;
  insert into public.ai_usage_events (user_id, function_name) values (p_user_id, p_function_name);
end;
$$;

grant execute on function public.record_ai_usage(uuid, text, numeric) to authenticated;

-- ------------------------------------------------------------------
-- 3. "How I like care"
-- ------------------------------------------------------------------
alter table public.profiles add column if not exists care_style text;
alter table public.profiles drop constraint if exists profiles_care_style_length;
alter table public.profiles add constraint profiles_care_style_length
  check (care_style is null or char_length(care_style) <= 400);

-- Returns the OTHER participant's care_style, only to a participant of a
-- live connection. Never exposed through discovery views or matching.
create or replace function public.get_connection_care_style(p_connection_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_other uuid;
  v_status text;
  v_text text;
begin
  if v_caller is null then return null; end if;
  select case when user_a_id = v_caller then user_b_id else user_a_id end, status
    into v_other, v_status
  from public.connections
  where id = p_connection_id and (user_a_id = v_caller or user_b_id = v_caller);
  if not found or v_status in ('blocked', 'passed') then return null; end if;
  select care_style into v_text from public.profiles where user_id = v_other;
  return v_text;
end;
$$;

grant execute on function public.get_connection_care_style(uuid) to authenticated;

-- ------------------------------------------------------------------
-- 4. Graduation
-- ------------------------------------------------------------------
alter table public.graduation_readiness add column if not exists stage text;
alter table public.graduation_readiness add column if not exists note text;

-- Which graduation question (if any) the viewer should see right now.
-- Thresholds are the evaluation's starting point, validate with pilot data.
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

  select count(*) filter (where proposed_by = v_conn.user_a_id),
         count(*) filter (where proposed_by = v_conn.user_b_id)
    into v_a_proposals, v_b_proposals
  from public.meetups where connection_id = p_connection_id and status <> 'cancelled';

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

  -- rank 2: pre_meetup_support (computed live). meetup_confirm_needed
  -- removed here (2026-09-02) -- see this migration's own header comment.
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

  -- rank 8: graduation_checkpoint (computed live). Limen v2: stage and
  -- re-ask timing come from graduation_stage(), see that function.
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

    if v_current in ('repeated_time', 'rhythm_established') and v_occurred_count >= 6
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

drop function if exists public.submit_graduation_readiness(uuid, text);

create or replace function public.submit_graduation_readiness(p_connection_id uuid, p_readiness text, p_note text default null)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid := auth.uid();
  v_other_id uuid;
  v_other_readiness text;
  v_stage text;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if p_readiness not in ('still_helpful','mostly_on_our_own','not_sure') then
    raise exception 'Unknown readiness value';
  end if;

  select case when user_a_id = v_caller then user_b_id else user_a_id end into v_other_id
  from public.connections where id = p_connection_id and (user_a_id = v_caller or user_b_id = v_caller);
  if not found then raise exception 'Not a participant of this connection'; end if;

  v_stage := coalesce(public.graduation_stage(p_connection_id, v_caller), 'ready_check');

  insert into public.graduation_readiness (connection_id, user_id, readiness, stage, note)
  values (p_connection_id, v_caller, p_readiness, v_stage, left(p_note, 500))
  on conflict (connection_id, user_id) do update
    set readiness = excluded.readiness, stage = excluded.stage, note = excluded.note, created_at = now();

  select readiness into v_other_readiness from public.graduation_readiness
  where connection_id = p_connection_id and user_id = v_other_id;

  if p_readiness = 'mostly_on_our_own' and v_other_readiness = 'mostly_on_our_own' then
    update public.connections
    set status = 'graduated', graduated_at = now()
    where id = p_connection_id and status is distinct from 'graduated';
    perform public.record_friendship_event(p_connection_id, 'graduation_mutual', null, '{}'::jsonb);
    return true;
  end if;
  return false;
end;
$$;

grant execute on function public.submit_graduation_readiness(uuid, text, text) to authenticated;

-- The old one-sided graduate_connection (anyone could graduate a
-- connection alone at 5 meetups) now requires a mutual yes.
create or replace function public.graduate_connection(p_connection_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
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
  if (select count(*) from public.graduation_readiness
      where connection_id = p_connection_id and readiness = 'mostly_on_our_own') < 2 then
    raise exception 'graduation_requires_mutual_yes';
  end if;

  update public.connections
  set status = 'graduated', graduated_at = now()
  where id = p_connection_id;
end;
$$;
