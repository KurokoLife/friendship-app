# Limen: why each part exists

Last updated 2026-10-10. This is the "why" behind 01_LIMEN_PRODUCT.md (the "how"). Use it to judge any new idea: if a feature doesn't serve the goal below, or works against one of the hard parts it's meant to ease, it doesn't belong.

Reasons marked (research) come from studies listed in docs/LIMEN_V2_DECISIONS.md. Reasons marked (judgment) are the founder's or the team's call and can be revisited with pilot data.

## The goal

Help adults who are going through a change make real friends: people they meet in person, regularly, and keep seeing after they no longer need Limen. Limen succeeds when two people graduate and leave the app together.

Two things follow from that goal:
- **Limen is a practice space, not a convenience.** People should leave with a stronger "friendship muscle" they use everywhere, not depend on the app to do it for them.
- **Limen is for meeting in person.** Chat is how people get there, not where the friendship lives (research: text carries less warmth and nuance than voice or face to face).

## What makes adult friendship hard (what Limen is built to ease)

1. **Too many options, too little focus.** Endless choice lowers satisfaction and commitment (research). Friendship takes a lot of time together: roughly 94 hours to become casual friends and 164 to become friends (research).
2. **Fear of rejection and second-guessing.** People underestimate how much others like them after a conversation, the "liking gap" (research). Silence gets read as rejection.
3. **Staying in your own head.** People guess what the other person thinks instead of asking. Perspective-taking works best when you actually ask (research).
4. **Effort that doesn't come back.** Friendship needs give and take, with both people making plans (research). One person carrying everything burns out.
5. **Never actually meeting.** Chats drift on and never become plans.
6. **Fading after the first meetups.** Early friendships are fragile. They need repeated, ordinary time together.
7. **Safety and trust.** Meeting a stranger takes courage. Romance-seekers and scammers make it worse.
8. **Endings without honesty.** Ghosting hurts, and fear of an awkward ending keeps people silent.

Limen's rule: **ease these hard parts, don't remove them.** The hard parts are where friendship is built. A feature that removes the effort (AI writing messages, auto-planning, endless matches) defeats the purpose.

## Why AI is used only to help people think

- **AI never writes, rewrites or polishes a message.** People suspected of using AI to write are seen as less warm and less cooperative, and recipients value messages that took effort (research). A message is a show of care; if the app writes it, the care is gone.
- **AI helps people see, not decide.** "Check" points out things in your own draft (you didn't ask anything back, didn't share anything of yours). "Another way to see it" offers three possible readings and always ends by sending you back to ask the other person. It never takes your side, because agreeable AI makes people more sure they're right and less willing to repair things (research).
- **Starters are allowed, finished in your own words.** They lower the blank-page fear (hard part 2) without doing the work.
- **The app never reads messages.** Reading private conversations would break trust, and timing is enough to know when a nudge might help.
- **AI writes plan ideas and the self-reflection, nothing that speaks for a person.**

## Why each part works the way it does

### Joining (onboarding)
- **Two required videos and the readiness screen** set shared norms before anyone meets: curiosity first, show up honestly, friendship only, no ghosting. Everyone starts from the same agreement (eases 7, 8).
- **The intro's liking-gap line** tells people, before they start, that others probably like them more than they think (eases 2).
- **"How you connect" reflection** helps people understand their own patterns. It isn't used for matching, so nobody is sorted by personality type (judgment).
- **Only 11 screens** because every extra step loses people before they meet anyone (judgment).

### Profile
- **Stories in your own words, no "Ask me about"** because curiosity starts with a gap the reader notices for themselves. "Ask me about" fills that gap for every reader (research). Different readers see stories in a different order so they start in different places.
- **"Right now, I'm..." and "What brings you here"** show the person's real situation, which matters most for matching (life situation has the biggest weight).
- **"How I like care", shown only to connections** because feeling understood and cared for is the core of closeness, and knowing how someone actually likes care beats guessing (research).
- **Curiosity notes ("I wonder...")** train the habit of noticing what you want to know about someone. Curiosity creates closeness and can be practiced (research).
- **Fewer values (5) and categories** keep profiles readable and choices meaningful (judgment).
- **Private fields stay private** so people can be honest (for example, hide a divorce from the profile but still be matched on it).

