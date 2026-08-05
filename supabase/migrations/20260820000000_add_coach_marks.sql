-- First-time coach-mark/tooltip system.
--
-- Library investigation, done live before building anything (not assumed
-- either way, per explicit instruction not to repeat the react-native-iap
-- lesson): react-native-copilot was installed and exercised against this
-- project's real web dev server. It DOES render correctly on web (a real,
-- somewhat surprising finding, contradicting an initial static-analysis
-- worry: its own source gates overlay-mode selection on
-- `NativeModules.RNSVGSvgViewManager`, a native-bridge check that's absent
-- on web, which looked like a real risk signal until actually tested).
-- Live test confirmed a full spotlight overlay, step badge, and tooltip
-- box all rendered with zero console errors.
--
-- Despite that, it was NOT adopted, for a structural reason rather than a
-- compatibility one: react-native-copilot is built around one ordered,
-- linear tour bound to a single app-wide CopilotProvider, walked through
-- step by step. This app's actual requirement is the opposite shape: 9
-- independent, scattered, one-off tips, 4 tied to separate tab screens, 2
-- tied to a dynamically-conditioned card that may or may not be mounted on
-- any given thread visit, 1 fired from any of 6 unrelated blocked-state
-- surfaces across the app, all needing to fire (or not) independently of
-- each other and of any fixed order. Forcing that shape into one global,
-- ordered tour would mean either faking step ordinality across screens
-- that don't share a mount lifecycle, or running many parallel
-- CopilotProvider instances, neither of which is what the library is for.
-- A small custom solution, matching this app's own dominant, already-
-- proven idiom for "explain something once" (a plain dismissible bordered
-- card, the exact pattern no_ghost_prompts/meetup_checkins/the blocked-
-- state banners all already use), fits this specific requirement better
-- and carries none of a third-party dependency's own risk.
--
-- Schema follows this app's own established "personal preference, no
-- cross-participant logic" convention (rhythm_mismatch_dismissals is the
-- closest precedent: plain client-writable, own-row RLS, no RPC needed,
-- client passes user_id explicitly since no table in this schema defaults
-- it from auth.uid()).
create table public.coach_marks_seen (
  user_id uuid not null references public.users(id) on delete cascade,
  mark_key text not null check (mark_key in (
    'tab_discover',
    'tab_browse',
    'tab_saved',
    'tab_inbox',
    'no_ghost_prompt',
    'meetup_checkin',
    'tab_remember',
    'tab_profile',
    'credits_premium'
  )),
  seen_at timestamptz not null default now(),
  primary key (user_id, mark_key)
);

alter table public.coach_marks_seen enable row level security;

create policy "Users can read their own seen coach marks"
  on public.coach_marks_seen for select
  using (auth.uid() = user_id);

create policy "Users can mark their own coach marks seen"
  on public.coach_marks_seen for insert
  with check (auth.uid() = user_id);

-- Needed for Settings' "Show tips again": a full reset deletes every row
-- for the caller so the next fetch genuinely comes back empty.
create policy "Users can reset their own coach marks"
  on public.coach_marks_seen for delete
  using (auth.uid() = user_id);
