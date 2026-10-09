-- 2026-10-09 (4): "Let's plan something", rebuilt as a shared planning card.
-- Safe to run more than once.
--
-- One card per chat that both people see. Three steps, then it ends:
--   1. What:  three ideas (Easy / You both like / Something new) plus any
--             ideas either person adds. Each person marks any number of
--             ideas; both see each other's marks. An idea both marked can
--             be chosen.
--   2. When:  each person marks rough times (morning, afternoon, evening)
--             over the next 2 weeks. Shared times are shown; one is chosen.
--   3. Where: the person who goes ahead picks the exact time and place in
--             the normal meetup plan, the other confirms it there.
-- The card ends when a plan is confirmed, when either person taps
-- "Not now", or quietly after 14 days with nobody touching it. It is never
-- an endless loop.
--
-- The AI only writes the three starting ideas (server function
-- plan-ideas). Everything else is people choosing, plus simple counting.
-- New sets of ideas: 10 per card. If the AI is unavailable, the database
-- adds three safe, hand-written ideas instead (plan_add_fallback_ideas).
--
-- Safety rules for ideas: nothing romantic, sexual or adult, nothing risky,
-- nothing where drinking is the point, public places before the first
-- meetup, and a home only when both people said so for this friendship
-- (asked privately after the first meetup).

-- ---------------------------------------------------------------------
-- A. Tables
-- ---------------------------------------------------------------------

create table if not exists public.plan_boards (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.connections(id) on delete cascade,
  started_by uuid not null references public.users(id) on delete cascade,
  status text not null default 'open' check (status in ('open', 'planned', 'closed')),
  close_reason text check (close_reason in ('planned', 'not_now', 'quiet', 'chat_closed')),
  closed_by uuid references public.users(id) on delete set null,
  refreshes_used integer not null default 0,
  chosen_idea_id uuid,
  chosen_day date,
  chosen_part text check (chosen_part in ('morning', 'afternoon', 'evening')),
  created_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  closed_at timestamptz
);

create unique index if not exists plan_boards_one_open
  on public.plan_boards(connection_id) where status = 'open';
create index if not exists plan_boards_connection_idx on public.plan_boards(connection_id, created_at desc);

