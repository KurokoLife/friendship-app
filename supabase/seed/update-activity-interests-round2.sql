-- Richer activity_interests for all 9 seed profiles (real test account,
-- 18189719076/user_id 777b01a9-..., is deliberately excluded, that's real
-- user data, not seed data). Uses the expanded 40-category system already
-- live in ACTIVITY_CATEGORIES (src/app/profile-build.tsx), each field
-- name/option value below matches that list exactly.
--
-- The earlier draft (update-activity-interests-and-transitions.sql) was
-- written but never actually applied (confirmed live: the current
-- activity_interests on every one of these 9 profiles still has the old,
-- pre-expansion 2-3 category shape). This file supersedes it and adds one
-- pairing that draft didn't have: Robert Kim was previously documented as
-- having "no mutually-compatible seed partner" and therefore no deliberate
-- overlap with anyone. Explicit instruction this session asks specifically
-- for Robert Kim / Marcus Alvarez to share 2+ categories (golf, fitness),
-- so his set now includes those two in addition to the bereavement-
-- appropriate ones (outdoors, reading, gardening_plants) that already fit
-- his current_situation/personal_statement. Note this pairing is still not
-- mutually visible in the app itself (Robert seeks women, Marcus is a man
-- seeking men), the overlap exists in the data for testing/analysis
-- purposes as literally requested, not because they'd ever actually match.
--
-- Other deliberate overlaps, matched to real mutual-compatibility pairs:
--   Maria Santos / Aisha Bello / Elena Torres (all woman/woman): all three
--   share outdoors + tennis_pickleball (both "Intermediate"), so "why
--   might we connect?" has a concrete detail-level match to cite, not just
--   a shared category name. Maria and Elena additionally share
--   wine_cocktails_beer.
--   Jordan Blake / Sam Rivera (transgender-seeks-queer /
--   queer-seeks-transgender, mutually compatible): share live_music (both
--   "Small clubs") and coffee_culture (both "Espresso").
-- David Chen and Priya Nair have no mutually-compatible seed partner
-- (unchanged from before), their data is rich and realistic on its own.
--
-- life_transitions are NOT touched here, per this session's explicit
-- instruction to only "confirm" them, not change them, current live
-- values for all 9 are already valid arrays of 1-3 values from the
-- 13-option list (verified via a direct read-only query before writing
-- this file).

update public.profiles
set activity_interests = jsonb_build_object(
  'categories', array['outdoors', 'tennis_pickleball', 'food', 'wine_cocktails_beer', 'coffee_culture'],
  'details', jsonb_build_object(
    'outdoors', jsonb_build_object('activities', array['Hiking', 'Beach days'], 'favorite_spot', 'The trail by the reservoir'),
    'tennis_pickleball', jsonb_build_object('which', 'Pickleball', 'skill_level', 'Intermediate'),
    'food', jsonb_build_object('cuisines', array['Italian', 'Mexican'], 'favorite_spots', 'A little taqueria near my old apartment'),
    'wine_cocktails_beer', jsonb_build_object('preference', 'Wine', 'favorites', 'A cozy wine bar near downtown, most Tuesday nights'),
    'coffee_culture', jsonb_build_object('style', 'Pour over', 'favorite_spots', 'The corner shop two blocks from home')
  )
)
where user_id = '3e800518-287b-4705-bdae-06d53ffd450b'; -- Maria Santos

update public.profiles
set activity_interests = jsonb_build_object(
  'categories', array['outdoors', 'tennis_pickleball', 'travel', 'arts_culture'],
  'details', jsonb_build_object(
    'outdoors', jsonb_build_object('activities', array['Hiking', 'Kayaking'], 'favorite_spot', 'Anywhere near water, still exploring the area'),
    'tennis_pickleball', jsonb_build_object('which', 'Pickleball', 'skill_level', 'Intermediate'),
    'travel', jsonb_build_object('types', array['Adventure', 'City breaks'], 'dream_destination', 'Patagonia, eventually'),
    'arts_culture', jsonb_build_object('interests', array['Museums', 'Live music'], 'favorites', 'Any small gallery opening')
  )
)
where user_id = 'c6b092f0-f372-4f1d-af7f-6d73b78a2bcd'; -- Aisha Bello

update public.profiles
set activity_interests = jsonb_build_object(
  'categories', array['outdoors', 'tennis_pickleball', 'arts_culture', 'reading', 'wine_cocktails_beer'],
  'details', jsonb_build_object(
    'outdoors', jsonb_build_object('activities', array['Hiking', 'Beach days'], 'favorite_spot', 'The same reservoir trail, most Saturdays'),
    'tennis_pickleball', jsonb_build_object('which', 'Pickleball', 'skill_level', 'Intermediate'),
    'arts_culture', jsonb_build_object('interests', array['Theater', 'Museums'], 'favorites', 'A small local theater I discovered last spring'),
    'reading', jsonb_build_object('genres', array['Non-fiction', 'Biography'], 'favorites', 'Anything about people who changed direction mid-life'),
    'wine_cocktails_beer', jsonb_build_object('preference', 'Wine', 'favorites', 'A good Malbec after a long week')
  )
)
where user_id = '7290e93b-680f-437d-90c4-d3e3fd6658e0'; -- Elena Torres

