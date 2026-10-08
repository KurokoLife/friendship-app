-- 2026-10-08, after-meetup fixes found in testing:
-- 1. "Didn't show up" failed: the reason check inside
--    submit_meetup_cancellation_reason didn't include 'no_show'.
-- 2. After "How did it go?", a second card asked "Would you be open to
--    giving this connection a little more time?", the same question again.
--    A good answer now counts as that "yes" directly (it still moves the
--    friendship forward the same way), and the extra card is no longer
--    raised. Any that are waiting now are cleared.

create or replace function public.submit_meetup_cancellation_reason(
  p_meetup_id uuid, p_reason text, p_wants_reschedule boolean default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid := auth.uid();
  v_conn_id uuid;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if p_reason not in ('schedule_conflict','circumstances_changed','lost_interest','other','no_show') then
    raise exception 'Unknown reason';
  end if;

  select m.connection_id into v_conn_id from public.meetups m
  where m.id = p_meetup_id and exists (
    select 1 from public.connections c where c.id = m.connection_id and (c.user_a_id = v_caller or c.user_b_id = v_caller)
  );
  if v_conn_id is null then raise exception 'Not a participant of this meetup''s connection'; end if;

  insert into public.meetup_cancellation_reasons (connection_id, user_id, meetup_id, reason, wants_reschedule)
  values (v_conn_id, v_caller, p_meetup_id, p_reason, p_wants_reschedule);
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

  -- A good answer is the "yes, keep going" the old second card used to ask.
  if p_response in ('know_better','open_to_another') then
    perform public.submit_second_look_response(v_meetup.conn_id, 'yes');
  end if;
end;
$$;

update public.connection_interventions
set status = 'resolved', resolved_at = now()
where intervention_type = 'second_look_prompt' and status = 'pending';

-- ------------------------------------------------------------------
-- 3. Reminders that come back after being dismissed
-- ------------------------------------------------------------------
-- The 15-minute sweep re-raised a no-reply reminder, a "pick it back up"
-- prompt or a rhythm reminder as soon as the person dismissed it, because
-- raise_intervention only looked for one still pending. Now each is raised
-- once per quiet spell: if one was already raised since `p_since` (the
-- last message, or the last meetup) and the person answered or dismissed
-- it, it isn't raised again. A snoozed one ("I'll come back to this")
-- comes back when the snooze ends.
create or replace function public.raise_intervention_once(
  p_connection_id uuid,
  p_intervention_type text,
  p_target_user_id uuid,
  p_payload jsonb,
  p_since timestamptz
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
    and created_at >= p_since
    and status in ('resolved', 'dismissed')
  limit 1;
  if v_id is not null then
    return v_id;
  end if;
  return public.raise_intervention(p_connection_id, p_intervention_type, p_target_user_id, p_payload);
end;
$$;

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
  v_elapsed interval;
  v_fired text := 'none';
begin
  select status into v_status from public.connections where id = p_connection_id;
  if not found or not public.is_connection_automation_eligible(v_status) then
    return 'connection_not_eligible';
  end if;

  select m.sender_id, m.created_at into v_last
  from public.messages m where m.connection_id = p_connection_id
  order by m.created_at desc, m.id desc limit 1;
  if not found then return 'no_messages'; end if;

  v_sender := v_last.sender_id;
  select case when c.user_a_id = v_sender then c.user_b_id else c.user_a_id end
  into v_recipient from public.connections c where c.id = p_connection_id;

  v_elapsed := p_now - v_last.created_at;

  if v_elapsed >= interval '24 hours' then
    perform public.raise_intervention_once(p_connection_id, 'no_ghost_r1', v_recipient, '{}'::jsonb, v_last.created_at);
    v_fired := 'r1';
  end if;
  if v_elapsed >= interval '72 hours' then
    perform public.raise_intervention_once(p_connection_id, 'no_ghost_r2', v_recipient, '{}'::jsonb, v_last.created_at);
    v_fired := 'r2';
  end if;
  if v_elapsed >= interval '120 hours' then
    perform public.raise_intervention_once(p_connection_id, 'no_ghost_r3', v_recipient, '{}'::jsonb, v_last.created_at);
    v_fired := 'r3';
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

  perform public.raise_intervention_once(p_connection_id, 'conversation_restart_prompt', v_conn.user_a_id, '{}'::jsonb, v_last_message_at);
  perform public.raise_intervention_once(p_connection_id, 'conversation_restart_prompt', v_conn.user_b_id, '{}'::jsonb, v_last_message_at);
  return 'fired';
end;
$$;

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

  -- No reminder while a meetup is already planned.
  if exists (select 1 from public.meetups where connection_id = p_connection_id and status in ('proposed','confirmed')) then
    return;
  end if;

  foreach v_user_id in array array[v_user_a, v_user_b]
  loop
    select * into v_pref from public.rhythm_preferences
    where connection_id = p_connection_id and user_id = v_user_id;

    if not found then
      if array_length(v_recent_meetups, 1) = 2 and v_recent_meetups[1] <> v_recent_meetups[2] then
        perform public.raise_intervention_once(p_connection_id, 'rhythm_reminder', v_user_id,
          jsonb_build_object('mode', 'initial'), v_last_occurred::timestamptz);
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
          perform public.raise_intervention_once(p_connection_id, 'rhythm_reminder', v_user_id,
            jsonb_build_object('mode', 'recurring', 'cadence', v_pref.cadence), v_last_occurred::timestamptz);
        end if;
      end if;
    end if;
  end loop;
end;
$$;

-- "I'll come back to this", "Not right now", "Give it more time": the
-- person's own card goes away (snoozed for a while, or dismissed). Before,
-- these buttons only reloaded the screen and the same card came straight
-- back.
create or replace function public.dismiss_intervention(p_intervention_id uuid, p_snooze_hours integer default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  update public.connection_interventions ci
  set status = case when p_snooze_hours is null then 'dismissed' else 'snoozed' end,
      snoozed_until = case when p_snooze_hours is null then null else now() + make_interval(hours => p_snooze_hours) end,
      resolved_at = now()
  where ci.id = p_intervention_id
    and ci.status = 'pending'
    and (ci.target_user_id = v_caller or (ci.target_user_id is null and exists (
      select 1 from public.connections c where c.id = ci.connection_id and (c.user_a_id = v_caller or c.user_b_id = v_caller))));
end;
$$;

grant execute on function public.dismiss_intervention(uuid, integer) to authenticated;

-- ------------------------------------------------------------------
-- 5. Meetup prompts come before reply reminders
-- ------------------------------------------------------------------
-- A pending "Still on?", morning-of check, "Did you meet?" or "How did it
-- go?" now shows before a no-reply reminder (only one card shows at a
-- time). Before, someone who owed a reply never saw "How did it go?" after
-- a meetup until they replied. The reminder shows right after.
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

  -- rank 1: the day-before and morning-of meetup prompts (computed live)
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

  -- rank 2: after a meetup, "Did you meet?" and "How did it go?" (quick,
  -- one-tap answers about something that just happened)
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

  -- rank 3: no-reply reminders
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

  -- rank 4: other stored cards, in priority order
  return query
  select ci.intervention_type, 'stored'::text, ci.id, ci.payload
  from public.connection_interventions ci
  where ci.connection_id = p_connection_id
    and (ci.target_user_id = p_viewer_id or ci.target_user_id is null)
    and ci.status = 'pending'
    and ci.intervention_type in (
      'second_look_prompt','conversation_restart_prompt','rhythm_reminder'
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
-- 4. Test tools: admins and the 9 test accounts only
-- ------------------------------------------------------------------
-- Several older test functions could be called by any signed-in person on
-- the live site (for example, sending a message as the other person, or
-- reopening an ended chat). They are now closed to everyone, and the Test
-- tab uses the checked versions below.
create or replace function public.is_test_operator()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (select 1 from public.users where id = auth.uid() and is_admin)
      or exists (
        select 1 from auth.users
        where id = auth.uid()
          and ltrim(coalesce(phone, ''), '+') in (
            '15555500101','15555500102','15555500103','15555500104','15555500105',
            '15555500106','15555500107','15555500108','15555500109'));
$$;

grant execute on function public.is_test_operator() to authenticated;

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname like 'dev\_%'
      and p.proname not in ('dev_meetup_test', 'dev_force_mutual_interest', 'dev_mark_selfie_verified')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;

-- Checked versions of the older tools the Test tab still uses.
create or replace function public.test_send_message_as(p_connection_id uuid, p_sender_id uuid, p_content text, p_hours_ago numeric default 0)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_test_operator() then raise exception 'Test tools are only for admins and test accounts'; end if;
  return public.dev_send_backdated_message(p_connection_id, p_sender_id, p_content, p_hours_ago);
end;
$$;

create or replace function public.test_reopen_chat(p_connection_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_test_operator() then raise exception 'Test tools are only for admins and test accounts'; end if;
  perform public.dev_reactivate_connection_for_testing(p_connection_id);
  return 'Reopened. The chat is active again.';
end;
$$;

create or replace function public.test_clear_my_suggestions()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_test_operator() then raise exception 'Test tools are only for admins and test accounts'; end if;
  return public.dev_clear_my_suggestions();
end;
$$;

create or replace function public.test_reset_my_matches()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_test_operator() then raise exception 'Test tools are only for admins and test accounts'; end if;
  perform public.dev_reset_my_matches();
end;
$$;

create or replace function public.test_clear_ai_limits()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_test_operator() then raise exception 'Test tools are only for admins and test accounts'; end if;
  delete from public.ai_usage_events where user_id = auth.uid();
end;
$$;

-- No-reply reminders: make the chat's last message N hours old and run
-- the real reminder check, so the card each person would see shows now.
create or replace function public.test_no_reply(p_connection_id uuid, p_hours integer)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_conn public.connections%rowtype;
  v_last record;
  v_sender_name text;
  v_recipient uuid;
  v_recipient_name text;
  v_result text;
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
    v_reopened := true;
  end if;

  delete from public.connection_interventions
  where connection_id = p_connection_id and intervention_type like 'no\_ghost\_%';
  -- Move the whole conversation back in time together, so the order of
  -- messages stays the same and the last one is exactly p_hours old.
  update public.messages
  set created_at = created_at + ((now() - make_interval(hours => p_hours)) - v_last.created_at)
  where connection_id = p_connection_id;

  v_recipient := case when v_conn.user_a_id = v_last.sender_id then v_conn.user_b_id else v_conn.user_a_id end;
  select display_name into v_sender_name from public.profiles where user_id = v_last.sender_id;
  select display_name into v_recipient_name from public.profiles where user_id = v_recipient;

  v_result := public.run_no_ghost_check_v2(p_connection_id, now());

  return (case when v_reopened then 'Reopened the chat first. ' else '' end) || format('The last message (from %s) is now %s hours old. ', v_sender_name, p_hours) ||
    case v_result
      when 'none' then format('No reminder yet. %s sees the "Sometimes it takes a few days" note from 36 hours.', v_sender_name)
      when 'r1' then format('%s now sees "Still meaning to reply?". %s sees a calm note.', v_recipient_name, v_sender_name)
      when 'r2' then format('%s now sees the second reminder (reply, take more time, or end).', v_recipient_name)
      when 'r3' then format('%s now sees the last reminder.', v_recipient_name)
      when 's1' then format('%s now sees "It''s been quiet for a while" (send one more, wait, or close). %s still sees the last reminder.', v_sender_name, v_recipient_name)
      when 'auto_closed' then 'The chat has now closed by itself after 7 days without a reply.'
      else v_result
    end;
end;
$$;

-- Reset every test account. dev_reset_all_seed_matches had no check on
-- who was calling it.
create or replace function public.test_reset_all_test_accounts()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_result jsonb;
  v_interests integer;
begin
  if not public.is_test_operator() then raise exception 'Test tools are only for admins and test accounts'; end if;
  v_result := public.dev_reset_all_seed_matches();
  delete from public.interests
  where public._is_seed_account(from_user_id) or public._is_seed_account(to_user_id);
  get diagnostics v_interests = row_count;
  return v_result || jsonb_build_object('interests_deleted', v_interests);
end;
$$;

grant execute on function public.test_reset_all_test_accounts() to authenticated;
grant execute on function public.test_send_message_as(uuid, uuid, text, numeric) to authenticated;
grant execute on function public.test_reopen_chat(uuid) to authenticated;
grant execute on function public.test_clear_my_suggestions() to authenticated;
grant execute on function public.test_reset_my_matches() to authenticated;
grant execute on function public.test_clear_ai_limits() to authenticated;
grant execute on function public.test_no_reply(uuid, integer) to authenticated;
