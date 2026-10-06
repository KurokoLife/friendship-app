-- Onboarding fixes (2026-10-05), from the founder's onboarding test.
--
-- 1. "What kind of friendship are you hoping to build?" becomes "pick up
--    to 2" (profiles.friendship_types). friendship_type is kept and holds
--    the first pick, so older code keeps working. "A social circle" is no
--    longer offered (Limen introduces one person at a time).
-- 2. Profile photos: only JPG, PNG or WebP, up to 10 MB, enforced by the
--    storage bucket too (the app already checks before uploading).
-- 3. The group-size question is no longer asked. Nothing to change in the
--    database: hangout_people_preference stays, unused.
--
-- The four discovery views/functions below are the 2026-10-04 versions
-- with one column, friendship_types, added at the end.

alter table public.profiles add column if not exists friendship_types text[];

alter table public.profiles drop constraint if exists profiles_friendship_types_check;
alter table public.profiles add constraint profiles_friendship_types_check check (
  friendship_types is null
  or (
    cardinality(friendship_types) between 1 and 2
    and friendship_types <@ array[
      'Deep 1-on-1 connection',
      'Activity partner',
      'Someone to navigate this life stage with',
      'Open to whatever forms naturally'
    ]::text[]
  )
);

-- Carry over existing single answers (skipping the retired option).
update public.profiles
set friendship_types = array[friendship_type]
where friendship_types is null
  and friendship_type is not null
  and friendship_type <> 'A social circle';

update storage.buckets
set file_size_limit = 10485760,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'profile-photos';

create or replace view public.discovery_profiles as
 SELECT u.id AS user_id,
    u.gender_identity,
    u.matching_preference,
    p.display_name,
    age_band(p.birthdate) AS age_band,
    CASE WHEN p.show_life_transitions THEN p.life_transitions ELSE '{}'::text[] END AS life_transitions,
    p.activity_interests,
    p."values",
    p.hangout_people_preference,
    p.hangout_type_preference,
    p.communication_freq,
    p.meeting_freq,
    p.response_time,
    p.personal_statement,
    p.bar_preference,
    p.photo_url,
    p.completion_pct,
    p.dealbreakers,
    p.personality_16p,
    CASE WHEN p.show_life_transitions THEN p.life_transitions_other ELSE NULL END AS life_transitions_other,
    p.values_other,
    p.location_city,
    p.location_state,
    p.location_country,
    p.location_lat,
    p.location_lng,
    p.ethnicity,
    p.ethnicity_other,
    p.languages,
    p.languages_other,
    p.friendship_type,
    p.communication_style_openness,
        CASE
            WHEN viewer_p.location_lat IS NULL OR viewer_p.location_lng IS NULL OR p.location_lat IS NULL OR p.location_lng IS NULL THEN NULL::double precision
            ELSE 3959::double precision * acos(LEAST(1::double precision, GREATEST('-1'::integer::double precision, sin(radians(viewer_p.location_lat)) * sin(radians(p.location_lat)) + cos(radians(viewer_p.location_lat)) * cos(radians(p.location_lat)) * cos(radians(p.location_lng) - radians(viewer_p.location_lng)))))
        END AS distance_miles,
    p.availability,
    p.communication_modes,
    p.extra_photo_urls,
    (u.selfie_verified_at IS NOT NULL) AS selfie_verified,
    u.social_linked,
    p.friendship_types
   FROM users u
     JOIN profiles p ON p.user_id = u.id
     JOIN users viewer ON viewer.id = auth.uid()
     JOIN profiles viewer_p ON viewer_p.user_id = viewer.id
  WHERE u.id <> auth.uid()
    AND genders_match(viewer.gender_identity, viewer.meet_genders, u.gender_identity, u.meet_genders)
    AND (u.paused_until IS NULL OR u.paused_until <= now())
    AND u.suspended_at IS NULL
    AND p.photo_url IS NOT NULL
    AND NOT (EXISTS ( SELECT 1 FROM blocks b
          WHERE b.blocker_id = auth.uid() AND b.blocked_id = u.id OR b.blocker_id = u.id AND b.blocked_id = auth.uid()))
    AND (viewer_p.location_lat IS NULL OR viewer_p.location_lng IS NULL OR p.location_lat IS NULL OR p.location_lng IS NULL OR (3959::double precision * acos(LEAST(1::double precision, GREATEST('-1'::integer::double precision, sin(radians(viewer_p.location_lat)) * sin(radians(p.location_lat)) + cos(radians(viewer_p.location_lat)) * cos(radians(p.location_lat)) * cos(radians(p.location_lng) - radians(viewer_p.location_lng)))))) <= viewer_p.search_radius_miles::double precision)
    AND (p.birthdate IS NULL OR viewer_p.birthdate IS NULL OR EXTRACT(year FROM age(CURRENT_DATE::timestamp with time zone, p.birthdate::timestamp with time zone))::integer >= viewer_p.min_friend_age AND EXTRACT(year FROM age(CURRENT_DATE::timestamp with time zone, p.birthdate::timestamp with time zone))::integer <= viewer_p.max_friend_age AND EXTRACT(year FROM age(CURRENT_DATE::timestamp with time zone, viewer_p.birthdate::timestamp with time zone))::integer >= p.min_friend_age AND EXTRACT(year FROM age(CURRENT_DATE::timestamp with time zone, viewer_p.birthdate::timestamp with time zone))::integer <= p.max_friend_age);

