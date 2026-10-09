-- 2026-10-09 (6): planning card in fewer turns, and gentle nudges to meet.
-- Safe to run more than once. Builds on 20261009000005_plan_save_and_match.sql.
--
-- Planning card:
--   - Each person's turn is ideas AND times together. Times are a private
--     draft too, until "Save and send". The other person sees saved times.
--   - The card also shows when the other person is usually free (from
--     their profile, which people they are connected with can already see).
--   - A match is now an idea AND a time both people saved. The person who
--     saved second suggests the plan (the first can step in).
--   - Before a first meetup, nobody can add an idea at someone's home.
--     After that, a home idea still needs both people to pick it.
--
-- Meeting in person:
--   - People who have talked for a while but never met get a gentle card,
--     each privately: after 3 weeks ("Want to plan something?", asked again
--     3 weeks after "Not yet"), after 2 months and after 6 months (an honest
--     check, once each). Time paused doesn't count. Nothing closes by itself.
--     Once two people have met, none of this shows again.

-- ---------------------------------------------------------------------
-- A. Saved times
-- ---------------------------------------------------------------------

create table if not exists public.plan_saved_times (
  board_id uuid not null references public.plan_boards(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  connection_id uuid not null references public.connections(id) on delete cascade,
  day date not null,
  part text not null check (part in ('morning', 'afternoon', 'evening')),
  primary key (board_id, user_id, day, part)
);

alter table public.plan_saved_times enable row level security;

drop policy if exists "Participants read saved plan times" on public.plan_saved_times;
create policy "Participants read saved plan times" on public.plan_saved_times for select using (
  exists (select 1 from public.connections c where c.id = plan_saved_times.connection_id
          and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())));

-- Times being marked are a private draft, like picks.
drop policy if exists "Participants read plan times" on public.plan_times;
drop policy if exists "Own plan times" on public.plan_times;
create policy "Own plan times" on public.plan_times for select using (user_id = auth.uid());

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'plan_saved_times'
     ) then
    alter publication supabase_realtime add table public.plan_saved_times;
  end if;
end $$;

-- Cards already open: times marked before this update count as saved, so
-- nothing anyone already marked disappears. An idea chosen in the old
-- separate step is let go; the card now matches idea and time together.
insert into public.plan_saved_times (board_id, user_id, connection_id, day, part)
select t.board_id, t.user_id, t.connection_id, t.day, t.part
from public.plan_times t join public.plan_boards b on b.id = t.board_id
where b.status = 'open'
on conflict do nothing;

update public.plan_boards set chosen_idea_id = null, chosen_day = null, chosen_part = null
where status = 'open' and (chosen_idea_id is not null or chosen_day is not null);

-- Times both people saved.
create or replace function public._plan_shared_time_count(p_board_id uuid)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $$
  select count(*)::integer from (
    select day, part from public.plan_saved_times
    where board_id = p_board_id and day >= current_date
    group by day, part having count(*) >= 2
  ) s;
$$;

-- Marks the caller's draft times (replaces them).
create or replace function public.plan_set_times(p_board_id uuid, p_slots jsonb)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_board public.plan_boards%rowtype;
  v_count integer;
begin
  v_board := public._plan_my_open_board(p_board_id);
  if jsonb_typeof(coalesce(p_slots, '[]'::jsonb)) <> 'array' then raise exception 'bad_times'; end if;
  if jsonb_array_length(coalesce(p_slots, '[]'::jsonb)) > 60 then raise exception 'bad_times'; end if;

  delete from public.plan_times where board_id = v_board.id and user_id = auth.uid();
  insert into public.plan_times (board_id, connection_id, user_id, day, part)
  select distinct v_board.id, v_board.connection_id, auth.uid(), (s->>'day')::date, s->>'part'
  from jsonb_array_elements(coalesce(p_slots, '[]'::jsonb)) s
  where s->>'part' in ('morning', 'afternoon', 'evening')
    and (s->>'day')::date between current_date - 1 and current_date + 16;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.plan_set_times(uuid, jsonb) to authenticated;

