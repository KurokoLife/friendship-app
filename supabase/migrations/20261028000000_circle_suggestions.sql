-- 2026-10-28: Rebuild stage 3, Suggestions (docs/context/05_LIMEN_REBUILD.md,
-- "Your circle (decided)", "Suggestions (decided)"). Safe to run twice.
-- limen_db_version() -> 20261028000000.
--
--   1. One suggestion at a time at the top of Your circle, for friends added
--      outside Limen AND Limen people. Who is due uses the stage 1c rule
--      (circle_next_check_in: the last time you were in touch, or the day
--      they were added, plus the rhythm). Nothing new decides the date.
--   2. How often suggestions come: a couple of times a week / once a week
--      (default) / every two weeks / off (circle_suggestion_settings).
--   3. On the card: I reached out (the next date counts from now), Not now
--      (that person comes back in about a week), Fewer suggestions for this
--      person (their rhythm moves one step slower within their circle).
--   4. Pattern noticing: after 3 Not nows within 4 weeks, one optional
--      question "What usually gets in the way?" (at most once in 60 days).
--      Answers are private and show back on the You tab.
--   5. A phone contact can be linked to a friend outside Limen: only the
--      contact's id on that phone is kept, never a number or an email.
--   6. The chat's own "It's been quiet" check-in is retired.

-- 1. Fields and tables ---------------------------------------------------------
-- The id of the linked contact in the phone's own address book. Limen never
-- stores the number or email; the phone app looks them up when you tap
-- Text, Call or Email.
alter table public.outside_friends add column if not exists contact_id text;
alter table public.outside_friends drop constraint if exists outside_friends_contact_id_length;
alter table public.outside_friends add constraint outside_friends_contact_id_length
  check (contact_id is null or char_length(contact_id) <= 200);

-- A Limen person's rhythm (set by "Fewer suggestions") and the last time you
-- said you reached out outside the chat. Private to the person who set it.
create table if not exists public.limen_person_settings (
  user_id uuid not null references public.users(id) on delete cascade,
  other_user_id uuid not null references public.users(id) on delete cascade,
  rhythm text,
  last_reached_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, other_user_id)
);
alter table public.limen_person_settings drop constraint if exists limen_person_settings_rhythm;
alter table public.limen_person_settings add constraint limen_person_settings_rhythm check (
  rhythm is null or rhythm in ('few_days', 'week', 'two_weeks', 'month', 'few_months', 'few_times_year', 'none'));
alter table public.limen_person_settings enable row level security;
drop policy if exists "Limen person settings: own read" on public.limen_person_settings;
create policy "Limen person settings: own read" on public.limen_person_settings
  for select to authenticated using (user_id = auth.uid());
revoke all on public.limen_person_settings from anon;
grant select on public.limen_person_settings to authenticated;

create table if not exists public.circle_suggestion_settings (
  user_id uuid primary key references public.users(id) on delete cascade,
  frequency text not null default 'week',
  updated_at timestamptz not null default now()
);
alter table public.circle_suggestion_settings drop constraint if exists circle_suggestion_settings_frequency;
alter table public.circle_suggestion_settings add constraint circle_suggestion_settings_frequency
  check (frequency in ('twice_week', 'week', 'two_weeks', 'off'));
alter table public.circle_suggestion_settings enable row level security;
drop policy if exists "Suggestion settings: own read" on public.circle_suggestion_settings;
create policy "Suggestion settings: own read" on public.circle_suggestion_settings
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "Suggestion settings: own add" on public.circle_suggestion_settings;
create policy "Suggestion settings: own add" on public.circle_suggestion_settings
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "Suggestion settings: own change" on public.circle_suggestion_settings;
create policy "Suggestion settings: own change" on public.circle_suggestion_settings
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.circle_suggestion_settings from anon;
grant select, insert, update on public.circle_suggestion_settings to authenticated;