create or replace view public.browse_profiles as
 SELECT u.id AS user_id,
    u.gender_identity,
    u.matching_preference,
    p.display_name,
    age_band(p.birthdate) AS age_band,
    CASE WHEN p.show_life_transitions THEN p.life_transitions ELSE '{}'::text[] END AS life_transitions,
    CASE WHEN p.show_life_transitions THEN p.life_transitions_other ELSE NULL END AS life_transitions_other,
    p.activity_interests,
    p."values",
    p.values_other,
    p.hangout_people_preference,
    p.hangout_type_preference,
    p.communication_freq,
    p.meeting_freq,
    p.response_time,
    p.personal_statement,
    p.bar_preference,
    p.photo_url,
    p.completion_pct,
    p.dealbreakers,
    p.personality_16p,
    p.location_city,
    p.location_state,
    p.location_country,
    p.location_lat,
    p.location_lng,
    p.ethnicity,
    p.ethnicity_other,
    p.languages,
    p.languages_other,
    p.friendship_type,
    p.communication_style_openness,
        CASE
            WHEN viewer_p.location_lat IS NULL OR viewer_p.location_lng IS NULL OR p.location_lat IS NULL OR p.location_lng IS NULL THEN NULL::double precision
            ELSE 3959::double precision * acos(LEAST(1::double precision, GREATEST('-1'::integer::double precision, sin(radians(viewer_p.location_lat)) * sin(radians(p.location_lat)) + cos(radians(viewer_p.location_lat)) * cos(radians(p.location_lat)) * cos(radians(p.location_lng) - radians(viewer_p.location_lng)))))
        END AS distance_miles,
    p.availability,
    p.communication_modes,
    p.friendship_types
   FROM users u
     JOIN profiles p ON p.user_id = u.id
     JOIN users viewer ON viewer.id = auth.uid()
     JOIN profiles viewer_p ON viewer_p.user_id = viewer.id
  WHERE u.id <> auth.uid()
    AND genders_match(viewer.gender_identity, viewer.meet_genders, u.gender_identity, u.meet_genders)
    AND (u.paused_until IS NULL OR u.paused_until <= now())
    AND u.suspended_at IS NULL
    AND p.photo_url IS NOT NULL
    AND NOT (EXISTS ( SELECT 1 FROM blocks b
          WHERE b.blocker_id = auth.uid() AND b.blocked_id = u.id OR b.blocker_id = u.id AND b.blocked_id = auth.uid()))
    AND (viewer_p.location_lat IS NULL OR viewer_p.location_lng IS NULL OR p.location_lat IS NULL OR p.location_lng IS NULL OR (3959::double precision * acos(LEAST(1::double precision, GREATEST('-1'::integer::double precision, sin(radians(viewer_p.location_lat)) * sin(radians(p.location_lat)) + cos(radians(viewer_p.location_lat)) * cos(radians(p.location_lat)) * cos(radians(p.location_lng) - radians(viewer_p.location_lng)))))) <= viewer_p.search_radius_miles::double precision)
    AND (p.birthdate IS NULL OR viewer_p.birthdate IS NULL OR EXTRACT(year FROM age(CURRENT_DATE::timestamp with time zone, p.birthdate::timestamp with time zone))::integer >= viewer_p.min_friend_age AND EXTRACT(year FROM age(CURRENT_DATE::timestamp with time zone, p.birthdate::timestamp with time zone))::integer <= viewer_p.max_friend_age AND EXTRACT(year FROM age(CURRENT_DATE::timestamp with time zone, viewer_p.birthdate::timestamp with time zone))::integer >= p.min_friend_age AND EXTRACT(year FROM age(CURRENT_DATE::timestamp with time zone, viewer_p.birthdate::timestamp with time zone))::integer <= p.max_friend_age);

