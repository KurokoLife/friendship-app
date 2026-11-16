# Code sweep: on-screen lines that only live in the code (2026-11-16)

A list only. Nothing below has been changed. Each line was checked against docs/context/00_CORE.md, including "How it should feel". Lines already decided in 02 (Say hi, stage 5 planning, stage 6 voice pass such as "Reflect first" and "What I want to remember about X") are left out unless they break a Core rule today.

Areas covered: chat tips ("Reflect first" / More tips, the line under the message box), cards in the chat, empty states, first-time tips, Settings, Discover, Chats, Profile, joining, plan-ideas reasons and the hand-written ideas, the scam note, Report, notifications.

## 1. Apology starters (Core: "An apology is never a starter")

| # | File | Today | Proposed | Why |
|---|---|---|---|---|
| 1 | `src/components/primary-intervention-card.tsx:232` (reply starters on "X said hello and hasn't heard back yet") | "Hi! Sorry for the slow reply," | Remove it. "Good to hear from you," and "It's been a busy few days," stay. | An apology has to come from the person. |
| 2 | `src/components/primary-intervention-card.tsx:412` (morning-of "cancel" starters) | "Sorry, I need to cancel today," | Remove it. "Something came up and I can't make it today," stays. | Same. Stage 5 rebuilds this flow, but the line is live now. |
| 3 | `src/components/next-meetup-indicator-v2.tsx:91` (cancel plan starters) | "Sorry, I need to cancel our plan," | Remove it. "Something came up and I can't make it," stays. | Same. |

## 2. Promises about the other person's reaction

| # | File | Today | Proposed | Why |
|---|---|---|---|---|
| 4 | `src/app/thread/[id].tsx:1382` (line under the message box, messages 2 to 4) | "A follow-up question, like 'how did that go?', helps people feel heard." | "A follow-up question, like 'how did that go?', is an easy next step." | Says how the other person will feel. |
| 5 | `src/app/big-five-assessment.tsx:155` (How you make friends, the show-or-keep-private step) | "Knowing what feels hard for someone helps the other person make it easier. And people usually see this kind of sharing more kindly than the person sharing expects." | "Either choice is fine." (the line under it already says who sees what and that it can change) | Promises the reader's reaction, and "sharing" is a word to avoid. Choice should be equal with no push. |
| 6 | `src/components/primary-intervention-card.tsx:1590` (the old chat check-in card) | "A message out of the blue is usually more welcome than the person sending it expects." | Remove the line (or use "A check-in is one way to show someone you're thinking of them."). | Reaction claim. The card is retired for members, but the Test tab can still bring it up (qa-notes shows it), so it should go or be deleted with the card in stage 6. |
| 7 | `supabase/functions/plan-ideas/index.ts:149` (rules for idea descriptions) | Rules cover safety only. Nothing stops a description like "a great way to bond" or "they'll love it". | Add a rule: "Describe the activity only. Never say how either person will feel or react, and never call it a way to bond or connect." | The ideas are written by a model at run time, so the rule has to be in the prompt. Needs a redeploy of `plan-ideas`. |

## 3. Guessing, or telling people how to feel

| # | File | Today | Proposed | Why |
|---|---|---|---|---|
| 8 | `src/components/primary-intervention-card.tsx:1010` ("Did you meet? No") | "That's disappointing. Plans fall through for all kinds of reasons. If you'd like to know what happened, you can ask. ..." | Drop "That's disappointing." Keep the rest (approved line). | Tells the person how to feel about it. |
| 9 | `src/components/universal-text-box.tsx:35` (More tips, Notice) | "What did they share? What part seems to matter most to them?" | "What did they tell you? Is there a part you'd like to ask more about?" | Guessing what matters to them; points to asking instead. Also "share". |
| 10 | `supabase/migrations/20261009000004_plan_together.sql:829` (hand-written idea) | "A walk through a neighborhood you both like" | "A walk through a lively neighborhood" | Claims something about both people that nobody said. |
| 11 | `src/components/primary-intervention-card.tsx:1691` (after graduating) | "Friendships still need tending. Limen will check in privately in a month, and again in three." | "Limen will check in privately in a month, and again in three." | The first sentence lectures, at a happy moment. Fewer words. |

## 4. Golden rule questions outside the five places

| # | File | Today | Proposed | Why |
|---|---|---|---|---|
| 12 | `src/components/universal-text-box.tsx:43` (More tips, Respond, in every chat) | "If you had shared this, how would you want someone to respond?" | Remove it. | The golden rule shows at five places only; this is on every chat's tips. |
| 13 | `src/components/universal-text-box.tsx:69` (tips while writing an ending note) | "If you were on the other side, what would you want to hear, and what would you not want to hear?" | Remove it. "What is the honest reason, in one sentence, for you?" stays. | Same rule. The founder kept the End line as is and turned down a golden rule version there. |

