# Build progress (recent)

Add a short dated entry at the end of this file every session. Older entries (July to early October 2026) are in docs/archive/PROGRESS_HISTORY.md. This file is not auto-loaded, so keep entries short.

## SESSION LOG

### Session, October 8-9, 2026 (meetup plans, reminder/Test-tab rebuild, testing fixes)

Verified on a full local copy (real Postgres with every migration, PostgREST, a small auth stand-in, the exported web app, Playwright). Suites: qa-oct9 37/37, qa-noghost 33/33, qa-meetups 54/54, qa-mochi 6/6, qa-testtab 27/27.

**Oct 8 (commits bc4e17f, d6cfd01, 159a0cb):** meetup plans with time/place/activity, moving plans with re-confirm, day-before "Still on?", morning-of support, "Did you meet?", no-show; first + last name (shown as "Maria S."); phone date/time pickers; live plan updates; reminder cards that can actually be put away (`dismiss_intervention`, `raise_intervention_once`); meetup prompts outrank reply reminders; repeat "more time?" question removed; meetup history rebuilt; Test tab rebuilt and `dev_*` functions locked behind `is_test_operator()` wrappers. Migrations 20261008000000/1/2.

**Oct 9 (migration `20261009000000_places_pace_profiles.sql`):**
- Test banner swallowed taps on Back/Report/Block: react-native-web drops a `pointerEvents: 'box-none'` *style*; must be the prop. Same fix in `spotlight-host.tsx`.
- `goBack(fallback)` (`src/lib/navigation.ts`) replaces bare `router.back()` everywhere; dead-end "not available" screens got a Go back link.
- Inbox: a chat blocked by the other person shows "Not available" under "Closed", never "Blocked" (only the blocker sees Blocked).
- `connected_profiles` view: a past chat's profile opens even if it no longer matches search filters; past ended/inactive chats show "Say hello again" (the old Interested rows made the button look already done).
- Place search via Photon/OpenStreetMap (no key), saves name/address/position; plan card shows address plus Google Maps / Apple Maps links; calendar invite includes the address.
- Changing only "what you'll do" no longer counts as moving the plan (`update_meetup_activity`).
- Meeting pace in the chat (`get_pace_summary`): you see your own; "You both said ..." only when both picked the same. The other person's different answer is never returned.
- `limen_db_version()` + Test tab notice listing the migrations to run when the database is behind.

**Open:** the "First Meetup Does Not Need to Be Perfect" video is also offered on the morning of later meetups; its content/title should be made general (founder decision). Batch 2 items (capacity copy, mutual-match nudge/auto-close, pause rules) not started.

### Session, October 9, 2026 (2): reconnecting, capacity wording, no-hello matches, pause rules, cleanup

Migration `20261009000001_reconnect_hello_pause.sql` (bumps `limen_db_version()` to `20261009000001`). Verified on the local full copy: qa-oct9 37/37, qa-oct9b (new) 55/55, qa-noghost 33/33, qa-meetups 54/54, qa-mochi 6/6, qa-testtab 27/27.

