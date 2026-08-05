-- Fix #1 of 23, continued: removes raw `birthdate`/`age` from discovery_
-- profiles, browse_profiles, and compatible_candidates_for entirely,
-- replacing both with `age_band` (public.age_band(), previous migration).
-- This isn't just a client-side omission, a raw age/birthdate column on
-- a view granted `select to authenticated` is directly queryable by
-- anyone with a valid session regardless of what the app's own UI asks
-- for, exactly the same real privacy hole this project already closed
-- once for Big Five scores (big_five_proximity_score, 20260716000003:
-- never expose the underlying value, only a derived, safe one).
--
-- Also adds the mutual min/max friend age hard filter, same tier as the
-- existing gender/pause compatibility filter, not a scoring bonus. Only
-- enforced when BOTH people have a real birthdate on file (most accounts
-- don't yet, onboarding never collected one before this fix), same
-- "not excluded on missing data" pattern the location/radius filter
-- already established for exactly this reason.
drop view public.discovery_profiles;

create view public.discovery_profiles as
select
  u.id as user_id,
  u.gender_identity,
  u.matching_preference,
  p.display_name,
  public.age_band(p.birthdate) as age_band,
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
  p.communication_style_expression,
  p.communication_style_openness,
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
join users viewer on viewer.id = auth.uid()
join profiles viewer_p on viewer_p.user_id = viewer.id
where u.id <> auth.uid()
  and u.gender_identity = viewer.matching_preference
  and u.matching_preference = viewer.gender_identity
  and (u.paused_until is null or u.paused_until <= now())
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

grant select on public.discovery_profiles to authenticated;

drop view public.browse_profiles;

create view public.browse_profiles as
select
  u.id as user_id,
  u.gender_identity,
  u.matching_preference,
  p.display_name,
  public.age_band(p.birthdate) as age_band,
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
  p.communication_style_expression,
  p.communication_style_openness,
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
join users viewer on viewer.id = auth.uid()
join profiles viewer_p on viewer_p.user_id = viewer.id
where u.id <> auth.uid()
  and u.gender_identity = viewer.matching_preference
  and u.matching_preference = viewer.gender_identity
  and (u.paused_until is null or u.paused_until <= now())
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

grant select on public.browse_profiles to authenticated;

drop function if exists public.compatible_candidates_for(uuid);

create function public.compatible_candidates_for(p_user_id uuid)
returns table (
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
  communication_style_expression text,
  communication_style_openness text,
  location_city text,
  location_state text,
  location_country text,
  distance_miles double precision
)
language sql
security definer
set search_path = public
stable
as $$
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
    p.communication_style_expression,
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
$$;