-- Every suggestion shown, and what the person did with it.
--   person_kind: outside (a friend added outside Limen), limen, pattern (the
--   "what gets in the way" question).
--   kind: in_touch, interest, positivity, support, openness, time_together, pattern.
--   outcome: reached, not_now, fewer, gone (the person left Your circle),
--   answered / skipped (the pattern question).
create table if not exists public.circle_suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  person_kind text not null,
  person_id uuid,
  kind text not null,
  detail text,
  shown_at timestamptz not null default now(),
  resolved_at timestamptz,
  outcome text
);
alter table public.circle_suggestions drop constraint if exists circle_suggestions_person_kind;
alter table public.circle_suggestions add constraint circle_suggestions_person_kind
  check (person_kind in ('outside', 'limen', 'pattern'));
alter table public.circle_suggestions drop constraint if exists circle_suggestions_kind;
alter table public.circle_suggestions add constraint circle_suggestions_kind
  check (kind in ('in_touch', 'interest', 'positivity', 'support', 'openness', 'time_together', 'pattern'));
alter table public.circle_suggestions drop constraint if exists circle_suggestions_outcome;
alter table public.circle_suggestions add constraint circle_suggestions_outcome
  check (outcome is null or outcome in ('reached', 'not_now', 'fewer', 'gone', 'answered', 'skipped'));
create index if not exists circle_suggestions_user_idx on public.circle_suggestions (user_id, shown_at desc);
create unique index if not exists circle_suggestions_one_open on public.circle_suggestions (user_id) where resolved_at is null;
alter table public.circle_suggestions enable row level security;
drop policy if exists "Circle suggestions: own read" on public.circle_suggestions;
create policy "Circle suggestions: own read" on public.circle_suggestions
  for select to authenticated using (user_id = auth.uid());
revoke all on public.circle_suggestions from anon;
grant select on public.circle_suggestions to authenticated;

-- "What usually gets in the way?" answers. Private, shown back on You.
create table if not exists public.circle_pattern_answers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  answer text not null,
  created_at timestamptz not null default now()
);
alter table public.circle_pattern_answers drop constraint if exists circle_pattern_answers_answer;
alter table public.circle_pattern_answers add constraint circle_pattern_answers_answer
  check (answer in ('busy', 'what_to_say', 'awkward', 'different', 'other'));
alter table public.circle_pattern_answers enable row level security;
drop policy if exists "Pattern answers: own read" on public.circle_pattern_answers;
create policy "Pattern answers: own read" on public.circle_pattern_answers
  for select to authenticated using (user_id = auth.uid());
revoke all on public.circle_pattern_answers from anon;
grant select on public.circle_pattern_answers to authenticated;

-- 2. Helpers --------------------------------------------------------------------
-- Default rhythm per circle (keep in step with DEFAULT_RHYTHM in src/lib/circle.ts).
create or replace function public.circle_default_rhythm(p_circle text)
returns text
language sql
immutable
as $$
  select case p_circle
    when 'getting_to_know' then 'week'
    when 'close' then 'week'
    when 'friends' then 'month'
    when 'reconnect' then 'few_times_year'
    else 'month'
  end;
$$;

-- The next slower rhythm that still fits the circle, or null if there's none.
create or replace function public.circle_slower_rhythm(p_circle text, p_rhythm text)
returns text
language sql
immutable
as $$
  select r from unnest(array['few_days', 'week', 'two_weeks', 'month', 'few_months', 'few_times_year', 'none'])
    with ordinality as t(r, i)
  where i > coalesce((select i2 from unnest(array['few_days', 'week', 'two_weeks', 'month', 'few_months', 'few_times_year', 'none'])
                        with ordinality as t2(r2, i2) where r2 = p_rhythm), 0)
    and public.rhythm_fits_circle(p_circle, r)
  order by i
  limit 1;
$$;

-- Limen people who can be suggested to the caller: an open (or graduated)
-- chat where both have written (a chat where only one wrote has its own
-- getting-started note), not paused, no plan coming up, not turned
-- off for that chat. Their circle comes from my_people() (hand moves count).
-- last_in_touch is timing only: the newest message either way, a counted
-- meetup, the end of a pause, or "I reached out". The app never reads
-- messages.
create or replace function public._circle_limen_people(p_tz text)
returns table (other_user_id uuid, connection_id uuid, display_name text, photo_url text, circle text,
               rhythm text, next_day date, has_met boolean)
