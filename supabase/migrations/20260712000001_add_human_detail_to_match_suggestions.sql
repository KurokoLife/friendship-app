-- F11 home card update: adds a second Claude-generated field per
-- suggestion, one specific, real, third-person detail about the candidate
-- (grounded in their personal_statement or activity_interests, never
-- invented), shown alongside the existing reasoning. Cached next to
-- reasoning in match_suggestions so a same-day refresh returns the same
-- text for both fields, not just reasoning.
alter table public.match_suggestions
  add column if not exists human_detail text;
