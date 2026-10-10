# Limen decisions (source of truth)

Started 2026-10-04. This file is the single list of what the founder has decided. Where it disagrees with any older document (AGENTS.md history notes, PROGRESS.md, CURRENT_STATE.md, FULL_APP_INVENTORY.md, PRODUCT_GUIDE.md, FRIENDSHIP_JOURNEY_DESIGN.md, docs/LIMEN_V2_DECISIONS.md, the Feature Evaluation and Handoff PDFs, the WIP blueprint), this file wins.

Areas are decided one at a time. An area marked **Decided** is built or queued to build exactly as written. An area marked **Not reviewed yet** still follows docs/LIMEN_V2_DECISIONS.md until it is reviewed here.

| Area | Status |
|---|---|
| 1. Onboarding | Decided 2026-10-04, built on branch `limen-v2-ethics-alignment` |
| 2. Profile (what others see) | Decided 2026-10-04, built |
| 3. Safety (romance and scam protection) | Decided 2026-10-04, built |
| 4. Discovery and matching | Partly decided (Interested gate, matching weights, hard nos). Rest not reviewed yet |
| 5. Messaging and reflection | Partly decided 2026-10-09/10 (pause, chat layout, invites, check-ins; see AGENTS.md "LIMEN V2 DECISIONS" bullets). Reflect / Check not reviewed yet |
| 6. Reminders (no-ghost) | Decided 2026-10-10, built ("Quieter reminders" and "Remind me later" bullets in AGENTS.md) |
| 7. Meetups | Decided 2026-10-08 to 10-10, built (meetup plans, planning by invite, counting meetups; AGENTS.md bullets). Open: the morning-of video should fit any meetup (waiting on founder) |
| 8. Graduation | Not reviewed yet |
| 9. Remember and Guide | Remember decided and built 2026-10-10. Guide: a draft plan is below, founder still deciding which videos |
| 10. Money and settings | Not reviewed yet |

---

## 1. Onboarding (decided)

New order, 11 screens (was 13):

1. Intro
2. Phone number, then code
3. Basics
4. Account recovery (new, replaces Email and Social linking)
5. Identity
6. Profile build (10 steps)
7. How you connect (merged reflection questions)
8. Two required videos
9. Readiness
10. All set

| # | Screen | Decision |
|---|---|---|
| 1 | Intro | New copy with the liking-gap line (Boothby et al., 2018). Says "Limen", not "This app". |
| 2 | Phone + code | SMS consent line ("We'll text you a one-time code. Message and data rates may apply."). Friendly errors instead of raw Twilio/Supabase text. "New or returning, this is how you sign in." "Wrong number?" link on the code screen. |
| 3 | Basics | Birthdate as Month / Day / Year boxes (country-specific order later, when Limen expands beyond the US). Referral note: "If a friend invited you, add their code. It helps us see how people find Limen." No reward promised. Friendly save error. |
| 4 | Account recovery | One optional screen: Continue with Google, Continue with Apple, Use an email instead, Skip for now. Purpose line: only used to recover the account or send important updates; a linked account also shows a "verified" badge. Facebook, LinkedIn and the Instagram placeholder are removed. Phone stays the required sign-in. |
| 5 | Identity | Two steps (was three). Your gender: Woman / Man / Non-binary, choose one (a trans woman picks Woman). Who you'd like to meet: Women / Men / Non-binary people / Everyone, choose all that apply, mutual. Age range stays. Removed: "Queer", "Transgender", and the "Who can message you first" step. |
| 6 | Profile build | See section 2 below. |
| 7 | How you connect | One screen, 10 questions: 5 personality scenarios (after a full day of social plans; when you make plans; a friend going through something hard; when you disagree; when a friend cancels) plus the 5 friendship-experience questions. One reflection after. No longer used for matching. |
| 8 | Videos | Both stay required. Page key points rewritten to match what the videos teach. Realistic wrong answers. "How We Show Up" page adds the friendship-only line. Transcripts not needed (videos carry burned-in captions). |
| 9 | Readiness | Adds "Limen is for friendship only. Romantic or sexual advances, or asking for money, lead to removal." Adds the scam-check disclosure. The ghosting rule is now real (see section 3). |
| 10 | All set | "You'll get up to 3 a week, so take your time with each one." Offers "Do my selfie check now" or "I'll do it later". |

## 2. Profile (decided)

### What the person fills in

