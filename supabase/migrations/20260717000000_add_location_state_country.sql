-- Fix 1: structured location (country/state/city cascade) replaces the
-- free-text "City, State" single field. location_city now holds just the
-- city (e.g. "Los Angeles"), location_state/location_country are new,
-- separate columns, standardized values resolved server-side by
-- geocode-city rather than however the user happened to type them, so
-- "los angeles, ca" and "Los Angeles, CA" can no longer both exist.
alter table public.profiles
  add column if not exists location_state text,
  add column if not exists location_country text not null default 'United States';

-- Backfill: every existing profile stored location_city as "City, State"
-- (all US, per supabase/seed/add-location-and-new-fields.sql). Split on
-- the comma into the two new columns and trim location_city down to just
-- the city part, so old and new rows share the same shape going forward.
update public.profiles
set
  location_state = trim(split_part(location_city, ',', 2)),
  location_city = trim(split_part(location_city, ',', 1))
where location_city like '%,%';

-- discovery_profiles/browse_profiles/compatible_candidates_for all need
-- the two new columns alongside the location_city they already expose.
-- Requires a real drop first (adding OUT columns to the function, and
-- Postgres won't let CREATE OR REPLACE VIEW change a view's column list
-- either), same reasoning as every other location-related migration this
-- project has already made.
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
  );

grant select on public.discovery_profiles to authenticated;

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
  );

grant select on public.browse_profiles to authenticated;

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
    );
$$;

-- Fix 5: "Something else" was removed from the selectable life transition
-- options in an earlier session, but one real account had it stored from
-- before that removal. Strips just that array element (not the whole
-- array) from every profile that has it, so any other real transitions
-- that account selected are left untouched.
update public.profiles
set life_transitions = array_remove(life_transitions, 'Something else')
where 'Something else' = any(life_transitions);
