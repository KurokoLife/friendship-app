<!-- Copy of the founder's project doc "01_PRODUCT.md" (claude.ai project "Business - Limen"), copied 2026-11-15. When the project doc changes, replace this copy. After each build stage, update both. -->

# Product: what's built today and how it looks

Updated 2026-11-15. Beliefs and the test for every feature are in **00 Core**; this file only describes what's built, with one short "why" per part. What's decided but not built yet (including the Nov 15 copy update to several lines below) is in **02 Plan and status**. The app still says "Limen" until the name checks pass.

Detail per area is in the repo: docs/DECISIONS.md and the "LIMEN V2 DECISIONS" bullets in AGENTS.md.

## 1. What it is

Okage helps adults stay close to people: keep up with the friends they have, reconnect with people they've lost touch with, and meet someone new, one person at a time, in person. Open to all ages and genders, especially 40+, and it must feel right for men as much as women. Friendship only.

## 2. How the app behaves everywhere

- No one reads chats. Every reminder uses timing only. Exception: the scam word check, on the receiver's own phone, storing nothing.
- Starters are fine; the person finishes them in their own words (`StemMessageBox`).
- Equal choices, no pushing, never acting for someone. Every reminder and card can be put away or turned off.
- Only one prompt card shows in a chat at a time. At moments where people guess or hesitate, a card may carry one short, true line, never a guess about the other person.
- A card answered halfway comes back after a page refresh until it's closed.
- First-time tips are a calm card inside the page (never a box over buttons), once per account. "Show tips again" in Settings brings them back.
- Read receipts are never shown to the sender. No swipe, no likes, no romance features.
- Every chat shows: "Limen is for meeting in person. Chatting is how you get there."
- *Why:* see 00 Core, sections 7 and 9.

## 3. Joining

