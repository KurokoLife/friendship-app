-- 2026-10-09 (5): planning card, "Save my picks" and matching.
-- Safe to run more than once. Builds on 20261009000004_plan_together.sql.
--
-- What changes:
--   - Marking ideas is a private draft until the person taps "Save my
--     picks". The other person sees only saved picks (and only an added
--     idea once it is saved). Picks are shown openly after saving, on
--     purpose: seeing what the other person wants is part of planning
--     together.
--   - A match is an idea in both people's saved picks. Only a matched idea
--     can be chosen, by either person.
--   - Saving with no match counts a round. After 2 rounds the card suggests
--     starting simple (coffee or a walk).
--   - Chat messages count as activity, so the card doesn't close or say
--     "closes on ..." while the two people are talking.
--   - Inbox shows whose turn it is (pick, waiting, matched, no match, times).

-- ---------------------------------------------------------------------
-- A. Tables
-- ---------------------------------------------------------------------

create table if not exists public.plan_saves (
  board_id uuid not null references public.plan_boards(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  connection_id uuid not null references public.connections(id) on delete cascade,
  saved_at timestamptz not null default now(),
  primary key (board_id, user_id)
);

create table if not exists public.plan_saved_picks (
  board_id uuid not null references public.plan_boards(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  idea_id uuid not null references public.plan_ideas(id) on delete cascade,
  connection_id uuid not null references public.connections(id) on delete cascade,
  primary key (idea_id, user_id)
);

create index if not exists plan_saved_picks_board_idx on public.plan_saved_picks(board_id, user_id);

alter table public.plan_boards add column if not exists no_match_rounds integer not null default 0;

alter table public.plan_saves enable row level security;
alter table public.plan_saved_picks enable row level security;

drop policy if exists "Participants read plan saves" on public.plan_saves;
create policy "Participants read plan saves" on public.plan_saves for select using (
  exists (select 1 from public.connections c where c.id = plan_saves.connection_id
          and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())));

drop policy if exists "Participants read saved plan picks" on public.plan_saved_picks;
create policy "Participants read saved plan picks" on public.plan_saved_picks for select using (
  exists (select 1 from public.connections c where c.id = plan_saved_picks.connection_id
          and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())));

-- A draft is private: only its owner reads it.
drop policy if exists "Participants read plan picks" on public.plan_picks;
drop policy if exists "Own plan picks" on public.plan_picks;
create policy "Own plan picks" on public.plan_picks for select using (user_id = auth.uid());

-- An idea someone added stays private until it is in someone's saved picks.
drop policy if exists "Participants read plan ideas" on public.plan_ideas;
create policy "Participants read plan ideas" on public.plan_ideas for select using (
  exists (select 1 from public.connections c where c.id = plan_ideas.connection_id
          and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid()))
  and (plan_ideas.source <> 'own' or plan_ideas.added_by = auth.uid()
       or exists (select 1 from public.plan_saved_picks s where s.idea_id = plan_ideas.id)));

do $$
declare
  t text;
begin
  foreach t in array array['plan_saves', 'plan_saved_picks'] loop
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
       and not exists (
         select 1 from pg_publication_tables
         where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
       ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Cards already open: marks made before this update count as saved, so
-- nobody loses what they already picked.
insert into public.plan_saves (board_id, user_id, connection_id, saved_at)
select k.board_id, k.user_id, k.connection_id, max(k.created_at)
from public.plan_picks k join public.plan_boards b on b.id = k.board_id
where b.status = 'open'
group by k.board_id, k.user_id, k.connection_id
on conflict do nothing;

insert into public.plan_saved_picks (board_id, user_id, idea_id, connection_id)
select k.board_id, k.user_id, k.idea_id, k.connection_id
from public.plan_picks k join public.plan_boards b on b.id = k.board_id
where b.status = 'open'
on conflict do nothing;

-- ---------------------------------------------------------------------
-- B. Helpers
-- ---------------------------------------------------------------------

-- Ideas in both people's saved picks.
create or replace function public._plan_shared_count(p_board_id uuid)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $$
  select count(*)::integer from (
    select idea_id from public.plan_saved_picks where board_id = p_board_id
    group by idea_id having count(*) >= 2
  ) s;
$$;

-- ---------------------------------------------------------------------
-- C. Draft marks, saving, choosing
-- ---------------------------------------------------------------------

-- Marks or unmarks an idea in the caller's draft. Returns true if marked.
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
  -- Someone else's added idea can only be marked once they saved it.
  if v_idea.source = 'own' and v_idea.added_by is distinct from auth.uid()
     and not exists (select 1 from public.plan_saved_picks where idea_id = p_idea_id) then
    raise exception 'plan_not_found';
  end if;
  if exists (select 1 from public.plan_picks where idea_id = p_idea_id and user_id = auth.uid()) then
    delete from public.plan_picks where idea_id = p_idea_id and user_id = auth.uid();
    return false;
  end if;
  insert into public.plan_picks (idea_id, user_id, board_id, connection_id)
  values (p_idea_id, auth.uid(), v_board.id, v_board.connection_id);
  return true;
end;
$$;

grant execute on function public.plan_toggle_pick(uuid) to authenticated;

-- Saves the caller's draft. The other person sees these picks from now on.
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

  insert into public.plan_saves (board_id, user_id, connection_id, saved_at)
  values (v_board.id, auth.uid(), v_board.connection_id, clock_timestamp())
  on conflict (board_id, user_id) do update set saved_at = clock_timestamp();

  -- A chosen idea that is no longer in both people's picks is let go.
  if v_board.chosen_idea_id is not null
     and (select count(*) from public.plan_saved_picks where idea_id = v_board.chosen_idea_id) < 2 then
    update public.plan_boards set chosen_idea_id = null, chosen_day = null, chosen_part = null where id = v_board.id;
  end if;

  v_other_saved := exists (select 1 from public.plan_saves where board_id = v_board.id and user_id = v_other);
  v_shared := public._plan_shared_count(v_board.id);
  if v_other_saved and v_shared = 0 then
    update public.plan_boards set no_match_rounds = no_match_rounds + 1 where id = v_board.id;
  end if;

  perform public._plan_touch(v_board.id);
  return jsonb_build_object('other_saved', v_other_saved, 'shared', v_shared);
end;
$$;

grant execute on function public.plan_save_picks(uuid) to authenticated;

-- Puts the draft back to what was last saved ("Cancel" while editing).
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
end;
$$;

grant execute on function public.plan_revert_picks(uuid) to authenticated;

-- Goes ahead with an idea in both people's saved picks. Either person can.
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
  if (select count(*) from public.plan_saved_picks where idea_id = p_idea_id) < 2 then
    raise exception 'not_both_picked';
  end if;
  update public.plan_boards set chosen_idea_id = p_idea_id where id = v_board.id;
  perform public._plan_touch(v_board.id);
end;
$$;

grant execute on function public.plan_choose_idea(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- D. Reading the card
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
  v_other_times jsonb;
  v_prefs jsonb;
  v_home jsonb;
  v_my_saved timestamptz;
  v_other_saved timestamptz;
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
      -- The other person's added ideas only once they saved them.
      and (i.source <> 'own' or i.added_by = v_caller
           or exists (select 1 from public.plan_saved_picks s where s.idea_id = i.id))
      and (not i.retired
           or exists (select 1 from public.plan_picks k where k.idea_id = i.id and k.user_id = v_caller)
           or exists (select 1 from public.plan_saved_picks s where s.idea_id = i.id));

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
      'my_saved_at', v_my_saved,
      'other_saved_at', v_other_saved,
      'no_match_rounds', v_board.no_match_rounds,
      'ideas', v_ideas,
      'my_times', v_my_times,
      'other_times', v_other_times
    ) else null end
  );
