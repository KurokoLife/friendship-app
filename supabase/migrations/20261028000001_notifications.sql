-- 2026-10-28: Rebuild stage 3b, Notifications (docs/context/05_LIMEN_REBUILD.md,
-- "Notifications (decided Oct 25)"). Safe to run twice.
-- limen_db_version() -> 20261028000001.
--
-- Until now Limen sent nothing outside the app. This adds:
--   1. notification_settings: per type (a new hi, new messages, plans and
--      meetups, suggestions) and per channel (phone, email), plus quiet hours
--      in the person's own time zone. Gentle defaults: everything on, nothing
--      from 9pm to 8am. Every type can be turned off.
--   2. push_tokens: the phone app's push address (Expo), one per phone.
--   3. notification_outbox: what is waiting to go out. Filled by the
--      database itself (new messages, plans, suggestions); emptied by the
--      send-notifications server function every few minutes. Nobody can read
--      it from the app.
-- Privacy: a notification never carries message text. It says "New message
-- from Tom", "Tom said hello", or for suggestions only the name and the plain
-- line. SMS is never used for reminders.

-- 1. Settings ----------------------------------------------------------------------
create table if not exists public.notification_settings (
  user_id uuid primary key references public.users(id) on delete cascade,
  hi_push boolean not null default true,
  hi_email boolean not null default true,
  message_push boolean not null default true,
  message_email boolean not null default true,
  plan_push boolean not null default true,
  plan_email boolean not null default true,
  suggestion_push boolean not null default true,
  suggestion_email boolean not null default true,
  quiet_on boolean not null default true,
  quiet_start smallint not null default 21,
  quiet_end smallint not null default 8,
  time_zone text,
  updated_at timestamptz not null default now()
);
alter table public.notification_settings drop constraint if exists notification_settings_hours;
alter table public.notification_settings add constraint notification_settings_hours
  check (quiet_start between 0 and 23 and quiet_end between 0 and 23);
alter table public.notification_settings drop constraint if exists notification_settings_tz_length;
alter table public.notification_settings add constraint notification_settings_tz_length
  check (time_zone is null or char_length(time_zone) <= 64);
alter table public.notification_settings enable row level security;
drop policy if exists "Notification settings: own read" on public.notification_settings;
create policy "Notification settings: own read" on public.notification_settings
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "Notification settings: own add" on public.notification_settings;
create policy "Notification settings: own add" on public.notification_settings
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "Notification settings: own change" on public.notification_settings;
create policy "Notification settings: own change" on public.notification_settings
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.notification_settings from anon;
grant select, insert, update on public.notification_settings to authenticated;

