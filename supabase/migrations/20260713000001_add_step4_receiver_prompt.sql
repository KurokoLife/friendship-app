-- F17 targeted fix: step 4 now fires to BOTH participants at 120h, not
-- just the sender. The recipient (who's already had steps 1/2/3) gets a
-- final "last reminder" prompt too, per explicit product instruction:
-- "after this the app stops prompting the receiver entirely." No new step
-- number needed, the unique constraint is (connection_id, user_id, step),
-- and the two rows have different user_id values, so both a sender row
-- and a recipient row for step 4 on the same connection coexist without
-- conflict. The client (src/lib/no-ghost.ts's STEP_4_RECEIVER_CONTENT,
-- src/components/no-ghost-prompt.tsx's isSenderRole prop) is what
-- actually distinguishes which of step 4's two content sets to render for
-- a given row, not anything in the schema.
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

  -- Step 4: 120h since sent. Both the sender (waiting) and the recipient
  -- (three prior nudges already sent) get their own step 4 row, this is
  -- the final prompt either of them will ever see for this connection,
  -- there is no step 5.
  if p_now - v_last.created_at >= interval '120 hours' then
    insert into public.no_ghost_prompts (connection_id, user_id, step, fired_at)
    values (p_connection_id, v_sender, 4, p_now)
    on conflict (connection_id, user_id, step) do nothing;

    insert into public.no_ghost_prompts (connection_id, user_id, step, fired_at)
    values (p_connection_id, v_recipient, 4, p_now)
    on conflict (connection_id, user_id, step) do nothing;
  end if;
end;
$$;

-- Dev tool: step 4 now needs to be force-fireable for either role, since
-- both a sender row and a receiver row can exist for the same connection.
-- p_step4_role only matters when p_step = 4, ignored otherwise.
--
-- Explicit drop first: `create or replace function` only replaces a
-- function with the exact same parameter list, adding a parameter (even
-- with a default) changes the signature, so without this drop, Postgres
-- would create a second, separately-overloaded 3-arg function alongside
-- the old 2-arg one rather than actually replacing it, leaving a stale,
-- confusing duplicate behind.
drop function if exists public.dev_force_no_ghost_step(uuid, int);

create or replace function public.dev_force_no_ghost_step(p_connection_id uuid, p_step int, p_step4_role text default 'sender')
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

  v_target := case
    when p_step = 4 and p_step4_role = 'receiver' then v_recipient
    when p_step = 4 then v_sender
    else v_recipient
  end;

  insert into public.no_ghost_prompts (connection_id, user_id, step, fired_at)
  values (p_connection_id, v_target, p_step, now())
  on conflict (connection_id, user_id, step)
  do update set fired_at = now(), dismissed_at = null, remind_at = null, draft_content = null;
end;
$$;

grant execute on function public.dev_force_no_ghost_step(uuid, int, text) to authenticated;
