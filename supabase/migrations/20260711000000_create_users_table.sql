-- F3: gender identity + matching preferences.
-- One row per authenticated user, keyed to auth.users.

create table if not exists public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  phone text,
  -- Both shown on the profile AND matched against other users'
  -- matching_preference for discovery (see 20260711000003, which adds the
  -- CHECK constraint this table originally lacked). This column started as
  -- open free text; that changed in 20260711000003 too.
  gender_identity text,
  -- Drives discovery filtering (who shows up for whom), compared directly
  -- against gender_identity. Options here are historical (originally
  -- women/men/non_binary/all_genders); see 20260711000003 for the current
  -- closed set, which supersedes this CHECK on the live database.
  matching_preference text check (
    matching_preference in ('women', 'men', 'non_binary', 'all_genders')
  ),
  -- Options here are historical. See 20260711000002 and then 20260711000003
  -- (which supersedes both on the live database) for the current set.
  messaging_preference text check (
    messaging_preference in ('anyone', 'only_women', 'only_people_i_message_first')
  ),
  verified boolean not null default false,
  social_linked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.users enable row level security;

create policy "Users can read their own row"
  on public.users for select
  using (auth.uid() = id);

create policy "Users can insert their own row"
  on public.users for insert
  with check (auth.uid() = id);

create policy "Users can update their own row"
  on public.users for update
  using (auth.uid() = id)
  with check (auth.uid() = id);
