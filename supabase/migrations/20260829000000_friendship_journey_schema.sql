-- Friendship Journey rebuild — Phase 3, step 1: additive schema only.
--
-- This migration implements FRIENDSHIP_JOURNEY_DESIGN.md's approved schema
-- (Decisions 1-10, all signed off). It is deliberately additive and
-- non-destructive: nothing existing (no_ghost_prompts, meetup_checkins,
-- meetup_confirmation_requests, meetup_suggestion_state, connections.status,
-- connections.next_meetup_date/status/proposed_by, run_curiosity_prompt_check
-- and its dangling daily cron, or any existing frontend code) is touched,
-- modified, or disabled by this migration. The existing app continues to
-- work completely unaffected — none of what follows is referenced by any
-- live code path yet. The new RPC layer (record_friendship_event,
-- advance_friendship_stage, evaluate_self_sustaining, propose_meetup,
-- confirm_meetup, cancel_meetup, the occurrence/date-resolution functions,
-- raise_intervention, get_active_intervention) and the frontend rewiring
-- are separate, later steps. Disabling the old automation is the last step,
-- and per the original brief's own instruction, will not happen until a
-- final explicit review of that specific, destructive change.

-- ============================================================
-- 1. connections: friendship_stage (narrative, forward-only) and
--    is_self_sustaining (reversible signal, deliberately decoupled —
--    see design doc §4a / Decision 10). Two separate write paths, by design.
-- ============================================================
alter table public.connections
  add column friendship_stage text
    check (friendship_stage is null or friendship_stage in (
      'first_contact','conversation','first_meetup_planning','post_first_meetup',
      'early_friendship','repeated_time','rhythm_established','graduation_eligible'
    )),
  add column friendship_stage_changed_at timestamptz,
  add column is_self_sustaining boolean not null default false,
  add column is_self_sustaining_updated_at timestamptz;

