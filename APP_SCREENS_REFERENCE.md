# App Screens Reference

A screen-by-screen walkthrough of every route in the app, built by actually navigating to each screen live (via a real, session-injected seed account, the same workaround this project has used since the Dev tab's own sign-in buttons were found unreliable) and confirming what genuinely renders — not by reading component code and assuming it works. Every screen below was visited live; most have a real screenshot saved during the check (not committed with this doc, they were verification artifacts, not deliverables). Code was read only as a second step, to explain *why* something looked the way it did.

**Where this doc differs from AGENTS.md/PROGRESS.md:** those files describe what was *built and verified* at the time each session ended. This doc describes what is genuinely rendering right now, in the current working tree, including a few things that are live in the working tree but were never committed to git (flagged explicitly wherever that's the case) — and a few things that are committed but currently broken. If you're deciding what to trust, prefer this doc's live findings over any prior session's "verified live" claim for the same screen, and prefer AGENTS.md for *why* a feature exists over what state it's currently in.

**Method note:** the account used for most checks (`Marcus Alvarez`, a real seed account) is already fully onboarded. Onboarding screens were hit directly by URL rather than by actually completing a fresh signup — this project has a standing, deliberate limitation where true fresh-account creation isn't reachable through the dev tooling (the session-minting endpoint is restricted to 9 real seed phone numbers by design). Each onboarding screen's own code doesn't gate on account completeness, so this produces the real, correct rendering for that screen in isolation — but a couple of things that only make sense in a true first-time sequence (e.g., `/verify-code` showing the phone number it just texted) can't be observed this way, and are noted below.

---

## Stage 1 — Onboarding (in order)

### 1. Philosophy intro — `/philosophy-intro`
**What's on it:** Headline "Meeting people is only the beginning." Three paragraphs of body copy about the uncertainty of new friendship (no assumption of divorce/loneliness/relocation — matches AGENTS.md's documented 2026-07-26 rewrite). One primary button, "Continue" (solid black pill). Below it, a smaller "Skip to home (dev)" link — this is a `__DEV__`-only shortcut, not visible to real users in production.
**How you get there:** The very first screen. `index.tsx`'s session-aware redirect sends any signed-out, or signed-in-but-never-onboarded, user here.
**Live-confirmed:** renders cleanly, zero console errors, exactly matches the documented copy.

### 2. Phone verification — `/phone-verification`
**What's on it:** "What's your number?" heading, one line of body copy, a phone input (not directly inspectable via text dump, but the "Send code" button is present).
**How you get there:** Continue from philosophy-intro.
**Live-confirmed:** renders, no errors. The real SMS-send/OTP flow itself was not exercised (would require a real phone and, per this project's own history, has separately documented Twilio A2P-filtering issues unrelated to this screen's code — see PROGRESS.md's August 6 "phone OTP SMS delivery" investigation).

### 3. Verify code — `/verify-code`
**What's on it:** "Enter the code," a line reading "We texted a 6-digit code to ." (blank), a "Resend code in Ns" countdown, a "Verify" button.
**How you get there:** After phone-verification sends a code.
**Flag, testing artifact not a bug:** the blank space where the phone number should be interpolated is because this screen was hit directly by URL rather than arriving from phone-verification with real navigation params — the phone number is passed as a route param in the real flow, and direct navigation has none to pass. Not evidence of a real bug; just a limitation of how this check was done. Worth a real phone-verification-to-verify-code click-through in a future session if this needs settling definitively.

### 4. Email verification — `/email-verification`
**What's on it:** Back link, "What's your email?", explanatory copy noting it's skippable, "Send link" and "Skip for now."
**How you get there:** After phone verification succeeds.
**Live-confirmed:** renders cleanly. Matches AGENTS.md's documented link-based (not code-entry) design from the 2026-07-25 rebuild.

### 5. Profile basics — `/profile-basics`
**What's on it:** Back link, "A couple of basics," First name and Birthdate inputs, an optional Referral code field with real, current explanatory copy (the 14-distinct-day/30-day mechanic, matching the actual live `referral_reward_qualifies()` logic, not stale wording), a required "I agree to the Terms of Service and Privacy Policy" checkbox, Continue.
**How you get there:** After email verification.
**Live-confirmed:** renders cleanly, all fields present.

### 6. Gender identity — `/gender-identity`
**What's on it:** "Step 1 of 3," "How do you identify?" with 5 options (Woman/Man/Non-binary/Transgender/Queer), explanatory copy, Continue.
**How you get there:** After profile-basics.
**Live-confirmed:** renders correctly. Only step 1 of the 3-step screen was captured in this pass (step 2 is matching preference + age range, step 3 is who-can-message-you-first, per the app's own documented 2026-07-26 restructure) — the screen only renders step 1 on a fresh load since step is local component state, not URL-addressable.

### 7. Social linking — `/social-linking`
**What's on it:** Back link, "Link a social account," explanatory copy, four link buttons (Instagram/Facebook/LinkedIn/Google), "Skip for now."
**How you get there:** After gender-identity's 3 steps.
**Live-confirmed:** renders correctly, all four provider buttons present.

### 8. Profile build — `/profile-build`
**What's on it:** Back link, "Step 1 of 10," a completion percentage ("82% complete" for this already-built-out seed account), Location section (country dropdown, state/city vs. zip toggle, radius, Confirm), Next.
**How you get there:** After social-linking.
**Live-confirmed:** renders correctly with real, already-saved data pre-filled (Denver, Colorado, 30-mile radius) for this seed account — confirms the pagination and per-field autosave from the 2026-07-29 rebuild is genuinely reflecting saved state, not just a fresh blank form.

### 9. Big Five assessment — `/big-five-assessment`
**What's on it:** Back link, "A few quick reflections," explanatory copy ("We'll never show you a score"), "0 of 10 answered" progress line, then all 10 scenario questions with their 5-option scales each (After a full day of social plans / ideal Friday night / follow-through on plans / your approach to your own schedule / a friend going through something hard / when you disagree with someone / when a friend cancels last minute, and 3 more not captured in this pass's truncated dump but confirmed present by the "0 of 10" counter).
**How you get there:** After profile-build.
**Live-confirmed:** all questions and options render, no errors.

### 10. Friendship experience — `/friendship-experience`
**What's on it:** "Your experience with new friendship," 5 real questions (what helped a friendship grow / what happened when a connection faded / how you interpret an awkward first meetup or message / what you do after a good first meetup / which part of building a new friendship feels hardest), each multi-choice, "Answer all to continue."
**How you get there:** Since the 2026-08-08 session, this fires right after Big Five completes, as its own real onboarding screen (moved out of the old post-first-message modal trigger).
**Live-confirmed:** renders correctly, all 5 questions and their full option sets present.

### 11. Etiquette modules — `/etiquette-modules`
**What's on it:** "Module 1 of 1," "Begin With Curiosity" title, a real embedded video player (paused on its own genuine first frame, which is dark/near-black — established as correct, expected behavior in prior sessions, not a rendering bug), a scenario question with two choices, a "Done" button (shown greyed out until a choice is made).
**How you get there:** After friendship-experience.
**⚠️ Flag — this is genuinely different from what every prior session documented, and it's not yet a settled, committed fact.** AGENTS.md and every PROGRESS.md session going back to 2026-07-26 describe **two** mandatory onboarding modules ("Begin With Curiosity" and "How We Show Up"). This screen currently shows only **one**. Root cause, confirmed by reading `modules-data.ts`: `module_show_up`'s `mandatory` flag was changed from `true` to `false` in an **uncommitted, working-tree-only** edit, justified by a comment claiming it was superseded by a contextual video-guidance system (`video-guidance-card.tsx`). That video-guidance system was independently investigated earlier this session and found to be a stale, unverified leftover from an undocumented cutover — it does not correctly implement what it was supposed to (see the meetup-related investigation from earlier tonight). This means the very rationale for demoting `module_show_up` out of mandatory onboarding rests on a component that was just shown not to work. **This is a real, live, uncommitted change to a load-bearing onboarding screen, made on faith in a component that turned out to be broken.** It has not been reverted as part of this doc (this is a documentation-only task), but it should not be treated as decided.

### 12. Readiness commitment — `/readiness-commitment`
**What's on it:** Readiness question copy, "Are you in a place right now where you can do that, even imperfectly?", a "Keeping this community safe" section with real behavioral-tracking-disclosure copy, "Tell me more," "Yes, I'm ready," "I need more time."
**How you get there:** After etiquette-modules.
**Live-confirmed:** renders correctly, matches the documented single-merged-screen design (readiness + behavioral tracking disclosure combined, per the 2026-07-26 rebuild).

### 13. Modules complete — `/modules-complete`
**What's on it:** "You're all set," copy pointing to Guide content, "Take me to the app."
**How you get there:** After readiness-commitment's "Yes, I'm ready."
**Live-confirmed:** renders correctly. From here, `router.replace('/home')` in code, though per the 2026-08-22 landing-tab-default session, a fresh account with zero connections would land on Discover either way, matching intended behavior.

---

**Stage 1 complete: 13/13 onboarding screens live-verified, zero page errors on any of them.** One real, load-bearing finding: etiquette-modules is currently running with only 1 of its historically-2 mandatory modules, due to an uncommitted change resting on a since-disproven assumption.

---

## Stage 2 — Discover, Browse, Saved (and the profile screen they all lead to)

The tab bar itself, confirmed live and consistent across every tab screen: **Discover · Browse · Saved · Inbox · Remember · Profile · Dev** (Dev only shows in `__DEV__` builds, not real production).

### Discover — `/home`
**What's on it:** "Today's suggestions," subtitle, then one card per AI-suggested match: name + age band, a one-line "current situation" fragment in accent orange, distance ("Nearby" or a real mile figure), a full reasoning paragraph (grounded in real shared data: transitions, activities, values, rhythm compatibility), a quoted "In their own words" line from the candidate's own personal statement, then three actions — "Not for me" / "Save" / "Say hello" (the last styled as the solid primary button). Real live test with real seed account (Maria Santos) showed 2 real, grounded suggestions (Elena Torres, Aisha Bello), each with genuinely different, specific reasoning text, not generic copy.
**How you get there:** Default landing tab after onboarding for an account with no active conversations yet (per the 2026-08-22 "landing tab default" session — an account with real active/pending conversations lands on Inbox instead). Also the first tab in the bar at all times.
**Live-confirmed:** renders correctly, zero page errors, real per-candidate reasoning genuinely present (not placeholder text).
**Note:** this account had already dismissed its `tab_discover` coach mark in an earlier session, so the first-time tooltip did not show here — that's expected, not a gap (see the Profile/Settings section below for the "Show tips again" control).

### Browse — `/browse`
**What's on it:** "Browse" header, subtitle, a horizontal row of filter categories (Life transition / Age / Activities / Communication / Meeting frequency / Hangout style / Response time / Ethnicity / Language / Distance), a small pool-size warning ("Only 2 people within this distance right now... increase your search radius"), then a plain card per compatible person (name/age, situation fragment, distance, personal-statement quote, a "Why might we connect?" link, Not for me/Save/Say hello). No AI reasoning paragraph here — matches the documented design intent (Browse is filter-driven, not AI-scored; the "Why might we connect?" link is the separate, on-demand F13 analysis).
**How you get there:** Second tab in the bar, always accessible.
**Live-confirmed:** renders correctly, the radius pool warning genuinely reflects Maria's real small compatible pool (2 people), matching the exact mechanic documented in the 2026-07-26 session.

### Saved — `/saved`
**What's on it:** "Saved" header, one card per saved profile (name/age, situation fragment, personal-statement quote, a "Remove" button). This account had exactly one real saved profile (Aisha Bello).
**How you get there:** Third tab in the bar. Reached by tapping "Save" on a Discover or Browse card.
**Live-confirmed:** renders correctly, "Remove" button present and correctly labeled (not a generic "Delete").

### Candidate profile ("Other User Profile") — `/candidate/[id]`
**What's on it, confirmed via a real candidate id (Elena Torres):** Back, Report, Block (both in the header, always present regardless of connection state), name/age band, location, a "current situation" fragment, personal statement, then the full structured profile in order — Values (chip list), "Into these lately" (every activity category the person selected, each with its own real sub-detail: favorites, skill level, genres, etc.), Hangout style, Communication frequency, Meeting frequency, Response time, Friendship type, Communication style, Languages, Bar preference — then the same Not for me/Save/Say hello action row at the bottom.
**How you get there:** Tapping any candidate card on Discover, Browse, or anywhere else a person is shown (thread header, Inbox row, Remember's People List).
**Live-confirmed:** renders very fully and richly, all real per-account data, zero page errors. This is one of the most complete, correctly-working screens found in this whole pass.

**Stage 2 complete: 4/4 screens live-verified (Discover, Browse, Saved, candidate profile), zero page errors, no dead or broken elements found.** This stage held up cleanly — no surprises.

---

## Stage 3 — Inbox, messaging, and meetups

### Inbox — `/inbox`
**What's on it:** "Inbox" header, a real capacity line ("0 of 4 active conversations"), then one row per conversation: name/age band, a relative timestamp, the situation fragment, a preview of the last message. Sectioning (Awaiting your reply / Paused / Ended / Blocked / Graduated / plain Conversations) is documented elsewhere in this project's history, but not all sections were populated for this test account.
**How you get there:** Fourth tab in the bar.
**Live-confirmed:** renders correctly with real conversation data, zero page errors.

### Thread — `/thread/[id]`
**What's on it, confirmed on a healthy, no-meetup-yet connection (Jordan Blake ↔ Sam Rivera):** header with Back, **End**, Report, **Block** (in red), name, a real response-time line ("...typically replies within a couple of days"); the unified meetup-scheduling bar ("No meetup planned yet" / "Propose a date," a "View meetup history" link below it); date-grouped message bubbles (sent messages dark and right-aligned, received light and left-aligned, exactly as documented); a "Let's plan something" link above the compose row; the compose box itself with Send and "Help me write."
**Also confirmed on a connection with a real, live pending intervention (Aisha Bello ↔ Elena Torres):** the same header/scheduling-bar/message-thread shape, but with three additional real elements stacked above the message list:
1. **A real, live example of tonight's Part 1 work**, genuinely rendering in production data, not just in this session's own isolated test: "Sometimes it takes a few days to reply. This does not necessarily mean anything." — the new 36-hour sender-reassurance line, showing correctly under the recipient's name.
2. **The unified scheduling bar showing a confirmed date** ("Next meetup: August 18, 2026," "Reschedule"), with a video-guide offer directly beneath it ("First meetup coming up? A short guide if it helps. Watch / Not now"). **Live-clicked the "Watch" link and confirmed it genuinely works**: navigates to `/guide/guide_meetup_anxiety`, a real, correctly-titled guide screen ("The First Meetup Does Not Need to Be Perfect"). This is a different piece of code from the broken `PreMeetupSupport` video offer investigated earlier tonight — this one lives inside the already-committed `next-meetup-indicator-v2.tsx`, not the uncommitted `video-guidance-card.tsx`, and it works correctly. **Worth being precise about: the uncommitted "video architecture" work is not uniformly broken — this specific piece (Video 3) functions correctly; the day-of feeling check (`PreMeetupSupport`, investigated earlier tonight) does not.** The underlying `coach_marks_seen` infrastructure the video system depends on for seen-tracking is genuinely live in the database (confirmed via `pg_get_constraintdef` — all 6 `video_*` keys are present in the real, applied CHECK constraint), even though the migration file that added them was never committed to git.
3. **A "Did you meet with Elena Torres?" occurrence-check card with plain Yes/No buttons — missing the date framing Part 3 was built to add.** Part 3's own rebuild threads a real `confirmed_date` into the question ("Did you meet {name} on {date}?"). This live card shows no date at all. Investigated at the database layer: this specific pending row's payload is `{"meetup_id": "..."}` with no `confirmed_date` key, because it was created before Part 3's migration added that field to `raise_intervention`'s payload. **This is not a crash or a broken render** — the component degrades gracefully to the date-less question — but it's a real, honest example of Part 3's improvement not reaching data that already existed before it shipped, worth knowing if this exact card is ever used as a "does Part 3 work" reference point.
**How you get there:** Tapping any conversation row in Inbox, or a "Say hello"/message action from Discover, Browse, or a candidate profile.
**Live-confirmed, both variants:** zero page errors on either.

### Meetup history — `/meetup-history/[connectionId]`
**What's on it:** Back, "Meetup history," and — for the connection checked (0 real confirmed meetups) — a clean, correctly-worded empty state: "No confirmed meetups yet. Once you both agree a meetup happened, it'll show up here."
**How you get there:** The "View meetup history" link on the thread screen's scheduling bar.
**Live-confirmed:** renders correctly. **Honest caveat:** every real seed-account connection in the current live database has `meetup_count = 0` right now (checked directly), so this doc could only confirm the empty state, not the populated view (which would need a real mutual meetup-occurrence confirmation to produce, a multi-step flow that wasn't re-run in this documentation-only pass). The populated view's mechanics were verified live in a prior session (2026-08-06, "Graduation foundation"); this pass only confirms the empty state is what a real account sees today.

**Stage 3 complete: 4/4 screens/states live-verified.** One real, load-bearing finding worth restating: the recently-committed Part 1 (sender reassurance) and Part 2 (unified scheduling) are genuinely live and correct in production data, not just in isolated tests. The uncommitted video-guidance work is a mixed bag, not uniformly broken — Video 3 (first-meetup-coming-up) works; the day-of feeling check does not. And one pre-Part-3 pending row shows the graceful-but-real gap in the new confirmed_date field for data that predates the fix.

---

## Stage 4 — Remember and Guide

### Remember — `/remember`
**What's on it:** "Remember" header, and — for the account checked — a clean, correctly-worded empty state: "Once you've met up with someone, or written a note about them, they'll show up here."
**How you get there:** Fifth tab in the bar.
**Live-confirmed:** renders correctly. **Same honest caveat as meetup-history above:** no real seed account currently has a confirmed meetup or a written note, so this doc could only confirm the empty state, not the populated People List/Timeline. Those were verified live in the 2026-07-27 "Remember" build session and are unlikely to have regressed (no code in this area was touched by tonight's uncommitted work), but that's an inference, not a fresh confirmation.

### Guides list — `/guides`
**What's on it:** Back, "Guides," subtitle, then 16 real entries in order: Begin With Curiosity **(Onboarding)**, How We Show Up, The First Meetup Does Not Need to Be Perfect, Friendship Grows a Little at a Time, It's Okay to Pick It Back Up, When Something Feels Off: Ask, Repair, and Give It Room, When a Friendship Changes or Ends, then the 9 older text-only modules (The rhythm of messaging / When friendship gets hard / The honest exit / Curiosity and care / What friendship actually looks like / Early friendship fragility / How to write an honest profile / Understanding your social patterns / Everyday friendship).
**How you get there:** A "Guide" link from the Profile tab.
**⚠️ Cross-confirms the Stage 1 finding, independently, from a second screen.** The "(Onboarding)" tag is driven directly by each module's `mandatory` flag. It shows next to "Begin With Curiosity" and, correctly per the code's *current* (uncommitted) state, does **not** show next to "How We Show Up" — because that flag was flipped to `false` in the same uncommitted edit flagged in Stage 1. This isn't a second bug; it's the same one, now visible on two different screens, which is worth knowing if anyone spot-checks Guides and assumes "How We Show Up" was never supposed to be mandatory.
**Live-confirmed:** renders correctly otherwise, zero page errors, all 16 titles and descriptions present and legible.

### Guide detail — `/guide/[id]`
**Checked 5 of the 7 real guide-video entries:**
- `guide/module_curiosity` ("Begin With Curiosity") — real content, correct description text.
- `guide/guide_meetup_anxiety` ("The First Meetup Does Not Need to Be Perfect") — real content, correct description.
- `guide/video_ending` ("When a Friendship Changes or Ends") — real title/description, body correctly shows "video coming soon" (no real video file exists for this one yet, matching this app's own established placeholder convention, not a bug).
- `guide/video_something_off` ("When Something Feels Off: Ask, Repair, and Give It Room") — same, correct placeholder state.
- `guide/video_restart` ("It's Okay to Pick It Back Up") — same, correct placeholder state.
**How you get there:** Tapping any entry in the Guides list, or a contextual "Watch" link elsewhere in the app (see Stage 3's Video 3 example).
**Live-confirmed:** all 5 render cleanly, zero page errors on any of them, correct real-vs-placeholder video state in every case.

### Module detail (the older, onboarding-style flow) — `/module/[id]`
**What's on it, confirmed on `module_1`:** Back, title, "Video coming soon" placeholder, body copy, a scenario question with two choices, "Done" (greyed until answered). This is the pre-video-architecture module screen (quiz format), structurally distinct from `/guide/[id]` (built later, video-only, no quiz) — confirmed both exist and both work, serving genuinely different modules.
**How you get there:** Tapping a Guides-list entry that isn't one of the video-bearing ones, or the mandatory-modules screen during onboarding.
**Live-confirmed:** renders correctly, zero page errors.

**Stage 4 complete: 8 screens/detail-pages live-verified across Remember and Guide, zero page errors on any of them.** No new bugs found here — the one finding (the missing "(Onboarding)" tag) is the same Stage 1 issue surfacing on a second screen, not a separate defect.

---

## Stage 5 — Profile, Settings, Premium, and the Dev tab

### Profile — `/profile`
**What's on it:** Name/age, a real completion percentage ("94% complete"), an Edit link, then the full self-view of every profile field in order: Location, "What brings you here" (life transitions), About you, Values, Activity interests (each category with its own real sub-detail), Hangout style, Check-in frequency, Meeting frequency, Response time, Friendship type, Communication style, Languages, Bar preference, then "View my personality reflection," "Settings," and "Guide" links.
**How you get there:** Sixth tab in the bar.
**Live-confirmed:** renders correctly, real complete data, zero page errors.

### Settings — `/settings`
**What's on it, section by section:** ACCOUNT (Edit profile, Preview my public profile — both real, chevron-style navigation rows) · PREMIUM (current tier "Free," a "See Premium" link) · INVITE A FRIEND (a real referral code, "W67BE7TU," with correct, current explanatory copy matching the live 14-distinct-day mechanic) · NOTIFICATIONS (an honest placeholder: "Limen doesn't send push or email notifications yet, so there's nothing to configure here") · HELP ("Show tips again," with copy explaining what it resets) · PRIVACY & SAFETY (Blocked accounts — "You haven't blocked anyone," Reports you've filed — "You haven't filed any reports") · LEGAL (Terms of Service, Privacy Policy links) · ACCOUNT DELETION ("Delete my account").
**How you get there:** A "Settings" link from the Profile tab.
**Live-confirmed:** renders correctly in full, every section present, zero page errors. This is one of the more complete, well-organized screens in the app — every documented Settings feature from prior sessions (referral, blocked-accounts, reports-filed, terms/privacy, deletion) is genuinely present, not just claimed.

### Premium — `/premium`
**What's on it:** "Premium," the real price ("$5.99/month"), an explicit "nothing about who you're shown changes" line, a comparison table (AI match suggestions per day: 2 vs. 5, Active conversations: 4 vs. 8, Pending Say Hi messages: 5 vs. 8), a repeated "compatibility ranking never changes" disclaimer, "Subscribe for $5.99/month," "Restore purchase."
**How you get there:** "See Premium" from Settings, or any of the app's real "Upgrade to Premium" links on a blocked-AI-cap surface.
**Live-confirmed:** renders correctly, real numbers matching the documented capacity system exactly.
**Minor cosmetic nit, not functional:** the "Premium" column header in the comparison table wraps awkwardly onto two lines ("Premiu"/"m") at this viewport width — visually untidy, doesn't affect readability of the actual numbers next to it, not a functional bug.

### Terms — `/terms` and Privacy — `/privacy`
**What's on both:** Back, title, an explicit, honest placeholder disclaimer ("This is placeholder text. Final Terms of Service are forthcoming...") followed by a short real paragraph of interim substantive content (what the app actually asks of members / what it actually collects).
**How you get there:** Links from Settings' Legal section, and a required checkbox on profile-basics during onboarding.
**Live-confirmed:** both render correctly, exactly matching the documented "clearly marked placeholder, not real legal text" state — nothing pretends to be finished legal copy that isn't.

### Public Profile Review — `/profile-review`
**What's on it:** A "PREVIEW" label, an explicit sentence framing it ("This is exactly what another compatible member sees when they open your profile"), then the same full field layout as the candidate-profile screen (Stage 2), populated with the signed-in user's own real data.
**How you get there:** "Preview my public profile" from Settings.
**Live-confirmed:** renders correctly, real data, zero page errors. No Report/Block on this screen (correct — there's nothing to report/block on your own profile).

### Dev — `/dev`
**What's on it:** the full internal testing console — a seed-account switcher (9 real accounts as buttons), a "Quick Tests" panel (one-tap end-to-end checks for no-ghost, meetup check-in, meetup confirmation + graduation, and coach marks), "Reset my matches" / "Reset ALL seed accounts," a "No-ghost testing" section (force-fire R1/R2/R3/S1, preview sender reassurance), F19 follow-up-reflection testing, and meetup-milestone testing (backdate + run the checkin evaluator).
**How you get there:** Seventh tab in the bar, **`__DEV__`-only — never shown to a real production user.**
**⚠️ Known, already-investigated issue, not re-litigated here:** this screen's own seed-account sign-in buttons are confirmed unreliable in this environment (a rare, non-deterministic `react-native-web`/React 19 gesture-responder compatibility issue, root-caused at length in the 2026-08-23 session — see that entry in PROGRESS.md for the full investigation). This doc's own live checks all used the established session-injection workaround instead of clicking these buttons, for exactly that reason. The screen itself renders correctly and its content is accurately described above; only its own sign-in buttons are the known-flaky part.

**Stage 5 complete: 7/7 screens live-verified, zero page errors on any of them.** Everything here matches what prior sessions documented as built — no new gaps found, aside from one cosmetic text-wrap nit on Premium.

---

## Summary

**32 real screens/states checked across 5 stages** (13 onboarding, 4 in Discover/Browse/Saved, 4 in Inbox/messaging/meetups, 8 in Remember/Guide, 7 in Profile/Settings/Premium/Dev), every one visited live with a real, session-injected seed account. **Zero page-crashing errors found anywhere.** The app's core, committed functionality — onboarding, matching, messaging, the Part 1/2/3 work committed earlier tonight — is genuinely solid and live, not just claimed.

**Two real findings, both already flagged inline, repeated here for visibility:**
1. **`/etiquette-modules` and `/guides` both currently reflect an uncommitted change** (`module_show_up`'s `mandatory` flag flipped to `false`) that rests on the same broken `video-guidance-card.tsx` system already identified as non-functional earlier tonight. This has real consequences for a genuinely fresh user's onboarding (they'd now see only 1 mandatory module instead of the documented 2). Not reverted here — this is a documentation-only pass — but it should not be treated as a settled, intentional product decision.
2. **The uncommitted "video architecture" work is a mixed bag, not uniformly broken.** Video 3 (first-meetup-coming-up, inside the already-committed `next-meetup-indicator-v2.tsx`) genuinely works and links correctly. The day-of feeling check (`PreMeetupSupport`) does not do what it's supposed to. Three of the six new guide entries (`video_restart`, `video_something_off`, `video_ending`) correctly show "video coming soon," matching that no real video file exists for them yet — not a bug, just incomplete content.

No code was changed to produce this document.
