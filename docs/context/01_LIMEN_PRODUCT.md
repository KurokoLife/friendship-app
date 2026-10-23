# Limen: what it is and how it works today

Last updated 2026-10-22. Short version of docs/DECISIONS.md, docs/LIMEN_V2_DECISIONS.md and the "LIMEN V2 DECISIONS" bullets at the top of AGENTS.md. Where older documents disagree (docs/archive/AGENTS_FULL_HISTORY.md, docs/archive/PROGRESS_HISTORY.md, CURRENT_STATE.md, FULL_APP_INVENTORY.md, PRODUCT_GUIDE.md, the blueprint), this file and those three win.

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

Since Oct 18, joining starts with the person (proposal doc "Limen: Joining and profile proposal"). Since Oct 19, sign-up comes right after the intro (like most apps), so writing is saved to the account and follows the person to any device:
1. Intro, one screen (since Oct 22): "Making friends as an adult is hard. It's not just you.", the liking-gap line, and "Limen introduces you to one person at a time, and helps with the parts that can feel awkward, from a first hello to meeting in person" (no promise of a friend), no swiping, no perfect profile. "Join Limen" and "Already a member? Sign in".
2. Phone number and code (sign-up).
3. Basics (name, birthdate). Under 18 is turned away here, before anything else (the database refuses it too).
4. Start with you: "What brings you to Limen?" (open box) and "Share a story so people can get to know you" (up to 3 stories; 5 optional guides to start from, never shown to readers). Saved to the account as the person writes, so they can start on the phone and finish on a computer. Someone who leaves comes back here, with what they wrote filled in.
5. What you enjoy: interests, each with an optional line in your own words (each interest shows its own example line).
6. Practical bits: where you're based; friendship type, meeting pace, reply pace, free times; bars or drinks (Fine with me / I'd rather not / I don't drink); Good to know about me; how I like care; languages (at least one; English starts selected). Then who you'd like to meet and ages.
7. How you connect: 6 questions about friendship habits, any number of answers each, then "Share with people you connect with?" (Share with people I connect with / Keep private, equal, no default). Never used for matching.
8. Photo. 9. Before you start: "Everyone here agrees to the same few things": Friendship only / Honest is kinder than quiet / Meet somewhere public first / Answer every hello, even with a "no thanks" (the quiet-chat rule spelled out: twice within two months, later in suggestions for the next month), then "Sounds good". 10. "Here's what people will see" preview. 11. Keep your account safe (account recovery, optional; moved here from after Basics). 12. All set, with the selfie check offer.

No "Step N of 10", no "Required" labels. Every joining screen after the intro has Back. The two onboarding videos and quiz were removed from joining (they stay in the Guide).

## 4. Profile

