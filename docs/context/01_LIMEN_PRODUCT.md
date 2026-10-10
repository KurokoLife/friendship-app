# Limen: what it is and how it works today

Last updated 2026-10-10. Short version of docs/DECISIONS.md, docs/LIMEN_V2_DECISIONS.md and the "LIMEN V2 DECISIONS" bullets at the top of AGENTS.md. Where older documents disagree (docs/archive/AGENTS_FULL_HISTORY.md, docs/archive/PROGRESS_HISTORY.md, CURRENT_STATE.md, FULL_APP_INVENTORY.md, PRODUCT_GUIDE.md, the blueprint), this file and those three win.

## 1. What Limen is

A friendship app for adults going through change (divorce, a move, loss, a career change, an empty nest), open to all ages and genders, especially 40+. It helps two people go from a first hello to meeting in person regularly, and then to keep going outside the app ("graduation"). Limen is for friendship only: romantic or sexual advances, or asking for money, lead to removal.

## 2. Principles (every feature must pass these)

1. Limen builds adult friendship. It is not a dating app with friends.
2. Features reduce the hard parts of making friends. They don't remove them.
3. Features help people see the other person's view and get out of their own head.
4. AI assists. It never does what the people are supposed to do.
5. AI never writes, rewrites or polishes a message. A message is a show of care.
6. Limen is not meant to be convenient. It builds the "friendship muscle".

Working rules that follow from these:
- The app never reads message content. Every reminder uses timing only.
- Starters are fine, but the person must finish them in their own words (`StemMessageBox`).
- Equal choices, no pushing, no guilt, never act on someone's behalf.
- Reduce anxiety: calm, honest copy. Never "your turn". No therapy language. No em dashes.
- Private stays private. Nobody ever sees another person's private answers.
- Only one prompt card shows in a chat at a time, and every card can be put away or turned off.
- Read receipts are never shown to the sender. No swipe, no likes, no romance features.
- Limen is for meeting in person. Every chat shows: "Limen is for meeting in person. Chatting is how you get there."

## 3. Joining (onboarding)

