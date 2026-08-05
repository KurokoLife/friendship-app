-- F11 full profile screen update: the screen now needs personality_16p
-- ("Personality type", shown only if provided, per AGENTS.md: optional,
-- shown on profile, never used for matching) and dealbreakers ("Hard nos",
-- shown only if populated). Neither was exposed by discovery_profiles.
--
-- dealbreakers was deliberately left out of the original view (see
-- 20260711000005's comment: "no phone, no raw Big Five scores, no
-- dealbreakers") as a privacy-conscious default. Revisited here per
-- explicit product instruction to display it on the full profile screen,
-- this is a product decision, not a reversal of the earlier security
-- reasoning, the view's auth.uid()-based mutual-compatibility filter still
-- applies to every column, dealbreakers included.
--
-- New columns are appended at the end of the select list, not inserted
-- alongside the related columns above, because `create or replace view`
-- requires the existing output columns to keep their original names,
-- order, and types; appending is the only way to add columns in place.
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
  p.personality_16p
from public.users u
join public.profiles p on p.user_id = u.id
join public.users viewer on viewer.id = auth.uid()
where u.id <> auth.uid()
  and u.gender_identity = viewer.matching_preference
  and u.matching_preference = viewer.gender_identity;

grant select on public.discovery_profiles to authenticated;
