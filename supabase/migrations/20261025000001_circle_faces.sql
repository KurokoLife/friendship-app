-- 2026-10-25: Your circle design pass (rebuild stage 1b). Every person shows
-- a face, so my_people() also returns the person's profile photo (the same
-- photo their profile already shows to people who can see it). Nothing
-- else changes. Safe to run twice. limen_db_version() -> 20261025000001.

drop function if exists public.my_people();

create or replace function public.my_people()
returns table (other_user_id uuid, connection_id uuid, display_name text, state text, auto_circle text, circle text, moved boolean, photo_url text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select a.other_user_id, a.connection_id, a.display_name, a.state, a.auto_circle,
         case when ch.auto_circle = a.auto_circle then ch.circle else a.auto_circle end,
         coalesce(ch.auto_circle = a.auto_circle and ch.circle <> a.auto_circle, false),
         pr.photo_url
  from public._my_people_auto() a
  join public.profiles pr on pr.user_id = a.other_user_id
  left join public.people_circle_choices ch
    on ch.user_id = auth.uid() and ch.other_user_id = a.other_user_id
  order by a.display_name;
$$;
grant execute on function public.my_people() to authenticated;

create or replace function public.limen_db_version()
returns text
language sql
stable
as $function$ select '20261025000001'::text $function$;
grant execute on function public.limen_db_version() to anon, authenticated;
