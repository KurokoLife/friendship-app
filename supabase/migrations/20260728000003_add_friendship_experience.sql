-- Onboarding update (2026-07-26): "Your experience with new friendship",
-- five private questions shown after the existing 10 reflection questions.
-- Purely additive: one nullable jsonb column, no destructive change, no
-- new RLS policy needed, inherits the same "own row only" select/update
-- policies profiles already has (20260711000001_create_profiles_table.sql).
--
-- Deliberately never added to discovery_profiles, browse_profiles,
-- compatible_candidates_for, or any other public-facing view or function,
-- and never read by generate-match-suggestions. These answers are private
-- reflection data, not a matching input, a matching filter, a ranking
-- signal, or a block signal, per explicit instruction.
alter table public.profiles
  add column if not exists friendship_experience jsonb;
