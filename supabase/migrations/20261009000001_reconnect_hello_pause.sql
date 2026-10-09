-- 2026-10-09 (2): reconnecting without a second selfie, one shared count
-- for the 3-conversation limit, a gentle nudge and a 14-day close for
-- matches where nobody says hello, and clearer pause rules.
--
-- Safe to run more than once.

-- ---------------------------------------------------------------------
-- A. New columns
-- ---------------------------------------------------------------------

-- When a match last opened (or reopened). Used for the "say hello" nudge
-- and the 14-day close, so a reopened match gets a fresh 14 days.
alter table public.connections add column if not exists opened_at timestamptz;
update public.connections set opened_at = created_at where opened_at is null;
alter table public.connections alter column opened_at set default now();

-- When a paused chat last resumed. Reply reminders count from the later of
-- the last message and this, so coming back from a two-week pause doesn't
-- instantly fire "it's been 7 days" and close the chat.
alter table public.connections add column if not exists resumed_at timestamptz;

-- ---------------------------------------------------------------------
-- B. Reconnecting: no second selfie for people who already talked
-- ---------------------------------------------------------------------

-- True when these two people already have a chat with at least one message.
create or replace function public.users_have_chatted(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.connections c
    join public.messages m on m.connection_id = c.id
    where (c.user_a_id = p_a and c.user_b_id = p_b)
       or (c.user_a_id = p_b and c.user_b_id = p_a)
  );
$$;

revoke execute on function public.users_have_chatted(uuid, uuid) from public, anon, authenticated;