- **Reconnecting:** `express_interest` skips the selfie requirement when the two people already have a chat with messages (`users_have_chatted`). Someone new still needs the selfie check.
- **Capacity:** one shared `connection_counts()` used by `my_connection_capacity`, `create_connection_with_capacity_check` and `reinitiate_ended_connection` (the last one used to count graduated chats). Reopening a closed chat now respects the 3-active limit. Inbox: "N of 3 active conversations · room for N more", a calm explanation at the limit, and "N of 5 hellos waiting for a reply". Error copy rewritten. "click with" → "connect with".
- **No-hello matches:** `connections.opened_at` (fresh on every reopen). From 2 days the chat and Inbox suggest a short hello and show the close date; at 14 days with no message the sweep closes the match quietly (`run_say_hello_check_all`). Client-side nudge only, there is still no push.
- **Pause rules:** always an end date (3 days, 1 week, 2 weeks; max 14 days enforced in SQL), both people see who paused and until when (`get_pause_details`), no messages from either person while paused (messages RLS), only the pauser can resume early, the other person can end, at most 2 pauses per person per chat in 30 days. Header is now Pause · End · Report · Block. `connections.resumed_at` makes reply reminders and restart prompts count from the end of a pause (before, a 2-week pause could auto-close the chat the moment it ended). Old open-ended pauses end 2 weeks after they started. Old `pause_connection`/`resume_connection` are no longer callable by the app.
- **Test tab:** "Match with no hello yet" (3 / 14 days old) and "End the pause now".
- **Cleanup (no live feature removed):** deleted the retired pre-August chat cards and their state from `thread/[id].tsx` (the `NEW_SYSTEM_LIVE = false` branch, about 500 lines), 10 unused components (old no-ghost/check-in/outcome/confirmation/suggestion/next-meetup/feeling cards, reply-assist panel, graduation modal), `module-gate.ts`, `meetup-suggestion.ts`, `follow-up-reflection.ts`, unused functions in `meetup-milestones.ts`, `no-ghost.ts`, `graduation.ts`, dead AI-credit purchase code on Discover, and unused imports. "Let's plan something" no longer writes the retired `connections.next_meetup_*` columns. The chat header's "Met N times" line (read a retired table, always empty) is gone; the plan card already shows it. Database tables of the retired system were left in place (not dropped).

### Session, October 9, 2026 (3): pause note, selfie once, fill-to-limit tool, account-switch fix

Migration `20261009000002_pause_note_selfie_once_fill_chats.sql` (bumps `limen_db_version()` to `20261009000002`). Verified locally: qa-oct9c (new) 17/17, qa-oct9b 62/62, qa-noghost 34/34, qa-oct9 37/37, qa-mochi 6/6, qa-testtab 27/27 (one flaky step on some runs, "Make both Interested", passed on rerun). qa-meetups' morning-of steps only fail before 5am, as designed.

- **"Conversation isn't available" after switching accounts:** the tab screens stayed mounted with the previous account's chats for a moment after Act as / Back to my account, so a tap could open a chat the new account isn't in. `useAccountKey()` (`src/lib/account-key.ts`) keys the tab bar by account, so every tab starts fresh. Confirmed: with the key removed, the stale chats were present right after a switch; with it, they weren't.
- **Pause needs a note:** `pause_connection_with_duration(conn, until, message)`; the old two-argument version is dropped. The note is inserted as a message, then the chat pauses, in one step. Refuses an empty note, over 1,000 characters, or a chat with no messages yet. `PauseForm` (`pause-connection-modal.tsx`) is used by both the header Pause and the reminder card's "I need more time": length choice, three starters, own words required (`StemMessageBox`, whose `onSend` may now return an error message).
- **Selfie check once:** `selfie_check_done(user)` = approved, or a sent selfie waiting for review. Used by `express_interest`, the first-message rule in the messages policy, and the chat screen. Selfie page says "You only do this once...". Rejected asks again. Badge unchanged.
- **Test tab, "Fill my chats to the limit":** `test_fill_my_chats()` gives the test account you're acting as two-sided chats with other test accounts until it has 3 active. Refuses on a real account.
- **Follow-up:** the file names in the Test tab's "database needs an update" box didn't open when tapped. On the web they are now plain browser links (open in a new tab). Checked locally: 6 links, clicking one opens the file.

### Session, October 9, 2026 (4): only an approved selfie counts

Migration `20261009000003_selfie_approved_only.sql` (bumps `limen_db_version()` to `20261009000003`). Founder's call: keep the safety step, so a selfie that is only waiting for review no longer counts. `selfie_check_done()` is approved-only; `express_interest` returns `selfie_pending` while one waits, and Discover/profile show "Your selfie is waiting for our review..." instead of reopening the selfie page. A chat with no messages yet says the same, with "See my selfie check". Selfie page: "You only do this once for your account. Until it's approved...". Still account level, and reconnecting with someone you already talked to needs no selfie. Verified locally: qa-oct9c 20/20 (rewritten for this), qa-oct9b 62/62, qa-oct9 37/37, qa-testtab 27/27.

### Session, October 9, 2026 (5): "Let's plan something" rebuilt as a shared planning card

