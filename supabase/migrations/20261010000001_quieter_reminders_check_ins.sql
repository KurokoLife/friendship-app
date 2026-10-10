-- 2026-10-10: fewer, kinder reminders, and control over them.
-- Safe to run more than once. Builds on 20261010000000_plan_invites_meetup_tracking.sql.
--
-- Why: a chat that ended naturally ("good night!") was treated like an
-- unanswered message: reminders at 1, 3 and 5 days, then the chat closed
-- itself after a week, even for friends with a meetup planned. Quiet is
-- normal. The app only looks at timing (who wrote last, and when), never
-- at what anyone wrote.
--
-- Now:
--   1. Getting started: only while just one person has written in a chat,
--      the other person gets ONE gentle note, at their own stated reply
--      pace (1, 2 or 3 days). The person who wrote can still close it at
--      5 days, and a chat nobody answered closes quietly after 7 days.
--      Once both have written, there are no "reply" reminders and nothing
--      closes on its own.
--   2. Check-in: after both have written and the chat is quiet for 5 days,
--      both people get one private, optional "say hi" card (once per quiet
--      stretch). Replaces "Pick it back up?". Can be turned off.
--   3. Meet nudges stay (3 weeks / 2 months / 6 months). After meeting,
--      the first one follows the pace the person picked, if they picked
--      one. The separate pace reminder card is retired.
--   4. Settings: each person can turn off check-ins, meet nudges, the
--      morning-of card, the calendar question and the short guides, for
--      all chats or one chat. The getting-started note can't be turned off
--      (it protects the person waiting), but it's only ever one note.

-- ---------------------------------------------------------------------
-- A. Reminder settings
-- ---------------------------------------------------------------------

create table if not exists public.prompt_settings (
  user_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid references public.connections(id) on delete cascade,
  kind text not null check (kind in ('check_in', 'meet_nudge', 'morning_of', 'calendar', 'guides')),
  enabled boolean not null,
  updated_at timestamptz not null default now()
);
create unique index if not exists prompt_settings_one_row
  on public.prompt_settings (user_id, coalesce(connection_id, '00000000-0000-0000-0000-000000000000'::uuid), kind);

alter table public.prompt_settings enable row level security;
drop policy if exists "Own prompt settings" on public.prompt_settings;
create policy "Own prompt settings" on public.prompt_settings
  for select using (auth.uid() = user_id);
grant select on public.prompt_settings to authenticated;

-- On unless turned off for all chats or for this chat.
create or replace function public.prompt_enabled(p_user_id uuid, p_connection_id uuid, p_kind text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1 from public.prompt_settings s
    where s.user_id = p_user_id and s.kind = p_kind and not s.enabled
      and (s.connection_id is null or s.connection_id = p_connection_id)
  );
$$;

