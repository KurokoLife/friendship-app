-- F19: conversation follow-up reflection. A private, time-based prompt
-- shown 24+ hours after a real back-and-forth conversation (not a
-- one-sided silence, that's no_ghost_prompts' territory), asking whether
-- there's something worth following up on or celebrating. No message
-- content is ever read by this table or its evaluator, only the
-- connection_id and message timestamps/senders, matching "no message
-- content read" literally.
--
-- One row per (connection_id, user_id), unlike no_ghost_prompts' extra
-- step dimension, this feature has no escalation ladder, it fires once
-- per active-conversation window. Both participants get their own row
-- (this fires for both sides of a real exchange, not a single target the
-- way no-ghost's per-step target is).
--
-- No client-side INSERT policy, same reasoning as no_ghost_prompts: every
-- row is created through the SECURITY DEFINER evaluator or the dev-tool
-- wrapper below, never a direct client .insert().
create table if not exists public.follow_up_reflections (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.connections (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  fired_at timestamptz not null default now(),
  dismissed_at timestamptz,
  remind_at timestamptz,
  unique (connection_id, user_id)
);

alter table public.follow_up_reflections enable row level security;

create policy "Users can read their own follow-up reflections"
  on public.follow_up_reflections for select
  using (auth.uid() = user_id);

create policy "Users can update their own follow-up reflections"
  on public.follow_up_reflections for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Fires for BOTH participants once the conversation is a real exchange
-- (at least one message from each side, not just an unanswered opener)
-- and the last message is at least 24 hours old. No upper bound at 48
-- hours: once inserted, the unique constraint plus `on conflict do
-- nothing` means it will never re-fire for this same window anyway, the
-- same single-threshold convention run_no_ghost_check already uses.
create or replace function public.run_follow_up_reflection_check(p_connection_id uuid, p_now timestamptz default now())
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conn record;
  v_last_at timestamptz;
  v_has_a boolean;
  v_has_b boolean;
begin
  select user_a_id, user_b_id into v_conn
  from public.connections
  where id = p_connection_id;

  if not found then
    return;
  end if;

  select max(created_at) into v_last_at
  from public.messages
  where connection_id = p_connection_id;

  if v_last_at is null or p_now - v_last_at < interval '24 hours' then
    return;
  end if;

  select exists (select 1 from public.messages where connection_id = p_connection_id and sender_id = v_conn.user_a_id)
  into v_has_a;
  select exists (select 1 from public.messages where connection_id = p_connection_id and sender_id = v_conn.user_b_id)
  into v_has_b;

  if not (v_has_a and v_has_b) then
    return;
  end if;

  insert into public.follow_up_reflections (connection_id, user_id, fired_at)
  values (p_connection_id, v_conn.user_a_id, p_now)
  on conflict (connection_id, user_id) do nothing;

  insert into public.follow_up_reflections (connection_id, user_id, fired_at)
  values (p_connection_id, v_conn.user_b_id, p_now)
  on conflict (connection_id, user_id) do nothing;
end;
$$;

create or replace function public.run_follow_up_reflection_check_all(p_now timestamptz default now())
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conn record;
begin
  for v_conn in select id from public.connections loop
    perform public.run_follow_up_reflection_check(v_conn.id, p_now);
  end loop;
end;
$$;

-- Dev-only: force-fires for the caller specifically (not both participants,
-- a developer testing this only needs to see their own side), bypassing
-- the 24h/real-exchange conditions. Re-fires on repeat calls (on conflict
-- do update), same reasoning as dev_force_no_ghost_step.
create or replace function public.dev_force_follow_up_reflection(p_connection_id uuid)
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

  insert into public.follow_up_reflections (connection_id, user_id, fired_at)
  values (p_connection_id, auth.uid(), now())
  on conflict (connection_id, user_id)
  do update set fired_at = now(), dismissed_at = null, remind_at = null;
end;
$$;

create or replace function public.dev_reset_follow_up_reflection(p_connection_id uuid)
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

  delete from public.follow_up_reflections where connection_id = p_connection_id;
end;
$$;

grant execute on function public.dev_force_follow_up_reflection(uuid) to authenticated;
grant execute on function public.dev_reset_follow_up_reflection(uuid) to authenticated;

-- Any new message means the conversation has moved on, whatever the
-- reflection prompt was about is now stale (it points at "your recent
-- conversation", which a fresh message changes). Clears both sides, same
-- reasoning as clear_no_ghost_on_new_message: a later, genuinely new
-- active-conversation window is a different occurrence, not a repeat of
-- a dismissed one.
create or replace function public.clear_follow_up_reflection_on_new_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.follow_up_reflections where connection_id = new.connection_id;
  return new;
end;
$$;

drop trigger if exists clear_follow_up_reflection_on_new_message on public.messages;
create trigger clear_follow_up_reflection_on_new_message
  after insert on public.messages
  for each row
  execute function public.clear_follow_up_reflection_on_new_message();
