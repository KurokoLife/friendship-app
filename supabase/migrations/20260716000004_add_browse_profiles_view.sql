-- Part 5: separates Browse (F12, a directory of everyone gender/pause-
-- compatible, filtered by the user themselves) from Discovery (F11, a
-- curated, scored AI suggestion). Both used to read discovery_profiles,
-- which only ever applied the gender/pause filters at the view level
-- anyway (the actual weighted scoring, Big Five proximity, and
-- dealbreaker exclusion all live in generate-match-suggestions, not in
-- any view), so this is mostly an architectural separation, not a change
-- in who Browse can see: independent views mean a future change made for
-- Discovery's scoring needs (like this session's dealbreakers/
-- life_transitions_other/values_other/current_situation columns added to
-- discovery_profiles) doesn't silently leak into or get coupled with
-- Browse, and vice versa.
--
-- Exactly two filters, same as discovery_profiles: mutual
-- gender_identity/matching_preference compatibility, and pause exclusion.
-- No scoring, no Big Five, no life-transition matching, browse.tsx's own
-- client-side filters (life transition, age, activities, and so on) are
-- applied on top of this at query time, this view itself shows every
-- compatible, non-paused user.
create view public.browse_profiles as
select
  u.id as user_id,
  u.gender_identity,
  u.matching_preference,
  p.display_name,
  p.birthdate,
  extract(year from age(current_date::timestamptz, p.birthdate::timestamptz))::integer as age,
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
  p.current_situation
from users u
join profiles p on p.user_id = u.id
join users viewer on viewer.id = auth.uid()
where u.id <> auth.uid()
  and u.gender_identity = viewer.matching_preference
  and u.matching_preference = viewer.gender_identity
  and (u.paused_until is null or u.paused_until <= now());

grant select on public.browse_profiles to authenticated;
