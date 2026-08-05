-- F17: no-ghost system. Table name normalized to snake_case per this
-- codebase's convention (AGENTS.md: "Supabase tables: snake_case"), the
-- feature spec's "no-ghost-prompts" becomes no_ghost_prompts.
--
-- draft_content is an addition beyond the given schema (id, connection_id,
-- user_id, step, fired_at, dismissed_at, remind_at): steps 1/2 need a
-- Claude-drafted reply that stays stable once shown (same reasoning as
-- match_suggestions.reasoning, F11), not regenerated on every render.
-- Steps 3/4 don't use it, their copy is either fully templated (step 3) or
-- literally given verbatim by the spec (step 4), no live generation needed.
--
-- One row per (connection_id, user_id, step), enforced by the unique
-- constraint, permanently for that connection's lifetime once created.
-- This matches "prompts never repeat after dismissal" literally: there is
-- no message-level tracking in the given schema, so dismissal is scoped to
-- the connection, not a specific message. A new message clears all rows
-- for that connection (see the trigger in the next migration), which is
-- what allows a genuinely new, later silence to be tracked again without
-- contradicting "never repeat" for an already-dismissed one.
--
-- No client-side INSERT policy on purpose: every row is created through
-- SECURITY DEFINER functions (the scheduler and the dev-tool wrappers in
-- the next migration), never a direct client .insert(), so a client can't
-- fabricate an arbitrary step/timing for itself.
create table if not exists public.no_ghost_prompts (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.connections (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  step integer not null check (step in (1, 2, 3, 4)),
  fired_at timestamptz not null default now(),
  dismissed_at timestamptz,
  remind_at timestamptz,
  draft_content text,
  unique (connection_id, user_id, step)
);

alter table public.no_ghost_prompts enable row level security;

create policy "Users can read their own no-ghost prompts"
  on public.no_ghost_prompts for select
  using (auth.uid() = user_id);

create policy "Users can update their own no-ghost prompts"
  on public.no_ghost_prompts for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
