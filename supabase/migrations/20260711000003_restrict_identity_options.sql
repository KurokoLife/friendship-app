-- F3 revision: all three questions (gender_identity, matching_preference,
-- messaging_preference) are now closed, required option sets with no vague
-- or opt-out choice ("Prefer not to say", "Something else", "All genders"
-- are all gone). All three share one slug vocabulary (woman/man/non_binary/
-- transgender/queer) so gender_identity and matching_preference can be
-- compared directly for discovery filtering (F11+): a person's
-- gender_identity must be in a viewer's matching_preference for that person
-- to appear in the viewer's discovery, and vice versa.
--
-- Safe to run whether or not 20260711000002 was applied first: constraints
-- are dropped with IF EXISTS, and the messaging_preference backfill below
-- covers both the original ('only_women') and the 20260711000002
-- ('only_women' already renamed to 'women') starting states.

-- gender_identity had no constraint before (it was open free text). Any
-- existing value outside the new closed set (including anything typed into
-- the old "Something else" field) can't be mapped to one of the five
-- categories automatically, so it's cleared rather than guessed at.
update public.users
set gender_identity = null
where gender_identity is not null
  and gender_identity not in ('woman', 'man', 'non_binary', 'transgender', 'queer');

alter table public.users
  drop constraint if exists users_gender_identity_check;

alter table public.users
  add constraint users_gender_identity_check
  check (gender_identity in ('woman', 'man', 'non_binary', 'transgender', 'queer'));

-- matching_preference previously allowed 'women'/'men'/'non_binary'/'all_genders'.
-- The label-cased slugs and the 'all_genders' catch-all are both gone; there's
-- no safe equivalent to remap 'all_genders' to, so it's cleared too.
update public.users
set matching_preference = null
where matching_preference is not null
  and matching_preference not in ('woman', 'man', 'non_binary', 'transgender', 'queer');

alter table public.users
  drop constraint if exists users_matching_preference_check;

alter table public.users
  add constraint users_matching_preference_check
  check (matching_preference in ('woman', 'man', 'non_binary', 'transgender', 'queer'));

-- messaging_preference backfill: covers both possible prior states.
update public.users
set messaging_preference = 'woman'
where messaging_preference in ('only_women', 'women');

update public.users
set messaging_preference = 'man'
where messaging_preference = 'men';

alter table public.users
  drop constraint if exists users_messaging_preference_check;

alter table public.users
  add constraint users_messaging_preference_check
  check (
    messaging_preference in (
      'woman', 'man', 'non_binary', 'transgender', 'queer',
      'anyone', 'only_people_i_message_first'
    )
  );
