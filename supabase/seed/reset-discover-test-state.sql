-- Fix for "Discover shows no suggestions": not a stale-cache bug. The real
-- test account (phone 18189719076, gender_identity=woman,
-- matching_preference=woman) only ever has ONE mutually compatible seed
-- candidate at all (Maria Santos, the only other 'woman'/'woman' seed
-- profile), plus Priya Nair was cached before this account's identity
-- settled. Both had since been marked status='passed', so
-- generate-match-suggestions' fresh-generation path correctly filtered
-- them out of "available" (they're not stale, they're exhausted), leaving
-- a genuinely empty pool, not a bug in the caching logic itself.
--
-- This resets that one test account's connections/match_suggestions so
-- Discover can regenerate against the full compatible pool again. Plain
-- public-schema data, not auth.users, applied directly.
--
-- Real, inherent limitation worth knowing, not fixed by this reset: for
-- this specific account's gender/preference combo, Maria Santos is still
-- the only seed profile that will ever be mutually compatible, Discover
-- will show exactly one card and then go empty again once she's acted on.
-- The new Dev tab's other seed accounts (e.g. Robert Kim <-> Aisha Bello)
-- have richer compatible pools for broader testing.
delete from public.match_suggestions
where user_id = (select id from public.users where phone = '18189719076');

delete from public.connections
where user_a_id = (select id from public.users where phone = '18189719076');
