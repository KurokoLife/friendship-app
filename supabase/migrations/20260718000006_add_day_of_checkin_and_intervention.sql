-- F25: day-of check-in. Fires independently for both participants of a
-- confirmed meetup on its scheduled day, same "morning of" approximation
-- and same limitation already documented for F21's curiosity prompt (no
-- per-user timezone data anywhere in this schema). One row per
-- (meetup_id, user_id), tracks only the FINAL outcome of the five-step
-- flow, not every intermediate step transition, that finer-grained state
-- lives entirely client-side while the user is actually walking through
-- it.
create table if not exists public.day_of_checkins (
  id uuid primary key default gen_random_uuid(),
  meetup_id uuid not null references public.meetups (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  fired_at timestamptz not null default now(),
  resolved_at timestamptz,
  outcome text check (outcome in ('going', 'reframed_going', 'sent_simpler_plan', 'cancelled')),
  unique (meetup_id, user_id)
);

alter table public.day_of_checkins enable row level security;

create policy "Users can read their own day-of check-ins"
  on public.day_of_checkins for select
  using (auth.uid() = user_id);

create policy "Users can update their own day-of check-ins"
  on public.day_of_checkins for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.run_day_of_checkin_check(p_now timestamptz default now())
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_meetup record;
begin
  for v_meetup in
    select m.id, c.user_a_id, c.user_b_id
    from public.meetups m
    join public.connections c on c.id = m.connection_id
    where m.status = 'confirmed'
      and m.scheduled_at::date = p_now::date
  loop
    insert into public.day_of_checkins (meetup_id, user_id, fired_at)
    values (v_meetup.id, v_meetup.user_a_id, p_now)
    on conflict (meetup_id, user_id) do nothing;

    insert into public.day_of_checkins (meetup_id, user_id, fired_at)
    values (v_meetup.id, v_meetup.user_b_id, p_now)
    on conflict (meetup_id, user_id) do nothing;
  end loop;
end;
$$;

create or replace function public.dev_force_day_of_checkin(p_meetup_id uuid)
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

  select m.id, c.user_a_id, c.user_b_id into v_meetup
  from public.meetups m
  join public.connections c on c.id = m.connection_id
  where m.id = p_meetup_id;

  if not found then
    raise exception 'Meetup not found';
  end if;

  if auth.uid() <> v_meetup.user_a_id and auth.uid() <> v_meetup.user_b_id then
    raise exception 'Not a participant of this connection';
  end if;

  insert into public.day_of_checkins (meetup_id, user_id, fired_at)
  values (p_meetup_id, auth.uid(), now())
  on conflict (meetup_id, user_id)
  do update set fired_at = now(), resolved_at = null, outcome = null;
end;
$$;

grant execute on function public.dev_force_day_of_checkin(uuid) to authenticated;

select cron.schedule(
  'day-of-checkin-check',
  '0 7 * * *',
  $$select public.run_day_of_checkin_check();$$
);

-- Second-cancellation intervention. "If user cancels a second time with
-- the same connection" (the given instruction) is scoped to ONE specific
-- connection, distinct from F30's separate, unbuilt, global "3 ghosts OR
-- 3 no-reschedule cancels in 30 days" accountability system (AGENTS.md).
-- Non-punitive per AGENTS.md's own core principle 6 ("behavioral
-- tracking protects community, never punitive"): this is a private,
-- reflective note shown to both participants separately, not a penalty
-- or a block on either account.
create table if not exists public.cancellation_interventions (
  connection_id uuid not null references public.connections (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  fired_at timestamptz not null default now(),
  dismissed_at timestamptz,
  primary key (connection_id, user_id)
);

alter table public.cancellation_interventions enable row level security;

create policy "Users can read their own cancellation interventions"
  on public.cancellation_interventions for select
  using (auth.uid() = user_id);

create policy "Users can dismiss their own cancellation interventions"
  on public.cancellation_interventions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Replaces cancel_meetup (20260718000002) to add the intervention check
-- after a successful cancellation: if this connection now has 2 or more
-- cancelled meetups (including the one just cancelled), fire a private,
-- dismissible intervention row for BOTH participants. Same function
-- signature and return type, CREATE OR REPLACE is sufficient here (no
-- column-list change, unlike the view/function replacements elsewhere in
-- this project that needed a real DROP).
create or replace function public.cancel_meetup(p_meetup_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_meetup record;
  v_cancelled_count integer;
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

  select count(*) into v_cancelled_count
  from public.meetups
  where connection_id = v_meetup.connection_id and status = 'cancelled';

  if v_cancelled_count >= 2 then
    insert into public.cancellation_interventions (connection_id, user_id, fired_at)
    values (v_meetup.connection_id, v_meetup.user_a_id, now())
    on conflict (connection_id, user_id) do update set fired_at = now(), dismissed_at = null;

    insert into public.cancellation_interventions (connection_id, user_id, fired_at)
    values (v_meetup.connection_id, v_meetup.user_b_id, now())
    on conflict (connection_id, user_id) do update set fired_at = now(), dismissed_at = null;
  end if;
end;
$$;
