# Limen: how we work (for build and test sessions)

Last updated 2026-10-10.

## Working with the founder

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
- The founder runs it by pasting the raw link into the Supabase SQL Editor:
  `https://raw.githubusercontent.com/KurokoLife/friendship-app/limen-v2-ethics-alignment/supabase/migrations/<file>`
- Current version: `20261010000003` (Remember in the chat).
- Patterns: private tables use own-row RLS; anything another person must never see goes through SECURITY DEFINER functions that return only the caller's own data; prompt cards are rows in `connection_interventions`, ranked by `get_active_intervention` so only one shows.

## Server functions

- The founder deploys by pasting the file into the Supabase dashboard (Edge Functions → the function → Code → Deploy). There is no CLI access from the workspace.
- Live: `generate-match-suggestions`, `generate-personality-narrative`, `reflection-coach`, `plan-ideas`, `selfie-review`, `geocode-city`, `delete-account`, `dev-create-session`.
- Retired or unused: `generate-reply-draft` (returns 410), `generate-activity-suggestions`, `generate-connection-analysis`, `validate-ai-credit-purchase`, `validate-premium-purchase`. `organize-remember-entry` and `summarize-remember-timeline` are deleted.

## Testing

- Local test copy in `qa/` (real Postgres with every migration, PostgREST, a stand-in for Auth and server functions, the web app, Playwright). It never touches the real project. First time in a new workspace:
  `bash qa/setup.sh && bash qa/start-db.sh && bash qa/apply.sh && bash qa/build.sh && bash qa/restart.sh` (expect "web 200 / api 200").
- After SQL changes: `bash qa/apply.sh` then `bash qa/restart.sh`. After app changes: `bash qa/build.sh`.
- Run suites in the background: `bash qa/run.sh qa-remind qa-share` (or `all`), read `qa/.local/out-<suite>.txt`. Database-only checks: `psql -h /tmp -p 5433 -U postgres -d limen -f qa/sql-checks/<file>.sql`.
- Suites: qa-oct9, qa-oct9b, qa-oct9c, qa-meetups (morning-of steps fail before 5am LA time, by design), qa-plan, qa-meet, qa-noghost, qa-remind, qa-share, qa-mochi, qa-testtab, qa-notes (Remember). SQL checks in `qa/sql-checks/`. Details and helpers in `qa/README.md`.
- Server functions (AI) don't run locally; screens must fall back gracefully.
- If a tap does nothing in a script, look for two elements with the same text.
- In the real app, the Test tab (admins and test accounts) can "Act as" a test account and move time per chat: quiet chat, meetups, nudges, planning, reminders due now, fill chats to the limit, end a pause.

## Every session

1. CLAUDE.md auto-loads AGENTS.md (current decisions) and docs/context 01 to 03. Before changing an area, `grep` the archive (docs/archive/AGENTS_FULL_HISTORY.md, docs/archive/PROGRESS_HISTORY.md) and docs/DECISIONS.md for that area's past reasons. Never read the archive files whole (the progress history is about 700 KB).
2. Build, then `npx tsc --noEmit`, then the relevant qa suites. Check screens on a phone-sized window.
3. Write it down: a short dated entry at the end of PROGRESS.md (recent log, not auto-loaded), a bullet under "LIMEN V2 DECISIONS" in AGENTS.md, the area in docs/DECISIONS.md, and update docs/context if something there changed.
4. Commit, push, and tell the founder the exact migrations to run and functions to deploy.
