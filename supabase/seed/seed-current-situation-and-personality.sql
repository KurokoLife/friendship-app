-- F11 full profile screen: fills in current_situation and personality_16p
-- for three of the eight seed profiles (seed-test-profiles.sql), both were
-- null for all seed data until now, so neither section had ever actually
-- been exercised. The other five seed profiles are left null on purpose,
-- to keep proving the "only show if populated" conditional actually hides
-- the section when there's nothing to show.
--
-- Plain data updates on public.profiles, no auth.users involved, so unlike
-- seed-test-profiles.sql this is applied directly rather than handed to
-- the user to run.
--
-- current_situation is written as a present-tense, day-to-day detail,
-- distinct from personal_statement's identity/intro framing and from
-- life_transition's fixed category, grounded in the same character
-- established by each profile's existing personal_statement.
update public.profiles
set current_situation = 'Most weeks it is just me and a very needy cat, figuring out what my own version of a Tuesday night looks like now.',
    personality_16p = 'ISFJ'
where user_id = (select id from public.users where phone = '+15555500101'); -- Maria Santos

update public.profiles
set current_situation = 'Still working out how to fill an evening that used to be full without it feeling like something is missing.',
    personality_16p = 'INFP'
where user_id = (select id from public.users where phone = '+15555500104'); -- Robert Kim

update public.profiles
set current_situation = 'Rebuilding a whole new professional circle from scratch while also trying to actually protect some free time this time around.',
    personality_16p = 'ENFJ'
where user_id = (select id from public.users where phone = '+15555500105'); -- Priya Nair