| Step | Decision |
|---|---|
| Location | Unchanged. |
| What brings you here | Required. Choose up to 3. "Divorce or separation" and "Starting over after a long relationship" merged into "Divorce, separation, or the end of a long relationship". New option: "Nothing big, I'd just like more friends". New switch "Show this on my profile" (default on). Hidden transitions still count for matching but are never shown or named in suggestion text. |
| About you | "Right now, I'm..." one line, up to 150 characters (replaces the open bio; stored in the same column). At least 1 story required, up to 3. "How I like care" unchanged. |
| Values | Up to 5 of 20 (was 10 of 30). Removed: Authenticity, Security, Compassion, Generosity, Connection, Wisdom, Openness, Playfulness, Resilience, Patience. |
| Activities | 32 categories (was 40). Merged: Live shows (concerts, theater, comedy); Yoga, meditation and wellness; Drinks and nightlife; Cooking and grilling; Reading and podcasts; Learning and self-improvement; Volunteering and causes; Arts and culture renamed Museums and galleries. Follow-up questions are optional and collapsed, but shown on profiles when filled in. |
| Hangout style | Both questions stay required. "Co-working style" renamed "Side by side (working, reading)". "Homebody" renamed "Low-key at home". |
| Rhythm | Friendship type, meeting frequency, reply speed, free times stay. Check-in frequency removed. |
| Communication | Opening-up pace stays. Communication modes removed. Bars question reworded "Are bars or drinks okay for meetups?". Hard nos stay on the profile but no longer hide anyone automatically. |
| Background | Languages stay. Ethnicity and 16 Personalities removed. |
| Photo | 1 clear face photo required. Up to 2 more optional. |

Removed fields stay in the database for now (no data deleted) but are no longer asked, shown, or used.

### What other people see

1. Curiosity section first: photo(s), first name, age range, distance, "Right now, I'm...", stories, what brings you here (if shown), values, activities with their details, what kind of friendship.
2. Then a compact "How they like to connect" box: meeting frequency, reply speed, free times, opening-up pace, hangout style, bars, languages, hard nos.
3. Private to the app: phone, recovery email or Google/Apple, selfie, exact location, birthdate, gender and who you want to meet, hidden life transitions, "How I like care" (connections only, inside Reflect), and both sets of reflection answers.

### Matching weights

The 15 points that came from personality similarity move to life situation (+5, now 30), values (+5, now 25) and meeting rhythm (+5, now 13). Personality answers are used for the reflection only.

## 3. Safety (decided)

1. **Friendship-only norm** on the readiness screen and the "How We Show Up" page.
2. **Mutual "Interested" gate.** "Say hello" becomes "Interested". Chat opens only when both people have said Interested. The other person is never told about one-sided interest. Someone who said Interested in you is quietly moved to the front of your next suggestions so you can decide for yourself. Enforced in the database: the first message of a conversation requires mutual interest.
3. **Existing protections stay:** photo required, first name only, one-tap reports for romantic misuse and scams, Block.
4. **Scam-signal note.** If an early message from the other person mentions money or moving to another app (Venmo, Zelle, Cash App, PayPal, gift card, crypto, bitcoin, wire, WhatsApp, Telegram, Signal, and similar), the receiver sees: "Limen will never ask you for money. Be careful with anyone who does, or who wants to move off the app quickly." Simple word list, checked on the receiver's phone, nothing scored or stored.
5. **Selfie check before you can say Interested or send a first message.** Free option A: the app asks for a selfie doing a random pose, the founder compares it with the profile photo in an in-app review screen (Settings, visible to admins only) and approves or rejects. The selfie is deleted after review; only "verified" is kept. Clear consent is asked first. Can move to an automatic check (AWS Rekognition, about $0.016 per person) later without changing what users see.
6. **Ghosting rule (real now).** If someone lets 2 or more conversations go silent until the 7-day auto-close (the other person wrote last, no reply, no honest exit) within 60 days, they are shown last in other people's suggestions for the next 30 days. Never shown, resets on its own, one slip doesn't count.
7. **Suspend switch.** `users.suspended_at`. A suspended account is hidden from everyone and cannot start or send messages. Flip it from the Supabase dashboard after reviewing a report.

## 9. Remember (decided and built 2026-10-10)

Remember moves into the chat. It helps in the moment and keeps a light record of the friendship, in friendship words, never work words.