create or replace view public.my_public_preview as
select
  u.id as user_id,
  p.display_name,
  age_band(p.birthdate) as age_band,
  p.location_city,
  p.location_state,
  case when p.show_life_transitions then p.life_transitions else '{}'::text[] end as life_transitions,
  case when p.show_life_transitions then p.life_transitions_other else null end as life_transitions_other,
  p.values,
  p.values_other,
  p.activity_interests,
  p.hangout_people_preference,
  p.hangout_type_preference,
  p.communication_freq,
  p.meeting_freq,
  p.response_time,
  p.friendship_type,
  p.communication_style_openness,
  p.availability,
  p.communication_modes,
  p.languages,
  p.languages_other,
  p.ethnicity,
  p.ethnicity_other,
  p.personal_statement,
  p.bar_preference,
  p.dealbreakers,
  p.personality_16p,
  p.photo_url,
  p.extra_photo_urls,
  (u.selfie_verified_at is not null) as selfie_verified,
  u.social_linked,
  p.friendship_types
from users u
join profiles p on p.user_id = u.id
where u.id = auth.uid();

drop function if exists public.compatible_candidates_for(uuid);

create function public.compatible_candidates_for(p_user_id uuid)
returns table(
  user_id uuid,
  display_name text,
  age_band text,
  life_transitions text[],
  activity_interests jsonb,
  "values" text[],
  hangout_people_preference text,
  hangout_type_preference text[],
  meeting_freq text,
  communication_freq text,
  personal_statement text,
  languages text[],
  friendship_type text,
  communication_style_openness text,
  location_city text,
  location_state text,
  location_country text,
  distance_miles double precision,
  show_life_transitions boolean,
  interested_in_viewer boolean,
  ghosting_penalized boolean,
  friendship_types text[]
)
language sql
stable security definer
set search_path to 'public'
as $function$
  select
    u.id as user_id,
    p.display_name,
    public.age_band(p.birthdate) as age_band,
    p.life_transitions,
    p.activity_interests,
    p."values",
    p.hangout_people_preference,
    p.hangout_type_preference,
    p.meeting_freq,
    p.communication_freq,
    p.personal_statement,
    p.languages,
    p.friendship_type,
    p.communication_style_openness,
    p.location_city,
    p.location_state,
    p.location_country,
    case
      when viewer_p.location_lat is null or viewer_p.location_lng is null
        or p.location_lat is null or p.location_lng is null then null
      else 3959 * acos(least(1, greatest(-1,
        sin(radians(viewer_p.location_lat)) * sin(radians(p.location_lat))
        + cos(radians(viewer_p.location_lat)) * cos(radians(p.location_lat))
          * cos(radians(p.location_lng) - radians(viewer_p.location_lng))
      )))
    end as distance_miles,
    p.show_life_transitions,
    exists (select 1 from public.interests i where i.from_user_id = u.id and i.to_user_id = p_user_id) as interested_in_viewer,
    public.is_ghosting_penalized(u.id) as ghosting_penalized,
    p.friendship_types
  from users u
  join profiles p on p.user_id = u.id
  join users viewer on viewer.id = p_user_id
  join profiles viewer_p on viewer_p.user_id = viewer.id
  where u.id <> p_user_id
    and public.genders_match(viewer.gender_identity, viewer.meet_genders, u.gender_identity, u.meet_genders)
    and (u.paused_until is null or u.paused_until <= now())
    and u.suspended_at is null
    and p.photo_url is not null
    and not exists (
      select 1 from public.blocks b
      where (b.blocker_id = p_user_id and b.blocked_id = u.id)
         or (b.blocker_id = u.id and b.blocked_id = p_user_id)
    )
    and (
      viewer_p.location_lat is null or viewer_p.location_lng is null
      or p.location_lat is null or p.location_lng is null
      or 3959 * acos(least(1, greatest(-1,
          sin(radians(viewer_p.location_lat)) * sin(radians(p.location_lat))
          + cos(radians(viewer_p.location_lat)) * cos(radians(p.location_lat))
            * cos(radians(p.location_lng) - radians(viewer_p.location_lng))
        ))) <= viewer_p.search_radius_miles
    )
    and (
      p.birthdate is null or viewer_p.birthdate is null
      or (
        extract(year from age(current_date::timestamptz, p.birthdate::timestamptz))::integer
          between viewer_p.min_friend_age and viewer_p.max_friend_age
        and extract(year from age(current_date::timestamptz, viewer_p.birthdate::timestamptz))::integer
          between p.min_friend_age and p.max_friend_age
      )
    );
$function$;

revoke all on function public.compatible_candidates_for(uuid) from public, anon, authenticated;
grant execute on function public.compatible_candidates_for(uuid) to service_role;
