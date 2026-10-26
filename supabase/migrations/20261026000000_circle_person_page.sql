-- 2026-10-26: Rebuild stage 1c, Your circle fixes (docs/context/05_LIMEN_REBUILD.md,
-- "Your circle"). Safe to run twice. limen_db_version() -> 20261026000000.
--
--   1. The next check-in date, in ONE place: circle_next_check_in(from, rhythm),
--      and outside_friend_next_check_in(friend, tz) which picks where the
--      count starts.
--      next date = the last time you reached out to that person (or the day
--      they were added) + the rhythm you chose. The person page and the line
--      under the rhythm choice use it now; stage 3 suggestions must use it too.
--   2. outside_friends.last_reached_at (filled in by stage 3, "I reached out")
--      and outside_friends.photo_path (an optional photo).
--   3. A private storage bucket, friend-photos. Each file sits in a folder
--      named after its owner's user id; only that person can upload, read,
--      replace or remove it. Used for nothing else.

-- 1. The rule ---------------------------------------------------------------
-- Rhythms (keep in step with RHYTHM_LABELS in src/lib/circle.ts):
--   few_days 3 days, week 7 days, two_weeks 14 days, month 1 month,
--   few_months 3 months, few_times_year 4 months, none: no date.
create or replace function public.circle_next_check_in(p_from date, p_rhythm text)
returns date
language sql
immutable
as $$
  select case p_rhythm
    when 'few_days' then p_from + 3
    when 'week' then p_from + 7
    when 'two_weeks' then p_from + 14
    when 'month' then (p_from + interval '1 month')::date
    when 'few_months' then (p_from + interval '3 months')::date
    when 'few_times_year' then (p_from + interval '4 months')::date
    else null
  end;
$$;
grant execute on function public.circle_next_check_in(date, text) to authenticated;

-- 2. New fields ---------------------------------------------------------------
alter table public.outside_friends add column if not exists last_reached_at timestamptz;
alter table public.outside_friends add column if not exists photo_path text;

-- The next check-in date for one of the caller's own friends: where the
-- count starts (the last time they reached out, or the day the friend was
-- added, as a day in the person's own time zone) plus the rhythm. p_rhythm
-- lets the edit form preview a rhythm before it's saved. Runs with the
-- caller's own rights, so it only ever sees their own friends.
create or replace function public.outside_friend_next_check_in(p_friend_id uuid, p_tz text default 'UTC', p_rhythm text default null)
returns date
language sql
stable
as $$
  select public.circle_next_check_in(
    (coalesce(f.last_reached_at, f.created_at) at time zone coalesce(nullif(p_tz, ''), 'UTC'))::date,
    coalesce(p_rhythm, f.rhythm))
  from public.outside_friends f
  where f.id = p_friend_id and f.user_id = auth.uid();
$$;
grant execute on function public.outside_friend_next_check_in(uuid, text, text) to authenticated;

-- A photo path always sits in the owner's own folder.
alter table public.outside_friends drop constraint if exists outside_friends_photo_in_own_folder;
alter table public.outside_friends add constraint outside_friends_photo_in_own_folder
  check (photo_path is null or split_part(photo_path, '/', 1) = user_id::text);

-- 3. Private photos -------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('friend-photos', 'friend-photos', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do update set public = false;

drop policy if exists "Friend photos: own read" on storage.objects;
create policy "Friend photos: own read" on storage.objects
  for select to authenticated
  using (bucket_id = 'friend-photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Friend photos: own upload" on storage.objects;
create policy "Friend photos: own upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'friend-photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Friend photos: own replace" on storage.objects;
create policy "Friend photos: own replace" on storage.objects
  for update to authenticated
  using (bucket_id = 'friend-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'friend-photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Friend photos: own remove" on storage.objects;
create policy "Friend photos: own remove" on storage.objects
  for delete to authenticated
  using (bucket_id = 'friend-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create or replace function public.limen_db_version()
returns text
language sql
stable
as $function$ select '20261026000000'::text $function$;
grant execute on function public.limen_db_version() to anon, authenticated;
