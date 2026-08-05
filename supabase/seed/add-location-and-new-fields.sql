-- Fix 2: seeds location (real geocoded coordinates via the deployed
-- geocode-city function) plus the other new fields (friendship_type,
-- languages, communication style) for all 10 real accounts, so the new
-- required-field validation and the radius hard filter (Fix 3/5/6) don't
-- silently break every existing seed profile the moment they ship.
--
-- Cities chosen to preserve every already-verified compatible pairing
-- from earlier sessions (Maria/Aisha/Elena/Kana all in Austin, David/
-- Marcus in Denver, Jordan/Sam in Seattle), so radius filtering doesn't
-- accidentally exclude a pairing that's been used throughout this
-- project's own testing history. Robert Kim and Priya Nair (already
-- documented as having zero compatible partners regardless of location)
-- get distinct cities, it doesn't change that fact either way.

update public.profiles set
  location_city = 'Austin, Texas', location_lat = 30.2711286, location_lng = -97.7436995,
  friendship_type = 'Someone to navigate this life stage with',
  languages = array['English'], communication_style_expression = 'Bring it up directly',
  communication_style_openness = 'After a few conversations'
where user_id = '3e800518-287b-4705-bdae-06d53ffd450b'; -- Maria Santos

update public.profiles set
  location_city = 'Austin, Texas', location_lat = 30.2711286, location_lng = -97.7436995,
  friendship_type = 'Activity partner',
  languages = array['English'], communication_style_expression = 'Drop a hint or change the subject',
  communication_style_openness = 'Pretty early'
where user_id = 'c6b092f0-f372-4f1d-af7f-6d73b78a2bcd'; -- Aisha Bello

update public.profiles set
  location_city = 'Austin, Texas', location_lat = 30.2711286, location_lng = -97.7436995,
  friendship_type = 'Deep 1-on-1 connection',
  languages = array['English', 'Spanish'], communication_style_expression = 'Bring it up directly',
  communication_style_openness = 'After a few conversations'
where user_id = '7290e93b-680f-437d-90c4-d3e3fd6658e0'; -- Elena Torres

update public.profiles set
  location_city = 'Denver, Colorado', location_lat = 39.7392364, location_lng = -104.984862,
  friendship_type = 'Activity partner',
  languages = array['English'], communication_style_expression = 'Let it go',
  communication_style_openness = 'Only after a long time'
where user_id = '18ced905-5ea1-4274-b796-b9ad72b79624'; -- David Chen

update public.profiles set
  location_city = 'Denver, Colorado', location_lat = 39.7392364, location_lng = -104.984862,
  friendship_type = 'A social circle',
  languages = array['English'], communication_style_expression = 'Bring it up directly',
  communication_style_openness = 'Pretty early'
where user_id = '506056aa-6e5c-4436-a2ee-effe99d31b79'; -- Marcus Alvarez

update public.profiles set
  location_city = 'Seattle, Washington', location_lat = 47.6038321, location_lng = -122.330062,
  friendship_type = 'Open to whatever forms naturally',
  languages = array['English'], communication_style_expression = 'Drop a hint or change the subject',
  communication_style_openness = 'After a few conversations'
where user_id = 'c26c8cb9-a92d-4be6-b189-5252724a6fe0'; -- Jordan Blake

update public.profiles set
  location_city = 'Seattle, Washington', location_lat = 47.6038321, location_lng = -122.330062,
  friendship_type = 'Open to whatever forms naturally',
  languages = array['English'], communication_style_expression = 'Bring it up directly',
  communication_style_openness = 'Pretty early'
where user_id = 'e24ab29c-9b8d-49d2-9a81-2983cd703a73'; -- Sam Rivera

update public.profiles set
  location_city = 'Chicago, Illinois', location_lat = 41.8755616, location_lng = -87.6244212,
  friendship_type = 'Someone to navigate this life stage with',
  languages = array['English'], communication_style_expression = 'Let it go',
  communication_style_openness = 'Only after a long time'
where user_id = '7d72883e-e2ed-40c7-a9ec-fc7069cfcef7'; -- Robert Kim

update public.profiles set
  location_city = 'Portland, Oregon', location_lat = 45.5202471, location_lng = -122.674194,
  friendship_type = 'Deep 1-on-1 connection',
  languages = array['English'], communication_style_expression = 'Bring it up directly',
  communication_style_openness = 'After a few conversations'
where user_id = '6d59537f-23b5-4eea-af4e-d9ad0727bd42'; -- Priya Nair

update public.profiles set
  location_city = 'Austin, Texas', location_lat = 30.2711286, location_lng = -97.7436995,
  friendship_type = 'Deep 1-on-1 connection',
  languages = array['English'], communication_style_expression = 'Bring it up directly',
  communication_style_openness = 'After a few conversations'
where user_id = '777b01a9-4818-420c-92ac-6c15d1084abe'; -- Kana (real test account)
