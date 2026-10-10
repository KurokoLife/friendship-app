# Local test copy of Limen

A full copy of the app running inside the cloud workspace: real Postgres with
every migration, PostgREST, a small stand-in for Supabase Auth and Edge
Functions (`gateway.js`), the exported web app, and Playwright checks that
click through the real screens as different test people.

Use it to check changes before the founder runs anything on the real
Supabase project. It never touches the real project.

## First time in a new workspace

```bash
bash qa/setup.sh      # Postgres 16, PostgREST 12.2.3, node packages (safe to rerun)
npm ci                # the app's own packages, if node_modules is missing (build.sh needs them)
bash qa/start-db.sh   # starts Postgres on port 5433
bash qa/apply.sh      # fresh database: bootstrap, every migration in order, seed people
bash qa/build.sh      # exports the web app (about a minute)
bash qa/restart.sh    # PostgREST :3000, gateway :54321, web :8099; prints "web 200 / api 200"
```

After changing SQL: `bash qa/apply.sh` (rebuilds the database from scratch;
then `bash qa/restart.sh`). After changing app code: `bash qa/build.sh`
(and `bash qa/restart.sh` if the web server isn't running).

## Running checks

On-screen suites run in the background (a suite takes 1 to 4 minutes; don't
block on them):

```bash
bash qa/run.sh qa-remind qa-share   # or: bash qa/run.sh all
cat qa/.local/out-qa-remind.txt     # PASS/FAIL lines, "N/N passed" at the end
ls qa/.local/out-all.txt            # exists when the whole batch is done
```

Database-only checks (fast, each wrapped in a transaction that rolls back):

```bash
psql -h /tmp -p 5433 -U postgres -d limen -f qa/sql-checks/remsql.sql
psql -h /tmp -p 5433 -U postgres -d limen -f qa/sql-checks/notesql.sql   # notes privacy
psql -h /tmp -p 5433 -U postgres -d limen -f qa/sql-checks/meetanswersql.sql   # "Did you meet?" on old cards, topics
```

Suites and what they cover (all passing on 2026-10-10):

| Suite | Covers |
|---|---|
| qa-oct9 | Back buttons, profiles of past chats, Inbox "Not available", places, pace |
| qa-oct9b | Reconnecting, capacity wording, no-hello matches, pause rules |
| qa-oct9c | Pause note, selfie check (approved only), fill-to-limit tool |
| qa-meetups | Meetup plans, moving plans, day-before / morning-of / "Did you meet?" |
| qa-plan | "Let's plan something" draft and invite |
| qa-meet | Nudges to meet in person, adding a meetup made outside the app |
| qa-noghost | Quiet chats: getting-started note, check-in, quiet close |
| qa-remind | Reminder settings, phone layout, safety tips, after a good meetup |
| qa-share | "Remind me later" after a good meetup |
| qa-notes | Remember in the chat: bar, notes by meetup, free notes with topic chips, search and filters from 6 notes, Next time list, planning card (incl. "Ideas for us"), check-in, setting, ended chats, Settings download |
| qa-answer | "Yes, we met" / "No, that's not right" on an old card, at a laptop window size |
| qa-mochi | Admin account basics |
| qa-testtab | Test tab tools and "Act as" |

Note: qa-meetups' morning-of steps fail before 5am Los Angeles time, by design.

## Writing a new suite

Copy one in `suites/`. Helpers from `qa-lib.js`:

- `L.as(U.maria)` opens a browser signed in as that person (430 x 1100 phone-sized window, dark mode, Los Angeles time).
- `go(page, '/thread/<id>')` opens a screen (chats open the plan bar automatically; pass `{ expand: false }` to keep it closed).
- `tap(page, 'Button text')` clicks the last match on the page (`{ nth: 0 }` for the first).
- `text(page)` is all visible text. `q(sql, params)` runs SQL as the database owner.
- `L.makeChat(userA, userB, [[sender, 'text', hoursAgo], ...])` makes a chat with messages.
- `check('label', condition, extra)` records PASS/FAIL. End with `await L.finish()`.

Test people (`U.` in qa-lib): maria, david, aisha, robert, priya, marcus,
jordan, sam, elena, and mochi (admin). Ids are `10000000-0000-0000-0000-00000000000N`
(mochi `...0aa`). Names show as "Maria S.", "David C." and so on. Every seed
person's reply pace is "1-2 days". The seed has a Maria and David connection;
tests usually delete connections for the people they use first.

## Gotchas

- `run_friendship_journey_sweep_all(now() + interval '...')` runs the reminder sweep at a pretend time.
- Server functions (AI) don't run here: every `/functions/v1/...` call answers "Not available in the local test copy" (except `dev-create-session`). Screens should handle that gracefully; AI paths fall back to built-in content.
- pg_cron and pg_net are skipped when migrations load locally.
- Video files aren't served locally; screens with videos still load.
- If a screen tap does nothing in a script, check for two elements with the same text (for example a video offer's own "Not now").