end;
$$;

grant execute on function public.get_plan_board(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- E. New ideas keep everyone's drafts and saved picks
-- ---------------------------------------------------------------------

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
    -- Ideas nobody marked or saved make room for the new ones.
    update public.plan_ideas i set retired = true
    where i.board_id = v_board.id and i.source <> 'own'
      and not exists (select 1 from public.plan_picks k where k.idea_id = i.id)
      and not exists (select 1 from public.plan_saved_picks s where s.idea_id = i.id);
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
         case when (e->>'home_of') is not null and (e->>'home_of')::uuid = any (v_hosts) then (e->>'home_of')::uuid end
  from jsonb_array_elements(coalesce(p_ideas, '[]'::jsonb)) e
  where e->>'slot' in ('easy', 'both_like', 'new')
    and char_length(btrim(coalesce(e->>'title', ''))) between 1 and 80
    and ((e->>'home_of') is null or (e->>'home_of')::uuid = any (v_hosts));
  get diagnostics v_count = row_count;

  update public.plan_boards set last_activity_at = now() where id = v_board.id;
  return v_count;
end;
$$;

revoke execute on function public.save_plan_ideas(uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.save_plan_ideas(uuid, uuid, jsonb, text) to service_role;

-- ---------------------------------------------------------------------
-- F. Talking in the chat keeps the card open
-- ---------------------------------------------------------------------

create or replace function public.touch_plan_board_on_message()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  update public.plan_boards
  set last_activity_at = greatest(last_activity_at, new.created_at)
  where connection_id = new.connection_id and status = 'open';
  return new;
end;
$$;

drop trigger if exists messages_touch_plan_board on public.messages;
create trigger messages_touch_plan_board
  after insert on public.messages
  for each row execute function public.touch_plan_board_on_message();

-- ---------------------------------------------------------------------
-- G. Inbox: whose turn it is
-- ---------------------------------------------------------------------
-- stage: pick (save your picks), waiting (for the other person to pick),
--        matched (talk it over, then choose), no_match, times.

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
  v_shared integer;
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
    if r.chosen_idea_id is not null then
      stage := 'times';
      waiting_on_me := not exists (select 1 from public.plan_times t where t.board_id = r.id and t.user_id = auth.uid());
    elsif v_mine is null then
      stage := 'pick';
      waiting_on_me := true;
    elsif v_theirs is null then
      stage := 'waiting';
      waiting_on_me := false;
    else
      v_shared := public._plan_shared_count(r.id);
      if v_shared > 0 then
        stage := 'matched';
        -- The person who saved second is asked to suggest one.
        waiting_on_me := v_mine > v_theirs;
      else
        stage := 'no_match';
        waiting_on_me := v_mine < v_theirs;
      end if;
    end if;
    return next;
    v_mine := null;
    v_theirs := null;
  end loop;
end;
$$;

grant execute on function public.my_plan_turns() to authenticated;

create or replace function public.limen_db_version()
returns text
language sql
immutable
as $$ select '20261009000005'::text $$;

grant execute on function public.limen_db_version() to anon, authenticated;

notify pgrst, 'reload schema';
