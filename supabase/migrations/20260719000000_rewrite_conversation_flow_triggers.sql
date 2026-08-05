-- Parts 1 & 2 (2026-07-17): full replacement of the F17 no-ghost system's
-- timing and content with the given "complete sender/receiver trigger
-- map". This is a genuine rewrite, not an extension: trigger identity
-- moves from a numeric step (1-4, shared between two roles via a
-- separate isSenderRole flag) to an explicit trigger_id (S2/S3 for
-- sender, R1/R2/R3/R4 for receiver), with different timings than the old
-- system entirely (old: 48h/96h/36h-since-read/72h; new: 48h/125h for
-- sender, 24h/48h/72h-since-read/120h for receiver). S1 (the 1-hour
-- quiet status line) has no row here at all, same as the old system's
-- own early-tier status line, it's computed purely client-side from
-- message timestamps, nothing to store.
--
-- Existing no_ghost_prompts rows are dropped (truncate, not preserved):
-- this table only ever holds live trigger state for active conversations
-- (seed/test accounts and this project's own real test account), not
-- historical or production user data, so there is nothing real to lose
-- and no safe way to map an old step number onto a new trigger_id anyway
-- (the conditions themselves changed).
drop trigger if exists clear_no_ghost_on_new_message on public.messages;
drop function if exists public.clear_no_ghost_on_new_message();
drop function if exists public.dev_reset_no_ghost(uuid);
drop function if exists public.dev_run_no_ghost_check(uuid, timestamptz);
drop function if exists public.dev_force_no_ghost_step(uuid, int);
drop function if exists public.run_no_ghost_check_all(timestamptz);
drop function if exists public.run_no_ghost_check(uuid, timestamptz);
drop table if exists public.no_ghost_prompts;

create table public.no_ghost_prompts (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.connections (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  trigger_id text not null check (trigger_id in ('S2', 'S3', 'R1', 'R2', 'R3', 'R4')),
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

-- Single authoritative evaluator, reused by the real scheduled sweep and
-- the dev time-offset override, same pattern the old system already
-- established. R1's shallow/genuine-depth content branch and R2/R3/R4's
-- shared identity mirror and option drafts are NOT decided here, they're
-- pure content concerns the client resolves from the same trigger_id,
-- this function's only job is "should trigger X exist for user Y on
-- connection Z right now."
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
begin
  select m.sender_id, m.created_at, m.read_at
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

  -- Sender triggers (S1 is client-only, no row). S2 at 48h, S3 at 125h.
  if p_now - v_last.created_at >= interval '48 hours' then
    insert into public.no_ghost_prompts (connection_id, user_id, trigger_id, fired_at)
    values (p_connection_id, v_sender, 'S2', p_now)
    on conflict (connection_id, user_id, trigger_id) do nothing;
  end if;

  if p_now - v_last.created_at >= interval '125 hours' then
    insert into public.no_ghost_prompts (connection_id, user_id, trigger_id, fired_at)
    values (p_connection_id, v_sender, 'S3', p_now)
    on conflict (connection_id, user_id, trigger_id) do nothing;
  end if;

  -- Receiver triggers. R1 at 24h since sent, R2 at 48h since sent, R3 at
  -- 72h since READ (not sent, its own copy explicitly says "you read
  -- X's message", would be false if never read), R4 at 120h since sent.
  if p_now - v_last.created_at >= interval '24 hours' then
    insert into public.no_ghost_prompts (connection_id, user_id, trigger_id, fired_at)
    values (p_connection_id, v_recipient, 'R1', p_now)
    on conflict (connection_id, user_id, trigger_id) do nothing;
  end if;

  if p_now - v_last.created_at >= interval '48 hours' then
    insert into public.no_ghost_prompts (connection_id, user_id, trigger_id, fired_at)
    values (p_connection_id, v_recipient, 'R2', p_now)
    on conflict (connection_id, user_id, trigger_id) do nothing;
  end if;

  if v_last.read_at is not null and p_now - v_last.read_at >= interval '72 hours' then
    insert into public.no_ghost_prompts (connection_id, user_id, trigger_id, fired_at)
    values (p_connection_id, v_recipient, 'R3', p_now)
    on conflict (connection_id, user_id, trigger_id) do nothing;
  end if;

  if p_now - v_last.created_at >= interval '120 hours' then
    insert into public.no_ghost_prompts (connection_id, user_id, trigger_id, fired_at)
    values (p_connection_id, v_recipient, 'R4', p_now)
    on conflict (connection_id, user_id, trigger_id) do nothing;
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
  for v_conn in select id from public.connections loop
    perform public.run_no_ghost_check(v_conn.id, p_now);
  end loop;
end;
$$;

-- Dev-only: force one specific trigger for a connection the caller
-- participates in, bypassing every time check. Which participant it
-- targets is now read directly off the trigger_id's own S/R prefix
-- (no separate "role" parameter needed anymore, unlike the old system's
-- step 4, which needed one because the same step number meant two
-- different people depending on role).
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

  if p_trigger_id not in ('S2', 'S3', 'R1', 'R2', 'R3', 'R4') then
    raise exception 'Unknown trigger_id: %', p_trigger_id;
  end if;

  select m.sender_id, m.created_at, m.read_at
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

  v_target := case when left(p_trigger_id, 1) = 'S' then v_sender else v_recipient end;

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

create or replace function public.clear_no_ghost_on_new_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.no_ghost_prompts where connection_id = new.connection_id;
  return new;
end;
$$;

create trigger clear_no_ghost_on_new_message
  after insert on public.messages
  for each row
  execute function public.clear_no_ghost_on_new_message();

-- The existing 15-minute cron job ('no-ghost-check', from
-- 20260712000008) already calls run_no_ghost_check_all(), unchanged
-- name and signature, so it keeps working against the new logic without
-- needing to be recreated.