create or replace function public.express_interest(p_other_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid := auth.uid();
  v_connection_id uuid;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if v_caller = p_other_user_id then raise exception 'Cannot connect to yourself'; end if;

  -- The selfie check is for meeting someone new. Two people who already
  -- talked can say hello again without doing it a second time.
  if not exists (select 1 from public.users where id = v_caller and selfie_verified_at is not null)
     and not public.users_have_chatted(v_caller, p_other_user_id) then
    raise exception 'not_verified';
  end if;
  if not public.is_user_active(v_caller) then raise exception 'suspended'; end if;
  if not public.is_user_active(p_other_user_id) then raise exception 'unavailable'; end if;
  if exists (
    select 1 from public.blocks b
    where (b.blocker_id = v_caller and b.blocked_id = p_other_user_id)
       or (b.blocker_id = p_other_user_id and b.blocked_id = v_caller)
  ) then
    raise exception 'blocked';
  end if;

  insert into public.interests (from_user_id, to_user_id)
  values (v_caller, p_other_user_id)
  on conflict do nothing;

  if not exists (select 1 from public.interests where from_user_id = p_other_user_id and to_user_id = v_caller) then
    return jsonb_build_object('mutual', false);
  end if;

  v_connection_id := public.create_connection_with_capacity_check(p_other_user_id);
  return jsonb_build_object('mutual', true, 'connection_id', v_connection_id);
end;
$$;

grant execute on function public.express_interest(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- C. One shared count for the conversation limits
-- ---------------------------------------------------------------------
-- Active: both people have written. Waiting: you wrote, they haven't yet.
-- Paused, closed, ended, blocked and graduated chats never count.
-- Before this, three functions each had their own copy of these counts,
-- and one of them forgot that graduated chats don't count.

create or replace function public.connection_counts(p_user uuid)
returns table (active_count integer, pending_count integer)
language sql
stable
security definer
set search_path to 'public'
as $$
  with mine as (
    select
      exists (select 1 from public.messages m where m.connection_id = c.id and m.sender_id = p_user) as i_wrote,
      exists (select 1 from public.messages m where m.connection_id = c.id and m.sender_id <> p_user) as they_wrote
    from public.connections c
    where (c.user_a_id = p_user or c.user_b_id = p_user)
      and (c.status is null or c.status not in ('passed', 'inactive', 'paused', 'blocked', 'ended', 'graduated'))
  )
  select
    count(*) filter (where i_wrote and they_wrote)::integer,
    count(*) filter (where i_wrote and not they_wrote)::integer
  from mine;
$$;

revoke execute on function public.connection_counts(uuid) from public, anon, authenticated;

create or replace function public.check_connection_capacity(p_user uuid)
returns void
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_active integer;
  v_pending integer;
begin
  select active_count, pending_count into v_active, v_pending from public.connection_counts(p_user);
  if v_active >= 3 then raise exception 'active_cap_reached'; end if;
  if v_pending >= 5 then raise exception 'pending_cap_reached'; end if;
end;
$$;

revoke execute on function public.check_connection_capacity(uuid) from public, anon, authenticated;

create or replace function public.my_connection_capacity()
returns table(is_premium boolean, active_count integer, active_cap integer, pending_count integer, pending_cap integer)
language sql
stable
security definer
set search_path to 'public'
as $$
  select u.is_premium, k.active_count, 3, k.pending_count, 5
  from public.users u, public.connection_counts(auth.uid()) k
  where u.id = auth.uid();
$$;

grant execute on function public.my_connection_capacity() to authenticated;

create or replace function public.create_connection_with_capacity_check(p_other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid := auth.uid();
  v_existing_id uuid;
  v_existing_status text;
  v_new_id uuid;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if v_caller = p_other_user_id then raise exception 'Cannot connect to yourself'; end if;
  if not public.is_user_active(v_caller) then raise exception 'suspended'; end if;
  if not public.is_user_active(p_other_user_id) then raise exception 'unavailable'; end if;
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
    if v_existing_status = 'blocked' then raise exception 'blocked'; end if;
    if v_existing_status = 'ended' then raise exception 'ended'; end if;
    -- Reopening a chat that closed counts like starting a new one, so it
    -- can't take anyone past the limit.
    if v_existing_status in ('inactive', 'passed') then
      perform public.check_connection_capacity(v_caller);
      update public.connections set status = 'pending', opened_at = now() where id = v_existing_id;
    end if;
    return v_existing_id;
  end if;

  perform public.check_connection_capacity(v_caller);

  insert into public.connections (user_a_id, user_b_id, status, opened_at)
  values (v_caller, p_other_user_id, 'pending', now())
  returning id into v_new_id;
  return v_new_id;
end;
$$;

grant execute on function public.create_connection_with_capacity_check(uuid) to authenticated;

create or replace function public.reinitiate_ended_connection(p_other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid := auth.uid();
  v_existing_id uuid;
  v_existing_status text;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
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

  -- Only ever reopens a chat someone deliberately ended.
  if v_existing_id is null or v_existing_status is distinct from 'ended' then
    raise exception 'not_ended';
  end if;

  perform public.check_connection_capacity(v_caller);
  update public.connections set status = 'pending', opened_at = now() where id = v_existing_id;
  return v_existing_id;
end;
$$;

grant execute on function public.reinitiate_ended_connection(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- D. Matches where nobody says hello
-- ---------------------------------------------------------------------
-- From 2 days the chat and Inbox gently suggest a short hello (shown by
-- the app from opened_at). At 14 days with no message from either person,
-- the match closes quietly, so nobody is left wondering. Either person can
-- still say hello again later from the other's profile.

create or replace view public.new_mutual_connections as
select
  c.id as connection_id,
  case when c.user_a_id = auth.uid() then c.user_b_id else c.user_a_id end as other_user_id,
  p.display_name,
  p.photo_url,
  c.created_at,
  greatest(coalesce(c.opened_at, c.created_at), c.resumed_at) as opened_at,
  greatest(coalesce(c.opened_at, c.created_at), c.resumed_at) + interval '14 days' as closes_at
from public.connections c
join public.profiles p
  on p.user_id = case when c.user_a_id = auth.uid() then c.user_b_id else c.user_a_id end
where (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
  and (c.status is null or c.status not in ('blocked', 'ended', 'passed', 'inactive'))
  and not exists (select 1 from public.messages m where m.connection_id = c.id)
  and public.mutual_interest_exists(c.user_a_id, c.user_b_id);

grant select on public.new_mutual_connections to authenticated;

create or replace function public.run_say_hello_check(p_connection_id uuid, p_now timestamptz default now())
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_conn public.connections%rowtype;
begin
  select * into v_conn from public.connections where id = p_connection_id;
  if not found or not public.is_connection_automation_eligible(v_conn.status) then
    return 'connection_not_eligible';
  end if;
  if exists (select 1 from public.messages where connection_id = p_connection_id) then
    return 'already_talking';
  end if;
  if greatest(coalesce(v_conn.opened_at, v_conn.created_at), v_conn.resumed_at)
     > p_now - interval '14 days' then
    return 'not_yet';
  end if;
  update public.connections set status = 'inactive' where id = p_connection_id;
  perform public.record_friendship_event(p_connection_id, 'match_closed_no_hello', null, '{}'::jsonb);
  return 'closed';
end;
$$;

revoke execute on function public.run_say_hello_check(uuid, timestamptz) from public, anon, authenticated;

create or replace function public.run_say_hello_check_all(p_now timestamptz default now())
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
begin
  for v_id in
    select c.id from public.connections c
    where public.is_connection_automation_eligible(c.status)
      and greatest(coalesce(c.opened_at, c.created_at), c.resumed_at) <= p_now - interval '14 days'
      and not exists (select 1 from public.messages m where m.connection_id = c.id)
  loop
    perform public.run_say_hello_check(v_id, p_now);
  end loop;
end;
$$;

revoke execute on function public.run_say_hello_check_all(timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- E. Pause rules
-- ---------------------------------------------------------------------
-- 1. A pause always has an end date, at most 2 weeks away.
-- 2. Both people can see that the chat is paused and until when.
-- 3. While paused: no reminders, no messages from either person, and the
--    chat doesn't count toward the 3 active conversations.
-- 4. Only the person who paused can resume early. It resumes by itself on
--    the end date. The other person can always end the connection.
-- 5. One person can pause the same chat at most twice in 30 days.

create or replace function public.pause_connection_with_duration(p_connection_id uuid, p_paused_until timestamptz default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid := auth.uid();
  v_status text;
  v_until timestamptz := coalesce(p_paused_until, now() + interval '7 days');
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  select status into v_status from public.connections c
  where c.id = p_connection_id and (c.user_a_id = v_caller or c.user_b_id = v_caller);
  if not found then raise exception 'Not a participant of this connection'; end if;
  if v_status = 'paused' then raise exception 'already_paused'; end if;
  if v_status in ('inactive', 'blocked', 'ended', 'graduated', 'passed') then
    raise exception 'not_open';
  end if;
  if v_until < now() + interval '1 hour' or v_until > now() + interval '14 days 1 hour' then
    raise exception 'pause_length';
  end if;
  if (
    select count(*) from public.friendship_events
    where connection_id = p_connection_id and actor_user_id = v_caller
      and event_type = 'connection_paused' and created_at > now() - interval '30 days'
  ) >= 2 then
    raise exception 'pause_limit';
  end if;

  update public.connections set status = 'paused' where id = p_connection_id;

  insert into public.connection_pause_details (connection_id, paused_by, paused_until)
  values (p_connection_id, v_caller, v_until)
  on conflict (connection_id) do update
    set paused_by = excluded.paused_by, paused_until = excluded.paused_until, created_at = now();

  update public.connection_interventions
  set status = 'resolved', resolved_at = now()
  where connection_id = p_connection_id and status = 'pending'
    and intervention_type in ('no_ghost_r1', 'no_ghost_r2', 'no_ghost_r3', 'no_ghost_s1', 'conversation_restart_prompt');

  perform public.record_friendship_event(p_connection_id, 'connection_paused', v_caller,
    jsonb_build_object('until', v_until));
end;
$$;

grant execute on function public.pause_connection_with_duration(uuid, timestamptz) to authenticated;

create or replace function public.resume_connection_early(p_connection_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid := auth.uid();
  v_paused_by uuid;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if not exists (
    select 1 from public.connections c
    where c.id = p_connection_id and (c.user_a_id = v_caller or c.user_b_id = v_caller)
  ) then
    raise exception 'Not a participant of this connection';
  end if;
  select paused_by into v_paused_by from public.connection_pause_details where connection_id = p_connection_id;
  if v_paused_by is not null and v_paused_by <> v_caller then
    raise exception 'only_pauser_can_resume';
  end if;

  update public.connections set status = 'active', resumed_at = now()
  where id = p_connection_id and status = 'paused';
  delete from public.connection_pause_details where connection_id = p_connection_id;
  perform public.record_friendship_event(p_connection_id, 'connection_resumed', v_caller, '{}'::jsonb);
end;
$$;

grant execute on function public.resume_connection_early(uuid) to authenticated;

-- Older pauses were allowed "until I'm ready" (no end date). Those now
-- end 2 weeks after they started.
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
    select d.connection_id from public.connection_pause_details d
    where coalesce(d.paused_until, d.created_at + interval '14 days') <= p_now
  loop
    update public.connections set status = 'active', resumed_at = p_now
    where id = v_row.connection_id and status = 'paused';
    delete from public.connection_pause_details where connection_id = v_row.connection_id;
    perform public.record_friendship_event(v_row.connection_id, 'connection_resumed', null, '{}'::jsonb);
  end loop;
  -- A chat marked paused with no pause record (paused by the old flow)
  -- resumes too, so nothing stays paused forever.
  update public.connections c set status = 'active', resumed_at = p_now
  where c.status = 'paused'
    and not exists (select 1 from public.connection_pause_details d where d.connection_id = c.id);
end;
$$;

-- What both people see about a pause.
create or replace function public.get_pause_details(p_connection_id uuid default null)
returns table (connection_id uuid, paused_until timestamptz, paused_by_me boolean, other_paused_name text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    c.id,
    coalesce(d.paused_until, d.created_at + interval '14 days'),
    d.paused_by = auth.uid(),
    case when d.paused_by = auth.uid() then null
         else (select coalesce(p.display_name, 'They') from public.profiles p where p.user_id = d.paused_by) end
  from public.connections c
  join public.connection_pause_details d on d.connection_id = c.id
  where c.status = 'paused'
    and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
    and (p_connection_id is null or c.id = p_connection_id);
$$;

grant execute on function public.get_pause_details(uuid) to authenticated;

-- The old one-step pause/resume had no end date and let either person
-- undo the other's pause. The app no longer uses them directly.
revoke execute on function public.pause_connection(uuid) from public, anon, authenticated;
revoke execute on function public.resume_connection(uuid) from public, anon, authenticated;

-- No messages while a chat is paused (rule 3). Same policy as before plus
-- the paused check.
drop policy if exists "Participants can send messages in their connection" on public.messages;
create policy "Participants can send messages in their connection"
  on public.messages for insert
  with check (
    sender_id = auth.uid()
    and public.is_user_active(auth.uid())
    and exists (
      select 1 from public.connections c
      where c.id = messages.connection_id
        and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
        and c.status is distinct from 'blocked'
        and c.status is distinct from 'inactive'
        and c.status is distinct from 'ended'
        and c.status is distinct from 'paused'
    )
    and (
      connection_has_any_message(connection_id)
      or (
        exists (select 1 from public.profiles pr where pr.user_id = auth.uid() and pr.photo_url is not null)
        and exists (select 1 from public.users us where us.id = auth.uid() and us.selfie_verified_at is not null)
        and public.connection_has_mutual_interest(connection_id)
      )
    )
  );

-- ---------------------------------------------------------------------
-- F. Reply reminders count from the later of the last message and the
--    end of a pause
-- ---------------------------------------------------------------------

create or replace function public.run_no_ghost_check_v2(p_connection_id uuid, p_now timestamptz default now())
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_status text;
  v_resumed_at timestamptz;
  v_last record;
  v_sender uuid;
  v_recipient uuid;
  v_elapsed interval;
  v_fired text := 'none';
begin
  select status, resumed_at into v_status, v_resumed_at from public.connections where id = p_connection_id;
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

  v_elapsed := p_now - greatest(v_last.created_at, coalesce(v_resumed_at, v_last.created_at));

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
  v_quiet_since timestamptz;
  v_has_a boolean;
  v_has_b boolean;
  v_threshold interval;
begin
  select status, user_a_id, user_b_id, is_self_sustaining, resumed_at into v_conn
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

  select max(created_at) into v_quiet_since from public.messages where connection_id = p_connection_id;
  v_quiet_since := greatest(v_quiet_since, coalesce(v_conn.resumed_at, v_quiet_since));

  v_threshold := case when v_conn.is_self_sustaining then interval '10 days' else interval '5 days' end;
  if p_now - v_quiet_since < v_threshold then
    return 'not_enough_time_elapsed';
  end if;

  perform public.raise_intervention_once(p_connection_id, 'conversation_restart_prompt', v_conn.user_a_id, '{}'::jsonb, v_quiet_since);
  perform public.raise_intervention_once(p_connection_id, 'conversation_restart_prompt', v_conn.user_b_id, '{}'::jsonb, v_quiet_since);
  return 'fired';
end;
$$;

create or replace function public.run_friendship_journey_sweep_all(p_now timestamptz default now())
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- Pauses that have ended resume first, so their chats are checked fresh.
  perform public.run_pause_auto_resume_sweep(p_now);
  perform public.run_no_ghost_check_v2_all(p_now);
  perform public.run_meetup_occurrence_check_v2_all(p_now);
  perform public.run_conversation_restart_check_v2_all(p_now);
  perform public.run_rhythm_reminder_check_all(p_now);
  perform public.evaluate_self_sustaining_all(p_now);
  perform public.run_say_hello_check_all(p_now);
end;
$$;

-- ---------------------------------------------------------------------
-- G. Test tools for these (admins and test accounts only)
-- ---------------------------------------------------------------------

-- Makes a match with no messages N days old and runs the real check.
-- (greatest() skips nulls, so a chat that was never paused just uses opened_at.)
create or replace function public.test_match_age(p_connection_id uuid, p_days integer)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_result text;
begin
  if not public.is_test_operator() then raise exception 'Test tools are only for admins and test accounts'; end if;
  if not exists (
    select 1 from public.connections
    where id = p_connection_id and (user_a_id = auth.uid() or user_b_id = auth.uid())
  ) then
    raise exception 'You are not part of that chat';
  end if;
  if exists (select 1 from public.messages where connection_id = p_connection_id) then
    raise exception 'This chat already has messages. Pick a match where nobody has said hello yet.';
  end if;
  update public.connections
  set opened_at = now() - make_interval(days => p_days), resumed_at = null
  where id = p_connection_id;
  v_result := public.run_say_hello_check(p_connection_id, now());
  return case v_result
    when 'closed' then format('The match is now %s days old with no hello, so it has closed quietly.', p_days)
    when 'not_yet' then format('The match is now %s days old. Open the chat or Inbox to see the hello nudge.', p_days)
    else v_result
  end;
end;
$$;

grant execute on function public.test_match_age(uuid, integer) to authenticated;

-- Ends the current pause now, as if its end date had arrived.
create or replace function public.test_end_pause(p_connection_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_test_operator() then raise exception 'Test tools are only for admins and test accounts'; end if;
  if not exists (
    select 1 from public.connections
    where id = p_connection_id and (user_a_id = auth.uid() or user_b_id = auth.uid()) and status = 'paused'
  ) then
    raise exception 'That chat is not paused.';
  end if;
  update public.connection_pause_details set paused_until = now() - interval '1 minute'
  where connection_id = p_connection_id;
  perform public.run_pause_auto_resume_sweep(now());
  return 'The pause has ended. The chat is open again and reminders start fresh from now.';
end;
$$;

grant execute on function public.test_end_pause(uuid) to authenticated;

-- The no-reply test tool moves the conversation back in time; a recent
-- resume would otherwise hide the reminders it is meant to show.
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
    delete from public.connection_pause_details where connection_id = p_connection_id;
    v_reopened := true;
  end if;
  update public.connections set resumed_at = null where id = p_connection_id;

  delete from public.connection_interventions
  where connection_id = p_connection_id and intervention_type like 'no\_ghost\_%';
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

grant execute on function public.test_no_reply(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------
-- H. Version marker
-- ---------------------------------------------------------------------

create or replace function public.limen_db_version()
returns text
language sql
immutable
as $$ select '20261009000001'::text $$;

grant execute on function public.limen_db_version() to anon, authenticated;

notify pgrst, 'reload schema';
