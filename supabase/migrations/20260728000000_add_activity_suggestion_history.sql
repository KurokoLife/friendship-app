-- F23 activity suggestions: no-repeat tracking for AI-generated wording.
-- Each row is one suggestion actually shown to a connection for one of
-- the three category slots, kept just long enough to give the model
-- something real to avoid repeating on the next refresh. No separate
-- per-user split needed, both participants would see the same
-- suggestions for a shared connection anyway.
create table public.activity_suggestion_history (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.connections (id) on delete cascade,
  category text not null check (category in ('low_effort', 'interest_based', 'link_out')),
  suggestion_text text not null,
  created_at timestamptz not null default now()
);

create index activity_suggestion_history_lookup
  on public.activity_suggestion_history (connection_id, category, created_at desc);

alter table public.activity_suggestion_history enable row level security;

-- Same participant-check pattern every other connection-scoped table in
-- this project already uses. Read access lets the edge function (running
-- with the caller's own JWT, not a service role) fetch recent history
-- before generating a fresh set; insert access lets it log what it just
-- showed.
create policy "Participants can view their own connection's suggestion history"
  on public.activity_suggestion_history for select
  using (
    exists (
      select 1 from public.connections c
      where c.id = connection_id and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
    )
  );

create policy "Participants can log suggestions shown for their own connection"
  on public.activity_suggestion_history for insert
  with check (
    exists (
      select 1 from public.connections c
      where c.id = connection_id and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
    )
  );
