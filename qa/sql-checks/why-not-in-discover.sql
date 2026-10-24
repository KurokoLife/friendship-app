-- Why isn't one person showing in another person's Discover?
with v as (select id from public.users u join public.profiles p on p.user_id = u.id where p.display_name ilike 'YOUR NAME%' limit 1),
     c as (select id from public.users u join public.profiles p on p.user_id = u.id where p.display_name ilike 'Popo P%' limit 1),
     vp as (select p.*, u.gender_identity, u.meet_genders, u.paused_until from public.profiles p join public.users u on u.id = p.user_id where p.user_id = (select id from v)),
     cp as (select p.*, u.gender_identity, u.meet_genders, u.paused_until, u.suspended_at from public.profiles p join public.users u on u.id = p.user_id where p.user_id = (select id from c)),
     d as (select case when vp.location_lat is null or cp.location_lat is null then null else round((3959 * acos(least(1, greatest(-1,
            sin(radians(vp.location_lat)) * sin(radians(cp.location_lat)) + cos(radians(vp.location_lat)) * cos(radians(cp.location_lat))
            * cos(radians(cp.location_lng) - radians(vp.location_lng))))))::numeric, 1) end as miles from vp, cp)
select * from (values
  ('Found both people', (select count(*) from v) = 1 and (select count(*) from c) = 1, ''),
  ('Already a chat between you (then they are in Inbox, not Discover)', public.pair_had_chat((select id from v), (select id from c)), ''),
  ('They said Interested in you (open)', public.interest_is_open((select id from c), (select id from v)), ''),
  ('You said Interested in them (then they are in Inbox, Pending)', public.interest_is_open((select id from v), (select id from c)), ''),
  ('You saved them (then they are in Saved)', public.save_is_open((select id from v), (select id from c)), ''),
  ('Gender preferences match both ways', (select public.genders_match(vp.gender_identity, vp.meet_genders, cp.gender_identity, cp.meet_genders) from vp, cp), ''),
  ('Within your distance', (select d.miles is null or d.miles <= vp.search_radius_miles from d, vp), (select coalesce(d.miles::text, '?') || ' mi, your limit ' || vp.search_radius_miles from d, vp)),
  ('Their age is in your range', (select extract(year from age(cp.birthdate))::int between vp.min_friend_age and vp.max_friend_age from vp, cp), (select extract(year from age(cp.birthdate))::int || ' vs ' || vp.min_friend_age || '-' || vp.max_friend_age from vp, cp)),
  ('Your age is in their range', (select extract(year from age(vp.birthdate))::int between cp.min_friend_age and cp.max_friend_age from vp, cp), (select extract(year from age(vp.birthdate))::int || ' vs ' || cp.min_friend_age || '-' || cp.max_friend_age from vp, cp)),
  ('A shared language', (select exists (select 1 from unnest(coalesce(cp.languages,'{}')) l where l <> 'Other' and l = any(coalesce(vp.languages,'{}'))) from vp, cp), (select coalesce(array_to_string(vp.languages, ','),'none') || ' / ' || coalesce(array_to_string(cp.languages, ','),'none') from vp, cp)),
  ('They have a profile photo', (select cp.photo_url is not null from cp), ''),
  ('They are not on a break or paused', (select cp.paused_until is null or cp.paused_until <= now() from cp), ''),
  ('You are not on a break', (select vp.paused_until is null or vp.paused_until <= now() from vp), ''),
  ('They have room (fewer than 3 active chats)', public.has_room((select id from c)), ''),
  ('You have room (fewer than 3 active chats)', public.has_room((select id from v)), ''),
  ('Not shown to you in the last 21 days', not exists (select 1 from public.match_suggestions s where s.user_id = (select id from v) and s.candidate_id = (select id from c) and s.created_at > now() - interval '21 days'), ''),
  ('Someone new was already added for you today (one a day)', exists (select 1 from public.match_suggestions s where s.user_id = (select id from v) and s.created_at > now() - interval '20 hours'), '')
) as t(check_name, result, detail);
