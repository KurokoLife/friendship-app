-- Graduation trigger + actions, built on last session's meetup_log/
-- mutual-confirmation foundation. Sourced directly from the real
-- blueprint text (re-extracted and re-read this session, not worked from
-- a prior summary), Table 36 / "Graduation copy" table:
--
--   "Trigger: five confirmed in-person meetings."
--   "Recommend exchanging phone numbers and using text or phone."
--   "Actions: Keep Chat Available, Move to Graduated, Not Yet."
--   "Do not force archival or remove Remember."
--   "Graduated connections no longer consume active capacity."
--   "Minimum analytics: Shown, Graduated, Not Yet, 30/90-day continuation"
--   "Optional 30- and 90-day check-in measures continued contact."
--
-- "Optional" is the source's own word for the 30/90-day piece,
-- distinguishing it from the rest of this table, which is Required MVP.
-- That's why the 30/90-day mechanism below is a lightweight, client-
-- driven measurement (see mark_graduation_continuation_checked), not a
-- new cron/notification subsystem: a real, working implementation of an
-- explicitly optional, thin spec line, not a guess dressed up as more
-- than what was actually asked for.

-- 'graduated' joins the existing status vocabulary. Same drop-and-check
-- pattern this constraint has already been extended with repeatedly.
alter table public.connections drop constraint if exists connections_status_check;
alter table public.connections add constraint connections_status_check
  check (status is null or status = any (array['pending', 'active', 'passed', 'inactive', 'paused', 'blocked', 'ended', 'graduated']));

alter table public.connections add column if not exists graduated_at timestamptz;
-- Re-trigger rule for "Not Yet" AND "Keep Chat Available" (a judgment
-- call, documented here rather than left implicit): both are treated the
-- same way for re-showing, don't nag again until meetup_count genuinely
-- grows past whatever it was when this was last dismissed, rather than a
-- fixed time-based cooldown. Storing the count itself (not a boolean or a
-- timestamp) means a connection that goes on to meet a 6th, 7th time
-- naturally re-earns a fresh graduation prompt, matching the milestone's
-- own real meaning, a pure time cooldown would either nag too often for
-- a connection stuck at 5 or never resurface a genuinely new milestone.
alter table public.connections add column if not exists graduation_dismissed_at_count integer not null default 0;
alter table public.connections add column if not exists graduation_30_day_checked boolean not null default false;
alter table public.connections add column if not exists graduation_90_day_checked boolean not null default false;

