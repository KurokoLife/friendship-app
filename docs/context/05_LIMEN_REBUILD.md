# What Limen believes (and the rebuild plan)

Written 2026-10-24 after a user test said Limen felt like Bumble BFF. This is the direction for the rebuild. Where it disagrees with docs/context 01 or the "why" docs, this file wins on direction; 01 still describes what is built today until each stage ships. Full editable doc with research links (founder's): https://claude.ai/artifact/WtofgX99eAjBpg89hYNV2P

Limen helps adults stay close to people: keeping up with the friends they have, reconnecting with ones they've lost touch with, and meeting new people in person. (Internally we think of it as building the friendship muscle; the app never uses words like "practice", "skill" or "get better at".)

## Why Limen exists
While writing my end-of-life plan, I found blank spaces: jobs that need a trusted person, and no one to name. Fewer people marry or have kids, more divorce. More people will need friends they can count on, but the skill of building and keeping friendships is fading. (This story goes on the website, not in the app; end of life is heavy for many.)

## The problem
The friendship muscle is weakening. A screen now fills the bored Friday night we used to spend calling a friend. US time with friends fell by more than half since 2003; young people fell most, so it gets worse. AI companions offer closeness with no effort (Sherry Turkle). People forget that friendship is made of small moments (a quick call, a coffee, stopping by), not big events. Finding people is not the main problem; knowing how to reach out, follow up, sit with awkwardness and keep going is.

## Who it's for
Adults of any age, especially 40+, when people look at what they've built and notice their friendships have thinned. Must work for men as much as women (men's connection fell faster).

## What Limen is
A place to build friendships with real people; what you learn carries over to the friends you already have. Success = people you could name. Graduation is a step, not the goal.

## What we believe
1. Effort is the care. Limen never writes for you (starters you finish yourself are fine).
2. Some friction is how friendship grows. Limen helps you through it, doesn't remove it.
3. Understanding beats reminders. Behavior done "because the app said so" fades.
4. Friendship lives in person, in small moments.
5. Your choice, always. No pressure, no guilt. Private stays private.

## Core loop
Do something real -> see why it matters (one line) -> notice (private, optional) -> carry it outward to friends outside Limen. Limen helps people notice and become aware; it is NOT a habit-building app.

## The test for every feature
1. Real friendship behavior with a real person? 2. Effort stays with the person? 3. Would they understand why, so they'd use it outside Limen? (Founder: no current feature fails; many need to change.)

