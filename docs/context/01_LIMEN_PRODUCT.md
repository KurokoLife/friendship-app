# Limen: what it is and how it works today

Last updated 2026-10-28. Since Oct 25 the rebuild guideline docs/context/05_LIMEN_REBUILD.md sets the direction; this file still describes what is built, stage by stage. Short version of docs/DECISIONS.md, docs/LIMEN_V2_DECISIONS.md and the "LIMEN V2 DECISIONS" bullets at the top of AGENTS.md. Where older documents disagree (docs/archive/AGENTS_FULL_HISTORY.md, docs/archive/PROGRESS_HISTORY.md, CURRENT_STATE.md, FULL_APP_INVENTORY.md, PRODUCT_GUIDE.md, the blueprint), this file and those three win.

## 1. What Limen is

Limen helps adults make real friends. Open to all ages and genders, especially 40+. (Since Oct 18 it no longer leads with big life changes.) It helps two people go from a first hello to meeting in person regularly, and then to keep going outside the app ("graduation"). Limen is for friendship only: romantic or sexual advances, or asking for money, lead to removal.

## 2. Principles (every feature must pass these)

1. Limen builds adult friendship. It is not a dating app with friends.
2. Features reduce the hard parts of making friends. They don't remove them.
3. Features help people see the other person's view and get out of their own head.
4. AI assists. It never does what the people are supposed to do.
5. AI never writes, rewrites or polishes a message. A message is a show of care.
6. Limen is not meant to be convenient. It builds the "friendship muscle".

Working rules that follow from these:
- No one, and no AI, reads your chats. Every reminder uses timing only. The one exception is the scam word check, which runs on the receiver's own phone and sends or stores nothing.
- Starters are fine, but the person must finish them in their own words (`StemMessageBox`).
- Equal choices, no pushing, no guilt, never act on someone's behalf.
- The word "AI" never appears in the app. Limen helps with gentle nudges, reminders and questions.
- A card that was answered halfway comes back after a page refresh until it's closed.
- First-time tips are a calm card inside the page (never a box over buttons), once per account, on each tab, Inbox Pending, Settings, Guide, a person's profile and in chats. "Show tips again" in Settings brings them back.
- Reduce anxiety: calm, honest copy. Never "your turn". No therapy language. No em dashes.
- Private stays private. Nobody ever sees another person's private answers.
- Only one prompt card shows in a chat at a time, and every card can be put away or turned off. At moments where people guess or hesitate, a card carries one short, true line (for example "After meeting someone new, most people think it went less well than the other person does."), never a guess about the other person.
- Read receipts are never shown to the sender. No swipe, no likes, no romance features.
- Limen is for meeting in person. Every chat shows: "Limen is for meeting in person. Chatting is how you get there."

## 3. Joining (onboarding)

Since Oct 26 (rebuild stage 2, exact wording from 05):
1. Intro, two screens: "Most friendships don't end. They drift." (Next), then "Friendships are made of small moments." with the three ways Limen helps (keep up with friends you have, reconnect, meet someone new one at a time in person), "Wherever your friendships are right now, you can start here.", "Join Limen" and "Already a member? Sign in".
2. Phone number and code (sign-up). 3. Basics (name, birthdate; under 18 turned away, the database refuses it too).
4. What's hardest about friendship for you right now? Ten choices, pick any, plus Something else in your own words. Private, never used for matching.
5. Think about your friends right now: names, each with a circle (Close by default; "Anyone you've lost touch with..." goes to Want to reconnect), saved straight into Your circle with the circle's default rhythm. "Most adults name one to four close friends. None is more common than people think." Skippable.
6. Here's where Limen can help: five choices, filled in from What's hardest, changeable.
7. With Meet someone new: the profile, as before: Start with you (with the liking-gap line at the top; what brings you here and up to 3 stories, saved as you write), What you enjoy, practical bits (location; friendship type, meeting pace, reply pace, free times; bars or drinks; Good to know about me; languages), who you'd like to meet and ages, How you connect (6 questions, then Share / Keep private), photo, Before you start (the ground rules), "Here's what people will see" preview.
   Without it: no profile; Your circle offers it later in a card ("Meet someone new, too?"; Not now brings it back about 30 days later, the third Not now ends it, setting up a profile ends it), and Discover shows an invitation instead of people. They aren't shown to anyone until they finish a profile.