- Fill in: what brings you here (own words); 1 to 3 stories (own words, optional guides); interests (32 categories, own line and optional details); location; friendship type, meeting pace, reply pace, usual free times; bars or drinks; Good to know about me; "How I like care" (shown only to people you're connected with, at the top of your chat); languages; 1 face photo required, 2 more optional. Values, opening up, hangout style and "Right now" are no longer asked (Oct 18).
- Others see: a small photo next to the name ("See N photos" opens them large), first name, a 5-year age range (18-24, 25-29, 30-34 ... 65-69, 70+; since Oct 22), distance, then what brings them here, their stories, what they enjoy (own line first), looking for, and a compact "How they like to connect" box (meeting up, replies, free times, bars or drinks, languages, good to know). Discover cards show only their own words: what brings them here and the opening of a story.
- Private: phone, recovery login, selfie, exact location, birthdate, gender and who you want to meet, hidden life transitions, How you connect answers unless you choose to share them with people you connect with.
- Curiosity notes: while reading a profile you can privately write "I wonder...". Only you see it.
- One shared view (`public-profile-view.tsx`) for other people's profiles and "See exactly what others see".
- Edit profile: a short list of parts, each opens alone; each says in plain words how it's used. Matching uses who you'd like to meet, ages, distance and a shared language (requirements), and meeting pace 40, interests 40, friendship type 20 (score). People's own words are never used for matching.
- You as a friend (Profile): your How you connect answers, with Edit, and whether you share them. The written summary was removed Oct 18.
- Shared friendship answers (since Oct 22, by choice): people you have a chat with see "How X approaches new friendships" on your profile (and a link under your care words in the chat header): your answers to the four questions about now (what feels hardest right now, after a good first meetup, when someone takes a while to reply, when something feels awkward). The two about past friendships always stay private. Private by default; never on public profiles or in Discover.

## 5. Discover and connecting

- Tabs: Discover, Saved, Inbox, Profile (and Test for admins and test accounts). No Browse, no Remember tab, no Guide tab.
- One new person a day (in your own time zone), up to 3 waiting; the oldest gives way. Nobody shows while you have 3 active chats, and people with 3 active chats never appear. Never anyone you've had a chat with, in any state. Someone whose card passed can come back after 21 days, at the bottom. Picked by scoring (`generate-match-suggestions`, which only adds today's one person; `get_discover` decides what shows). Since Oct 18: a shared language is required; scores are meeting pace 40, interests 40, friendship type 20. People's own words and How you connect answers are never used.
- Saved: at most 5, each for 30 days. Saving moves the person out of Discover. Anyone you start a chat with leaves Saved. People you said Interested to are in Inbox, Pending (not Saved).
- "Interested" instead of "Say hello". The chat opens only when both say Interested. One-sided interest is never shown to the other person, but it quietly moves you to the front of their next suggestions. The person moves to Inbox, under Pending, even before your selfie is approved. The chat opens when both said Interested and both selfies are approved; Pending says what it's waiting for (the other person, your selfie, their selfie check, or room for a new chat). It closes on its own after 30 days if no chat opened, with one calm note in Pending ("Your interest in X has come to a close..."). At most 5 open.
- Selfie check: once per account, approved only (reviewed by an admin in Settings). Needed before a chat opens or a first message is sent (since Oct 14 you can say Interested before it's approved; the person waits in Pending). While it waits: "Your selfie is waiting for our review". Two people who already talked can reconnect without it.
- Limits for everyone: 3 active conversations (paused chats count) and 5 hellos waiting for a reply. Graduated chats don't count. Inbox shows "N of 3 active conversations · room for N more".
- Inbox tabs: Active (opens first: active and paused chats, new hellos), Pending (people you said Interested to, until the chat opens; only you see it), Friends (graduated), Past (ended, closed, blocked, with history and notes). The person who blocked can "Hide this chat"; the blocked person only sees "Not available".
- A match with no hello: a gentle suggestion from 2 days, closes quietly at 14 days.
- Ghosting rule: someone who lets 2 or more chats close unanswered within 60 days is shown last in suggestions for 30 days. Never shown to anyone, resets on its own.
- Suspend switch: `users.suspended_at` (set in Supabase after reviewing a report).

## 6. Chat

- Layout (phone first): a slim plan bar and a "What I want to remember about X" bar at the top (tap to open, Hide to close); prompt cards sit under the newest message. No guide offers inside chats (removed Oct 10; where guides belong is part of the Guide plan).
- Header actions: Pause · End · Report · Block.
- Header: name, how often they usually reply, and their "How I like care" words when they wrote any.
- One line under the message box: a stage tip for your first few messages ("Asking one question back keeps things going.", then a follow-up question tip), then "Not sure what they meant? Ask them. Only they know." for good.
- Reflect first: questions and tips shown under the message box, in three groups (Notice, Respond, Keep it going), including "Not sure what they meant? Ask them." Static text, nothing is sent anywhere. Under it: "Not sure what they meant? Ask them. Only they know." The app never interprets the other person ("Another way to see it" removed Oct 13) and never checks a message ("Check" removed Oct 10).
- Scam note: until you've met in person, if a message from the other person mentions money (money, cash, amounts, Apple Card, gift cards, crypto, bank details) or moving off the app (WhatsApp, Telegram, a phone number or email), the receiver sees a calm warning under the newest such message. Checked on the phone, nothing stored.
- Pause: 3 days, 1 week or 2 weeks (still counts as one of your 3 active chats); always with a short note in your own words; both people see who paused and until when; no messages while paused; only the pauser can resume early; the other person can end; at most 2 pauses per person per chat in 30 days.
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

- "Let's plan something" is one person's private draft (each person has their own, since Oct 22), and it lives only in its window: nothing about an unsent invite shows in the chat. "Save for later" (or tapping outside) keeps it, and "Let's plan something" reopens it where it was left; "Cancel" throws it away. In the window: pick ideas (3 suggested plus your own), mark any number of rough times (morning / afternoon / evening, next 2 weeks; the card shows when the other person is usually free), add an optional note in your own words (starters include questions like "Is there anything you've been wanting to try?"), then "Send invite". All on one screen, one place to write, one Send (since Oct 13). An unsent note survives a refresh. The invite is one chat message. A newer invite replaces an older one.
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

- No AI, no tab. The "What I want to remember about X" bar opens a private page, one card per meetup that counted (date and activity from the plan), newest first, plus "Since your last meetup".
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

Reached from Profile only. Today: 2 onboarding videos, "The First Meetup Does Not Need to Be Perfect", "Friendship Grows a Little at a Time", and 9 short reads. Draft plan (not decided): show each piece at the moment it helps, about 3 videos and 4 short reads. See claude/Guide_Draft_Plan.md.

## 13. Money and settings

- No Premium, no AI credits, no paid capacity, no ads, no venue, employer or health-plan deals. Free pilot first; after the pilot a 21-day free trial, then $39 for 90 days (decided Oct 14, not built). Settings shows "Membership: Free during the pilot." The "How Limen is paid for" page no longer describes what comes after the pilot. Old purchase code is in the repo but unreachable.
- Settings: edit profile, sign-in and recovery, selfie check, take a break (1 week, 2 weeks or 1 month: nobody new shown to you or you to them, chats carry on), reminders and nudges, export notes, blocked accounts, reports you filed, selfie review (admins), Terms/Privacy (placeholder text), delete account, show tips again. Invite a friend is hidden during the pilot.
