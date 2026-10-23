-- 2026-10-22: meetups waiting to be counted, and added meetups.
-- 1. Bug: "Met up already? Add it" with today's date showed as an upcoming
--    plan for both people ("Meeting today", calendar question, "Running
--    late?", "Cancel plan"). An added meetup, or one somebody already said
--    "yes, we met" to, is never an upcoming plan now (get_meetup_plan and
--    _plan_has_upcoming).
-- 2. The plan bar can show a meetup that's waiting to be counted
--    (get_meetup_plan returns 'waiting'): "You said you met on Thu, Oct 22.
--    It counts once David says yes too, or after a week."
-- 3. Unsent invites are each person's own private draft ("Save for later"
--    in the planning window; nothing shows in the chat). There used to be one
--    draft per chat, so if one person had an unsent draft, the other person's
--    "Let's plan something" opened nothing. Now each person has their own
--    (start_plan_board, get_plan_board, get_meet_nudge).
-- Safe to run twice. limen_db_version() -> 20261022000002.

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
  v_w public.meetups%rowtype;
  v_waiting jsonb := null;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  select * into v_conn from public.connections
  where id = p_connection_id and (user_a_id = v_caller or user_b_id = v_caller);
  if not found then return null; end if;
  v_other := case when v_conn.user_a_id = v_caller then v_conn.user_b_id else v_conn.user_a_id end;

  -- A meetup that's waiting to be counted (someone said "yes, we met", or
  -- added one that happened outside the app): shown in the plan bar as
  -- waiting, never as an upcoming plan.
  select * into v_w from public.meetups m
  where m.connection_id = p_connection_id and m.status = 'confirmed'
    and (m.logged_after or exists (select 1 from public.meetup_occurrence_reports r
                                   where r.meetup_id = m.id and r.reported_yes))
    and not exists (select 1 from public.meetup_occurrence_reports r
                    where r.meetup_id = m.id and not r.reported_yes)
  order by m.created_at desc, m.id desc limit 1;
  if found then
    v_waiting := jsonb_build_object(
      'id', v_w.id,
      'date', coalesce(v_w.confirmed_date, v_w.proposed_date),
      'activity', v_w.activity,
      'added', v_w.logged_after,
      'i_said_yes', exists (select 1 from public.meetup_occurrence_reports r
                            where r.meetup_id = v_w.id and r.reporter_id = v_caller and r.reported_yes),
      'other_said_yes', exists (select 1 from public.meetup_occurrence_reports r
                                where r.meetup_id = v_w.id and r.reporter_id = v_other and r.reported_yes),
      'first_yes_at', (select min(r.created_at) from public.meetup_occurrence_reports r
                       where r.meetup_id = v_w.id and r.reported_yes));
  end if;

  select * into v_m from public.meetups m
  where m.connection_id = p_connection_id and m.status in ('proposed','confirmed')
    and not m.logged_after
    and not exists (select 1 from public.meetup_occurrence_reports r where r.meetup_id = m.id)
    and coalesce(m.confirmed_date, m.proposed_date) >= (now() at time zone public.meetup_tz(m.time_zone))::date
  order by m.created_at desc, m.id desc limit 1;

  if not found then
    return jsonb_build_object('meetup', null, 'meetup_count', v_conn.meetup_count, 'waiting', v_waiting);
  end if;

  v_tz := public.meetup_tz(v_m.time_zone);

  if v_m.status = 'proposed' then
    select * into v_prev from public.meetups
    where coalesce(plan_root_id, id) = coalesce(v_m.plan_root_id, v_m.id)
      and id <> v_m.id and status = 'rescheduled' and confirmed_date is not null
    order by created_at desc, id desc
    limit 1;
    v_has_prev := found;
  end if;

  return jsonb_build_object(
    'meetup_count', v_conn.meetup_count,
    'waiting', v_waiting,
    'local_today', (now() at time zone v_tz)::date,
    'meetup', jsonb_build_object(
      'id', v_m.id,
      'status', v_m.status,
      'date', coalesce(v_m.confirmed_date, v_m.proposed_date),
      'start_time', to_char(v_m.start_time, 'HH24:MI'),
      'place', v_m.place,
      'place_address', v_m.place_address,
      'place_lat', v_m.place_lat,
      'place_lng', v_m.place_lng,
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

create or replace function public._plan_has_upcoming(p_connection_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.meetups m
    where m.connection_id = p_connection_id
      and m.status in ('proposed', 'confirmed')
      and not m.logged_after
      and not exists (select 1 from public.meetup_occurrence_reports r where r.meetup_id = m.id)
      and coalesce(m.confirmed_date, m.proposed_date) >= (now() at time zone public.meetup_tz(m.time_zone))::date
  );
$$;


-- ---------------------------------------------------------------------
-- 3. One private draft per person
-- ---------------------------------------------------------------------
drop index if exists public.plan_boards_one_open;
create unique index if not exists plan_boards_one_open_per_person
  on public.plan_boards (connection_id, started_by) where status = 'open';

create or replace function public.start_plan_board(p_connection_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid := auth.uid();
  v_conn public.connections%rowtype;
  v_id uuid;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  select * into v_conn from public.connections
  where id = p_connection_id and (user_a_id = v_caller or user_b_id = v_caller);
  if not found then raise exception 'Not a participant of this connection'; end if;
  if not public._plan_chat_open(v_conn.status) then raise exception 'chat_not_open'; end if;
  if not exists (select 1 from public.messages where connection_id = p_connection_id) then
    raise exception 'no_messages_yet';
  end if;
  if public._plan_has_upcoming(p_connection_id) then raise exception 'plan_exists'; end if;

  select id into v_id from public.plan_boards where connection_id = p_connection_id and status = 'open'
    and started_by = v_caller;
  if found then return v_id; end if;

  insert into public.plan_boards (connection_id, started_by)
  values (p_connection_id, v_caller)
  on conflict do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.plan_boards where connection_id = p_connection_id and status = 'open'
      and started_by = v_caller;
  end if;
  return v_id;
end;
$$;

create or replace function public.get_plan_board(p_connection_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid := auth.uid();
  v_conn public.connections%rowtype;
  v_other uuid;
  v_board public.plan_boards%rowtype;
  v_has_board boolean;
  v_ideas jsonb;
  v_my_times jsonb;
  v_my_saved_times jsonb;
  v_other_times jsonb;
  v_prefs jsonb;
  v_home jsonb;
  v_my_saved timestamptz;
  v_other_saved timestamptz;
  v_other_usual text[];
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  select * into v_conn from public.connections
  where id = p_connection_id and (user_a_id = v_caller or user_b_id = v_caller);
  if not found then return null; end if;
  v_other := case when v_conn.user_a_id = v_caller then v_conn.user_b_id else v_conn.user_a_id end;

  select * into v_board from public.plan_boards
  where connection_id = p_connection_id
    and started_by = v_caller
    and (status = 'open' or closed_at > now() - interval '3 days')
  order by (status = 'open') desc, created_at desc
  limit 1;
  v_has_board := found;

  select to_jsonb(p) - 'user_id' - 'updated_at' into v_prefs from public.plan_prefs p where p.user_id = v_caller;
  select jsonb_build_object('can_host', h.can_host, 'can_visit', h.can_visit) into v_home
  from public.plan_home_prefs h where h.connection_id = p_connection_id and h.user_id = v_caller;
  select p.availability into v_other_usual from public.profiles p where p.user_id = v_other;

  if v_has_board then
    select saved_at into v_my_saved from public.plan_saves where board_id = v_board.id and user_id = v_caller;
    select saved_at into v_other_saved from public.plan_saves where board_id = v_board.id and user_id = v_other;

    select coalesce(jsonb_agg(jsonb_build_object(
        'id', i.id,
        'source', i.source,
        'added_by', i.added_by,
        'slot', i.slot,
        'title', i.title,
        'description', i.description,
        'cost_label', i.cost_label,
        'duration_label', i.duration_label,
        'style', i.style,
        'first_meetup_ok', i.first_meetup_ok,
        'interest_note', i.interest_note,
        'home_of', i.home_of,
        'set_number', i.set_number,
        'picked_by_me', exists (select 1 from public.plan_picks k where k.idea_id = i.id and k.user_id = v_caller),
        'saved_by_me', exists (select 1 from public.plan_saved_picks s where s.idea_id = i.id and s.user_id = v_caller),
        'picked_by_other', exists (select 1 from public.plan_saved_picks s where s.idea_id = i.id and s.user_id = v_other)
      ) order by i.set_number desc, case i.slot when 'easy' then 1 when 'both_like' then 2 when 'new' then 3 else 4 end, i.created_at), '[]'::jsonb)
    into v_ideas
    from public.plan_ideas i
    where i.board_id = v_board.id
      and (i.source <> 'own' or i.added_by = v_caller
           or exists (select 1 from public.plan_saved_picks s where s.idea_id = i.id))
      and (not i.retired
           or exists (select 1 from public.plan_picks k where k.idea_id = i.id and k.user_id = v_caller)
           or exists (select 1 from public.plan_saved_picks s where s.idea_id = i.id));

    select coalesce(jsonb_agg(jsonb_build_object('day', t.day, 'part', t.part) order by t.day, t.part), '[]'::jsonb)
    into v_my_times from public.plan_times t where t.board_id = v_board.id and t.user_id = v_caller;
    select coalesce(jsonb_agg(jsonb_build_object('day', t.day, 'part', t.part) order by t.day, t.part), '[]'::jsonb)
    into v_my_saved_times from public.plan_saved_times t where t.board_id = v_board.id and t.user_id = v_caller;
    -- Only times the other person saved.
    select coalesce(jsonb_agg(jsonb_build_object('day', t.day, 'part', t.part) order by t.day, t.part), '[]'::jsonb)
    into v_other_times from public.plan_saved_times t where t.board_id = v_board.id and t.user_id = v_other;
  end if;

  return jsonb_build_object(
    'me', v_caller,
    'other', v_other,
    'meetup_count', v_conn.meetup_count,
    'chat_open', public._plan_chat_open(v_conn.status),
    'has_upcoming_plan', public._plan_has_upcoming(p_connection_id),
    'my_prefs', v_prefs,
    'my_home', v_home,
    'other_usual', to_jsonb(coalesce(v_other_usual, '{}'::text[])),
    'board', case when v_has_board then jsonb_build_object(
      'id', v_board.id,
      'status', v_board.status,
      'close_reason', v_board.close_reason,
      'closed_by', v_board.closed_by,
      'started_by', v_board.started_by,
      'refreshes_left', greatest(0, 10 - v_board.refreshes_used),
      'created_at', v_board.created_at,
      'last_activity_at', v_board.last_activity_at,
      'closes_at', v_board.last_activity_at + interval '14 days',
      'my_saved_at', v_my_saved,
      'other_saved_at', v_other_saved,
      'no_match_rounds', v_board.no_match_rounds,
      'ideas', v_ideas,
      'my_times', v_my_times,
      'my_saved_times', v_my_saved_times,
      'other_times', v_other_times
    ) else null end
  );
end;
$$;

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
  if exists (select 1 from public.plan_boards b where b.connection_id = p_connection_id and b.status = 'open'
             and b.started_by = auth.uid()) then
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

-- Test tab: "age the draft" acts on your own draft first.
create or replace function public.test_plan_board_age(p_connection_id uuid, p_days integer)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
begin
  if not public.is_test_operator() then raise exception 'Test tools are only for admins and test accounts'; end if;
  if not exists (select 1 from public.connections where id = p_connection_id
                 and (user_a_id = auth.uid() or user_b_id = auth.uid())) then
    raise exception 'Not a participant of this connection';
  end if;
  select id into v_id from public.plan_boards where connection_id = p_connection_id and status = 'open'
    order by (started_by = auth.uid()) desc, created_at desc limit 1;
  if v_id is null then return 'There is no open planning card in this chat. Tap "Let''s plan something" first.'; end if;
  update public.plan_boards set last_activity_at = now() - make_interval(days => p_days) where id = v_id;
  perform public.run_plan_board_check_all(now());
  if (select status from public.plan_boards where id = v_id) = 'open' then
    return format('The planning card is now %s days quiet. Open the chat as either person to see the nudge.', p_days);
  end if;
  return 'The planning card was quiet for 14 days and closed. Open the chat to see how it ended.';
end;
$$;

create or replace function public.limen_db_version()
returns text
language sql
stable
as $function$ select '20261022000002'::text $function$;
grant execute on function public.limen_db_version() to anon, authenticated;
