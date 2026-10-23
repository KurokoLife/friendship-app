-- 2026-10-23: private notes written on someone's profile ("Note it
-- privately") also show in "What I want to remember about X" (Notes tab)
-- once a chat opens, and can be edited there. Own notes only.
-- Safe to run twice. limen_db_version() -> 20261023000000.

drop policy if exists "Own curiosity notes: update" on public.curiosity_notes;
create policy "Own curiosity notes: update" on public.curiosity_notes
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.limen_db_version()
returns text
language sql
stable
as $function$ select '20261023000000'::text $function$;
grant execute on function public.limen_db_version() to anon, authenticated;