## 5. Words to avoid (share, connection, connect, habit)

| # | File | Today | Proposed |
|---|---|---|---|
| 14 | `src/components/universal-text-box.tsx:45` | "Share a little of yourself back, about as much as they shared." | "Tell them a little about yourself too, about as much as they told you." |
| 15 | `src/components/shared-friendship-answers.tsx:16` | "{name} chose to share this with people they connect with." | "{name} chose to show these to people they chat with." (matches the new "Show these to people you chat with?") |
| 16 | `src/app/(tabs)/profile.tsx:325` | "A few questions about how friendships tend to go for you. Private unless you choose to share some." | "...Private unless you choose to show some to people you chat with." |
| 17 | `src/app/big-five-assessment.tsx:159, 185` | "If you share, only people you have a chat with see..." / "Choose whether to share" | "If you show them, only people you have a chat with see..." / "Choose whether to show them" |
| 18 | `src/app/start-with-you.tsx:187, 201` | "Share a story so people can get to know you." / "You can share up to three." | "Tell a story so people can get to know you." / "You can add up to three." |
| 19 | `src/components/safety-tips.tsx:54` | "Most meetups are simply nice. A few habits make meeting someone new feel easier." | "...A few small things make meeting someone new feel easier." |
| 20 | `src/components/public-profile-view.tsx:264` | "How they like to connect" (meeting pace, reply pace, friendship type) | "How they like to keep in touch" |
| 21 | `src/app/profile-build.tsx:1343` | "Languages I am comfortable connecting in" | "Languages I'm comfortable talking in" |
| 22 | `src/lib/friendship-experience.ts:52` (a How you make friends question) | "When a promising new connection faded, what usually happened?" | "When a promising new friendship faded, what usually happened?" |
| 23 | Chat and End screens: `src/app/thread/[id].tsx:872, 921, 952, 959, 1212, 1239`; `src/components/end-connection-modal.tsx:100, 110, 112, 252`; `src/app/candidate/[id].tsx:440, 442`; `src/lib/friendship-journey.ts:361`; `src/components/primary-intervention-card.tsx:1544` | "This connection is blocked." / "This connection was deliberately ended, not paused or auto-closed." / "End connection with X?" / "Connection ended" / "This is a real, deliberate choice..." / "Start over with this connection?" / "end the connection instead" / "giving this connection with X a little more time" | Say "chat" instead: "This chat is blocked." / "X ended this chat." / "End your chat with X?" / "Chat ended" / "Start a new chat with X?" / "end the chat instead" / "giving your chat with X a little more time". Drop "deliberately" and "a real, deliberate choice", which read stiff and a little like a warning. |
| 24 | `src/app/(tabs)/inbox.tsx:423, 435`; `src/components/settings-panel.tsx:629` | "You both chose to connect" / "...this match closes quietly." / "deletes your profile, matches, conversations..." | "You both said Interested" (Say hi changes this again) / "...this chat closes quietly." / "deletes your profile, chats, notes..." (Core: never "a match") |

## 6. Already planned, noted so they aren't lost

- `src/app/(tabs)/home.tsx:392` Discover tip says "Not for me takes them away". Core says "Not now"; stage 4 changes Discover wording.
- "Reflect first", "What I want to remember about X", "How X likes care" (`universal-text-box.tsx:149`, no longer shown because care words are gone): stage 6 voice pass.
- Unused text, no change needed: `WHAT_HELPED_PENDING_COPY` and `WHEN_UNCERTAIN_PENDING_COPY` in `src/lib/friendship-experience.ts` ("we'll reflect...") aren't shown anywhere; the old connection-analysis sheet (Premium, credits) can't be reached. Both could be deleted in stage 6.

## 7. Checked and fine as they are

- Scam note: "Limen will never ask you for money. Be careful with anyone who does, or who wants to move off the app quickly." Needed for safety (Core section 6), and it describes behaviour, not the person.
- Report: categories, "If you are in immediate danger, call 911.", hotlines, "Thank you for letting us know..." Plain and calm.
- Notifications: "X said hello", "New message from X", plan lines, suggestion lines (the support line was fixed in this update).
- Settings descriptions, Take a break, Reminders and nudges, Notifications: plain, about the person's own choices.
- Empty states (Your circle, Discover, Chats, Saved, Notes): plain, no guilt.
- First-time tips: plain. The chat tip's "so they aren't left guessing" is about the pauser's own act, so it passes.
- Meet nudges, "It's okay either way.", the morning-of nerves line, "moving it is kinder than cancelling": kept; same spirit as the approved "A short, honest note is kinder than going quiet."
- Hand-written ideas (apart from #10) and the "You both like X" heading (written by the server from a real listed interest).
