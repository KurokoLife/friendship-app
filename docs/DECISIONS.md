# Limen decisions (source of truth)

Started 2026-10-04. This file is the single list of what the founder has decided. Where it disagrees with any older document (AGENTS.md history notes, PROGRESS.md, CURRENT_STATE.md, FULL_APP_INVENTORY.md, PRODUCT_GUIDE.md, FRIENDSHIP_JOURNEY_DESIGN.md, docs/LIMEN_V2_DECISIONS.md, the Feature Evaluation and Handoff PDFs, the WIP blueprint), this file wins.

Areas are decided one at a time. An area marked **Decided** is built or queued to build exactly as written. An area marked **Not reviewed yet** still follows docs/LIMEN_V2_DECISIONS.md until it is reviewed here.

| Area | Status |
|---|---|
| 1. Onboarding | Decided 2026-10-04, built on branch `limen-v2-ethics-alignment` |
| 2. Profile (what others see) | Decided 2026-10-04, built |
| 3. Safety (romance and scam protection) | Decided 2026-10-04, built |
| 4. Discovery and matching | Decided and built 2026-10-10 (one a day, Saved and Interested for 30 days, Inbox tabs) |
| 5. Messaging and reflection | Partly decided 2026-10-09/10 (pause, chat layout, invites, check-ins; see AGENTS.md "LIMEN V2 DECISIONS" bullets). Reflect / Check not reviewed yet |
| 6. Reminders (no-ghost) | Decided 2026-10-10, built ("Quieter reminders" and "Remind me later" bullets in AGENTS.md) |
| 7. Meetups | Decided 2026-10-08 to 10-10, built (meetup plans, planning by invite, counting meetups; AGENTS.md bullets). Open: the morning-of video should fit any meetup (waiting on founder) |
| 8. Graduation | Not reviewed yet |
| 9. Remember and Guide | Remember decided and built 2026-10-10. Guide: a draft plan is below, founder still deciding which videos |
| 10. Money and settings | Not reviewed yet |
| Rebuild (docs/context/05_LIMEN_REBUILD.md) | Stage 1 built 2026-10-25 (section 11). Stage 1b design pass built 2026-10-25 (section 12). Stage 1c Your circle fixes built 2026-10-26 (section 13). Stage 2 Joining built 2026-10-26 (section 14). Stage 3 Suggestions built 2026-10-28 (section 15). Stage 3b Notifications built 2026-10-28 (section 16). Stages 4 to 6 not started |

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

### Profile review (2026-10-14)

