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
psql -h /tmp -p 5433 -U postgres -d limen -f qa/sql-checks/discoversql.sql   # Discover, Interested, Saved, hidden chats
psql -h /tmp -p 5433 -U postgres -d limen -f qa/sql-checks/joiningsql.sql   # joining answers private, Meet someone new rule
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
| qa-pending | Interested always saved to Inbox, Pending; both interested + both selfies approved opens the chat; four tabs fit a phone |
| qa-onboard | Joining as two brand-new numbers (stage 2): with Meet someone new (two intro screens, sign-up, Basics, What's hardest, friends into Your circle with the right rhythm, where Limen can help, then Start with you (stories with guides, saved to the account as you write, comes back after leaving), recovery near the end, new order, no values or summary, ground rules, preview (every step, photo upload), side margins, Save, Interested, Pending, chat opening, first-time tips as cards that never cover a button; then without Meet someone new: no profile, All set without the selfie, the Your circle card and Discover invitation, never suggested to others, hardest answers private through the API |
| qa-profile | Small photo + viewer, one completion %, connection summary, Edit profile list with matching labels, Settings (sign-in, take a break, no invite), selfie and privacy wording |
| qa-place | Place search: Google first (real `place-search` function on :8000 with Google's answers faked; start it with `bash qa/start-place-fn.sh`), nearest first, one billing session, OpenStreetMap backup |
| qa-inbox-chat | Inbox and chat end to end: rows, scam note, sending shows right away, Reflect, Reminders, Report, Block, Back |
| qa-circle | Your circle: empty state, add / edit / move / remove a friend from outside Limen (rhythm choices per circle), Limen people placed on their own, hand moves, phone width, nobody else can read the list (through the API) |
| qa-person | Your circle stage 1c: faces open the person, empty ring part jumps, person page, next check-in line (adding, editing, from the last reach-out), private photos and their privacy (storage rules through the test gateway), phone and laptop |
| qa-suggest | Your circle suggestions (stage 3): who is due (stage 1c rule), one at a time with the gap for each frequency, I reached out, Not now back after a week, Fewer down to the slowest, Limen people (open chat, both wrote; never paused, one-sided or turned off), lines from your own notes, the pattern question and its answers on You, chat check-in retired, privacy through the API, person page on the web, laptop, Test tab tool, the "You" photo |
| qa-discover | Discover one a day, up to 3 waiting, nobody while full; Interested and Saved for 30 days; Inbox tabs, hide a blocked chat |
| qa-refresh | Cards and notes survive a page refresh; no "AI" on main screens; reminders sheet and payment page wording |
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

SQL check `sharesql.sql` (2026-10-22): shared friendship answers and care words need a real chat; strangers and saved-only see nothing; past-friendship answers never shared.
