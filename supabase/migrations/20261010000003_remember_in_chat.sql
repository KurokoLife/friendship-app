-- 2026-10-10: Remember moves into the chat (docs/DECISIONS.md section 9).
-- Safe to run twice.
--
--   A. Notes are organized by meetup. A note can belong to one meetup
--      that happened (meetup_id), or sit between meetups (meetup_id null).
--      Three optional friendship questions per note: what you learned,
--      what made you smile, what you'd love to ask next time. raw_text
--      stays as "anything else". "Asked" moves a question off the
--      "Next time, ask..." list (ask_next_done_at).
--   B. remember_asks: after a meetup counts, the chat asks once
--      "Anything you'd like to remember about X?". This remembers that
--      it was asked (answered or put away), own rows only.
--   C. A new reminder setting, 'notes': your own notes coming back in the
--      chat (after a meetup, in the planning card, in the check-in). Can
--      be turned off for all chats or one chat, like the others.
--   D. limen_db_version() -> 20261010000003.
--
-- Nothing is deleted. The old AI columns (organized_text, follow_up_note)
-- stay; follow_up_note is copied into ask_next once.

-- ---------------------------------------------------------------------
-- A. Notes by meetup
-- ---------------------------------------------------------------------

alter table public.remember_entries
  add column if not exists meetup_id uuid references public.meetups(id) on delete set null,
  add column if not exists learned text,
  add column if not exists smiled text,
  add column if not exists ask_next text,
  add column if not exists ask_next_done_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

alter table public.remember_entries alter column raw_text set default '';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'remember_entries_lengths') then
    alter table public.remember_entries add constraint remember_entries_lengths check (
      char_length(coalesce(learned, '')) <= 1000
      and char_length(coalesce(smiled, '')) <= 1000
      and char_length(coalesce(ask_next, '')) <= 1000
      and char_length(coalesce(raw_text, '')) <= 4000
    ) not valid;
  end if;
end $$;

-- Old "Reminder for next time" lines become "Next time, I'd love to ask".
update public.remember_entries
set ask_next = follow_up_note
where ask_next is null and nullif(trim(follow_up_note), '') is not null;

-- Old notes written "after meetup N": attach to the Nth meetup that
-- happened, but only when it's the only note for that meetup (so the
-- one-note-per-meetup rule below holds). Others stay between meetups.
with ranked as (
  select m.id as meetup_id, m.connection_id,
         row_number() over (partition by m.connection_id order by coalesce(m.occurred_date, m.confirmed_date), m.created_at) as n
  from public.meetups m
  where m.status = 'occurred'
), single as (
  select e.user_id, e.connection_id, e.meetup_number_at_entry, min(e.id::text)::uuid as entry_id
  from public.remember_entries e
  where e.meetup_id is null and e.meetup_number_at_entry > 0
  group by e.user_id, e.connection_id, e.meetup_number_at_entry
  having count(*) = 1
)
update public.remember_entries e
set meetup_id = r.meetup_id
from single s
join ranked r on r.connection_id = s.connection_id and r.n = s.meetup_number_at_entry
where e.id = s.entry_id
  and not exists (
    select 1 from public.remember_entries x
    where x.user_id = e.user_id and x.meetup_id = r.meetup_id
  );

create unique index if not exists remember_entries_one_per_meetup
  on public.remember_entries (user_id, meetup_id) where meetup_id is not null;

-- A note's meetup must be a meetup in the same chat.
drop policy if exists "Users can insert their own remember entries" on public.remember_entries;
create policy "Users can insert their own remember entries" on public.remember_entries
  for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.connections c
      where c.id = remember_entries.connection_id and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
    )
    and (
      meetup_id is null
      or exists (select 1 from public.meetups m where m.id = remember_entries.meetup_id and m.connection_id = remember_entries.connection_id)
    )
  );

