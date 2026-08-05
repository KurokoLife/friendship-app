-- Three of the four remaining confirmed profile gaps from blueprint
-- Section 8, all flagged since early in this project. Item 4 (radius
-- pool warning) is client-side only, no schema change, not in this file.

-- Item 1: availability (general time-availability pattern). Multi-select,
-- matching the established uncapped-array convention already used for
-- life_transitions/values/hangout_type_preference, since a person can
-- reasonably have more than one true availability window. Not required
-- for matching, not a hard filter, same soft-preference treatment those
-- other optional array fields already get. No value-check constraint,
-- matching the exact same convention hangout_type_preference/
-- life_transitions already use (a closed client-side chip list, not a
-- database-level check).
alter table public.profiles add column if not exists availability text[];

-- Item 2: preferred communication modes (text / voice note / call / in
-- person). Confirmed in an earlier session to be genuinely distinct from
-- communication_style_expression (conflict-avoidance style) and
-- communication_style_openness (how soon someone shares personal
-- things), not a naming overlap. Same multi-select, no-constraint,
-- not-required-for-matching treatment as availability above.
alter table public.profiles add column if not exists communication_modes text[];

-- Real seed-data gap caught before it could break the app, same class of
-- problem the location/radius session's own seeding fix (see PROGRESS.md,
-- July 16) already hit once: every one of the 9 real seed accounts has
-- photo_url = null, confirmed live before writing this. Shipping the
-- photo gate below as-is would have made every seed account invisible to
-- every other one, breaking every already-verified compatible pairing
-- this project's test history depends on. Seeded a distinct placeholder
-- avatar image (pravatar.cc, a public, stable, free placeholder avatar
-- service, not a real photo of any real person) for each of the 9 real
-- seed accounts, same synthetic-test-data reasoning already applied to
-- every other seed field in this project.
with seed_accounts as (
  select p.user_id, row_number() over (order by p.user_id) as rn
  from profiles p
  join auth.users u on u.id = p.user_id
  where u.phone like '+1555550%'
)
update profiles p
set photo_url = 'https://i.pravatar.cc/400?img=' || (10 + seed_accounts.rn)
from seed_accounts
where p.user_id = seed_accounts.user_id
  and p.photo_url is null;

-- Item 3: photo required before a profile becomes visible in discovery or
-- browse, a real trust and safety gap in the same category as Report &
-- Block, a profile with no verified photo is a vector for the
-- fake-identity problem reporting exists to catch. discovery_profiles and
-- browse_profiles both recreated with p.photo_url IS NOT NULL added to
-- the WHERE clause, at the same tier as the existing gender/pause/block
-- filters, not just a display convention. Column lists otherwise
-- unchanged except for the two new fields above.
create or replace view public.discovery_profiles as
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
    p.communication_style_expression,
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
  WHERE u.id <> auth.uid()
    AND u.gender_identity = viewer.matching_preference
    AND u.matching_preference = viewer.gender_identity
    AND (u.paused_until IS NULL OR u.paused_until <= now())
    AND p.photo_url IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.blocks b
      WHERE (b.blocker_id = auth.uid() AND b.blocked_id = u.id)
         OR (b.blocker_id = u.id AND b.blocked_id = auth.uid())
    )
    AND (viewer_p.location_lat IS NULL OR viewer_p.location_lng IS NULL OR p.location_lat IS NULL OR p.location_lng IS NULL OR (3959::double precision * acos(LEAST(1::double precision, GREATEST('-1'::integer::double precision, sin(radians(viewer_p.location_lat)) * sin(radians(p.location_lat)) + cos(radians(viewer_p.location_lat)) * cos(radians(p.location_lat)) * cos(radians(p.location_lng) - radians(viewer_p.location_lng)))))) <= viewer_p.search_radius_miles::double precision)
    AND (p.birthdate IS NULL OR viewer_p.birthdate IS NULL OR EXTRACT(year FROM age(CURRENT_DATE::timestamp with time zone, p.birthdate::timestamp with time zone))::integer >= viewer_p.min_friend_age AND EXTRACT(year FROM age(CURRENT_DATE::timestamp with time zone, p.birthdate::timestamp with time zone))::integer <= viewer_p.max_friend_age AND EXTRACT(year FROM age(CURRENT_DATE::timestamp with time zone, viewer_p.birthdate::timestamp with time zone))::integer >= p.min_friend_age AND EXTRACT(year FROM age(CURRENT_DATE::timestamp with time zone, viewer_p.birthdate::timestamp with time zone))::integer <= p.max_friend_age);

create or replace view public.browse_profiles as
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
    p.communication_style_expression,
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
  WHERE u.id <> auth.uid()
    AND u.gender_identity = viewer.matching_preference
    AND u.matching_preference = viewer.gender_identity
    AND (u.paused_until IS NULL OR u.paused_until <= now())
    AND p.photo_url IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.blocks b
      WHERE (b.blocker_id = auth.uid() AND b.blocked_id = u.id)
         OR (b.blocker_id = u.id AND b.blocked_id = auth.uid())
    )
    AND (viewer_p.location_lat IS NULL OR viewer_p.location_lng IS NULL OR p.location_lat IS NULL OR p.location_lng IS NULL OR (3959::double precision * acos(LEAST(1::double precision, GREATEST('-1'::integer::double precision, sin(radians(viewer_p.location_lat)) * sin(radians(p.location_lat)) + cos(radians(viewer_p.location_lat)) * cos(radians(p.location_lat)) * cos(radians(p.location_lng) - radians(viewer_p.location_lng)))))) <= viewer_p.search_radius_miles::double precision)
    AND (p.birthdate IS NULL OR viewer_p.birthdate IS NULL OR EXTRACT(year FROM age(CURRENT_DATE::timestamp with time zone, p.birthdate::timestamp with time zone))::integer >= viewer_p.min_friend_age AND EXTRACT(year FROM age(CURRENT_DATE::timestamp with time zone, p.birthdate::timestamp with time zone))::integer <= viewer_p.max_friend_age AND EXTRACT(year FROM age(CURRENT_DATE::timestamp with time zone, viewer_p.birthdate::timestamp with time zone))::integer >= p.min_friend_age AND EXTRACT(year FROM age(CURRENT_DATE::timestamp with time zone, viewer_p.birthdate::timestamp with time zone))::integer <= p.max_friend_age);