- Small photo next to the name, tap for larger: the profile leads with the person's words, not their face (founder).
- "Personality reflection" renamed "connection summary": written from the How you connect answers, saved once, retake for a new one. Not editable as text (it's a summary of answers, so changing the answers is the honest way to change it).
- Edit profile shows which parts are used for matching, so people (and the founder) know what decides who they meet.
- Take a break from meeting new people (1 week, 2 weeks, 1 month), chats carry on, nobody is told.
- Invite a friend hidden during the pilot (no reward, not tracked).

## 3. Safety (decided)

1. **Friendship-only norm** on the readiness screen and the "How We Show Up" page.
2. **Mutual "Interested" gate.** "Say hello" becomes "Interested". Chat opens only when both people have said Interested. The other person is never told about one-sided interest. Someone who said Interested in you is quietly moved to the front of your next suggestions so you can decide for yourself. Enforced in the database: the first message of a conversation requires mutual interest.
3. **Existing protections stay:** photo required, first name only, one-tap reports for romantic misuse and scams, Block.
4. **Scam-signal note.** If an early message from the other person mentions money or moving to another app (Venmo, Zelle, Cash App, PayPal, gift card, crypto, bitcoin, wire, WhatsApp, Telegram, Signal, and similar), the receiver sees: "Limen will never ask you for money. Be careful with anyone who does, or who wants to move off the app quickly." Simple word list, checked on the receiver's phone, nothing scored or stored.
5. **Selfie check before you can say Interested or send a first message.** Free option A: the app asks for a selfie doing a random pose, the founder compares it with the profile photo in an in-app review screen (Settings, visible to admins only) and approves or rejects. The selfie is deleted after review; only "verified" is kept. Clear consent is asked first. Can move to an automatic check (AWS Rekognition, about $0.016 per person) later without changing what users see.
6. **Ghosting rule (real now).** If someone lets 2 or more conversations go silent until the 7-day auto-close (the other person wrote last, no reply, no honest exit) within 60 days, they are shown last in other people's suggestions for the next 30 days. Never shown, resets on its own, one slip doesn't count.
7. **Suspend switch.** `users.suspended_at`. A suspended account is hidden from everyone and cannot start or send messages. Flip it from the Supabase dashboard after reviewing a report.

## 4. Discover, Saved and Inbox (decided and built 2026-10-10)

(2026-10-25: Saved now sits inside Discover, below today's person; Inbox is called Chats and keeps only Active and Past; Pending and Friends moved to Your circle. See section 11. Points 5, 7 and 8 below describe where things were before that.)

1. **One new person a day**, in the person's own time zone. Up to 3 wait at a time; when a 4th arrives the oldest gives way. Research: people grow pickier the longer they browse in one sitting (Pronk and Denissen), and more options lead to worse choices (Wu and Chiou). Hinge's one-a-day pick led to 8 times more dates.
2. **Nobody while you have 3 active chats**, and people with 3 active chats never appear in anyone's Discover. Paused chats count as active.
3. **Never anyone you've had a chat with**, in any state (active, paused, ended, graduated, closed, blocked). Starting over after an ended chat goes through that chat's "View profile", not Discover.
4. **Someone who let your card pass** can come back weeks later (after 21 days), at the bottom. Someone who already said Interested in you goes first, never labelled.
5. **Interested is private and closes after 30 days** if it doesn't become mutual. The person moves to Saved, under "You said Interested". Wording when you tap it: "Sent privately. If David says Interested too, a chat opens for you both. David is only told if that happens. People decide at their own pace, and that's okay. If it doesn't become mutual within 30 days, it closes on its own." After 30 days, shown once: "Your interest in David has come to a close. It didn't turn into a chat this time, and that happens often. Timing, room in someone's life, and fit all play a part. New people are on the way." Nothing closes earlier, so the timing never reveals what the other person did. At most 5 open.
6. **Saved: at most 5, each for 30 days.** Saving moves the person out of Discover. Anyone you start a chat with leaves Saved.
7. **Inbox tabs:** Active (opens first: active and paused chats, new hellos), Friends (graduated), Past (ended, closed, blocked; history and notes kept). The person who blocked sees "Blocked" and can "Hide this chat" (history kept, "Hidden chats (n) · Show"). The blocked person only sees "Not available".
8. **Pending tab (2026-10-14):** Interested always saves the person to Inbox, Pending, even before your selfie is approved (it used to be refused, so nothing was saved). The chat opens when both said Interested and both selfies are approved, or they talked before. Pending says what each one waits for: the other person (never shown to them), your selfie, their selfie check, or room for a new chat. Saved now holds only saved people. Safety is unchanged: no chat and no first message before both selfies are approved.

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
10. **Free notes (2026-10-10, later).** Meetup notes keep the three questions. A note not tied to a meetup ("Write something down") is one open box: the first line becomes the title, no separate title field.
11. **Topic chips, fixed list only:** Family, Work, Things they love, Going through, Ideas for us. Optional, any number per note. No custom tags (they get messy and add clutter). "Ideas for us" notes also come back in the planning card.
12. **Search and topic filters only from 6 notes** for that person (meetup notes count). Below that, a plain list is easier to read.

## First-time tips (decided and built 2026-10-17)

- A tip is a calm card inside the page, with a short heading ("Tip · Pending") and a plain explanation, shown once per account until "Got it". Never a floating box: the old spotlight covered real buttons (Settings and Guide on the Profile tab did nothing until the tip was closed).
- Where: Discover, Saved, Inbox (what each tab is), Inbox Pending, Profile, Settings, Guide, a person's profile ("Note it privately", Report and Block), and in each chat two tips one after the other (Pause / End / Report / Block, then Let's plan something, What I want to remember and Reminders).
- "Show tips again" in Settings brings every tip back. Migration `20261017000000_more_tips.sql`.

## Joining and profile, rebuilt (decided and built 2026-10-18)

- Positioning: "Limen helps adults make real friends", not built around big life changes.
- Order (since 2026-10-19; intro is one screen since 2026-10-22): intro → phone and code (sign-up) → basics (18+ check) → Start with you (what brings you here, a story; saved to the account as you write, so it can be finished on another device) → what you enjoy → practical bits → who you'd like to meet → How you connect (6) → photo → Before you start → preview → Keep your account safe (recovery, optional) → All set. Sign-up moved first on Oct 19 so writing follows people between phone and computer; it used to come after Start with you. Full wording in the "Limen: Joining and profile proposal" doc.
- Stories: up to 3, optional guides (never shown to readers), no word count. People connect with stories that show who someone is, not self-descriptions (2026 story vs list study; asking for one moment brings back a real scene).
- Dropped: values, what-brings chips, opening up, hangout style, "Right now" in joining, the AI connection summary, onboarding videos and quiz. Hard nos → Good to know about me. Bars reworded.
- Discover cards and profiles show only people's own words. How you connect answers show only on your own profile.
- Matching: shared language required; meeting pace 40, interests 40, friendship type 20.
- Moment lines (14): one true line inside existing cards at moments people guess or hesitate; no new cards; never a guess about the other person; no Guide links.

## 9b. Guide (removed 2026-10-25)

The Guide is removed from the app (rebuild stage 1, docs/context/05_LIMEN_REBUILD.md): no Guide screens, no videos or reads, no first-meetup guide offer, no "Short guides" reminder switch. A one-line "why" at the moment it helps replaces it. The draft below is history only.

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

## 11. Rebuild stage 1: new home and tabs (decided and built 2026-10-25)

Guideline: docs/context/05_LIMEN_REBUILD.md (wins over docs/context/01 on direction).

1. **Four tabs:** Your circle (home, first) · Chats · Discover · You. The Test tab stays for admins and test accounts. Route names are unchanged (`/circle` new; `/inbox` is Chats, `/home` is Discover, `/profile` is You) so every old link still works. Everyone who finished joining lands in Your circle (also right after joining).
2. **Chats** = the old Inbox Active list, then **Past** at the bottom (ended, closed, blocked; hide a blocked chat as before). No Pending or Friends tabs. Graduated chats are reached from Your circle, under Friends.
3. **Discover:** today's person on top, **Saved** below (up to 5, 30 days, Remove). No Saved tab. "Saved. X is below, under Saved, for the next 30 days."
4. **You:** a Profile | Settings switch at the top. Profile is the old Profile tab. Settings is the old Settings page plus **About Limen** (exact text from 05, in Help). `/settings` opens You on Settings.
5. **Guide removed** completely (see 9b). The guide videos were only in Supabase Storage (bucket `guide-videos`), never in the repo.
6. **Your circle:** circles Close, Friends, Getting to know, Want to reconnect. Limen people are placed on their own (`my_people()`): an open or paused chat → Getting to know ("Chat on Limen" / "Chat on Limen, paused"); someone you said Interested to → Getting to know, "Waiting to connect" plus why (the old Pending lines, and when it closes); graduated → Friends ("Met on Limen"). Ended, closed, passed and blocked people never appear; a saved-only profile isn't listed. Tap a Limen person → their chat; someone waiting → their profile. The selfie note and the one-time "interest has come to a close" note moved here from Pending.
7. **Moving by hand:** "Move" on any row opens the four circles. For Limen people the move is stored privately (`people_circle_choices`, with where Limen had placed them); it holds until Limen's own placement changes (for example the chat graduates), then Limen moves them again. Moving someone back to where Limen placed them clears the hand move.
8. **Add someone** (a friend outside Limen, `outside_friends`, own rows only): name (a first name is enough, up to 60 characters), circle, how often you'd like to be in touch, optional note (up to 1000). No phone or email fields. Choices per circle, each with its line from 05: Getting to know: every few days / every week / every two weeks; Close: every week / every two weeks / every month; Friends: every two weeks / every month / every few months; Want to reconnect: any of these, a few times a year, or no suggestions ("A check-in tells someone they matter to you."). Each circle starts at its usual rhythm (Getting to know and Close: every week; Friends: every month; Want to reconnect: a few times a year) until the person picks one; a picked rhythm is kept when it fits a new circle. The database refuses a rhythm that doesn't fit the circle (`rhythm_fits_circle`). Moving an outside friend to a circle their rhythm doesn't fit sets that circle's usual one.
9. **Outside friend page:** name, circle, how often, note, Edit, "Remove from Your circle" (asks first). No Text / Call / Email and no suggestions yet (stage 3).
10. **No "last talked" dates** anywhere in Your circle.
11. **Empty state** (draft, waiting for the founder's OK): "Who would you like to keep up with?" / "Add a friend you'd like to see more of, or someone you've lost touch with. A first name is enough, and only you see this list." / Add someone / "People you meet on Limen will show up here too."
12. Test tab "Reset all test accounts" also clears added friends and hand moves.

Migration `20261025000000_your_people.sql`. Tests: `qa-circle` (new), `qa-discover`, `qa-pending`, `qa-inbox-chat`, `qa-profile`, `qa-onboard`.

## 12. Rebuild stage 1b: design pass (decided and built 2026-10-25)

Guideline: docs/context/05_LIMEN_REBUILD.md, "Design guide" (version 1) and "Every profile is a person". Mockup: https://claude.ai/artifact/XvgxuczQnMpNYAtRpuXS4A.

1. **"Your people" is now "Your circle"** everywhere (tab, heading, tip, copy, tests). Route `/circle` (was `/people`), suite `qa-circle` (was `qa-people`), `src/lib/circle.ts`. The internal tip key stays `tab_people` (no database change needed).
2. **Theme file:** every color and the font live in `src/theme/tokens.js` (typed through `src/theme/index.ts`); `tailwind.config.js` reads it. Light by default, warm dark only when the device is set to dark. Tailwind's `stone` scale is replaced with a warm one (cream #FBF7F2 background, ink #2A2420 text, #6B5F57 secondary, #EDE4DA borders), `accent-500` is the link color #94451A, `apricot` #B95A1E is the one filled main-action color, `white` is the card color #FFFDFA, plus `honey`, `honey-line`, `outline` and the four circle colors. Hard-coded colors in screens were moved to the theme. Light grey text moved up one shade so it meets 4.5:1; dark-mode text likewise. All-caps headings are gone (sentence case).
3. **Figtree** (400 to 700) ships with the app (`@expo-google-fonts/figtree`, `src/theme/fonts.ts`); nothing is fetched from Google. On the web every text uses it. On phones it's loaded as one family for now; per-weight font names wait for the real phone test (stage 3). Sizes: body 16, captions 14, headings 28 on a phone and 34 on a laptop.
4. **Shell:** phones keep a bottom tab bar (icon + label). Over ~720px the tabs move to a top bar ("Limen" on the left, tabs as pills on the right) and every screen sits in a centered column (640px; chats 720px). `src/components/app-tab-bar.tsx`, `src/app/(tabs)/_layout.tsx`, `src/app/_layout.tsx`.
5. **Buttons and links, one rule app-wide:** about 120 bare colored or grey words that acted as buttons became outlined pill buttons (44px tall); the black filled buttons became apricot; sentences with an action inside ("Already agreed on something? Set the plan", "Met up already? Add it", "Already a member? Sign in", "Wrong number? Change it", "More tips", "Something you'd like to ask about? Note it privately") now have an underlined link in the sentence. Tips are one or two lines with a "Got it" button, on honey. Shared pieces in `src/components/ui.tsx`: `Pill`, `RowLink` (whole row with a chevron), `InlineLink`, `Face`. Other screens get their full design when their stage rebuilds them.
6. **Your circle screen:** header "Your circle" / "Only you see this." with a filled "Add someone" button; the circles picture (`src/components/circles-picture.tsx`): "You" in the middle, rings Close, Friends, Getting to know, Want to reconnect (outer dashed), faces on their ring (up to 6, then "+N"); tapping a ring scrolls to that section; the list grouped by circle in sentence case ("Close · 1"), each row a face, name, one line (rhythm, "Chatting on Limen", "Chatting on Limen, paused", "Waiting to connect", "Met on Limen") and a chevron; two columns on a laptop. Tip: "People you meet on Limen show up here on their own. Add anyone else you'd like to keep up with."
7. **Moving someone** happens on their own page, never from a word on the list: an added friend's page has a "Circle: Close · Move to another circle" row; a Limen person's profile has "In your circle: Getting to know · Move to another circle" (and, for someone you said Interested to, the line that says why it's waiting, which used to sit on the list). Both open the same circle chooser (`src/components/circle-picker.tsx`).
8. **Faces:** Limen people show their profile photo (`my_people()` now returns `photo_url`, migration `20261025000001_circle_faces.sql`); a photo that doesn't load falls back to the initial. Friends added outside Limen show a colored initial by circle.
9. **Chat fix found by the tests:** with pill buttons the open plan card could fill a phone screen and push the chat out of reach; it now takes at most about half the screen and scrolls.
10. **Every profile is a person, found but not changed yet** (stages 4 and 6): "this match closes quietly" (Chats, the new-chat card, and inside the chat), "This person has chosen who can message them first, and it isn't a match right now" (chat), "Nobody can pay for more matches" (How Limen is paid for), "deletes your profile, matches, conversations" (delete account), "Not the right friendship match" (a private ending reason), "as a user of this app" (placeholder Terms), "A member" as the name fallback when a name is missing (several screens), "Not for me" on Discover (05 says "Not now"), "Skip" on the plan limits step, and "N% complete" on your own Profile (about your own profile, not a score of a person; flagged for a decision). The Test tab says "matches" too (admins only). No scores, likes, views or match counts were found anywhere.

Tests: `qa-circle` (78 checks) plus every other suite updated for sentence case, the new link taps and the moved waiting lines.

## 13. Rebuild stage 1c: Your circle fixes (decided and built 2026-10-26)

Guideline: docs/context/05_LIMEN_REBUILD.md, "Your circle" (person page, next check-in date, photos).

1. **Faces open the person.** In the circles picture each face is its own button (44px tap area): a Limen person opens their chat, a friend added outside Limen opens their page. Tapping an empty part of a ring, or a "+N" bubble, still jumps to that part of the list (`src/components/circles-picture.tsx`).
2. **Person page** for a friend outside Limen (`src/app/friend/[id].tsx`): a large face, name, Edit, the circle row (move to another circle), how often you'd like to be in touch with the next check-in line under it, the private note, "Only you see this." The reach-out buttons go just under the name in stage 3 (a marked spot in the code; nothing shown yet). Limen people still open their chat.
3. **Next check-in date, one rule in one place (the database):** `outside_friend_next_check_in(friend, time zone, rhythm?)` picks where the count starts (the last time you reached out, `outside_friends.last_reached_at`, which stage 3 fills in; until then the day the friend was added, as a day in the person's own time zone) and `circle_next_check_in(day, rhythm)` adds the rhythm: every few days +3 days, every week +7, every two weeks +14, every month +1 month, every few months +3 months, a few times a year +4 months, no suggestions = no date. Stage 3 suggestions must call the same functions. The app only words it: "Limen will bring Momo up again around Nov 8." (year added when it isn't this year). Shown on the person page and right under the rhythm choice when adding or editing, updating as the choice changes; never on the list. Two cases 05 didn't word (founder to OK): a date that has already passed reads "Limen will bring Momo up again soon."; "No suggestions" reads "Limen won't bring Momo up on its own."
4. **Photos for friends outside Limen:** optional, from the photo library (from the linked phone contact once contact linking exists in stage 3). Stored in a private storage bucket, `friend-photos`, in a folder named after the owner's user id; storage rules let only the owner upload, read (through a link that lasts an hour), replace or remove them; `outside_friends.photo_path` must point into the owner's own folder (checked by the database). Used for nothing else. Removing the friend removes the photo; deleting the account removes all of them (`delete-account` function). Without a photo, the colored initial stays. The form says "Only you see it, and it's used for nothing else."
5. **Design guide and "Every profile is a person"** followed: faces everywhere, called by name, no dates on the list.

Migration `20261026000000_circle_person_page.sql`. Function changed: `delete-account`. Tests: `qa-person` (34: face taps open the person, empty ring part jumps, the person page, the next-date line while adding and editing, counting from the last reach-out, photo upload, photo privacy through storage and the API, phone and laptop), `qa/sql-checks/circlesql.sql` (the date rule including month ends and time zones, and storage privacy), `qa-circle` (78).

## 14. Rebuild stage 2: Joining (decided and built 2026-10-26)

Guideline: docs/context/05_LIMEN_REBUILD.md, "Joining (decided)". Exact wording from 05 wherever 05 gives it.

1. **Your circle wording (founder approved):** empty state "Who would you like to stay close to?" / "Add someone you'd like to see more of, or someone you've lost touch with. A first name is enough, and only you see this list." / "People you meet on Limen will show up here too." Empty circles show only their heading ("Nobody here yet." removed). The next check-in lines "...again soon." and "...won't bring X up on its own." are approved as they are.
2. **Order:** Intro 1 ("Most friendships don't end. They drift.", Next) → Intro 2 ("Friendships are made of small moments.", the three ways, "Wherever your friendships are right now, you can start here.", Join Limen / Already a member? Sign in) → phone and code → Basics (under 18 turned away) → **What's hardest** → **Think about your friends** → **Here's where Limen can help** → with Meet someone new: today's profile setup (Start with you through the preview) → everyone: Keep your account safe → All set. Back on every screen after the first.
3. **What's hardest about friendship for you right now?** The ten choices from 05 (pick any), "Something else" opens a box in their own words (300 characters). "So Limen knows where to help first. Only you see this." Saved as they tap. Stored in `joining_answers` (one row per person, own-row rules only; signed-out people have no access). Never used for matching, never shown to anyone.
4. **Think about your friends right now.** Names typed one at a time with Add; each lands in Your circle (`outside_friends`) the moment it's added, in Close for the first prompt and Want to reconnect for "Anyone you've lost touch with...", with the default rhythm for its circle (Close every week, Friends every month, Getting to know every week, Want to reconnect a few times a year). Each name has a circle button (change it) and a remove button. A name typed but not added is added on Continue. "Most adults name one to four close friends. None is more common than people think." "Skip for now" when nobody is added. Line (approved Oct 27): "Everyone you add goes into Your circle. Only you see it, and you can change anything later."
5. **Here's where Limen can help. Change anything you like.** Five choices from 05, filled in from What's hardest until the person changes anything (saved as they tap). Mapping (approved Oct 27): Meeting new people → Meet someone new; Keeping in touch → Keep in touch; Getting plans to happen → Make plans happen; Friendly to real friends → Make plans happen; Reconnecting → Reconnect; I'm usually the one who reaches out → Notice my own patterns; Not sure people want to hear from me → Keep in touch + Notice my own patterns; Friends don't really know what's going on with me → Keep in touch; Finding the time → Make plans happen; Something else → nothing. If nothing is filled in, Keep in touch starts on. At least one must stay on. Lines (approved Oct 27): "Next, a short profile in your own words, so the people you meet can get to know you." / "You can choose Meet someone new anytime later."
6. **Meet someone new branch.** Chosen: today's full profile setup, unchanged (Start with you, What you enjoy, practical bits, who you'd like to meet, How you connect, photo, Before you start, preview, then Keep your account safe and All set with the selfie offer). The liking-gap line moved from the intro to the top of Start with you: "One thing worth knowing: after meeting someone new, most people underestimate how much the other person liked them." Not chosen: no profile; the person becomes a member right away (`readiness_status` 'ready') and goes to Keep your account safe, then an All set without the selfie offer.
7. **Later.** Your circle shows a card (approved Oct 27): "Meet someone new, too?" / "Limen can introduce you to one person at a time who lives nearby, to meet in person. It starts with a short profile in your own words." / Set up my profile · Not now / "You can also start anytime from Discover." Not now brings it back about 30 days later; the third Not now ends it for good (see 11). Discover shows an invitation instead of people (approved Oct 27, with the new last line): "Meet someone new" / "Here, Limen introduces you to one new person a day who lives nearby and would also like a new friend. The idea is to meet in person." / "It starts with a short profile in your own words, so people can get to know you first." / Set up my profile / "Until then, you aren't shown to anyone, and nobody is shown to you." Discover doesn't pick anyone for them, and `compatible_candidates_for` never suggests them to others (`wants_to_meet_new`). Finishing the profile ("Sounds good" on Before you start) adds Meet someone new.
8. **Saves as you go, picks up where they left off:** each step is marked done (`hardest_at`, `friends_at`, `goals_at`); opening the app while joining goes to the first unfinished step. Someone who was already writing their profile before this update carries on with it.
9. **Existing members** have no `joining_answers` row and count as having chosen Meet someone new; they are never sent through joining again.
10. Not done in this stage (05 lists it for the profile branch): the voice pass on the profile screens (stage 6 finishing pass).

11. **Founder decisions on the drafts (2026-10-27):** (a) the "Meet someone new, too?" card: "Not now" brings it back about 30 days later; after the third "Not now" it never shows again; setting up a profile also ends it (`meet_offer_not_now()`, `joining_answers.meet_offer_not_now_count` and `meet_offer_back_at`; `meet_offer_hidden_at` now means "never again"; anyone who tapped Not now under the first version counts as one Not now, back 30 days after it). Discover keeps offering the profile either way. (b) The Discover invitation ends "Until then, you aren't shown to anyone, and nobody is shown to you." (c) The All set without a profile, the hardest-to-help mapping and the small helper lines are approved as written. Migration `20261027000000_meet_offer_not_now.sql`.
12. **qa-oct9b (3 checks, reopening a no-hello match) was a test problem, not an app bug:** the test opened Maria and Elena's match by hand without approved selfies, and reopening a match where nobody said hello correctly needs both selfies (only people who wrote to each other can reconnect without one). It passed before only because an earlier suite had left approved selfies behind. The test now sets them itself; with them, saying Interested again reopens the match with a fresh 14 days.

Migration `20261026000001_joining.sql`. No server functions changed. Tests: `qa-onboard` (136: both branches end to end, the card coming back after 30 days and gone after the third Not now, hardest answers saved and private through the API, names into Your circle with the right rhythm, filled-in goals, Back on every step, coming back mid-joining, Discover invitation, never suggested without Meet someone new, the offer card and Not now), `qa/sql-checks/joiningsql.sql` (privacy, unknown keys refused, the meet rule), `qa-circle` (new empty-state wording).

## 15. Rebuild stage 3: Suggestions (decided and built 2026-10-28)

Guideline: docs/context/05_LIMEN_REBUILD.md, "Your circle (decided)", "Suggestions (decided)", "Build order" stage 3.

Two fixes first (founder's test): Before you start's "Answer every hello" point ends "Ending a chat or pausing never counts." and the "More about quiet chats" / "Show less" button and its hidden text are gone. The "You" center of the circles picture shows your own profile photo (same size, round, a small "You" label under it) and opens You, Profile when tapped; without a photo the apricot "You" circle stays (also tappable). "Here's where Limen can help" stays pre-filled from What's hardest (intended).

1. **One suggestion at a time** on a honey card at the top of Your circle, for friends added outside Limen and for Limen people. It stays until the person acts on it. Who is due uses the stage 1c rule only: `circle_next_check_in(last time in touch, rhythm)`. Friends outside Limen: `outside_friend_next_check_in` (last "I reached out", else the day added). Limen people (draft rule, founder to OK): an open or graduated chat where both have written, not paused, no plan coming up, the chat's Reminders switch on; last time in touch = the newest message either way, a counted meetup, the end of a pause or "I reached out" (timing only, the app never reads messages); rhythm = their circle's usual one (Getting to know and Close every week, Friends every month, Want to reconnect a few times a year) unless "Fewer" changed it (`limen_person_settings`). The most overdue person goes first.
2. **How often** (Settings, "Suggestions in Your circle"): A couple of times a week (at most one every 3 days), Once a week (default, 7 days), Every two weeks (14 days), and No suggestions (added so every reminder can be turned off, draft). Counted from when the last suggestion was shown.
3. **What it says** (05 wording; the person's own notes first): an open "Next time, ask X about..." note → "You wanted to ask X: “...”" (draft: 05's example rewrites the note, Limen quotes it instead); a note marked Going through in the last 90 days → "You noted this about X: “first line” How's that going, do you think?" (draft); otherwise taking turns: "You and X haven't been in touch for a while." / "Anything X did lately that you'd tell them was good?" / "Anything going on with you that X doesn't know yet?" / "When did you and X last get together?" (only for people you've met or friends outside Limen). Each has its plain why line and a "Why we say this" link that shows the source (Liu et al. 2022, Huang et al. 2017, Zhao and Epley 2021, Oswald et al. 2004, Bruk et al. 2018, Hall 2019). Celebrating is a tip only: "When they share good news, ask about it: how it happened, how it felt." in the chat's More tips (draft).
4. **Reaching out.** Limen person: "Open chat" and "I reached out"; writing in the chat closes the card as reached on its own. Friend outside Limen on the phone app with a linked contact: Text / Call / Email open the phone's own app with an empty message, then "Did you reach out to X?" Yes / Not yet (Yes counts). On a computer, or with no contact: "Reach out however you usually do." and "I reached out" (05, Desktop option A). "I reached out" → "Noted. A check-in tells someone they matter to you. Limen will bring X up again around Nov 8." (draft), Got it.
5. **Not now** puts the card away ("Okay. Limen will bring X up again another time.", draft); that person waits about a week (draft), others can come first. **Fewer suggestions for X** moves their rhythm one step slower within their circle ("Okay. Limen will bring X up every two weeks from now on.", draft); at the slowest for the circle it says so and points to moving them on their page (draft).
6. **Pattern noticing:** after 3 Not nows within 4 weeks, at the next suggestion turn, one optional question (05 wording) with the five 05 answers, plus Not now; asked at most once in 60 days (draft timing). One line per answer (drafts): A busy stretch "Busy stretches pass. Two lines still count as being in touch." / Not sure what to say "Small is fine: a question about their week, a photo, or "this made me think of you."" / Worried it'll feel awkward "Most people are glad to hear from a friend, even after a while. The awkward part is usually shorter than we expect." / The friendship feels different now "Friendships change shape. On their page you can move someone to another circle or change how often Limen brings them up." / Something else "Thanks. Only you see this, on your profile under You." You, Profile shows "When you put off a check-in": each answer and its date, nothing else (no counts, no advice).
7. **Phone contacts** (phone app only): "Link to a contact" on a friend's page opens the phone's contact picker; Limen stores only the contact's id on that phone (`outside_friends.contact_id`), never a number or an email; the number or email is looked up on the phone when Text / Call / Email is tapped. The contact's photo becomes their face if they have none yet (private, same bucket as before). "Unlink contact" removes the link. Lines (drafts): "Link X to a contact to text, call or email from here. Limen keeps only which contact it is, never their number or email." / "Opens your phone with an empty message. Limen doesn't keep their number or email." / "Limen can't see your contacts. You can allow it in your phone's settings." On the web none of this shows.
8. **The chat's own "It's been quiet" check-in is retired** (`run_conversation_restart_check_v2` returns 'retired'; waiting check-in cards are put away). Settings no longer lists "Check-ins"; a chat's own Reminders switch still keeps that person out of suggestions.
9. **Test tab:** "Your circle suggestion now" makes a suggestion show right away for the acting test account. "Reset all test accounts" also clears suggestions, their settings, pattern answers and Limen rhythms.
10. Privacy: suggestions, pattern answers, Limen rhythms and the frequency are own-row only; suggestions and answers are written only through the database functions.

11. **Founder OK (2026-10-28):** every draft above (lines, timings, the pattern answers, contact lines, the celebrating tip) and the Limen "last in touch" rule (messages from either person count) are approved as built.

Migration `20261028000000_circle_suggestions.sql`. No server functions changed. App: `expo-contacts` added (works in Expo Go). Tests: `qa-suggest` (62: the due rule, one at a time and the gap for each frequency, Not now coming back after a week, Fewer down to the slowest, Limen people and which chats never count, the note-based lines, pattern question and its answers on You, check-in retired, privacy through the API, person page on the web, laptop, the Test tab tool, the "You" photo), `qa-onboard` (Before you start line).

## 16. Rebuild stage 3b: Notifications (decided and built 2026-10-28)

Guideline: docs/context/05_LIMEN_REBUILD.md, "Notifications (decided Oct 25)". Founder chose Resend for email and all of 3b in one stage.

1. **Channels:** push to the phone app (Expo's push service) and email (Resend). SMS is never used for reminders.
2. **Settings** (You, Settings, "Notifications"): four types, each with a Phone and an Email switch: A new hi / New messages / Plans and meetups / Suggestions. Quiet hours with From (8, 9, 10, 11 pm) and Until (6, 7, 8, 9 am), or off. Gentle defaults: everything on, quiet 9 pm to 8 am in the person's own time zone (saved from the phone when the app opens). Suggestions also follow "Suggestions in Your circle" (No suggestions = no suggestion notifications).
3. **What they say (privacy):** never message text. A first message in a chat: "Maria S. said hello"; after that "New message from Maria S." (at most one per chat an hour, draft); an invite: "Maria S. invited you to plan something"; a time suggested: "David C. suggested a time to meet"; a plan set: "Your plan with Maria S. is set"; cancelled: "Your plan with Maria S. was cancelled" (the person who did it isn't notified). Suggestions: only the name and the plain line ("You and Momo haven't been in touch for a while."); note-based suggestions never quote the note in a notification ("You wanted to ask Robert something." / "How's it going with Jenny, do you think?", drafts). Push title "Limen". Email: the same line as the subject, an "Open Limen" button, and "You can choose which emails you get, or turn them off, in Limen under You, Settings, Notifications." (draft).
4. **How it works:** the database fills `notification_outbox` itself (triggers on messages and meetups; `queue_suggestion_notifications()` starts each person's next suggestion with the same `get_circle_suggestion` rule and frequency, so the notification and the Your circle card are the same suggestion). The `send-notifications` server function runs every few minutes from Supabase Cron, asks `notifications_to_send()` what is ready (per type and channel, holds through quiet hours, lets go of anything older than 2 days, puts away what nobody could receive), sends, and marks it (`mark_notification_sent`). A phone that no longer has the app is forgotten (`forget_push_token`). Members can't read the outbox or run any of this; only the service key can run the function. Suspended accounts get nothing.
5. **Push on the phone:** asked only when the person taps "Turn on phone notifications" in Settings; after that the phone's address is kept with whoever is signed in (`register_push_token`, only real Expo tokens). Tapping a notification opens that chat or Your circle. Needs the app linked to an Expo account (a project id); until then Settings says "Phone notifications aren't ready in this version of the app yet." On the web: "Phone notifications work in the Limen phone app."
6. **Email:** only to the address the person confirmed in Sign-in and recovery (`users.email`); without one, Settings says "To get emails, add one in Sign-in and recovery."
7. **Test tab:** "Send me a test notification".

Migration `20261028000001_notifications.sql`. New server function `send-notifications` (secrets `RESEND_API_KEY`, `NOTIFY_FROM`, `APP_URL`; a Supabase Cron job every 5 minutes). App: `expo-notifications`. Tests: `qa-notify` (33: the real function against stand-ins for Expo and Resend: who may run it, push and email for a hello, never the text, sent once, choices per type and channel, quiet hours, a forgotten phone, suggestions sent once and the same as Your circle, none when off; the Settings screen), `qa/sql-checks/notifysql.sql` (28).

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
