-- F11: seed data so the AI matching home screen has real profiles to
-- show against.
--
-- NOT run by Claude Code. Paste this into Supabase Studio's SQL Editor
-- (your project -> SQL Editor -> New query) and run it yourself. It writes
-- directly into auth.users (fake phone numbers in the 555 reserved-for-
-- fiction range, no real password, these accounts can never actually sign
-- in), which is why this is left for you to run under your own authority
-- rather than something Claude Code executes automatically.
--
-- activity_interests is built with jsonb_build_object(...) rather than a
-- single long JSON string literal on purpose: a raw '{"...":"..."}'::jsonb
-- literal is fragile against copy/paste, if a chat UI or terminal
-- soft-wraps a long line and the paste turns that visual wrap into a real
-- newline, it lands inside the JSON string and Postgres rejects it
-- (22P02, "Character with value 0x0d must be escaped"). jsonb_build_object
-- is built from short, ordinary SQL tokens, so accidental whitespace
-- between them is harmless.
--
-- Eight synthetic profiles, all five gender_identity categories
-- represented at least once, a spread of ages (34-59) and life
-- transitions, enough variety in values/activities/rhythm for F11's
-- Claude-generated match reasoning to have something real to point at.
--
-- All eight are verified = false and social_linked = false, since neither
-- ever actually happened for them, marking fake accounts as verified would
-- be exactly the kind of fabrication AGENTS.md's AI philosophy rules out,
-- even for test data. photo_url is left null for all eight rather than
-- pointing at a fetched placeholder image; F11's "no photo" card state
-- covers this already.
do $$
declare
  u1 uuid := gen_random_uuid();
  u2 uuid := gen_random_uuid();
  u3 uuid := gen_random_uuid();
  u4 uuid := gen_random_uuid();
  u5 uuid := gen_random_uuid();
  u6 uuid := gen_random_uuid();
  u7 uuid := gen_random_uuid();
  u8 uuid := gen_random_uuid();
