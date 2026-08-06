-- Time Travel dev-tooling panel (Dev tab, __DEV__-only). Adds the pieces
-- that need server-side support because the underlying tables have no
-- client write policy (ai_usage_events) or need cross-participant/
-- cross-field validation a plain client update can't do safely (messages,
-- connections). Everything else the panel needs (coach_marks_seen,
-- profiles.friendship_experience, users.behavioral_tracking_disclosed_at,
-- users.premium_pool_period_start/premium_pool_spent_usd) already has
-- self-row client-writable RLS, confirmed directly against pg_policies
-- before writing this migration, so those are plain client calls in
-- dev.tsx, no new function needed for them.

-- 1. Backdate a connection's most recent message's created_at, regardless
-- of which participant sent it (unlike a real "edit my message" feature,
-- which doesn't exist and wouldn't need this).
create or replace function public.dev_backdate_last_message(p_connection_id uuid, p_hours_ago numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_message_id uuid;
  v_old_created_at timestamptz;
  v_new_created_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not exists (
    select 1 from public.connections c
    where c.id = p_connection_id and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
  ) then
    raise exception 'Not a participant of this connection';
  end if;

  select id, created_at into v_message_id, v_old_created_at
  from public.messages
  where connection_id = p_connection_id
  order by created_at desc
  limit 1;

  if v_message_id is null then
    return jsonb_build_object('found', false);
  end if;

  v_new_created_at := now() - (p_hours_ago * interval '1 hour');
  update public.messages set created_at = v_new_created_at where id = v_message_id;

  return jsonb_build_object(
    'found', true,
    'message_id', v_message_id,
    'old_created_at', v_old_created_at,
    'new_created_at', v_new_created_at
  );
end;
$$;

-- 2. Send a new message as either participant with a backdated created_at,
-- for seeding a specific conversation shape (e.g. a two-sided exchange
-- ending N hours ago) without waiting real time or relying on whichever
-- messages already happen to exist. Deliberately bypasses the real
-- messages INSERT RLS gates (photo requirement, messaging_preference,
-- blocked/inactive/ended checks), being SECURITY DEFINER, since this is
-- dev-only test-data seeding, not a real send path, and a tester may
-- specifically want to seed a conversation the real gates would normally
-- block, to test an evaluator against it.
create or replace function public.dev_send_backdated_message(
  p_connection_id uuid,
  p_sender_id uuid,
  p_content text,
  p_hours_ago numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conn record;
  v_message_id uuid;
  v_created_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select user_a_id, user_b_id into v_conn from public.connections where id = p_connection_id;
  if not found then
    raise exception 'Connection not found';
  end if;
  if auth.uid() not in (v_conn.user_a_id, v_conn.user_b_id) then
    raise exception 'Not a participant of this connection';
  end if;
  if p_sender_id not in (v_conn.user_a_id, v_conn.user_b_id) then
    raise exception 'Sender must be one of the two participants in this connection';
  end if;
  if p_content is null or length(trim(p_content)) = 0 then
    raise exception 'Message content cannot be empty';
  end if;

  v_created_at := now() - (p_hours_ago * interval '1 hour');

  insert into public.messages (connection_id, sender_id, content, type, created_at)
  values (p_connection_id, p_sender_id, p_content, 'text', v_created_at)
  returning id into v_message_id;

  return jsonb_build_object('message_id', v_message_id, 'created_at', v_created_at);
end;
$$;

-- 3. Directly set (or clear, by passing nulls) a connection's next-meetup
-- fields, for testing the date-driven meetup-checkin path and the
-- propose/confirm/reschedule UI states without going through the real
-- propose_next_meetup/confirm_next_meetup RPCs each time.
create or replace function public.dev_set_next_meetup(
  p_connection_id uuid,
  p_date date,
  p_status text,
  p_proposed_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conn record;
  v_old jsonb;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select user_a_id, user_b_id, next_meetup_date, next_meetup_status, next_meetup_proposed_by
  into v_conn
  from public.connections where id = p_connection_id;
  if not found then
    raise exception 'Connection not found';
  end if;
  if auth.uid() not in (v_conn.user_a_id, v_conn.user_b_id) then
    raise exception 'Not a participant of this connection';
  end if;
  if p_status is not null and p_status not in ('proposed', 'confirmed') then
    raise exception 'Status must be proposed, confirmed, or left blank';
  end if;
  if p_proposed_by is not null and p_proposed_by not in (v_conn.user_a_id, v_conn.user_b_id) then
    raise exception 'proposed_by must be one of the two participants, or left blank';
  end if;

  v_old := jsonb_build_object(
    'date', v_conn.next_meetup_date,
    'status', v_conn.next_meetup_status,
    'proposed_by', v_conn.next_meetup_proposed_by
  );

  update public.connections
  set next_meetup_date = p_date, next_meetup_status = p_status, next_meetup_proposed_by = p_proposed_by
  where id = p_connection_id;

  return jsonb_build_object(
    'old', v_old,
    'new', jsonb_build_object('date', p_date, 'status', p_status, 'proposed_by', p_proposed_by)
  );
end;
$$;

-- 4. Reset (clear entirely) or backdate the caller's own ai_usage_events
-- rows for one function, covering all 5 real free-tier-capped functions
-- (ai_function_caps) plus generate-personality-narrative's separate
-- retake cap (special-cased inside get_ai_gate_status, not in
-- ai_function_caps). Scoped to the caller's own account only
-- (auth.uid()), matching this project's own established "operate on the
-- signed-in account" convention for dev tooling (dev_reset_my_matches,
-- the F19 reflection triggers), rather than adding a new cross-account
-- reach. p_hours_ago null means a full clear (delete); provided means
-- backdate every matching row by that many hours, simulating the rolling
-- window elapsing without erasing the usage history entirely.
create or replace function public.dev_reset_ai_usage(p_function_name text, p_hours_ago numeric default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if p_hours_ago is null then
    delete from public.ai_usage_events
    where user_id = auth.uid() and function_name = p_function_name;
    get diagnostics v_count = row_count;
    return jsonb_build_object('mode', 'cleared', 'rows_affected', v_count);
  else
    update public.ai_usage_events
    set created_at = now() - (p_hours_ago * interval '1 hour')
    where user_id = auth.uid() and function_name = p_function_name;
    get diagnostics v_count = row_count;
    return jsonb_build_object('mode', 'backdated', 'rows_affected', v_count, 'hours_ago', p_hours_ago);
  end if;
end;
$$;

-- 5. Follow-up reflection evaluator: fix the same "returns void, so a dev
-- caller can't tell a real no-op apart from a bug" gap the 2026-08-01
-- migration already fixed once for run_meetup_checkin_check, applied here
-- for the exact same reason (found while building the Time Travel panel's
-- "run evaluator now" coverage: this was the one real evaluator with no
-- dev-callable wrapper at all). Return type changes from void to text, so
-- this needs DROP + CREATE, not CREATE OR REPLACE (Postgres doesn't allow
-- an in-place return-type change), matching the same constraint the
-- checkin fix hit. CASCADE in case run_follow_up_reflection_check_all's
-- plpgsql body created a hard dependency on this function's specific
-- signature; that function is recreated immediately after, identical to
-- its current live body (confirmed via pg_get_functiondef before writing
-- this), so nothing about its own behavior changes.
drop function if exists public.run_follow_up_reflection_check(uuid, timestamptz) cascade;

create or replace function public.run_follow_up_reflection_check(p_connection_id uuid, p_now timestamp with time zone default now())
returns text
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
    return 'connection_not_found';
  end if;

  select max(created_at) into v_last_at
  from public.messages
  where connection_id = p_connection_id;

  if v_last_at is null then
    return 'no_messages';
  end if;

  if p_now - v_last_at < interval '24 hours' then
    return 'not_enough_time_elapsed';
  end if;

  select exists (select 1 from public.messages where connection_id = p_connection_id and sender_id = v_conn.user_a_id)
  into v_has_a;
  select exists (select 1 from public.messages where connection_id = p_connection_id and sender_id = v_conn.user_b_id)
  into v_has_b;

  if not (v_has_a and v_has_b) then
    return 'not_two_sided_conversation';
  end if;

  if exists (select 1 from public.follow_up_reflections where connection_id = p_connection_id) then
    return 'already_fired_this_cycle';
  end if;

  insert into public.follow_up_reflections (connection_id, user_id, fired_at)
  values (p_connection_id, v_conn.user_a_id, p_now)
  on conflict (connection_id, user_id) do nothing;

  insert into public.follow_up_reflections (connection_id, user_id, fired_at)
  values (p_connection_id, v_conn.user_b_id, p_now)
  on conflict (connection_id, user_id) do nothing;

  return 'fired';
end;
$$;

create or replace function public.run_follow_up_reflection_check_all(p_now timestamp with time zone default now())
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

-- Dev-callable wrapper, exact same shape as dev_run_meetup_checkin_check:
-- participant-checked, delegates to the real evaluator, returns its real
-- outcome.
create or replace function public.dev_run_follow_up_reflection_check(p_connection_id uuid, p_now timestamp with time zone)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result text;
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

  select public.run_follow_up_reflection_check(p_connection_id, p_now) into v_result;
  return v_result;
end;
$$;
