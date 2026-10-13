-- 2026-10-12: Test tab tool "Why is Discover empty?". Safe to run twice.
--
-- Counts, step by step, how many people are left after each Discover
-- rule for the signed-in test account, so an empty Discover can be
-- explained without opening Supabase. Admins and test accounts only.
-- limen_db_version() -> 20261012000000.

create or replace function public.test_discover_why(p_tz text default null)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_me uuid := auth.uid();
  v_viewer record;
  v_total int; v_gender int; v_active int; v_photo int; v_distance int; v_age int;
  v_room int; v_nochat int; v_notpassed int; v_notsaved int; v_notint int; v_notrecent int;
  v_out text;
begin
  if not public.is_test_operator() then raise exception 'Test tools are only for admins and test accounts'; end if;
  select u.gender_identity, u.meet_genders, p.location_lat, p.location_lng, p.search_radius_miles,
         p.birthdate, p.min_friend_age, p.max_friend_age, p.photo_url
    into v_viewer
  from public.users u join public.profiles p on p.user_id = u.id where u.id = v_me;

  create temp table if not exists _why (id uuid primary key) on commit drop;
  truncate _why;
  insert into _why select u.id from public.users u join public.profiles p on p.user_id = u.id where u.id <> v_me;
  select count(*) into v_total from _why;

  delete from _why w using public.users u
   where u.id = w.id and not public.genders_match(v_viewer.gender_identity, v_viewer.meet_genders, u.gender_identity, u.meet_genders);
  select count(*) into v_gender from _why;

  delete from _why w using public.users u
   where u.id = w.id and (u.suspended_at is not null or (u.paused_until is not null and u.paused_until > now())
     or exists (select 1 from public.blocks b where (b.blocker_id = v_me and b.blocked_id = u.id) or (b.blocker_id = u.id and b.blocked_id = v_me)));
  select count(*) into v_active from _why;

  delete from _why w using public.profiles p where p.user_id = w.id and p.photo_url is null;
  select count(*) into v_photo from _why;

  delete from _why w using public.profiles p
   where p.user_id = w.id
     and v_viewer.location_lat is not null and v_viewer.location_lng is not null
     and p.location_lat is not null and p.location_lng is not null
     and 3959 * acos(least(1, greatest(-1,
           sin(radians(v_viewer.location_lat)) * sin(radians(p.location_lat))
           + cos(radians(v_viewer.location_lat)) * cos(radians(p.location_lat))
             * cos(radians(p.location_lng) - radians(v_viewer.location_lng))))) > v_viewer.search_radius_miles;
  select count(*) into v_distance from _why;

  delete from _why w using public.profiles p
   where p.user_id = w.id and p.birthdate is not null and v_viewer.birthdate is not null
     and not (
       extract(year from age(current_date::timestamptz, p.birthdate::timestamptz))::int between v_viewer.min_friend_age and v_viewer.max_friend_age
       and extract(year from age(current_date::timestamptz, v_viewer.birthdate::timestamptz))::int between p.min_friend_age and p.max_friend_age);
  select count(*) into v_age from _why;

  delete from _why w where not public.has_room(w.id);
  select count(*) into v_room from _why;
  delete from _why w where public.pair_had_chat(v_me, w.id);
  select count(*) into v_nochat from _why;
  delete from _why w where exists (select 1 from public.connections c where c.user_a_id = v_me and c.user_b_id = w.id and c.status = 'passed');
  select count(*) into v_notpassed from _why;
  delete from _why w where public.save_is_open(v_me, w.id);
  select count(*) into v_notsaved from _why;
  delete from _why w where public.interest_is_open(v_me, w.id);
  select count(*) into v_notint from _why;
  delete from _why w where exists (select 1 from public.match_suggestions s where s.user_id = v_me and s.candidate_id = w.id and s.created_at > now() - interval '21 days');
  select count(*) into v_notrecent from _why;

  v_out := format(
    E'People who could show in Discover for this account, after each rule:\n%s other people with a profile\n%s match who you would like to meet (both ways)\n%s not paused, suspended or blocked\n%s have a profile photo\n%s within your distance (%s miles%s)\n%s within both age ranges\n%s have room (fewer than 3 active chats)\n%s you have never had a chat with\n%s you did not pass on\n%s not in your Saved\n%s you have not said Interested to\n%s not shown to you in the last 21 days\n\nYou have room for new people: %s. A new person can be added today: %s.',
    v_total, v_gender, v_active, v_photo, v_distance, coalesce(v_viewer.search_radius_miles::text, '?'),
    case when v_viewer.location_lat is null then ', no location set' else '' end,
    v_age, v_room, v_nochat, v_notpassed, v_notsaved, v_notint, v_notrecent,
    case when public.has_room(v_me) then 'yes' else 'no' end,
    case when public.discover_can_add(v_me, p_tz) then 'yes' else 'no' end);
  return v_out;
end;
$$;
grant execute on function public.test_discover_why(text) to authenticated;

create or replace function public.limen_db_version()
returns text
language sql
stable
as $function$ select '20261012000000'::text $function$;
grant execute on function public.limen_db_version() to anon, authenticated;
