-- Terms/Privacy acceptance, confirmed genuinely absent before this: no
-- onboarding screen collects it, no column exists to record it (grepped
-- src/app for "terms"/"privacy"/"agreement", zero real matches before
-- this session). A single timestamp, not two, since the app shows one
-- combined checkbox covering both documents rather than separate
-- acceptance events for each.
alter table public.users
  add column if not exists terms_accepted_at timestamptz;