Migration `20261009000004_plan_together.sql` (bumps `limen_db_version()` to `20261009000004`), new server function `supabase/functions/plan-ideas` (must be deployed from the Supabase dashboard; until then the app uses hand-written safe ideas). The old ideas pop-up (`activity-suggestions-modal.tsx`) is deleted; it sent a message without the idea in it.

- **The card:** tapping "Let's plan something" opens one card both people see (a short summary in the chat, the full card as a sheet). Three steps: What (3 ideas plus own ideas; each marks any number; both see each other's marks; an idea both marked can be chosen; with no overlap: try their idea, ask in the chat with a starter they finish themselves, or new ideas), When (rough times over the next 2 weeks; "Use my usual times" fills from the profile's availability; shared times are highlighted and one is chosen), Where (the plan editor opens with the day, a start time for that part of the day and the idea filled in; the other person confirms in the plan card). The card disappears once a plan is proposed and ends when it's confirmed.
- **Endings:** "Not now" (both see "No plan for now. Start again anytime."), or 14 days with nobody touching it (from 3 quiet days the card and Inbox show the close date). An ended chat closes its card. 10 new sets of ideas per card, with a countdown.
- **Questions:** budget / length / travel asked the first time someone taps "Let's plan something" (only of that person, skippable, changeable via "My limits"); ideas use the stricter answer of the two and never say whose. After a first meetup: a private per-friendship home question ("Not yet" / happy to host / happy to go to theirs). A home idea appears only when one can host and the other can visit; a home idea added before the first meetup gets a gentle note.
- **Safety:** the server function's prompt plus word filters drop anything romantic, adult, risky or drinking-focused, and any home idea nobody agreed to; the database drops home ideas again on save. Ideas never repeat past meetups or earlier ideas on the card. Idea headings never claim a shared interest that isn't there ("David likes golf" / "An idea for you two").
- **Inbox:** "Planning together: your turn" / "Planning together · closes Oct 23". **Test tab:** "Planning together: make it 3 / 14 days quiet".
- Verified locally: qa-plan (new) 52/52, qa-oct9 37/37. Not checked locally: the AI ideas themselves (the local copy has no server functions; the hand-written fallback path was tested).

### Session, October 9, 2026 (6): planning card, Save my picks and matching

Migration `20261009000005_plan_save_and_match.sql` (bumps `limen_db_version()` to `20261009000005`). The `plan-ideas` server function changed too and needs redeploying (paste the new file in the Supabase dashboard).

