-- Public Profile Review: a self-scoped mirror of discovery_profiles' own
-- column list and age_band computation, so the preview screen can reuse
-- candidate/[id].tsx's exact display logic fed the viewer's own data
-- without duplicating the age_band bucketing logic client-side. None of
-- discovery_profiles' hard filters (gender/matching-preference, pause,
-- blocks, radius, mutual age range) apply to previewing your own
-- profile, so this is a plain self-row read, not a copy of that view's
-- WHERE clause.
create view public.my_public_preview as
select
  u.id as user_id,
  p.display_name,
  age_band(p.birthdate) as age_band,
  p.location_city,
  p.location_state,
  p.life_transitions,
  p.life_transitions_other,
  p.values,
  p.values_other,
  p.activity_interests,
  p.hangout_people_preference,
  p.hangout_type_preference,
  p.communication_freq,
  p.meeting_freq,
  p.response_time,
  p.friendship_type,
  p.communication_style_openness,
  p.availability,
  p.communication_modes,
  p.languages,
  p.languages_other,
  p.ethnicity,
  p.ethnicity_other,
  p.personal_statement,
  p.bar_preference,
  p.dealbreakers,
  p.personality_16p,
  p.photo_url
from users u
join profiles p on p.user_id = u.id
where u.id = auth.uid();

grant select on public.my_public_preview to authenticated;
