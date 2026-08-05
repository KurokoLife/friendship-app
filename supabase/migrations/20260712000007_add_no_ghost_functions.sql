-- F17: no-ghost evaluation logic and its dev-testing entry points.
--
-- run_no_ghost_check(connection, now) is the one authoritative evaluator,
-- reused by the real scheduled sweep (run_no_ghost_check_all, invoked by
-- pg_cron below) AND by the dev tool's time-offset override
-- (dev_run_no_ghost_check), so the dev-tested path is not a parallel
-- reimplementation, it is the exact production logic with a different
-- clock. Neither of the two "run_*" functions is granted to `authenticated`
-- on purpose, they're only reachable via pg_cron (internal) or through the
-- explicit, participant-checked dev_* wrappers below.
--
-- Step conditions (see the last message in the connection):
--   1: 48h since it was SENT, no reply yet, target = its recipient
--   2: 96h since sent, no reply, target = recipient
--   3: 36h since it was READ (not sent), no reply, target = recipient
--   4: 72h since sent, no reply, target = its SENDER (the person waiting)
-- Each insert is `on conflict do nothing`: once a (connection, user, step)
-- row exists, real evaluation never touches it again, dismissed or not.
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

  if p_now - v_last.created_at >= interval '48 hours' then
    insert into public.no_ghost_prompts (connection_id, user_id, step, fired_at)
    values (p_connection_id, v_recipient, 1, p_now)
    on conflict (connection_id, user_id, step) do nothing;
  end if;

  if p_now - v_last.created_at >= interval '96 hours' then
    insert into public.no_ghost_prompts (connection_id, user_id, step, fired_at)
    values (p_connection_id, v_recipient, 2, p_now)
    on conflict (connection_id, user_id, step) do nothing;
  end if;

  if v_last.read_at is not null and p_now - v_last.read_at >= interval '36 hours' then
    insert into public.no_ghost_prompts (connection_id, user_id, step, fired_at)
    values (p_connection_id, v_recipient, 3, p_now)
    on conflict (connection_id, user_id, step) do nothing;
  end if;

  if p_now - v_last.created_at >= interval '72 hours' then
    insert into public.no_ghost_prompts (connection_id, user_id, step, fired_at)
    values (p_connection_id, v_sender, 4, p_now)
    on conflict (connection_id, user_id, step) do nothing;
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

-- Dev-only entry point: force one specific step to fire immediately for a
-- connection the caller actually participates in, bypassing every time
-- check. Re-fires even if a dismissed row already exists (on conflict do
-- UPDATE, not do nothing, unlike the real evaluator above), since a
-- developer testing this repeatedly needs to re-trigger the same step
-- without manually clearing state first. Everything downstream of this
-- insert (gender differentiation, Claude drafting, dismiss/remind
-- handling) is the exact same client and Edge Function code path
-- production uses, only the firing condition itself is bypassed here.
create or replace function public.dev_force_no_ghost_step(p_connection_id uuid, p_step int)
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

  v_target := case when p_step = 4 then v_sender else v_recipient end;

  insert into public.no_ghost_prompts (connection_id, user_id, step, fired_at)
  values (p_connection_id, v_target, p_step, now())
  on conflict (connection_id, user_id, step)
  do update set fired_at = now(), dismissed_at = null, remind_at = null, draft_content = null;
end;
$$;

-- Dev-only entry point for the "time offset override" control: runs the
-- real, unmodified run_no_ghost_check with a caller-supplied clock instead
-- of bypassing its logic, so this exercises production behavior directly
-- rather than a simulation of it.
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

grant execute on function public.dev_force_no_ghost_step(uuid, int) to authenticated;
grant execute on function public.dev_run_no_ghost_check(uuid, timestamptz) to authenticated;
grant execute on function public.dev_reset_no_ghost(uuid) to authenticated;

-- Any new message means the silence being tracked is over, resolved or
-- not, from either participant. Clearing the whole connection's rows
-- (not just the sender's) is what lets a genuinely new, later lull be
-- tracked again without contradicting the "never repeat after dismissal"
-- rule for the one that just ended: dismissed rows for a resolved silence
-- are gone, not resurrected, a fresh row for a future silence is a
-- different occurrence.
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

drop trigger if exists clear_no_ghost_on_new_message on public.messages;
create trigger clear_no_ghost_on_new_message
  after insert on public.messages
  for each row
  execute function public.clear_no_ghost_on_new_message();