create table if not exists public.plan_ideas (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.plan_boards(id) on delete cascade,
  connection_id uuid not null references public.connections(id) on delete cascade,
  source text not null check (source in ('ai', 'fallback', 'own')),
  added_by uuid references public.users(id) on delete set null,
  slot text not null check (slot in ('easy', 'both_like', 'new', 'own')),
  set_number integer not null default 1,
  title text not null check (char_length(title) between 1 and 80),
  description text check (description is null or char_length(description) <= 240),
  cost_label text check (cost_label is null or char_length(cost_label) <= 30),
  duration_label text check (duration_label is null or char_length(duration_label) <= 30),
  style text check (style in ('talk', 'side_by_side', 'mix')),
  first_meetup_ok boolean not null default false,
  interest_note text check (interest_note is null or char_length(interest_note) <= 80),
  home_of uuid references public.users(id) on delete set null,
  retired boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists plan_ideas_board_idx on public.plan_ideas(board_id, created_at);

alter table public.plan_boards drop constraint if exists plan_boards_chosen_idea_fk;
alter table public.plan_boards add constraint plan_boards_chosen_idea_fk
  foreign key (chosen_idea_id) references public.plan_ideas(id) on delete set null;

create table if not exists public.plan_picks (
  idea_id uuid not null references public.plan_ideas(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  board_id uuid not null references public.plan_boards(id) on delete cascade,
  connection_id uuid not null references public.connections(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (idea_id, user_id)
);

create table if not exists public.plan_times (
  board_id uuid not null references public.plan_boards(id) on delete cascade,
  connection_id uuid not null references public.connections(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  day date not null,
  part text not null check (part in ('morning', 'afternoon', 'evening')),
  primary key (board_id, user_id, day, part)
);

-- Account level, asked the first time someone plans. Changeable anytime.
create table if not exists public.plan_prefs (
  user_id uuid primary key references public.users(id) on delete cascade,
  budget text not null check (budget in ('free', 'under_15', 'under_30', 'flexible')),
  duration text not null check (duration in ('hour', 'two_hours', 'half_day')),
  travel_minutes integer not null check (travel_minutes in (15, 30, 45)),
  updated_at timestamptz not null default now()
);

-- Per friendship, private, asked after the first meetup. A home idea is
-- only suggested when the host said "happy to host" AND the other person
-- said "happy to go to theirs". Neither answer is ever shown to the other.
create table if not exists public.plan_home_prefs (
  connection_id uuid not null references public.connections(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  can_host boolean not null default false,
  can_visit boolean not null default false,
  answered_at timestamptz not null default now(),
  primary key (connection_id, user_id)
);

alter table public.plan_boards enable row level security;
alter table public.plan_ideas enable row level security;
alter table public.plan_picks enable row level security;
alter table public.plan_times enable row level security;
alter table public.plan_prefs enable row level security;
alter table public.plan_home_prefs enable row level security;

-- Both people in the chat can read the card, its ideas, marks and times.
-- Nobody writes these directly; the functions below do.
drop policy if exists "Participants read plan boards" on public.plan_boards;
create policy "Participants read plan boards" on public.plan_boards for select using (
  exists (select 1 from public.connections c where c.id = plan_boards.connection_id
          and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())));

drop policy if exists "Participants read plan ideas" on public.plan_ideas;
create policy "Participants read plan ideas" on public.plan_ideas for select using (
  exists (select 1 from public.connections c where c.id = plan_ideas.connection_id
          and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())));

drop policy if exists "Participants read plan picks" on public.plan_picks;
create policy "Participants read plan picks" on public.plan_picks for select using (
  exists (select 1 from public.connections c where c.id = plan_picks.connection_id
          and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())));

drop policy if exists "Participants read plan times" on public.plan_times;
create policy "Participants read plan times" on public.plan_times for select using (
  exists (select 1 from public.connections c where c.id = plan_times.connection_id
          and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())));

drop policy if exists "Own plan prefs" on public.plan_prefs;
create policy "Own plan prefs" on public.plan_prefs for select using (user_id = auth.uid());

drop policy if exists "Own home prefs" on public.plan_home_prefs;
create policy "Own home prefs" on public.plan_home_prefs for select using (user_id = auth.uid());

-- Live updates: the other person's marks and times show up without a reload.
do $$
declare
  t text;
begin
  foreach t in array array['plan_boards', 'plan_ideas', 'plan_picks', 'plan_times'] loop
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
       and not exists (
         select 1 from pg_publication_tables
         where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
       ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- B. Helpers
-- ---------------------------------------------------------------------

-- A chat you can plan in: open (not paused, ended, blocked or closed).
create or replace function public._plan_chat_open(p_status text)
returns boolean
language sql
immutable
as $$
  select p_status is null or p_status in ('pending', 'active', 'graduated');
$$;

-- The caller's open card, checked. Raises if not theirs or not open.
create or replace function public._plan_my_open_board(p_board_id uuid)
returns public.plan_boards
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_board public.plan_boards%rowtype;
  v_conn public.connections%rowtype;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select * into v_board from public.plan_boards where id = p_board_id;
  if not found then raise exception 'plan_not_found'; end if;
  select * into v_conn from public.connections where id = v_board.connection_id;
  if v_conn.user_a_id is distinct from auth.uid() and v_conn.user_b_id is distinct from auth.uid() then
    raise exception 'plan_not_found';
  end if;
  if v_board.status <> 'open' then raise exception 'plan_closed'; end if;
  if not public._plan_chat_open(v_conn.status) then raise exception 'chat_not_open'; end if;
  return v_board;
end;
$$;

create or replace function public._plan_touch(p_board_id uuid)
returns void
language sql
security definer
set search_path to 'public'
as $$
  update public.plan_boards set last_activity_at = now() where id = p_board_id;
$$;

-- Is there a plan (proposed or confirmed, today or later) in this chat?
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
      and coalesce(m.confirmed_date, m.proposed_date) >= (now() at time zone public.meetup_tz(m.time_zone))::date
  );
$$;

-- ---------------------------------------------------------------------
-- C. Starting, reading and ending a card
-- ---------------------------------------------------------------------

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

  select id into v_id from public.plan_boards where connection_id = p_connection_id and status = 'open';
  if found then return v_id; end if;

  insert into public.plan_boards (connection_id, started_by)
  values (p_connection_id, v_caller)
  on conflict do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.plan_boards where connection_id = p_connection_id and status = 'open';
  end if;
  return v_id;
end;
$$;

grant execute on function public.start_plan_board(uuid) to authenticated;

-- Everything the card needs, in one call. Shows the open card, or a card
-- that ended in the last 3 days (so both people see how it ended).
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
  v_other_times jsonb;
  v_prefs jsonb;
  v_home jsonb;
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

  if v_has_board then
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
        'picked_by_other', exists (select 1 from public.plan_picks k where k.idea_id = i.id and k.user_id = v_other)
      ) order by i.set_number desc, case i.slot when 'easy' then 1 when 'both_like' then 2 when 'new' then 3 else 4 end, i.created_at), '[]'::jsonb)
    into v_ideas
    from public.plan_ideas i
    where i.board_id = v_board.id
      and (not i.retired or exists (select 1 from public.plan_picks k where k.idea_id = i.id));

    select coalesce(jsonb_agg(jsonb_build_object('day', t.day, 'part', t.part) order by t.day, t.part), '[]'::jsonb)
    into v_my_times from public.plan_times t where t.board_id = v_board.id and t.user_id = v_caller;
    select coalesce(jsonb_agg(jsonb_build_object('day', t.day, 'part', t.part) order by t.day, t.part), '[]'::jsonb)
    into v_other_times from public.plan_times t where t.board_id = v_board.id and t.user_id = v_other;
  end if;

  return jsonb_build_object(
    'me', v_caller,
    'other', v_other,
    'meetup_count', v_conn.meetup_count,
    'chat_open', public._plan_chat_open(v_conn.status),
    'has_upcoming_plan', public._plan_has_upcoming(p_connection_id),
    'my_prefs', v_prefs,
    'my_home', v_home,
    'board', case when v_has_board then jsonb_build_object(
      'id', v_board.id,
      'status', v_board.status,
      'close_reason', v_board.close_reason,
      'closed_by', v_board.closed_by,
      'started_by', v_board.started_by,
      'refreshes_left', greatest(0, 10 - v_board.refreshes_used),
      'chosen_idea_id', v_board.chosen_idea_id,
      'chosen_day', v_board.chosen_day,
      'chosen_part', v_board.chosen_part,
      'created_at', v_board.created_at,
      'last_activity_at', v_board.last_activity_at,
      'closes_at', v_board.last_activity_at + interval '14 days',
      'ideas', v_ideas,
      'my_times', v_my_times,
      'other_times', v_other_times
    ) else null end
  );
