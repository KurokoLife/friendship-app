-- Meetups: the real scheduling backbone F21 (pre-meetup curiosity), F24
-- (calendar opt-in), and F25 (day-of check-in/cancellation) all need a
-- genuinely scheduled time to trigger against. Nothing in this app
-- creates one yet (F23's activity suggestion only sends a chat message,
-- "the app never auto-books"), so this migration also adds the minimal
-- mutual propose/confirm mechanism that makes "both users confirm a
-- specific plan" (F24's own trigger condition) a real, concrete event
-- rather than something inferred from message content. This wasn't a
-- separately numbered feature in the given build order, flagged here as
-- necessary connective tissue rather than built silently.
--
-- Column set matches AGENTS.md's own schema note (id, connection_id,
-- scheduled_at, logged_at, post_meetup_rating) plus what the propose/
-- confirm/cancel lifecycle needs on top.
create table if not exists public.meetups (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.connections (id) on delete cascade,
  proposed_by uuid not null references auth.users (id),
  scheduled_at timestamptz not null,
  activity_label text,
  status text not null default 'proposed' check (status in ('proposed', 'confirmed', 'declined', 'cancelled', 'completed')),
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  logged_at timestamptz,
  post_meetup_rating integer check (post_meetup_rating between 1 and 5),
  created_at timestamptz not null default now()
);

alter table public.meetups enable row level security;

-- Read-only for clients, same reasoning as no_ghost_prompts/
-- follow_up_reflections: every write goes through a SECURITY DEFINER
-- function below, both so business rules (only the non-proposer can
-- confirm, only one active meetup per connection at a time) are enforced
-- in one place, and to sidestep the exact RLS asymmetry connections.ts
-- already documents (an update policy scoped to one participant would
-- silently no-op for the other).
create policy "Participants can read meetups for their connections"
  on public.meetups for select
  using (
    exists (
      select 1 from public.connections c
      where c.id = meetups.connection_id
        and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
    )
  );

-- One active (not yet resolved) meetup per connection at a time, checked
-- inside propose_meetup below via this partial unique index rather than a
-- plain check constraint (uniqueness across a filtered subset of rows
-- needs an index, not a row-level check).
create unique index if not exists meetups_one_active_per_connection
  on public.meetups (connection_id)
  where status in ('proposed', 'confirmed');

create or replace function public.propose_meetup(p_connection_id uuid, p_scheduled_at timestamptz, p_activity_label text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
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

  if p_scheduled_at <= now() then
    raise exception 'Meetup time must be in the future';
  end if;

  if exists (
    select 1 from public.meetups
    where connection_id = p_connection_id and status in ('proposed', 'confirmed')
  ) then
    raise exception 'There is already an active meetup plan for this connection';
  end if;

  insert into public.meetups (connection_id, proposed_by, scheduled_at, activity_label)
  values (p_connection_id, auth.uid(), p_scheduled_at, p_activity_label)
  returning id into v_id;

  return v_id;
end;
$$;

-- Confirmation must come from the OTHER participant, not the proposer,
-- "both users confirm" (F24) is satisfied by propose (the proposer's own
-- affirmative act) plus this (the other side's), not one person doing
-- both steps.
create or replace function public.confirm_meetup(p_meetup_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_meetup record;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select m.*, c.user_a_id, c.user_b_id into v_meetup
  from public.meetups m
  join public.connections c on c.id = m.connection_id
  where m.id = p_meetup_id;

  if not found then
    raise exception 'Meetup not found';
  end if;

  if auth.uid() <> v_meetup.user_a_id and auth.uid() <> v_meetup.user_b_id then
    raise exception 'Not a participant of this connection';
  end if;

  if auth.uid() = v_meetup.proposed_by then
    raise exception 'The proposer cannot also confirm their own plan';
  end if;

  if v_meetup.status <> 'proposed' then
    raise exception 'This meetup is no longer awaiting confirmation';
  end if;

  update public.meetups set status = 'confirmed', confirmed_at = now() where id = p_meetup_id;
end;
$$;

create or replace function public.decline_meetup(p_meetup_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_meetup record;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select m.*, c.user_a_id, c.user_b_id into v_meetup
  from public.meetups m
  join public.connections c on c.id = m.connection_id
  where m.id = p_meetup_id;

  if not found then
    raise exception 'Meetup not found';
  end if;

  if auth.uid() <> v_meetup.user_a_id and auth.uid() <> v_meetup.user_b_id then
    raise exception 'Not a participant of this connection';
  end if;

  if v_meetup.status <> 'proposed' then
    raise exception 'This meetup is no longer awaiting confirmation';
  end if;

  update public.meetups set status = 'declined' where id = p_meetup_id;
end;
$$;

-- F25's own cancellation flow terminates here: a CONFIRMED meetup being
-- cancelled, either participant, with a real reason attached (Step 5's
-- honest, Claude-articulated message text, stored for the second-
-- cancellation pattern to reference later).
create or replace function public.cancel_meetup(p_meetup_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_meetup record;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select m.*, c.user_a_id, c.user_b_id into v_meetup
  from public.meetups m
  join public.connections c on c.id = m.connection_id
  where m.id = p_meetup_id;

  if not found then
    raise exception 'Meetup not found';
  end if;

  if auth.uid() <> v_meetup.user_a_id and auth.uid() <> v_meetup.user_b_id then
    raise exception 'Not a participant of this connection';
  end if;

  if v_meetup.status <> 'confirmed' then
    raise exception 'Only a confirmed meetup can be cancelled';
  end if;

  update public.meetups
  set status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason
  where id = p_meetup_id;
end;
$$;

grant execute on function public.propose_meetup(uuid, timestamptz, text) to authenticated;
grant execute on function public.confirm_meetup(uuid) to authenticated;
grant execute on function public.decline_meetup(uuid) to authenticated;
grant execute on function public.cancel_meetup(uuid, text) to authenticated;