drop policy if exists "Users can update their own remember entries" on public.remember_entries;
create policy "Users can update their own remember entries" on public.remember_entries
  for update using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and (
      meetup_id is null
      or exists (select 1 from public.meetups m where m.id = remember_entries.meetup_id and m.connection_id = remember_entries.connection_id)
    )
  );

-- ---------------------------------------------------------------------
-- B. "Anything you'd like to remember?" asked once per meetup
-- ---------------------------------------------------------------------

create table if not exists public.remember_asks (
  user_id uuid not null references auth.users(id) on delete cascade,
  meetup_id uuid not null references public.meetups(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, meetup_id)
);

alter table public.remember_asks enable row level security;
drop policy if exists "Own remember asks" on public.remember_asks;
create policy "Own remember asks" on public.remember_asks
  for select using (auth.uid() = user_id);
drop policy if exists "Own remember asks insert" on public.remember_asks;
create policy "Own remember asks insert" on public.remember_asks
  for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.meetups m
      join public.connections c on c.id = m.connection_id
      where m.id = remember_asks.meetup_id and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
    )
  );
grant select, insert on public.remember_asks to authenticated;

-- ---------------------------------------------------------------------
-- C. 'notes' reminder setting
-- ---------------------------------------------------------------------

alter table public.prompt_settings drop constraint if exists prompt_settings_kind_check;
alter table public.prompt_settings add constraint prompt_settings_kind_check
  check (kind in ('check_in', 'meet_nudge', 'morning_of', 'calendar', 'guides', 'notes'));

create or replace function public.get_prompt_settings(p_connection_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_out jsonb := '{}'::jsonb;
  v_kind text;
  v_all boolean;
  v_chat boolean;
begin
  if auth.uid() is null then return v_out; end if;
  foreach v_kind in array array['check_in', 'meet_nudge', 'morning_of', 'calendar', 'guides', 'notes'] loop
    select coalesce(bool_and(enabled), true) into v_all from public.prompt_settings
    where user_id = auth.uid() and kind = v_kind and connection_id is null;
    if p_connection_id is null then
      v_chat := v_all;
    else
      select coalesce(bool_and(enabled), true) into v_chat from public.prompt_settings
      where user_id = auth.uid() and kind = v_kind and connection_id = p_connection_id;
    end if;
    v_out := v_out || jsonb_build_object(v_kind, jsonb_build_object('all', v_all, 'chat', v_chat));
  end loop;
  return v_out;
end;
$$;
grant execute on function public.get_prompt_settings(uuid) to authenticated;

create or replace function public.set_prompt_setting(p_connection_id uuid, p_kind text, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if p_kind not in ('check_in', 'meet_nudge', 'morning_of', 'calendar', 'guides', 'notes') then
    raise exception 'bad_kind';
  end if;
  if p_connection_id is not null and not exists (
    select 1 from public.connections where id = p_connection_id and (user_a_id = v_caller or user_b_id = v_caller)
  ) then
    raise exception 'Not a participant of this connection';
  end if;

  delete from public.prompt_settings
  where user_id = v_caller and kind = p_kind and connection_id is not distinct from p_connection_id;
  if not p_enabled then
    insert into public.prompt_settings (user_id, connection_id, kind, enabled)
    values (v_caller, p_connection_id, p_kind, false);
  end if;

  -- Turning check-ins off puts away any check-in already waiting.
  if p_kind = 'check_in' and not p_enabled then
    update public.connection_interventions
    set status = 'dismissed', resolved_at = now()
    where target_user_id = v_caller and status = 'pending'
      and intervention_type = 'conversation_restart_prompt'
      and (p_connection_id is null or connection_id = p_connection_id);
  end if;
end;
$$;
grant execute on function public.set_prompt_setting(uuid, text, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- D. Version
-- ---------------------------------------------------------------------

create or replace function public.limen_db_version()
returns text
language sql
stable
as $function$ select '20261010000003'::text $function$;
grant execute on function public.limen_db_version() to anon, authenticated;
