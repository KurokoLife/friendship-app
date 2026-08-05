-- F21: pre-meetup curiosity prompt. Fires independently for both
-- participants of a CONFIRMED meetup, once its scheduled day arrives.
-- Private, free-text reflection, never shared with the other person, no
-- message content read (this only ever looks at meetups/connections).
--
-- "One tap minimum required, cannot be fully ignored" (per the given
-- spec) is enforced client-side (a non-dismissible modal until one of the
-- two resolutions happens), the two resolutions are tracked here as two
-- separate nullable columns rather than one status enum: reflection_text
-- (typed and saved) or acknowledged_at (the one-tap "I'll think about it
-- on the way"). Exactly one of the two, or neither yet, is the only valid
-- state, enforced by the client, not a DB constraint, since a text answer
-- given after an earlier tap-acknowledgment isn't harmful, just redundant.
create table if not exists public.pre_meetup_curiosity_prompts (
  id uuid primary key default gen_random_uuid(),
  meetup_id uuid not null references public.meetups (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  fired_at timestamptz not null default now(),
  reflection_text text,
  acknowledged_at timestamptz,
  unique (meetup_id, user_id)
);

alter table public.pre_meetup_curiosity_prompts enable row level security;

create policy "Users can read their own curiosity prompts"
  on public.pre_meetup_curiosity_prompts for select
  using (auth.uid() = user_id);

create policy "Users can update their own curiosity prompts"
  on public.pre_meetup_curiosity_prompts for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- "Morning of" is approximated as "the meetup's scheduled calendar day
-- has arrived" (date comparison in the database's session timezone, UTC
-- on Supabase), not a real per-user local morning: this app's profile
-- schema has no stored timezone for either user, a genuine gap flagged
-- here rather than silently assumed away. Once the day arrives, this
-- fires for both participants regardless of what hour it actually is,
-- the daily cron schedule below is what actually makes it "morning" in
-- practice for most timezones reasonably close to UTC.
create or replace function public.run_curiosity_prompt_check(p_now timestamptz default now())
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
    insert into public.pre_meetup_curiosity_prompts (meetup_id, user_id, fired_at)
    values (v_meetup.id, v_meetup.user_a_id, p_now)
    on conflict (meetup_id, user_id) do nothing;

    insert into public.pre_meetup_curiosity_prompts (meetup_id, user_id, fired_at)
    values (v_meetup.id, v_meetup.user_b_id, p_now)
    on conflict (meetup_id, user_id) do nothing;
  end loop;
end;
$$;

-- Dev-only: force-fires for the caller on a specific meetup they're a
-- participant of, bypassing the same-day condition, re-fires on repeat
-- calls (resets both resolution fields) same as the other dev triggers.
create or replace function public.dev_force_curiosity_prompt(p_meetup_id uuid)
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

  insert into public.pre_meetup_curiosity_prompts (meetup_id, user_id, fired_at)
  values (p_meetup_id, auth.uid(), now())
  on conflict (meetup_id, user_id)
  do update set fired_at = now(), reflection_text = null, acknowledged_at = null;
end;
$$;

grant execute on function public.dev_force_curiosity_prompt(uuid) to authenticated;

select cron.schedule(
  'curiosity-prompt-check',
  '0 7 * * *',
  $$select public.run_curiosity_prompt_check();$$
);