1. **No AI.** "Organize with AI" and "Summarize for me" are removed (and with them the old credits / Premium wording). The person writes everything in their own words.
2. **Lives in the chat, no Remember tab.** A slim bar at the top of each chat, like the plan bar: "What I want to remember about David", tap to open, Hide to close, marked "Only you can see this". It opens a separate page; notes never appear among the messages. The Remember tab is removed; Export moves to Settings.
3. **Organized by meetup.** One card per meetup that counts, newest first: "Your 2nd meetup · Sat, Oct 3 · Walk by the lake". Date and activity come from the plan, nobody types a date. Meetups added with "Met up already? Add it" get a card too. Notes written between meetups go under "Since your last meetup".
4. **Three short, optional questions per meetup:** "What did you learn about David?", "What did you enjoy?", "Next time, I'd love to ask David...". Plus room for anything else. "Add an entry" becomes "Write something down". No "entry", "timeline", "organize" or "follow-up" in the copy.
5. **"Next time, ask David about..."** at the top of the page collects the open questions from every meetup. "Asked" moves one off the list.
6. **Notes come back at the right moment, only the person's own words:** after a meetup counts ("Anything you'd like to remember about David?", asked once), inside the planning card (replaces the separate "Before you plan something" pop-up), and in the quiet-chat check-in. The app still never reads messages. Light, and can be turned off like the other reminders.
7. **After a chat ends or graduates**, notes stay and are reached from that chat's row in Inbox, with a line: "Your notes stay here after a chat ends. You can delete them anytime."
8. **Mic icon stays** as a placeholder (the founder will work on voice input for all screens later).
9. **No note icon on Inbox rows** for now.

## 9b. Guide (draft for the founder to come back to, not decided)

Founder's thinking so far (2026-10-10): no Guide tab. Each piece should show up at the moment it helps; the full list stays in Profile for anyone who wants to browse. The founder isn't sure how many videos are needed. Suggested rule: video only where feelings run high, everything else a 30-second read.

| Moment | Today | Suggestion |
|---|---|---|
| Joining | 2 videos: Begin With Curiosity, How We Show Up | Keep both. They set the norms everyone agrees to. |
| Before a first meetup | Video: The First Meetup Does Not Need to Be Perfect | Keep. It's the moment nerves are highest. |
| After meeting a few times | Video: Friendship Grows a Little at a Time | Make it a short read, shown after the 2nd meetup. |
| A chat goes quiet | Read: The rhythm of messaging | Keep as a short read, linked from the check-in. |
| Something feels off | Read: When friendship gets hard | Keep, linked from Pause and "Another way to see it". |
| Ending | Read: The honest exit | Keep, linked from End. |
| The other 6 reads | Curiosity and care, What friendship actually looks like, Early friendship fragility, How to write an honest profile, Understanding your social patterns, Everyday friendship | Mostly repeat the above. Fold useful lines into those; move "honest profile" into the profile setup screens. |

That would leave 3 videos and about 4 short reads. Open question for the founder: are 3 videos (joining x2, first meetup) enough for launch?

## Founder to-do list (not code)

- Twilio A2P 10DLC registration, so real mobile carriers deliver the code.
- Turn on Google and Apple sign-in in Supabase (Authentication, Providers). Apple also needs an Apple Developer key.
- Lawyer-reviewed Terms of Service and Privacy Policy, plus biometric (selfie) consent wording (Illinois, Texas, EU rules).
- Mark your own account as admin so you can review selfies: in the Supabase SQL editor, `update public.users set is_admin = true where id = '<your user id>';`
- Upload the missing video-guidance files (`src/lib/coach-marks.ts`, `src/lib/guide-only-entries.ts`, `src/lib/module-videos.ts`, migration `20260831000000`) so the branch builds.
- Apply the migrations and deploy the edge functions listed in the deployment checklist below.

## Deployment checklist for this round

1. Apply `supabase/migrations/20261004000000_onboarding_and_safety.sql` after the two Limen v2 migrations (`20261003000000`, `20261003000001`).
2. Deploy edge functions: `generate-match-suggestions`, `generate-personality-narrative`, `selfie-review`.
3. Create the private storage bucket `selfie-checks` if the migration's storage step is not allowed in your project (the migration tries to create it).
4. Set yourself as admin (see to-do list), then test the selfie review screen with a seed account.
5. Seed-account testing shortcuts live in the Dev tab under "Safety testing": mark yourself selfie-verified, and make a selected seed conversation mutually Interested. Dev resets now also clear Interested choices.

## Where each safety piece lives in the app

- **Interested button:** Discover cards and Other User Profile. One-sided interest shows "Interested" with a check and the waiting note; mutual opens the chat. Not verified yet goes to the selfie check.
- **Inbox:** "You both chose to connect" lists new mutual matches before anyone has written.
- **Chat:** a brand-new conversation is gated in this order: mutual Interested, selfie check, photo. The scam note appears once, under the first early message from the other person that mentions money or another app.
- **Selfie check:** offered at the end of onboarding, from Settings, and whenever an unverified person taps Interested.
- **Admin review:** Settings, "Review selfie checks" (only visible when `users.is_admin` is true).
- **Profile display:** one shared view (`src/components/public-profile-view.tsx`) used by Other User Profile and Preview my public profile, so they can't drift apart.
