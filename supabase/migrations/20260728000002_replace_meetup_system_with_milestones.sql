-- Replaces the entire date-anchored meetup system with a milestone and
-- elapsed-time based one. Confirmed by direct investigation before this
-- migration was written (not assumed): meetup_count was never written by
-- any code path, logged_at was never set, status never reached
-- 'completed', and the day-of check-in only ever confirmed that a prompt
-- was answered, never that a meetup actually happened. Rather than patch
-- that machinery, this replaces it, per three hard constraints that ruled
-- out fixing it: no intrusive date-entry form, no reading message content
-- to infer a date, and no way for the app to know "the right moment" to
-- fire a day-of or post-meetup prompt without a precise date, which the
-- first two constraints make impossible to collect cleanly.
--
-- Collateral scope found during this work, not in the original ask:
-- F21 (pre-meetup curiosity), F24 (calendar opt-in), and the second-
-- cancellation intervention (cancellation_interventions, fired by
-- cancel_meetup) are ALL built entirely around a specific scheduled_at/
-- confirmed_at date that this redesign never collects again. Confirmed
-- with the user directly before proceeding: remove their dead wiring
-- along with the rest, rather than leave them disconnected in place.

-- ================= Part 1: remove the old system =================

drop function if exists public.propose_meetup(uuid, timestamptz, text);
drop function if exists public.confirm_meetup(uuid);
drop function if exists public.decline_meetup(uuid);
drop function if exists public.cancel_meetup(uuid, text);

select cron.unschedule('day-of-checkin-check');

drop table if exists public.cancellation_interventions;
drop table if exists public.day_of_checkins;
drop table if exists public.calendar_optin_responses;
drop table if exists public.pre_meetup_curiosity_prompts;
drop table if exists public.meetups;

-- ================= Part 2: the new milestone/elapsed-time system =================

-- Tracks the last time either participant actually engaged with
-- planning (opened the planner, picked or sent an activity idea), the
-- one signal the new system anchors to instead of a specific date. Null
-- means "never engaged," which is exactly the first-time milestone
-- condition record_plan_activity checks for below.
alter table public.connections
  add column if not exists last_plan_activity_at timestamptz;

-- meetup_count already existed on this table (added when connections was
-- first created) but was confirmed dead, never written anywhere. Kept,
-- not dropped and recreated, since it's already the right shape (a plain
-- integer counter) for what it becomes now: incremented for real, only
-- by resolve_meetup_checkin below, only on a mutually confirmed
-- 'went_well' outcome. No column change needed, only real code finally
-- writing to it.

