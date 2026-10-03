-- Limen v2 (2026-10-03): Stories and private curiosity notes.
-- See docs/LIMEN_V2_DECISIONS.md, "Stories and curiosity".
--
-- Stories: 2-3 short stories in the user's own words (no AI writing or
-- polishing), written to prompts that show character. Replaces the idea
-- of "Ask me about...", which made every reader ask the same question.
--
-- Curiosity notes: a reader's private "I wonder..." about someone, tied to
-- a story or their profile. Never shown to the other person. Each reader's
-- curiosity is their own, so the questions that come out of it don't
-- repeat.

alter table public.profiles add column if not exists stories jsonb not null default '[]'::jsonb;
alter table public.profiles drop constraint if exists profiles_stories_shape;
alter table public.profiles add constraint profiles_stories_shape
  check (jsonb_typeof(stories) = 'array' and jsonb_array_length(stories) <= 3);

-- Read another member's stories. Same visibility spirit as the public
-- profile: any signed-in member, except across a block in either direction.
create or replace function public.get_profile_stories(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_stories jsonb;
begin
  if v_caller is null then return '[]'::jsonb; end if;
  if exists (
    select 1 from public.blocks
    where (blocker_id = v_caller and blocked_id = p_user_id)
       or (blocker_id = p_user_id and blocked_id = v_caller)
  ) then
    return '[]'::jsonb;
  end if;
  select coalesce(stories, '[]'::jsonb) into v_stories from public.profiles where user_id = p_user_id;
  return coalesce(v_stories, '[]'::jsonb);
end;
$$;

grant execute on function public.get_profile_stories(uuid) to authenticated;

create table if not exists public.curiosity_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  subject_user_id uuid not null references auth.users (id) on delete cascade,
  story_index integer,
  note text not null check (char_length(note) between 1 and 300),
  created_at timestamptz not null default now()
);

create index if not exists curiosity_notes_user_subject_idx on public.curiosity_notes (user_id, subject_user_id);

alter table public.curiosity_notes enable row level security;

drop policy if exists "Own curiosity notes: select" on public.curiosity_notes;
create policy "Own curiosity notes: select" on public.curiosity_notes
  for select using (auth.uid() = user_id);
drop policy if exists "Own curiosity notes: insert" on public.curiosity_notes;
create policy "Own curiosity notes: insert" on public.curiosity_notes
  for insert with check (auth.uid() = user_id);
drop policy if exists "Own curiosity notes: delete" on public.curiosity_notes;
create policy "Own curiosity notes: delete" on public.curiosity_notes
  for delete using (auth.uid() = user_id);
