-- Dev-only: sets a known password on all eight seeded test accounts from
-- seed-test-profiles.sql, so the __DEV__-only Dev tab
-- (src/app/(tabs)/dev.tsx) can sign in as any of them directly via
-- supabase.auth.signInWithPassword(), letting a developer test
-- bidirectional messaging by switching between two accounts without a
-- real phone OTP round trip.
--
-- NOT run by Claude Code, same reasoning as seed-test-profiles.sql: this
-- writes directly into auth.users (encrypted_password), so it's left for
-- you to paste into Supabase Studio's SQL Editor and run under your own
-- authority rather than something run automatically.
--
-- Safe to run only after seed-test-profiles.sql has already been run once
-- (these phone numbers must already exist). Safe to re-run any time, it's
-- a plain update, not an insert.
--
-- The password below is only ever referenced from src/lib/dev-tools.ts,
-- reachable only from a tab that's excluded from the tab bar in
-- production (`href: null` in (tabs)/_layout.tsx) and that also
-- self-guards with `if (!__DEV__) return null`, so it never ships live.
-- These are the fake, reserved-for-fiction 555 phone numbers; they can't
-- receive real SMS and have no other credential, so this password is the
-- only way to sign in as them at all.
update auth.users
set encrypted_password = crypt('friendship-app-dev-skip', gen_salt('bf'))
where phone in (
  '+15555500101', '+15555500102', '+15555500103', '+15555500104',
  '+15555500105', '+15555500106', '+15555500107', '+15555500108'
);
