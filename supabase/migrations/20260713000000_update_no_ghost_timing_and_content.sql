-- F17 rebuild: corrected timing (48h/72h/96h/120h, all measured from when
-- the message was SENT, not from when step 3's read happened), and step 3
-- now additionally requires read_at is not null (a read-but-unanswered
-- message), rather than firing off its own separate read-based clock.
--
-- Replaces run_no_ghost_check in place (create or replace, same
-- signature), reused unchanged by both the real pg_cron sweep
-- (run_no_ghost_check_all) and the dev tool's time-offset override
-- (dev_run_no_ghost_check), no separate update needed to either of those
-- two callers.
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

  -- Step 1: 48h since sent, target = recipient.
  if p_now - v_last.created_at >= interval '48 hours' then
    insert into public.no_ghost_prompts (connection_id, user_id, step, fired_at)
    values (p_connection_id, v_recipient, 1, p_now)
    on conflict (connection_id, user_id, step) do nothing;
  end if;

  -- Step 2: 72h since sent, target = recipient.
  if p_now - v_last.created_at >= interval '72 hours' then
    insert into public.no_ghost_prompts (connection_id, user_id, step, fired_at)
    values (p_connection_id, v_recipient, 2, p_now)
    on conflict (connection_id, user_id, step) do nothing;
  end if;

  -- Step 3: 96h since sent AND actually read, target = recipient. Never
  -- fires for an unread message, this is a "read but ignored" prompt
  -- specifically, not a generic 96h reminder.
  if p_now - v_last.created_at >= interval '96 hours' and v_last.read_at is not null then
    insert into public.no_ghost_prompts (connection_id, user_id, step, fired_at)
    values (p_connection_id, v_recipient, 3, p_now)
    on conflict (connection_id, user_id, step) do nothing;
  end if;

  -- Step 4: 120h since sent, target = SENDER (the person waiting).
  if p_now - v_last.created_at >= interval '120 hours' then
    insert into public.no_ghost_prompts (connection_id, user_id, step, fired_at)
    values (p_connection_id, v_sender, 4, p_now)
    on conflict (connection_id, user_id, step) do nothing;
  end if;
end;
$$;

-- Dev tab: shows which gender-framing variant will fire for each step
-- before the trigger button is tapped. Same security pattern as the other
-- dev_* functions (20260712000007, 20260712000009): security definer,
-- explicitly checks the caller is a genuine participant of the
-- connection before returning anything, even though it bypasses RLS
-- internally to read both participants' rows (public.users is own-row-
-- only, a plain client select can't see the other participant's
-- gender_identity at all).
create or replace function public.dev_get_connection_info(p_connection_id uuid)
returns table (
  user_a_id uuid,
  user_a_gender text,
  user_b_id uuid,
  user_b_gender text,
  last_sender_id uuid
)
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

  return query
  select
    c.user_a_id,
    ua.gender_identity,
    c.user_b_id,
    ub.gender_identity,
    (select m.sender_id from public.messages m where m.connection_id = c.id order by m.created_at desc limit 1)
  from public.connections c
  join public.users ua on ua.id = c.user_a_id
  join public.users ub on ub.id = c.user_b_id
  where c.id = p_connection_id;
end;
$$;

grant execute on function public.dev_get_connection_info(uuid) to authenticated;