language sql
stable
security definer
set search_path to 'public'
as $$
  with people as (
    select mp.other_user_id, mp.connection_id, mp.display_name, mp.photo_url, mp.circle
    from public.my_people() mp
    join public.connections c on c.id = mp.connection_id
    where mp.connection_id is not null
      and c.status in ('pending', 'active', 'graduated')
      and public._both_have_written(c.id)
      and not public._plan_has_upcoming(c.id)
      and public.prompt_enabled(auth.uid(), c.id, 'check_in')
  ),
  timing as (
    select p.*,
      coalesce(
        (select s.rhythm from public.limen_person_settings s
          where s.user_id = auth.uid() and s.other_user_id = p.other_user_id
            and s.rhythm is not null and public.rhythm_fits_circle(p.circle, s.rhythm)),
        public.circle_default_rhythm(p.circle)) as rhythm,
      greatest(
        (select max(m.created_at) from public.messages m where m.connection_id = p.connection_id),
        (select c.resumed_at from public.connections c where c.id = p.connection_id),
        (select max(coalesce(mt.occurred_date, mt.confirmed_date)::timestamptz) from public.meetups mt
          where mt.connection_id = p.connection_id and mt.status = 'occurred'),
        (select s.last_reached_at from public.limen_person_settings s
          where s.user_id = auth.uid() and s.other_user_id = p.other_user_id)
      ) as last_in_touch,
      exists (select 1 from public.meetups mt where mt.connection_id = p.connection_id and mt.status = 'occurred') as has_met
    from people p
  )
  select t.other_user_id, t.connection_id, t.display_name, t.photo_url, t.circle, t.rhythm,
         public.circle_next_check_in((t.last_in_touch at time zone coalesce(nullif(p_tz, ''), 'UTC'))::date, t.rhythm),
         t.has_met
  from timing t
  where t.last_in_touch is not null;
$$;
revoke all on function public._circle_limen_people(text) from public, anon, authenticated;

