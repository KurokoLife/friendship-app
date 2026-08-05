-- Persists the not_good MeetupOutcomeCard's "Not now" dismissal, replacing
-- the client-only `dismissedCheckinId` state added in the earlier fix.
-- Found (2026-07-28 investigation) that this app's Back button always
-- calls router.replace(), never push()/back(), so the thread screen is
-- never preserved across a real exit and re-entry the way a tab screen
-- is, meaning the previous local-state dismiss resurfaced on nearly every
-- real visit to the thread, not just "until I navigate away and back" as
-- intended.
--
-- Modeled on rhythm_mismatch_dismissals (20260715000000), NOT on
-- no_ghost_prompts: this is a pure personal record with no cross-
-- participant reconciliation logic (no_ghost_prompts needs SECURITY
-- DEFINER RPCs specifically because its writes have to navigate
-- connections' own asymmetric update RLS and coordinate two
-- participants' rows; a dismissal here is one user marking one row that
-- already belongs to them, nothing to coordinate). Scoped by checkin_id
-- rather than connection_id: a meetup_checkins row already belongs to
-- exactly one participant (one row per (connection_id, user_id)), so
-- checkin_id alone is enough to identify both "which cycle" and
-- "whose row", no separate connection-membership check is needed beyond
-- confirming the checkin itself is the caller's own.
create table if not exists public.meetup_outcome_dismissals (
  checkin_id uuid not null references public.meetup_checkins (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  dismissed_at timestamptz not null default now(),
  primary key (checkin_id, user_id)
);

alter table public.meetup_outcome_dismissals enable row level security;

create policy "Users can read their own outcome dismissal"
  on public.meetup_outcome_dismissals for select
  using (user_id = auth.uid());

create policy "Users can dismiss their own outcome card"
  on public.meetup_outcome_dismissals for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.meetup_checkins mc
      where mc.id = meetup_outcome_dismissals.checkin_id
        and mc.user_id = auth.uid()
    )
  );

-- get_meetup_checkin_status gains one more field, outcome_dismissed, read
-- directly off this new table for the caller's own checkin row. Return
-- type changes (a column added), so this has to be dropped and recreated
-- rather than CREATE OR REPLACE, same reason the 2026-08-01 fix had to
-- drop run_meetup_checkin_check to change void to text.
drop function if exists public.get_meetup_checkin_status(uuid);

create or replace function public.get_meetup_checkin_status(p_connection_id uuid)
returns table (
  checkin_id uuid,
  my_outcome text,
  my_resolved_at timestamptz,
  other_reported_outcome text,
  other_outcome text,
  other_resolved boolean,
  mutually_confirmed_occurred boolean,
  branch text,
  outcome_dismissed boolean
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
  outcome_dismissed := exists (
    select 1 from public.meetup_outcome_dismissals d
    where d.checkin_id = v_my.id and d.user_id = auth.uid()
  );

  return next;
end;
$$;

grant execute on function public.get_meetup_checkin_status(uuid) to authenticated;
