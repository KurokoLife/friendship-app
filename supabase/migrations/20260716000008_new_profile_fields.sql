-- Fix 2: six new profile fields.

-- 2a/2b. Location + search radius. lat/lng are nullable (set only once a
-- real geocode succeeds), search_radius_miles has a real default (30) and
-- a hard 5-100 range check, matching the given slider bounds exactly.
alter table public.profiles
  add column if not exists location_city text,
  add column if not exists location_lat double precision,
  add column if not exists location_lng double precision,
  add column if not exists search_radius_miles integer not null default 30;

alter table public.profiles
  add constraint profiles_search_radius_miles_check check (search_radius_miles between 5 and 100);

-- 2c. Ethnicity, multi-select, optional, display only. "Other" is a real
-- selectable option like every other, ethnicity_other captures the
-- accompanying free text only when it's picked, same "other" pattern
-- already used for life_transitions_other/values_other/activity_
-- interests.other. Never used for matching, no scoring weight anywhere.
alter table public.profiles
  add column if not exists ethnicity text[],
  add column if not exists ethnicity_other text;

-- 2d. Languages, multi-select, same "Other" pattern. Soft scoring weight
-- in match scoring (5 points max, shared language).
alter table public.profiles
  add column if not exists languages text[],
  add column if not exists languages_other text;

-- 2e. Friendship type, single select, required for matching.
alter table public.profiles
  add column if not exists friendship_type text;

alter table public.profiles
  add constraint profiles_friendship_type_check check (
    friendship_type in (
      'Deep 1-on-1 connection',
      'Activity partner',
      'Someone to navigate this life stage with',
      'A social circle',
      'Open to whatever forms naturally'
    )
  );

-- 2f. Communication style, two required scenario questions. Stored as
-- short canonical labels (not the full given option text, which included
-- an explanatory clause after an em dash in the source instruction,
-- replaced here with the standing no-em-dash rule in mind, the UI shows
-- the fuller description text with a comma instead, this column only
-- needs the short label for scoring/filtering).
alter table public.profiles
  add column if not exists communication_style_expression text,
  add column if not exists communication_style_openness text;

alter table public.profiles
  add constraint profiles_communication_style_expression_check check (
    communication_style_expression in ('Bring it up directly', 'Drop a hint or change the subject', 'Let it go')
  );

alter table public.profiles
  add constraint profiles_communication_style_openness_check check (
    communication_style_openness in ('Pretty early', 'After a few conversations', 'Only after a long time')
  );
