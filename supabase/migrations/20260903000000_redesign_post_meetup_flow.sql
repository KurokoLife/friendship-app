-- Part 3 of tonight's consolidated build: redesigned post-meetup flow.
--
-- 1. run_meetup_occurrence_check_v2: trigger timing changed from "the day
--    after the scheduled date" to "2 days after". Also now includes the
--    real confirmed_date in the meetup_occurrence_check payload, so the
--    client can show "Did you meet X on [date]?" without ever re-asking
--    the user for a date they already gave.
--
-- 2. cancel_meetup: fixes a real, confirmed bug. p_concern_resolution used
--    to only ever UPDATE an existing pre_meetup_concerns row, but nothing
--    in this app has ever called submit_pre_meetup_concern to CREATE one
--    (confirmed dead/unwired in a prior investigation this same evening),
--    so the day-of "Cancel this one" flow's own resolution was silently
--    discarded every time. Now inserts a real row (concern defaulted to
--    'other', since the day-of UI doesn't currently collect a specific
--    concern category before offering to cancel) when none exists yet,
--    instead of only ever updating one that was never created.
--
-- 3. meetup_cancellation_reasons + submit_meetup_cancellation_reason: a
--    deliberately SEPARATE, new mechanism for the new post-meetup "why was
--    it cancelled" question, not folded into pre_meetup_concerns. Judgment
--    call, not silently decided: pre_meetup_concerns' own category
--    vocabulary (awkwardness/low_energy/plan_too_big/safety/other) was
--    built for day-of hesitation BEFORE a meetup, and doesn't fit a
--    genuinely different question asked AFTER the date has already passed
--    ("why didn't this happen"). Same own-row-RLS, no-client-write pattern
--    this app already uses successfully for private per-connection
--    reflections (connection_end_reasons, first_meetup_feelings).
create or replace function public.run_meetup_occurrence_check_v2(p_connection_id uuid, p_now timestamptz default now())
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_status text;
  v_meetup record;
  v_report_count integer;
  v_any_action text := 'no_meetup_awaiting_occurrence';
begin
  select status into v_status from public.connections where id = p_connection_id;
  if not found or not public.is_connection_automation_eligible(v_status) then
    return 'connection_not_eligible';
  end if;

  for v_meetup in
    select m.*, c.user_a_id, c.user_b_id
    from public.meetups m join public.connections c on c.id = m.connection_id
    where m.connection_id = p_connection_id and m.status = 'confirmed'
      and m.confirmed_date is not null
      and (p_now at time zone 'utc')::date >= m.confirmed_date + 2
  loop
    select count(*) into v_report_count from public.meetup_occurrence_reports where meetup_id = v_meetup.id;

    if v_report_count = 0 then
      perform public.raise_intervention(p_connection_id, 'meetup_occurrence_check', v_meetup.user_a_id,
        jsonb_build_object('meetup_id', v_meetup.id, 'confirmed_date', v_meetup.confirmed_date));
      perform public.raise_intervention(p_connection_id, 'meetup_occurrence_check', v_meetup.user_b_id,
        jsonb_build_object('meetup_id', v_meetup.id, 'confirmed_date', v_meetup.confirmed_date));
      v_any_action := 'fired';

    elsif v_report_count = 1 and p_now - (v_meetup.confirmed_date::timestamptz) >= interval '7 days' then
      update public.meetups set status = 'unresolved' where id = v_meetup.id;
      perform public.record_friendship_event(p_connection_id, 'meetup_occurrence_unresolved', null,
        jsonb_build_object('meetup_id', v_meetup.id));
      update public.connection_interventions
        set status = 'expired'
        where connection_id = p_connection_id and intervention_type = 'meetup_occurrence_check'
          and status = 'pending' and payload->>'meetup_id' = v_meetup.id::text;
      v_any_action := 'timed_out_unresolved';
    end if;
  end loop;

  return v_any_action;
end;
$$;

create or replace function public.cancel_meetup(p_meetup_id uuid, p_concern_resolution text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid := auth.uid();
  v_meetup record;
  v_updated integer;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;

  select m.*, m.connection_id as conn_id into v_meetup
  from public.meetups m
  where m.id = p_meetup_id and exists (
    select 1 from public.connections c
    where c.id = m.connection_id and (c.user_a_id = v_caller or c.user_b_id = v_caller)
  );
  if not found then raise exception 'Not a participant of this meetup''s connection'; end if;
  if v_meetup.status not in ('proposed','confirmed') then
    raise exception 'Only a proposed or confirmed meetup can be cancelled';
  end if;

  update public.meetups set status = 'cancelled' where id = p_meetup_id;

  if p_concern_resolution is not null then
    update public.pre_meetup_concerns
    set resolution = p_concern_resolution
    where meetup_id = p_meetup_id and user_id = v_caller and resolution is null;
    get diagnostics v_updated = row_count;
    if v_updated = 0 then
      insert into public.pre_meetup_concerns (connection_id, user_id, meetup_id, concern, resolution)
      values (v_meetup.conn_id, v_caller, p_meetup_id, 'other', p_concern_resolution);
    end if;
  end if;

  perform public.record_friendship_event(v_meetup.conn_id, 'meetup_cancelled', v_caller,
    jsonb_build_object('meetup_id', p_meetup_id));
end;
$$;

create table public.meetup_cancellation_reasons (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.connections(id) on delete cascade,
  user_id uuid not null references public.users(id),
  meetup_id uuid not null references public.meetups(id) on delete cascade,
  reason text not null check (reason in ('schedule_conflict','circumstances_changed','lost_interest','other')),
  wants_reschedule boolean,
  created_at timestamptz not null default now()
);

alter table public.meetup_cancellation_reasons enable row level security;
create policy "Users can read their own meetup cancellation reasons"
  on public.meetup_cancellation_reasons for select using (auth.uid() = user_id);
-- No client insert/update: only submit_meetup_cancellation_reason() (below,
-- SECURITY DEFINER) writes here, matching connection_end_reasons' own
-- precedent for a private, structurally-never-shared-with-the-other-
-- participant reason.

create or replace function public.submit_meetup_cancellation_reason(
  p_meetup_id uuid, p_reason text, p_wants_reschedule boolean default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid := auth.uid();
  v_conn_id uuid;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if p_reason not in ('schedule_conflict','circumstances_changed','lost_interest','other') then
    raise exception 'Unknown reason';
  end if;

  select m.connection_id into v_conn_id from public.meetups m
  where m.id = p_meetup_id and exists (
    select 1 from public.connections c where c.id = m.connection_id and (c.user_a_id = v_caller or c.user_b_id = v_caller)
  );
  if v_conn_id is null then raise exception 'Not a participant of this meetup''s connection'; end if;

  insert into public.meetup_cancellation_reasons (connection_id, user_id, meetup_id, reason, wants_reschedule)
  values (v_conn_id, v_caller, p_meetup_id, p_reason, p_wants_reschedule);
end;
$$;