11 screens: Intro → Phone number and code → Basics (first and last name, shown as "Maria S.", birthdate as Month/Day/Year, optional referral code with no reward promised) → Account recovery (Google, Apple, email, or skip; phone stays the sign-in) → Identity (your gender: Woman / Man / Non-binary; who you'd like to meet, mutual; age range) → Profile build (10 steps) → How you connect (10 questions, then one AI reflection about yourself, not used for matching) → Two required videos ("Begin With Curiosity", "How We Show Up") → Readiness (friendship-only rule, scam check, ghosting rule) → All set ("You'll get up to 3 a week") with an offer to do the selfie check now or later.

## 4. Profile

- Fill in: location; what brings you here (up to 3, can be hidden from the profile but still used for matching); "Right now, I'm..." (150 characters); 1 to 3 stories in your own words to character prompts (no "Ask me about"); "How I like care" (own words, 400 characters, shown only to people you're connected with, inside Reflect); up to 5 of 20 values; activities (32 categories, optional details); hangout style; friendship type, meeting pace, reply pace, usual free times; opening-up pace; whether bars or drinks are okay; hard nos (shown, don't hide anyone); languages; 1 face photo required, 2 more optional.
- Others see: a curiosity section first (photos, first name, age range, distance, "Right now", stories, what brings you here, values, activities, friendship type), then a compact "How they like to connect" box.
- Private: phone, recovery login, selfie, exact location, birthdate, gender and who you want to meet, hidden life transitions, reflection answers.
- Curiosity notes: while reading a profile you can privately write "I wonder...". Only you see it.
- One shared view (`public-profile-view.tsx`) for other people's profiles and "Preview my public profile".

## 5. Discover and connecting

- Tabs: Discover, Saved, Inbox, Profile (and Test for admins and test accounts). No Browse, no Remember tab, no Guide tab.
- 3 suggestions per rolling 7 days, for everyone, chosen by AI scoring (`generate-match-suggestions`). Matching weights: life situation 30, values 25, meeting rhythm 13, plus hangout style, friendship type, language, opening-up pace, activities. Personality answers are not used.
- Saved: no expiry. A save disappears only if an account is deleted or the pair no longer fits gender or age.
- "Interested" instead of "Say hello". The chat opens only when both say Interested. One-sided interest is never shown to the other person, but it quietly moves you up in their next suggestions.
- Selfie check: once per account, approved only (reviewed by an admin in Settings). Needed before saying Interested or sending a first message. While it waits: "Your selfie is waiting for our review". Two people who already talked can reconnect without it.
- Limits for everyone: 3 active conversations and 5 hellos waiting for a reply. Graduated chats don't count. Inbox shows "N of 3 active conversations · room for N more".
- A match with no hello: a gentle suggestion from 2 days, closes quietly at 14 days.
- Ghosting rule: someone who lets 2 or more chats close unanswered within 60 days is shown last in suggestions for 30 days. Never shown to anyone, resets on its own.
- Suspend switch: `users.suspended_at` (set in Supabase after reviewing a report).

## 6. Chat

- Layout (phone first): a slim plan bar and a "What I want to remember about X" bar at the top (tap to open, Hide to close); prompt cards sit under the newest message.
- Header actions: Pause · End · Report · Block.
- Reflect (AI, `reflection-coach`): "Check" gives fixed observations about your own draft (didn't ask anything back, didn't share anything of yours, missed their point, jumped much deeper); "Another way to see it" gives three readings (their circumstances, how they might see you, your fear), never a verdict, and always ends by sending you back to ask them. It never writes a message. Shows the other person's "How I like care" when there is one. `generate-reply-draft` is retired.
- Scam note: if an early message from the other person mentions money or moving to another app, the receiver sees a calm warning. Checked on the phone, nothing stored.
- Pause: 3 days, 1 week or 2 weeks; always with a short note in your own words; both people see who paused and until when; no messages while paused; only the pauser can resume early; the other person can end; at most 2 pauses per person per chat in 30 days.
- End (honest exit): send a short message (starters you finish yourself) or end without one; the other person still sees an honest "this connection was ended" banner. Optional private reason, never shown to them. Reopening an ended chat takes an extra confirm.
- Report (8 categories, unsafe meetup shows 911 and hotlines, can also block) and Block (instant, both directions; the blocked person only sees "This conversation isn't available anymore").

## 7. Reminders (quiet by design)

- Getting started (only while just one person has written): the other person gets one note ("X said hello and hasn't heard back yet": Reply / Later / Not for me) at their own reply pace (1, 2 or 3 days). The writer sees a calm "it can take a few days" line from 36 hours and "It's been quiet since your hello" at 5 days. A chat nobody answered closes quietly at 7 days.
- Once both have written, quiet is normal: no reply reminders, nothing closes on its own.
- Check-in: after both wrote and 5 quiet days, each person privately gets "It's been quiet with X for a bit. That's normal..." (Say hi with starters / Not now / Turn off for this chat). Once per quiet stretch, not while a plan is set.
- Meet-in-person nudges: after about 3 weeks of real talking with no meetup ("Want to plan something?"), and honest checks at about 2 and 6 months (plan / keep chatting / end kindly). After meeting, they start over from the last meetup, following the person's own pace if they set one. Paused time doesn't count. Nothing closes on its own.
- Settings, "Reminders and nudges": check-ins, meet nudges, morning-of check, calendar question, short guides and notes coming back can each be turned off for all chats or one chat. The getting-started note can't be turned off.
- No push notifications exist yet. Everything shows when the app is opened.

## 8. Planning a meetup

- "Let's plan something" is one person's private draft: pick ideas (3 suggested plus your own), mark any number of rough times (morning / afternoon / evening, next 2 weeks; the card shows when the other person is usually free), add an optional note in your own words, then "Send invite". The invite is one chat message. A newer invite replaces an older one.
- The other person replies in the chat or taps "Pick a time that works". A time the sender offered sets the plan right away; a different time goes back to the sender to confirm. The sender can also "Set the plan" after agreeing in the chat.
- Ideas (`plan-ideas` server function; hand-written fallback ideas when it's unavailable): never romantic, adult, risky or drinking-focused; public before the first meetup; use the stricter of the two people's budget, length and travel (never says whose); a home idea only when one said "happy to host" and the other "happy to go to theirs" (asked privately after the first meetup). Headings like "You both like X" only from a real listed interest.
- Once a plan is agreed, each person is asked "Add it to your calendar?" (Google / Apple or Outlook / Not now), and again whenever the plan changes.
- Safety tips (public place, own way home, keep it short, share location with a friend from your phone, trust how you feel, Report/Block, 911) on the plan card and editor before a first meetup and on the morning-of card. A gentle note if a first meetup's place sounds like a home. No "share my plan" feature.

## 9. Meetups

- Plan card: date, time, place (OpenStreetMap search with Google/Apple Maps links), activity. Moving the plan needs the other person to confirm again; changing only the activity doesn't.
- Day before: "Still on?". Morning of: a private "How are you feeling?" (Nervous offers the video "The First Meetup Does Not Need to Be Perfect").
- After: "Did you meet?" asks both, 3 hours after the start (or 9am next day). One yes plus a week with no answer from the other counts. A no from either doesn't. Nobody answering for 2 weeks lets it go.
- "Met up already? Add it" adds a meetup made outside the app; it counts on the other person's yes, or after a week.
- After a good meetup: "Would you like to tell X how it was for you? Only if you want to." (Tell X with starters / Plan another meetup / Remind me later: tomorrow, 3 days, a week / Not now).
- Meeting pace: you see your own; "You both said..." only when both picked the same.
- Meetup history page per chat.

## 10. Remember (private notes, in the chat)

- No AI, no tab. The "What I want to remember about X" bar opens a private page, one card per meetup that counted (date and activity from the plan), newest first, plus "Since your last meetup".
- Three optional questions per meetup: "What did you learn about X?", "What did you enjoy?", "Next time, I'd love to ask X...", plus room for anything else. A "Next time, ask X about..." list at the top, with "Asked".
- Your own notes come back after a meetup counts (asked once), inside the planning card, and in the check-in. Can be turned off.
- Notes stay after a chat ends (reached from Inbox) and can be deleted anytime. Export is in Settings. The mic icon is a placeholder.

## 11. Graduation

- One mechanism (`graduation_stage()`). Ready check at 6+ meetups that happened, the first 8+ weeks ago, each person proposed 2+, a rhythm set: each is asked privately "Could you two keep this going outside Limen?" (Yes / Not yet / I'm not sure this is a friendship). Graduates only on a mutual yes; nobody sees a non-matching answer.
- Decision point at 10 meetups or 6 months: graduate, keep going here (private reason), or close honestly.
- Graduated chats leave the 3-active limit, keep notes, and get 30/90-day continuation checks.

## 12. Guide

Reached from Profile only. Today: 2 onboarding videos, "The First Meetup Does Not Need to Be Perfect", "Friendship Grows a Little at a Time", and 9 short reads. Draft plan (not decided): show each piece at the moment it helps, about 3 videos and 4 short reads. See claude/Guide_Draft_Plan.md.

## 13. Money and settings

- No Premium, no AI credits, no paid capacity, no ads, no venue, employer or health-plan deals. Free pilot first; later a pick-your-price Journey pass (Free / $18 / $30 suggested / $60). Settings shows "Membership: Free during the pilot." Old purchase code is in the repo but unreachable.
- Settings: edit profile, preview profile, reminders and nudges, export notes, blocked accounts, reports you filed, selfie review (admins), Terms/Privacy (placeholder text), delete account, show tips again.