- **Save my picks:** marks are a private draft (`plan_picks`, now own-row only). "Save my picks" copies them to `plan_saved_picks`; the other person only ever sees saved picks, and an idea someone added only once it's saved. "Edit my picks" and Cancel (`plan_revert_picks`). Cards already open keep their earlier marks as saved.
- **Shown openly after saving** (founder's call): the second person sees the first person's picks first, labelled "Maria picked this", with "Pick any you'd enjoy, theirs or others."
- **Match:** an idea in both saved picks. Both see "You both picked: ..." and each other's other picks. Either person can choose it (`plan_choose_idea` now needs both saved picks). The second saver gets an optional "Send a note" with starters ("We both picked "X"!", ""X" sounds good to me because", "Which one sounds best to you?") they finish themselves.
- **No match:** both lists, "No match yet. That's common. Different tastes are part of getting to know someone.", and equal options: look at their picks again ("open to it is enough"), ask in the chat, add your own or see new ideas. After 2 no-match saves (`plan_boards.no_match_rounds`) the card suggests coffee or a walk, with a one-tap "Add coffee and a walk to my picks".
- **Chat keeps the card open:** a new message trigger moves the card's last activity, so it doesn't close or say "closes on" while people are talking.
- **Inbox:** `my_plan_turns()` returns a stage: your turn to pick / waiting for their picks / you matched, suggest one (or talk it over) / no match yet / mark when you are free.
- **Idea heading fix:** the AI now returns which listed interest an idea is built on; the server writes "You both like X" or "David likes X" only from a real listed interest (no more "You both like fitness" over a pickleball idea).
- Starters wrap instead of running off the screen.
- Verified locally: 29 database checks (drafts private, added ideas hidden until saved, matching, rounds, revert, chosen idea let go when unpicked, saved picks kept on new ideas, chat keeps the card open, outsiders see nothing), the update re-run twice and on a card with older marks, and the on-screen suites: qa-plan 77/77 (rewritten for Save, match, note, no match, look again, simple suggestion), qa-oct9 37/37, qa-oct9b 62/62, qa-oct9c 20/20, qa-meetups 54/54, qa-noghost 34/34, qa-mochi 6/6, qa-testtab 27/27. Not checked locally: the real AI ideas (the local copy has no server functions).

### Session, October 9, 2026 (7): planning card in fewer turns, nudges to meet in person

Migration `20261009000006_plan_one_turn_meet_nudges.sql` (bumps `limen_db_version()` to `20261009000006`). No server function changes.

- **Why:** the card passed back and forth 3 times (picks, then times, then confirm), asked for the time twice, and at a match asked the second person to both send a note and tap "Go with" with no clear order.
- **One turn = ideas and times:** `plan_times` is now a private draft like picks; `plan_save_picks` also copies times to the new `plan_saved_times`, and `plan_revert_picks` restores both. `get_plan_board` returns `my_saved_times`, the other person's saved times only, and `other_usual` (their profile availability). The person's own usual times start filled in. Button: "Save and send to {name}" / "Send my changes".
- **Match = idea + time:** the person who sent second gets "Suggest this plan" (the first can step in), which opens the plan editor filled in. An optional note (starters, own words required) shows in the editor and is sent only after the plan is sent. Same idea, no shared time: "Mark more times" or ask in the chat. Inbox stages: pick, waiting, matched, no_time, no_match. The old choose-idea / choose-time steps are gone; open cards had any old chosen idea cleared and their marked times kept as sent.
- **Help talking:** "Not sure? Ask {name} in the chat" while picking; "Send {name} a short note" after 3 days of waiting.
- **Limits:** one short optional step ("So ideas fit you (optional)", Show ideas / Skip).
- **Home ideas:** `plan_add_own_idea` refuses a home idea before the first meetup (`home_first_meetup`); the app explains and turns Add off.
- **Meet in person:** every chat shows "Limen is for meeting in person. Chatting is how you get there." `get_meet_nudge` / `answer_meet_nudge` / `meet_nudges` (own-row only) give a private card after ~3 weeks of two-sided talking with no meetup and nothing being planned (Not yet asks again in 3 weeks), and honest checks at ~2 and ~6 months (plan / keep chatting / End kindly, once each). `_talking_days` leaves out paused time. Nothing closes on its own. Test tab: "Talking 3 weeks / 2 months / 6 months" (`test_talking_age`, moves the chat's messages back and sets `resumed_at` so reply reminders don't fire).
- Verified locally: 33 database checks, re-run of the migration on an open card, qa-plan 82/82 (rewritten), qa-meet (new) 24/24, qa-oct9 37/37, qa-oct9b 62/62, qa-oct9c 20/20, qa-meetups 54/54, qa-noghost 34/34, qa-mochi 6/6, qa-testtab 27/27, screenshots checked.

### Session, October 10, 2026: planning by invite, counting every meetup, calendar question

Migration `20261010000000_plan_invites_meetup_tracking.sql` (bumps `limen_db_version()` to `20261010000000`). No server function changes.

- **Why:** passing the planning card back and forth was still clumsy. The founder asked for one invite the first person sends into the chat, with the other person replying in the chat. The open problem was keeping track of every in-person meetup (first, second, and so on) once planning happens in the chat.
- **Invite:** "Let's plan something" is now a private draft (picks and times were already private): ideas, any number of rough times, a clear box saying when the other person is usually free (and an orange outline on those times), then "Next: add a note" (optional, starters must be finished in own words) and "Send invite". `send_plan_invite` writes one `plan_invite` message (the person's note first, then plain lists; no app wording) and a `plan_invites` row, and closes the card (`close_reason = 'invited'`). A newer invite replaces an older one. Someone else's draft is never shown. Inbox: "Your invite to meet is not sent yet" (`my_plan_turns` stage `drafting`).
- **Replying:** the invite renders as a card in the chat (`plan-invite.tsx`). The other person replies in the chat or taps "Pick a time that works" (idea + time), and the plan editor opens filled in. `accept_plan_invite`: a day and part of the day the sender offered sets the plan right away (sender counted as proposer); anything else goes to the sender to confirm. The sender has "Agreed on something in the chat? Set the plan". The old save/match/"Suggest this plan" flow is gone from the app (database functions left in place, unused).
- **Calendar:** once a plan is agreed, each person sees "You're both set. Add it to your calendar?" (Google / Apple or Outlook / Not now) on the plan card, and "The plan changed. Update your calendar?" whenever the date, time, place or activity changes (`meetup_calendar_asks`, own rows only).
- **Counting meetups:** "Did you meet?" still asks both people after each plan, once. One yes plus a week with no answer from the other now counts (before, it never counted). A no from either doesn't count. Nobody answering for 2 weeks lets it go, so a chat isn't stuck. "Met up already? Add it" on the plan card and "We've already met" on nudge cards (`log_past_meetup`) add a meetup made outside the app. The other person sees "X added a meetup: you two met on ... Is that right?", and it counts on their yes (or after a week). Added meetups never get the day-before or morning-of cards (`meetups.logged_after`).
- **Nudges after meeting:** the 3 weeks / 2 months / 6 months cards now start over from the last meetup ("It's been a few weeks since you and X last met..."). Answers belong to one round (`meet_nudges.anchor`). Hidden while anything is being planned, an invite is open (14 days), or a meetup is waiting for "Did you meet?". Test tab buttons renamed "3 weeks / 2 months / 6 months"; for chats that have met they move the last meetup back.
- `DateField` gained `max`.
- Verified locally: 44 database checks (invites, private drafts, accept offered vs not offered, replaced invites, outsiders, calendar-ask privacy, added meetups, one-answer counting, a no not counting, nudge rounds, no-answer timeout), migration re-run safely, and on-screen suites qa-plan 70/70 (rewritten for invites), qa-meet 36/36 (added: "We've already met", confirm, nudges after meeting), qa-oct9 37/37, qa-oct9b 62/62, qa-oct9c 20/20, qa-meetups 54/54 (one copy check updated), qa-noghost 34/34, qa-mochi 6/6, qa-testtab 27/27. Screenshots checked (picker, invite, picking a time, calendar question).

### Session, October 10, 2026 (2): quieter reminders, check-ins, reminder settings, phone layout, safety tips

Migration `20261010000001_quieter_reminders_check_ins.sql` (bumps `limen_db_version()` to `20261010000001`). No server function changes.

- **Why (from the chat/Inbox review):** a chat that ended naturally ("good night!") was treated like an unanswered message: reminders at 1, 3 and 5 days, then the chat closed itself after a week, even for friends with a meetup planned (tested: 4 cards, then closed, messaging locked). On a phone the cards above the chat hid the whole conversation. Three different "meet again" cards overlapped. The app never reads messages; everything below uses timing only.
- **Getting started only:** `run_no_ghost_check_v2` now does nothing once both people have written (`_both_have_written`, since the chat last reopened) and puts away any old reply reminders. While only one person has written: one note to the other person at their own stated pace (1, 2 or 3 days), "It's been quiet since your hello" for the writer at 5 days, quiet close at 7 days. R2/R3 retired. New copy: "X said hello and hasn't heard back yet." (Reply / Later / Not for me). The 36h "few days" line also shows only while getting started. Inbox: "New hellos".
- **Check-in:** `run_conversation_restart_check_v2` (same `conversation_restart_prompt` row): both wrote, 5 quiet days, no plan set, once per quiet stretch, skipped for anyone who turned it off. Card: "It's been quiet with X for a bit. That's normal. If you'd like, say hi or see how they're doing." (Say hi with starters / Not now / Turn off check-ins for this chat).
- **Meet nudges:** `get_meet_nudge` respects the off switch; after meeting, the first nudge follows the person's own pace if they picked one. `run_rhythm_reminder_check` removed from the sweep and its card retired (pace still set in the plan card).
- **Settings:** `prompt_settings` (own rows only), `get_prompt_settings`, `set_prompt_setting`, `prompt_enabled`. Check-ins, meet nudges, morning-of check, calendar question, short guides; off for all chats (Settings, "Reminders and nudges") or one chat ("Reminders" under the messages, or a card's own link). The getting-started note can't be turned off. `get_active_intervention` skips the morning-of card when it's off.
- **Phone layout:** the plan card is a slim bar (tap to open, Hide to close) that shows what needs attention ("Add it to your calendar?", "Does it work for you?"). Prompt cards, the planning card and nudges sit under the newest message; the list stays scrolled to the bottom unless the person scrolled up. "Let's plan something" hidden while a plan exists.
- **After a good meetup:** "Would you like to tell X how it was for you? Only if you want to." (Tell X / Plan another meetup / Not now). Removed "Friendships grow fastest when...". Fixed "That's normal after a first meetup" showing after any meetup.
- **Safety:** `safety-tips.tsx`: a calm "Safety tips" sheet (public place, own way home, keep it short if you like, share your location with a friend from your phone if you want, trust how you feel, Report/Block, 911) linked from the plan card and editor before a first meetup and from the morning-of card. A gentle note in the editor when a first meetup's place sounds like a home. No "share my plan" feature (founder: adults decide).
- **Inbox:** `my_plan_turns` adds `invite_sent` / `invite_received`, so invites to meet show on the chat row.
- **Test tab:** "Quiet chat" (was "No-reply reminders") runs both checks and explains which kind of chat it is.
- Verified locally: 33 database checks (`remsql.sql`), migration re-run safely, on-screen suites qa-remind (new) 42/42, qa-noghost (rewritten) 30/30, qa-meetups 54/54, qa-plan 70/70, qa-oct9 37/37, qa-oct9b 62/62, qa-mochi 6/6, qa-meet 36/36, qa-oct9c 20/20, qa-testtab 27/27. Test helper `go()` now opens the plan bar automatically. Phone screenshots checked (390x844: plan bar, newest message and check-in all in view; safety tips; home note).
- **Not changed (still open, needs founder decision):** a meetup someone adds ("Met up already? Add it") still counts after a week without the other person's yes. The morning-of video's title/content is still first-meetup specific.

### Session, October 10, 2026 (3): "Remind me later" after a good meetup

Migration `20261010000002_share_reminder.sql` (bumps `limen_db_version()` to `20261010000002`). No server function changes.

- **What:** the after-a-good-meetup card ("Would you like to tell X how it was for you?") now also offers "Remind me later": Tomorrow / In 3 days / In a week, or Back. It confirms the day ("On Tuesday, Oct 13, this chat will ask again... Only you'll see it."). On that day the card comes back once: "You asked to be reminded. Would you like to tell X how your meetup on ... was for you? Only if you want to. If you already have, you can close this." (Tell X with starters / Remind me later / Not now).
- **How it fits with other reminders:** it's a `share_reminder` row (`snoozed` until due). `get_active_intervention` wakes it and ranks it with "Did you meet?" and "How did it go?", so only one card shows at a time and it never stacks with the check-in or a meet nudge. A new reminder replaces an older one in that chat. It isn't skipped when the person has messaged since (the app can't tell what was said, and it's their own reminder); the card says they can close it if they already did. Ending, blocking or closing the chat drops it (`clear_interventions_on_connection_closed` now also clears waiting share reminders).
- **Test tab:** Meetups panel "Reminder due now" (`test_share_reminder_now`, acts on the account you're acting as).
- Verified locally: qa-share (new) 21/21, qa-remind 42/42, qa-meetups 54/54, qa-testtab 27/27, qa-noghost 30/30.
- **Founder decisions (Oct 9 evening):** a meetup added with "Met up already? Add it" keeps counting after a week without the other person's yes (kept as is, decided). The morning-of video "The First Meetup Does Not Need to Be Perfect" (also offered before later meetups) waits for now; a reminder is scheduled for Oct 17.

### Session, October 10, 2026 (4): Remember review, decisions only

No app code changed. Set up the local test copy on a new workspace (needed `npm ci` at the repo root before `qa/build.sh`; added to qa/README.md) and tried Remember as Aisha after one meetup with David: the tab, the per-person page, writing a note, both AI buttons (they fall back to an error locally, as expected), and the "Before you plan something" pop-up.

Confirmed the handoff: Remember works, but both AI buttons still show "buy 50 credits" / "Upgrade to Premium" when a cap is hit, and nothing links from a chat to that person's notes. Also found: the note date is typed as YYYY-MM-DD instead of the date picker; the first "Let's plan something" tap shows the first-meetup feelings pop-up even when the two already met.

Founder decided (docs/DECISIONS.md section 9): Remember moves into the chat as a "What I want to remember about X" bar and private page, organized by meetup, three friendship questions per meetup, a "Next time, ask X about..." list, notes coming back after a meetup / in the planning card / in the check-in, no AI, no Remember tab, notes kept after a chat ends (reached from Inbox), Export in Settings, mic icon kept.

Next: ask the founder about the Guide, then build Remember.

### Session, October 10, 2026 (5): Remember moves into the chat

Migration `20261010000003_remember_in_chat.sql` (bumps `limen_db_version()` to `20261010000003`). Server functions `organize-remember-entry` and `summarize-remember-timeline` deleted from the repo (the app no longer calls them; they can be deleted from the Supabase dashboard too).

- **No Remember tab.** Every chat (including ended and graduated ones) has a slim bar "What I want to remember about X" (`remember-bar.tsx`) that opens a private page (`remember/[connectionId].tsx`).
- **Organized by meetup:** one card per meetup that happened, newest first ("Your 2nd meetup · Thu, Oct 8 · Walk by the lake", date and activity from the plan). Notes written in between go under "Since your last meetup" / "Between your 1st and 2nd meetups" / "Before your first meetup". One note per meetup (unique index), editable.
- **Three optional questions** (`remember-note-editor.tsx`): "What did you learn about X?", "What made you smile?", "Next time, I'd love to ask X...", plus "Anything else" with the mic placeholder. No AI, no "entry/timeline/organize/follow-up" wording.
- **"Next time, ask X about..."** list at the top; "Asked" moves one to "Already asked" (Undo).
- **Notes coming back** (new reminder setting `notes`, all chats or one chat): after a meetup counts the bar asks once "Anything you'd like to remember about X?" (Not now, or opening it, records it in `remember_asks`; only the newest meetup, within 3 weeks); otherwise the bar shows "Next time: ...". The planning card (every step) and the check-in show "From your notes: next time, you wanted to ask X about". The separate "Before you plan something" pop-up is gone.
- Ended / closed chats keep the bar; the page says "Your notes stay here after a chat ends. You can delete them anytime."
- Export moved to Settings ("Your notes about friends", Download my notes).
- Old notes: `follow_up_note` copied to `ask_next`; notes written "after meetup N" attached to that meetup when it's the only one.
- Verified locally: `notesql.sql` (one note per meetup, meetup must be in the same chat, the other person can't see, change or delete notes or asks, setting saves), qa-notes (new) 34/34, qa-meet 36/36, qa-meetups 54/54, qa-mochi 6/6, qa-noghost 30/30, qa-oct9 37/37, qa-oct9b 62/62, qa-oct9c 20/20, qa-plan 70/70, qa-remind 42/42, qa-share 21/21, qa-testtab 27/27. qa-noghost now taps the check-in's own "Not now" (a video offer below it can show its own, depending on timing). Fixed `qa/run.sh all`, which never started anything (the suite list had line breaks). Docs: DECISIONS.md section 9 (built) and 9b (Guide draft table the founder asked to keep), AGENTS.md bullet, qa/README.md, HANDOFF_TABS.md.
- Not changed: a person blocked by the other sees that chat as "Not available" in Inbox but can still open it and reach their own notes there.

### Session, October 10, 2026 (6): smaller auto-loaded context

No app code changed. CLAUDE.md now loads only AGENTS.md (cut to the current decisions and AI rules) and docs/context 01 to 03, about 39 KB instead of about 810 KB. The full old AGENTS.md and PROGRESS.md were moved, unchanged, to docs/archive/ (AGENTS_FULL_HISTORY.md, PROGRESS_HISTORY.md). This PROGRESS.md keeps the Oct 8 onward entries and is not auto-loaded. docs/context 02 tells each session to grep the archive and DECISIONS.md before changing an area.
