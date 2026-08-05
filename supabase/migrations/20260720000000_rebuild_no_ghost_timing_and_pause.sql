-- Fix #2 of 23: rebuilds F17's timing to match blueprint Section 10's
-- locked timeline (0/20/36/72/120/125h/7 days) and adds a formal
-- per-connection Pause state.
--
-- What was actually found before writing this (verified live, not
-- assumed): the previous no-ghost system (20260719000000, comment-dated
-- "2026-07-17") was itself a full, undocumented rewrite of the original
-- 48/96/36-since-read/72h system, using yet a THIRD timing map entirely
-- (48h/125h sender, 24h/48h/72h-since-read/120h receiver), sourced from
-- some other "given spec"/"Part 1-7" instruction that isn't in this
-- repo and isn't PROGRESS.md's own blueprint. AGENTS.md's own claimed
-- 48/72/96/120h table was ALSO stale, matching neither the live system
-- nor the blueprint. None of this is preserved: this migration replaces
-- the trigger set outright, same as its predecessor did.
--
-- Existing no_ghost_prompts rows are dropped, same reasoning as last
-- time: this table only ever holds live state for active test
-- conversations, nothing real to lose, and the old trigger_id values
-- (S2/S3/R1-R4) don't map cleanly onto the new checkpoints anyway.
drop trigger if exists clear_no_ghost_on_new_message on public.messages;
drop function if exists public.clear_no_ghost_on_new_message();
drop function if exists public.dev_reset_no_ghost(uuid);
drop function if exists public.dev_run_no_ghost_check(uuid, timestamptz);
drop function if exists public.dev_force_no_ghost_step(uuid, text);
drop function if exists public.run_no_ghost_check_all(timestamptz);
drop function if exists public.run_no_ghost_check(uuid, timestamptz);
drop table if exists public.no_ghost_prompts;

