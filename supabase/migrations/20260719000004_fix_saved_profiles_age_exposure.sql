-- Fix #1, continued: saved_profiles (20260714000000) was missed in the
-- first pass at removing raw age/birthdate exposure, found by a full
-- grep sweep of src/ for remaining `age` references after the discovery_
-- profiles/browse_profiles/compatible_candidates_for fix, not assumed to
-- be the only place. Same treatment: birthdate and exact age removed
-- entirely, replaced with public.age_band().
-- CREATE OR REPLACE VIEW cannot remove or rename columns (only append new
-- ones), and this drops birthdate/age down to a single age_band column,
-- a real column-shape change, same reason every other view rewrite in
-- this project has needed a real DROP first.
drop view if exists public.saved_profiles;

create view public.saved_profiles as
select
  c.id as connection_id,
  c.user_b_id as user_id,
  c.saved_at,
  p.display_name,
  public.age_band(p.birthdate) as age_band,
  p.life_transitions,
  p.personal_statement
from public.connections c
join public.profiles p on p.user_id = c.user_b_id
where c.user_a_id = auth.uid()
  and c.saved = true;

grant select on public.saved_profiles to authenticated;
