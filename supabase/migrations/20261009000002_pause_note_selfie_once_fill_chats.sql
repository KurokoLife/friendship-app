-- 2026-10-09 (2): pause needs a note, the selfie check is done once per
-- account, and a Test tab tool that fills a test account to 3 chats.
-- Safe to run more than once.

-- ---------------------------------------------------------------------
-- A. The selfie check counts once it has been sent
-- ---------------------------------------------------------------------
-- Before, someone who had sent their selfie but was still waiting for the
-- founder's review was sent back to the selfie page every time they said
-- Interested. Now the check is done once per account: a selfie that has
-- been sent (waiting for review) or approved counts. If the founder
-- rejects it, the person is asked for a new one. The "Selfie checked"
-- badge on profiles still only shows after approval.

create or replace function public.selfie_check_done(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (select 1 from public.users where id = p_user and selfie_verified_at is not null)
      or exists (select 1 from public.selfie_checks where user_id = p_user and status in ('pending', 'approved'));
$$;

grant execute on function public.selfie_check_done(uuid) to authenticated;

create or replace function public.express_interest(p_other_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid := auth.uid();
  v_connection_id uuid;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if v_caller = p_other_user_id then raise exception 'Cannot connect to yourself'; end if;

  -- The selfie check is done once per account. Two people who already
  -- talked never need it to say hello again.
  if not public.selfie_check_done(v_caller)
     and not public.users_have_chatted(v_caller, p_other_user_id) then
    raise exception 'not_verified';
  end if;
  if not public.is_user_active(v_caller) then raise exception 'suspended'; end if;
  if not public.is_user_active(p_other_user_id) then raise exception 'unavailable'; end if;
  if exists (
    select 1 from public.blocks b
    where (b.blocker_id = v_caller and b.blocked_id = p_other_user_id)
       or (b.blocker_id = p_other_user_id and b.blocked_id = v_caller)
  ) then
    raise exception 'blocked';
  end if;

  insert into public.interests (from_user_id, to_user_id)
  values (v_caller, p_other_user_id)
  on conflict do nothing;

  if not exists (select 1 from public.interests where from_user_id = p_other_user_id and to_user_id = v_caller) then
    return jsonb_build_object('mutual', false);
  end if;

  v_connection_id := public.create_connection_with_capacity_check(p_other_user_id);
  return jsonb_build_object('mutual', true, 'connection_id', v_connection_id);
end;
$$;

grant execute on function public.express_interest(uuid) to authenticated;

drop policy if exists "Participants can send messages in their connection" on public.messages;
create policy "Participants can send messages in their connection"
  on public.messages for insert
  with check (
    sender_id = auth.uid()
    and public.is_user_active(auth.uid())
    and exists (
      select 1 from public.connections c
      where c.id = messages.connection_id
        and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
        and c.status is distinct from 'blocked'
        and c.status is distinct from 'inactive'
        and c.status is distinct from 'ended'
        and c.status is distinct from 'paused'
    )
    and (
      connection_has_any_message(connection_id)
      or (
        exists (select 1 from public.profiles pr where pr.user_id = auth.uid() and pr.photo_url is not null)
        and public.selfie_check_done(auth.uid())
        and public.connection_has_mutual_interest(connection_id)
      )
    )
  );

-- ---------------------------------------------------------------------
-- B. A pause always comes with a short note to the other person
-- ---------------------------------------------------------------------
-- Pausing without a word felt like going quiet with extra steps. The note
-- is sent as a normal message just before the chat pauses, in the same
-- step, so a pause can never happen without it. The person writes it
-- themselves (the app never writes it).

drop function if exists public.pause_connection_with_duration(uuid, timestamptz);

create or replace function public.pause_connection_with_duration(
  p_connection_id uuid,
  p_paused_until timestamptz,
  p_message text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid := auth.uid();
  v_status text;
  v_until timestamptz := coalesce(p_paused_until, now() + interval '7 days');
  v_note text := btrim(coalesce(p_message, ''));
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  select status into v_status from public.connections c
  where c.id = p_connection_id and (c.user_a_id = v_caller or c.user_b_id = v_caller);
  if not found then raise exception 'Not a participant of this connection'; end if;
  if v_status = 'paused' then raise exception 'already_paused'; end if;
  if v_status in ('inactive', 'blocked', 'ended', 'graduated', 'passed') then
    raise exception 'not_open';
  end if;
  if not exists (select 1 from public.messages where connection_id = p_connection_id) then
    raise exception 'no_messages_yet';
  end if;
  if v_note = '' then raise exception 'pause_note_required'; end if;
  if char_length(v_note) > 1000 then raise exception 'pause_note_too_long'; end if;
  if v_until < now() + interval '1 hour' or v_until > now() + interval '14 days 1 hour' then
    raise exception 'pause_length';
  end if;
  if (
    select count(*) from public.friendship_events
    where connection_id = p_connection_id and actor_user_id = v_caller
      and event_type = 'connection_paused' and created_at > now() - interval '30 days'
  ) >= 2 then
    raise exception 'pause_limit';
  end if;

  -- The note goes first, while the chat is still open.
  insert into public.messages (connection_id, sender_id, content, type)
  values (p_connection_id, v_caller, v_note, 'text');

  update public.connections set status = 'paused' where id = p_connection_id;

  insert into public.connection_pause_details (connection_id, paused_by, paused_until)
  values (p_connection_id, v_caller, v_until)
  on conflict (connection_id) do update
    set paused_by = excluded.paused_by, paused_until = excluded.paused_until, created_at = now();

  update public.connection_interventions
  set status = 'resolved', resolved_at = now()
  where connection_id = p_connection_id and status = 'pending'
    and intervention_type in ('no_ghost_r1', 'no_ghost_r2', 'no_ghost_r3', 'no_ghost_s1', 'conversation_restart_prompt');

  perform public.record_friendship_event(p_connection_id, 'connection_paused', v_caller,
    jsonb_build_object('until', v_until));
end;
$$;

grant execute on function public.pause_connection_with_duration(uuid, timestamptz, text) to authenticated;

-- ---------------------------------------------------------------------
-- C. Test tab: fill a test account to 3 active chats
-- ---------------------------------------------------------------------
-- Gives the test account you're acting as real, two-sided chats with
-- other test accounts until it has 3 active conversations, so the Inbox
-- limit and the "you're at the limit" messages can be tried right away.
-- Only works while acting as a test account, never on a real account.

create or replace function public.test_fill_my_chats()
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_me uuid := auth.uid();
  v_active integer;
  v_other record;
  v_conn uuid;
  v_status text;
  v_names text[] := '{}';
begin
  if not public.is_test_operator() then raise exception 'Test tools are only for admins and test accounts'; end if;
  if not public._is_seed_account(v_me) then
    raise exception 'Act as a test account first, so your own account is not filled with test chats.';
  end if;

  select active_count into v_active from public.connection_counts(v_me);

  for v_other in
    select u.id, coalesce(p.display_name, 'A test account') as name
    from public.users u
    left join public.profiles p on p.user_id = u.id
    where public._is_seed_account(u.id) and u.id <> v_me
      and not exists (
        select 1 from public.blocks b
        where (b.blocker_id = v_me and b.blocked_id = u.id) or (b.blocker_id = u.id and b.blocked_id = v_me)
      )
    order by u.phone
  loop
    exit when v_active >= 3;

    select id, status into v_conn, v_status from public.connections
    where (user_a_id = v_me and user_b_id = v_other.id) or (user_a_id = v_other.id and user_b_id = v_me)
    limit 1;

    -- Leave chats that are already open, paused, graduated or blocked alone.
    continue when v_conn is not null
      and (v_status is null or v_status in ('pending', 'active', 'paused', 'graduated', 'blocked'));

    insert into public.interests (from_user_id, to_user_id)
    values (v_me, v_other.id), (v_other.id, v_me)
    on conflict do nothing;

    if v_conn is null then
      insert into public.connections (user_a_id, user_b_id, status, opened_at)
      values (v_me, v_other.id, 'active', now())
      returning id into v_conn;
    else
      update public.connections set status = 'active', opened_at = now(), resumed_at = null where id = v_conn;
      delete from public.connection_pause_details where connection_id = v_conn;
    end if;

    insert into public.messages (connection_id, sender_id, content, type, created_at)
    values
      (v_conn, v_other.id, 'Hi! Nice to match with you.', 'text', now() - interval '2 minutes'),
      (v_conn, v_me, 'Hi, nice to meet you too!', 'text', now() - interval '1 minute');

    v_active := v_active + 1;
    v_names := v_names || v_other.name;
  end loop;

  if array_length(v_names, 1) is null then
    return format('You already have %s active conversations. Open Inbox to see the limit, then try saying hello to someone new.', v_active);
  end if;
  return format(
    'Added chats with %s. You now have %s of 3 active conversations. Open Inbox to see the limit, then try saying hello to someone new from Discover or a profile.',
    array_to_string(v_names, ', '), v_active);
end;
$$;

grant execute on function public.test_fill_my_chats() to authenticated;

create or replace function public.limen_db_version()
returns text
language sql
immutable
as $$ select '20261009000002'::text $$;

grant execute on function public.limen_db_version() to anon, authenticated;

notify pgrst, 'reload schema';
