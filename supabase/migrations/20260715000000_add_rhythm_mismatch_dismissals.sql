-- F16 update: dismissal state for the rhythm-mismatch note (shown only to
-- whoever is replying much faster than their conversation partner, once
-- per connection, never again after they dismiss it). A separate table,
-- not a column on connections, since connections' own update RLS ("Users
-- can update connections they initiated") only lets user_a_id write to a
-- row, the non-initiating participant would be silently blocked from
-- dismissing their own note otherwise, the same asymmetry already
-- documented against getOrCreateConnectionId in src/lib/connections.ts.
create table if not exists public.rhythm_mismatch_dismissals (
  connection_id uuid not null references public.connections (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  dismissed_at timestamptz not null default now(),
  primary key (connection_id, user_id)
);

alter table public.rhythm_mismatch_dismissals enable row level security;

create policy "Users can read their own dismissal"
  on public.rhythm_mismatch_dismissals for select
  using (user_id = auth.uid());

create policy "Participants can dismiss for themselves"
  on public.rhythm_mismatch_dismissals for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.connections c
      where c.id = rhythm_mismatch_dismissals.connection_id
        and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
    )
  );
