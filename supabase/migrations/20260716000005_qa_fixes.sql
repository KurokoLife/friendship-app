-- QA fixes, 2026-07-16.

-- Fix 5: hangout_type_preference selection cap removed entirely, any
-- number of the (now 5) options can be selected.
alter table public.profiles
  drop constraint if exists profiles_hangout_type_preference_check;

-- Fix 6: meeting_freq gains "A few times a week" as its second option
-- (most to least frequent: Weekly / A few times a week / Every 2 weeks /
-- Monthly / Every few months). Still display/rhythm-scoring only, no
-- change to how it's used.
alter table public.profiles
  drop constraint if exists profiles_meeting_freq_check;

alter table public.profiles
  add constraint profiles_meeting_freq_check check (
    meeting_freq in ('Weekly', 'A few times a week', 'Every 2 weeks', 'Monthly', 'Every few months')
  );
