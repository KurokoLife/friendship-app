-- Graduation foundation (blueprint Section 25/Table 36/Table 31/Table 49,
-- not AGENTS.md's stale "6 demonstrated behaviors" claim, which does not
-- exist anywhere in the real blueprint document, confirmed by exhaustive
-- search of it, flagged in PROGRESS.md, AGENTS.md itself deliberately not
-- touched this session, a separate deferred task).
--
-- Investigated before building, not assumed: connections.meetup_count's
-- only increment site anywhere in this codebase was resolve_meetup_checkin
-- (read live via pg_get_functiondef before writing this), a comparison of
-- two INDEPENDENTLY resolved meetup_checkins rows (both participants must
-- separately land on exactly 'went_well'). No per-meetup history table
-- exists anywhere (confirmed against information_schema.tables), so
-- meetup_count really is just a running integer with zero log behind it,
-- and there is no way to backfill real historical log rows for whatever
-- count already exists on real connections, not attempted, see the
-- PROGRESS.md entry for this session.
--
-- get_meetup_checkin_status's own mutually_confirmed_occurred/branch
-- fields (confirmed via pg_get_functiondef) are a SEPARATE, read-only,
-- purely-computed signal that only ever decides which MeetupOutcomeCard
-- branch to render (the private "how did it feel" emotional record,
-- confirmed unrelated to meetup_count, never writes anything). Left
-- completely untouched by this migration, on purpose: the new mechanism
-- below answers a different, narrower question ("did a meetup actually
-- happen, yes or no") than MeetupCheckinCard's own 4-option emotional
-- record, and both now coexist as parallel signals from the same original
-- report.

-- One row per mutually-confirmed meetup only. No row is ever created for
-- a denied or ignored report, per the explicit "not recorded, zero
-- distinction" design.
create table if not exists public.meetup_log (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.connections(id) on delete cascade,
  meetup_date date not null,
  outcome text not null check (outcome in ('went_well', 'rough')),
  confirmed_at timestamptz not null default now()
);

alter table public.meetup_log enable row level security;

-- Visible to either participant, this is a shared, mutually-confirmed
-- fact once it exists, not a private record like first_meetup_feelings.
create policy "Participants can read their own meetup log"
  on public.meetup_log for select
  using (
    exists (
      select 1 from public.connections c
      where c.id = meetup_log.connection_id
        and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
    )
  );

-- No client write policy of any kind, only resolve_meetup_confirmation
-- (below) ever writes here, matching this app's own established
-- no_ghost_prompts-style convention for anything a client must never be
-- able to forge.

-- One row per "Person 1 reported a meetup happened" event, targeting the
-- other participant for a direct confirm/deny, decoupled from that other
-- participant's own, separate meetup_checkins resolution (which may not
-- exist yet, may already be resolved, or may never happen at all, none
-- of that blocks or is required for this).
create table if not exists public.meetup_confirmation_requests (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.connections(id) on delete cascade,
  reporter_id uuid not null references auth.users(id),
  confirmer_id uuid not null references auth.users(id),
  source_checkin_id uuid references public.meetup_checkins(id) on delete set null,
  reported_outcome text not null check (reported_outcome in ('went_well', 'rough')),
  reported_meetup_date date not null,
  resolution text check (resolution in ('confirmed', 'denied')),
  resolved_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.meetup_confirmation_requests enable row level security;

-- Only the confirmer can ever see their own pending/resolved request.
-- Deliberately no SELECT policy for the reporter at all, not merely a
-- UI choice: this is what makes "Person 1 can never tell confirm from
-- deny from ignore" a real, structural guarantee (RLS-enforced) rather
-- than something a client-side bug could leak, matching this app's own
-- established connection_end_reasons precedent for exactly this kind of
-- "private even from the other participant" guarantee.
create policy "Confirmer can read their own meetup confirmation requests"
  on public.meetup_confirmation_requests for select
  using (auth.uid() = confirmer_id);

-- No client write policy, only resolve_meetup_checkin (creates),
-- resolve_meetup_confirmation (resolves), and dismiss_meetup_confirmation
-- (dismisses) ever write here.

-- Extends resolve_meetup_checkin (2026-07-28, last touched 2026-08-17 for
-- the date-driven meetup redesign, re-read live before this edit, body
-- otherwise reproduced verbatim below apart from the two marked changes):
-- (1) the old comparison-based meetup_count increment branch is removed
-- entirely, replaced by the new mutual-confirm mechanism below; (2)
-- whenever this resolution reports a meetup actually happened
-- (went_well/rough), a new confirmation request is created for the other
-- participant, unless one is already pending for this connection (a
-- deliberate anti-duplicate guard, a judgment call: prevents two
-- simultaneous "did we meet" prompts if both sides happen to report
-- around the same time, documented here since it wasn't explicitly
-- specified either way).
create or replace function public.resolve_meetup_checkin(p_checkin_id uuid, p_outcome text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row record;
  v_other record;
  v_other_found boolean;
  v_other_participant uuid;
  v_pending_exists boolean;
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

  if v_other_found and v_other.resolved_at is null and p_outcome in ('went_well', 'rough') then
    update public.meetup_checkins set other_reported_outcome = p_outcome where id = v_other.id;
  end if;

  -- New mutual-confirmation request, replacing the old comparison-based
  -- increment. Only fires when a meetup is actually being reported as
  -- having happened; 'didnt_happen'/'still_figuring' never reach here.
  if p_outcome in ('went_well', 'rough') then
    select case when v_row.user_id = c.user_a_id then c.user_b_id else c.user_a_id end
    into v_other_participant
    from public.connections c
    where c.id = v_row.connection_id;

    if v_other_participant is not null then
      select exists (
        select 1 from public.meetup_confirmation_requests r
        where r.connection_id = v_row.connection_id
          and r.resolved_at is null
          and r.dismissed_at is null
      ) into v_pending_exists;

      if not v_pending_exists then
        insert into public.meetup_confirmation_requests (
          connection_id, reporter_id, confirmer_id, source_checkin_id, reported_outcome, reported_meetup_date
        ) values (
          v_row.connection_id, v_row.user_id, v_other_participant, p_checkin_id, p_outcome, (now() at time zone 'utc')::date
        );
      end if;
    end if;
  end if;
end;
$$;

-- Person 2's real answer. Confirm logs the meetup (meetup_log insert +
-- meetup_count increment, atomically, in the same transaction) and is the
-- ONLY path that ever does either now. Deny does nothing further, the
-- exact same visible-to-nobody-else outcome as dismiss_meetup_confirmation
-- below or simply never answering at all, per the explicit "Ignore and
-- Deny both result in not recorded, zero distinction" design. The
-- returned outcome is only ever seen by the confirmer themselves (their
-- own choice), never surfaced to the reporter in any form.
create or replace function public.resolve_meetup_confirmation(p_request_id uuid, p_resolution text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row record;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if p_resolution not in ('confirmed', 'denied') then
    raise exception 'Unknown resolution: %', p_resolution;
  end if;

  select * into v_row from public.meetup_confirmation_requests where id = p_request_id;
  if not found then
    raise exception 'Confirmation request not found';
  end if;
  if v_row.confirmer_id <> auth.uid() then
    raise exception 'Not your confirmation request';
  end if;
  if v_row.resolved_at is not null then
    return jsonb_build_object('already_resolved', true, 'resolution', v_row.resolution);
  end if;

  update public.meetup_confirmation_requests
  set resolution = p_resolution, resolved_at = now()
  where id = p_request_id;

  if p_resolution = 'confirmed' then
    insert into public.meetup_log (connection_id, meetup_date, outcome)
    values (v_row.connection_id, v_row.reported_meetup_date, v_row.reported_outcome);

    update public.connections set meetup_count = meetup_count + 1 where id = v_row.connection_id;
  end if;

  return jsonb_build_object('resolution', p_resolution);
end;
$$;

-- Explicit "Ignore" tap, distinct from resolve_meetup_confirmation so the
-- card doesn't keep re-showing every load once the confirmer has
-- consciously chosen to ignore it, without that choice being recorded as
-- a real answer (resolution stays null, only dismissed_at is set).
-- Genuinely never touching this at all (a real, silent non-response) is
-- functionally identical: no log row, no count change, either way.
create or replace function public.dismiss_meetup_confirmation(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  update public.meetup_confirmation_requests
  set dismissed_at = now()
  where id = p_request_id and confirmer_id = auth.uid() and resolved_at is null;
end;
$$;
