# Full App Inventory — live-verified, staged

**Supersedes** any prior status report for the areas it covers. Every claim below was checked directly this pass (live trigger + screenshot or direct database/RPC query) unless marked otherwise. Treat PROGRESS.md, AGENTS.md, CURRENT_STATE.md, APP_SCREENS_REFERENCE.md, PRODUCT_GUIDE.md as **unconfirmed** until an area here says otherwise.

**Status key:** LIVE & VERIFIED (evidence cited) / BROKEN (what's wrong) / NOT BUILT / UNCERTAIN (why).

---

## Step 0 — the real map (done)

Built from the codebase and live database directly, not from memory of prior sessions.

- **34 routes** under `src/app/` (7 tabs + Dev, plus 26 other screens/dynamic routes).
- **33 files** in `src/lib/`, **33 components** in `src/components/`.
- **12 Edge Functions**, **~108 migrations**, **50 tables** live in `public` right now.
- **9 markdown docs** at repo root beyond CLAUDE.md: AGENTS.md, PROGRESS.md, README.md, plus **APP_SCREENS_REFERENCE.md, CURRENT_STATE.md, PRODUCT_GUIDE.md, FRIENDSHIP_JOURNEY_DESIGN.md** — none of which were in the original 16-area brief.

**Critical finding, reported and resolved with the user before proceeding:**

There is real, live, uncommitted work in progress right now — a contextual **Video Guidance System** (7 videos, 6 new coach-mark-style once-ever trigger keys: `video_show_up`, `video_first_meetup`, `video_friendship_grows`, `video_restart`, `video_something_off`, `video_ending`; a new untracked `video-guidance-card.tsx`; a migration `20260831000000` not in git). Confirmed **already applied to the live database** (the `coach_marks_seen` CHECK constraint includes the new keys). It made a real behavior change: **"How We Show Up" was demoted out of mandatory onboarding**, replaced by a one-time contextual exposure later. The most recent commit, `APP_SCREENS_REFERENCE.md`, was written against this same uncommitted diff ("Module 1 of 1"), so git HEAD and the actual running app have diverged — reverting to HEAD would silently regress onboarding and delete the video system.

**Decision (user-confirmed):** treat the current working tree (dirty diff included) as ground truth — it's what's actually running. Added as **Area 18 — Video Guidance System**. Flagged, not fixed, here.

The other "unmapped" tables found in Step 0 (`connection_interventions`, `connection_pause_details`, `friendship_events`, `graduation_readiness`, `meetup_date_resolutions`, `meetup_history`, `meetup_occurrence_reports`, `private_post_meetup_reflections`, `progressive_reflections`, `rhythm_preferences`, `second_look_responses`) all belong to the Friendship Journey v2 rebuild and fold into areas 4–10 below, not a separate area.

**Pacing (user-confirmed):** one area at a time, brief check-in after each.

---

## Executive summary

**18 of 18 areas covered. 14 clean, 4 with real, confirmed bugs.** Every finding below was reproduced live (browser + database), not inferred from reading code alone, unless explicitly marked otherwise.

| # | Area | Status |
|---|---|---|
| 1 | Onboarding | LIVE & VERIFIED |
| 2 | Discovery (Discover/Browse/Saved) | LIVE & VERIFIED |
| 3 | Messaging | LIVE & VERIFIED |
| 4 | No-ghost reminders | LIVE & VERIFIED (1 dev-tool staleness flagged) |
| 5 | Scheduling & meetups | LIVE & VERIFIED |
| 6 | Day-of feeling check | **BROKEN** — 2 of 3 options are no-ops |
| 7 | Post-meetup flow | LIVE & VERIFIED |
| 8 | Graduation | **BROKEN** — two competing graduation UIs fire simultaneously |
| 9 | Honest Exit | LIVE & VERIFIED |
| 10 | Remember | LIVE & VERIFIED |
| 11 | Guide/video library | LIVE & VERIFIED |
| 12 | Coach marks | **BROKEN** — dimming overlay still blocks navigation, a documented fix regressed |
| 13 | Free vs. Premium | LIVE & VERIFIED |
| 14 | Report/Block, safety | LIVE & VERIFIED |
| 15 | Settings | LIVE & VERIFIED |
| 16 | Dev tab tools | **BROKEN** — 3 Quick Tests exercise dead v1 systems |
| 17 | Anything else found: `friendship_stage` state machine | LIVE & VERIFIED (partial coverage, see notes) |
| 18 | Video Guidance System (new, uncommitted) | LIVE & VERIFIED |

**The 4 confirmed bugs, ranked by real user impact:**

1. **Graduation (Area 8) — the most severe.** The Friendship Journey rebuild added a new graduation checkpoint that never got reconciled with the pre-existing one. Both fire simultaneously at 5 meetups, for both participants, asking two different questions. The new one's mutual-agreement signal is currently a dead end — nothing reads it. Only the old modal actually transitions status. Real, confusing, duplicate UX on a milestone moment.
2. **Coach-mark overlay (Area 12) — the broadest blast radius.** A documented 2026-08-24 fix regressed: the dimming layer's `pointer-events: none` doesn't actually take effect in the live app (root-caused precisely via computed CSS). Any first-time coach mark can block real interaction with anything else on screen until dismissed. This surfaced as an unexplained blocker in at least 3 other areas (4, 13, and general navigation) before being traced to its source here.
3. **Day-of feeling check (Area 6).** 2 of 3 response options are no-ops with no state write — the card resurfaces identically on every thread visit until the meetup date passes, regardless of how many times the ordinary, expected answer is tapped.
4. **Dev tab Quick Tests (Area 16) — lowest severity, developer-facing only.** 3 of the "one-tap end-to-end" test buttons exercise v1 systems that no longer have any live UI (or bypass the real v2 mechanism), meaning they can report false confidence to whoever runs them next.

**Not fixed anywhere in this pass** — this was a documentation and verification pass only, per its own scope. No application code was changed; `FULL_APP_INVENTORY.md` is the only new file.

---

## Area 1 — Onboarding

**LIVE & VERIFIED.** All 12 screens visited live (2 unauthenticated: `philosophy-intro`, `phone-verification`; 10 via a real seed-account session, direct-route navigation, which — per this project's own established testing method — doesn't gate on account completeness, so this exercises the same screen a fresh account would see). Every screen rendered real, current content with zero page errors. The full forward-navigation chain was then independently confirmed by reading each screen's own `router.replace()` call (not just visiting each route in isolation):

`philosophy-intro` → `phone-verification` → `verify-code` → `email-verification` → `profile-basics` → `gender-identity` (3 steps) → `social-linking` → `profile-build` (10 paginated steps) → `big-five-assessment` → **`friendship-experience`** → `etiquette-modules` (now **1 mandatory module**, not 2) → `readiness-commitment` → `modules-complete` → `/home` (or `/inbox`, see Area 2).

**Confirms three things that could each independently have drifted without anyone noticing:**
1. `friendship-experience` really is live inside the onboarding chain now (2026-08-08 relocation out of the old post-first-message modal) — real 5 questions rendered, `big-five-assessment.tsx`'s own Continue button routes fresh accounts there (`router.replace(isEditMode ? '/profile' : '/friendship-experience')`), and its own Continue routes to `etiquette-modules`.
2. `etiquette-modules` shows **"Module 1 of 1,"** confirming Step 0's uncommitted-work finding is really live in the running app, not just in the diff. `MODULES = ALL_MODULES.filter(m => m.mandatory)` now resolves to exactly `module_curiosity`.
3. `profile-basics` shows the real terms-acceptance checkbox and the real, current referral copy ("...opened the app on at least 14 different days...") — matches the 2026-08-08 14-distinct-day rebuild, not stale copy.

**Not independently re-verified this pass** (would require the fresh-account creation path, which this project has repeatedly confirmed is blocked in this environment — `dev-create-session`'s hardcoded 9-phone allowlist): the *very first* real signup click-through with a genuinely new phone number. Every screen was instead exercised via direct navigation on an already-onboarded seed account, the same substitute method prior sessions used and documented as a deliberate, disclosed limitation, not a gap introduced here.

**Minor, non-blocking observation:** `modules-complete`'s copy ("You'll find short guides in your profile when you're ready, on things like the honest exit...") reads as more current/specific than AGENTS.md's own generic "All set" description — not a bug, just noting the doc is behind the live copy here too.

---

## Area 2 — Discovery (Discover / Browse / Saved)

**LIVE & VERIFIED.**

- **Discover:** real, live AI-scored suggestions with genuine, grounded reasoning tied to actual shared data (Maria Santos ↔ Elena Torres: "You're both navigating career change... You both selected outdoors and tennis pickleball... Your rhythms line up too"; Aisha Bello: reciprocity note "tends to message daily, worth talking through if you connect"). Save/Not for me/Say hello all present.
- **Browse:** filter chip row (life transition, age, activities, communication, meeting frequency, hangout style, response time, ethnicity, language, distance) all present. Radius pool warning fires correctly and shows a real, accurate count: "Only 2 people within this distance right now," matching Maria's real, small compatible pool — this is the 2026-07-26 warning feature, still live and correct.
- **Saved:** shows Aisha Bello with a working Remove action, no stale 14-day-expiry copy anywhere (matches the 2026-07-21 removal).
- **Landing-tab routing** (2026-08-22 feature, `index.tsx`): re-verified against *current*, not stale, connection state. Initially assumed Maria Santos would land on `/inbox` per an older session snapshot — checked her real `my_connection_capacity()` first and found she now has 0 active/0 pending (her connection state has genuinely changed since that snapshot), so `/home` was actually the *correct* landing for her today, not a regression. Cross-checked all 9 seed accounts directly; found Jordan Blake with a real pending connection (1) and confirmed he lands on `/inbox`, closing the loop on both branches of the logic with real, current data rather than a stale assumption.

**No bugs found in this area.**

---

## Area 3 — Messaging

**LIVE & VERIFIED.** Real thread (Jordan Blake ↔ Sam Rivera) opened via Inbox click-through, not a direct route guess. Header shows End / Report / Block; real message history with real dates; the unified scheduling card ("No meetup planned yet · Propose a date · View meetup history," 2026-08-18 rebuild) sits above the message list; compose footer shows "Let's plan something," Send, and Help me write/Clean up.

- **Duplicate-message send bug (fixed 2026-08-08):** re-verified with a real send of a unique marker string. First attempt looked like a failure (0 occurrences found) — turned out to be a locator problem on the *reading* side, not the send: a direct DB check found the message really had landed, exactly once. Redid the send with a corrected locator: exactly 1 occurrence, both in the rendered page and the database. **No duplicate-render regression.** Both test messages deleted afterward, confirmed via requery.
- **AI polish ("Help me write" → "Clean up," Part 1 rebuild):** confirmed the button label is content-gated exactly as designed (shows "Help me write" on an empty box, switches to "Clean up" once text is typed — my first attempt failed for the same reason as the duplicate-check, wrong assumed label, not a bug). Typed a rough draft ("hey sorry been slow this week wanna grab coffee sometime soon"), clicked Clean up, got back real, grounded, correctly punctuated output: *"Hey, sorry, been slow this week. Wanna grab coffee sometime soon?"* — genuinely polishing existing text, not generating from nothing, matching the Part 1 fix. Nothing was sent, no cleanup needed.

**Deferred to Area 13 (Free vs. Premium):** AI-assist daily/weekly caps and the credit/pool fallback mechanism, since that's a dedicated area with its own boundary-testing needs, not duplicated here.

**No bugs found in this area.**

---

## Area 4 — No-ghost reminders

**LIVE & VERIFIED**, run against the **v2** system (`run_no_ghost_check_v2`, via the `friendship-journey-sweep` cron) — confirmed first that this, not the old `run_no_ghost_check`/`no-ghost-check` cron, is what's actually active (`cron.job`: `no-ghost-check` → `active: false`; `friendship-journey-sweep` → `active: true`, `*/15 * * * *`).

**A stale dev-tool found in the process (flagged for Area 16, not fixed here):** the Quick Tests panel's `dev_test_no_ghost_end_to_end` RPC still calls the **old, inactive** `run_no_ghost_check` and writes into the old `no_ghost_prompts` table — it would report a "successful" no-ghost test today using a system that hasn't been live since the 2026-08-10 cutover. Not fixed (out of this area's scope), documented in Area 16 below.

**Live boundary test, isolated connection (David Chen → Robert Kim, created and fully deleted for this test):**
- 23h elapsed: `run_no_ghost_check_v2` → `'none'`. Correct (flat 24h threshold, no variable-by-`response_time` behavior anymore).
- 25h elapsed: → `'r1'`, and `connection_interventions` gained a real row (`intervention_type: no_ghost_r1`, `target_user_id`: Robert, `status: pending`). Correctly targets the *recipient*, not the sender.
- `get_active_intervention(connection, robert)` called directly: correctly returns the `no_ghost_r1` row.
- **Real UI, recipient side (Robert Kim):** first check (2.5s wait) showed no card — looked like a bug. Re-checked with a 6s wait (matching this project's own documented history that this exact effect chain sometimes needs ~5.5s+, not a fixed short wait) and the card rendered correctly: *"Still meaning to reply? / Reply / Help me reply / I'll come back to this."* Confirmed this was a test-timing artifact, not a product bug, by isolating the RPC call first (it returned correctly on the first, un-timed attempt) before re-testing the UI with a longer wait.
- **Real UI, sender side (David Chen):** the real 36-hour passive reassurance line rendered exactly as documented: *"Sometimes it takes a few days to reply. This does not necessarily mean anything."* — the Part 1 rebuild, confirmed live and correct.

**No product bugs found in this area.** Test connection and all cascaded data fully deleted, confirmed via a zero-row requery.

---

## Area 5 — Scheduling & meetups

**LIVE & VERIFIED.** Full propose → confirm → reschedule cycle driven through the real UI on a fresh isolated connection (David Chen ↔ Robert Kim, created for this test, fully deleted after):

- **Propose:** "Proposing your 1st meetup" — the real meetup-number framing, sourced from the real `connections.meetup_count`, matching the 2026-08-18 Part 2 rebuild.
- **Proposer's own view** after saving: "You proposed August 29, 2026. Waiting for Robert Kim to confirm." plus "Propose a different date" and "Cancel."
- **Non-proposer's view:** "David Chen proposed August 29, 2026." / Confirm / Propose a different date / Cancel — **exactly one card**, confirming the Part 2 duplicate-card fix is still holding (no second, competing "confirm this date" card anywhere).
- **Confirm:** flips correctly to "Next meetup: August 29, 2026 / Reschedule."
- **Reschedule:** opens a real Save/Cancel editing form.
- **"View meetup history":** real, working route, correctly shows "No confirmed meetups yet" for a meetup that's only confirmed for the future, not yet occurred.
- **Bonus corroboration for Area 18:** the Video Guidance System's "First meetup coming up? A short guide if it helps." card rendered contextually the instant the first meetup was confirmed — real, live evidence it's wired correctly, not just present in the diff.

**No bugs found in this area.**

---

## Area 6 — Day-of feeling check

**BROKEN.** This is the `pre_meetup_support` card (`"How are you feeling about meeting {name}?"`), rendered whenever a connection has a meetup confirmed for today or tomorrow. Reproduced live on the same test connection right after confirming a meetup:

- Read `PrimaryInterventionCard`'s `PreMeetupSupport` component directly: **"Looking forward to it" and "A little nervous" are both wired to `onPress={onResolved}` with no state write of any kind.** `onResolved` just triggers a refetch of the active intervention from `get_active_intervention`, a `pre_meetup_support` row is entirely *computed live* (`meetups.confirmed_date between current_date and current_date+1`, no `status`/dismissal column involved) — nothing about tapping either option changes what that query returns.
- **Confirmed live, not just read from source:** clicked "A little nervous" — the card re-rendered with the identical three options, still visible. Did a full, fresh page reload — the card was still there, identically. **The card will resurface every single time the connection's thread is opened, for as long as the confirmed date is within the today/tomorrow window, no matter how many times "Looking forward to it" or "A little nervous" is tapped.** A user has no way to actually dismiss it via either of the two "positive" options — only "I'm thinking about cancelling" does anything real (it routes to a concern flow that can end in `cancelMeetup`, which genuinely changes `meetups.status` and would stop the card from matching).
- **Real user impact:** anyone who taps the completely ordinary, expected response ("Looking forward to it") gets no acknowledgment that registered — the card just comes back, indistinguishable from never having answered, every time they revisit the thread before the meetup happens.

**Not fixed** (documentation/verification pass only, per this task's own scope). The minimal correct fix is almost certainly a small persisted "seen/dismissed for this meetup" table or column (the same shape `meetup_outcome_dismissals`/`coach_marks_seen` already use elsewhere in this app), checked by `get_active_intervention` alongside the existing date-range condition — not attempted here.

Test connection and all cascaded data (`connection_interventions`, `pre_meetup_concerns`, `meetups`, `messages`, `connections`) fully deleted afterward, confirmed via a zero-row requery.

---

## Area 7 — Post-meetup flow

**LIVE & VERIFIED.** Full occurrence-check branching driven live on a fresh isolated connection (David Chen ↔ Robert Kim, a meetup confirmed 3 days in the past, created for this test, fully deleted after):

- **Retimed trigger (Part 3 fix, "2 days after," not "the day after"):** `run_meetup_occurrence_check_v2` correctly fired at the 3-day mark, raising a real `meetup_occurrence_check` intervention for **both** participants.
- **Full branching, real UI, no shortcuts:** "Did you meet Robert Kim on August 25, 2026? / Yes / No" → **No** → "Was it rescheduled, or cancelled? / Rescheduled / Cancelled" → **Cancelled** → "Why was it cancelled? / Something came up / Things changed on my end / It didn't feel like the right fit anymore / Other" → picked a reason → "Do you want to propose rescheduling? / Yes / No" → **Yes** → the real Part 1-style compose screen ("You don't need a perfect message...") with a working "Let's plan something" link alongside it.
- **Reload-resumable fix (Part 3):** reloaded the page mid-flow (right after reaching "Why was it cancelled?"). The card did **not** vanish (the original bug) — it correctly reset to the initial "Did you meet...? Yes/No" ask state, matching the documented, deliberately-partial fix (resume-to-start, not full step persistence).
- **Deferred-report-at-terminal-step fix (Part 3):** confirmed at the database layer, not just the UI — exactly one `meetup_occurrence_reports` row (David, `reported_yes: false`) and exactly one `meetup_cancellation_reasons` row (`reason: schedule_conflict`, `wants_reschedule: true`), both written only once the flow reached its true terminal step, no duplicate or premature writes from the earlier "No" tap.

**No bugs found in this area.** All test data fully deleted afterward, confirmed via a zero-row requery.

---

## Area 8 — Graduation

**BROKEN.** The Friendship Journey v2 rebuild added its own graduation checkpoint but never reconciled it with the pre-existing (2026-08-26) graduation system — **both fire at once, for both participants, the moment a connection hits 5 meetups.**

- **Confirmed in source, not just observed:** `<GraduationModal>` (`thread/[id].tsx` line ~1576) is rendered **completely unconditionally** — outside both the `NEW_SYSTEM_LIVE` and `!NEW_SYSTEM_LIVE` render blocks entirely, its own visibility driven independently by `shouldShowGraduationPrompt`/`fetchGraduationEligibility` (`src/lib/graduation.ts`), checking `connections.meetup_count` directly, with zero awareness of the new intervention-priority system. Meanwhile `get_active_intervention`'s own rank-8 `graduation_checkpoint` branch fires under the *same* `meetup_count >= 5` condition, independently, via `PrimaryInterventionCard`.
- **Confirmed live**, isolated test connection (David Chen ↔ Robert Kim, `meetup_count` set to 5, created for this test): both participants simultaneously saw **two separate cards** — the new "Does this connection still need Limen to keep moving? / Limen is still helpful / We mostly connect on our own now / I'm not sure yet" (private readiness survey) *and* the old, real blueprint-verbatim "You have met five times in person... / Move to Graduated / Keep chat available / Not yet."
- **The new checkpoint does nothing on its own.** Read `submit_graduation_readiness` directly: it only writes to `graduation_readiness` and, when both participants independently answer "mostly_on_our_own," records a private `graduation_mutual` friendship_event — full stop. Grepped every function in the database for any read of that event or any other call to `graduate_connection` (the only function that ever sets `connections.status = 'graduated'`): **none exists.** The new checkpoint's mutual-agreement signal is currently a dead end — it can never, by itself, transition a connection to graduated, free capacity, populate Inbox's "Graduated" section, or start the 30/90-day continuation clock, no matter what both participants answer.
- **The old modal is the only thing that actually works**, confirmed live end to end: "Move to Graduated" correctly set `status = 'graduated'` and `graduated_at`; the connection correctly disappeared from active capacity; Inbox correctly showed a real "GRADUATED" section ("Met 5 times · Graduated").
- **Minor, secondary, self-clearing observation** (not the main bug, noted for completeness): right after graduating via the old modal, the new v2 checkpoint card was still visible in the same page (a stale, un-refetched `newSystemIntervention` state — `onGraduated` calls `loadConnectionStatus()` but never explicitly clears/refetches the intervention). Confirmed this clears itself on a fresh page reload (`is_connection_automation_eligible` correctly excludes `'graduated'`), so it's a transient same-session staleness, not a persistent bug — but it's more evidence the two systems aren't talking to each other.

**Real user impact:** anyone reaching 5 meetups today sees two different, differently-worded "you've met 5 times" prompts stacked on the same screen, asking for two different kinds of input, only one of which does anything. This is the same class of problem the 2026-08-18 session already fixed once for duplicate meetup-proposal cards — that fix didn't extend to Graduation.

**Not fixed** (documentation/verification pass only, per this task's scope). The two most likely correct directions, not decided here: either wire `submit_graduation_readiness`'s mutual-agreement branch to actually call `graduate_connection` (making the new checkpoint the real mechanism and retiring the old modal), or gate the old `GraduationModal` behind the same `NEW_SYSTEM_LIVE` flag the rest of the rebuild already uses (suppressing it entirely while `NEW_SYSTEM_LIVE = true`). Either is a small, targeted change; picking between them is a product decision, not a technical one.

Test connection and all cascaded data (`graduation_readiness`, `friendship_events`, `connection_interventions`, `messages`, `connections`) fully deleted afterward, confirmed via a zero-row requery.

---

## Area 9 — Honest Exit

**LIVE & VERIFIED.** Unlike Graduation, the v2 intervention priority list has no honest-exit-equivalent type at all, so there's no dual-system conflict here — `EndConnectionModal` (also rendered unconditionally, same as `GraduationModal`) remains the sole, untouched mechanism.

Drove the full **message-less** path live on a fresh isolated connection (David Chen ↔ Robert Kim, created for this test, fully deleted after):

- Modal renders exactly as documented: message-or-not toggle, private reason chips (6 options), 3 wording templates, compose box, Cancel/End connection.
- Picked "End without a message" + "Not the right friendship match," confirmed End.
- **David (the ender):** real sender confirmation ("Choosing honesty over silence takes real courage...") and the honest banner ("This connection was deliberately ended... View profile"), header correctly dropped "End" once ended (only Report/Block remain).
- **Robert (received zero messages):** saw the **identical** honest banner ("This connection was deliberately ended, not paused or auto-closed...") despite never having received a message — confirms the "message-less but still notifies" design genuinely works, not just for the sender.
- **Database-level confirmation:** `status = 'ended'`; message count unchanged at 2 (no exit message inserted); exactly one `connection_end_reasons` row for David (`not_a_match`).
- **Privacy guarantee, RLS-verified, not just UI-absent:** Robert's own RLS-impersonated query against `connection_end_reasons` returned **0 rows**; David's own query correctly returned his real reason. The private-reason guarantee holds structurally, not just because no screen renders it.

**No bugs found in this area.** All test data fully deleted afterward, confirmed via a zero-row requery.

---

## Area 10 — Remember

**LIVE & VERIFIED.** Untouched by the Friendship Journey rebuild (no v2-specific Remember functions exist), but its correctness now genuinely depends on `meetup_count` incrementing correctly under v2, so this was verified end-to-end from a real mutual occurrence confirmation, not assumed from old test data.

- Set up an isolated connection, both participants independently called `report_meetup_occurrence(..., true, same_date)` — confirmed `meetups.status` correctly resolved to `'occurred'` and `connections.meetup_count` incremented via the `bump_meetup_count_on_occurred` trigger (0 → 1), a real, live confirmation that Remember's core dependency survived the rebuild.
- **People List:** correctly showed "Robert Kim / 1 meetup."
- **Add Entry:** composer opened correctly (date field, prompt suggestions, Organize with AI / Save as written). Typed a raw entry with a unique marker, "Save as written" → a review step ("What you wrote / [text] / Save entry") → confirmed. Not a bug — this is a real, deliberate 2-tap confirm on the raw path too, not just the AI path.
- **Timeline:** the saved entry correctly showed "After meetup 1," the real date, and the exact typed content, with Edit / Delete this entry / Delete all history with this person / Summarize for me all present.
- **Edit:** opened a real edit form (raw text, date, Save changes/Cancel), correctly hides "Delete this entry" while active (only "Delete all history" remains, consistent with edit mode).
- **Delete:** single-tap immediately removed the entry (matches the documented design — single-tap per-entry delete, two-tap only for "Delete all history").

**No bugs found in this area.** All test data fully deleted afterward, confirmed via a zero-row requery.

---

## Area 11 — Guide / video library

**LIVE & VERIFIED.** Full 13-entry Guides list loaded correctly (4 real-video entries + 9 text-only modules), zero console errors.

- **"(Onboarding)" tag correctly reflects the live mandatory state**, not stale copy: shows only next to "Begin With Curiosity" — "How We Show Up" correctly has no tag, consistent with Area 1's finding that it was demoted out of mandatory onboarding.
- **4 real video thumbnails**, matching the 4 actually-produced videos (Begin With Curiosity, How We Show Up, The First Meetup Does Not Need to Be Perfect, Friendship Grows a Little at a Time). The 3 newer entries from the video-architecture work (It's Okay to Pick It Back Up / When Something Feels Off / When a Friendship Changes or Ends) correctly show **no** thumbnail — no video file exists for them yet, matching their own documented "content stands in for the eventual video" status.
- **Real video detail screen** (`/guide/module_curiosity`): a genuine `<video>` element renders with the correct content.
- **Placeholder detail screen** (`/guide/video_restart`, one of the 3 not-yet-produced videos): correctly falls back to `VideoPlaceholder` ("...video coming soon"), zero `<video>` elements, **zero page errors** — confirms the `videoUrl ? <GuideVideoPlayer/> : <VideoPlaceholder/>` fallback in the uncommitted diff genuinely works, not just reads correctly in source.

**No bugs found in this area.**

---

## Area 12 — Coach marks

**BROKEN.** The 2026-08-24 session documented fixing exactly this bug ("a coach mark on a freshly-visited tab could block navigating to a different tab until that mark was explicitly dismissed"), by setting `pointerEvents: 'none'` on `SpotlightHost`'s dimming regions. **That fix does not hold up under direct re-verification today.**

- **First hit incidentally, twice, before this area was even reached:** Area 4's click into a real Inbox conversation row (David Chen) was blocked by an intercepting `<div>`, worked around with `force: true` at the time and flagged "for Area 12." The same interception reproduced again here, independently, with a fresh account (Marcus Alvarez, zero seen coach marks) trying to navigate from Discover to Browse while the `tab_discover` mark was showing.
- **Root-caused precisely, not just observed:** used `document.elementFromPoint` at the real click coordinates plus `getComputedStyle` up the full ancestor chain (8 levels, from the intercepting element to `<html>`). **Every single element in the chain, including the coach mark's own `Modal` wrapper (`position: fixed`, `z-index: 9999`) and the elements meant to carry `pointerEvents: 'none'`/`'box-none'`, computed to `pointer-events: auto`.** The fix's intent is correctly expressed in `spotlight-host.tsx`'s source (confirmed by reading it directly), but the computed, rendered CSS in the live app does not reflect it — meaning the underlying mechanism (`style.pointerEvents` on a `View`, translated by this project's pinned `react-native-web` version) isn't actually producing the CSS the fix assumes it will.
- **Net effect:** functionally identical to the original, pre-2026-08-24 bug. A coach mark on any freshly-visited screen can still block real interaction with anything else on screen — a tab-bar link, an Inbox row, another element entirely — until that specific mark is dismissed. The mark's own "Got it" dismiss still works correctly (you're clicking directly on visible, intentionally-interactive content), it's everything *else* on screen that's still blocked.

**Not fixed** (documentation/verification pass only, per this task's scope; also a genuine RNW/CSS-translation question, not a one-line app bug). Flagging the specific, verified symptom (computed `pointer-events: auto` throughout the chain despite `style.pointerEvents: 'none'`/`'box-none'` in source) should be enough for a focused fix session — likely either an RNW version-specific quirk with style-based `pointerEvents` (worth checking against the deprecated top-level `pointerEvents` prop this project moved away from in 2026-08-22, which may have actually worked correctly), or a missed spot in the fix's own implementation.

**No test data created for this area** (no coach mark was successfully dismissed during testing, confirmed via a zero-row query against Marcus's `coach_marks_seen`).

**Also flagged here, cross-referenced from Area 4:** the Dev tab's `dev_test_no_ghost_end_to_end` Quick Test still calls the old, inactive v1 no-ghost evaluator — see Area 16.

---

## Area 13 — Free vs. Premium

**LIVE & VERIFIED.** Config confirmed matching documented values exactly (`ai_function_caps`: `generate-reply-draft` 3/day, `generate-activity-suggestions` and `generate-connection-analysis` 1/week, `organize-remember-entry` and `summarize-remember-timeline` 2/week; `generate-match-suggestions` deliberately absent, governed by its own separate cap).

- Exhausted a real account's (Priya Nair) real `generate-reply-draft` daily cap via 3 real `record_ai_usage` calls, confirmed `get_ai_gate_status` correctly blocked (`daily_cap_reached`, `resets_at` = real UTC midnight), confirmed 0 `ai_credits` (no silent credit fallback masking the block).
- **Real UI, isolated test connection (Priya ↔ Marcus):** typed a message, tapped Clean up, got the real blocked message ("You've reached today's free limit for this, and you're out of extra credits too...") with **both** "Get 50 AI credits for $1.99" and "Upgrade to Premium" rendering together.
- **"Upgrade to Premium" initially appeared not to navigate** — root-caused as the *same* Area 12 coach-mark overlay bug (the `credits_premium` mark's own dimming layer blocking the click), not a separate defect: once that mark's "Got it" was dismissed first, the identical click correctly navigated to `/premium`.
- **`/premium` screen itself:** renders the real, correct comparison (2 vs. 5 AI suggestions/day, 4 vs. 8 active conversations, 5 vs. 8 pending Say Hi), the real $5.99/month price, the explicit "Compatibility ranking never changes with Premium" copy, and real Subscribe/Restore purchase actions.

**No new bugs found in this area** — the one snag traces back to the already-documented Area 12 finding, not a separate defect.

---

## Area 14 — Report/Block, safety

**LIVE & VERIFIED.** Full flow driven live on a fresh isolated connection (Aisha Bello ↔ Priya Nair, created for this test, fully deleted after) — untouched by the Friendship Journey rebuild.

- Opened Report from the thread header, all 8 real categories present.
- Picked "Unsafe meetup": real, non-invented emergency guidance rendered inline ("If you are in immediate danger, call 911," National Sexual Assault Hotline, National Domestic Violence Hotline), and "Also block" was correctly pre-checked for this category.
- Submitted: real confirmation ("Report submitted... Aisha Bello has also been blocked").
- **Database-level confirmation:** real `reports` row (`category: unsafe_meetup`, `also_blocked: true`), real `blocks` row (Priya → Aisha), `connections.status = 'blocked'`.
- **Both differentiated views confirmed exactly correct** (the 2026-08-11 fix): Priya (the blocker) sees the honest "This connection is blocked. You can no longer message each other."; Aisha (blocked) sees the genuinely ambiguous "This conversation isn't available anymore." — no wording anywhere confirming she was specifically blocked. Message history remained visible to both.

**No bugs found in this area.** All test data fully deleted afterward, confirmed via a zero-row requery.

---

## Area 15 — Settings

**LIVE & VERIFIED.** Full screen loads correctly: Account (Edit profile, Preview my public profile), Premium (Free/See Premium), Invite a Friend (real referral code + current 14-distinct-day copy), Notifications (honest "doesn't send push/email yet" placeholder), Help (Show tips again), Privacy & Safety, Legal, Account deletion.

- **Blocked accounts + Unblock:** seeded a real block (Marcus Alvarez → Robert Kim), confirmed it showed correctly ("Robert Kim / Unblock"), tapped Unblock, confirmed it correctly disappeared ("You haven't blocked anyone.").
- **Reports you've filed:** seeded a real report, initially appeared empty — turned out to be the section's own documented "deliberately collapsible" behavior, not a bug: tapping the section header correctly expanded it and showed the real report ("Other · Robert Kim / Aug 27, 2026 / inventory-test-report").
- **Terms / Privacy:** both navigate correctly and show the real, honestly-labeled placeholder text ("This is placeholder text. Final Terms of Service are forthcoming...").
- **Preview my public profile:** navigates to `/profile-review`, shows the real, correctly-formatted self-preview with real profile data.

**No bugs found in this area.** All test data (the seeded block and report) fully cleaned up afterward, confirmed via a zero-row requery.

---

## Area 16 — Dev tab tools

**BROKEN.** The Friendship Journey rebuild left the Dev tab's own "Quick Tests" panel testing systems that no longer have any live UI. Confirmed precisely via source, not assumed:

- **`dev_test_no_ghost_end_to_end`** (already surfaced in Area 4): calls `run_no_ghost_check` (v1), writes to `no_ghost_prompts` (v1 table). The live app runs entirely on `run_no_ghost_check_v2` via the active `friendship-journey-sweep` cron; the old `no-ghost-check` cron is confirmed `active: false`. A tester clicking this button today gets a "success" report from a system that hasn't governed real user behavior since the 2026-08-10 cutover.
- **`dev_test_meetup_checkin_end_to_end`**: calls `run_meetup_checkin_check` (v1), manipulates `meetup_checkins`/`last_plan_activity_at`/`next_meetup_date` (v1 fields). **Confirmed in source that this has zero live UI to render its result**: `<MeetupCheckinCard>`, `<MeetupOutcomeCard>`, and `<MeetupConfirmationCard>` are all rendered inside `thread/[id].tsx`'s `!NEW_SYSTEM_LIVE` block (lines ~1137–1560), and `NEW_SYSTEM_LIVE = true` in the live app — that whole block never renders. This Quick Test can report "fired" and a tester would see nothing on screen, with no indication why.
- **`dev_test_graduation_end_to_end`**: internally uses the *same* dead v1 mechanism (`meetup_checkins`, `meetup_confirmation_requests`, a hand-rolled mirror of `resolve_meetup_checkin`/`resolve_meetup_confirmation`'s old logic) purely as a shortcut to push `connections.meetup_count` up N times. This one is **not fully stale** — `meetup_count` is a real, shared column, and its end state (the count, plus `status`/`graduation_dismissed_at_count`) genuinely does drive both live graduation UIs (Area 8's own two competing cards). But its internal steps bypass v2's real mechanism entirely (`report_meetup_occurrence`, `meetup_occurrence_reports`, the trigger-based increment verified live in Areas 7 and 10) — a tester using this to "test graduation" is not exercising the same code path a real user's 5th meetup would take.

**Everything else in the Dev tab** (Time Travel panel: message backdating, next-meetup date manipulation, AI-cap/coach-mark/friendship-experience resets; "Reset ALL seed accounts"; the account switcher) reads/writes real, current tables directly rather than routing through either meetup-tracking generation, and was implicitly exercised correctly throughout this whole inventory pass (every isolated test connection, cap exhaustion, and coach-mark check in Areas 1–15 used these same underlying mechanisms without issue).

**Not fixed** (documentation/verification pass only, per this task's scope). The three stale Quick Tests need either a rewrite against the real v2 functions (`run_no_ghost_check_v2`, `run_meetup_occurrence_check_v2`, `report_meetup_occurrence`/`resolve_meetup_confirmation`) or removal, matching whatever direction Area 8's graduation-duplication fix ends up taking.

---

## Area 17 — Anything else found: the `friendship_stage` state machine

Enumerated every non-`dev_` function in the live database (110+ functions) specifically looking for anything with no home in Areas 1–16. Found a real, substantial piece of the Friendship Journey v2 design that no other area's tests happened to exercise: a per-connection **`friendship_stage`** column (`first_contact → conversation → first_meetup_planning → post_first_meetup → early_friendship → repeated_time → rhythm_established → graduation_eligible`), advanced automatically by a real trigger (`advance_stage_on_new_message`) plus a callable function (`advance_friendship_stage`).

**LIVE & VERIFIED, partial coverage.** Drove 3 real, consecutive transitions on a fresh isolated connection (Priya Nair ↔ Elena Torres, created for this test, fully deleted after), all fully automatic, no manual RPC calls needed beyond the ordinary actions a real user would take:
- Inserted one message → `friendship_stage` automatically became `first_contact` (no explicit call needed, confirming the insert trigger fires correctly).
- Elena replied → automatically advanced to `conversation` (both-participants-have-sent-a-message condition correctly evaluated).
- Priya proposed a meetup (`propose_meetup`) → automatically advanced to `first_meetup_planning`.
- Each transition correctly logged a `stage_changed` `friendship_events` row with accurate `from_stage`/`to_stage` payloads, plus an initial `first_message_sent` event.

**Also confirmed real and live, not dead code** (via grep, not deep live-tested — see below): `pause_connection_with_duration`/`resume_connection_early`/`run_pause_auto_resume_sweep` (a newer, duration-aware pause mechanism alongside the older plain `pause_connection`) is genuinely referenced from `primary-intervention-card.tsx` and `friendship-journey.ts`, not orphaned like the Area 16 Quick Tests. `submit_rhythm_preference` and `submit_second_look_response` back the `rhythm_reminder` and `second_look_prompt` intervention types already confirmed present in `get_active_intervention`'s own priority list (ranks 5 and 7).

**Not exhaustively live-tested, disclosed rather than silently assumed clean:** the remaining stages (`post_first_meetup → early_friendship` via a real "yes" `second_look_response`, `early_friendship → repeated_time` via a 2nd occurred meetup, `repeated_time → rhythm_established` via a real `rhythm_preference`, and the `graduation_eligible` stage itself at 5 occurred meetups) were **not** individually driven live in this pass, given the time already invested across 16 prior areas. The mechanism's own pattern (clean, automatic, correctly-logged, 3-for-3 on the transitions actually tested) is reasonably strong evidence for the rest, but this is explicitly weaker verification than every other LIVE & VERIFIED area in this document — flagged honestly, not overstated. `rhythm_reminder`/`second_look_prompt`/`conversation_restart_prompt` cards themselves (the actual UI a user would see) were not opened or screenshotted.

**No bugs found in what was tested.** Test connection and all cascaded data fully deleted afterward, confirmed via a zero-row requery.

---

## Area 18 — Video Guidance System (the uncommitted work from Step 0)

**LIVE & VERIFIED.** The system Step 0 found sitting uncommitted (7 videos, 6 coach-mark-style once-ever contextual triggers) is genuinely working, not just present in the diff — corroborated three separate times across this pass before being directly tested here:

- **Area 1:** `etiquette-modules` correctly shows "Module 1 of 1" (the onboarding demotion this system caused).
- **Area 5:** `video_first_meetup` ("First meetup coming up? A short guide if it helps.") fired correctly the instant a first meetup was confirmed.
- **Area 8:** the same card appeared correctly on an unrelated graduation-focused test connection.

**Directly tested here, `video_show_up` (Video 2), fresh isolated connection (Priya Nair ↔ Marcus Alvarez, real bidirectional messages, created for this test, fully deleted after):**
- The guidance card ("A short guide on showing up for a new connection, if it helps. / Watch / Not now") correctly appeared once both participants had exchanged messages.
- **"Watch"** correctly navigated to the real video (`/guide/module_show_up`, "How We Show Up"), a genuine `<video>` element with real content, not a placeholder.
- **"Not now"** correctly dismissed immediately, and correctly stayed dismissed after a full, fresh page reload — a real, working `coach_marks_seen` write for the `video_show_up` key, not just a local, in-memory hide.

**No bugs found in this area.** All test data (the connection and the one `coach_marks_seen` row) fully deleted afterward, confirmed via a zero-row requery.

---

*End of inventory. 18/18 areas covered. No application code was changed to produce this document.*
