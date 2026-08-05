-- F16: real-time messaging, the core connection layer between two matched
-- users. Schema matches AGENTS.md exactly: id, connection_id, sender_id,
-- content, type, read_at, created_at.
--
-- type is plain text with no CHECK constraint, same reasoning as
-- connections.status in 20260711000007: this build is text-only ("no
-- GIFs, no emoji reactions, no stickers"), but post-MVP features (PM1
-- voice notes, PM2 video calls) will add real non-text message types
-- later, and an open column means that doesn't need a migration.
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.connections (id) on delete cascade,
  sender_id uuid not null references auth.users (id) on delete cascade,
  content text not null,
  type text not null default 'text',
  read_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.messages enable row level security;

-- Both participants in the connection can read the thread, matching
-- connections' own "read connections they're part of" policy, not just
-- the row's user_a_id.
create policy "Participants can read messages in their connection"
  on public.messages for select
  using (
    exists (
      select 1 from public.connections c
      where c.id = messages.connection_id
        and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
    )
  );

create policy "Participants can send messages in their connection"
  on public.messages for insert
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.connections c
      where c.id = messages.connection_id
        and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
    )
  );

-- Read receipts are private to the receiver (AGENTS.md: no read receipts
-- visible to the sender), so only the recipient of a message (never its
-- own sender) can mark it read. The app never surfaces read_at to the
-- sender in the UI regardless, this policy is the data-layer backstop.
create policy "Recipients can mark messages as read"
  on public.messages for update
  using (
    sender_id <> auth.uid()
    and exists (
      select 1 from public.connections c
      where c.id = messages.connection_id
        and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
    )
  )
  with check (
    sender_id <> auth.uid()
    and exists (
      select 1 from public.connections c
      where c.id = messages.connection_id
        and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
    )
  );

-- Needed for Supabase Realtime: subscribers get full row data on change
-- events, not just the primary key.
alter table public.messages replica identity full;

-- Adds this table to the realtime publication so postgres_changes
-- websocket subscriptions actually receive INSERT/UPDATE events for it.
-- Without this, the thread screen's subscription silently receives
-- nothing, only a fresh manual fetch would ever see new messages.
alter publication supabase_realtime add table public.messages;
