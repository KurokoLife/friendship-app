-- F3 revision: messaging_preference gains gender-specific safety options
-- (Women/Men/Non-binary people) so every identity has a corresponding
-- "who can message me first" safety option, not just women. "Only women"
-- is superseded by selecting "Women" from this fuller list.
--
-- matching_preference drives discovery filtering (who shows up for whom).
-- gender_identity is display-only on the profile and never filters
-- discovery. A non-binary person who selects "Women" in matching_preference
-- will appear in discovery for users who selected "All genders" or
-- "Non-binary people" there. This migration doesn't change
-- matching_preference's values, only messaging_preference's.

-- Backfill existing rows before tightening the constraint, or the ADD
-- CONSTRAINT below fails on any row still holding the old value.
update public.users
set messaging_preference = 'women'
where messaging_preference = 'only_women';

alter table public.users
  drop constraint if exists users_messaging_preference_check;

alter table public.users
  add constraint users_messaging_preference_check
  check (
    messaging_preference in (
      'women', 'men', 'non_binary', 'anyone', 'only_people_i_message_first'
    )
  );
