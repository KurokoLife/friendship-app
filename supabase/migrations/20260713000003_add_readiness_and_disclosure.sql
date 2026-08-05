-- F9 (readiness commitment) and F10 (behavioral tracking disclosure), the
-- two onboarding screens between the module library and the main app.
--
-- readiness_status: null until F9 is answered, then 'ready' or 'paused'.
-- paused_until: only set when readiness_status = 'paused', the pause
-- expiry (now() + 30/60/90 days at the moment of choosing). Account and
-- data are otherwise untouched, per the given spec ("account preserved, no
-- penalty, can return anytime"), no other part of the app currently reads
-- this column, there is deliberately no login gate or discovery exclusion
-- built here, that would be new scope beyond "insert two screens into the
-- onboarding flow" and nothing in AGENTS.md specifies what a paused
-- account should be blocked from doing.
--
-- behavioral_tracking_disclosed_at: null until the required "I understand"
-- button on F10 is tapped, then the real timestamp of acknowledgment. Kept
-- as a timestamp, not a boolean, matching the general pattern in this
-- schema of preferring a real timestamp wherever "did this happen" also
-- naturally has a "when" worth keeping (etiquette_modules is the one
-- exception, already shipped as booleans-in-jsonb before this decision was
-- made consistently).
alter table public.users
  add column if not exists readiness_status text check (readiness_status in ('ready', 'paused')),
  add column if not exists paused_until timestamptz,
  add column if not exists behavioral_tracking_disclosed_at timestamptz;
