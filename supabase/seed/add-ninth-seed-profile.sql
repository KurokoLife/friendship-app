-- Fix for "not enough compatible matches for testing": rather than
-- repurpose an existing seed character's gender_identity (which would
-- either strand David Chen/Marcus Alvarez's only mutual pairing, or
-- remove the only non_binary/non_binary representation from the seed
-- set), this adds a real 9th account instead. No existing character or
-- pairing is affected.
--
-- Same reasoning as seed-test-profiles.sql: writes directly into
-- auth.users (fake phone number in the reserved-for-fiction 555 range, no
-- real path to sign in via phone OTP), so this is left for you to run
-- yourself in Supabase Studio's SQL Editor rather than something run
-- automatically.
--
-- Elena Torres: woman/woman, same combination as Maria Santos and (after
-- this session's update) Aisha Bello, giving Maria a genuine second
-- compatible match without touching anyone else.
do $$
declare
  u9 uuid := gen_random_uuid();
begin

  insert into auth.users (
    instance_id, id, aud, role, phone, phone_confirmed_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000', u9, 'authenticated', 'authenticated',
    '+15555500109', now(), '', '', '', '',
    '{"provider":"phone","providers":["phone"]}', '{}', now(), now()
  );

  insert into auth.identities (
    id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), u9, '+15555500109', 'phone',
    jsonb_build_object('sub', u9::text, 'phone', '+15555500109'),
    now(), now(), now()
  );

  insert into public.users (id, phone, gender_identity, matching_preference, messaging_preference, verified, social_linked)
  values (u9, '+15555500109', 'woman', 'woman', 'anyone', false, false);

  insert into public.profiles (
    user_id, display_name, birthdate, life_transition, communication_freq, meeting_freq, response_time,
    activity_interests, hangout_people_preference, hangout_type_preference, values,
    personal_statement, dealbreakers, bar_preference, completion_pct
  ) values (
    u9, 'Elena Torres', '1976-08-19', 'Career change', 'A few times a week', 'Every 2 weeks', '1-2 days',
    jsonb_build_object(
      'categories', array['reading', 'arts_culture'],
      'details', jsonb_build_object(
        'reading', jsonb_build_object(
          'genres', array['Non-fiction', 'Biography'],
          'favorites', 'Anything about people who changed direction mid-life'
        ),
        'arts_culture', jsonb_build_object(
          'interests', array['Theater', 'Museums'],
          'favorites', 'A small local theater I discovered last spring'
        )
      )
    ),
    '1-on-1', array['Planned ahead', 'Homebody'], array['Wisdom', 'Balance', 'Kindness', 'Authenticity', 'Growth'],
    'Twenty years in one industry, then I finally admitted it was not working for me anymore. Still adjusting to being a beginner again, and looking for people who understand that kind of reset.',
    null, 'I drink', 100
  );

end $$;