## App map (decided)
Four tabs: Your people (home) · Chats · Discover · You.
- Your people: one suggestion at a time; circles Close / Friends / Getting to know / Want to reconnect; Limen people and friends you added together. Tap a Limen person -> chat. Tap an outside friend -> Text / Call / Email (opens the phone's own app, empty message).
- Chats: Limen conversations (today's Inbox Active and Past); Past at the bottom.
- Discover: today's person plus saved people (Saved tab folded in).
- You: a switch at the top, Profile | Settings. Profile: your profile, "What's hardest" and "Who would you call?" answers over time, pattern notes. Settings: everything in Settings today, plus "About Limen".
- The Guide is removed (no videos or reads in the app; the one-line "why" at the moment it helps replaces it). Existing videos are not needed. The intro screens (the /philosophy route) are the philosophy page; rewritten under Joining.
- 3 active Limen chats stays the limit (not for friends you add).
- Ended honestly -> Past in Chats, notes kept, one optional "What did you learn from this connection?". Faded -> Past, can be moved to Want to reconnect. Blocked -> never shown.

## About Limen page (in Settings, decided)
About Limen
Most friendships don't end. They drift. Limen helps you keep up with the friends you have, reconnect with people you've lost touch with, and meet someone new, in person.
What we hold to
- Friendships are made of small moments, so that's what Limen helps with.
- Your messages are yours. Limen may offer a few words to start; the rest is you.
- Meeting in person is the point. Chatting is how you get there.
- You decide. Every reminder can be turned off.
- Limen is paid for by members, never by ads or by selling your information.

## Joining (decided)
1. Intro screen 1: "Most friendships don't end. They drift." / "Busy weeks, moves, screens. It's easy to lose touch without meaning to." / Next
2. Intro screen 2: "Friendships are made of small moments." / "A quick call. A coffee. Stopping by to say hi. Limen helps you make more of them." / Keep up with the friends you have. Reconnect with someone you've lost touch with. Meet someone new, one person at a time, in person. / "Wherever your friendships are right now, you can start here." / Join Limen · Already a member? Sign in
3. Phone and code. 4. Name and birthdate (under 18 turned away).
5. "What's hardest about friendship for you right now?" Pick any: Meeting new people · Keeping in touch with friends I have · Getting plans to actually happen · Going from friendly to real friends · Reconnecting with people I've lost touch with · I'm usually the one who reaches out · Not sure people want to hear from me · Friends don't really know what's going on with me · Finding the time · Something else (write it; voice later, never required). "So Limen knows where to help first. Only you see this."
6. "Think about your friends right now." "Not counting family or a partner: who would you call with good news? Who could you ask for a hand?" No limit on names, each with a circle. Second prompt: "Anyone you've lost touch with but would like to hear from?" Rhythm defaults by circle (Close: every week; Friends: every month; Want to reconnect: a few times a year), changeable later. "Most adults name one to four close friends. None is more common than people think." Skippable.
7. "Here's where Limen can help. Change anything you like." Pre-filled from 5: Keep in touch with the people I have · Reconnect with someone · Meet someone new · Make plans actually happen · Notice my own patterns.
8. If "Meet someone new": full profile setup as today with a voice pass; the liking-gap line moves here. Otherwise land in Your people with a card offering it later.
Before launch, re-read the intro against what's actually built; say less if the existing-friends side is thin.

## Your people (decided)
- Add someone: name, circle, and how often you'd like to be in touch, with choices that fit the circle:
  - Getting to know: every few days / every week / every two weeks. Line: "New friendships grow fastest when you're in touch every week or so."
  - Close: every week / every two weeks / every month. Line: "Most people are in touch with their closest friends about once a week."
  - Friends: every two weeks / every month / every few months. Line: "Most people catch up with good friends about once a month."
  - Want to reconnect: any, including no suggestions.
  - Why line for check-ins: "A check-in tells someone they matter to you."
  Optional: link a phone contact (Limen stores which contact, never numbers or emails; phone app only), a note.
- Limen people move on their own (chat -> Getting to know; hi sent -> "waiting to hear back"; graduated -> Friends); anyone can be moved by hand.
- No "last talked" dates on the list (guilt list).
- One suggestion system: Your people suggestions cover Limen people too; the chat's own "It's been quiet" check-in is retired. One person at a time. User chooses overall frequency: a couple of times a week / once a week (default) / every two weeks.
- After Text/Call: optional "Did you reach out?"
- Skip: "Not now" (comes back) and "Fewer suggestions for this person".
- Pattern noticing: after a few "Not now"s over weeks, one optional question "You've put off a few check-ins lately. What usually gets in the way?" (A busy stretch / Not sure what to say / Worried it'll feel awkward / The friendship feels different now / Something else). Each answer gets one helpful line. You tab privately shows the pattern back; the person draws the conclusion.

## Suggestions (decided; notice first, action optional; timing + own notes only; no streaks or scores; never say "habit")
- Staying in touch: "You and Maya haven't been in touch for a while." Why: people enjoy hearing from a friend more than we expect.
- Showing interest: "You wanted to hear how Tom's new job is going." (from Next time notes) Why: a follow-up question shows you were listening.
- Positivity: "Anything Priya did lately that you'd tell them was good?" Why: kind words land better than we think, even when they feel awkward to say.
- Celebrating: tip only: when someone shares good news, ask about it. Why: real interest in a friend's good news brings you closer.
- Support: "Jenny was in the middle of a move. How's that going, do you think?" (from a "Going through" note) Why: being there in a hard stretch is one of the main things that keeps friendships going.
- Openness: "Anything going on with you that Maya doesn't know yet?" Why: friends can only understand what they get to see.
- Time together: "When did you and Alex last get together?" Why: friendships grow through time spent together in person.
Why lines are plain, with a small "Why we say this" source link.

## Discover and chats (decided)
Saying hi replaces "Interested":
1. Sending: a short hi in your own words (starters allowed). Selfie check before sending. At most 5 waiting.
2. Receiving: "Let's chat" or "No thanks". Under the buttons: "No thanks is fine. A clear answer is kinder than no answer."
3. If no: note written by Limen, never by the other person: "Sam can't connect right now. People say no for all kinds of reasons, like timing or a full week. Your next person arrives tomorrow."
4. If no answer: existing reminder at their reply pace; after 7 days it closes with the same note (replaces the 30-day quiet close).
5. Report available from the hi itself.
6. Explain the daily limit once: "One new person a day, so each one gets your full attention."
Discover: today's person on top, saved (up to 5, 30 days) below. Only for people who chose "Meet someone new"; others see an invitation. Matching unchanged; joining answers never used for matching.
Chats: graduated friends move to the Friends circle and keep their chat. Voice pass ("Notes on X", "Before you reply"). Ending adds the optional "What did you learn from this connection?". Unchanged: getting-started note, "Limen is for meeting in person", scam note, Report, Block.
Meeting sooner: "Want to plan something?" after about a week of both writing, or sooner if both chose a faster meeting pace (was about 3 weeks).

## Planning (decided; replaces the private draft invite)
1. Either person taps "Let's plan something" -> card for both: "Tom wants to plan something. Here are a few ideas for you two."
2. Five ideas with short reasons: two small moments, two from listed interests ("You both like hiking", "Tom likes live music"), one new thing; plus "Add your own idea". At least one free.
3. Both tap any they'd enjoy. Both people's picks are visible; overlap highlighted.
4. Overlap: "You both picked coffee. Want to go with it?" No overlap: Ask about theirs (chat starter you finish, e.g. "What do you like about live music?") · Try theirs · One now, one next time · More ideas.
5. Then time the same way: "Want to pick a time?" Both tap times over the next two weeks; overlap highlighted.
6. Then the plan card as today (place, calendar question, safety tips before a first meetup). Shortcut: "Already know what you want to do? Skip to times."
Outside friends: first time you plan with one, "What does Alex enjoy?" (private); ideas for you two; Text opens your phone with an empty message.

### Budget rules (build exactly as written; turn each check into an automatic test)
- One setting per person: "For plans with friends, what usually feels comfortable?" Free or close to it / Under $20 / Under $50 / More is fine. Asked the first time they plan; changeable in Settings; skipped = Under $20.
- Limen chats: ideas never exceed the lower of the two settings.
- Before the pair has 2 counted meetups: limit is Under $20, or Free if either chose Free, whatever else is set.
- From 2 counted meetups: limit is the lower of the two settings.
- Every idea set: at least one free idea and at least two small moments.
- Private "Happy to spend more this time" on one plan raises only that person's setting for that plan; limit still follows the lower of the two.
- Never revealed: no one sees the other's setting, a switch, or whose setting limited ideas. Ideas never mention money or budget.
- Outside friends: own setting only. "Counted" = today's definition.
Build checks: (a) More is fine + Free, 0 meetups -> only free ideas. (b) Both More is fine, 0 meetups -> nothing over $20. (c) 1 counted + 1 waiting -> still nothing over $20. (d) 2 counted -> dinner can appear. (e) A Under $50, B Under $20, B spend-more -> up to $50, A sees no sign. (f) Every set has a free idea and two small moments. (g) Skipped question -> Under $20. (h) Outside friend, own Free -> only free ideas.

## Voice guide
Steady, thoughtful friend to anyone of any gender. Lead with doing, not feeling. Plain words (avoid share, open up, connection, on your mind, care, journey, vulnerable, reflect, practice, skill, get better at; use catch up, get together, tell them, see how it's going, note it). Short and direct. Activities and small moments count as friendship. Notice, don't instruct. No therapy language, no em dashes, never "AI". One true line, not a lecture. Never make someone with no friends feel bad. Test: would a 50-year-old man and a 35-year-old woman both read it without wincing? Existing screens need a voice pass (care words, curiosity notes, "What I want to remember about X" -> "Notes on X", "Reflect first" -> "Before you reply").

## Build order (decided Oct 24)
Six stages, one Claude Code session each. Each leaves the app working and tested before the next starts.
1. New home and tabs (built 2026-10-25, see docs/DECISIONS.md section 11): four tabs (Your people, Chats, Discover, You with Profile | Settings switch). Inbox -> Chats, Saved -> inside Discover, Guide removed, About Limen page. Your people with circles, adding outside friends (name, circle, rhythm, note), Limen people placed automatically.
2. Joining: two intro screens, What's hardest, Who would you call (fills Your people), Here's where Limen can help, meet-someone-new branch.
3. Suggestions: suggestion card, rhythms by circle, overall frequency, Text/Call/Email with phone contacts, Did you reach out, skipping, pattern noticing, why lines; retire the chat check-in. Needs a real phone test.
4. Say hi: replace Interested; Let's chat / No thanks; 7-day close and its note.
5. Planning: shared idea and time picks, budget rules with the 8 checks as automatic tests; update the plan-ideas function.
6. Finishing pass: meet-sooner timing, the ending question, voice pass on all screens, interests text box decision (option A own step vs B pointer line), then update docs/context to match what's built.
Rules for every stage: build only what the stage lists; follow the voice guide; never change decided wording without asking the founder; follow docs/context/02 (migrations safe to run twice, bump limen_db_version, npx tsc --noEmit, qa suites); add qa tests for every new rule; end with the exact migrations to run (raw GitHub links) and functions to deploy, in plain words.
