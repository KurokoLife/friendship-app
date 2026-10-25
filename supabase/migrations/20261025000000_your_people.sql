-- 2026-10-25: Rebuild stage 1, "Your people" (docs/context/05_LIMEN_REBUILD.md).
-- Safe to run twice. limen_db_version() -> 20261025000000.
--
-- Your people is the new home tab. It shows four circles: Close, Friends,
-- Getting to know, Want to reconnect.
--   * Limen people are placed on their own (my_people):
--       an open or paused chat        -> Getting to know
--       someone you said Interested to -> Getting to know ("waiting to connect")
--       a graduated chat              -> Friends
--     Ended, closed, passed and blocked people never appear.
--   * Anyone can be moved by hand (people_circle_choices, private per
--     person). A hand move holds until Limen's own placement changes (for
--     example the chat graduates); then the person moves on their own again.
--   * Friends from outside Limen (outside_friends): name, circle, how often
--     you'd like to be in touch, an optional note. No phone or email.
-- Both tables are private: own rows only. Nobody else can ever read them.

-- 1. Hand moves for Limen people -----------------------------------------
create table if not exists public.people_circle_choices (
  user_id uuid not null references auth.users(id) on delete cascade,
  other_user_id uuid not null references auth.users(id) on delete cascade,
  circle text not null check (circle in ('close', 'friends', 'getting_to_know', 'reconnect')),
  -- Where Limen had placed them when they were moved. When that changes,
  -- the hand move no longer applies.
  auto_circle text not null check (auto_circle in ('close', 'friends', 'getting_to_know', 'reconnect')),
  updated_at timestamptz not null default now(),
  primary key (user_id, other_user_id)
);

alter table public.people_circle_choices enable row level security;

drop policy if exists "Own circle choices: select" on public.people_circle_choices;
create policy "Own circle choices: select" on public.people_circle_choices
  for select using (auth.uid() = user_id);
drop policy if exists "Own circle choices: insert" on public.people_circle_choices;
create policy "Own circle choices: insert" on public.people_circle_choices
  for insert with check (auth.uid() = user_id);
drop policy if exists "Own circle choices: update" on public.people_circle_choices;
create policy "Own circle choices: update" on public.people_circle_choices
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Own circle choices: delete" on public.people_circle_choices;
create policy "Own circle choices: delete" on public.people_circle_choices
  for delete using (auth.uid() = user_id);

grant select, insert, update, delete on public.people_circle_choices to authenticated;

-- 2. Friends from outside Limen ------------------------------------------
-- Rhythm choices that fit each circle (05_LIMEN_REBUILD.md, Your people):
--   Getting to know: few_days / week / two_weeks
--   Close:           week / two_weeks / month
--   Friends:         two_weeks / month / few_months
--   Want to reconnect: any of them, a few times a year, or none (no suggestions)
create or replace function public.rhythm_fits_circle(p_circle text, p_rhythm text)
returns boolean
language sql
immutable
as $$
  select case p_circle
    when 'getting_to_know' then p_rhythm in ('few_days', 'week', 'two_weeks')
    when 'close' then p_rhythm in ('week', 'two_weeks', 'month')
    when 'friends' then p_rhythm in ('two_weeks', 'month', 'few_months')
    when 'reconnect' then p_rhythm in ('few_days', 'week', 'two_weeks', 'month', 'few_months', 'few_times_year', 'none')
    else false
  end;
$$;

