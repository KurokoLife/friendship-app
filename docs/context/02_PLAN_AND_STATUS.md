<!-- Copy of the founder's project doc "02_PLAN_AND_STATUS.md" (claude.ai project "Business - Limen"), copied 2026-11-15. When the project doc changes, replace this copy. After each build stage, update both. -->

# Plan and status

Updated 2026-11-15. Beliefs and the feature test: **00 Core**. What's built: **01 Product**. This file: what's decided but not built yet, open decisions and to-dos.

Every stage below must pass the full test in 00 Core (including "How it should feel") before it ships.

## Rebuild stages

| Stage | Status |
|---|---|
| 1, 1b, 1c. New home and tabs, design pass, Your circle fixes | Built Oct 25 to 26 |
| 2. Joining | Built Oct 26 to 27. Copy update decided Nov 15 (below) |
| 3. Suggestions | Built Oct 28. Needs the founder's phone test (Text / Call / Email). Copy update decided Nov 15 (below) |
| 3b. Notifications | Built Oct 28. Founder setup still needed (to-do list) |
| Copy update | Decided Nov 15, not built (below). A small Claude Code session |
| 4. Say hi | Next |
| 5. Planning | Not started |
| 6. Finishing pass | Not started |

One Claude Code session per stage, on the repo (branch limen-v2-ethics-alignment). Each stage leaves the app working and tested. Rules for every stage: build only what the stage lists; follow 00 Core (beliefs, test, how it should feel, voice) and the design guide in 01; never change decided wording without asking the founder; add tests for every new rule; end with the exact database updates and functions to deploy, in plain words.

### Copy update for built screens (decided Nov 15)

Keep "Limen" in the app until the name checks pass; then swap every on-screen "Limen" for "Okage" in one go.

**Where the golden rule shows, in the whole app** (nowhere else; founder: shown everywhere it loses its meaning):
1. About page, first "What we hold to" bullet: "Treat people the way you'd want to be treated, even when you make a mistake. When you're not sure, ask."
2. Before you start, one new ground rule: "If you get something wrong, say sorry."
3. Follow-up for the joining answer "Not sure people want to hear from me" (shown later, once): "If a friend got in touch with you, would you mind?"
4. Pattern answer "Worried it'll feel awkward": "If a friend got in touch after a while, would it feel awkward to you?"
5. "I need to change it" (stage 5): "If you were the one waiting, how would you want to hear?"

**Intro screens** (`src/app/philosophy-intro.tsx`). Screen 1 unchanged. Screen 2:
> **Friendships are made of small moments.**
> A quick call. A coffee. Stopping by to say hi. It's easy to overlook the small things that keep us close.
> We each show we care in our own way, and so do the people around us. They hold us up when we need them, and we try to do the same for them.
> (the three ways, unchanged) / Wherever your friendships are right now, you can start here. / [Join Limen] / Already a member? Sign in

**About page:** at the top, "Okage comes from a Japanese word for the quiet help behind the good things in life, the kind that often goes unnoticed." (goes in with the name swap), plus the golden rule bullet above.

**Joining, rest:**
- Before you start: keep today's lines, add the sorry line.
- Follow-up for "I'm usually the one who reaches out": "If it matters to you, keep reaching out. You could also ask them how they like to keep in touch."
- Liking-gap line in chat cards: add "If you're wondering how it went for them, you can ask."

**Chat:** keep the pause note box and "A short, honest note is kinder than going quiet." as they are. Voice words: "Share with people you connect with?" → "Show these to people you chat with?"; "How you connect" → "How you make friends".

**Your circle suggestions:**
- Check-in why line: "A check-in is one way to show someone you're thinking of them." (replaces "A check-in tells someone they matter to you."), shown on the check-in suggestion itself. After "I reached out", just "Noted." (`src/lib/suggestions.ts`, `src/lib/circle.ts`, `reach-out.tsx`)
- Staying in touch, Positivity, Support: no why line. Support line becomes "Jenny was in the middle of a move. Want to ask how it's going?"
- Showing interest why line: "Only Tom knows how it's going. You could ask."
- Celebrating tip: "When someone tells you good news, ask about it."
- Openness, Time together, rhythm lines: unchanged.
- Pattern answers: busy stretch "Busy stretches happen. Even a short message counts." / not sure what to say "A question is enough. Ask how they've been." / awkward: golden rule question above / feels different "Only they know how it feels on their side. You could ask." / something else "Thanks for noting it."

**Meetups:**
- Remove, with nothing in their place: "Most people are glad to be asked, even when they can't make it that time." (`plan-board-card.tsx`) and "It usually means more to them than people expect." (`primary-intervention-card.tsx`).
- "I'm not sure yet" after a meetup: add "Or ask how it was for them."