begin

  insert into auth.users (
    instance_id, id, aud, role, phone, phone_confirmed_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values
    ('00000000-0000-0000-0000-000000000000', u1, 'authenticated', 'authenticated', '+15555500101', now(), '', '', '', '', '{"provider":"phone","providers":["phone"]}', '{}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', u2, 'authenticated', 'authenticated', '+15555500102', now(), '', '', '', '', '{"provider":"phone","providers":["phone"]}', '{}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', u3, 'authenticated', 'authenticated', '+15555500103', now(), '', '', '', '', '{"provider":"phone","providers":["phone"]}', '{}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', u4, 'authenticated', 'authenticated', '+15555500104', now(), '', '', '', '', '{"provider":"phone","providers":["phone"]}', '{}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', u5, 'authenticated', 'authenticated', '+15555500105', now(), '', '', '', '', '{"provider":"phone","providers":["phone"]}', '{}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', u6, 'authenticated', 'authenticated', '+15555500106', now(), '', '', '', '', '{"provider":"phone","providers":["phone"]}', '{}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', u7, 'authenticated', 'authenticated', '+15555500107', now(), '', '', '', '', '{"provider":"phone","providers":["phone"]}', '{}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', u8, 'authenticated', 'authenticated', '+15555500108', now(), '', '', '', '', '{"provider":"phone","providers":["phone"]}', '{}', now(), now());

  insert into public.users (id, phone, gender_identity, matching_preference, messaging_preference, verified, social_linked) values
    (u1, '+15555500101', 'woman', 'woman', 'anyone', false, false),
    (u2, '+15555500102', 'man', 'man', 'anyone', false, false),
    (u3, '+15555500103', 'woman', 'man', 'anyone', false, false),
    (u4, '+15555500104', 'man', 'woman', 'anyone', false, false),
    (u5, '+15555500105', 'non_binary', 'non_binary', 'anyone', false, false),
    (u6, '+15555500106', 'man', 'man', 'anyone', false, false),
    (u7, '+15555500107', 'transgender', 'queer', 'anyone', false, false),
    (u8, '+15555500108', 'queer', 'transgender', 'anyone', false, false);

  insert into public.profiles (
    user_id, display_name, birthdate, life_transition, communication_freq, meeting_freq, response_time,
    activity_interests, hangout_people_preference, hangout_type_preference, values,
    personal_statement, dealbreakers, bar_preference, completion_pct
  ) values
    (
      u1, 'Maria Santos', '1979-03-14', 'Divorce or separation', 'A few times a week', 'Weekly', 'Same day',
      jsonb_build_object(
        'categories', array['food', 'outdoors'],
        'details', jsonb_build_object(
          'food', jsonb_build_object(
            'cuisines', array['Italian', 'Mexican'],
            'favorite_spots', 'A little taqueria near my old apartment'
          ),
          'outdoors', jsonb_build_object(
            'activities', array['Hiking', 'Beach days'],
            'favorite_spot', 'The trail by the reservoir'
          )
        )
      ),
      '1-on-1', array['Spontaneous drop-bys','Planned ahead'], array['Family','Humor','Community','Loyalty','Kindness'],
      'A year out of a long marriage and rebuilding my circle from scratch. I laugh easily and I show up for people, I am just looking for that in return.',
      'Not looking for anything romantic, just real friendship.', 'I drink', 100
    ),
    (
      u2, 'David Chen', '1972-01-22', 'Career change', 'About once a week', 'Every 2 weeks', '1-2 days',
      jsonb_build_object(
        'categories', array['reading', 'games'],
        'details', jsonb_build_object(
          'reading', jsonb_build_object(
            'genres', array['Non-fiction', 'History'],
            'favorites', 'Currently rereading a lot of history'
          ),
          'games', jsonb_build_object(
            'types', array['Board games', 'Trivia'],
            'favorites', 'Anything strategy-heavy'
          )
        )
      ),
      'Small group (3-5)', array['Planned ahead','Co-working style'], array['Growth','Wisdom','Balance','Curiosity','Purpose'],
      'Left a twenty-year finance career to teach high school math. Best decision I have made in a decade. Looking for people who like a slow dinner and a real conversation.',
      null, 'No preference', 100
    ),
    (
      u3, 'Aisha Bello', '1985-06-02', 'Relocation', 'Daily', 'Weekly', 'Within hours',
      jsonb_build_object(
        'categories', array['travel', 'arts_culture'],
        'details', jsonb_build_object(
          'travel', jsonb_build_object(
            'types', array['Adventure', 'City breaks'],
            'dream_destination', 'Patagonia, eventually'
          ),
          'arts_culture', jsonb_build_object(
            'interests', array['Museums', 'Live music'],
            'favorites', 'Any small gallery opening'
          )
        )
      ),
      '1-on-1', array['Spontaneous drop-bys','Outdoor activities'], array['Adventure','Independence','Authenticity','Curiosity','Openness'],
      'Moved cities for work eight months ago and I am still building a life here. I text back fast and I love a spontaneous plan.',
      null, 'I drink', 100
    ),
    (
      u4, 'Robert Kim', '1967-09-30', 'Bereavement', 'A few times a month', 'Monthly', 'A few days',
      jsonb_build_object(
        'categories', array['outdoors', 'reading'],
        'details', jsonb_build_object(
          'outdoors', jsonb_build_object(
            'activities', array['Gardening', 'Birdwatching'],
            'favorite_spot', 'My own backyard, mostly'
          ),
          'reading', jsonb_build_object(
            'genres', array['Biography', 'Poetry'],
            'favorites', 'Whatever my late wife left on the shelf'
          )
        )
      ),
      '1-on-1', array['Planned ahead','Homebody'], array['Gratitude','Compassion','Family','Patience','Simplicity'],
      'Lost my wife last year. Learning to build a quieter kind of life, and I would like some company in it. No rush, no pressure, just honest company.',
      'Please be patient, I reply slower than most.', 'No preference', 100
    ),
    (
      u5, 'Priya Nair', '1988-04-11', 'Career change', 'A few times a week', 'Every 2 weeks', 'Same day',
      jsonb_build_object(
        'categories', array['fitness', 'arts_culture'],
        'details', jsonb_build_object(
          'fitness', jsonb_build_object(
            'types', array['Yoga', 'HIIT'],
            'frequency', 'A few times a week'
          ),
          'arts_culture', jsonb_build_object(
            'interests', array['Theater', 'Poetry'],
            'favorites', 'Anything with a strong script'
          )
        )
      ),
      'Small group (3-5)', array['Planned ahead','Co-working style'], array['Purpose','Growth','Community','Courage','Honesty'],
      'Left corporate law for nonprofit work this year and it changed how I think about almost everything, including friendship. Looking for people who like to actually talk about things.',
      null, 'I don''t drink', 100
    ),
    (
      u6, 'Marcus Alvarez', '1981-02-18', 'Empty nesting', 'Daily', 'Weekly', 'Within hours',
      jsonb_build_object(
        'categories', array['sports', 'fitness'],
        'details', jsonb_build_object(
          'sports', jsonb_build_object(
            'sports', array['Basketball', 'Golf'],
            'play_or_watch', 'Play'
          ),
          'fitness', jsonb_build_object(
            'types', array['Running', 'Cycling'],
            'frequency', 'A few times a week'
          )
        )
      ),
      'Big group (6+)', array['Spontaneous drop-bys','Outdoor activities'], array['Playfulness','Adventure','Humor','Connection','Health'],
      'Both kids left for college this fall and the house is loud in a different way now, mostly quiet. I am the guy who will text you at 7am about a pickup game.',
      null, 'I drink', 100
    ),
    (
      u7, 'Jordan Blake', '1992-05-27', 'Relocation', 'A few times a week', 'Every 2 weeks', 'Same day',
      jsonb_build_object(
        'categories', array['music', 'games'],
        'details', jsonb_build_object(
          'music', jsonb_build_object(
            'genres', array['Electronic', 'Indie'],
            'favorite_artists', 'Whatever is playing at the record shop'
          ),
          'games', jsonb_build_object(
            'types', array['Video games', 'Tabletop RPGs'],
            'favorites', 'Long-running campaigns'
          )
        )
      ),
      'Small group (3-5)', array['Co-working style','Homebody'], array['Authenticity','Creativity','Community','Curiosity','Openness'],
      'New in town and rebuilding my community from the ground up. I am pretty introverted at first but I warm up fast once there is a real connection.',
      null, 'No preference', 100
    ),
    (
      u8, 'Sam Rivera', '1983-11-09', 'Career change', 'About once a week', 'Every 2 weeks', '1-2 days',
      jsonb_build_object(
        'categories', array['food', 'outdoors'],
        'details', jsonb_build_object(
          'food', jsonb_build_object(
            'cuisines', array['Thai', 'Ethiopian'],
            'favorite_spots', 'Anywhere with good noodles'
          ),
          'outdoors', jsonb_build_object(
            'activities', array['Hiking', 'Kayaking'],
            'favorite_spot', 'Wherever there is water nearby'
          )
        )
      ),
      '1-on-1', array['Planned ahead','Outdoor activities'], array['Balance','Curiosity','Community','Resilience','Gratitude'],
      'Switched careers into something that actually fits me this year. Still figuring out the friendship side of adult life and would rather do that honestly than pretend I have it all sorted.',
      null, 'I drink', 100
    );

end $$;