update public.profiles
set activity_interests = jsonb_build_object(
  'categories', array['reading', 'games', 'golf', 'fitness'],
  'details', jsonb_build_object(
    'reading', jsonb_build_object('genres', array['Non-fiction', 'History'], 'favorites', 'Currently rereading a lot of history'),
    'games', jsonb_build_object('types', array['Board games', 'Trivia'], 'favorites', 'Anything strategy-heavy'),
    'golf', jsonb_build_object('style', 'Casual', 'favorite_course', 'A quiet public course, nothing fancy'),
    'fitness', jsonb_build_object('types', array['Walking', 'Weightlifting'], 'frequency', 'A few times a week')
  )
)
where user_id = '18ced905-5ea1-4274-b796-b9ad72b79624'; -- David Chen

update public.profiles
set activity_interests = jsonb_build_object(
  'categories', array['sports', 'fitness', 'golf', 'bbq_grilling'],
  'details', jsonb_build_object(
    'sports', jsonb_build_object('sports', array['Basketball', 'Golf'], 'play_or_watch', 'Play'),
    'fitness', jsonb_build_object('types', array['Running', 'Cycling'], 'frequency', 'A few times a week'),
    'golf', jsonb_build_object('style', 'Casual', 'favorite_course', 'Whatever course has an opening Saturday morning'),
    'bbq_grilling', jsonb_build_object('role', 'Backyard cook', 'style', 'American')
  )
)
where user_id = '506056aa-6e5c-4436-a2ee-effe99d31b79'; -- Marcus Alvarez

update public.profiles
set activity_interests = jsonb_build_object(
  'categories', array['music', 'games', 'live_music', 'coffee_culture'],
  'details', jsonb_build_object(
    'music', jsonb_build_object('genres', array['Electronic', 'Rock'], 'favorite_artists', 'Whatever is playing at the record shop'),
    'games', jsonb_build_object('types', array['Video games', 'Tabletop RPGs'], 'favorites', 'Long-running campaigns'),
    'live_music', jsonb_build_object('genres', 'Indie and electronic acts, mostly small venues', 'venues', 'Small clubs'),
    'coffee_culture', jsonb_build_object('style', 'Espresso', 'favorite_spots', 'Whatever new place just opened nearby')
  )
)
where user_id = 'c26c8cb9-a92d-4be6-b189-5252724a6fe0'; -- Jordan Blake

update public.profiles
set activity_interests = jsonb_build_object(
  'categories', array['food', 'outdoors', 'live_music', 'coffee_culture'],
  'details', jsonb_build_object(
    'food', jsonb_build_object('cuisines', array['Thai', 'Japanese'], 'favorite_spots', 'Anywhere with good noodles'),
    'outdoors', jsonb_build_object('activities', array['Hiking', 'Kayaking'], 'favorite_spot', 'Wherever there is water nearby'),
    'live_music', jsonb_build_object('genres', 'Anything with a good bassline', 'venues', 'Small clubs'),
    'coffee_culture', jsonb_build_object('style', 'Espresso', 'favorite_spots', 'The place with the good oat milk')
  )
)
where user_id = 'e24ab29c-9b8d-49d2-9a81-2983cd703a73'; -- Sam Rivera

update public.profiles
set activity_interests = jsonb_build_object(
  'categories', array['outdoors', 'reading', 'gardening_plants', 'golf', 'fitness'],
  'details', jsonb_build_object(
    'outdoors', jsonb_build_object('activities', array['Gardening', 'Birdwatching'], 'favorite_spot', 'My own backyard, mostly'),
    'reading', jsonb_build_object('genres', array['Biography', 'Poetry'], 'favorites', 'Whatever my late wife left on the shelf'),
    'gardening_plants', jsonb_build_object('setting', 'Outdoor garden', 'what_you_grow', 'Tomatoes, and whatever she used to grow'),
    'golf', jsonb_build_object('style', 'Casual', 'favorite_course', 'A quiet public course, nothing fancy'),
    'fitness', jsonb_build_object('types', array['Walking', 'Cycling'], 'frequency', 'A few times a week')
  )
)
where user_id = '7d72883e-e2ed-40c7-a9ec-fc7069cfcef7'; -- Robert Kim

update public.profiles
set activity_interests = jsonb_build_object(
  'categories', array['fitness', 'arts_culture', 'wellness_mindfulness', 'self_improvement', 'volunteering'],
  'details', jsonb_build_object(
    'fitness', jsonb_build_object('types', array['Yoga', 'HIIT'], 'frequency', 'A few times a week'),
    'arts_culture', jsonb_build_object('interests', array['Theater', 'Poetry'], 'favorites', 'Anything with a strong script'),
    'wellness_mindfulness', jsonb_build_object('practices', array['Meditation', 'Journaling'], 'frequency', 'Most mornings, when I can manage it'),
    'self_improvement', jsonb_build_object('areas', array['Therapy', 'Books']),
    'volunteering', jsonb_build_object('causes', array['Community', 'Education'], 'where', 'A local nonprofit, the one I just started at')
  )
)
where user_id = '6d59537f-23b5-4eea-af4e-d9ad0727bd42'; -- Priya Nair
