-- Part 2 of this session's changes needs each candidate's big_five_scores
-- (for the new proximity-based Agreeableness/Openness/Extraversion
-- scoring in generate-match-suggestions) and dealbreakers is already
-- readable on the viewer's own row directly from profiles, this only adds
-- what's missing for reading a CANDIDATE's data through discovery_profiles.
-- Appended at the end again, same reasoning as 20260716000001.
create or replace view public.discovery_profiles as
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
  p.big_five_scores
from users u
join profiles p on p.user_id = u.id
join users viewer on viewer.id = auth.uid()
where u.id <> auth.uid()
  and u.gender_identity = viewer.matching_preference
  and u.matching_preference = viewer.gender_identity
  and (u.paused_until is null or u.paused_until <= now());

grant select on public.discovery_profiles to authenticated;