-- Only 4 trigger IDs now, not 6: the blueprint's 20h (sender) and 72h
-- (sender, "only if Chat is opened") checkpoints are both passive,
-- non-actionable reassurance lines with no real choice attached ("no
-- push, contextual reassurance only"), so like the original system's
-- own 1-hour status line, they're computed purely client-side from
-- message timestamps, no row to store. Only the checkpoints that
-- present a real Reply/Pause/End choice get a persisted row: R1 (first
-- gentle reminder, 20h or 36h depending on the recipient's own stated
-- reply rhythm), R2 (72h), R3 (120h, final), and S1 (125h, the sender's
-- own final actionable checkpoint, "S" for sender, "1" since it's the
-- only sender-side row that exists, distinct from the unrelated
-- client-only "quiet status line" concept referenced in old comments).
create table public.no_ghost_prompts (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.connections (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  trigger_id text not null check (trigger_id in ('R1', 'R2', 'R3', 'S1')),
  fired_at timestamptz not null default now(),
  dismissed_at timestamptz,
  remind_at timestamptz,
  draft_content text,
  unique (connection_id, user_id, trigger_id)
);

alter table public.no_ghost_prompts enable row level security;

create policy "Users can read their own conversation-flow prompts"
  on public.no_ghost_prompts for select
  using (auth.uid() = user_id);

create policy "Users can update their own conversation-flow prompts"
  on public.no_ghost_prompts for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Single authoritative evaluator per blueprint Section 10's table.
-- "Receiver always receives escalating prompt before sender" (Section
-- 25, locked decision) is satisfied two ways here: the receiver's own
-- checkpoints (20/36h, 72h, 120h) are always numerically earlier than
-- the sender's one actionable checkpoint (125h), so it's true in real
-- wall-clock terms regardless of code order; and the receiver blocks
-- are still evaluated/inserted before the sender block in this
-- function's own body, so it also holds by construction, not just by
-- coincidence of the numbers chosen.
--
-- Paused, inactive, and passed connections are skipped entirely, this
-- is what makes Pause actually stop the timer, not just hide the UI:
-- a paused connection's last message can sit at 500+ hours old forever
-- without ever generating a new row, because this function returns
-- before reaching any of the threshold checks.
create or replace function public.run_no_ghost_check(p_connection_id uuid, p_now timestamptz default now())
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last record;
  v_sender uuid;
  v_recipient uuid;
  v_status text;
  v_recipient_response_time text;
  v_r1_threshold interval;
  v_elapsed interval;
begin
  select c.status
  into v_status
  from public.connections c
  where c.id = p_connection_id;

  if v_status is not null and v_status in ('paused', 'inactive', 'passed') then
    return;
  end if;

  select m.sender_id, m.created_at
  into v_last
  from public.messages m
  where m.connection_id = p_connection_id
  order by m.created_at desc
  limit 1;

  if not found then
    return;
  end if;

  v_sender := v_last.sender_id;

  select case when c.user_a_id = v_sender then c.user_b_id else c.user_a_id end
  into v_recipient
  from public.connections c
  where c.id = p_connection_id;

  if v_recipient is null then
    return;
  end if;

  v_elapsed := p_now - v_last.created_at;

  -- Blueprint: "20 hours: No reminder unless stated reply rhythm is
  -- same-day." Read as: the first gentle reminder normally arrives at
  -- 36h, but for a recipient who has told the app they typically reply
  -- same-day, it's reasonable to check in earlier, at 20h, since the
  -- app already knows 20h is unusually slow for that specific person.
  select p.response_time
  into v_recipient_response_time
  from public.profiles p
  where p.user_id = v_recipient;

  v_r1_threshold := case when v_recipient_response_time = 'Same day' then interval '20 hours' else interval '36 hours' end;

  -- Receiver triggers, evaluated and inserted before the sender trigger
  -- below (see function comment).
  if v_elapsed >= v_r1_threshold then
    insert into public.no_ghost_prompts (connection_id, user_id, trigger_id, fired_at)
    values (p_connection_id, v_recipient, 'R1', p_now)
    on conflict (connection_id, user_id, trigger_id) do nothing;
  end if;

  if v_elapsed >= interval '72 hours' then
    insert into public.no_ghost_prompts (connection_id, user_id, trigger_id, fired_at)
    values (p_connection_id, v_recipient, 'R2', p_now)
    on conflict (connection_id, user_id, trigger_id) do nothing;
  end if;

  if v_elapsed >= interval '120 hours' then
    insert into public.no_ghost_prompts (connection_id, user_id, trigger_id, fired_at)
    values (p_connection_id, v_recipient, 'R3', p_now)
    on conflict (connection_id, user_id, trigger_id) do nothing;
  end if;

  -- Sender trigger. "Any receiver action cancels sender prompt" (the
  -- 125h rule) isn't a separate check here: if the recipient replies,
  -- the clear-on-new-message trigger below wipes every row for this
  -- connection and the next evaluator run recomputes off their new
  -- message instead; if they Pause or honest-exit-close, the status
  -- guard at the top of this function already returns early.
  if v_elapsed >= interval '125 hours' then
    insert into public.no_ghost_prompts (connection_id, user_id, trigger_id, fired_at)
    values (p_connection_id, v_sender, 'S1', p_now)
    on conflict (connection_id, user_id, trigger_id) do nothing;
  end if;

  -- Blueprint 7-day row: "Connection becomes inactive until Reply or
  -- End" / "No AI-generated closure is sent automatically." A pure
  -- status transition, never a message, matching the existing
  -- set_connection_inactive RPC's own "archives quietly, no penalty"
  -- behavior, just fired by the system instead of a user tap. No prompt
  -- row is inserted for this checkpoint, there's nothing left to act on.
  if v_elapsed >= interval '168 hours' and v_status is distinct from 'inactive' then
    update public.connections set status = 'inactive' where id = p_connection_id;
  end if;
end;
$$;

create or replace function public.run_no_ghost_check_all(p_now timestamptz default now())
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conn record;
begin
  for v_conn in
    select id from public.connections
    where status is null or status not in ('paused', 'inactive', 'passed')
  loop
    perform public.run_no_ghost_check(v_conn.id, p_now);
  end loop;
end;
$$;

-- Dev-only: force one specific trigger for a connection the caller
-- participates in, bypassing every time check (including the paused/
-- inactive/passed guard, a developer force-firing a trigger for preview
-- purposes is a deliberate override, not something that should silently
-- no-op).
create or replace function public.dev_force_no_ghost_step(p_connection_id uuid, p_trigger_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last record;
  v_sender uuid;
  v_recipient uuid;
  v_target uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1 from public.connections c
    where c.id = p_connection_id
      and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
  ) then
    raise exception 'Not a participant of this connection';
  end if;

  if p_trigger_id not in ('R1', 'R2', 'R3', 'S1') then
    raise exception 'Unknown trigger_id: %', p_trigger_id;
  end if;

  select m.sender_id, m.created_at
  into v_last
  from public.messages m
  where m.connection_id = p_connection_id
  order by m.created_at desc
  limit 1;

  if not found then
    raise exception 'This conversation has no messages yet';
  end if;

  v_sender := v_last.sender_id;

  select case when c.user_a_id = v_sender then c.user_b_id else c.user_a_id end
  into v_recipient
  from public.connections c
  where c.id = p_connection_id;

  v_target := case when p_trigger_id = 'S1' then v_sender else v_recipient end;

  insert into public.no_ghost_prompts (connection_id, user_id, trigger_id, fired_at)
  values (p_connection_id, v_target, p_trigger_id, now())
  on conflict (connection_id, user_id, trigger_id)
  do update set fired_at = now(), dismissed_at = null, remind_at = null, draft_content = null;
end;
$$;

create or replace function public.dev_run_no_ghost_check(p_connection_id uuid, p_now timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1 from public.connections c
    where c.id = p_connection_id
      and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
  ) then
    raise exception 'Not a participant of this connection';
  end if;

  perform public.run_no_ghost_check(p_connection_id, p_now);
end;
$$;

create or replace function public.dev_reset_no_ghost(p_connection_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1 from public.connections c
    where c.id = p_connection_id
      and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
  ) then
    raise exception 'Not a participant of this connection';
  end if;

  delete from public.no_ghost_prompts where connection_id = p_connection_id;
end;
$$;

grant execute on function public.dev_force_no_ghost_step(uuid, text) to authenticated;
grant execute on function public.dev_run_no_ghost_check(uuid, timestamptz) to authenticated;
grant execute on function public.dev_reset_no_ghost(uuid) to authenticated;

-- A new message clears all no-ghost state for the connection (unchanged
-- from before) and, new in this migration, resumes a paused connection
-- automatically: Pause is meant to be a soft "not right now," not a
-- dead end, so either participant continuing the conversation is
-- itself the natural, low-friction way out of it, no separate "Resume"
-- action required (the client still gets an explicit Resume button too,
-- for a paused connection with no new message yet, this just covers
-- the case where a message is sent directly instead).
create or replace function public.clear_no_ghost_on_new_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.no_ghost_prompts where connection_id = new.connection_id;
  update public.connections set status = 'active' where id = new.connection_id and status = 'paused';
  return new;
end;
$$;

create trigger clear_no_ghost_on_new_message
  after insert on public.messages
  for each row
  execute function public.clear_no_ghost_on_new_message();

-- Pause: a formal per-connection state, not previously built at all
-- (confirmed live before writing this: no 'paused' value existed
-- anywhere in connections_status_check). Sits alongside pending/active/
-- passed/inactive, same tier, same asymmetric-RLS workaround every
-- other connection-level RPC in this project already uses (connections'
-- own update RLS only lets user_a_id write directly).
alter table public.connections
  drop constraint if exists connections_status_check;

alter table public.connections
  add constraint connections_status_check
  check (status is null or status in ('pending', 'active', 'passed', 'inactive', 'paused'));

create or replace function public.pause_connection(p_connection_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1 from public.connections c
    where c.id = p_connection_id
      and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
  ) then
    raise exception 'Not a participant of this connection';
  end if;

  update public.connections set status = 'paused' where id = p_connection_id;
  -- Stops the timer immediately, not just going forward: any prompt
  -- already sitting in the inbox for either participant is cleared too,
  -- so entering Pause genuinely silences reminders right away rather
  -- than just preventing new ones.
  delete from public.no_ghost_prompts where connection_id = p_connection_id;
end;
$$;

create or replace function public.resume_connection(p_connection_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1 from public.connections c
    where c.id = p_connection_id
      and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
  ) then
    raise exception 'Not a participant of this connection';
  end if;

  update public.connections set status = 'active' where id = p_connection_id and status = 'paused';
end;
$$;

grant execute on function public.pause_connection(uuid) to authenticated;
grant execute on function public.resume_connection(uuid) to authenticated;

-- The existing 15-minute cron job ('no-ghost-check', from 20260712000008)
-- already calls run_no_ghost_check_all(), unchanged name and signature,
-- so it keeps working against this new logic without needing to be
-- recreated.