-- Shapes one suggestion row for the app (names, faces, contact link).
create or replace function public._circle_suggestion_json(p_row public.circle_suggestions, p_tz text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_out jsonb := jsonb_build_object('id', p_row.id, 'person_kind', p_row.person_kind, 'person_id', p_row.person_id,
                                    'kind', p_row.kind, 'detail', p_row.detail);
  f public.outside_friends%rowtype;
  l record;
begin
  if p_row.person_kind = 'outside' then
    select * into f from public.outside_friends where id = p_row.person_id and user_id = auth.uid();
    if not found then return null; end if;
    return v_out || jsonb_build_object('name', f.name, 'circle', f.circle, 'rhythm', f.rhythm,
                                       'photo_path', f.photo_path, 'contact_id', f.contact_id);
  elsif p_row.person_kind = 'limen' then
    select * into l from public.my_people() mp where mp.other_user_id = p_row.person_id;
    if not found then return null; end if;
    return v_out || jsonb_build_object('name', l.display_name, 'circle', l.circle, 'photo_url', l.photo_url,
                                       'connection_id', l.connection_id);
  end if;
  return v_out;
end;
$$;
revoke all on function public._circle_suggestion_json(public.circle_suggestions, text) from public, anon, authenticated;

-- 3. The suggestion --------------------------------------------------------------
-- Returns the caller's current suggestion, starting a new one when it's time:
-- nothing open, the chosen gap since the last one has passed, and someone is
-- due (their next check-in day has come). The most overdue person goes first.
create or replace function public.get_circle_suggestion(p_tz text default 'UTC')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_me uuid := auth.uid();
  v_tz text := coalesce(nullif(p_tz, ''), 'UTC');
  v_today date;
  v_freq text;
  v_gap interval;
  v_open public.circle_suggestions%rowtype;
  v_last timestamptz;
  v_json jsonb;
  v_pick record;
  v_kind text;
  v_detail text;
  v_turn integer;
  v_rotation text[];
  v_row public.circle_suggestions%rowtype;
begin
  if v_me is null then return null; end if;
  begin
    v_today := (now() at time zone v_tz)::date;
  exception when others then
    v_tz := 'UTC';
    v_today := (now() at time zone 'UTC')::date;
  end;

  select frequency into v_freq from public.circle_suggestion_settings where user_id = v_me;
  v_freq := coalesce(v_freq, 'week');
  if v_freq = 'off' then return null; end if;
  v_gap := case v_freq when 'twice_week' then interval '3 days' when 'two_weeks' then interval '14 days' else interval '7 days' end;

  -- An open suggestion stays until the person acts on it, unless that person
  -- has left Your circle (gone, doesn't count) or you've been in touch since
  -- (counts as reached).
  select * into v_open from public.circle_suggestions where user_id = v_me and resolved_at is null;
  if found then
    v_json := public._circle_suggestion_json(v_open, v_tz);
    if v_json is null then
      update public.circle_suggestions set resolved_at = now(), outcome = 'gone' where id = v_open.id;
    elsif v_open.person_kind = 'pattern' then
      return v_json;
    elsif (v_open.person_kind = 'outside' and coalesce(public.outside_friend_next_check_in(v_open.person_id, v_tz), v_today + 1) > v_today)
       or (v_open.person_kind = 'limen' and coalesce((select next_day from public._circle_limen_people(v_tz) lp where lp.other_user_id = v_open.person_id), v_today + 1) > v_today) then
      update public.circle_suggestions set resolved_at = now(), outcome = 'reached' where id = v_open.id;
      return null;
    else
      return v_json;
    end if;
  end if;

  select max(shown_at) into v_last from public.circle_suggestions
  where user_id = v_me and coalesce(outcome, '') <> 'gone';
  if v_last is not null and now() < v_last + v_gap then return null; end if;

  -- Pattern noticing: 3 Not nows within 4 weeks, asked at most once in 60 days.
  if (select count(*) from public.circle_suggestions
      where user_id = v_me and outcome = 'not_now' and resolved_at > now() - interval '28 days') >= 3
     and not exists (select 1 from public.circle_suggestions
                     where user_id = v_me and person_kind = 'pattern' and shown_at > now() - interval '60 days') then
    insert into public.circle_suggestions (user_id, person_kind, kind) values (v_me, 'pattern', 'pattern')
    returning * into v_row;
    return public._circle_suggestion_json(v_row, v_tz);
  end if;

  -- Who's due. "Not now" keeps a person back for about a week.
  select * into v_pick from (
    select 'outside'::text as person_kind, f.id as person_id, f.name as name,
           public.outside_friend_next_check_in(f.id, v_tz) as next_day, false as is_limen, null::uuid as connection_id, true as has_met
    from public.outside_friends f
    where f.user_id = v_me and f.rhythm <> 'none'
    union all
    select 'limen', lp.other_user_id, lp.display_name, lp.next_day, true, lp.connection_id, lp.has_met
    from public._circle_limen_people(v_tz) lp
    where lp.rhythm <> 'none'
  ) d
  where d.next_day is not null and d.next_day <= v_today
    and not exists (select 1 from public.circle_suggestions s
                    where s.user_id = v_me and s.person_id = d.person_id and s.outcome = 'not_now'
                      and s.resolved_at > now() - interval '7 days')
  order by d.next_day, d.name
  limit 1;
  if not found then return null; end if;

  -- What to bring up. From your own notes first (Limen people only), then
  -- taking turns through the rest.
  v_kind := null;
  v_detail := null;
  if v_pick.is_limen then
    select e.ask_next into v_detail from public.remember_entries e
    where e.user_id = v_me and e.connection_id = v_pick.connection_id
      and nullif(trim(e.ask_next), '') is not null and e.ask_next_done_at is null
    order by coalesce(e.updated_at, e.created_at) desc limit 1;
    if v_detail is not null then
      v_kind := 'interest';
    else
      select left(split_part(trim(e.raw_text), E'\n', 1), 80) into v_detail from public.remember_entries e
      where e.user_id = v_me and e.connection_id = v_pick.connection_id
        and e.topics @> array['going_through'] and nullif(trim(e.raw_text), '') is not null
        and e.created_at > now() - interval '90 days'
      order by e.created_at desc limit 1;
      if v_detail is not null then v_kind := 'support'; end if;
    end if;
  end if;
  if v_kind is null then
    v_rotation := case when v_pick.has_met
      then array['in_touch', 'positivity', 'openness', 'time_together']
      else array['in_touch', 'positivity', 'openness'] end;
    select count(*) into v_turn from public.circle_suggestions where user_id = v_me and person_kind <> 'pattern';
    v_kind := v_rotation[(v_turn % array_length(v_rotation, 1)) + 1];
  end if;

  insert into public.circle_suggestions (user_id, person_kind, person_id, kind, detail)
  values (v_me, v_pick.person_kind, v_pick.person_id, v_kind, v_detail)
  returning * into v_row;
  return public._circle_suggestion_json(v_row, v_tz);
end;
$$;
grant execute on function public.get_circle_suggestion(text) to authenticated;

-- What the person did with the card: reached (I reached out, or Yes after
-- Text / Call), not_now, fewer. Returns what the app needs for its one line.
create or replace function public.resolve_circle_suggestion(p_id uuid, p_outcome text, p_tz text default 'UTC')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_me uuid := auth.uid();
  v_row public.circle_suggestions%rowtype;
  v_circle text;
  v_rhythm text;
  v_slower text;
  v_next date;
begin
  if v_me is null then raise exception 'Not authenticated'; end if;
  if p_outcome not in ('reached', 'not_now', 'fewer') then raise exception 'bad_outcome'; end if;
  select * into v_row from public.circle_suggestions where id = p_id and user_id = v_me and resolved_at is null;
  if not found or v_row.person_kind = 'pattern' then return jsonb_build_object('status', 'not_open'); end if;

  update public.circle_suggestions set resolved_at = now(), outcome = p_outcome where id = p_id;

  if p_outcome = 'reached' then
    if v_row.person_kind = 'outside' then
      update public.outside_friends set last_reached_at = now() where id = v_row.person_id and user_id = v_me;
      v_next := public.outside_friend_next_check_in(v_row.person_id, p_tz);
    else
      insert into public.limen_person_settings (user_id, other_user_id, last_reached_at)
      values (v_me, v_row.person_id, now())
      on conflict (user_id, other_user_id) do update set last_reached_at = now(), updated_at = now();
      select next_day into v_next from public._circle_limen_people(p_tz) where other_user_id = v_row.person_id;
    end if;
    return jsonb_build_object('status', 'reached', 'next_day', v_next);
  end if;

  if p_outcome = 'fewer' then
    if v_row.person_kind = 'outside' then
      select circle, rhythm into v_circle, v_rhythm from public.outside_friends where id = v_row.person_id and user_id = v_me;
    else
      select lp.circle, lp.rhythm into v_circle, v_rhythm from public._circle_limen_people(p_tz) lp where lp.other_user_id = v_row.person_id;
      if v_circle is null then
        select mp.circle into v_circle from public.my_people() mp where mp.other_user_id = v_row.person_id;
        v_rhythm := coalesce((select rhythm from public.limen_person_settings where user_id = v_me and other_user_id = v_row.person_id),
                             public.circle_default_rhythm(v_circle));
      end if;
    end if;
    v_slower := public.circle_slower_rhythm(v_circle, v_rhythm);
    if v_slower is null then
      return jsonb_build_object('status', 'slowest', 'circle', v_circle, 'rhythm', v_rhythm);
    end if;
    if v_row.person_kind = 'outside' then
      update public.outside_friends set rhythm = v_slower where id = v_row.person_id and user_id = v_me;
    else
      insert into public.limen_person_settings (user_id, other_user_id, rhythm)
      values (v_me, v_row.person_id, v_slower)
      on conflict (user_id, other_user_id) do update set rhythm = v_slower, updated_at = now();
    end if;
    return jsonb_build_object('status', 'fewer', 'circle', v_circle, 'rhythm', v_slower);
  end if;

  return jsonb_build_object('status', 'not_now');
end;
$$;
grant execute on function public.resolve_circle_suggestion(uuid, text, text) to authenticated;

-- The pattern question: an answer (busy, what_to_say, awkward, different,
-- other) or null for Not now.
create or replace function public.answer_circle_pattern(p_id uuid, p_answer text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'Not authenticated'; end if;
  if not exists (select 1 from public.circle_suggestions
                 where id = p_id and user_id = v_me and person_kind = 'pattern' and resolved_at is null) then
    return 'not_open';
  end if;
  if p_answer is null then
    update public.circle_suggestions set resolved_at = now(), outcome = 'skipped' where id = p_id;
    return 'skipped';
  end if;
  if p_answer not in ('busy', 'what_to_say', 'awkward', 'different', 'other') then raise exception 'bad_answer'; end if;
  insert into public.circle_pattern_answers (user_id, answer) values (v_me, p_answer);
  update public.circle_suggestions set resolved_at = now(), outcome = 'answered', detail = p_answer where id = p_id;
  return 'answered';
end;
$$;
grant execute on function public.answer_circle_pattern(uuid, text) to authenticated;

-- 4. The chat's own "It's been quiet" check-in is retired ---------------------
-- Your circle suggestions cover Limen people now. Nothing new is raised and
-- any waiting check-in card is put away.
create or replace function public.run_conversation_restart_check_v2(p_connection_id uuid, p_now timestamptz default now())
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  return 'retired';
end;
$$;
update public.connection_interventions
set status = 'dismissed'
where intervention_type = 'conversation_restart_prompt' and status in ('pending', 'snoozed');

-- 5. Test tab: a suggestion now ------------------------------------------------
-- For the acting test account: forgets the gap since the last suggestion and
-- any Not now, and if nobody is due, makes the friend added first due today.
create or replace function public.test_circle_suggestion_now()
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_me uuid := auth.uid();
  v_friend uuid;
begin
  if not public.is_test_operator() then raise exception 'Test tools are only for admins and test accounts'; end if;
  update public.circle_suggestions set resolved_at = coalesce(resolved_at, now()) - interval '60 days',
                                       outcome = coalesce(outcome, 'gone'),
                                       shown_at = shown_at - interval '60 days'
  where user_id = v_me;
  insert into public.circle_suggestion_settings (user_id, frequency) values (v_me, 'week')
  on conflict (user_id) do update set frequency = case when circle_suggestion_settings.frequency = 'off' then 'week' else circle_suggestion_settings.frequency end;
  if not exists (
    select 1 from public.outside_friends f
    where f.user_id = v_me and f.rhythm <> 'none' and public.outside_friend_next_check_in(f.id, 'UTC') <= current_date
  ) then
    select id into v_friend from public.outside_friends where user_id = v_me and rhythm <> 'none' order by created_at limit 1;
    if v_friend is not null then
      update public.outside_friends set last_reached_at = now() - interval '1 year' where id = v_friend;
    end if;
  end if;
  return case when v_friend is null and not exists (select 1 from public.outside_friends where user_id = v_me)
              then 'no_friends' else 'ready' end;
end;
$$;
grant execute on function public.test_circle_suggestion_now() to authenticated;

-- "Reset all test accounts" also clears suggestions, their settings and answers.
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
  v_suggestions integer;
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
  delete from public.outside_friends where public._is_seed_account(user_id);
  get diagnostics v_outside = row_count;
  delete from public.people_circle_choices where public._is_seed_account(user_id);
  get diagnostics v_moves = row_count;
  -- 2026-10-28: suggestions, their settings, pattern answers, Limen rhythms.
  delete from public.circle_suggestions where public._is_seed_account(user_id);
  get diagnostics v_suggestions = row_count;
  delete from public.circle_suggestion_settings where public._is_seed_account(user_id);
  delete from public.circle_pattern_answers where public._is_seed_account(user_id);
  delete from public.limen_person_settings where public._is_seed_account(user_id);
  update public.users set paused_until = null where public._is_seed_account(id) and paused_until is not null;
  return v_result || jsonb_build_object(
    'interests_deleted', v_interests,
    'plan_limits_deleted', v_prefs,
    'reminder_settings_deleted', v_settings,
    'curiosity_notes_deleted', v_curiosity,
    'ghosting_history_deleted', v_ghosting,
    'notes_asks_deleted', v_asks,
    'outside_friends_deleted', v_outside,
    'circle_moves_deleted', v_moves,
    'suggestions_deleted', v_suggestions);
end;
$$;
grant execute on function public.test_reset_all_test_accounts() to authenticated;

create or replace function public.limen_db_version()
returns text
language sql
stable
as $function$ select '20261028000000'::text $function$;
grant execute on function public.limen_db_version() to anon, authenticated;
