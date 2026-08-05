-- Paused accounts (F9) must not appear in anyone else's discovery, AI
-- suggestions or browse alike, since both read from this one view. Uses
-- CREATE OR REPLACE, the column list is unchanged, only the WHERE clause
-- gains a pause check on the candidate row (u, the other user), not the
-- viewer, a paused viewer can still open Discover themselves, nothing in
-- this instruction asks to block that, only to stop a paused person from
-- being surfaced TO others. Re-entry is automatic: once paused_until is in
-- the past, this condition is simply true again on the next query, no
-- separate "unpause" action or cron job needed.
create or replace view public.discovery_profiles as
select
  u.id as user_id,
  u.gender_identity,
  u.matching_preference,
  p.display_name,
  p.birthdate,
  extract(year from age(current_date::timestamptz, p.birthdate::timestamptz))::integer as age,
  p.life_transition,
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
  p.current_situation
from users u
join profiles p on p.user_id = u.id
join users viewer on viewer.id = auth.uid()
where u.id <> auth.uid()
  and u.gender_identity = viewer.matching_preference
  and u.matching_preference = viewer.gender_identity
  and (u.paused_until is null or u.paused_until <= now());
