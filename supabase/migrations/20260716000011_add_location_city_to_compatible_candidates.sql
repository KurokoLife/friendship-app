-- Fix 5: compatible_candidates_for (the batch-mode candidate source) was
-- missing location_city, distance_miles alone isn't enough for the
-- "show city name if distance can't be shown" fallback Fix 5 needs, and
-- the batch path casts its RPC result straight to the Candidate type,
-- which now expects location_city, an undefined field at runtime, not a
-- caught error, exactly the kind of silent gap worth fixing before it
-- ships. Requires a drop again, same reasoning as before, adding an OUT
-- column changes the function's row type.
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
