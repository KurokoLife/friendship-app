-- Fix 3: rescales big_five_proximity_score from its old 20-point split
-- (Agreeableness 7, Openness 7, Extraversion 6) to the new 100-point
-- model's 15-point allocation, split evenly (5/5/5, the cleanest even
-- split of 15 across three equally-weighted traits, the given spec names
-- all three without ranking one above another the way the old 7/7/6 did).
-- Same distance-to-bonus tiers as before (full bonus at distance 0-1,
-- half at 2-3, none at 4+), only the per-trait maximum changed.
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
  v_score := v_score + case when v_dist <= 1 then 5 when v_dist <= 3 then 2.5 else 0 end;

  v_dist := abs(
    coalesce((v_viewer_scores ->> 'openness')::numeric, 0) * 2
    - coalesce((v_candidate_scores ->> 'openness')::numeric, 0) * 2
  );
  v_score := v_score + case when v_dist <= 1 then 5 when v_dist <= 3 then 2.5 else 0 end;

  v_dist := abs(
    coalesce((v_viewer_scores ->> 'extraversion')::numeric, 0) * 2
    - coalesce((v_candidate_scores ->> 'extraversion')::numeric, 0) * 2
  );
  v_score := v_score + case when v_dist <= 1 then 5 when v_dist <= 3 then 2.5 else 0 end;

  return v_score;
end;
$$;
