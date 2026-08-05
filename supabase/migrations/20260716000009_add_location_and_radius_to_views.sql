-- Fix 2b/5/6: adds location fields, a computed distance_miles (spherical
-- law of cosines / Haversine-equivalent, in miles), and the new profile
-- fields Fix 3's scoring needs (friendship_type, languages,
-- communication_style_*) to both discovery_profiles and browse_profiles,
-- plus the radius hard filter itself.
--
-- The radius ceiling is the VIEWER's own stored search_radius_miles (a
-- second join to the viewer's own profiles row, not just users), so
-- Browse's "session-only" radius adjustment (Fix 2b/6) can only ever
-- narrow further client-side, never widen past what the account's own
-- profile allows, matching "hard filter" literally while still leaving
-- room for a per-session adjustment on top.
--
-- Distance is only enforced when BOTH the viewer and the candidate have a
-- real geocoded location. A candidate or viewer without one (most likely
-- a profile still mid-onboarding, before the newly-required location
-- field was filled in) is not silently hidden or hidden-from just because
-- of a missing coordinate, this view has never gated on profile
-- completeness elsewhere either. distance_miles itself is still exposed
-- as null in that case so the client can render "location not set"
-- rather than a wrong number.
--
-- clamped to [-1, 1] before acos(): floating point rounding on two
-- identical or near-identical coordinates can push the raw expression
-- fractionally above 1.0, which would make acos() return NaN, a real,
-- well-known gotcha with this exact formula, not a hypothetical one.
drop view public.discovery_profiles;

create view public.discovery_profiles as
select
  u.id as user_id,
  u.gender_identity,
  u.matching_preference,
  p.display_name,
  p.birthdate,
  extract(year from age(current_date::timestamptz, p.birthdate::timestamptz))::integer as age,
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
  );

grant select on public.discovery_profiles to authenticated;

-- browse_profiles gets the identical location/distance treatment, same
-- reasoning, its own hard filters are still only gender/pause/radius, no
-- scoring fields matter here the way they do for discovery_profiles, but
-- location/distance are needed for Fix 5's card display and Fix 6's
-- filters either way.
drop view public.browse_profiles;

create view public.browse_profiles as
select
  u.id as user_id,
  u.gender_identity,
  u.matching_preference,
  p.display_name,
  p.birthdate,
  extract(year from age(current_date::timestamptz, p.birthdate::timestamptz))::integer as age,
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
  );

grant select on public.browse_profiles to authenticated;

-- compatible_candidates_for (20260716000006) is discovery_profiles'
-- auth.uid()-free equivalent for the service-role batch refresh, needs
-- the identical location/distance/radius treatment and the new scoring
-- fields, or the batch path would silently skip both the radius hard
-- filter and Fix 3's new scoring inputs. Changing the OUT columns means
-- Postgres requires a real drop first, CREATE OR REPLACE cannot change a
-- function's return row type in place.
drop function if exists public.compatible_candidates_for(uuid);

create function public.compatible_candidates_for(p_user_id uuid)
returns table (
  user_id uuid,
  display_name text,
  age integer,
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
    extract(year from age(current_date::timestamptz, p.birthdate::timestamptz))::integer as age,
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
    );
$$;