8. Everyone: Keep your account safe (account recovery, optional), then All set (with the selfie check offer only for Meet someone new).

Saved as you go; opening the app while joining goes back to the first unfinished step. Back on every screen after the first. No "Step N of 10", no "Required" labels. Members who joined before Oct 26 count as having chosen Meet someone new.

## 4. Profile

- Fill in: what brings you here (own words); 1 to 3 stories (own words, optional guides); interests (32 categories, own line and optional details); location; friendship type, meeting pace, reply pace, usual free times; bars or drinks; Good to know about me; languages; 1 face photo required, 2 more optional. Values, opening up, hangout style and "Right now" are no longer asked (Oct 18).
- Others see: a small photo next to the name ("See N photos" opens them large), first name, a 5-year age range (18-24, 25-29, 30-34 ... 65-69, 70+; since Oct 22), distance, then what brings them here, their stories, what they enjoy (own line first), looking for, and a compact "How they like to connect" box (meeting up, replies, free times, bars or drinks, languages, good to know). Discover cards show only their own words: what brings them here and the opening of a story.
- Private: phone, recovery login, selfie, exact location, birthdate, gender and who you want to meet, hidden life transitions, How you connect answers unless you choose to share them with people you connect with.
- Curiosity notes: while reading a profile you can privately write "I wonder...". Only you see it.
- One shared view (`public-profile-view.tsx`) for other people's profiles and "See exactly what others see". The preview ends with "Only people you have a chat with also see": your friendship answers, if you chose to share them (Oct 23).
- Edit profile: a short list of parts, each opens alone; each says in plain words how it's used. Matching uses who you'd like to meet, ages, distance and a shared language (requirements), and meeting pace 40, interests 40, friendship type 20 (score). People's own words are never used for matching.
- You as a friend (Profile): your How you connect answers, with Edit, and whether you share them. The written summary was removed Oct 18.
- Shared friendship answers (since Oct 22, by choice): people you have a chat with see "How X approaches new friendships" on your profile (and a link under your care words in the chat header): your answers to the four questions about now (what feels hardest right now, after a good first meetup, when someone takes a while to reply, when something feels awkward). The two about past friendships always stay private. Private by default; never on public profiles or in Discover.

## 5. Discover and connecting

