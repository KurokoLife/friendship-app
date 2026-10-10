-- 2026-10-10: planning by invite, and knowing every time two people meet.
-- Safe to run more than once. Builds on 20261009000006_plan_one_turn_meet_nudges.sql.
--
-- Planning card:
--   - One person picks ideas and times (their own private draft), adds a
--     note if they like, and sends ONE invite into the chat. The card's job
--     is then done; they talk it over in the chat.
--   - The other person can tap "Pick a time that works" on the invite. If
--     they keep a day and part of the day the sender offered, the plan is
--     set right away (the sender already offered it). A different day goes
--     back to the sender to confirm, like any plan.
--
-- Counting meetups:
--   - "Did you meet?" still asks both people after each plan. If one says
--     yes and the other hasn't answered a week later, it counts. A "no"
--     from either person means it doesn't count.
--   - Meetups made outside the app: either person can add "We met up" with
--     a date. The other person confirms (or it counts after a week).
--
-- Nudges to meet: after two people have met, the 3 weeks / 2 months /
-- 6 months nudges start over from their last meetup.
--
-- Calendar: each person is asked once whether to add an agreed plan to
-- their calendar, and again when the plan changes.

-- ---------------------------------------------------------------------
-- A. Invites
-- ---------------------------------------------------------------------

alter table public.plan_boards drop constraint if exists plan_boards_close_reason_check;
alter table public.plan_boards add constraint plan_boards_close_reason_check
  check (close_reason in ('planned', 'not_now', 'quiet', 'chat_closed', 'invited'));

create table if not exists public.plan_invites (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.connections(id) on delete cascade,
  board_id uuid references public.plan_boards(id) on delete set null,
  message_id uuid references public.messages(id) on delete cascade,
  sender_id uuid not null references public.users(id) on delete cascade,
  note text,
  ideas jsonb not null default '[]'::jsonb,
  times jsonb not null default '[]'::jsonb,
  status text not null default 'open' check (status in ('open', 'accepted', 'closed')),
  closed_reason text check (closed_reason in ('replaced', 'planned')),
  accepted_by uuid references public.users(id) on delete set null,
  accepted_meetup_id uuid references public.meetups(id) on delete set null,
  accepted_day date,
  accepted_part text,
  accepted_idea text,
  accepted_confirmed boolean,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists plan_invites_connection_idx on public.plan_invites(connection_id, created_at desc);

alter table public.plan_invites enable row level security;
drop policy if exists "Participants read plan invites" on public.plan_invites;
create policy "Participants read plan invites" on public.plan_invites for select using (
  exists (select 1 from public.connections c where c.id = plan_invites.connection_id
          and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'plan_invites'
     ) then
    alter publication supabase_realtime add table public.plan_invites;
  end if;
end $$;

-- Morning before noon, afternoon before 5pm, evening after.
create or replace function public._time_part(p_time time)
returns text
language sql
immutable
as $$
  select case when p_time < time '12:00' then 'morning'
              when p_time < time '17:00' then 'afternoon'
              else 'evening' end;
$$;

-- Sends the caller's picked ideas and marked times as one invite in the
-- chat, with their own note (optional). Ends the planning card.
create or replace function public.send_plan_invite(p_board_id uuid, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_board public.plan_boards%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_ideas jsonb;
  v_times jsonb;
  v_lists text;
  v_msg uuid;
  v_id uuid;
begin
  v_board := public._plan_my_open_board(p_board_id);
  if v_note is not null and char_length(v_note) > 600 then raise exception 'note_too_long'; end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'title', i.title)
                            order by i.set_number desc, i.created_at), '[]'::jsonb)
  into v_ideas
  from public.plan_picks k join public.plan_ideas i on i.id = k.idea_id
  where k.board_id = v_board.id and k.user_id = auth.uid();
  if jsonb_array_length(v_ideas) = 0 then raise exception 'no_picks'; end if;

  select coalesce(jsonb_agg(jsonb_build_object('day', t.day, 'part', t.part)
                            order by t.day, case t.part when 'morning' then 1 when 'afternoon' then 2 else 3 end), '[]'::jsonb)
  into v_times
  from public.plan_times t
  where t.board_id = v_board.id and t.user_id = auth.uid() and t.day >= current_date - 1;
  if jsonb_array_length(v_times) = 0 then raise exception 'no_times'; end if;

  -- What shows in the Inbox and anywhere the invite can't be drawn: the
  -- person's own note, then the plain lists. The app adds no words of its own.
  v_lists := 'Ideas: ' || (select string_agg(e->>'title', ', ') from jsonb_array_elements(v_ideas) e)
          || E'\nTimes: ' || (select string_agg(to_char((e->>'day')::date, 'Dy Mon FMDD') || ' ' || (e->>'part'), ', ')
                              from jsonb_array_elements(v_times) e);

  update public.plan_invites set status = 'closed', closed_reason = 'replaced'
  where connection_id = v_board.connection_id and status = 'open';

  insert into public.messages (connection_id, sender_id, content, type)
  values (v_board.connection_id, auth.uid(),
          case when v_note is null then v_lists else v_note || E'\n\n' || v_lists end,
          'plan_invite')
  returning id into v_msg;

  insert into public.plan_invites (connection_id, board_id, message_id, sender_id, note, ideas, times)
  values (v_board.connection_id, v_board.id, v_msg, auth.uid(), v_note, v_ideas, v_times)
  returning id into v_id;

  update public.plan_boards
  set status = 'closed', close_reason = 'invited', closed_by = auth.uid(), closed_at = now()
  where id = v_board.id;

  return v_id;