-- Saves the caller's draft picks AND times. The other person sees both
-- from now on.
create or replace function public.plan_save_picks(p_board_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_board public.plan_boards%rowtype;
  v_other uuid;
  v_other_saved boolean;
  v_shared integer;
  v_shared_times integer;
begin
  v_board := public._plan_my_open_board(p_board_id);
  if not exists (select 1 from public.plan_picks where board_id = v_board.id and user_id = auth.uid()) then
    raise exception 'no_picks';
  end if;
  select case when c.user_a_id = auth.uid() then c.user_b_id else c.user_a_id end into v_other
  from public.connections c where c.id = v_board.connection_id;

  delete from public.plan_saved_picks where board_id = v_board.id and user_id = auth.uid();
  insert into public.plan_saved_picks (board_id, user_id, idea_id, connection_id)
  select v_board.id, auth.uid(), k.idea_id, v_board.connection_id
  from public.plan_picks k where k.board_id = v_board.id and k.user_id = auth.uid();

  delete from public.plan_saved_times where board_id = v_board.id and user_id = auth.uid();
  insert into public.plan_saved_times (board_id, user_id, connection_id, day, part)
  select v_board.id, auth.uid(), v_board.connection_id, t.day, t.part
  from public.plan_times t where t.board_id = v_board.id and t.user_id = auth.uid();

  insert into public.plan_saves (board_id, user_id, connection_id, saved_at)
  values (v_board.id, auth.uid(), v_board.connection_id, clock_timestamp())
  on conflict (board_id, user_id) do update set saved_at = clock_timestamp();

  v_other_saved := exists (select 1 from public.plan_saves where board_id = v_board.id and user_id = v_other);
  v_shared := public._plan_shared_count(v_board.id);
  v_shared_times := public._plan_shared_time_count(v_board.id);
  if v_other_saved and v_shared = 0 then
    update public.plan_boards set no_match_rounds = no_match_rounds + 1 where id = v_board.id;
  end if;

  perform public._plan_touch(v_board.id);
  return jsonb_build_object('other_saved', v_other_saved, 'shared', v_shared, 'shared_times', v_shared_times);
end;
$$;

grant execute on function public.plan_save_picks(uuid) to authenticated;

-- Puts picks and times back to what was last saved ("Cancel").
create or replace function public.plan_revert_picks(p_board_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_board public.plan_boards%rowtype;
begin
  v_board := public._plan_my_open_board(p_board_id);
  if not exists (select 1 from public.plan_saves where board_id = v_board.id and user_id = auth.uid()) then
    return;
  end if;
  delete from public.plan_picks where board_id = v_board.id and user_id = auth.uid();
  insert into public.plan_picks (idea_id, user_id, board_id, connection_id)
  select s.idea_id, auth.uid(), v_board.id, v_board.connection_id
  from public.plan_saved_picks s where s.board_id = v_board.id and s.user_id = auth.uid();
  delete from public.plan_times where board_id = v_board.id and user_id = auth.uid();
  insert into public.plan_times (board_id, connection_id, user_id, day, part)
  select v_board.id, v_board.connection_id, auth.uid(), s.day, s.part
  from public.plan_saved_times s where s.board_id = v_board.id and s.user_id = auth.uid();
end;
$$;

grant execute on function public.plan_revert_picks(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- B. No home ideas before a first meetup
-- ---------------------------------------------------------------------

create or replace function public._plan_mentions_home(p_text text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_text, '') ~* '\m(home|house|apartment|backyard)\M'
      or coalesce(p_text, '') ~* '\m(my|your|their|his|her)\s+place\M'
      or coalesce(p_text, '') ~* '''s\s+place\M';
$$;

create or replace function public.plan_add_own_idea(p_board_id uuid, p_title text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_board public.plan_boards%rowtype;
  v_title text := btrim(regexp_replace(coalesce(p_title, ''), '\s+', ' ', 'g'));
  v_id uuid;
begin
  v_board := public._plan_my_open_board(p_board_id);
  if char_length(v_title) < 2 then raise exception 'idea_too_short'; end if;
  if char_length(v_title) > 80 then raise exception 'idea_too_long'; end if;
  if (select coalesce(meetup_count, 0) from public.connections where id = v_board.connection_id) = 0
     and public._plan_mentions_home(v_title) then
    raise exception 'home_first_meetup';
  end if;
  if (select count(*) from public.plan_ideas where board_id = v_board.id and source = 'own') >= 10 then
    raise exception 'too_many_ideas';
  end if;
  insert into public.plan_ideas (board_id, connection_id, source, added_by, slot, title, set_number)
  values (v_board.id, v_board.connection_id, 'own', auth.uid(), 'own', v_title,
          coalesce((select max(set_number) from public.plan_ideas where board_id = v_board.id), 1))
  returning id into v_id;
  insert into public.plan_picks (idea_id, user_id, board_id, connection_id)
  values (v_id, auth.uid(), v_board.id, v_board.connection_id);
  perform public._plan_touch(v_board.id);
  return v_id;
end;
$$;

grant execute on function public.plan_add_own_idea(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- C. Reading the card
-- ---------------------------------------------------------------------

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

grant execute on function public.get_plan_board(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- D. Inbox: whose turn it is
-- ---------------------------------------------------------------------
-- stage: pick (your turn), waiting (for the other person), matched (an
-- idea and a time in common: the person who saved second suggests the
-- plan), no_time (an idea in common but no time yet), no_match.

drop function if exists public.my_plan_turns();
create or replace function public.my_plan_turns()
returns table (connection_id uuid, stage text, waiting_on_me boolean, closes_at timestamptz)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  r record;
  v_other uuid;
  v_mine timestamptz;
  v_theirs timestamptz;
begin
  for r in
    select b.*, c.user_a_id, c.user_b_id
    from public.plan_boards b
    join public.connections c on c.id = b.connection_id
    where b.status = 'open'
      and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
      and not public._plan_has_upcoming(b.connection_id)
  loop
    v_other := case when r.user_a_id = auth.uid() then r.user_b_id else r.user_a_id end;
    connection_id := r.connection_id;
    closes_at := r.last_activity_at + interval '14 days';
    select saved_at into v_mine from public.plan_saves s where s.board_id = r.id and s.user_id = auth.uid();
    select saved_at into v_theirs from public.plan_saves s where s.board_id = r.id and s.user_id = v_other;
    if v_mine is null then
      stage := 'pick';
      waiting_on_me := true;
    elsif v_theirs is null then
      stage := 'waiting';
      waiting_on_me := false;
    elsif public._plan_shared_count(r.id) > 0 and public._plan_shared_time_count(r.id) > 0 then
      stage := 'matched';
      waiting_on_me := v_mine > v_theirs;
    elsif public._plan_shared_count(r.id) > 0 then
      stage := 'no_time';
      waiting_on_me := v_mine < v_theirs;
    else
      stage := 'no_match';
      waiting_on_me := v_mine < v_theirs;
    end if;
    return next;
    v_mine := null;
    v_theirs := null;
  end loop;
end;
$$;

grant execute on function public.my_plan_turns() to authenticated;

-- ---------------------------------------------------------------------
-- E. Gentle nudges to meet in person
-- ---------------------------------------------------------------------

create table if not exists public.meet_nudges (
  connection_id uuid not null references public.connections(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  stage text not null check (stage in ('three_weeks', 'two_months', 'six_months')),
  answer text not null check (answer in ('plan', 'not_yet', 'keep_chatting')),
  answered_at timestamptz not null default now(),
  ask_again_at timestamptz,
  primary key (connection_id, user_id, stage)
);

alter table public.meet_nudges enable row level security;
drop policy if exists "Own meet nudges" on public.meet_nudges;
create policy "Own meet nudges" on public.meet_nudges for select using (user_id = auth.uid());

-- Days two people have been really talking (both have written), since the
-- chat was last opened, not counting days it was paused.
create or replace function public._talking_days(p_connection_id uuid, p_now timestamptz default now())
returns numeric
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_conn public.connections%rowtype;
  v_opened timestamptz;
  v_a timestamptz;
  v_b timestamptz;
  v_start timestamptz;
  v_paused interval := interval '0';
  r record;
  v_end timestamptz;
begin
  select * into v_conn from public.connections where id = p_connection_id;
  if not found then return 0; end if;
  v_opened := coalesce(v_conn.opened_at, v_conn.created_at);
  select min(created_at) into v_a from public.messages
  where connection_id = p_connection_id and sender_id = v_conn.user_a_id and created_at >= v_opened;
  select min(created_at) into v_b from public.messages
  where connection_id = p_connection_id and sender_id = v_conn.user_b_id and created_at >= v_opened;
  if v_a is null or v_b is null then return 0; end if;
  v_start := greatest(v_a, v_b);

  for r in
    select e.created_at from public.friendship_events e
    where e.connection_id = p_connection_id and e.event_type = 'connection_paused'
      and e.created_at < p_now
  loop
    select min(e2.created_at) into v_end from public.friendship_events e2
    where e2.connection_id = p_connection_id and e2.event_type = 'connection_resumed'
      and e2.created_at > r.created_at;
    v_end := least(coalesce(v_end, p_now), p_now);
    if v_end > v_start then
      v_paused := v_paused + (v_end - greatest(r.created_at, v_start));
    end if;
  end loop;

  return greatest(0, extract(epoch from (p_now - v_start - v_paused)) / 86400.0);
end;
$$;

-- The nudge to show the caller in this chat right now, or null.
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
  v_three public.meet_nudges%rowtype;
begin
  if v_caller is null then return null; end if;
  select * into v_conn from public.connections
  where id = p_connection_id and (user_a_id = v_caller or user_b_id = v_caller);
  if not found then return null; end if;
  if v_conn.status is not null and v_conn.status not in ('pending', 'active') then return null; end if;
  if coalesce(v_conn.meetup_count, 0) > 0 then return null; end if;
  if exists (select 1 from public.meetups m where m.connection_id = p_connection_id and m.status = 'occurred') then
    return null;
  end if;
  -- Already planning: let them.
  if public._plan_has_upcoming(p_connection_id) then return null; end if;
  if exists (select 1 from public.plan_boards b where b.connection_id = p_connection_id and b.status = 'open') then
    return null;
  end if;

  v_days := public._talking_days(p_connection_id);

  if v_days >= 180 then
    if not exists (select 1 from public.meet_nudges where connection_id = p_connection_id
                   and user_id = v_caller and stage = 'six_months') then
      return jsonb_build_object('stage', 'six_months', 'days', floor(v_days));
    end if;
    return null;
  end if;

  if v_days >= 60 then
    if not exists (select 1 from public.meet_nudges where connection_id = p_connection_id
                   and user_id = v_caller and stage = 'two_months') then
      return jsonb_build_object('stage', 'two_months', 'days', floor(v_days));
    end if;
    return null;
  end if;

  if v_days >= 21 then
    select * into v_three from public.meet_nudges
    where connection_id = p_connection_id and user_id = v_caller and stage = 'three_weeks';
    if not found or v_three.ask_again_at <= now() then
      return jsonb_build_object('stage', 'three_weeks', 'days', floor(v_days));
    end if;
  end if;
  return null;
end;
$$;

grant execute on function public.get_meet_nudge(uuid) to authenticated;

-- Records the caller's answer. "plan" also counts as asked: if they don't
-- end up meeting, the 3-week card comes back 3 weeks later.
create or replace function public.answer_meet_nudge(p_connection_id uuid, p_stage text, p_answer text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if not exists (select 1 from public.connections where id = p_connection_id
                 and (user_a_id = v_caller or user_b_id = v_caller)) then
    raise exception 'Not a participant of this connection';
  end if;
  if p_stage not in ('three_weeks', 'two_months', 'six_months') then raise exception 'bad_stage'; end if;
  if p_answer not in ('plan', 'not_yet', 'keep_chatting') then raise exception 'bad_answer'; end if;
  insert into public.meet_nudges (connection_id, user_id, stage, answer, answered_at, ask_again_at)
  values (p_connection_id, v_caller, p_stage, p_answer, now(),
          case when p_stage = 'three_weeks' then now() + interval '21 days' end)
  on conflict (connection_id, user_id, stage) do update
    set answer = excluded.answer, answered_at = excluded.answered_at, ask_again_at = excluded.ask_again_at;
end;
$$;

grant execute on function public.answer_meet_nudge(uuid, text, text) to authenticated;

-- Test tool: makes two people look like they have been talking for N days
-- (moves the chat's messages back), and clears the nudge answers for this
-- chat. Reply reminders count from now, so moving the messages back
-- doesn't set off reminders or close the chat.
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
  -- The chat counts as opened no later than its first message.
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
  return format('This chat now looks like you have been talking for %s days. Open it to see the card (it only shows if you have never met and nothing is being planned).', p_days);
end;
$$;

grant execute on function public.test_talking_age(uuid, integer) to authenticated;

create or replace function public.limen_db_version()
returns text
language sql
immutable
as $$ select '20261009000006'::text $$;

grant execute on function public.limen_db_version() to anon, authenticated;

notify pgrst, 'reload schema';
