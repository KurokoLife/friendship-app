-- F22: meetup suggestion trigger. One row per connection (not per user,
-- unlike no_ghost_prompts/follow_up_reflections), the banner is a
-- property of the CONVERSATION reaching a message-count threshold, both
-- participants see the same banner and the same dismissal state, there's
-- no sender/receiver asymmetry here to track separately.
--
-- Read-only for clients, same convention as every other prompt-state
-- table in this app: writes go through SECURITY DEFINER RPCs so either
-- participant can snooze/dismiss regardless of connections' own
-- asymmetric update RLS (only user_a_id can update connections directly,
-- documented in src/lib/connections.ts).
create table if not exists public.meetup_suggestion_state (
  connection_id uuid primary key references public.connections (id) on delete cascade,
  last_prompted_message_count integer not null default 0,
  dismissed_permanently boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.meetup_suggestion_state enable row level security;

create policy "Participants can read meetup suggestion state"
  on public.meetup_suggestion_state for select
  using (
    exists (
      select 1 from public.connections c
      where c.id = meetup_suggestion_state.connection_id
        and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
    )
  );

-- "Not yet" (re-appears after 5 more messages): records the message
-- count at the moment of snoozing, the client re-shows the banner once
-- the connection's message count is at least 5 higher than this.
create or replace function public.snooze_meetup_suggestion(p_connection_id uuid, p_current_message_count integer)
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

  insert into public.meetup_suggestion_state (connection_id, last_prompted_message_count, updated_at)
  values (p_connection_id, p_current_message_count, now())
  on conflict (connection_id)
  do update set last_prompted_message_count = p_current_message_count, updated_at = now();
end;
$$;

create or replace function public.dismiss_meetup_suggestion_permanently(p_connection_id uuid)
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

  insert into public.meetup_suggestion_state (connection_id, dismissed_permanently, updated_at)
  values (p_connection_id, true, now())
  on conflict (connection_id)
  do update set dismissed_permanently = true, updated_at = now();
end;
$$;

grant execute on function public.snooze_meetup_suggestion(uuid, integer) to authenticated;
grant execute on function public.dismiss_meetup_suggestion_permanently(uuid) to authenticated;
