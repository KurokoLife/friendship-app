-- Exposes the two new free-text "add your own" fields (life_transitions_
-- other, values_other, see 20260716000000) on discovery_profiles so the
-- full profile screen (candidate/[id].tsx) can display them. Neither is
-- used by generate-match-suggestions' scoring, display only, same as
-- activity_interests.other already was.
--
-- Appended at the very end of the column list, not next to their related
-- existing columns, since CREATE OR REPLACE VIEW requires every existing
-- output column to keep its exact name, type, and position, new columns
-- can only be added after all of them (the same rule already documented
-- in 20260713000005, which is why that migration had to drop and
-- recreate the view instead of replacing it, this change doesn't rename
-- or retype anything so a plain replace is enough here).
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
  p.values_other
from users u
join profiles p on p.user_id = u.id
join users viewer on viewer.id = auth.uid()
where u.id <> auth.uid()
  and u.gender_identity = viewer.matching_preference
  and u.matching_preference = viewer.gender_identity
  and (u.paused_until is null or u.paused_until <= now());

grant select on public.discovery_profiles to authenticated;