### Discover and connecting
- **3 suggestions a week** because focus beats volume (eases 1). People should give each person real attention.
- **Matching on life situation, values and rhythm** because shared circumstances and a similar pace of meeting predict whether two people can actually keep seeing each other (judgment, based on research on time together).
- **Mutual "Interested" before chat, one-sided interest never shown** protects people from feeling rejected and from unwanted messages (eases 2, 7). Quietly moving someone who was interested in you up your list respects your choice while helping a match happen.
- **Limits of 3 active chats and 5 waiting hellos, the same for everyone** so people invest in a few friendships instead of collecting many (eases 1). Graduated chats don't count, because graduation is the goal.
- **No paid extras** because selling more matches sells options instead of focus (eases 1).
- **Selfie check once, approved by a person** because people must trust that the other person is real before meeting (eases 7).
- **Ghosting rule, never shown, resets on its own** protects others without shaming anyone (eases 8).
- **A match with no hello closes quietly at 14 days** so empty matches don't hold up someone's limited spots (judgment).

### Chat
- **"Limen is for meeting in person" on every chat** keeps the purpose visible (eases 5).
- **Read receipts never shown** because "seen but no reply" feeds anxiety (eases 2).
- **Pause with a short note, a set end date, both see it** gives people an honest way to step back without disappearing (eases 8). The note keeps the other person from guessing; the end date keeps a pause from becoming a slow ghost.
- **Honest End, with or without a message** so ending is never scarier than ghosting (eases 8). The other person always learns it ended.
- **Report, Block, scam note** keep people safe without making every chat feel suspicious (eases 7).
- **Only one prompt card at a time, each can be put away or turned off** so the app supports without nagging (judgment: respect people's choices).

### Reminders (quiet by design)
- **One gentle note while getting started, then quiet** because a first hello with no answer is where people feel rejected (eases 2). Once both have written, silence is normal between friends, and the app can't tell a natural pause from a problem without reading messages.
- **Check-ins after 5 quiet days ("That's normal")** make reaching out feel easy instead of awkward (eases 2, 6).
- **Nudges to meet after about 3 weeks, honest checks at 2 and 6 months** because chats that never become meetups don't become friendships (eases 5). Nothing closes on its own; people decide.
- **Everything can be turned off** because nudges only help when people feel free to ignore them. Freely chosen actions last longer than pressured ones (research).

### Planning and meetups
- **Planning by invite** (one private draft, one message, the other person just replies) because back-and-forth planning cards felt clumsy and slowed people down (judgment, after testing). The invite is a real gesture from one person to another.
- **Plan ideas that are public, safe, not drinking-focused, within both people's limits (never saying whose)** reduce the effort and risk of a first plan (eases 5, 7) without anyone having to admit a tight budget.
- **Safety tips before a first meetup, no "share my plan" feature** give calm, practical safety while treating people as adults (eases 7).
- **Day-before and morning-of checks, the nerves video** because pre-meetup nerves are when people cancel (eases 2).
- **"Did you meet?" and counting every meetup** because meetups are the real measure of a friendship, and graduation depends on them (eases 6).
- **"Tell X how it was for you", with Remind me later** because telling someone you enjoyed their company closes the liking gap for both (eases 2). It's optional and never pushed.
- **Calendar question** because plans that aren't on a calendar get forgotten (eases 5).
- **Meeting pace shown only when both agree** so nobody feels judged for wanting more or less (eases 4).

### Remember (private notes)
- **Notes about what you learned, enjoyed and want to ask next** turn attention into a habit: remembering details and following up is how people feel cared for (eases 3, 6).
- **No AI** because the point is the person's own attention, not a summary.
- **Notes come back before planning and after a meetup** so the next conversation picks up where the last one left off (eases 6).
- **Lives in the chat, not a tab** because it's useful at the moment you're talking to that person (judgment).

### Graduation
- **Ready check after 6 meetups over 8+ weeks, each person proposed at least 2** because friendship takes repeated time and balanced effort (research). The numbers themselves are judgment calls to check with pilot data.
- **Private answers, graduation only on a mutual yes** so nobody is hurt by a one-sided "not yet" (eases 2).
- **Decision point at 10 meetups or 6 months** so chats don't stay in the app forever: graduate, keep going here for a stated reason, or end honestly.
- **Graduated chats free a spot and keep their notes** because leaving the app together is the success.

### Guide
- **Short pieces at the moment they help, not a library people must study** because advice sticks when it's needed (judgment, Guide still being decided).

### Money
- **Free pilot, later pick-your-price, no ads or deals** because Limen should never earn more by keeping people in the app or selling them more matches. That would work against the goal (judgment, with research on pick-your-price).

## Using this file

- Before building or changing a feature, ask: which hard part does this ease, and does it keep the effort with the people?
- If a reason here turns out to be wrong in the pilot, change it here and in docs/DECISIONS.md.