create table if not exists public.outside_friends (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  circle text not null check (circle in ('close', 'friends', 'getting_to_know', 'reconnect')),
  rhythm text not null,
  note text check (note is null or char_length(note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.outside_friends drop constraint if exists outside_friends_rhythm_fits_circle;
alter table public.outside_friends add constraint outside_friends_rhythm_fits_circle
  check (public.rhythm_fits_circle(circle, rhythm));

create index if not exists outside_friends_user_idx on public.outside_friends (user_id);

alter table public.outside_friends enable row level security;

drop policy if exists "Own outside friends: select" on public.outside_friends;
create policy "Own outside friends: select" on public.outside_friends
  for select using (auth.uid() = user_id);
drop policy if exists "Own outside friends: insert" on public.outside_friends;
create policy "Own outside friends: insert" on public.outside_friends
  for insert with check (auth.uid() = user_id);
drop policy if exists "Own outside friends: update" on public.outside_friends;
create policy "Own outside friends: update" on public.outside_friends
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Own outside friends: delete" on public.outside_friends;
create policy "Own outside friends: delete" on public.outside_friends
  for delete using (auth.uid() = user_id);

grant select, insert, update, delete on public.outside_friends to authenticated;

create or replace function public._outside_friends_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists outside_friends_touch on public.outside_friends;
create trigger outside_friends_touch before update on public.outside_friends
  for each row execute function public._outside_friends_touch();

-- 3. Limen people, placed on their own -----------------------------------
-- Where Limen places each person, before any hand move. Caller's own list.
create or replace function public._my_people_auto()
returns table (other_user_id uuid, connection_id uuid, display_name text, state text, auto_circle text)
language sql
stable
security definer
set search_path to 'public'
as $$
  with chats as (
    select distinct on (o.other)
      o.other,
      c.id as connection_id,
      case when c.status = 'graduated' then 'friend'
           when c.status = 'paused' then 'paused'
           else 'chat' end as state
    from public.connections c
    cross join lateral (
      select case when c.user_a_id = auth.uid() then c.user_b_id else c.user_a_id end as other
    ) o
    where auth.uid() is not null
      and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
      and (
        c.status in ('pending', 'active', 'paused', 'graduated')
        or (
          coalesce(c.status, '') not in ('blocked', 'ended', 'inactive', 'passed')
          and exists (select 1 from public.messages m where m.connection_id = c.id)
        )
      )
    order by o.other, (c.status = 'graduated') desc, c.created_at desc
  ),
  waiting as (
    select p.other_user_id as other, null::uuid as connection_id, 'waiting'::text as state
    from public.my_pending() p
    where p.state <> 'closed'
      and not exists (select 1 from chats where chats.other = p.other_user_id)
  ),
  everyone as (
    select * from chats
    union all
    select * from waiting
  )
  select e.other, e.connection_id, pr.display_name, e.state,
         case when e.state = 'friend' then 'friends' else 'getting_to_know' end
  from everyone e
  join public.profiles pr on pr.user_id = e.other
  where not exists (
    select 1 from public.blocks b
    where (b.blocker_id = auth.uid() and b.blocked_id = e.other)
       or (b.blocker_id = e.other and b.blocked_id = auth.uid())
  );
$$;
revoke execute on function public._my_people_auto() from public, anon, authenticated;

-- The caller's Limen people with the circle they're in now.
create or replace function public.my_people()
returns table (other_user_id uuid, connection_id uuid, display_name text, state text, auto_circle text, circle text, moved boolean)
language sql
stable
security definer
set search_path to 'public'
as $$
  select a.other_user_id, a.connection_id, a.display_name, a.state, a.auto_circle,
         case when ch.auto_circle = a.auto_circle then ch.circle else a.auto_circle end,
         coalesce(ch.auto_circle = a.auto_circle and ch.circle <> a.auto_circle, false)
  from public._my_people_auto() a
  left join public.people_circle_choices ch
    on ch.user_id = auth.uid() and ch.other_user_id = a.other_user_id
  order by a.display_name;
$$;
grant execute on function public.my_people() to authenticated;

-- Move a Limen person to another circle (only someone on your own list).
-- Moving them back to where Limen placed them clears the hand move.
create or replace function public.set_person_circle(p_other_user_id uuid, p_circle text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_auto text;
begin
  if auth.uid() is null then return 'not_signed_in'; end if;
  if p_circle not in ('close', 'friends', 'getting_to_know', 'reconnect') then return 'bad_circle'; end if;
  select a.auto_circle into v_auto from public._my_people_auto() a where a.other_user_id = p_other_user_id;
  if v_auto is null then return 'not_in_list'; end if;
  if p_circle = v_auto then
    delete from public.people_circle_choices where user_id = auth.uid() and other_user_id = p_other_user_id;
  else
    insert into public.people_circle_choices (user_id, other_user_id, circle, auto_circle)
    values (auth.uid(), p_other_user_id, p_circle, v_auto)
    on conflict (user_id, other_user_id) do update
      set circle = excluded.circle, auto_circle = excluded.auto_circle, updated_at = now();
  end if;
  return 'ok';
end;
$$;
grant execute on function public.set_person_circle(uuid, text) to authenticated;

-- 4. Tips: allow the new "Your people" tip --------------------------------
alter table public.coach_marks_seen drop constraint if exists coach_marks_seen_mark_key_check;
alter table public.coach_marks_seen add constraint coach_marks_seen_mark_key_check check (mark_key in (
  'tab_discover', 'tab_browse', 'tab_saved', 'tab_inbox', 'no_ghost_prompt', 'meetup_checkin',
  'tab_remember', 'tab_profile', 'credits_premium',
  'video_show_up', 'video_first_meetup', 'video_friendship_grows', 'video_restart',
  'video_something_off', 'video_ending',
  'inbox_pending', 'settings_intro', 'guide_intro', 'chat_actions', 'chat_bars', 'profile_view',
  'tab_people'
));

-- The Chats tip reads differently now (no Pending or Friends tabs); show it once more.
delete from public.coach_marks_seen where mark_key = 'tab_inbox';

-- 5. Test tab: "Reset all test accounts" also clears Your people ---------
create or replace function public.test_reset_all_test_accounts()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_result jsonb;
  v_interests integer;
  v_prefs integer;
  v_settings integer;
  v_curiosity integer;
  v_ghosting integer;
  v_asks integer;
  v_outside integer;
  v_moves integer;
begin
  if not public.is_test_operator() then raise exception 'Test tools are only for admins and test accounts'; end if;
  v_result := public.dev_reset_all_seed_matches();
  delete from public.interests
  where public._is_seed_account(from_user_id) or public._is_seed_account(to_user_id);
  get diagnostics v_interests = row_count;
  delete from public.plan_prefs where public._is_seed_account(user_id);
  get diagnostics v_prefs = row_count;
  delete from public.prompt_settings where public._is_seed_account(user_id);
  get diagnostics v_settings = row_count;
  delete from public.curiosity_notes where public._is_seed_account(user_id);
  get diagnostics v_curiosity = row_count;
  delete from public.ghosting_events where public._is_seed_account(user_id);
  get diagnostics v_ghosting = row_count;
  delete from public.remember_asks where public._is_seed_account(user_id);
  get diagnostics v_asks = row_count;
  -- 2026-10-25: friends added in Your people, and hand moves.
  delete from public.outside_friends where public._is_seed_account(user_id);
  get diagnostics v_outside = row_count;
  delete from public.people_circle_choices where public._is_seed_account(user_id);
  get diagnostics v_moves = row_count;
  -- 2026-10-14: and end any break from Discover.
  update public.users set paused_until = null where public._is_seed_account(id) and paused_until is not null;
  return v_result || jsonb_build_object(
    'interests_deleted', v_interests,
    'plan_limits_deleted', v_prefs,
    'reminder_settings_deleted', v_settings,
    'curiosity_notes_deleted', v_curiosity,
    'ghosting_history_deleted', v_ghosting,
    'notes_asks_deleted', v_asks,
    'outside_friends_deleted', v_outside,
    'circle_moves_deleted', v_moves);
end;
$$;
grant execute on function public.test_reset_all_test_accounts() to authenticated;

create or replace function public.limen_db_version()
returns text
language sql
stable
as $function$ select '20261025000000'::text $function$;
grant execute on function public.limen_db_version() to anon, authenticated;
