-- F11: AI matching home screen.
--
-- Gap found while building this: nothing in onboarding (F1-F8) collects a
-- display name or birthdate anywhere, but F11's cards need both ("name,
-- age"). Adding them here as nullable columns rather than inventing a new
-- mandatory onboarding step on my own; flagged in PROGRESS.md as a real gap
-- that needs a real onboarding fix later, not silently papered over.
alter table public.profiles
  add column if not exists display_name text,
  add column if not exists birthdate date;

-- Connections: the one shared table the whole friendship arc (F11-F33)
-- reads and writes, per AGENTS.md's schema list. Created now because F11's
-- Save/Message/Pass actions need somewhere to persist to. `status` is text,
-- not a strict enum, so later features (meetup scheduling, graduation,
-- etc.) can add new values without a migration. user_a_id is always the
-- person who took the action (the initiator); user_b_id is the other
-- person in the pair.
create table if not exists public.connections (
  id uuid primary key default gen_random_uuid(),
  user_a_id uuid not null references auth.users (id) on delete cascade,
  user_b_id uuid not null references auth.users (id) on delete cascade,
  status text not null check (status in ('saved', 'passed', 'pending')),
  meetup_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_a_id, user_b_id)
);

alter table public.connections enable row level security;

create policy "Users can read connections they're part of"
  on public.connections for select
  using (auth.uid() = user_a_id or auth.uid() = user_b_id);

create policy "Users can create connections they initiate"
  on public.connections for insert
  with check (auth.uid() = user_a_id);

create policy "Users can update connections they initiated"
  on public.connections for update
  using (auth.uid() = user_a_id)
  with check (auth.uid() = user_a_id);

-- Discovery needs to read OTHER users' basic profile info, which the
-- existing "own row only" RLS on users/profiles deliberately blocks (F3/F5
-- were built as private-by-default, correctly, for account and profile
-- data). This view exposes only the columns discovery actually needs
-- (no phone, no raw Big Five scores, no dealbreakers), AND, just as
-- importantly, filters rows using auth.uid() in the view definition
-- itself, not in application code. That means the mutual gender_identity
-- / matching_preference compatibility check holds even if someone queries
-- this view directly over the REST API with the anon key and a valid JWT,
-- bypassing the app entirely, they still only ever get back people
-- mutually compatible with their own account, the same rows the app would
-- have shown them anyway. No security_invoker: the view still needs to
-- run as its owner to read across other users' rows past the base tables'
-- restrictive RLS, but the where clause below is the real access control,
-- not the app's query logic.
create or replace view public.discovery_profiles as
select
  u.id as user_id,
  u.gender_identity,
  u.matching_preference,
  p.display_name,
  p.birthdate,
  extract(year from age(current_date, p.birthdate))::int as age,
  p.life_transition,
  p.activity_interests,
  p.values,
  p.hangout_people_preference,
  p.hangout_type_preference,
  p.communication_freq,
  p.meeting_freq,
  p.response_time,
  p.personal_statement,
  p.bar_preference,
  p.photo_url,
  p.completion_pct
from public.users u
join public.profiles p on p.user_id = u.id
join public.users viewer on viewer.id = auth.uid()
where u.id <> auth.uid()
  and u.gender_identity = viewer.matching_preference
  and u.matching_preference = viewer.gender_identity;

grant select on public.discovery_profiles to authenticated;