end;
$$;

grant execute on function public.get_plan_board(uuid) to authenticated;

create or replace function public.close_plan_board(p_board_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_board public.plan_boards%rowtype;
begin
  v_board := public._plan_my_open_board(p_board_id);
  update public.plan_boards
  set status = 'closed', close_reason = 'not_now', closed_by = auth.uid(), closed_at = now()
  where id = v_board.id;
end;
$$;

grant execute on function public.close_plan_board(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- D. Step 1: ideas and marks
-- ---------------------------------------------------------------------

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

-- Marks or unmarks an idea for the caller. Returns true if now marked.
create or replace function public.plan_toggle_pick(p_idea_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_idea public.plan_ideas%rowtype;
  v_board public.plan_boards%rowtype;
begin
  select * into v_idea from public.plan_ideas where id = p_idea_id;
  if not found then raise exception 'plan_not_found'; end if;
  v_board := public._plan_my_open_board(v_idea.board_id);
  if exists (select 1 from public.plan_picks where idea_id = p_idea_id and user_id = auth.uid()) then
    delete from public.plan_picks where idea_id = p_idea_id and user_id = auth.uid();
    if v_board.chosen_idea_id = p_idea_id then
      update public.plan_boards set chosen_idea_id = null, chosen_day = null, chosen_part = null where id = v_board.id;
    end if;
    perform public._plan_touch(v_board.id);
    return false;
  end if;
  insert into public.plan_picks (idea_id, user_id, board_id, connection_id)
  values (p_idea_id, auth.uid(), v_board.id, v_board.connection_id);
  perform public._plan_touch(v_board.id);
  return true;
end;
$$;

grant execute on function public.plan_toggle_pick(uuid) to authenticated;

-- Goes ahead with an idea both people marked.
create or replace function public.plan_choose_idea(p_board_id uuid, p_idea_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_board public.plan_boards%rowtype;
begin
  v_board := public._plan_my_open_board(p_board_id);
  if not exists (select 1 from public.plan_ideas where id = p_idea_id and board_id = v_board.id) then
    raise exception 'plan_not_found';
  end if;
  if (select count(*) from public.plan_picks where idea_id = p_idea_id) < 2 then
    raise exception 'not_both_picked';
  end if;
  update public.plan_boards set chosen_idea_id = p_idea_id where id = v_board.id;
  perform public._plan_touch(v_board.id);
end;
$$;

grant execute on function public.plan_choose_idea(uuid, uuid) to authenticated;

-- Back to the ideas (clears the chosen idea and time).
create or replace function public.plan_unchoose(p_board_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_board public.plan_boards%rowtype;
begin
  v_board := public._plan_my_open_board(p_board_id);
  update public.plan_boards set chosen_idea_id = null, chosen_day = null, chosen_part = null where id = v_board.id;
  perform public._plan_touch(v_board.id);
end;
$$;

grant execute on function public.plan_unchoose(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- E. Step 2: rough times over the next 2 weeks
-- ---------------------------------------------------------------------

-- Replaces the caller's times. p_slots: [{"day":"2026-10-10","part":"afternoon"}, ...]
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

  -- A chosen time nobody is free for anymore is cleared.
  if v_board.chosen_day is not null and (
    select count(*) from public.plan_times
    where board_id = v_board.id and day = v_board.chosen_day and part = v_board.chosen_part
  ) < 2 then
    update public.plan_boards set chosen_day = null, chosen_part = null where id = v_board.id;
  end if;

  perform public._plan_touch(v_board.id);
  return v_count;
end;
$$;

grant execute on function public.plan_set_times(uuid, jsonb) to authenticated;

-- Picks one of the times both people marked.
create or replace function public.plan_choose_time(p_board_id uuid, p_day date, p_part text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_board public.plan_boards%rowtype;
begin
  v_board := public._plan_my_open_board(p_board_id);
  if p_day is null then
    update public.plan_boards set chosen_day = null, chosen_part = null where id = v_board.id;
    perform public._plan_touch(v_board.id);
    return;
  end if;
  if (select count(*) from public.plan_times where board_id = v_board.id and day = p_day and part = p_part) < 2 then
    raise exception 'not_both_free';
  end if;
  update public.plan_boards set chosen_day = p_day, chosen_part = p_part where id = v_board.id;
  perform public._plan_touch(v_board.id);
end;
$$;

grant execute on function public.plan_choose_time(uuid, date, text) to authenticated;

-- ---------------------------------------------------------------------
-- F. Preferences
-- ---------------------------------------------------------------------

create or replace function public.set_plan_prefs(p_budget text, p_duration text, p_travel_minutes integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  insert into public.plan_prefs (user_id, budget, duration, travel_minutes, updated_at)
  values (auth.uid(), p_budget, p_duration, p_travel_minutes, now())
  on conflict (user_id) do update
    set budget = excluded.budget, duration = excluded.duration,
        travel_minutes = excluded.travel_minutes, updated_at = now();
end;
$$;

grant execute on function public.set_plan_prefs(text, text, integer) to authenticated;

create or replace function public.set_plan_home_pref(p_connection_id uuid, p_can_host boolean, p_can_visit boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not exists (select 1 from public.connections where id = p_connection_id
                 and (user_a_id = auth.uid() or user_b_id = auth.uid())) then
    raise exception 'Not a participant of this connection';
  end if;
  insert into public.plan_home_prefs (connection_id, user_id, can_host, can_visit, answered_at)
  values (p_connection_id, auth.uid(), coalesce(p_can_host, false), coalesce(p_can_visit, false), now())
  on conflict (connection_id, user_id) do update
    set can_host = excluded.can_host, can_visit = excluded.can_visit, answered_at = now();
end;
$$;

grant execute on function public.set_plan_home_pref(uuid, boolean, boolean) to authenticated;

-- Who may host, for this friendship: only after a first meetup, only when
-- the host said yes to hosting and the other said yes to visiting.
create or replace function public._plan_home_hosts(p_connection_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(array_agg(h.user_id), '{}')
  from public.connections c
  join public.plan_home_prefs h on h.connection_id = c.id and h.can_host
  join public.plan_home_prefs v on v.connection_id = c.id and v.user_id <> h.user_id and v.can_visit
  where c.id = p_connection_id and c.meetup_count >= 1;
$$;

-- ---------------------------------------------------------------------
-- G. What the idea writer (server function plan-ideas) may see and save
-- ---------------------------------------------------------------------
-- Only the server function can call these (service role). The idea writer
-- gets the stricter of the two people's limits without learning whose
-- limit it was, and a home only when both agreed.

create or replace function public.plan_idea_context(p_board_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_board public.plan_boards%rowtype;
  v_conn public.connections%rowtype;
  v_other uuid;
  v_me_p public.profiles%rowtype;
  v_ot_p public.profiles%rowtype;
  v_mine text[];
  v_theirs text[];
  v_budget text;
  v_duration text;
  v_travel integer;
  v_hosts uuid[];
begin
  select * into v_board from public.plan_boards where id = p_board_id;
  if not found then raise exception 'plan_not_found'; end if;
  select * into v_conn from public.connections where id = v_board.connection_id;
  if v_conn.user_a_id is distinct from p_user_id and v_conn.user_b_id is distinct from p_user_id then
    raise exception 'plan_not_found';
  end if;
  if v_board.status <> 'open' or not public._plan_chat_open(v_conn.status) then raise exception 'plan_closed'; end if;
  v_other := case when v_conn.user_a_id = p_user_id then v_conn.user_b_id else v_conn.user_a_id end;

  select * into v_me_p from public.profiles where user_id = p_user_id;
  select * into v_ot_p from public.profiles where user_id = v_other;
  v_mine := coalesce(array(select jsonb_array_elements_text(coalesce(v_me_p.activity_interests->'categories', '[]'::jsonb))), '{}');
  v_theirs := coalesce(array(select jsonb_array_elements_text(coalesce(v_ot_p.activity_interests->'categories', '[]'::jsonb))), '{}');

  -- The stricter limit of the two.
  select case min(case budget when 'free' then 1 when 'under_15' then 2 when 'under_30' then 3 else 4 end)
           when 1 then 'free' when 2 then 'under_15' when 3 then 'under_30' when 4 then 'flexible' end,
         case min(case duration when 'hour' then 1 when 'two_hours' then 2 else 3 end)
           when 1 then 'hour' when 2 then 'two_hours' when 3 then 'half_day' end,
         min(travel_minutes)
  into v_budget, v_duration, v_travel
  from public.plan_prefs where user_id in (p_user_id, v_other);

  v_hosts := public._plan_home_hosts(v_conn.id);

  return jsonb_build_object(
    'board_id', v_board.id,
    'refreshes_used', v_board.refreshes_used,
    'has_ideas', exists (select 1 from public.plan_ideas where board_id = v_board.id and source in ('ai', 'fallback')),
    'meetup_count', v_conn.meetup_count,
    'city', nullif(concat_ws(', ', nullif(v_me_p.location_city, ''), nullif(v_me_p.location_state, '')), ''),
    'month', trim(to_char(now(), 'Month')),
    'shared_interests', to_jsonb(array(select unnest(v_mine) intersect select unnest(v_theirs))),
    'my_interests', to_jsonb(array(select unnest(v_mine) except select unnest(v_theirs))),
    'their_interests', to_jsonb(array(select unnest(v_theirs) except select unnest(v_mine))),
    'budget', v_budget,
    'duration', v_duration,
    'travel_minutes', v_travel,
    'home_hosts', to_jsonb(v_hosts),
    'me', p_user_id,
    'other', v_other,
    'my_name', coalesce(nullif(v_me_p.first_name, ''), split_part(coalesce(v_me_p.display_name, ''), ' ', 1)),
    'their_name', coalesce(nullif(v_ot_p.first_name, ''), split_part(coalesce(v_ot_p.display_name, ''), ' ', 1)),
    'avoid', coalesce((
      select jsonb_agg(distinct x) from (
        select i.title as x from public.plan_ideas i where i.board_id = v_board.id
        union all
        select m.activity from public.meetups m
        where m.connection_id = v_conn.id and m.status = 'occurred' and nullif(m.activity, '') is not null
      ) a where x is not null
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.plan_idea_context(uuid, uuid) from public, anon, authenticated;
grant execute on function public.plan_idea_context(uuid, uuid) to service_role;

-- Saves a set of three ideas. A refresh counts against the 10 per card.
create or replace function public.save_plan_ideas(p_board_id uuid, p_user_id uuid, p_ideas jsonb, p_source text default 'ai')
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_board public.plan_boards%rowtype;
  v_conn public.connections%rowtype;
  v_has boolean;
  v_set integer;
  v_hosts uuid[];
  v_count integer;
begin
  select * into v_board from public.plan_boards where id = p_board_id for update;
  if not found then raise exception 'plan_not_found'; end if;
  select * into v_conn from public.connections where id = v_board.connection_id;
  if v_conn.user_a_id is distinct from p_user_id and v_conn.user_b_id is distinct from p_user_id then
    raise exception 'plan_not_found';
  end if;
  if v_board.status <> 'open' or not public._plan_chat_open(v_conn.status) then raise exception 'plan_closed'; end if;

  v_has := exists (select 1 from public.plan_ideas where board_id = v_board.id and source in ('ai', 'fallback'));
  if v_has then
    if v_board.refreshes_used >= 10 then raise exception 'refresh_limit'; end if;
    update public.plan_boards set refreshes_used = refreshes_used + 1 where id = v_board.id;
    -- Ideas nobody marked make room for the new ones.
    update public.plan_ideas i set retired = true
    where i.board_id = v_board.id and i.source <> 'own'
      and not exists (select 1 from public.plan_picks k where k.idea_id = i.id);
  end if;

  v_set := coalesce((select max(set_number) from public.plan_ideas where board_id = v_board.id), 0) + 1;
  v_hosts := public._plan_home_hosts(v_conn.id);

  insert into public.plan_ideas (board_id, connection_id, source, slot, set_number, title, description,
    cost_label, duration_label, style, first_meetup_ok, interest_note, home_of)
  select v_board.id, v_conn.id, case when p_source = 'fallback' then 'fallback' else 'ai' end,
         e->>'slot', v_set,
         left(btrim(e->>'title'), 80),
         nullif(left(btrim(coalesce(e->>'description', '')), 240), ''),
         nullif(left(btrim(coalesce(e->>'cost_label', '')), 30), ''),
         nullif(left(btrim(coalesce(e->>'duration_label', '')), 30), ''),
         case when e->>'style' in ('talk', 'side_by_side', 'mix') then e->>'style' end,
         coalesce((e->>'first_meetup_ok')::boolean, false),
         nullif(left(btrim(coalesce(e->>'interest_note', '')), 80), ''),
         -- A home only when that person may host (checked again here).
         case when (e->>'home_of') is not null and (e->>'home_of')::uuid = any (v_hosts) then (e->>'home_of')::uuid end
  from jsonb_array_elements(coalesce(p_ideas, '[]'::jsonb)) e
  where e->>'slot' in ('easy', 'both_like', 'new')
    and char_length(btrim(coalesce(e->>'title', ''))) between 1 and 80
    -- An idea at a home nobody may host is dropped.
    and ((e->>'home_of') is null or (e->>'home_of')::uuid = any (v_hosts));
  get diagnostics v_count = row_count;

  update public.plan_boards set last_activity_at = now() where id = v_board.id;
  return v_count;
end;
$$;

revoke execute on function public.save_plan_ideas(uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.save_plan_ideas(uuid, uuid, jsonb, text) to service_role;

-- Hand-written ideas when the AI is unavailable. Same rules and the same
-- count as AI ideas. Public, low cost, never drinking, never a home.
create or replace function public.plan_add_fallback_ideas(p_board_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_board public.plan_boards%rowtype;
  v_ctx jsonb;
  v_avoid text[];
  v_shared text;
  v_easy jsonb;
  v_new jsonb;
  v_both jsonb;
  v_label text;
begin
  v_board := public._plan_my_open_board(p_board_id);
  v_ctx := public.plan_idea_context(v_board.id, auth.uid());
  v_avoid := array(select jsonb_array_elements_text(v_ctx->'avoid'));

  select e into v_easy from jsonb_array_elements('[
    {"title":"Coffee and a short walk","description":"Meet at a cafe, then walk around the block or a nearby park.","cost_label":"About $5","duration_label":"About 1 hour","style":"mix"},
    {"title":"A morning at the farmers market","description":"Wander the stalls, try a sample or two, and see what is in season.","cost_label":"Free to browse","duration_label":"About 1 hour","style":"side_by_side"},
    {"title":"Tea at a quiet cafe","description":"Pick a cafe with comfortable seats and take your time.","cost_label":"About $5","duration_label":"About 1 hour","style":"talk"},
    {"title":"A walk in a local park","description":"An easy loop on a well-used path, with a bench stop if you like.","cost_label":"Free","duration_label":"About 1 hour","style":"side_by_side"},
    {"title":"Browse a bookstore","description":"Wander the shelves and swap a favorite or two.","cost_label":"Free to browse","duration_label":"About 1 hour","style":"side_by_side"}
  ]'::jsonb) e
  where not (e->>'title' = any (v_avoid))
  order by random() limit 1;

  select e into v_new from jsonb_array_elements('[
    {"title":"A free museum or gallery hour","description":"Many museums have a free day or a pay-what-you-can hour. Pick one room each to show the other.","cost_label":"Free or low cost","duration_label":"About 1 to 2 hours","style":"side_by_side"},
    {"title":"Try a community class","description":"A one-time drop-in class at a library or community center, like sketching or a cooking demo.","cost_label":"Often free","duration_label":"About 1 to 2 hours","style":"side_by_side"},
    {"title":"Visit a botanical garden","description":"Slow paths, lots to look at, and easy to talk or not.","cost_label":"Free or low cost","duration_label":"About 1 to 2 hours","style":"side_by_side"},
    {"title":"A puzzle or board game cafe","description":"Pick a short game you have never played and learn it together.","cost_label":"About $10","duration_label":"About 2 hours","style":"side_by_side"},
    {"title":"A library talk or reading","description":"Check the local library calendar for a free talk on something new to you both.","cost_label":"Free","duration_label":"About 1 hour","style":"side_by_side"}
  ]'::jsonb) e
  where not (e->>'title' = any (v_avoid))
  order by random() limit 1;

  v_shared := (
    select x from jsonb_array_elements_text(v_ctx->'shared_interests') x
    where not (left(initcap(replace(x, '_', ' ')) || ' together', 80) = any (v_avoid))
    order by random() limit 1);
  if v_shared is not null then
    v_label := replace(v_shared, '_', ' ');
    v_both := jsonb_build_object(
      'title', left(initcap(v_label) || ' together', 80),
      'description', 'You both listed ' || v_label || '. Pick an easy way to enjoy it together, in a public place.',
      'cost_label', 'Depends on the plan',
      'duration_label', 'About 1 to 2 hours',
      'style', 'side_by_side',
      'interest_note', left('You both like ' || v_label, 80));
  else
    select e into v_both from jsonb_array_elements('[
      {"title":"Lunch somewhere new to you both","description":"Pick a casual spot neither of you has tried.","cost_label":"About $15","duration_label":"About 1 hour","style":"talk"},
      {"title":"Pastries and a people-watching bench","description":"Grab something from a bakery and find a bench somewhere lively.","cost_label":"About $8","duration_label":"About 1 hour","style":"talk"},
      {"title":"A walk through a neighborhood you both like","description":"Pick a street with shops and stop wherever looks good.","cost_label":"Free","duration_label":"About 1 hour","style":"mix"},
      {"title":"Ice cream or a smoothie and a stroll","description":"Something sweet, then a slow walk.","cost_label":"About $8","duration_label":"About 1 hour","style":"mix"}
    ]'::jsonb) e
    where not (e->>'title' = any (v_avoid))
    order by random() limit 1;
  end if;

  return public.save_plan_ideas(v_board.id, auth.uid(), jsonb_build_array(
    coalesce(v_easy, '{"title":"Coffee and a short walk","cost_label":"About $5","duration_label":"About 1 hour","style":"mix"}'::jsonb) || jsonb_build_object('slot', 'easy', 'first_meetup_ok', true),
    coalesce(v_both, '{"title":"Lunch somewhere casual","cost_label":"About $15","duration_label":"About 1 hour","style":"talk"}'::jsonb) || jsonb_build_object('slot', 'both_like', 'first_meetup_ok', true),
    coalesce(v_new, '{"title":"A walk somewhere new","cost_label":"Free","duration_label":"About 1 hour","style":"side_by_side"}'::jsonb) || jsonb_build_object('slot', 'new', 'first_meetup_ok', true)
  ), 'fallback');
end;
$$;

grant execute on function public.plan_add_fallback_ideas(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- H. Ending: a confirmed plan, a closed chat, or 14 quiet days
-- ---------------------------------------------------------------------

create or replace function public.close_plan_board_on_confirm()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.status = 'confirmed' and (tg_op = 'INSERT' or old.status is distinct from 'confirmed') then
    update public.plan_boards
    set status = 'planned', close_reason = 'planned', closed_at = now()
    where connection_id = new.connection_id and status = 'open';
  end if;
  return new;
end;
$$;

drop trigger if exists meetups_close_plan_board on public.meetups;
create trigger meetups_close_plan_board
  after insert or update of status on public.meetups
  for each row execute function public.close_plan_board_on_confirm();

create or replace function public.run_plan_board_check_all(p_now timestamptz default now())
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  update public.plan_boards b
  set status = 'closed', close_reason = 'chat_closed', closed_at = p_now
  from public.connections c
  where c.id = b.connection_id and b.status = 'open' and not public._plan_chat_open(c.status);

  update public.plan_boards
  set status = 'closed', close_reason = 'quiet', closed_at = p_now
  where status = 'open' and last_activity_at <= p_now - interval '14 days';
end;
$$;

revoke execute on function public.run_plan_board_check_all(timestamptz) from public, anon, authenticated;

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
  perform public.run_plan_board_check_all(p_now);
end;
$$;

-- Inbox: chats where a planning card is waiting on the caller.
drop function if exists public.my_plan_turns();
create or replace function public.my_plan_turns()
returns table (connection_id uuid, waiting_on_me boolean, closes_at timestamptz)
language sql
stable
security definer
set search_path to 'public'
as $$
  select b.connection_id,
    (
      -- Nothing marked yet.
      not exists (
        select 1 from public.plan_picks k join public.plan_ideas i on i.id = k.idea_id
        where k.board_id = b.id and k.user_id = auth.uid()
      )
      -- An idea is chosen and the caller hasn't marked any times.
      or (b.chosen_idea_id is not null and not exists (
        select 1 from public.plan_times t where t.board_id = b.id and t.user_id = auth.uid()))
    ) as waiting_on_me,
    b.last_activity_at + interval '14 days' as closes_at
  from public.plan_boards b
  join public.connections c on c.id = b.connection_id
  where b.status = 'open'
    and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
    and not public._plan_has_upcoming(b.connection_id);
$$;

grant execute on function public.my_plan_turns() to authenticated;

-- ---------------------------------------------------------------------
-- I. Test tool: make the planning card in a chat N days quiet, then run
--    the real check (14 days closes it).
-- ---------------------------------------------------------------------

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
  select id into v_id from public.plan_boards where connection_id = p_connection_id and status = 'open';
  if v_id is null then return 'There is no open planning card in this chat. Tap "Let''s plan something" first.'; end if;
  update public.plan_boards set last_activity_at = now() - make_interval(days => p_days) where id = v_id;
  perform public.run_plan_board_check_all(now());
  if (select status from public.plan_boards where id = v_id) = 'open' then
    return format('The planning card is now %s days quiet. Open the chat as either person to see the nudge.', p_days);
  end if;
  return 'The planning card was quiet for 14 days and closed. Open the chat to see how it ended.';
end;
$$;

grant execute on function public.test_plan_board_age(uuid, integer) to authenticated;

create or replace function public.limen_db_version()
returns text
language sql
immutable
as $$ select '20261009000004'::text $$;

grant execute on function public.limen_db_version() to anon, authenticated;

notify pgrst, 'reload schema';
