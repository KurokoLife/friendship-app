-- F23 activity suggestions: replaces the plain activity_suggestion_history
-- table (added minutes earlier this same session, no real data to
-- preserve) with a pool table that does double duty as both the
-- no-repeat history log AND a small pre-generated reserve.
--
-- Why: live-tested the original one-call-per-tap design directly and it
-- was genuinely too slow, 7 to 17 seconds per refresh, confirmed across
-- four real calls, not assumed. A live call per tap fundamentally can't
-- get much faster than Claude's own generation time, so the fix is to
-- generate a small batch of sets ahead of time and serve most taps as an
-- instant read: each batch is 3 full sets (9 rows, 3 categories x 3
-- sets), the first set is marked consumed immediately and returned, the
-- other two sit ready (consumed = false) for the next two taps to read
-- instantly with no Claude call at all. Only every third tap (once the
-- reserve runs out) pays the generation cost again.
drop table if exists public.activity_suggestion_history;

create table public.activity_suggestion_pool (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.connections (id) on delete cascade,
  batch_id uuid not null,
  category text not null check (category in ('low_effort', 'interest_based', 'link_out')),
  label text not null,
  description text not null,
  message text not null,
  is_free boolean not null,
  free_alternative text,
  interest_note text,
  source text not null,
  consumed boolean not null default false,
  created_at timestamptz not null default now()
);

create index activity_suggestion_pool_ready
  on public.activity_suggestion_pool (connection_id, consumed, batch_id);

create index activity_suggestion_pool_history
  on public.activity_suggestion_pool (connection_id, category, created_at desc)
  where consumed = true;

alter table public.activity_suggestion_pool enable row level security;

create policy "Participants can view their own connection's suggestion pool"
  on public.activity_suggestion_pool for select
  using (
    exists (
      select 1 from public.connections c
      where c.id = connection_id and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
    )
  );

create policy "Participants can add to their own connection's suggestion pool"
  on public.activity_suggestion_pool for insert
  with check (
    exists (
      select 1 from public.connections c
      where c.id = connection_id and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
    )
  );

-- Needed to mark rows consumed when a reserved batch is served.
create policy "Participants can mark their own connection's pool rows consumed"
  on public.activity_suggestion_pool for update
  using (
    exists (
      select 1 from public.connections c
      where c.id = connection_id and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.connections c
      where c.id = connection_id and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
    )
  );
