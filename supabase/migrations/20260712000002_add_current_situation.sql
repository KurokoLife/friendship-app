-- F11 full profile screen: "What they are going through right now", a
-- separate field from life_transition (a fixed 5-option category) and
-- personal_statement (an intro/identity blurb). This is meant to capture
-- present-tense day-to-day reality, optional, shown only if populated.
alter table public.profiles
  add column if not exists current_situation text;
