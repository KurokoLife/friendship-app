# Limen: how we work (for build and test sessions)

Last updated 2026-11-15.

## Working with the founder

- Check every screen and line of copy against docs/context/00_CORE.md, including "How it should feel": judge how it reads, not whether it matches words.
- Plain, non-technical, short, step by step. Check Goal / Context / Action / Output before building, unless it's already clear.
- Don't just agree. Recommend what's best and say why.
- When the founder has to act, give the exact link and the exact clicks.
- At the end: one or two plain sentences on what changed, then exactly what the founder needs to run or deploy.

## Code and publishing

- Repo `KurokoLife/friendship-app`, branch `limen-v2-ethics-alignment`. Publish:
  `git push origin limen-v2-ethics-alignment && git push origin limen-v2-ethics-alignment:master`
- End every commit message with:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_011o18t9xFhCBHutCQzEa8HQ`
- Stack: Expo SDK 54, Expo Router, NativeWind, Supabase (Postgres, RLS, Realtime), TypeScript. Run `npx tsc --noEmit` before every commit.

## Database changes

- Add a new file in `supabase/migrations/` named `YYYYMMDDNNNNNN_short_name.sql`. It must be safe to run twice.
- The migration must bump `limen_db_version()` to its own number. Also update `REQUIRED_DB_VERSION` and `RECENT_DB_UPDATES` in `src/lib/db-version.ts` (the Test tab warns when the live database is behind).
- The founder runs it by opening the raw link (signed in to GitHub, the repo is private) and pasting the text into the Supabase SQL Editor:
  `https://github.com/KurokoLife/friendship-app/raw/limen-v2-ethics-alignment/supabase/migrations/<file>`
- Current version: `20261116000000` (Copy update: joining follow-up once, support notification line). Design: colors and font only in `src/theme/tokens.js`; buttons, rows and links from `src/components/ui.tsx`.
- Patterns: private tables use own-row RLS; anything another person must never see goes through SECURITY DEFINER functions that return only the caller's own data; prompt cards are rows in `connection_interventions`, ranked by `get_active_intervention` so only one shows. Security (since Nov 13): a SECURITY DEFINER function members can call must check `auth.uid()`; an internal one (jobs, helpers that trust ids) must end with `revoke all on function ... from public, anon, authenticated`; clients never write trusted columns directly; run `qa/sql-checks/securitysql.sql` after every migration. A new Test tab tool that takes a chat must call `_test_chat_only`.

## Server functions

- The founder deploys by pasting the file into the Supabase dashboard (Edge Functions → the function → Code → Deploy). There is no CLI access from the workspace.
- Live: `generate-match-suggestions`, `generate-personality-narrative`, `plan-ideas`, `place-search` (Google Places, needs the secret `GOOGLE_PLACES_KEY`; without it the app uses OpenStreetMap), `selfie-review`, `geocode-city`, `delete-account`, `dev-create-session`, `send-notifications` (push and email, run by Supabase Cron every 5 minutes; secrets `RESEND_API_KEY`, `NOTIFY_FROM`, `APP_URL`).
- Retired or unused: `generate-reply-draft` and `reflection-coach` (both return 410), `generate-activity-suggestions`, `generate-connection-analysis`, `validate-ai-credit-purchase`, `validate-premium-purchase`. `organize-remember-entry` and `summarize-remember-timeline` are deleted.

## Testing

- Local test copy in `qa/` (real Postgres with every migration, PostgREST, a stand-in for Auth and server functions, the web app, Playwright). It never touches the real project. First time in a new workspace:
  `bash qa/setup.sh && bash qa/start-db.sh && bash qa/apply.sh && bash qa/build.sh && bash qa/restart.sh` (expect "web 200 / api 200").
- After SQL changes: `bash qa/apply.sh` then `bash qa/restart.sh`. After app changes: `bash qa/build.sh`.
- Run suites in the background: `bash qa/run.sh qa-remind qa-share` (or `all`), read `qa/.local/out-<suite>.txt`. Database-only checks: `psql -h /tmp -p 5433 -U postgres -d limen -f qa/sql-checks/<file>.sql`.
- Suites: qa-oct9, qa-oct9b, qa-oct9c, qa-meetups (morning-of steps fail before 5am LA time, by design), qa-plan, qa-meet, qa-noghost, qa-remind, qa-share, qa-mochi, qa-testtab, qa-notes (Remember), qa-answer ("Did you meet?" answers on old cards, laptop window), qa-refresh (cards and notes survive a refresh, no "AI" anywhere), qa-discover (Discover one a day, Saved, Interested, Inbox tabs), qa-pending (Interested saved to Pending, chat opens when both selfies are approved), qa-place (Google place search), qa-profile (Profile tab, Edit profile, Settings, take a break), qa-onboard (joining as two new numbers, with and without Meet someone new: intro, What's hardest, friends into Your circle, where Limen can help, profile, Save, Interested, Pending, chat opening, tips, margins), qa-inbox-chat (Chats and chat end to end: rows, scam note, sending, Reflect, Reminders, Report, Block, Back), qa-circle (Your circle: empty state, add/edit/move/remove, rhythm choices per circle, Limen people placed on their own, hand moves, nobody else can read the list), qa-person (faces open the person, person page, next check-in date, private photos), qa-suggest (Your circle suggestions: due rule, how often, Not now, Fewer, Limen people, pattern question, check-in retired, privacy, reach out on the web), qa-notify (runs the real send-notifications function against stand-ins for Expo and Resend, plus the Notifications settings). SQL: `securitysql.sql` (what a person must not be able to do from a browser; run after every migration), `circlesql.sql` (date rule, photo privacy), `joiningsql.sql` (joining answers private, the Meet someone new rule), `notifysql.sql` (what creates a notification, never the text, privacy, quiet hours). SQL checks in `qa/sql-checks/`. Details and helpers in `qa/README.md`.
- Server functions (AI) don't run locally; screens must fall back gracefully.
- Phone-only parts (contacts, Text / Call / Email) can't run in the web test copy; test them on a phone with Expo Go (`npx expo start`, scan the code).
- If a tap does nothing in a script, look for two elements with the same text.
- In the real app, the Test tab (admins and test accounts) can "Act as" a test account and move time per chat: quiet chat, meetups, nudges, planning, reminders due now, fill chats to the limit, end a pause.

## Every session

1. CLAUDE.md auto-loads AGENTS.md (current decisions), docs/context/00_CORE.md (beliefs, the 7-point test, how copy should feel; wins over everything else), 01_PRODUCT.md (what's built), 02_PLAN_AND_STATUS.md (what to build next, stage by stage; build one stage per session) and this file. 00 to 02 are copies of the founder's claude.ai project docs: when one changes there, replace the repo copy, and after a stage update both. Before changing an area, `grep` the archive (docs/archive/AGENTS_FULL_HISTORY.md, docs/archive/PROGRESS_HISTORY.md) and docs/DECISIONS.md for that area's past reasons. Never read the archive files whole (the progress history is about 700 KB).
2. Build, then `npx tsc --noEmit`, then the relevant qa suites. Check screens on a phone-sized window.
3. Write it down: a short dated entry at the end of PROGRESS.md (recent log, not auto-loaded), a bullet under "LIMEN V2 DECISIONS" in AGENTS.md, the area in docs/DECISIONS.md, and update docs/context 01 and 02 (and tell the founder to update the same project docs) if something there changed.
4. Commit, push, and tell the founder the exact migrations to run and functions to deploy.
