-- "Remind me later" after a good meetup (2026-10-10, later still).
-- After someone says a meetup went well, the card asks whether they'd like
-- to tell the other person how it was. Besides Tell / Plan another / Not now,
-- they can now pick "Remind me in 1 / 3 / 7 days". On that day the same
-- private card comes back once: "You asked to be reminded...". It's the
-- person's own reminder, so it comes back even if they've messaged since
-- (the app never reads messages); the card says "If you already have, you
-- can close this."
--
-- Stored as a connection_interventions row of type 'share_reminder' with
-- status 'snoozed' until the chosen time. get_active_intervention wakes it
-- (status back to 'pending') once the time has passed, at the same level as
-- the other after-a-meetup cards. Only one card shows at a time. A newer
-- reminder replaces an older one. It never shows in a chat that has been
-- paused, ended, blocked or closed.
-- Safe to run again.

create or replace function public.remind_me_to_share(p_meetup_id uuid, p_days integer)
returns timestamptz
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_caller uuid := auth.uid();
  v_meetup record;
  v_at timestamptz;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if p_days is null or p_days < 1 or p_days > 14 then
    raise exception 'Pick between 1 and 14 days';
  end if;
  select m.* into v_meetup from public.meetups m
  where m.id = p_meetup_id and exists (
    select 1 from public.connections c where c.id = m.connection_id and (c.user_a_id = v_caller or c.user_b_id = v_caller));
  if not found then raise exception 'Not a participant of this meetup''s connection'; end if;

  -- A newer reminder replaces an older one in this chat.
  update public.connection_interventions
  set status = 'dismissed', resolved_at = now()
  where connection_id = v_meetup.connection_id and target_user_id = v_caller
    and intervention_type = 'share_reminder' and status in ('pending', 'snoozed');

  v_at := now() + make_interval(days => p_days);
  insert into public.connection_interventions (connection_id, target_user_id, intervention_type, status, snoozed_until, payload)
  values (v_meetup.connection_id, v_caller, 'share_reminder', 'snoozed', v_at,
          jsonb_build_object('meetup_id', v_meetup.id,
                             'meetup_date', coalesce(v_meetup.occurred_date, v_meetup.confirmed_date),
                             'days', p_days));
  return v_at;
end;
$function$;

grant execute on function public.remind_me_to_share(uuid, integer) to authenticated;

-- Test tab: make this person's waiting reminders in a chat due now.
create or replace function public.test_share_reminder_now(p_connection_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_n integer;
begin
  if not public.is_test_operator() then raise exception 'Test tools are only for admins and test accounts'; end if;
  if not exists (select 1 from public.connections where id = p_connection_id
                 and (user_a_id = auth.uid() or user_b_id = auth.uid())) then
    raise exception 'Not a participant of this connection';
  end if;
  update public.connection_interventions
  set snoozed_until = now() - interval '1 minute'
  where connection_id = p_connection_id and target_user_id = auth.uid()
    and intervention_type = 'share_reminder' and status = 'snoozed';
  get diagnostics v_n = row_count;
  if v_n = 0 then
    return 'No "remind me later" waiting in this chat. After a meetup, say it went well, then pick Remind me later.';
  end if;
  return 'The reminder is due now. Open the chat to see it.';
end;
$function$;

grant execute on function public.test_share_reminder_now(uuid) to authenticated;

create or replace FUNCTION public.get_active_intervention(p_connection_id uuid, p_viewer_id uuid)
 RETURNS TABLE(intervention_type text, source text, intervention_id uuid, payload jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- "Remind me later" after a good meetup: wake it once its day comes.
  update public.connection_interventions ci
  set status = 'pending'
  where ci.connection_id = p_connection_id
    and ci.target_user_id = p_viewer_id
    and ci.intervention_type = 'share_reminder'
    and ci.status = 'snoozed'
    and ci.snoozed_until <= now();

  -- rank 2: after a meetup, "Did you meet?", "How did it go?" and a
  -- reminder the person asked for
  return query
  select ci.intervention_type, 'stored'::text, ci.id, ci.payload
  from public.connection_interventions ci
  where ci.connection_id = p_connection_id
    and ci.target_user_id = p_viewer_id
    and ci.status = 'pending'
    and ci.intervention_type in ('meetup_occurrence_check','post_meetup_reflection','share_reminder')
  order by case ci.intervention_type when 'meetup_occurrence_check' then 1 when 'post_meetup_reflection' then 2 else 3 end
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
$function$;

-- A closed chat also drops a waiting reminder, so it can't pop up if the
-- chat is reopened much later.
create or replace FUNCTION public.clear_interventions_on_connection_closed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.status in ('blocked','inactive','ended','graduated') and (old.status is distinct from new.status) then
    update public.connection_interventions
    set status = 'resolved', resolved_at = now()
    where connection_id = new.id
      and (status = 'pending' or (status = 'snoozed' and intervention_type = 'share_reminder'));
  end if;
  return new;
end;
$function$;

create or replace function public.limen_db_version()
returns text
language sql
stable
as $function$ select '20261010000002'::text $function$;