Built Oct 26 to 27. (Screen 2 of the intro, Before you start and two follow-up lines change in the Nov 15 copy update; see 02.)
1. Two intro screens: "Most friendships don't end. They drift." / "Busy weeks, moves, screens. It's easy to lose touch without meaning to." (Next), then "Friendships are made of small moments." / "A quick call. A coffee. Stopping by to say hi. Limen helps you make more of them." with the three ways Limen helps (keep up with the friends you have; reconnect with someone you've lost touch with; meet someone new, one person at a time, in person), "Wherever your friendships are right now, you can start here.", "Join Limen" and "Already a member? Sign in".
2. Phone number and code. 3. Basics: name and birthdate (under 18 turned away; the database refuses it too).
4. "What's hardest about friendship for you right now?" Pick any of ten, plus Something else in your own words. "So Limen knows where to help first. Only you see this." Never used for matching.
5. "Think about your friends right now." "Not counting family or a partner: who would you call with good news? Who could you ask for a hand?" Names go straight into Your circle with the circle's default rhythm; "Anyone you've lost touch with but would like to hear from?" goes to Want to reconnect. "Most adults name one to four close friends. None is more common than people think." Skippable.
6. "Here's where Limen can help. Change anything you like." Filled in from What's hardest.
7. With "Meet someone new": the profile (Start with you with the liking-gap line at the top; What you enjoy; practical bits; who you'd like to meet and ages; How you connect, 6 private questions then Share / Keep private; photo; Before you start, the ground rules; "Here's what people will see" preview). Without it: no profile, a "Meet someone new, too?" card in Your circle (Not now brings it back about 30 days later; the third Not now ends it), and Discover shows an invitation. They aren't shown to anyone until they finish a profile.
8. Everyone: Keep your account safe (optional recovery), then All set.

Saved as you go; reopening goes to the first unfinished step. Back on every screen after the first. No step counts, no "Required" labels.

*Why:* starting with the friends people already have makes Okage about all of someone's friendships, not just new ones. "Before you start" sets shared norms before anyone meets. Every extra step loses people before they meet anyone.

## 4. Profile

- Fill in: what brings you here (own words); 1 to 3 stories (own words, optional guides); interests (32 categories, own line and details); location; friendship type, meeting pace, reply pace, usual free times; bars or drinks; Good to know about me; languages; 1 face photo required, 2 more optional.
- Others see: a small photo next to the name ("See N photos" opens them large), first name, a 5-year age range (18-24, 25-29, 30-34 ... 65-69, 70+), distance, then what brings them here, their stories, what they enjoy, looking for, and a "How they like to connect" box. Discover cards show only their own words.
- Private: phone, recovery login, selfie, exact location, birthdate, gender and who they want to meet, joining answers, How you connect answers unless shared.
- Shared friendship answers (by choice, private by default): people you have a chat with see "How X approaches new friendships": your answers to the four questions about now. The two about past friendships always stay private. Never on public profiles or in Discover.
- Curiosity notes: while reading a profile you can privately write "I wonder...". Only you see it.
- Edit profile: a short list of parts, each saying in plain words how it's used. Matching uses who you'd like to meet, ages, distance and a shared language (requirements), then meeting pace 40, interests 40, friendship type 20. People's own words are never used for matching.

*Why:* stories in people's own words let a reader notice what they're curious about, instead of being told. Private fields stay private so people can be honest.

## 5. Your circle (home)

- Four circles: Close / Friends / Getting to know / Want to reconnect. Header "Your circle", "Only you see this.", a filled "Add someone" button. A circles picture with faces ("You" in the middle; tap a face to open the person, tap an empty part of a ring to jump to the list), then the list grouped by circle. No "last talked" dates.
- Limen people are placed on their own: an open or paused chat, and people you said Interested to ("Waiting to connect", with why), go in Getting to know; graduated friends in Friends. Ended, closed and blocked people never appear. Anyone can be moved by hand from their own page.
- Add someone (a friend outside Limen): name, circle, how often you'd like to be in touch, optional note and private photo; no phone numbers or emails stored. Rhythm choices fit the circle:
  - Getting to know: every few days / every week / every two weeks. "New friendships grow fastest when you're in touch every week or so."
  - Close: every week / every two weeks / every month. "Most people are in touch with their closest friends about once a week."
  - Friends: every two weeks / every month / every few months. "Most people catch up with good friends about once a month."
  - Want to reconnect: any, including no suggestions.
- Person page (friends outside Limen): face, name, circle, how often, "Limen will bring Momo up again around Nov 8." (or "...again soon." / "Limen won't bring Momo up on its own."), note, Edit.
- Suggestions (built Oct 28): one at a time on a honey card at the top, for friends outside Limen and Limen people whose chat both wrote in. Due when the next check-in date comes (last time in touch + rhythm). A plain line ("You and Maya haven't been in touch for a while.") with a why line and a "Why we say this" source. I reached out / Not now (back in about a week) / Fewer suggestions. How often in Settings (a couple of times a week, once a week, every two weeks, none). After 3 Not nows in 4 weeks, one optional "What usually gets in the way?" question; answers shown back privately on You. On the phone app: Text / Call / Email from a linked contact (only which contact is stored). On a computer: "Reach out however you usually do" and "I reached out". The why lines and pattern answers change in the Nov 15 copy update (see 02).

*Why:* this is where Okage lives most: noticing the people who are already there. No dates on the list, because a list of "last talked" dates turns into a guilt list.

## 6. Discover and connecting

- One new person a day (in your own time zone), up to 3 waiting; nobody new while you have 3 active chats; never anyone you've had a chat with. Saved below today's person (at most 5, 30 days).
- "Interested" (to be replaced by Say hi, see 02): the chat opens only when both say Interested and both selfies are approved. One-sided interest is never shown to the other person. It closes after 30 days with one calm note. At most 5 open.
- Selfie check once per account, approved by an admin. Needed before a chat opens or a first message is sent.
- Limits for everyone: 3 active conversations (paused chats count) and 5 hellos waiting. Graduated chats don't count.
- Ghosting rule: someone who lets 2 or more chats close unanswered within 60 days is shown last for 30 days. Never shown to anyone, resets on its own.
- Suspend switch: `users.suspended_at`, set after reviewing a report.

*Why:* one person a day keeps attention on one person at a time; more options lead to more rejecting. Limits keep people invested in a few friendships. The selfie check builds trust before meeting. The ghosting rule protects others without shaming anyone.

## 7. Chat

- Layout: the "What I want to remember about X" bar at the top; a plan bar only when there's a plan, a meetup waiting to be counted, or after meeting; prompt cards under the newest message.
- Header: their name (opens their profile) and how often they usually reply. Pause, End, Report and Block in one "⋯" menu.
- One line under the message box: a short tip for the first few messages ("Asking one question back keeps things going."), then "Not sure what they meant? Ask them. Only they know.", and "More tips" (Notice, Respond, Keep it going). Static text; nothing is sent anywhere.
- Scam note: until two people have met, if a message mentions money or moving off the app, the receiver sees a calm warning. Checked on the phone, nothing stored.
- Pause: 3 days, 1 week or 2 weeks, always with a short note in your own words; both see who paused and until when; no messages while paused; only the pauser can resume early; at most 2 pauses per person per chat in 30 days.
- End: with a short message (starters you finish) or without; "A short, honest note is kinder than going quiet."; the other person always sees an honest "this connection was ended" banner. Optional private reason, never shown to them.
- Report (8 categories, unsafe meetup shows 911 and hotlines) and Block (instant, both ways).

*Why:* read receipts stay hidden because "seen but no reply" feeds worry. Pause and honest End make stepping back or ending kinder than going quiet.

## 8. Reminders and notifications

- Getting started (only while just one person has written): the other person gets one note ("X said hello and hasn't heard back yet": Reply / Later / Not for me) at their own reply pace. The writer sees a calm line from 36 hours and "It's been quiet since your hello" at 5 days. A chat nobody answered closes quietly at 7 days.
- Once both have written, quiet is normal: no reply reminders, nothing closes on its own. (The old chat check-in is retired; quiet chats come up as Your circle suggestions.)
- Meet-in-person nudges: after about 3 weeks of real talking with no meetup ("Want to plan something?"), and honest checks at about 2 and 6 months. After meeting, they start over from the last meetup. Paused time doesn't count.
- Settings, "Reminders and nudges": each kind can be turned off for all chats; in a chat, "Reminders" is one switch. The getting-started note can't be turned off.
- Notifications (built Oct 28, setup pending): phone push and email, per type and per channel, quiet hours 9 pm to 8 am. Never message text: "Maria S. said hello", "New message from Maria S.". Email only to the confirmed address.

*Why:* a first hello with no answer is where people feel rejected, so that's the one moment that gets a note. After that, silence is normal between friends, and the app can't tell a pause from a problem without reading messages.

## 9. Planning a meetup

(Stage 5 will replace most of this; see 02.)
- "Let's plan something" is one person's private draft: pick ideas (3 suggested plus your own), mark rough times over the next 2 weeks, add an optional note in your own words, then "Send invite". The invite is one chat message. Before a first meetup the sheet shows "Most people are glad to be asked..." (to be removed, see 02).
- The other person replies or taps "Pick a time that works". A time the sender offered sets the plan right away.
- Ideas (`plan-ideas` function, hand-written ideas as a fallback): never romantic, adult, risky or drinking-focused; public before the first meetup; within the stricter of the two people's budget, length and travel, never saying whose.
- Once agreed: "Add it to your calendar?" (Google / Apple or Outlook / Not now), again whenever the plan changes.
- Safety tips before a first meetup and on the morning-of card. A gentle note if a first meetup's place sounds like a home.

*Why:* safe, public, budget-friendly ideas lower the effort and risk of a first plan without anyone having to admit a tight budget.

## 10. Meetups

- Plan card: date, time, place (Google place search near your city, with a free backup), activity.
- Day before: "Still on?". Morning of: a private "How are you feeling?" ("Most people feel a bit nervous before meeting someone new. Having one question ready can help." plus your own Next time notes).
- After: "Did you meet?" asks both. One yes plus a week with no answer counts; a no from either doesn't.
- "Met up already? Add it" for meetups made outside the app; counts on the other person's yes, or after a week.
- After a good meetup: "Would you like to tell X how it was for you? Only if you want to." (Tell X / Plan another meetup / Remind me later / Not now). Today it adds "It usually means more to them than people expect." (to be removed, see 02).

*Why:* meetups are the real measure of a friendship, and graduation depends on them.

## 11. Notes ("What I want to remember about X")

- No AI, no tab. A private page per person with two tabs, Meetups and Notes, and a "Next time, ask X about..." list at the top.
- Three optional questions per meetup: "What did you learn about X?", "What did you enjoy?", "Next time, I'd love to ask X...".
- "Write something down": one open box, optional topics (Family, Work, Things they love, Going through, Ideas for us).
- Notes come back after a meetup counts and in the planning card. Notes stay after a chat ends and can be deleted anytime. Export in Settings.

*Why:* remembering details and following up is how people feel known. The point is the person's own attention, so no AI summaries.

## 12. Graduation

- Ready check at 6+ meetups that happened, the first 8+ weeks ago, each person proposed 2+: each is asked privately "You and X have met N times so far and have a good rhythm. Would you like to continue your friendship without Limen?" Graduates only on a mutual yes; nobody sees a non-matching answer.
- Decision point at 10 meetups or 6 months: graduate, keep going here, or close honestly.
- Graduated chats leave the 3-chat limit, keep their notes, and move to Friends in Your circle.

*Why:* leaving the app together is the success.

## 13. Settings and money

- Settings (in You, next to Profile): About Limen, edit profile, sign-in and recovery, selfie check, take a break (1 week / 2 weeks / 1 month), reminders and nudges, notifications, export notes, blocked accounts, reports filed, selfie review (admins), Terms/Privacy (placeholder), delete account, show tips again.
- About Limen page: "Most friendships don't end. They drift. Limen helps you keep up with the friends you have, reconnect with people you've lost touch with, and meet someone new, in person." What we hold to: Friendships are made of small moments, so that's what Limen helps with. / Your messages are yours. Limen may offer a few words to start; the rest is you. / Meeting in person is the point. Chatting is how you get there. / You decide. Every reminder can be turned off. / Limen is paid for by members, never by ads or by selling your information. (The name's meaning and a golden rule bullet are decided; see 02.)
- Money: free during the pilot ("Membership: Free during the pilot."). No Premium, no credits, no paid extras, no ads, no deals. Old purchase code is in the repo but unreachable.

*Why:* Okage should never earn more by keeping people in the app or selling them more matches.

## 14. How it looks (design guide, version 1)

Warm, calm and grown-up; a circle of people, not a form. Mockup: https://claude.ai/artifact/XvgxuczQnMpNYAtRpuXS4A. The founder may refine the look after pilot feedback, so colours and font live in one theme file (`src/theme/tokens.js`).

- **Layout:** phone first. On screens wider than about 720px, content sits in a centred column (about 640px, up to 720px for chat), with tabs in a top bar; bottom tabs on phones. Body lines around 50 to 75 characters. Generous spacing; sections separated by space, not lines.
- **Faces:** every person shows a round face: their photo for Limen people, a coloured initial for added friends (colour by circle). Never a name without a face.
- **Colours** (light by default; warm dark only on dark devices): background cream #FBF7F2; cards #FFFDFA; borders #EDE4DA; text #2A2420; secondary text #6B5F57; main action apricot #B95A1E with white text; links #94451A (hover #7E3415), never #B95A1E for small text; honey highlight #FFF4DC with border #F0DDB2. Circle colours (ring / face / face text): Close #F8E1D2 / #F3D3BF / #7E3415; Friends #FBF0DD / #F5DFAE / #6E5418; Getting to know #EEF5F1 / #C9E3D6 / #2F5E49; Want to reconnect (dashed) #DCCFC2 / #E4DDD6 / #4E443D. All text 4.5:1 contrast.
- **Avoid:** yellow as the main colour (Bumble), pink (reads romantic), cold blue or grey, gradients, emoji.
- **Type:** Figtree, weights 400 to 700. Body 16px, nothing under 14px except tiny ring labels (12px). Headings 28px phone, 34px laptop. Sentence case everywhere.
- **Shapes:** rounded. Cards 16 to 20px corners, pill buttons, round faces.
- **Taps (one rule app-wide):** one filled apricot pill for the main action, outlined pills for the rest, at most one filled button per card. Anything that opens something is a whole tappable row or card with a chevron. Links only inside sentences, underlined. Never a bare coloured word as an action. Touch targets at least 44px. Tips: one or two short lines with a "Got it" button.

*Why:* people judge a screen's appeal in about 50 ms (Lindgaard 2006); faces make a site feel warm and trustworthy (Cyr 2009); people prefer curves (Bar and Neta 2006); weak tap cues make people hesitate.
