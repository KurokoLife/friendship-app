-- Corrects a real privacy problem introduced by the immediately prior
-- migration (20260716000002), caught before anything else was built
-- against it: discovery_profiles is granted `select to authenticated`
-- with only a gender/pause WHERE clause as its access control, exactly
-- like every other view in this app, anyone with a valid session can
-- query it directly over the REST API regardless of what the client UI
-- renders. Adding big_five_scores there would have let any compatible
-- match pull a candidate's raw Big Five trait scores and underlying
-- question responses directly, a real violation of this app's own
-- explicit, repeated design principle (big-five-assessment.tsx's own
-- copy: "We'll never show you a score or a label. This stays behind the
-- scenes"), not just a client-side rendering choice.
--
-- Fixed by removing big_five_scores from the view entirely (a DROP and
-- CREATE, not a plain replace, since removing a trailing column isn't a
-- same-columns-in-order change Postgres allows via CREATE OR REPLACE) and
-- adding a narrow, security definer RPC instead. The function reads both
-- profiles' raw scores internally (bypassing RLS, same pattern as this
-- app's dev_* functions), but returns ONLY the 0-20 point proximity bonus
-- generate-match-suggestions actually needs, never the raw trait numbers
-- themselves. Confirms the caller is looking at a real, mutually
-- compatible candidate (the same discovery_profiles check) before
-- computing anything, so it can't be used to probe an arbitrary user's
-- scores either.
drop view public.discovery_profiles;

create view public.discovery_profiles as
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

-- Distance-to-bonus mapping matches generate-match-suggestions' own
-- scoring spec exactly (full bonus at distance 0-1, half at 2-3, none at
-- 4+), applied to each trait's stored score doubled to approximate the
-- 2-10 "composite" scale the spec assumes (the actual stored value is an
-- average of two 1-5 items, so its real range is 1-5, not 2-10, doubling
-- simulates comparing the sum of the two items instead of their
-- average). Only Agreeableness (7 pts), Openness (7 pts), and
-- Extraversion (6 pts) are used, Conscientiousness and Neuroticism are
-- deliberately excluded from matching per the given spec.
create or replace function public.big_five_proximity_score(p_candidate_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_viewer_scores jsonb;
  v_candidate_scores jsonb;
  v_score numeric := 0;
  v_dist numeric;
begin
  if auth.uid() is null then
    return 0;
  end if;

  -- Only compute for a real, currently-compatible candidate, the same
  -- mutual gender/pause check discovery_profiles itself applies, so this
  -- function can't be used to probe an arbitrary user's scores.
  if not exists (select 1 from public.discovery_profiles where user_id = p_candidate_id) then
    return 0;
  end if;

  select big_five_scores -> 'scores' into v_viewer_scores from public.profiles where user_id = auth.uid();
  select big_five_scores -> 'scores' into v_candidate_scores from public.profiles where user_id = p_candidate_id;

  if v_viewer_scores is null or v_candidate_scores is null then
    return 0;
  end if;

  v_dist := abs(
    coalesce((v_viewer_scores ->> 'agreeableness')::numeric, 0) * 2
    - coalesce((v_candidate_scores ->> 'agreeableness')::numeric, 0) * 2
  );
  v_score := v_score + case when v_dist <= 1 then 7 when v_dist <= 3 then 3.5 else 0 end;

  v_dist := abs(
    coalesce((v_viewer_scores ->> 'openness')::numeric, 0) * 2
    - coalesce((v_candidate_scores ->> 'openness')::numeric, 0) * 2
  );
  v_score := v_score + case when v_dist <= 1 then 7 when v_dist <= 3 then 3.5 else 0 end;

  v_dist := abs(
    coalesce((v_viewer_scores ->> 'extraversion')::numeric, 0) * 2
    - coalesce((v_candidate_scores ->> 'extraversion')::numeric, 0) * 2
  );
  v_score := v_score + case when v_dist <= 1 then 6 when v_dist <= 3 then 3 else 0 end;

  return v_score;
end;
$$;

grant execute on function public.big_five_proximity_score(uuid) to authenticated;
