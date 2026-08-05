-- F5: profile build (traditional typing path).
-- One row per user, keyed to auth.users. big_five_scores is populated later
-- by F6, not here. personality_16p is optional and never used for matching.

create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  life_transition text,
  personality_16p text,
  big_five_scores jsonb,
  -- Required for matching. Deliberately no "whenever"/"depends" escape hatch.
  communication_freq text check (
    communication_freq in ('Daily', 'A few times a week', 'About once a week', 'A few times a month')
  ),
  meeting_freq text check (
    meeting_freq in ('Weekly', 'Every 2 weeks', 'Monthly', 'Every few months')
  ),
  response_time text check (
    response_time in ('Within hours', 'Same day', '1-2 days', 'A few days')
  ),
  -- Bumble-style nested interests: { categories: string[], details: { [category]: {...} }, other?: string }.
  activity_interests jsonb,
  hangout_people_preference text check (
    hangout_people_preference in ('1-on-1', 'Small group (3-5)', 'Big group (6+)')
  ),
  hangout_type_preference text[] check (
    coalesce(array_length(hangout_type_preference, 1), 0) <= 2
  ),
  -- Preset chips plus free-text additions, flattened into one array; capped at 5.
  values text[] check (
    coalesce(array_length(values, 1), 0) <= 5
  ),
  personal_statement text,
  dealbreakers text,
  bar_preference text,
  photo_url text,
  completion_pct integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users can read their own profile"
  on public.profiles for select
  using (auth.uid() = user_id);

create policy "Users can insert their own profile"
  on public.profiles for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Profile photo storage. Files live at `{user_id}/{filename}`; the folder
-- name is the ownership check.
insert into storage.buckets (id, name, public)
values ('profile-photos', 'profile-photos', true)
on conflict (id) do nothing;

create policy "Profile photos are publicly readable"
  on storage.objects for select
  using (bucket_id = 'profile-photos');

create policy "Users can upload their own profile photo"
  on storage.objects for insert
  with check (
    bucket_id = 'profile-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users can update their own profile photo"
  on storage.objects for update
  using (
    bucket_id = 'profile-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users can delete their own profile photo"
  on storage.objects for delete
  using (
    bucket_id = 'profile-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