-- Private self-report at the first-time milestone ("How are you feeling
-- about this?"). Never shared with the other participant, matching
-- AGENTS.md's own principle that the app never shares a user's private
-- feelings without their explicit choice, the same stance
-- pre_meetup_curiosity_prompts held before it was removed above. Plain
-- direct-client-write table (own row only, no cross-participant write
-- asymmetry to work around here), same pattern as
-- calendar_optin_responses used before it was removed.
create table public.first_meetup_feelings (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.connections (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  feeling text not null check (feeling in ('excited', 'neutral', 'nervous')),
  created_at timestamptz not null default now(),
  unique (connection_id, user_id)
);

alter table public.first_meetup_feelings enable row level security;

create policy "Users can read their own first-meetup feeling"
  on public.first_meetup_feelings for select
  using (auth.uid() = user_id);

create policy "Users can record their own first-meetup feeling"
  on public.first_meetup_feelings for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own first-meetup feeling"
  on public.first_meetup_feelings for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- The elapsed-time check-in. One row per connection per participant per
-- cycle (a "cycle" ends whenever record_plan_activity fires again, which
-- clears these rows so the next cycle starts clean). outcome is each
-- person's own private answer; other_reported_outcome is set on a row
-- only when the OTHER participant already reported a positive-claiming
-- outcome (went_well/rough) before this user answered, so their own
-- prompt can show the confirm-or-correct framing instead of a blank ask.
-- Read-only for clients, same convention as no_ghost_prompts/
-- follow_up_reflections: every write goes through a SECURITY DEFINER
-- function below, both to keep the reconciliation logic in one place and
-- to sidestep connections' own asymmetric update RLS.
create table public.meetup_checkins (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.connections (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  fired_at timestamptz not null default now(),
  resolved_at timestamptz,
  outcome text check (outcome in ('went_well', 'rough', 'didnt_happen', 'still_figuring')),
  other_reported_outcome text check (other_reported_outcome in ('went_well', 'rough')),
  unique (connection_id, user_id)
);

alter table public.meetup_checkins enable row level security;

create policy "Users can read their own meetup checkin"
  on public.meetup_checkins for select
  using (auth.uid() = user_id);

-- Records real engagement with "Let's plan something" (opened, an idea
-- picked, etc.) and returns whether this was the first time ever for
-- this connection, the client uses that to decide whether to show the
-- first-time milestone (self-report + Guide nudge). Also clears any
-- leftover checkin rows from a previous cycle, so a fresh 7-day window
-- starts counting from this new activity instead of firing immediately
-- off stale state.
create or replace function public.record_plan_activity(p_connection_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_was_null boolean;
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

  select last_plan_activity_at is null into v_was_null
  from public.connections where id = p_connection_id;

  update public.connections set last_plan_activity_at = now() where id = p_connection_id;

  delete from public.meetup_checkins where connection_id = p_connection_id;

  return coalesce(v_was_null, true);
end;
$$;

-- The scheduled evaluator: fires a checkin row for BOTH participants once
-- at least ~1 week has passed since last_plan_activity_at with no more
-- recent activity, and only once per cycle (a row already existing for
-- this connection means this cycle already fired, since
-- record_plan_activity clears rows at the start of each new cycle).
-- Paused/inactive/passed connections are skipped, same guard no-ghost's
-- own evaluator uses, for the same reason: a paused connection's timer
-- should genuinely stop, not just hide in the UI.
create or replace function public.run_meetup_checkin_check(p_connection_id uuid, p_now timestamptz default now())
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conn record;
begin
  select last_plan_activity_at, user_a_id, user_b_id, status
  into v_conn
  from public.connections
  where id = p_connection_id;

  if not found or v_conn.last_plan_activity_at is null then
    return;
  end if;

  if v_conn.status is not null and v_conn.status in ('paused', 'inactive', 'passed') then
    return;
  end if;

  if p_now - v_conn.last_plan_activity_at < interval '7 days' then
    return;
  end if;

  if exists (select 1 from public.meetup_checkins where connection_id = p_connection_id) then
    return;
  end if;

  insert into public.meetup_checkins (connection_id, user_id, fired_at)
  values
    (p_connection_id, v_conn.user_a_id, p_now),
    (p_connection_id, v_conn.user_b_id, p_now);
end;
$$;

create or replace function public.run_meetup_checkin_check_all(p_now timestamptz default now())
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conn record;
begin
  for v_conn in
    select id from public.connections
    where last_plan_activity_at is not null
      and (status is null or status not in ('paused', 'inactive', 'passed'))
  loop
    perform public.run_meetup_checkin_check(v_conn.id, p_now);
  end loop;
end;
$$;

-- Dev-only: force the evaluator for one connection with a real or
-- simulated p_now, bypassing nothing except the 7-day wait itself (the
-- caller supplies p_now), same shape as dev_run_no_ghost_check.
create or replace function public.dev_run_meetup_checkin_check(p_connection_id uuid, p_now timestamptz)
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

  perform public.run_meetup_checkin_check(p_connection_id, p_now);
end;
$$;

-- Dev-only: clears checkin state for a connection so a test can be
-- re-run without waiting for a fresh planning cycle.
create or replace function public.dev_reset_meetup_checkins(p_connection_id uuid)
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

  delete from public.meetup_checkins where connection_id = p_connection_id;
end;
$$;

-- Dev-only: directly backdates last_plan_activity_at without needing a
-- real "Let's plan something" engagement first, for setting up a
-- specific test scenario quickly.
create or replace function public.dev_set_last_plan_activity(p_connection_id uuid, p_hours_ago numeric)
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

  update public.connections
  set last_plan_activity_at = now() - (p_hours_ago * interval '1 hour')
  where id = p_connection_id;
end;
$$;

-- Resolves the caller's own checkin with their honest outcome, and
-- reconciles against the other participant's row:
-- - If the other side hasn't answered yet, and this outcome claims a
--   meetup happened (went_well/rough), tag the other side's row so their
--   own prompt shows the confirm-or-correct framing instead of a blank
--   self-report.
-- - If the other side already answered, reconcile right now: only when
--   BOTH sides say the meetup happened (went_well or rough, in either
--   combination) is it treated as mutually confirmed, and only when BOTH
--   sides specifically say 'went_well' does the real counter increment.
--   A genuine disagreement (one side says it happened, the other says it
--   didn't) is left unresolved into a branch on purpose, not forced into
--   either bucket, there's no honest way to pick a side automatically.
create or replace function public.resolve_meetup_checkin(p_checkin_id uuid, p_outcome text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_other record;
  v_other_found boolean;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if p_outcome not in ('went_well', 'rough', 'didnt_happen', 'still_figuring') then
    raise exception 'Unknown outcome: %', p_outcome;
  end if;

  select * into v_row from public.meetup_checkins where id = p_checkin_id;
  if not found then
    raise exception 'Checkin not found';
  end if;
  if v_row.user_id <> auth.uid() then
    raise exception 'Not your checkin';
  end if;

  update public.meetup_checkins set outcome = p_outcome, resolved_at = now() where id = p_checkin_id;

  select * into v_other
  from public.meetup_checkins
  where connection_id = v_row.connection_id and user_id <> v_row.user_id;
  v_other_found := found;

  if not v_other_found then
    return;
  end if;

  if v_other.resolved_at is null then
    if p_outcome in ('went_well', 'rough') then
      update public.meetup_checkins set other_reported_outcome = p_outcome where id = v_other.id;
    end if;
  else
    if p_outcome in ('went_well', 'rough') and v_other.outcome in ('went_well', 'rough') then
      if p_outcome = 'went_well' and v_other.outcome = 'went_well' then
        update public.connections set meetup_count = meetup_count + 1 where id = v_row.connection_id;
      end if;
    end if;
  end if;
end;
$$;

-- Read-side companion: computes the caller's current checkin state plus
-- whatever can be known about mutual resolution, so the client can show
-- the right card (still waiting, confirm-or-correct, or a resolved
-- branch) whenever the thread loads, not only at the exact moment the
-- caller personally resolves their own row.
create or replace function public.get_meetup_checkin_status(p_connection_id uuid)
returns table (
  checkin_id uuid,
  my_outcome text,
  my_resolved_at timestamptz,
  other_reported_outcome text,
  other_outcome text,
  other_resolved boolean,
  mutually_confirmed_occurred boolean,
  branch text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_my record;
  v_other record;
  v_other_found boolean;
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

  select * into v_my from public.meetup_checkins where connection_id = p_connection_id and user_id = auth.uid();
  if not found then
    return;
  end if;

  select * into v_other
  from public.meetup_checkins
  where connection_id = p_connection_id and user_id <> auth.uid();
  v_other_found := found;

  checkin_id := v_my.id;
  my_outcome := v_my.outcome;
  my_resolved_at := v_my.resolved_at;
  other_reported_outcome := v_my.other_reported_outcome;
  other_outcome := case when v_other_found and v_other.resolved_at is not null then v_other.outcome else null end;
  other_resolved := v_other_found and v_other.resolved_at is not null;
  mutually_confirmed_occurred :=
    v_my.outcome in ('went_well', 'rough')
    and other_resolved
    and v_other.outcome in ('went_well', 'rough');
  branch := case
    when mutually_confirmed_occurred and v_my.outcome = 'went_well' and v_other.outcome = 'went_well' then 'good'
    when mutually_confirmed_occurred then 'not_good'
    else null
  end;

  return next;
end;
$$;

grant execute on function public.record_plan_activity(uuid) to authenticated;
grant execute on function public.run_meetup_checkin_check(uuid, timestamptz) to authenticated;
grant execute on function public.run_meetup_checkin_check_all(timestamptz) to authenticated;
grant execute on function public.dev_run_meetup_checkin_check(uuid, timestamptz) to authenticated;
grant execute on function public.dev_reset_meetup_checkins(uuid) to authenticated;
grant execute on function public.dev_set_last_plan_activity(uuid, numeric) to authenticated;
grant execute on function public.resolve_meetup_checkin(uuid, text) to authenticated;
grant execute on function public.get_meetup_checkin_status(uuid) to authenticated;

-- Hourly, same cadence and reasoning as follow-up-reflection-check: this
-- works on a multi-day window, hourly granularity is plenty.
select cron.schedule(
  'meetup-checkin-check',
  '0 * * * *',
  $$select public.run_meetup_checkin_check_all();$$
);