- Tabs (since Oct 25, rebuild stage 1): Your circle (home, first), Chats, Discover, You (and Test for admins and test accounts). Members land in Your circle. No Browse, no Remember tab, no Guide.
- Your circle: four circles, Close / Friends / Getting to know / Want to reconnect. Limen people are placed on their own: an open or paused chat, and people you said Interested to ("Waiting to connect", with why), go in Getting to know; graduated friends in Friends. Ended, closed and blocked people never appear. "Move" puts anyone in another circle (private; holds until Limen's own placement changes). "Add someone" adds a friend from outside Limen: name, circle, how often you'd like to be in touch (choices that fit the circle), optional note; no phone or email. Tap a Limen person (row or face in the circles) for the chat, an added friend for their page: face (optional private photo), name, circle, how often, when Limen will bring them up again, note, Edit. No "last talked" dates. Since Oct 28 (stage 3): one suggestion at a time at the top (friends outside Limen and Limen people whose chat both wrote in), due when their next check-in date comes (last time in touch + rhythm); a line from 05 with a why and its source; I reached out / Not now (back in about a week) / Fewer suggestions (one step slower); how often in Settings (a couple of times a week, once a week, every two weeks, none); after 3 Not nows in 4 weeks one optional "what gets in the way?" question, answers shown back on You. On the phone app a friend can be linked to a phone contact (only which contact, never a number or email) for Text / Call / Email; on a computer "Reach out however you usually do" and "I reached out". The "You" center shows your photo and opens your profile.
- Chats: active and paused chats and new hellos, then Past at the bottom. Discover: today's person, then Saved below. You: a Profile | Settings switch.
- Look (since Oct 25, design guide v1): cream background, Figtree, apricot filled main buttons, outlined pill buttons, underlined links only inside sentences, rows with a chevron; bottom tabs on phones, a top bar and a centered column on wide screens. Your circle shows a circles picture with faces; you move someone from their own page.
- One new person a day (in your own time zone), up to 3 waiting; the oldest gives way. Nobody shows while you have 3 active chats, and people with 3 active chats never appear. Never anyone you've had a chat with, in any state. Someone whose card passed can come back after 21 days, at the bottom. Picked by scoring (`generate-match-suggestions`, which only adds today's one person; `get_discover` decides what shows). Since Oct 18: a shared language is required; scores are meeting pace 40, interests 40, friendship type 20. People's own words and How you connect answers are never used.
- Saved: at most 5, each for 30 days, listed below today's person in Discover. Saving moves the person out of today's list. Anyone you start a chat with leaves Saved. People you said Interested to are in Your circle, Getting to know (not Saved).
- "Interested" instead of "Say hello". The chat opens only when both say Interested. One-sided interest is never shown to the other person, but it quietly moves you to the front of their next suggestions. The person shows in Your circle as "Waiting to connect", even before your selfie is approved. The chat opens when both said Interested and both selfies are approved; the row says what it's waiting for (the other person, your selfie, their selfie check, or room for a new chat). It closes on its own after 30 days if no chat opened, with one calm note in Your circle ("Your interest in X has come to a close..."). At most 5 open.
- Selfie check: once per account, approved only (reviewed by an admin in Settings). Needed before a chat opens or a first message is sent (since Oct 14 you can say Interested before it's approved; the person waits in Pending). While it waits: "Your selfie is waiting for our review". Two people who already talked can reconnect without it.
- Limits for everyone: 3 active conversations (paused chats count) and 5 hellos waiting for a reply. Graduated chats don't count. Inbox shows "N of 3 active conversations · room for N more".
- Chats: active and paused chats and new hellos first, Past at the bottom (ended, closed, blocked, with history and notes). Graduated friends are in Your circle, under Friends. The person who blocked can "Hide this chat"; the blocked person only sees "Not available".
- A match with no hello: a gentle suggestion from 2 days, closes quietly at 14 days.
- Ghosting rule: someone who lets 2 or more chats close unanswered within 60 days is shown last in suggestions for 30 days. Never shown to anyone, resets on its own.
- Suspend switch: `users.suspended_at` (set in Supabase after reviewing a report).

## 6. Chat

- Layout (phone first, calmer since Oct 23): the "What I want to remember about X" bar at the top; a plan bar only when there's a plan, a meetup waiting to be counted, or after you've met ("Met N times", pace and history); prompt cards under the newest message. No guide offers inside chats.
- Header (Oct 23): their name (tap it for their profile, which for people you have a chat with starts with how they approach new friendships, if they shared it) and how often they usually reply. Pause, End, Report and Block are in one "⋯" menu (Block in red).
- One line under the message box (Oct 23, merged with Reflect first): a short tip for your first few messages ("Asking one question back keeps things going.", then a follow-up question tip), then "Not sure what they meant? Ask them. Only they know.", followed by "More tips", which opens the Reflect first tips (Notice, Respond, Keep it going). Static text, nothing is sent anywhere. The app never interprets the other person and never checks a message.
- Scam note: until you've met in person, if a message from the other person mentions money (money, cash, amounts, Apple Card, gift cards, crypto, bank details) or moving off the app (WhatsApp, Telegram, a phone number or email), the receiver sees a calm warning under the newest such message. Checked on the phone, nothing stored.
- Pause: 3 days, 1 week or 2 weeks (still counts as one of your 3 active chats); always with a short note in your own words; both people see who paused and until when; no messages while paused; only the pauser can resume early; the other person can end; at most 2 pauses per person per chat in 30 days.
- End (honest exit): send a short message (starters you finish yourself) or end without one; the other person still sees an honest "this connection was ended" banner. Optional private reason, never shown to them. Reopening an ended chat takes an extra confirm.
- Report (8 categories, unsafe meetup shows 911 and hotlines, can also block) and Block (instant, both directions; the blocked person only sees "This conversation isn't available anymore").

## 7. Reminders (quiet by design)

- Getting started (only while just one person has written): the other person gets one note ("X said hello and hasn't heard back yet": Reply / Later / Not for me) at their own reply pace (1, 2 or 3 days). The writer sees a calm "it can take a few days" line from 36 hours and "It's been quiet since your hello" at 5 days. A chat nobody answered closes quietly at 7 days.
- Once both have written, quiet is normal: no reply reminders, nothing closes on its own.
- Check-in: retired Oct 28 (stage 3). Quiet Limen chats come up as suggestions in Your circle instead.
- Meet-in-person nudges: after about 3 weeks of real talking with no meetup ("Want to plan something?"), and honest checks at about 2 and 6 months (plan / keep chatting / end kindly). After meeting, they start over from the last meetup, following the person's own pace if they set one. Paused time doesn't count. Nothing closes on its own.
- Settings, "Reminders and nudges": check-ins, meet nudges, morning-of check, calendar question and notes coming back can each be turned off for all chats ("Short guides" removed with the Guide, Oct 25). In a chat, "Reminders" is one switch for that chat (Oct 23); a card's own "turn off for this chat" link still works. The getting-started note can't be turned off.
- Notifications (since Oct 28, stage 3b): phone push and email, chosen per type (a new hi, new messages, plans and meetups, suggestions) and per channel in Settings, with quiet hours (9 pm to 8 am by default). They never show message text: "Maria S. said hello", "New message from Maria S." (at most one per chat an hour), plan lines, and for suggestions only the name and the plain line. Email goes only to the address confirmed in Sign-in and recovery; phone push is turned on from Settings.

## 8. Planning a meetup

- "Let's plan something" is one person's private draft (each person has their own, since Oct 22), and it lives only in its window: nothing about an unsent invite shows in the chat. "Save for later" (or tapping outside) keeps it, and "Let's plan something" reopens it where it was left; "Cancel" throws it away. It's the one way to plan (since Oct 23 the plan bar has no "Plan a meetup"); "Met up already? Add it" is at the top of this window. The Inbox row doesn't mention an unsent invite. In the window: pick ideas (3 suggested plus your own), mark any number of rough times (morning / afternoon / evening, next 2 weeks; the card shows when the other person is usually free), add an optional note in your own words (starters include questions like "Is there anything you've been wanting to try?"), then "Send invite". All on one screen, one place to write, one Send (since Oct 13). An unsent note survives a refresh. The invite is one chat message. A newer invite replaces an older one.
- The other person replies in the chat or taps "Pick a time that works". A time the sender offered sets the plan right away; a different time goes back to the sender to confirm. The sender can also "Set the plan" after agreeing in the chat.
- Ideas (`plan-ideas` server function; hand-written fallback ideas when it's unavailable): never romantic, adult, risky or drinking-focused; public before the first meetup; use the stricter of the two people's budget, length and travel (never says whose); a home idea only when one said "happy to host" and the other "happy to go to theirs" (asked privately after the first meetup). Headings like "You both like X" only from a real listed interest.
- Once a plan is agreed, each person is asked "Add it to your calendar?" (Google / Apple or Outlook / Not now), and again whenever the plan changes.
- Safety tips (public place, own way home, keep it short, share location with a friend from your phone, trust how you feel, Report/Block, 911) on the plan card and editor before a first meetup and on the morning-of card. A gentle note if a first meetup's place sounds like a home. No "share my plan" feature.

## 9. Meetups

- Plan card: date, time, place (Google place search near your own city, nearest first with distance, OpenStreetMap as the backup; Google/Apple Maps links), activity. Moving the plan needs the other person to confirm again; changing only the activity doesn't.
- Day before: "Still on?". Morning of: a private "How are you feeling?" (A little nervous: "Most people feel a bit nervous before meeting someone new. Having one question ready can help." plus your own Next time notes).
- After: "Did you meet?" asks both, 3 hours after the start (or 9am next day). One yes plus a week with no answer from the other counts. A no from either doesn't. Nobody answering for 2 weeks lets it go.
- "Met up already? Add it" adds a meetup made outside the app; it counts on the other person's yes, or after a week. An added meetup is never shown as an upcoming plan (fixed Oct 22: one added for today showed "Meeting today").
- Waiting to be counted (since Oct 22): the plan bar says "You said you met on Thu, Oct 22. It counts once X says yes too, or after a week." (or "X said you two met on ... It counts once you say yes too, or after a week."). Once it counts, the bar shows "Met N times".
- After a good meetup: "Would you like to tell X how it was for you? Only if you want to." (Tell X with starters / Plan another meetup / Remind me later: tomorrow, 3 days, a week / Not now).
- Meeting pace: you see your own; "You both said..." only when both picked the same.
- Meetup history page per chat.

## 10. Remember (private notes, in the chat)

- No AI, no tab. The "What I want to remember about X" bar opens a private page with two tabs (Oct 23), like Inbox: Meetups (one card per meetup that counted, newest first) and Notes ("Write something down" notes, plus notes written on their profile with "Note it privately", the same notes, editable or deletable here). The "Next time, ask X about..." list sits above both tabs. A profile note made without ever chatting stays on their profile, only for you.
- Three optional questions per meetup: "What did you learn about X?", "What did you enjoy?", "Next time, I'd love to ask X...", plus room for anything else. A "Next time, ask X about..." list at the top, with "Asked".
- "Write something down" (a note not tied to a meetup): one open box, the first line becomes the title. Optional topic chips from a fixed list: Family, Work, Things they love, Going through, Ideas for us. No custom tags.
- Search and topic filters appear once there are 6 or more notes for that person.
- Your own notes come back after a meetup counts (asked once), inside the planning card (including notes marked "Ideas for us"), and in the check-in. Can be turned off.
- Notes stay after a chat ends (reached from Inbox) and can be deleted anytime. Export is in Settings. The mic icon is a placeholder.

## 11. Graduation

- One mechanism (`graduation_stage()`). Ready check at 6+ meetups that happened, the first 8+ weeks ago, each person proposed 2+ (about 3 months at twice a month; no meeting pace needed since Oct 13): each is asked privately "You and X have met N times so far and have a good rhythm. Would you like to continue your friendship without Limen?" (Yes / Not yet / I'm not sure this is a friendship). Graduates only on a mutual yes; nobody sees a non-matching answer.
- Decision point at 10 meetups or 6 months: graduate, keep going here (private reason), or close honestly.
- Graduated chats leave the 3-active limit, keep notes, and get 30/90-day continuation checks.

## 12. Guide

Removed Oct 25 (rebuild stage 1). No videos or reads in the app; a one-line "why" at the moment it helps replaces it.

## 13. Money and settings

- No Premium, no AI credits, no paid capacity, no ads, no venue, employer or health-plan deals. Free pilot first; after the pilot a 21-day free trial, then $39 for 90 days (decided Oct 14, not built). Settings shows "Membership: Free during the pilot." The "How Limen is paid for" page no longer describes what comes after the pilot. Old purchase code is in the repo but unreachable.
- Settings (in You, next to Profile, since Oct 25): About Limen, edit profile, sign-in and recovery, selfie check, take a break (1 week, 2 weeks or 1 month: nobody new shown to you or you to them, chats carry on), reminders and nudges, export notes, blocked accounts, reports you filed, selfie review (admins), Terms/Privacy (placeholder text), delete account, show tips again. Invite a friend is hidden during the pilot.