-- "Move to Graduated." Deliberately does NOT touch messages, Remember, or
-- anything else, "do not force archival or remove Remember" from the
-- spec is satisfied by this function simply never touching either.
create or replace function public.graduate_connection(p_connection_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
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

  update public.connections
  set status = 'graduated', graduated_at = now()
  where id = p_connection_id;
end;
$$;

-- Shared by "Keep Chat Available" and "Not Yet", the only difference
-- between the two is which analytics event the client fires, both leave
-- status untouched and both re-arm the prompt for the next confirmed
-- meetup via the same graduation_dismissed_at_count mechanism.
create or replace function public.dismiss_graduation_prompt(p_connection_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select meetup_count into v_count from public.connections
  where id = p_connection_id and (user_a_id = auth.uid() or user_b_id = auth.uid());
  if not found then
    raise exception 'Not a participant of this connection';
  end if;

  update public.connections set graduation_dismissed_at_count = v_count where id = p_connection_id;
end;
$$;

-- Optional 30/90-day continuation measurement. Client-driven (called from
-- Inbox's own load cycle, see inbox.tsx, which already visits every one
-- of the caller's connections on every focus), not a cron job: this
-- app's analytics (PostHog) only has a client-side integration
-- (src/lib/analytics.ts), a server-side cron has no path to actually
-- call track() short of standing up a whole new server-to-PostHog
-- integration for one optional spec line. Idempotent and safe to call
-- speculatively on every Inbox load for every graduated connection:
-- returns null (nothing to report) unless the specific checkpoint is
-- both genuinely due AND not yet recorded, and marks it recorded in the
-- same statement, so even if two loads race, only one ever gets a real
-- result back to actually fire track() with.
create or replace function public.check_and_mark_graduation_continuation(p_connection_id uuid, p_days integer)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_conn record;
  v_continued boolean;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if p_days not in (30, 90) then
    raise exception 'days must be 30 or 90';
  end if;

  select graduated_at, graduation_30_day_checked, graduation_90_day_checked
  into v_conn
  from public.connections
  where id = p_connection_id and (user_a_id = auth.uid() or user_b_id = auth.uid());
  if not found or v_conn.graduated_at is null then
    return null;
  end if;
  if p_days = 30 and v_conn.graduation_30_day_checked then
    return null;
  end if;
  if p_days = 90 and v_conn.graduation_90_day_checked then
    return null;
  end if;
  if now() < v_conn.graduated_at + (p_days || ' days')::interval then
    return null;
  end if;

  select exists (
    select 1 from public.messages m
    where m.connection_id = p_connection_id and m.created_at > v_conn.graduated_at
  ) into v_continued;

  if p_days = 30 then
    update public.connections set graduation_30_day_checked = true where id = p_connection_id;
  else
    update public.connections set graduation_90_day_checked = true where id = p_connection_id;
  end if;

  return v_continued;
end;
$$;

-- "Graduated connections no longer consume active capacity." Same
-- exclusion list both functions already shared, extended identically in
-- both places, re-read live via pg_get_functiondef before this edit,
-- bodies otherwise reproduced verbatim apart from the one addition.
create or replace function public.my_connection_capacity()
returns table(is_premium boolean, active_count integer, active_cap integer, pending_count integer, pending_cap integer)
language sql
stable
as $$
  select
    u.is_premium,
    (
      select count(*)::integer from public.connections c
      where (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
        and (c.status is null or c.status not in ('passed', 'inactive', 'paused', 'blocked', 'ended', 'graduated'))
        and exists (select 1 from public.messages m where m.connection_id = c.id and m.sender_id = auth.uid())
        and exists (select 1 from public.messages m where m.connection_id = c.id and m.sender_id <> auth.uid())
    ) as active_count,
    case when u.is_premium then 8 else 4 end as active_cap,
    (
      select count(*)::integer from public.connections c
      where (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
        and (c.status is null or c.status not in ('passed', 'inactive', 'paused', 'blocked', 'ended', 'graduated'))
        and exists (select 1 from public.messages m where m.connection_id = c.id and m.sender_id = auth.uid())
        and not exists (select 1 from public.messages m where m.connection_id = c.id and m.sender_id <> auth.uid())
    ) as pending_count,
    case when u.is_premium then 8 else 5 end as pending_cap
  from public.users u
  where u.id = auth.uid();
$$;

create or replace function public.create_connection_with_capacity_check(p_other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid;
  v_existing_id uuid;
  v_existing_status text;
  v_is_premium boolean;
  v_active_cap integer;
  v_pending_cap integer;
  v_active_count integer;
  v_pending_count integer;
  v_new_id uuid;
begin
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Not authenticated';
  end if;
  if v_caller = p_other_user_id then
    raise exception 'Cannot connect to yourself';
  end if;

  if exists (
    select 1 from public.blocks b
    where (b.blocker_id = v_caller and b.blocked_id = p_other_user_id)
       or (b.blocker_id = p_other_user_id and b.blocked_id = v_caller)
  ) then
    raise exception 'blocked';
  end if;

  select id, status into v_existing_id, v_existing_status
  from public.connections
  where (user_a_id = v_caller and user_b_id = p_other_user_id)
     or (user_a_id = p_other_user_id and user_b_id = v_caller)
  limit 1;

  if v_existing_id is not null then
    if v_existing_status = 'blocked' then
      raise exception 'blocked';
    end if;
    if v_existing_status = 'ended' then
      raise exception 'ended';
    end if;
    if v_existing_status is distinct from 'active' then
      update public.connections set status = 'pending' where id = v_existing_id;
    end if;
    return v_existing_id;
  end if;

  select coalesce(is_premium, false) into v_is_premium from public.users where id = v_caller;
  v_active_cap := case when v_is_premium then 8 else 4 end;
  v_pending_cap := case when v_is_premium then 8 else 5 end;

  select count(*) into v_active_count
  from public.connections c
  where (c.user_a_id = v_caller or c.user_b_id = v_caller)
    and (c.status is null or c.status not in ('passed', 'inactive', 'paused', 'blocked', 'ended', 'graduated'))
    and exists (select 1 from public.messages m where m.connection_id = c.id and m.sender_id = v_caller)
    and exists (select 1 from public.messages m where m.connection_id = c.id and m.sender_id <> v_caller);

  select count(*) into v_pending_count
  from public.connections c
  where (c.user_a_id = v_caller or c.user_b_id = v_caller)
    and (c.status is null or c.status not in ('passed', 'inactive', 'paused', 'blocked', 'ended', 'graduated'))
    and exists (select 1 from public.messages m where m.connection_id = c.id and m.sender_id = v_caller)
    and not exists (select 1 from public.messages m where m.connection_id = c.id and m.sender_id <> v_caller);

  if v_active_count >= v_active_cap then
    raise exception 'active_cap_reached';
  end if;
  if v_pending_count >= v_pending_cap then
    raise exception 'pending_cap_reached';
  end if;

  insert into public.connections (user_a_id, user_b_id, status)
  values (v_caller, p_other_user_id, 'pending')
  returning id into v_new_id;

  return v_new_id;
end;
$$;

-- Inbox spec: "Show last message, state and meetup count." meetup_count
-- was never exposed by this view before, added here as a trailing column
-- (CREATE OR REPLACE VIEW only allows appending, not inserting mid-list,
-- the same Postgres constraint earlier sessions already documented for
-- this exact view).
create or replace view public.inbox_conversations as
 SELECT c.id AS connection_id,
        CASE
            WHEN c.user_a_id = auth.uid() THEN c.user_b_id
            ELSE c.user_a_id
        END AS other_user_id,
    p.display_name,
    age_band(p.birthdate) AS age_band,
    p.life_transitions,
    c.status AS connection_status,
    lm.content AS last_message_content,
    lm.created_at AS last_message_at,
    lm.sender_id AS last_message_sender_id,
    (EXISTS ( SELECT 1
           FROM messages um
          WHERE um.connection_id = c.id AND um.sender_id <> auth.uid() AND um.read_at IS NULL)) AS has_unread,
    c.meetup_count
   FROM connections c
     JOIN profiles p ON p.user_id =
        CASE
            WHEN c.user_a_id = auth.uid() THEN c.user_b_id
            ELSE c.user_a_id
        END
     JOIN LATERAL ( SELECT m.content,
            m.created_at,
            m.sender_id
           FROM messages m
          WHERE m.connection_id = c.id
          ORDER BY m.created_at DESC
         LIMIT 1) lm ON true
  WHERE c.user_a_id = auth.uid() OR c.user_b_id = auth.uid();