**Notes:** a one-tap "Ask next time" on a curiosity note moves it into the Next time list.

**Graduation** (with the name swap): "...Would you like to continue your friendship without Okage?"

**Code sweep** (same session, list only, change nothing until the founder OKs): every user-facing line that only lives in the code ("Before you reply" tips, empty states, tip cards, Settings, plan-ideas reasons, fallback ideas, scam note, Report, notifications), checked against 00 Core. For each: file, current text, proposed text, why.

### Stage 4: Say hi (decided)

Saying hi replaces "Interested" (a mutual match reads as dating; silence hurts longer than a clear no: Telari 2025, Pancani 2022).
1. Sending: a short hi in your own words. Starters come from something the other person wrote, mostly questions ("What got you into ...?"). Selfie check before sending. At most 5 waiting.
2. Receiving: "Let's chat" or "No thanks". Under the buttons: "No thanks is fine. A clear answer is kinder than no answer."
3. If no: a note written by Limen, never by the other person: "Sam can't chat right now. People say no for all kinds of reasons, like timing or a full week. Your next person arrives tomorrow."
4. If no answer: the existing reminder at their reply pace; after 7 days it closes with the same note (replaces the 30-day close).
5. Report available from the hi itself.
6. Explain the daily limit once: "One new person a day, so each one gets your full attention."
7. Discover wording: "Not now", never "Pass".

### Stage 5: Planning (decided; replaces the private draft invite)

1. Either person taps "Let's plan something": a card for both, "Tom wants to plan something. Here are a few ideas for you two."
2. Five ideas with short reasons: two small moments, two from listed interests ("You both like hiking"), one new thing; plus "Add your own idea". At least one free.
3. Both tap any they'd enjoy. Both people's picks are visible; overlap highlighted.
4. Overlap: "You both picked coffee. Want to go with it?" No overlap: Ask about theirs (a starter you finish, e.g. "What do you like about live music?") · Try theirs · One now, one next time · More ideas.
5. Then times the same way ("Want to pick a time?"), overlap highlighted. Shortcut: "Already know what you want to do? Skip to times."
6. Then the plan card as today, saying what both chose ("You and Maya both picked Saturday morning."). Each person confirms with "I'll be there"; nothing confirms automatically.
7. Day before: "Still on?" with two equal buttons, "Still on" and "I need to change it". The second opens an easy reschedule or cancel with a note in your own words, and the line "If you were the one waiting, how would you want to hear?". No "I'm sorry" starter: an apology has to come from the person.
8. Outside friends: the first time you plan with one, "What does Alex enjoy?" (private); ideas for you two; Text opens your phone with an empty message.
9. Keep: "Ask about theirs", the morning-of nerves line, "Would you like to tell X how it was for you? Only if you want to.", "Friendships tend to grow when both people suggest plans now and then.", safety tips.

**Budget rules** (build exactly as written; each check becomes an automatic test):
- One setting per person: "For plans with friends, what usually feels comfortable?" Free or close to it / Under $20 / Under $50 / More is fine. Asked the first time they plan; changeable in Settings; skipped = Under $20.
- Limen chats: ideas never exceed the lower of the two settings.
- Before the pair has 2 counted meetups: limit is Under $20, or Free if either chose Free.
- From 2 counted meetups: the lower of the two settings.
- Every idea set has at least one free idea and at least two small moments.
- A private "Happy to spend more this time" on one plan raises only that person's setting for that plan; the limit still follows the lower of the two.
- Never revealed: nobody sees the other's setting or whose setting limited the ideas. Ideas never mention money.
- Outside friends: own setting only.
- Checks: (a) More is fine + Free, 0 meetups → only free ideas. (b) Both More is fine, 0 meetups → nothing over $20. (c) 1 counted + 1 waiting → still nothing over $20. (d) 2 counted → dinner can appear. (e) A Under $50, B Under $20, B spend-more → up to $50, A sees no sign. (f) Every set has a free idea and two small moments. (g) Skipped question → Under $20. (h) Outside friend, own Free → only free ideas.
- Why: 67% of Americans declined a social event in two years mainly over cost; 56% never said so (CFP Board 2026).

### Stage 6: Finishing pass

