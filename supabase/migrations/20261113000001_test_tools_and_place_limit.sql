-- 2026-11-13 (later): Test tools only touch test chats, and a daily limit on
-- Google place search. No change to how the app looks for members.
-- Safe to run twice. Run 20261113000000_security_hardening.sql first.
--
-- Why: the nine test phone numbers are listed in the code, and each has a
-- fixed sign-in code in Supabase. Anyone who guessed one of those codes was
-- a "test operator", and these Test tab tools accepted any chat id, so they
-- could post messages into a real member's chat as anyone, reopen it, or
-- move its dates. Now they only work on chats where both people are test
-- accounts (or an admin).

do $$
begin
  if public.limen_db_version() < '20261113000000' then
    raise exception 'Run 20261113000000_security_hardening.sql first, then run this file again.';
  end if;
end $$;

-- 1. Test tools ------------------------------------------------------------
create or replace function public._test_chat_only(p_connection_id uuid, p_person uuid default null)
returns void
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_a uuid;
  v_b uuid;
begin
  select user_a_id, user_b_id into v_a, v_b from public.connections where id = p_connection_id;
  if v_a is null then
    raise exception 'Connection not found';
  end if;
  if not (
    (public._is_seed_account(v_a) or exists (select 1 from public.users where id = v_a and is_admin))
    and
    (public._is_seed_account(v_b) or exists (select 1 from public.users where id = v_b and is_admin))
  ) then
    raise exception 'Test tools only work on chats between test accounts';
  end if;
  if p_person is not null and p_person not in (v_a, v_b) then
    raise exception 'That person is not in this chat';
  end if;
end;
$$;
revoke all on function public._test_chat_only(uuid, uuid) from public, anon, authenticated;
grant execute on function public._test_chat_only(uuid, uuid) to service_role;

-- Add the check to each Test tab tool that takes a chat, right after its
-- "only for admins and test accounts" check. Any earlier copy of the line is
-- taken out first, so running this file again leaves one copy in place.
do $$
declare
  r record;
  v_def text;
  v_line text;
  v_new text;
begin
  for r in
    select p.oid, p.proname
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('test_end_pause', 'test_match_age', 'test_no_reply', 'test_plan_board_age',
                        'test_reopen_chat', 'test_send_message_as', 'test_share_reminder_now',
                        'test_talking_age')
  loop
    v_def := pg_get_functiondef(r.oid);
    v_def := regexp_replace(v_def, '\n *perform public\._test_chat_only\([^;]*\);', '', 'g');
    if r.proname = 'test_send_message_as' then
      v_line := E'\n  perform public._test_chat_only(p_connection_id, p_sender_id);';
    else
      v_line := E'\n  perform public._test_chat_only(p_connection_id);';
    end if;
    v_new := regexp_replace(v_def,
      '(if not public\.is_test_operator\(\) then[^;]*;\s*end if;)', '\1' || v_line, 'i');
    if v_new = v_def then
      -- No operator check found: put it first in the body instead.
      v_new := regexp_replace(v_def, '\mbegin\M', 'begin' || v_line, 'i');
    end if;
    execute v_new;
  end loop;
end $$;

-- 2. Place search limit ------------------------------------------------------
-- Counts each person's Google place lookups. Over the limit, the app quietly
-- uses the free OpenStreetMap search instead, as it does when Google is off.
create table if not exists public.place_search_usage (
  user_id uuid primary key references auth.users(id) on delete cascade,
  day date not null default current_date,
  day_count integer not null default 0,
  minute_start timestamptz not null default now(),
  minute_count integer not null default 0
);
alter table public.place_search_usage enable row level security;
revoke all on public.place_search_usage from public, anon, authenticated;

-- Returns true if this lookup may go to Google. 200 a day, 30 a minute.
create or replace function public.use_place_search()
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_day integer;
  v_minute integer;
begin
  if v_uid is null then
    return false;
  end if;
  insert into public.place_search_usage as u (user_id, day, day_count, minute_start, minute_count)
  values (v_uid, current_date, 1, now(), 1)
  on conflict (user_id) do update set
    day_count = case when u.day = current_date then u.day_count + 1 else 1 end,
    day = current_date,
    minute_count = case when u.minute_start > now() - interval '1 minute' then u.minute_count + 1 else 1 end,
    minute_start = case when u.minute_start > now() - interval '1 minute' then u.minute_start else now() end
  returning u.day_count, u.minute_count into v_day, v_minute;
  return v_day <= 200 and v_minute <= 30;
end;
$$;
revoke all on function public.use_place_search() from public, anon;
grant execute on function public.use_place_search() to authenticated, service_role;

create or replace function public.limen_db_version()
returns text
language sql
stable
as $function$ select '20261113000001'::text $function$;
grant execute on function public.limen_db_version() to anon, authenticated;
