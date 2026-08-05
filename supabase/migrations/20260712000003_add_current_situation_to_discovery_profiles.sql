-- F11 full profile screen needs current_situation, not yet exposed by
-- discovery_profiles. Appended at the end, same reasoning as the
-- dealbreakers/personality_16p addition in 20260712000000: `create or
-- replace view` requires existing output columns to keep their name,
-- order, and type, so new columns can only be added at the end.
create or replace view public.discovery_profiles as
select
  u.id as user_id,
  u.gender_identity,
  u.matching_preference,
  p.display_name,
  p.birthdate,
  extract(year from age(current_date, p.birthdate))::int as age,
  p.life_transition,
  p.activity_interests,
  p.values,
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
  p.current_situation
from public.users u
join public.profiles p on p.user_id = u.id
join public.users viewer on viewer.id = auth.uid()
where u.id <> auth.uid()
  and u.gender_identity = viewer.matching_preference
  and u.matching_preference = viewer.gender_identity;

grant select on public.discovery_profiles to authenticated;