end;
$$;

grant execute on function public.send_plan_invite(uuid, text) to authenticated;

-- The other person picks a time from the invite (in the plan editor, with
-- an exact time and place). A day and part of the day the sender offered
-- sets the plan right away; anything else goes to the sender to confirm.
create or replace function public.accept_plan_invite(
  p_invite_id uuid,
  p_date date,
  p_start_time time default null,
  p_place text default null,
  p_activity text default null,
  p_time_zone text default null,
  p_place_address text default null,
  p_place_lat double precision default null,
  p_place_lng double precision default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_inv public.plan_invites%rowtype;
  v_conn public.connections%rowtype;
  v_part text;
  v_offered boolean;
  v_mid uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select * into v_inv from public.plan_invites where id = p_invite_id;
  if not found then raise exception 'invite_not_found'; end if;
  select * into v_conn from public.connections
  where id = v_inv.connection_id and (user_a_id = auth.uid() or user_b_id = auth.uid());
  if not found then raise exception 'invite_not_found'; end if;
  if v_inv.sender_id = auth.uid() then raise exception 'own_invite'; end if;
  if v_inv.status <> 'open' then raise exception 'invite_closed'; end if;
  if not public._plan_chat_open(v_conn.status) then raise exception 'chat_not_open'; end if;

  v_part := case when p_start_time is null then null else public._time_part(p_start_time) end;
  v_offered := exists (
    select 1 from jsonb_array_elements(v_inv.times) e
    where (e->>'day')::date = p_date and (v_part is null or e->>'part' = v_part));

  v_mid := public.propose_meetup(v_inv.connection_id, p_date, p_start_time, p_place, p_activity,
                                 p_time_zone, p_place_address, p_place_lat, p_place_lng);

  if v_offered then
    -- The sender offered this time, so they count as the one who proposed it.
    update public.meetups
    set proposed_by = v_inv.sender_id, status = 'confirmed', confirmed_date = proposed_date,
        confirmed_at = now(), confirmed_by = auth.uid()
    where id = v_mid;
    perform public.record_friendship_event(v_inv.connection_id, 'meetup_confirmed', auth.uid(),
      jsonb_build_object('meetup_id', v_mid, 'date', p_date, 'invite_id', p_invite_id));
  end if;

  update public.plan_invites
  set status = 'accepted', closed_reason = null, accepted_by = auth.uid(), accepted_meetup_id = v_mid,
      accepted_day = p_date, accepted_part = v_part,
      accepted_idea = nullif(btrim(coalesce(p_activity, '')), ''),
      accepted_confirmed = v_offered, accepted_at = now()
  where id = p_invite_id;

  return jsonb_build_object('meetup_id', v_mid, 'status', case when v_offered then 'confirmed' else 'proposed' end);
end;
$$;

grant execute on function public.accept_plan_invite(uuid, date, time, text, text, text, text, double precision, double precision) to authenticated;

-- ---------------------------------------------------------------------
-- B. "We met up": a meetup made outside the app
-- ---------------------------------------------------------------------

alter table public.meetups add column if not exists logged_after boolean not null default false;

-- A plan being agreed ends the planning card and any open invite. A meetup
-- added afterwards ("We met up") doesn't.
create or replace function public.close_plan_board_on_confirm()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.status = 'confirmed' and (tg_op = 'INSERT' or old.status is distinct from 'confirmed')
     and not coalesce(new.logged_after, false) then
    update public.plan_boards
    set status = 'planned', close_reason = 'planned', closed_at = now()
    where connection_id = new.connection_id and status = 'open';
    update public.plan_invites
    set status = 'closed', closed_reason = 'planned'
    where connection_id = new.connection_id and status = 'open';
  end if;
  return new;
end;
$$;

create or replace function public.log_past_meetup(
  p_connection_id uuid,
  p_date date,
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
  v_conn public.connections%rowtype;
  v_other uuid;
  v_tz text;
  v_id uuid;
  v_activity text := nullif(btrim(coalesce(p_activity, '')), '');
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  select * into v_conn from public.connections
  where id = p_connection_id and (user_a_id = v_caller or user_b_id = v_caller);
  if not found then raise exception 'Not a participant of this connection'; end if;
  if not public._plan_chat_open(v_conn.status) then raise exception 'chat_not_open'; end if;
  v_other := case when v_conn.user_a_id = v_caller then v_conn.user_b_id else v_conn.user_a_id end;
  v_tz := case when exists (select 1 from pg_timezone_names where name = p_time_zone) then p_time_zone else null end;

  if p_date is null or p_date > (now() at time zone public.meetup_tz(v_tz))::date or p_date > current_date then
    raise exception 'date_in_future';
  end if;
  if p_date < (v_conn.created_at at time zone public.meetup_tz(v_tz))::date - 1 then
    raise exception 'date_before_connected';
  end if;
  if v_activity is not null and char_length(v_activity) > 120 then raise exception 'activity_too_long'; end if;
  -- One added meetup waiting for the other person at a time.
  if exists (select 1 from public.meetups where connection_id = p_connection_id
             and logged_after and status = 'confirmed') then
    raise exception 'already_waiting';
  end if;
  if exists (select 1 from public.meetups where connection_id = p_connection_id and status = 'occurred'
             and coalesce(occurred_date, confirmed_date) = p_date) then
    raise exception 'already_counted';
  end if;

  insert into public.meetups (connection_id, proposed_date, proposed_by, activity, time_zone, logged_after,
                              status, confirmed_date, confirmed_at, confirmed_by)
  values (p_connection_id, p_date, v_caller, v_activity, v_tz, true,
          'confirmed', p_date, now(), v_caller)
  returning id into v_id;
  update public.meetups set plan_root_id = v_id where id = v_id;

  insert into public.meetup_occurrence_reports (meetup_id, reporter_id, reported_yes, reported_date)
  values (v_id, v_caller, true, p_date);

  perform public.raise_intervention(p_connection_id, 'meetup_occurrence_check', v_other,
    jsonb_build_object('meetup_id', v_id, 'confirmed_date', p_date, 'logged_by', v_caller,
                       'activity', v_activity));
  perform public.record_friendship_event(p_connection_id, 'meetup_logged', v_caller,
    jsonb_build_object('meetup_id', v_id, 'date', p_date));
  return v_id;
end;
$$;

grant execute on function public.log_past_meetup(uuid, date, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- C. Counting: one yes and a week of quiet counts
-- ---------------------------------------------------------------------

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
  v_first_report timestamptz;
  v_report public.meetup_occurrence_reports%rowtype;
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
    select count(*), min(created_at) into v_report_count, v_first_report
    from public.meetup_occurrence_reports where meetup_id = v_meetup.id;
    v_payload := jsonb_build_object(
      'meetup_id', v_meetup.id,
      'confirmed_date', v_meetup.confirmed_date,
      'start_time', to_char(v_meetup.start_time, 'HH24:MI'),
      'place', v_meetup.place);

    if v_report_count = 0 then
      perform public.raise_intervention(p_connection_id, 'meetup_occurrence_check', v_meetup.user_a_id, v_payload);
      perform public.raise_intervention(p_connection_id, 'meetup_occurrence_check', v_meetup.user_b_id, v_payload);
      v_any_action := 'fired';
      -- Nobody answered for two weeks: let it go quietly (it doesn't count),
      -- so the chat isn't stuck waiting forever.
      if p_now >= public.meetup_start_at(v_meetup.confirmed_date + 14, time '09:00', v_meetup.time_zone) then
        update public.meetups set status = 'unresolved' where id = v_meetup.id;
        update public.connection_interventions
          set status = 'expired'
          where connection_id = p_connection_id and intervention_type = 'meetup_occurrence_check'
            and status = 'pending' and payload->>'meetup_id' = v_meetup.id::text;
        v_any_action := 'timed_out_no_answers';
      end if;

    elsif v_report_count = 1 and p_now - v_first_report >= interval '7 days' then
      select * into v_report from public.meetup_occurrence_reports where meetup_id = v_meetup.id;
      if v_report.reported_yes then
        update public.meetups
        set status = 'occurred', date_status = 'confirmed',
            occurred_date = coalesce(v_report.reported_date, v_meetup.confirmed_date)
        where id = v_meetup.id;
        perform public.record_friendship_event(p_connection_id, 'meetup_occurred', null,
          jsonb_build_object('meetup_id', v_meetup.id, 'sequence_number', v_meetup.sequence_number,
                             'one_answer', true));
        v_any_action := 'counted_one_answer';
      else
        update public.meetups set status = 'unresolved' where id = v_meetup.id;
        perform public.record_friendship_event(p_connection_id, 'meetup_occurrence_unresolved', null,
          jsonb_build_object('meetup_id', v_meetup.id));
        v_any_action := 'timed_out_unresolved';
      end if;
      update public.connection_interventions
        set status = 'expired'
        where connection_id = p_connection_id and intervention_type = 'meetup_occurrence_check'
          and status = 'pending' and payload->>'meetup_id' = v_meetup.id::text;
    end if;
  end loop;

  return v_any_action;
end;
$$;

-- An added meetup ("We met up") never gets the day-before or morning-of
-- cards. Same as 20261008000002 otherwise.
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

-- ---------------------------------------------------------------------
-- D. Calendar: asked once per agreed plan, and again when it changes
-- ---------------------------------------------------------------------

create table if not exists public.meetup_calendar_asks (
  meetup_id uuid not null references public.meetups(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  details_key text not null,
  answer text not null check (answer in ('added', 'not_now')),
  created_at timestamptz not null default now(),
  primary key (meetup_id, user_id, details_key)
);

alter table public.meetup_calendar_asks enable row level security;
drop policy if exists "Own calendar asks" on public.meetup_calendar_asks;
create policy "Own calendar asks" on public.meetup_calendar_asks for select using (user_id = auth.uid());
drop policy if exists "Own calendar asks insert" on public.meetup_calendar_asks;
create policy "Own calendar asks insert" on public.meetup_calendar_asks for insert with check (
  user_id = auth.uid()
  and exists (select 1 from public.meetups m join public.connections c on c.id = m.connection_id
              where m.id = meetup_calendar_asks.meetup_id
                and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())));
grant select, insert on public.meetup_calendar_asks to authenticated;

-- ---------------------------------------------------------------------
-- E. Nudges start over after each meetup
-- ---------------------------------------------------------------------

alter table public.meet_nudges add column if not exists anchor text not null default 'none';
do $$
begin
  if not exists (
    select 1 from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.conname = 'meet_nudges_pkey' and a.attname = 'anchor'
  ) then
    alter table public.meet_nudges drop constraint if exists meet_nudges_pkey;
    alter table public.meet_nudges add primary key (connection_id, user_id, stage, anchor);
  end if;
end $$;

-- Time a chat spent paused between two moments.
create or replace function public._paused_between(p_connection_id uuid, p_start timestamptz, p_now timestamptz)
returns interval
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_paused interval := interval '0';
  r record;
  v_end timestamptz;
begin
  for r in
    select e.created_at from public.friendship_events e
    where e.connection_id = p_connection_id and e.event_type = 'connection_paused'
      and e.created_at < p_now
  loop
    select min(e2.created_at) into v_end from public.friendship_events e2
    where e2.connection_id = p_connection_id and e2.event_type = 'connection_resumed'
      and e2.created_at > r.created_at;
    v_end := least(coalesce(v_end, p_now), p_now);
    if v_end > p_start then
      v_paused := v_paused + (v_end - greatest(r.created_at, p_start));
    end if;
  end loop;
  return v_paused;
end;
$$;

-- The last meetup that counted, and when it was (midday local time if no
-- start time was set).
create or replace function public._last_meetup(p_connection_id uuid, out meetup_id uuid, out met_at timestamptz)
language sql
stable
security definer
set search_path to 'public'
as $$
  select m.id,
         (coalesce(m.occurred_date, m.confirmed_date, m.proposed_date) + coalesce(m.start_time, time '12:00'))
           at time zone public.meetup_tz(m.time_zone)
  from public.meetups m
  where m.connection_id = p_connection_id and m.status = 'occurred'
  order by coalesce(m.occurred_date, m.confirmed_date, m.proposed_date) desc, m.created_at desc
  limit 1;
$$;

-- What the current round of nudges is counted from: 'none' before a first
-- meetup, then the last meetup. Answers belong to one round.
create or replace function public._meet_anchor(p_connection_id uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce((select meetup_id::text from public._last_meetup(p_connection_id) where meetup_id is not null), 'none');
$$;

-- The nudge to show the caller in this chat right now, or null.
-- met = false: they have never met (counted from when both had written).
-- met = true: counted from their last meetup.
create or replace function public.get_meet_nudge(p_connection_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid := auth.uid();
  v_conn public.connections%rowtype;
  v_days numeric;
  v_anchor text := 'none';
  v_met boolean := false;
  v_last record;
  v_three public.meet_nudges%rowtype;
begin
  if v_caller is null then return null; end if;
  select * into v_conn from public.connections
  where id = p_connection_id and (user_a_id = v_caller or user_b_id = v_caller);
  if not found then return null; end if;
  if v_conn.status is not null and v_conn.status not in ('pending', 'active') then return null; end if;
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

  if v_days >= 21 then
    select * into v_three from public.meet_nudges
    where connection_id = p_connection_id and user_id = v_caller and stage = 'three_weeks' and anchor = v_anchor;
    if not found or v_three.ask_again_at <= now() then
      return jsonb_build_object('stage', 'three_weeks', 'days', floor(v_days), 'met', v_met);
    end if;
  end if;
  return null;
end;
$$;

grant execute on function public.get_meet_nudge(uuid) to authenticated;

create or replace function public.answer_meet_nudge(p_connection_id uuid, p_stage text, p_answer text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid := auth.uid();
  v_anchor text;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if not exists (select 1 from public.connections where id = p_connection_id
                 and (user_a_id = v_caller or user_b_id = v_caller)) then
    raise exception 'Not a participant of this connection';
  end if;
  if p_stage not in ('three_weeks', 'two_months', 'six_months') then raise exception 'bad_stage'; end if;
  if p_answer not in ('plan', 'not_yet', 'keep_chatting') then raise exception 'bad_answer'; end if;
  v_anchor := public._meet_anchor(p_connection_id);
  insert into public.meet_nudges (connection_id, user_id, stage, anchor, answer, answered_at, ask_again_at)
  values (p_connection_id, v_caller, p_stage, v_anchor, p_answer, now(),
          case when p_stage = 'three_weeks' then now() + interval '21 days' end)
  on conflict (connection_id, user_id, stage, anchor) do update
    set answer = excluded.answer, answered_at = excluded.answered_at, ask_again_at = excluded.ask_again_at;
end;
$$;

grant execute on function public.answer_meet_nudge(uuid, text, text) to authenticated;

-- Test tool: for a chat that has never met, makes two people look like
-- they have been talking for N days. For a chat that has met, moves their
-- last meetup N days back. Clears the nudge answers for this chat.
create or replace function public.test_talking_age(p_connection_id uuid, p_days integer)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_conn public.connections%rowtype;
  v_days numeric;
  v_shift interval;
  v_last record;
begin
  if not public.is_test_operator() then raise exception 'Test tools are only for admins and test accounts'; end if;
  select * into v_conn from public.connections where id = p_connection_id
    and (user_a_id = auth.uid() or user_b_id = auth.uid());
  if not found then raise exception 'Not a participant of this connection'; end if;
  if not exists (select 1 from public.messages where connection_id = p_connection_id and sender_id = v_conn.user_a_id)
     or not exists (select 1 from public.messages where connection_id = p_connection_id and sender_id = v_conn.user_b_id) then
    return 'Both people need to have written in this chat first.';
  end if;
  delete from public.meet_nudges where connection_id = p_connection_id;
  delete from public.friendship_events where connection_id = p_connection_id
    and event_type in ('connection_paused', 'connection_resumed');

  select * into v_last from public._last_meetup(p_connection_id);
  if v_last.meetup_id is not null then
    update public.meetups
    set occurred_date = (now() at time zone public.meetup_tz(time_zone))::date - p_days,
        confirmed_date = (now() at time zone public.meetup_tz(time_zone))::date - p_days
    where id = v_last.meetup_id;
    return format('Your last meetup in this chat now looks like it was %s days ago. Open the chat to see the card (it only shows when nothing is being planned).', p_days);
  end if;

  update public.connections
  set opened_at = least(coalesce(opened_at, created_at),
                        (select min(created_at) from public.messages where connection_id = p_connection_id))
  where id = p_connection_id;
  v_days := public._talking_days(p_connection_id);
  v_shift := make_interval(secs => greatest(0, (p_days - v_days) * 86400 + 3600));
  update public.messages set created_at = created_at - v_shift where connection_id = p_connection_id;
  update public.connections
  set opened_at = coalesce(opened_at, created_at) - v_shift,
      created_at = created_at - v_shift,
      resumed_at = now()
  where id = p_connection_id;
  return format('This chat now looks like you have been talking for %s days. Open it to see the card (it only shows when nothing is being planned).', p_days);
end;
$$;

grant execute on function public.test_talking_age(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------
-- F. Inbox: an invite you started but haven't sent
-- ---------------------------------------------------------------------

drop function if exists public.my_plan_turns();
create or replace function public.my_plan_turns()
returns table (connection_id uuid, stage text, waiting_on_me boolean, closes_at timestamptz)
language sql
stable
security definer
set search_path to 'public'
as $$
  select b.connection_id, 'drafting'::text, true, b.last_activity_at + interval '14 days'
  from public.plan_boards b
  join public.connections c on c.id = b.connection_id
  where b.status = 'open'
    and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
    and not public._plan_has_upcoming(b.connection_id)
    and (b.started_by = auth.uid()
         or exists (select 1 from public.plan_picks k where k.board_id = b.id and k.user_id = auth.uid())
         or exists (select 1 from public.plan_times t where t.board_id = b.id and t.user_id = auth.uid()));
$$;

grant execute on function public.my_plan_turns() to authenticated;

create or replace function public.limen_db_version()
returns text
language sql
immutable
as $$ select '20261010000000'::text $$;

grant execute on function public.limen_db_version() to anon, authenticated;
