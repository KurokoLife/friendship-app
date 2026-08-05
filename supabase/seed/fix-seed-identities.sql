-- Fix for "Invalid login credentials" on all 8 Dev tab seed accounts.
--
-- Root cause, confirmed directly, not guessed:
-- 1. encrypted_password IS NOT NULL for all 8 accounts (seed-dev-passwords.sql
--    did run correctly).
-- 2. `encrypted_password = crypt('friendship-app-dev-skip', encrypted_password)`
--    returns true, the stored bcrypt hash genuinely matches the password.
-- 3. auth.identities has ZERO rows for any of these 8 users.
--
-- seed-test-profiles.sql only ever inserted into auth.users, never
-- auth.identities. A real phone signup (signInWithOtp, F2's actual flow)
-- auto-creates a matching identities row; these manually-seeded accounts
-- never got one. GoTrue needs that identity record to resolve a phone
-- login correctly, so even a cryptographically correct password hash
-- results in "invalid_credentials", the failure isn't in the password at
-- all.
--
-- NOT run by Claude Code, same reasoning as every other script touching
-- auth internals this session: auth.identities is Supabase Auth's own
-- schema, not app data, left for you to run yourself in Studio.
--
-- identity_data mirrors what GoTrue itself writes on a real phone signup:
-- provider_id is the phone number, identity_data includes at least `sub`
-- (the user id, per the OIDC-style convention GoTrue follows) and
-- `phone`. Safe to re-run, on conflict does nothing rather than erroring
-- on a second run.
insert into auth.identities (
  id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
)
select
  gen_random_uuid(),
  u.id,
  u.phone,
  'phone',
  jsonb_build_object('sub', u.id::text, 'phone', u.phone),
  now(),
  now(),
  now()
from auth.users u
where u.phone in (
  '+15555500101', '+15555500102', '+15555500103', '+15555500104',
  '+15555500105', '+15555500106', '+15555500107', '+15555500108'
)
on conflict (provider_id, provider) do nothing;