- "Want to plan something?" after about a week of both writing (sooner if both chose a faster pace); was about 3 weeks.
- Ending: the optional private question "What did you learn from chatting with Sam?". The person who receives an ending sees only the banner that the chat was ended, no extra line.
- A full copy sweep of every screen against 00 Core.
- Voice pass: "What I want to remember about X" → "Notes on X"; "Reflect first" → "Before you reply"; curiosity notes.
- Design pass on the remaining screens; check every screen against "Every profile is a person".
- Interests text box: option A (own short step) or B (pointer line).
- Rename from Limen to Okage, if not done already (name checks below).
- Then update 01 Product to match what's built.

### Not built yet (deferred on purpose)
- Voice input (mic icons are placeholders).
- Stories: a private "what people asked you" view for the writer.
- "Wonder before meeting": two private curiosity notes before a meetup and "Did you learn either?" afterwards.
- Real phone-device testing (only the web version has been tested end to end).

## The name: Okage

Chosen Nov 14. Not yet in the app. Before it goes in:
1. US trademark search, including similar names in apps and social services; get a lawyer's advice before committing launch assets.
2. App Store and Google Play: existing or confusingly similar names.
3. Domain: okage.com or a close alternative.
4. Pronunciation: test with a few English speakers over 40 (risk: "oh-cage").
5. Meanings in other major languages.

## Open decisions

1. **The four optional questions from 00 Core** ("Is there someone you've been meaning to see?" and others): whether and where they appear.
2. **Test accounts in the real database** once real members join (they could appear in Discover).
3. **Discover:** watch in the pilot whether one a day feels right, and whether people run out of new people in smaller cities.
4. **Pricing:** free pilot, then a 21-day free trial, then $39 for 90 days (decided Oct 14). Still open: auto-renew or reminder, when the trial starts, what stops after it, a hardship pass, graduated friends free.
5. **Pilot date:** if set, it may change how many stages ship before the pilot.
6. **Look and feel:** design guide v1; may be refined after pilot feedback.
7. **Graduation thresholds:** revisit only if pilot data says otherwise.

Don't re-ask (decided): golden rule + ask is part of the core, shown only at the five places above; showing you care is part of it (a check-in is a way to show you care); apology and acceptance follow from it, an apology is never a starter, and Okage never pushes acceptance; values are what people already hold, not who they want to be; the old five-step "AI philosophy" is gone for good; the intro and About wording (Nov 15); budget limits stay hidden; "I'll be there", "Still on?" with "I need to change it"; Say hi replaces Interested; the Guide is removed; the home tab is "Your circle"; photos for friends outside Limen are private; no stored phone numbers or emails on the computer; notifications by push and email, SMS only for sign-in; a meetup added with "Met up already? Add it" counts after a week; notes have no AI and no tab; no "share my plan" feature. Dropped: a separate "tell X" feature, a "What works for me" line, a "say thanks" tip, showing someone their own joining answer when they change a plan, a line for the person who receives an ending.

## Security (review Nov 11 to 13)

Fixed and live: migrations 20261113000000 and 20261113000001. Still open:
- Make the GitHub repo private (founder).
- Give each test phone number in Supabase Auth its own random code (founder).
- When `place-search` is deployed, use the new file (it has the per-person limit).
- `send-notifications` isn't deployed yet.
- Later, small: move the phone sign-in token to secure storage; the joining call to `generate-personality-narrative` trusts the app; `mutual_interest_exists` can tell someone who knows two member ids whether both said Interested; 36 package warnings, mostly build tools; Supabase suggests "leaked password protection" (only matters with password sign-in).

## Founder to-do list

- **Update the project instructions** (claude.ai → "Business - Limen" project → edit instructions). Exact text: docs/context/00_PROJECT_INSTRUCTIONS.md in the repo.
- Then a Claude Code session for the copy update above.
- Phone test of stage 3 (Text / Call / Email) with Expo Go.
- Notifications setup: a Resend account with your domain verified; the secrets RESEND_API_KEY, NOTIFY_FROM and APP_URL; a Supabase Cron job running send-notifications every 5 minutes; a free Expo account linked with `eas init` for push.
- Make the GitHub repo private, and give the test phone numbers random codes.
- Run the name checks above.
- Twilio A2P 10DLC registration, so real carriers deliver sign-in codes.
- Turn on Google and Apple sign-in in Supabase (Authentication → Providers).
- Lawyer-reviewed Terms of Service and Privacy Policy, including selfie (biometric) consent, friends added from outside the app, and notifications. Decide a report data retention policy.
- Make your own account an admin to review selfies: `update public.users set is_admin = true where id = '<your user id>';`
- Keep the database and server functions up to date: run each new database update, and redeploy changed functions.
- Put the founder story on the website, not in the app (03 Brand story, in the project).
- Recruit several men for the pilot and ask which lines felt "not for me". Show 2 or 3 colour versions to a few pilot users.