-- The phone's time zone, saved when the app opens, so quiet hours and
-- suggestions follow the person's own clock.
create or replace function public.set_my_time_zone(p_tz text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null or nullif(trim(p_tz), '') is null then return; end if;
  -- Only real zone names.
  if not exists (select 1 from pg_timezone_names where name = p_tz) then return; end if;
  insert into public.notification_settings (user_id, time_zone) values (auth.uid(), p_tz)
  on conflict (user_id) do update set time_zone = excluded.time_zone, updated_at = now()
  where notification_settings.time_zone is distinct from excluded.time_zone;
end;
$$;
grant execute on function public.set_my_time_zone(text) to authenticated;

-- 2. Push tokens ---------------------------------------------------------------------
create table if not exists public.push_tokens (
  token text primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  platform text,
  updated_at timestamptz not null default now()
);
alter table public.push_tokens drop constraint if exists push_tokens_token_length;
alter table public.push_tokens add constraint push_tokens_token_length check (char_length(token) <= 300);
alter table public.push_tokens enable row level security;
drop policy if exists "Push tokens: own read" on public.push_tokens;
create policy "Push tokens: own read" on public.push_tokens
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "Push tokens: own remove" on public.push_tokens;
create policy "Push tokens: own remove" on public.push_tokens
  for delete to authenticated using (user_id = auth.uid());
revoke all on public.push_tokens from anon;
grant select, delete on public.push_tokens to authenticated;

-- A phone signs in: its token now belongs to whoever is signed in on it.
create or replace function public.register_push_token(p_token text, p_platform text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_token is null or char_length(p_token) > 300 or p_token !~ '^Expo(nent)?PushToken\[' then
    raise exception 'bad_token';
  end if;
  insert into public.push_tokens (token, user_id, platform) values (p_token, auth.uid(), left(p_platform, 20))
  on conflict (token) do update set user_id = auth.uid(), platform = excluded.platform, updated_at = now();
end;
$$;
grant execute on function public.register_push_token(text, text) to authenticated;

-- 3. The outbox ------------------------------------------------------------------------
create table if not exists public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  type text not null,
  title text not null,
  path text not null default '/circle',
  connection_id uuid,
  created_at timestamptz not null default now(),
  done_at timestamptz,
  pushed boolean,
  emailed boolean,
  attempts integer not null default 0,
  last_error text
);
alter table public.notification_outbox drop constraint if exists notification_outbox_type;
alter table public.notification_outbox add constraint notification_outbox_type
  check (type in ('hi', 'message', 'plan', 'suggestion'));
create index if not exists notification_outbox_waiting on public.notification_outbox (created_at) where done_at is null;
create index if not exists notification_outbox_user on public.notification_outbox (user_id, connection_id, created_at desc);
alter table public.notification_outbox enable row level security;
revoke all on public.notification_outbox from anon, authenticated;

-- Someone's first name as people see it (display_name is "Maria S.").
create or replace function public._notify_name(p_user uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(nullif(trim((select display_name from public.profiles where user_id = p_user)), ''), 'Someone');
$$;
revoke all on function public._notify_name(uuid) from public, anon, authenticated;

create or replace function public._queue_notification(p_user uuid, p_type text, p_title text, p_path text, p_connection uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_user is null then return; end if;
  if exists (select 1 from public.users where id = p_user and suspended_at is not null) then return; end if;
  -- Messages: at most one notification per chat an hour, so a lively chat
  -- doesn't buzz on every line.
  if p_type in ('message', 'hi') and exists (
    select 1 from public.notification_outbox o
    where o.user_id = p_user and o.connection_id = p_connection and o.type in ('message', 'hi')
      and o.created_at > now() - interval '1 hour'
  ) then
    return;
  end if;
  insert into public.notification_outbox (user_id, type, title, path, connection_id)
  values (p_user, p_type, p_title, coalesce(p_path, '/circle'), p_connection);
end;
$$;
revoke all on function public._queue_notification(uuid, text, text, text, uuid) from public, anon, authenticated;

-- 4. What creates a notification --------------------------------------------------------
-- A message: "Tom said hello" for someone's first message in a chat, "New
-- message from Tom" after that, "Tom invited you to plan something" for an
-- invite. Never the text itself.
create or replace function public._notify_on_message()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_to uuid;
  v_name text;
begin
  select case when c.user_a_id = new.sender_id then c.user_b_id else c.user_a_id end
  into v_to from public.connections c where c.id = new.connection_id;
  if v_to is null or v_to = new.sender_id then return new; end if;
  v_name := public._notify_name(new.sender_id);
  if new.type = 'plan_invite' then
    perform public._queue_notification(v_to, 'plan', v_name || ' invited you to plan something', '/thread/' || new.connection_id, new.connection_id);
  elsif not exists (select 1 from public.messages m
                    where m.connection_id = new.connection_id and m.sender_id = new.sender_id and m.id <> new.id) then
    perform public._queue_notification(v_to, 'hi', v_name || ' said hello', '/thread/' || new.connection_id, new.connection_id);
  else
    perform public._queue_notification(v_to, 'message', 'New message from ' || v_name, '/thread/' || new.connection_id, new.connection_id);
  end if;
  return new;
exception when others then
  -- A notification must never stop a message from being sent.
  return new;
end;
$$;
drop trigger if exists messages_notify on public.messages;
create trigger messages_notify after insert on public.messages
  for each row execute function public._notify_on_message();

-- Plans: a time suggested, a plan set, a plan cancelled. The person who did
-- it isn't notified.
create or replace function public._notify_on_meetup()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  c record;
  v_actor uuid;
  v_user uuid;
  v_other uuid;
  v_title text;
begin
  select user_a_id, user_b_id into c from public.connections where id = new.connection_id;
  if not found then return new; end if;
  if tg_op = 'INSERT' then
    if new.status <> 'proposed' or coalesce(new.logged_after, false) then return new; end if;
    v_actor := new.proposed_by;
  elsif new.status is distinct from old.status and new.status in ('confirmed', 'cancelled') then
    v_actor := case when new.status = 'confirmed' then coalesce(new.confirmed_by, auth.uid()) else auth.uid() end;
  else
    return new;
  end if;
  foreach v_user in array array[c.user_a_id, c.user_b_id] loop
    continue when v_user = v_actor;
    v_other := case when v_user = c.user_a_id then c.user_b_id else c.user_a_id end;
    v_title := case
      when tg_op = 'INSERT' then public._notify_name(v_other) || ' suggested a time to meet'
      when new.status = 'confirmed' then 'Your plan with ' || public._notify_name(v_other) || ' is set'
      else 'Your plan with ' || public._notify_name(v_other) || ' was cancelled'
    end;
    perform public._queue_notification(v_user, 'plan', v_title, '/thread/' || new.connection_id, new.connection_id);
  end loop;
  return new;
exception when others then
  return new;
end;
$$;
drop trigger if exists meetups_notify on public.meetups;
create trigger meetups_notify after insert or update of status on public.meetups
  for each row execute function public._notify_on_meetup();

-- Suggestions: the plain line only (keep in step with suggestionLine in
-- src/lib/suggestions.ts; notes are never quoted in a notification).
create or replace function public._suggestion_notify_line(p_kind text, p_name text)
returns text
language sql
immutable
as $$
  select case p_kind
    when 'interest' then 'You wanted to ask ' || p_name || ' something.'
    when 'support' then 'How''s it going with ' || p_name || ', do you think?'
    when 'positivity' then 'Anything ' || p_name || ' did lately that you''d tell them was good?'
    when 'openness' then 'Anything going on with you that ' || p_name || ' doesn''t know yet?'
    when 'time_together' then 'When did you and ' || p_name || ' last get together?'
    when 'pattern' then 'A short question about your check-ins.'
    else 'You and ' || p_name || ' haven''t been in touch for a while.'
  end;
$$;

-- Run by the send-notifications function: starts each person's next
-- suggestion when it's time (the same get_circle_suggestion rule and
-- frequency as in the app) and queues one notification for it. A suggestion
-- that's already open was notified when it started.
create or replace function public.queue_suggestion_notifications()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
  v_before uuid;
  v_s jsonb;
  v_n integer := 0;
  v_name text;
begin
  for r in
    select u.id, coalesce(ns.time_zone, 'UTC') as tz
    from public.users u
    left join public.notification_settings ns on ns.user_id = u.id
    where u.suspended_at is null and u.readiness_status is not null
      and (coalesce(ns.suggestion_push, true) or coalesce(ns.suggestion_email, true))
      and coalesce((select frequency from public.circle_suggestion_settings s where s.user_id = u.id), 'week') <> 'off'
      and (exists (select 1 from public.outside_friends f where f.user_id = u.id)
           or exists (select 1 from public.connections c where u.id in (c.user_a_id, c.user_b_id) and c.status in ('pending', 'active', 'graduated')))
  loop
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', r.id, 'role', 'authenticated')::text, true);
      select id into v_before from public.circle_suggestions where user_id = r.id and resolved_at is null;
      v_s := public.get_circle_suggestion(r.tz);
      if v_s is not null and v_before is null then
        v_name := split_part(coalesce(v_s->>'name', ''), ' ', 1);
        perform public._queue_notification(r.id, 'suggestion',
          public._suggestion_notify_line(v_s->>'kind', nullif(v_name, '')), '/circle', null);
        v_n := v_n + 1;
      end if;
    exception when others then
      null;
    end;
  end loop;
  perform set_config('request.jwt.claims', '', true);
  return v_n;
end;
$$;
revoke all on function public.queue_suggestion_notifications() from public, anon, authenticated;
grant execute on function public.queue_suggestion_notifications() to service_role;

-- 5. Sending ---------------------------------------------------------------------------
-- Is it quiet hours for this person right now?
create or replace function public._in_quiet_hours(p_on boolean, p_start smallint, p_end smallint, p_tz text, p_now timestamptz default now())
returns boolean
language plpgsql
stable
as $$
declare
  v_hour integer;
begin
  if not coalesce(p_on, true) then return false; end if;
  begin
    v_hour := extract(hour from (p_now at time zone coalesce(nullif(p_tz, ''), 'America/Los_Angeles')))::integer;
  exception when others then
    v_hour := extract(hour from (p_now at time zone 'America/Los_Angeles'))::integer;
  end;
  if p_start = p_end then return false; end if;
  if p_start < p_end then return v_hour >= p_start and v_hour < p_end; end if;
  return v_hour >= p_start or v_hour < p_end;
end;
$$;

-- What's ready to go out now, with where to send it. Waits through quiet
-- hours. Something nobody could receive (both channels off, no phone and no
-- email) is put away here. Anything older than 2 days is let go.
create or replace function public.notifications_to_send(p_limit integer default 200, p_now timestamptz default now())
returns table (id uuid, user_id uuid, type text, title text, path text, push_tokens text[], email text)
language plpgsql
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
begin
  update public.notification_outbox o set done_at = p_now, last_error = 'too_old'
  where o.done_at is null and o.created_at < p_now - interval '2 days';

  return query
  with waiting as (
    select o.id, o.user_id, o.type, o.title, o.path,
      case o.type when 'hi' then coalesce(ns.hi_push, true) when 'message' then coalesce(ns.message_push, true)
                  when 'plan' then coalesce(ns.plan_push, true) else coalesce(ns.suggestion_push, true) end as want_push,
      case o.type when 'hi' then coalesce(ns.hi_email, true) when 'message' then coalesce(ns.message_email, true)
                  when 'plan' then coalesce(ns.plan_email, true) else coalesce(ns.suggestion_email, true) end as want_email,
      public._in_quiet_hours(coalesce(ns.quiet_on, true), coalesce(ns.quiet_start, 21::smallint), coalesce(ns.quiet_end, 8::smallint), ns.time_zone, p_now) as quiet,
      (select array_agg(t.token) from public.push_tokens t where t.user_id = o.user_id) as tokens,
      nullif(trim(u.email), '') as addr
    from public.notification_outbox o
    join public.users u on u.id = o.user_id
    left join public.notification_settings ns on ns.user_id = o.user_id
    where o.done_at is null and u.suspended_at is null
    order by o.created_at
    limit greatest(1, least(p_limit, 500))
  ),
  nobody as (
    update public.notification_outbox o set done_at = p_now, last_error = 'nowhere_to_send'
    from waiting w
    where o.id = w.id and not w.quiet
      and not ((w.want_push and w.tokens is not null) or (w.want_email and w.addr is not null))
    returning o.id
  )
  select w.id, w.user_id, w.type, w.title, w.path,
         case when w.want_push then w.tokens else null end,
         case when w.want_email then w.addr else null end
  from waiting w
  where not w.quiet
    and ((w.want_push and w.tokens is not null) or (w.want_email and w.addr is not null))
    and not exists (select 1 from nobody n where n.id = w.id);
end;
$$;
revoke all on function public.notifications_to_send(integer, timestamptz) from public, anon, authenticated;
grant execute on function public.notifications_to_send(integer, timestamptz) to service_role;

create or replace function public.mark_notification_sent(p_id uuid, p_pushed boolean, p_emailed boolean, p_error text default null)
returns void
language sql
security definer
set search_path to 'public'
as $$
  update public.notification_outbox
  set done_at = now(), pushed = p_pushed, emailed = p_emailed, attempts = attempts + 1, last_error = left(p_error, 300)
  where id = p_id;
$$;
revoke all on function public.mark_notification_sent(uuid, boolean, boolean, text) from public, anon, authenticated;
grant execute on function public.mark_notification_sent(uuid, boolean, boolean, text) to service_role;

-- A phone that no longer has the app (Expo says DeviceNotRegistered).
create or replace function public.forget_push_token(p_token text)
returns void
language sql
security definer
set search_path to 'public'
as $$
  delete from public.push_tokens where token = p_token;
$$;
revoke all on function public.forget_push_token(text) from public, anon, authenticated;
grant execute on function public.forget_push_token(text) to service_role;

-- 6. Test tab: a test notification to yourself ---------------------------------------
create or replace function public.test_notify_me()
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_test_operator() then raise exception 'Test tools are only for admins and test accounts'; end if;
  insert into public.notification_outbox (user_id, type, title, path)
  values (auth.uid(), 'plan', 'A test notification from Limen', '/circle');
  return case
    when exists (select 1 from public.push_tokens where user_id = auth.uid()) then 'queued_push'
    when exists (select 1 from public.users where id = auth.uid() and nullif(trim(email), '') is not null) then 'queued_email'
    else 'nowhere' end;
end;
$$;
grant execute on function public.test_notify_me() to authenticated;

create or replace function public.limen_db_version()
returns text
language sql
stable
as $function$ select '20261028000001'::text $function$;
grant execute on function public.limen_db_version() to anon, authenticated;