-- { kind: { all: bool, chat: bool } } for the caller. Without a chat,
-- "chat" repeats "all".
create or replace function public.get_prompt_settings(p_connection_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_out jsonb := '{}'::jsonb;
  v_kind text;
  v_all boolean;
  v_chat boolean;
begin
  if auth.uid() is null then return v_out; end if;
  foreach v_kind in array array['check_in', 'meet_nudge', 'morning_of', 'calendar', 'guides'] loop
    select coalesce(bool_and(enabled), true) into v_all from public.prompt_settings
    where user_id = auth.uid() and kind = v_kind and connection_id is null;
    if p_connection_id is null then
      v_chat := v_all;
    else
      select coalesce(bool_and(enabled), true) into v_chat from public.prompt_settings
      where user_id = auth.uid() and kind = v_kind and connection_id = p_connection_id;
    end if;
    v_out := v_out || jsonb_build_object(v_kind, jsonb_build_object('all', v_all, 'chat', v_chat));
  end loop;
  return v_out;
end;
$$;
grant execute on function public.get_prompt_settings(uuid) to authenticated;

-- p_connection_id null = all chats.
create or replace function public.set_prompt_setting(p_connection_id uuid, p_kind text, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if p_kind not in ('check_in', 'meet_nudge', 'morning_of', 'calendar', 'guides') then
    raise exception 'bad_kind';
  end if;
  if p_connection_id is not null and not exists (
    select 1 from public.connections where id = p_connection_id and (user_a_id = v_caller or user_b_id = v_caller)
  ) then
    raise exception 'Not a participant of this connection';
  end if;

  delete from public.prompt_settings
  where user_id = v_caller and kind = p_kind and connection_id is not distinct from p_connection_id;
  if not p_enabled then
    insert into public.prompt_settings (user_id, connection_id, kind, enabled)
    values (v_caller, p_connection_id, p_kind, false);
  end if;

  -- Turning check-ins off puts away any check-in already waiting.
  if p_kind = 'check_in' and not p_enabled then
    update public.connection_interventions
    set status = 'dismissed', resolved_at = now()
    where target_user_id = v_caller and status = 'pending'
      and intervention_type = 'conversation_restart_prompt'
      and (p_connection_id is null or connection_id = p_connection_id);
  end if;
end;
$$;
grant execute on function public.set_prompt_setting(uuid, text, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- B. Both people have written (since the chat was last reopened, if it
--    was closed and opened again)
-- ---------------------------------------------------------------------

create or replace function public._both_have_written(p_connection_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.connections c
    where c.id = p_connection_id
      and exists (select 1 from public.messages m where m.connection_id = c.id and m.sender_id = c.user_a_id
                  and (c.opened_at is null or c.opened_at <= c.created_at + interval '1 minute' or m.created_at >= c.opened_at))
      and exists (select 1 from public.messages m where m.connection_id = c.id and m.sender_id = c.user_b_id
                  and (c.opened_at is null or c.opened_at <= c.created_at + interval '1 minute' or m.created_at >= c.opened_at))
  );
$$;

-- ---------------------------------------------------------------------
-- C. Reply note: getting started only, at the person's own pace
-- ---------------------------------------------------------------------

create or replace function public.run_no_ghost_check_v2(p_connection_id uuid, p_now timestamptz default now())
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_resumed_at timestamptz;
  v_last record;
  v_sender uuid;
  v_recipient uuid;
  v_elapsed interval;
  v_pace text;
  v_first interval;
  v_fired text := 'none';
begin
  select status, resumed_at into v_status, v_resumed_at from public.connections where id = p_connection_id;
  if not found or not public.is_connection_automation_eligible(v_status) then
    return 'connection_not_eligible';
  end if;

  -- Once both have written, quiet is just quiet: no reply reminders, and
  -- the chat never closes on its own.
  if public._both_have_written(p_connection_id) then
    update public.connection_interventions
    set status = 'resolved', resolved_at = now()
    where connection_id = p_connection_id and status = 'pending'
      and intervention_type in ('no_ghost_r1', 'no_ghost_r2', 'no_ghost_r3', 'no_ghost_s1');
    return 'talking';
  end if;

  select m.sender_id, m.created_at into v_last
  from public.messages m where m.connection_id = p_connection_id
  order by m.created_at desc, m.id desc limit 1;
  if not found then return 'no_messages'; end if;

  v_sender := v_last.sender_id;
  select case when c.user_a_id = v_sender then c.user_b_id else c.user_a_id end
  into v_recipient from public.connections c where c.id = p_connection_id;

  v_elapsed := p_now - greatest(v_last.created_at, coalesce(v_resumed_at, v_last.created_at));

  select response_time into v_pace from public.profiles where user_id = v_recipient;
  v_first := case v_pace
    when '1-2 days' then interval '48 hours'
    when 'A few days' then interval '72 hours'
    else interval '24 hours'
  end;

  if v_elapsed >= v_first then
    perform public.raise_intervention_once(p_connection_id, 'no_ghost_r1', v_recipient,
      jsonb_build_object('pace', v_pace), v_last.created_at);
    v_fired := 'r1';
  end if;
  if v_elapsed >= interval '125 hours' then
    perform public.raise_intervention_once(p_connection_id, 'no_ghost_s1', v_sender, '{}'::jsonb, v_last.created_at);
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

-- ---------------------------------------------------------------------
-- D. Check-in (replaces "Pick it back up?")
-- ---------------------------------------------------------------------

create or replace function public.run_conversation_restart_check_v2(p_connection_id uuid, p_now timestamptz default now())
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conn record;
  v_quiet_since timestamptz;
  v_user uuid;
  v_fired boolean := false;
begin
  select status, user_a_id, user_b_id, resumed_at into v_conn
  from public.connections where id = p_connection_id;
  if not found or not public.is_connection_automation_eligible(v_conn.status) then
    return 'connection_not_eligible';
  end if;

  if not public._both_have_written(p_connection_id) then
    return 'not_two_sided_conversation';
  end if;

  -- A plan is coming up: the meetup cards cover it.
  if exists (select 1 from public.meetups where connection_id = p_connection_id and status in ('proposed', 'confirmed')) then
    return 'meetup_already_scheduled';
  end if;

  select max(created_at) into v_quiet_since from public.messages where connection_id = p_connection_id;
  v_quiet_since := greatest(v_quiet_since, coalesce(v_conn.resumed_at, v_quiet_since));

  if p_now - v_quiet_since < interval '5 days' then
    return 'not_enough_time_elapsed';
  end if;

  foreach v_user in array array[v_conn.user_a_id, v_conn.user_b_id] loop
    if public.prompt_enabled(v_user, p_connection_id, 'check_in') then
      perform public.raise_intervention_once(p_connection_id, 'conversation_restart_prompt', v_user, '{}'::jsonb, v_quiet_since);
      v_fired := true;
    end if;
  end loop;
  return case when v_fired then 'fired' else 'turned_off' end;
end;
$$;

-- ---------------------------------------------------------------------
-- E. Pace reminders retired (meet nudges cover "want to meet again?")
-- ---------------------------------------------------------------------

create or replace function public.run_friendship_journey_sweep_all(p_now timestamptz default now())
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Pauses that have ended resume first, so their chats are checked fresh.
  perform public.run_pause_auto_resume_sweep(p_now);
  perform public.run_no_ghost_check_v2_all(p_now);
  perform public.run_meetup_occurrence_check_v2_all(p_now);
  perform public.run_conversation_restart_check_v2_all(p_now);
  perform public.evaluate_self_sustaining_all(p_now);
  perform public.run_say_hello_check_all(p_now);
  perform public.run_plan_board_check_all(p_now);
end;
$$;

-- Clean up cards that no longer exist in this design.
update public.connection_interventions
set status = 'resolved', resolved_at = now()
where status = 'pending'
  and (intervention_type in ('no_ghost_r2', 'no_ghost_r3', 'rhythm_reminder')
       or (intervention_type in ('no_ghost_r1', 'no_ghost_s1') and public._both_have_written(connection_id)));

-- ---------------------------------------------------------------------
-- F. Which card shows (morning-of can be turned off; pace card gone)
-- ---------------------------------------------------------------------

create or replace function public.get_active_intervention(p_connection_id uuid, p_viewer_id uuid)
returns table(intervention_type text, source text, intervention_id uuid, payload jsonb)
language plpgsql
security definer
set search_path = public
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

  -- rank 1: the day-before and morning-of meetup prompts (computed live)
  select * into v_meetup from public.meetups
  where connection_id = p_connection_id and status = 'confirmed' and not logged_after
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
      'activity', v_meetup.activity,
      'first_meetup', not exists (select 1 from public.meetups o where o.connection_id = p_connection_id and o.status = 'occurred'));

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
       and public.prompt_enabled(p_viewer_id, p_connection_id, 'morning_of')
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

  -- rank 2: after a meetup, "Did you meet?" and "How did it go?"
  return query
  select ci.intervention_type, 'stored'::text, ci.id, ci.payload
  from public.connection_interventions ci
  where ci.connection_id = p_connection_id
    and ci.target_user_id = p_viewer_id
    and ci.status = 'pending'
    and ci.intervention_type in ('meetup_occurrence_check','post_meetup_reflection')
  order by case ci.intervention_type when 'meetup_occurrence_check' then 1 else 2 end
  limit 1;
  if found then return; end if;

  -- rank 3: the getting-started note (and the "it's been quiet" card for
  -- the person who wrote)
  return query
  select ci.intervention_type, 'stored'::text, ci.id, ci.payload
  from public.connection_interventions ci
  where ci.connection_id = p_connection_id
    and ci.target_user_id = p_viewer_id
    and ci.status = 'pending'
    and ci.intervention_type in ('no_ghost_r1','no_ghost_s1')
  order by case ci.intervention_type when 'no_ghost_s1' then 2 else 1 end desc
  limit 1;
  if found then return; end if;

  -- rank 4: other stored cards, in priority order
  return query
  select ci.intervention_type, 'stored'::text, ci.id, ci.payload
  from public.connection_interventions ci
  where ci.connection_id = p_connection_id
    and (ci.target_user_id = p_viewer_id or ci.target_user_id is null)
    and ci.status = 'pending'
    and ci.intervention_type in ('second_look_prompt','conversation_restart_prompt')
  order by case ci.intervention_type
    when 'second_look_prompt' then 5
    when 'conversation_restart_prompt' then 6
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

-- ---------------------------------------------------------------------
-- G. Meet nudges: can be turned off; after meeting, the first one follows
--    the person's own pace if they picked one.
-- ---------------------------------------------------------------------

create or replace function public.get_meet_nudge(p_connection_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_conn public.connections%rowtype;
  v_days numeric;
  v_anchor text := 'none';
  v_met boolean := false;
  v_last record;
  v_three public.meet_nudges%rowtype;
  v_first numeric := 21;
  v_cadence text;
begin
  if v_caller is null then return null; end if;
  select * into v_conn from public.connections
  where id = p_connection_id and (user_a_id = v_caller or user_b_id = v_caller);
  if not found then return null; end if;
  if v_conn.status is not null and v_conn.status not in ('pending', 'active') then return null; end if;
  if not public.prompt_enabled(v_caller, p_connection_id, 'meet_nudge') then return null; end if;
  -- Already planning, a plan or an invite on the way, or a meetup waiting
  -- for "Did you meet?": let them.
  if public._plan_has_upcoming(p_connection_id) then return null; end if;
  if exists (select 1 from public.meetups m where m.connection_id = p_connection_id and m.status = 'confirmed') then
    return null;
  end if;
  if exists (select 1 from public.plan_boards b where b.connection_id = p_connection_id and b.status = 'open') then
    return null;
  end if;
  if exists (select 1 from public.plan_invites i where i.connection_id = p_connection_id and i.status = 'open'
             and i.created_at > now() - interval '14 days') then
    return null;
  end if;

  select * into v_last from public._last_meetup(p_connection_id);
  if v_last.meetup_id is not null then
    v_met := true;
    v_anchor := v_last.meetup_id::text;
    v_days := greatest(0, extract(epoch from (now() - v_last.met_at
                - public._paused_between(p_connection_id, v_last.met_at, now()))) / 86400.0);
    select cadence into v_cadence from public.rhythm_preferences
    where connection_id = p_connection_id and user_id = v_caller;
    v_first := case v_cadence
      when 'weekly' then 10
      when 'few_weeks' then 21
      when 'monthly' then 35
      when 'occasional' then 60
      else 21
    end;
  elsif coalesce(v_conn.meetup_count, 0) > 0 then
    -- Met before meetups were tracked this way: nothing to count from.
    return null;
  else
    v_days := public._talking_days(p_connection_id);
  end if;

  if v_days >= 180 then
    if not exists (select 1 from public.meet_nudges where connection_id = p_connection_id
                   and user_id = v_caller and stage = 'six_months' and anchor = v_anchor) then
      return jsonb_build_object('stage', 'six_months', 'days', floor(v_days), 'met', v_met);
    end if;
    return null;
  end if;

  if v_days >= 60 then
    if not exists (select 1 from public.meet_nudges where connection_id = p_connection_id
                   and user_id = v_caller and stage = 'two_months' and anchor = v_anchor) then
      return jsonb_build_object('stage', 'two_months', 'days', floor(v_days), 'met', v_met);
    end if;
    return null;
  end if;

  if v_days >= v_first then
    select * into v_three from public.meet_nudges
    where connection_id = p_connection_id and user_id = v_caller and stage = 'three_weeks' and anchor = v_anchor;
    if not found or v_three.ask_again_at <= now() then
      return jsonb_build_object('stage', 'three_weeks', 'days', floor(v_days), 'met', v_met,
                                'pace', case when v_cadence in ('weekly', 'few_weeks', 'monthly') then v_cadence end);
    end if;
  end if;
  return null;
end;
$$;
grant execute on function public.get_meet_nudge(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- H. Inbox: show an invite to meet waiting for you
-- ---------------------------------------------------------------------

create or replace function public.my_plan_turns()
returns table(connection_id uuid, stage text, waiting_on_me boolean, closes_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select b.connection_id, 'drafting'::text, true, b.last_activity_at + interval '14 days'
  from public.plan_boards b
  join public.connections c on c.id = b.connection_id
  where b.status = 'open'
    and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
    and not public._plan_has_upcoming(b.connection_id)
    and (b.started_by = auth.uid()
         or exists (select 1 from public.plan_picks k where k.board_id = b.id and k.user_id = auth.uid())
         or exists (select 1 from public.plan_times t where t.board_id = b.id and t.user_id = auth.uid()))
  union all
  select distinct on (i.connection_id) i.connection_id,
         case when i.sender_id = auth.uid() then 'invite_sent' else 'invite_received' end,
         i.sender_id <> auth.uid(), null::timestamptz
  from public.plan_invites i
  join public.connections c on c.id = i.connection_id
  where i.status = 'open'
    and i.created_at > now() - interval '14 days'
    and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
    and not public._plan_has_upcoming(i.connection_id)
    and not exists (select 1 from public.plan_boards b2 where b2.connection_id = i.connection_id
                    and b2.status = 'open' and b2.started_by = auth.uid())
  order by 1;
$$;
grant execute on function public.my_plan_turns() to authenticated;

-- ---------------------------------------------------------------------
-- I. Test tab: one "quiet chat" tool covers both kinds of chat
-- ---------------------------------------------------------------------

create or replace function public.test_no_reply(p_connection_id uuid, p_hours integer)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conn public.connections%rowtype;
  v_last record;
  v_sender_name text;
  v_recipient uuid;
  v_recipient_name text;
  v_result text;
  v_check text;
  v_reopened boolean := false;
begin
  if not public.is_test_operator() then raise exception 'Test tools are only for admins and test accounts'; end if;
  select * into v_conn from public.connections
  where id = p_connection_id and (user_a_id = auth.uid() or user_b_id = auth.uid());
  if not found then raise exception 'You are not part of that chat'; end if;
  if v_conn.status in ('blocked', 'ended') then
    raise exception 'This chat is %. Pick another chat.', v_conn.status;
  end if;

  select id, sender_id, created_at into v_last from public.messages
  where connection_id = p_connection_id order by created_at desc, id desc limit 1;
  if not found then raise exception 'Send a message in this chat first.'; end if;

  if v_conn.status in ('inactive', 'paused') then
    update public.connections set status = 'active' where id = p_connection_id;
    delete from public.connection_pause_details where connection_id = p_connection_id;
    v_reopened := true;
  end if;
  -- Forget any earlier reopen, so moving the messages back keeps them in
  -- this conversation.
  update public.connections set resumed_at = null, opened_at = created_at where id = p_connection_id;

  delete from public.connection_interventions
  where connection_id = p_connection_id
    and (intervention_type like 'no\_ghost\_%' or intervention_type = 'conversation_restart_prompt');
  update public.messages
  set created_at = created_at + ((now() - make_interval(hours => p_hours)) - v_last.created_at)
  where connection_id = p_connection_id;

  v_recipient := case when v_conn.user_a_id = v_last.sender_id then v_conn.user_b_id else v_conn.user_a_id end;
  select display_name into v_sender_name from public.profiles where user_id = v_last.sender_id;
  select display_name into v_recipient_name from public.profiles where user_id = v_recipient;

  v_result := public.run_no_ghost_check_v2(p_connection_id, now());
  v_check := public.run_conversation_restart_check_v2(p_connection_id, now());

  return (case when v_reopened then 'Reopened the chat first. ' else '' end)
    || format('The last message (from %s) is now %s hours old. ', v_sender_name, p_hours)
    || case
      when v_result = 'talking' then
        case v_check
          when 'fired' then 'You have both written, so there are no reply reminders. Both people now see a check-in card.'
          when 'turned_off' then 'You have both written. A check-in would show now, but both people turned check-ins off.'
          when 'meetup_already_scheduled' then 'You have both written, and a plan is set, so nothing shows.'
          else 'You have both written, so there are no reply reminders. A check-in shows after 5 quiet days.'
        end
      when v_result = 'none' then format('Only %s has written so far. %s gets one gentle note at their usual reply pace (1, 2 or 3 days).', v_sender_name, v_recipient_name)
      when v_result = 'r1' then format('Only %s has written so far. %s now sees a gentle note about the hello.', v_sender_name, v_recipient_name)
      when v_result = 's1' then format('%s now sees "It''s been quiet" (send one more, wait, or close). %s still sees the gentle note.', v_sender_name, v_recipient_name)
      when v_result = 'auto_closed' then 'Nobody answered for 7 days, so this chat closed quietly.'
      else v_result
    end;
end;
$$;

-- ---------------------------------------------------------------------
-- Version
-- ---------------------------------------------------------------------

create or replace function public.limen_db_version()
returns text
language sql
stable
as $$ select '20261010000001'::text $$;
grant execute on function public.limen_db_version() to anon, authenticated;
