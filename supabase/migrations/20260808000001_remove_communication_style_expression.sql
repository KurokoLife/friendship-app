-- Removes communication_style_expression entirely, per explicit request
-- after investigating impact first:
--
-- Scoring impact (generate-match-suggestions): communicationStyleScore
-- currently gives 5 pts if BOTH expression and openness match the
-- candidate, 2 pts if either alone matches, 0 if neither, capped at 5 pts
-- out of the 100-pt model. Dropped cleanly, no rebalancing needed
-- elsewhere: rewritten to a plain binary match on openness alone (5 pts
-- match / 0 no match), same 5-pt bucket weight preserved, the 100-point
-- scale is unchanged. (Edge Function code change, not part of this SQL
-- migration, see the accompanying deploy.)
--
-- AI reflection impact (generate-personality-narrative): confirmed via
-- direct read that profileAtoms() treats every field, including this
-- one, as an independent, optional addSingle() call, no atom-count
-- minimum depends on any specific field being present (isValidSection
-- only requires supportedBy.length > 0). Removing this one atom out of
-- roughly 15-20 real candidates already available in the same category
-- degrades completely gracefully, confirmed, not assumed.
--
-- communication_style_openness confirmed standing on its own: its own
-- independent addSingle() call, its own separate matching-score
-- consideration, its own separate <Section> in profile-build.tsx never
-- sharing markup with expression, was never conditioned on expression's
-- presence anywhere checked.

alter table public.profiles
  drop constraint if exists profiles_communication_style_expression_check;

drop view if exists public.browse_profiles;
drop view if exists public.discovery_profiles;
drop function if exists public.compatible_candidates_for(uuid);

alter table public.profiles
  drop column if exists communication_style_expression;

create view public.discovery_profiles as
 SELECT u.id AS user_id,
    u.gender_identity,
    u.matching_preference,
    p.display_name,
    age_band(p.birthdate) AS age_band,
    p.life_transitions,
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
    p.current_situation,
    p.life_transitions_other,
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
    p.communication_modes
   FROM users u
     JOIN profiles p ON p.user_id = u.id
     JOIN users viewer ON viewer.id = auth.uid()
     JOIN profiles viewer_p ON viewer_p.user_id = viewer.id
  WHERE u.id <> auth.uid() AND u.gender_identity = viewer.matching_preference AND u.matching_preference = viewer.gender_identity AND (u.paused_until IS NULL OR u.paused_until <= now()) AND p.photo_url IS NOT NULL AND NOT (EXISTS ( SELECT 1
           FROM blocks b
          WHERE b.blocker_id = auth.uid() AND b.blocked_id = u.id OR b.blocker_id = u.id AND b.blocked_id = auth.uid())) AND (viewer_p.location_lat IS NULL OR viewer_p.location_lng IS NULL OR p.location_lat IS NULL OR p.location_lng IS NULL OR (3959::double precision * acos(LEAST(1::double precision, GREATEST('-1'::integer::double precision, sin(radians(viewer_p.location_lat)) * sin(radians(p.location_lat)) + cos(radians(viewer_p.location_lat)) * cos(radians(p.location_lat)) * cos(radians(p.location_lng) - radians(viewer_p.location_lng)))))) <= viewer_p.search_radius_miles::double precision) AND (p.birthdate IS NULL OR viewer_p.birthdate IS NULL OR EXTRACT(year FROM age(CURRENT_DATE::timestamp with time zone, p.birthdate::timestamp with time zone))::integer >= viewer_p.min_friend_age AND EXTRACT(year FROM age(CURRENT_DATE::timestamp with time zone, p.birthdate::timestamp with time zone))::integer <= viewer_p.max_friend_age AND EXTRACT(year FROM age(CURRENT_DATE::timestamp with time zone, viewer_p.birthdate::timestamp with time zone))::integer >= p.min_friend_age AND EXTRACT(year FROM age(CURRENT_DATE::timestamp with time zone, viewer_p.birthdate::timestamp with time zone))::integer <= p.max_friend_age);

grant select on public.discovery_profiles to authenticated;

create view public.browse_profiles as
 SELECT u.id AS user_id,
    u.gender_identity,
    u.matching_preference,
    p.display_name,
    age_band(p.birthdate) AS age_band,
    p.life_transitions,
    p.life_transitions_other,
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
    p.current_situation,
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
    p.communication_modes
   FROM users u
     JOIN profiles p ON p.user_id = u.id
     JOIN users viewer ON viewer.id = auth.uid()
     JOIN profiles viewer_p ON viewer_p.user_id = viewer.id
  WHERE u.id <> auth.uid() AND u.gender_identity = viewer.matching_preference AND u.matching_preference = viewer.gender_identity AND (u.paused_until IS NULL OR u.paused_until <= now()) AND p.photo_url IS NOT NULL AND NOT (EXISTS ( SELECT 1
           FROM blocks b
          WHERE b.blocker_id = auth.uid() AND b.blocked_id = u.id OR b.blocker_id = u.id AND b.blocked_id = auth.uid())) AND (viewer_p.location_lat IS NULL OR viewer_p.location_lng IS NULL OR p.location_lat IS NULL OR p.location_lng IS NULL OR (3959::double precision * acos(LEAST(1::double precision, GREATEST('-1'::integer::double precision, sin(radians(viewer_p.location_lat)) * sin(radians(p.location_lat)) + cos(radians(viewer_p.location_lat)) * cos(radians(p.location_lat)) * cos(radians(p.location_lng) - radians(viewer_p.location_lng)))))) <= viewer_p.search_radius_miles::double precision) AND (p.birthdate IS NULL OR viewer_p.birthdate IS NULL OR EXTRACT(year FROM age(CURRENT_DATE::timestamp with time zone, p.birthdate::timestamp with time zone))::integer >= viewer_p.min_friend_age AND EXTRACT(year FROM age(CURRENT_DATE::timestamp with time zone, p.birthdate::timestamp with time zone))::integer <= viewer_p.max_friend_age AND EXTRACT(year FROM age(CURRENT_DATE::timestamp with time zone, viewer_p.birthdate::timestamp with time zone))::integer >= p.min_friend_age AND EXTRACT(year FROM age(CURRENT_DATE::timestamp with time zone, viewer_p.birthdate::timestamp with time zone))::integer <= p.max_friend_age);

grant select on public.browse_profiles to authenticated;

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
  current_situation text,
  languages text[],
  friendship_type text,
  communication_style_openness text,
  location_city text,
  location_state text,
  location_country text,
  distance_miles double precision
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
    p.current_situation,
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
    end as distance_miles
  from users u
  join profiles p on p.user_id = u.id
  join users viewer on viewer.id = p_user_id
  join profiles viewer_p on viewer_p.user_id = viewer.id
  where u.id <> p_user_id
    and u.gender_identity = viewer.matching_preference
    and u.matching_preference = viewer.gender_identity
    and (u.paused_until is null or u.paused_until <= now())
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