-- ============================================================
-- 2. friendship_events — the shared, both-participants-readable factual
--    timeline. payload must never carry evaluative/private content (design
--    doc §2's hard rule); enforced by code discipline in the writer
--    function (added later), not by a database constraint, matching this
--    project's existing convention for similar rules.
-- ============================================================
create table public.friendship_events (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.connections(id) on delete cascade,
  actor_user_id uuid references public.users(id),
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index friendship_events_connection_id_idx on public.friendship_events(connection_id, created_at);

alter table public.friendship_events enable row level security;

create policy "Participants can read friendship events"
  on public.friendship_events for select
  using (exists (
    select 1 from public.connections c
    where c.id = friendship_events.connection_id
      and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
  ));
-- No insert policy: only record_friendship_event() (SECURITY DEFINER, a
-- later migration) may write here.

-- ============================================================
-- 3. Private per-user tables (design doc §3). Same own-row RLS pattern this
--    project already uses successfully (connection_end_reasons,
--    first_meetup_feelings, rhythm_mismatch_dismissals): self-row SELECT,
--    no client access to the other participant's row, no exceptions.
-- ============================================================

create table public.private_post_meetup_reflections (
  connection_id uuid not null references public.connections(id) on delete cascade,
  user_id uuid not null references public.users(id),
  meetup_id uuid not null,
  response text not null check (response in ('know_better','open_to_another','still_figuring','dont_continue')),
  created_at timestamptz not null default now(),
  primary key (connection_id, user_id, meetup_id)
);

create table public.second_look_responses (
  connection_id uuid not null references public.connections(id) on delete cascade,
  user_id uuid not null references public.users(id),
  response text not null check (response in ('yes','maybe_later','no')),
  created_at timestamptz not null default now(),
  primary key (connection_id, user_id)
);

create table public.progressive_reflections (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.connections(id) on delete cascade,
  user_id uuid not null references public.users(id),
  reflection_type text not null check (reflection_type in ('early_repeat','rhythm_check')),
  response text not null,
  created_at timestamptz not null default now()
);

create table public.rhythm_preferences (
  connection_id uuid not null references public.connections(id) on delete cascade,
  user_id uuid not null references public.users(id),
  cadence text not null check (cadence in ('weekly','few_weeks','monthly','occasional','not_sure')),
  updated_at timestamptz not null default now(),
  primary key (connection_id, user_id)
);

create table public.graduation_readiness (
  connection_id uuid not null references public.connections(id) on delete cascade,
  user_id uuid not null references public.users(id),
  readiness text not null check (readiness in ('still_helpful','mostly_on_our_own','not_sure')),
  created_at timestamptz not null default now(),
  primary key (connection_id, user_id)
);

create table public.pre_meetup_concerns (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.connections(id) on delete cascade,
  user_id uuid not null references public.users(id),
  meetup_id uuid not null,
  concern text not null check (concern in ('awkwardness','low_energy','plan_too_big','safety','other')),
  resolution text check (resolution in ('reassured','plan_simplified','cancelled','blocked','rescheduled')),
  created_at timestamptz not null default now()
);

-- Deliberately its own table, not a column on connections: connections' own
-- SELECT RLS returns the whole row to both participants, which would leak
-- the chosen defer duration to the other side. See design doc §3.
create table public.connection_pause_details (
  connection_id uuid primary key references public.connections(id) on delete cascade,
  paused_by uuid not null references public.users(id),
  paused_until timestamptz,
  created_at timestamptz not null default now()
);

alter table public.private_post_meetup_reflections enable row level security;
create policy "Users can read their own post-meetup reflections"
  on public.private_post_meetup_reflections for select using (auth.uid() = user_id);
create policy "Users can write their own post-meetup reflections"
  on public.private_post_meetup_reflections for insert with check (
    auth.uid() = user_id and exists (
      select 1 from public.connections c where c.id = connection_id
        and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
    )
  );

alter table public.second_look_responses enable row level security;
create policy "Users can read their own second-look response"
  on public.second_look_responses for select using (auth.uid() = user_id);
create policy "Users can write their own second-look response"
  on public.second_look_responses for insert with check (
    auth.uid() = user_id and exists (
      select 1 from public.connections c where c.id = connection_id
        and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
    )
  );
create policy "Users can update their own second-look response"
  on public.second_look_responses for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table public.progressive_reflections enable row level security;
create policy "Users can read their own progressive reflections"
  on public.progressive_reflections for select using (auth.uid() = user_id);
create policy "Users can write their own progressive reflections"
  on public.progressive_reflections for insert with check (
    auth.uid() = user_id and exists (
      select 1 from public.connections c where c.id = connection_id
        and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
    )
  );

alter table public.rhythm_preferences enable row level security;
create policy "Users can read their own rhythm preference"
  on public.rhythm_preferences for select using (auth.uid() = user_id);
create policy "Users can write their own rhythm preference"
  on public.rhythm_preferences for insert with check (
    auth.uid() = user_id and exists (
      select 1 from public.connections c where c.id = connection_id
        and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
    )
  );
create policy "Users can update their own rhythm preference"
  on public.rhythm_preferences for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table public.graduation_readiness enable row level security;
create policy "Users can read their own graduation readiness"
  on public.graduation_readiness for select using (auth.uid() = user_id);
create policy "Users can write their own graduation readiness"
  on public.graduation_readiness for insert with check (
    auth.uid() = user_id and exists (
      select 1 from public.connections c where c.id = connection_id
        and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
    )
  );
create policy "Users can update their own graduation readiness"
  on public.graduation_readiness for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table public.pre_meetup_concerns enable row level security;
create policy "Users can read their own pre-meetup concerns"
  on public.pre_meetup_concerns for select using (auth.uid() = user_id);
create policy "Users can write their own pre-meetup concerns"
  on public.pre_meetup_concerns for insert with check (
    auth.uid() = user_id and exists (
      select 1 from public.connections c where c.id = connection_id
        and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
    )
  );
create policy "Users can update their own pre-meetup concerns"
  on public.pre_meetup_concerns for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table public.connection_pause_details enable row level security;
create policy "Only the pausing participant can read their own pause detail"
  on public.connection_pause_details for select using (auth.uid() = paused_by);
-- No client insert/update: only pause_connection() (SECURITY DEFINER, a
-- later migration) writes here.

-- ============================================================
-- 4. meetups, occurrence reporting, and date reconciliation (design doc §5).
--    Occurrence certainty (status) and date certainty (date_status /
--    occurred_date) are two independent facts — see the design doc's
--    Occurrence certainty vs. date certainty state model.
-- ============================================================

create table public.meetups (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.connections(id) on delete cascade,
  sequence_number integer not null,
  proposed_date date not null,
  proposed_by uuid not null references public.users(id),
  confirmed_date date,
  confirmed_at timestamptz,
  confirmed_by uuid references public.users(id),
  occurred_date date,
  date_status text not null default 'not_applicable'
    check (date_status in ('not_applicable','confirmed','disputed')),
  status text not null default 'proposed'
    check (status in ('proposed','confirmed','rescheduled','cancelled','occurred','not_occurred','unresolved')),
  superseded_by uuid references public.meetups(id),
  prompted_by_limen boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index meetups_connection_id_idx on public.meetups(connection_id, sequence_number);

-- sequence_number is always server-computed, never client-supplied, matching
-- this project's own remember_entries.meetup_number_at_entry precedent.
create or replace function public.set_meetup_sequence_number()
returns trigger
language plpgsql
as $$
begin
  select coalesce(max(sequence_number), 0) + 1 into new.sequence_number
  from public.meetups where connection_id = new.connection_id;
  return new;
end;
$$;

create trigger meetups_set_sequence_number
  before insert on public.meetups
  for each row execute function public.set_meetup_sequence_number();

create or replace function public.meetups_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger meetups_set_updated_at
  before update on public.meetups
  for each row execute function public.meetups_touch_updated_at();

alter table public.meetups enable row level security;
create policy "Participants can read their own meetups"
  on public.meetups for select
  using (exists (
    select 1 from public.connections c
    where c.id = meetups.connection_id
      and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
  ));
-- No client insert/update: propose_meetup / confirm_meetup / cancel_meetup
-- and the occurrence-resolution functions (all SECURITY DEFINER, a later
-- migration) are the only writers.

create table public.meetup_occurrence_reports (
  meetup_id uuid not null references public.meetups(id) on delete cascade,
  reporter_id uuid not null references public.users(id),
  reported_yes boolean not null,
  reported_date date check (reported_date <= current_date),
  created_at timestamptz not null default now(),
  primary key (meetup_id, reporter_id)
);

alter table public.meetup_occurrence_reports enable row level security;
create policy "Reporters can read their own occurrence report"
  on public.meetup_occurrence_reports for select using (auth.uid() = reporter_id);
-- No client insert: only the occurrence-resolution RPC (a later migration)
-- writes here, since it must evaluate the mutual comparison and fire the
-- corresponding friendship_events row atomically.

-- The mutual-approval mechanism shared by both an initial date dispute
-- (design doc §5 case 2) and a later correction (case 5) — one mechanism,
-- not two nearly-identical ones, since both need "the other participant
-- must approve before shared history changes."
create table public.meetup_date_resolutions (
  id uuid primary key default gen_random_uuid(),
  meetup_id uuid not null references public.meetups(id) on delete cascade,
  proposed_by uuid not null references public.users(id),
  proposed_date date not null,
  reason text not null check (reason in ('initial_dispute','correction')),
  status text not null default 'pending' check (status in ('pending','approved','declined')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

alter table public.meetup_date_resolutions enable row level security;
create policy "Participants can read date resolutions for their meetups"
  on public.meetup_date_resolutions for select
  using (exists (
    select 1 from public.meetups m
    join public.connections c on c.id = m.connection_id
    where m.id = meetup_date_resolutions.meetup_id
      and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
  ));
-- No client insert/update: only propose_meetup_date_resolution() and its
-- approve/decline counterpart (SECURITY DEFINER, a later migration) write
-- here — approval must always come from the OTHER participant, never the
-- proposer, so this cannot be a plain client upsert.

-- Deferred foreign keys, added now that meetups exists.
alter table public.private_post_meetup_reflections
  add constraint private_post_meetup_reflections_meetup_id_fkey
  foreign key (meetup_id) references public.meetups(id) on delete cascade;

alter table public.pre_meetup_concerns
  add constraint pre_meetup_concerns_meetup_id_fkey
  foreign key (meetup_id) references public.meetups(id) on delete cascade;

-- User-facing meetup history: reconciled, factual data only. Never exposes
-- meetup_occurrence_reports.reported_date (each participant's individual,
-- possibly-differing claim) or anything from private_post_meetup_reflections.
-- A plain view, not security definer — it inherits meetups' own participant-
-- scoped RLS automatically, no bypass needed here (unlike inbox_conversations,
-- which exists specifically to bypass profiles' stricter self-row RLS).
create view public.meetup_history as
select
  m.connection_id,
  m.sequence_number,
  m.date_status,
  m.occurred_date,
  m.proposed_by
from public.meetups m
where m.status = 'occurred';

-- ============================================================
-- 5. connection_interventions — the single priority queue (design doc §6).
--    Replaces no_ghost_prompts / meetup_checkins / meetup_confirmation_requests
--    / meetup_suggestion_state's "is there a card" role. Those existing
--    tables are NOT dropped by this migration — they remain live and
--    unaffected until the old automation is explicitly disabled in a later,
--    separate step.
-- ============================================================

create table public.connection_interventions (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.connections(id) on delete cascade,
  target_user_id uuid references public.users(id),  -- null = shown to both participants
  intervention_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','resolved','dismissed','snoozed','expired')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  snoozed_until timestamptz
);

create index connection_interventions_lookup_idx
  on public.connection_interventions(connection_id, target_user_id, status);

alter table public.connection_interventions enable row level security;
create policy "Participants can read interventions addressed to them or to both"
  on public.connection_interventions for select
  using (
    (target_user_id = auth.uid() or target_user_id is null)
    and exists (
      select 1 from public.connections c
      where c.id = connection_interventions.connection_id
        and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
    )
  );
-- No client insert/update: only raise_intervention() (SECURITY DEFINER,
-- idempotent by design, a later migration) writes here.
