-- F11: caches one day's worth of AI-generated match suggestions per user.
--
-- Without this, reopening the home screen (or the Edge Function retrying)
-- would call Claude again and could return different reasoning for the
-- same person within the same day, which would look like a bug, not a
-- feature. The Edge Function checks for an existing row set for
-- (user_id, today) before generating a new batch.
create table if not exists public.match_suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  candidate_id uuid not null references auth.users (id) on delete cascade,
  reasoning text not null,
  suggested_date date not null default current_date,
  created_at timestamptz not null default now(),
  unique (user_id, candidate_id, suggested_date)
);

alter table public.match_suggestions enable row level security;

create policy "Users can read their own suggestions"
  on public.match_suggestions for select
  using (auth.uid() = user_id);

create policy "Users can insert their own suggestions"
  on public.match_suggestions for insert
  with check (auth.uid() = user_id);
