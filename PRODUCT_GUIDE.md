# Limen — Product Guide

*A plain-language explanation of what the app does and why. Written for understanding, not for engineers — no jargon, no file names, no "per Section X" citations. Where the original design document and the actual live app disagree, this guide describes what's actually live, and says so when that's a deliberate, documented change rather than a drift nobody decided on.*

---

## The idea underneath everything

Before any feature list, it's worth stating the one sentence the whole app is built around, because almost every design choice below traces back to it:

**Friendship is not something you find. It's something two people slowly build together.**

That single belief shapes what this app refuses to be. It is not a matching app that hands you an endless deck of people and lets an algorithm decide who's worth your time. It's not a swipe app, it's not a numbers game, and it's not designed to keep you scrolling. Its own definition of success is blunt: *a user meets someone from the app in person at least five times and reports that the relationship continues.* Everything else — the caps on how many people you can talk to, the reminders when someone goes quiet, the videos, the private notes feature, the whole shape of the thing — exists in service of that one outcome, not in service of keeping you in the app longer.

A handful of stated principles run through every part of the product, and they're worth having in mind while reading the rest of this guide, because they explain *why* the app so often does the less convenient, less "growth-hacky" thing:

- **Quality over quantity.** Every profile you see should get genuine consideration. Paying for Premium never unlocks unlimited people — more on exactly why in the Free vs. Premium section below.
- **Respectful clarity over silence.** The app would rather nudge someone to reply, pause, or honestly end a conversation than let another person sit in ghosted uncertainty. This is the whole reason the "no-ghost" reminder system and Honest Exit exist.
- **Human control over AI.** The app's own rule for its AI features is: *AI prepares and assists; people decide, communicate, and remain accountable.* AI never sends a message, never books a meetup, and never acts without a human explicitly approving it first. Every AI-assisted piece of text in this app has to pass through a real person's eyes and a real edit before it goes anywhere.
- **Privacy by default, and safety is never a paywall.** Sensitive answers, private notes, and exact location are never public. And critically: the app's own rule is that safety features are never hidden behind a paid tier. If it protects you, it's free.
- **Real-world success over screen time.** The app is explicitly trying to minimize how much time you spend inside it. A friendship that graduates out of the app and continues by text or phone call is treated as a win, not a loss of a user.

With that as the backdrop, here's how the app actually works, in the order a real person moves through it.

---

## 1. Onboarding

Onboarding is one continuous chain of screens, each one leading to the next, in this exact order:

1. **Philosophy intro** — a short screen that sets expectations honestly (new friendship is often uncertain for both people, not just you) before asking for anything. No account required yet.
2. **Phone verification** — a real text-message code. This is the actual account-creation step.
3. **Email verification** — optional and skippable. It's useful for account recovery but nothing downstream depends on it.
4. **Basic profile info** — real first name and birthdate (the app enforces 18+), plus a required checkbox agreeing to Terms and Privacy. This is also the earliest point an account exists in the database, so it's where an optional referral code gets entered if someone has one.
5. **Gender identity and matching preferences** — three quick questions: how you identify, who you're open to being matched with (plus your acceptable age range for matches), and who's allowed to message you first. All three are required, none are vague "prefer not to say" options, and none of them cost anything — gender filtering is explicitly a free feature, never a Premium one.
6. **Social account linking** — optional. Linking a social account earns a small "verified identity" badge but never affects who you're shown or how you rank.
7. **Profile build** — the long one: where you live and how far you're willing to travel, what's bringing you to the app (divorce, relocation, career change, etc.), what you value, what you're into, how you like to hang out, your communication style, your photo, and more. It's broken into ten short steps rather than one long form, and a handful of fields are required to continue (your location, at least one life-transition reason, your hangout style, your communication style) while the rest are optional detail that makes your matches better but won't block you.
8. **A short personality reflection** — ten everyday scenario questions (e.g., "your ideal Friday night looks like…") that calibrate things like how often the app nudges you and how gently it phrases things. You never see a score or a label; the questions exist purely to shape *how* the app talks to you, not to sort you into a type.
9. **A private reflection on your own past experience with new friendship** — five questions about what's helped friendships grow for you before, and what's made them fizzle. This is asked once, right after the personality questions, and the answers are never shown to anyone, never used for matching, and never turned into a score. Right after you answer, the app shows you a short written reflection that draws on both this and the personality questions — grounded only in what you actually said, nothing invented.
10. **Two required videos** — "Begin With Curiosity" and "How We Show Up." These are the one part of onboarding you genuinely cannot skip. Every other educational video in the app is optional and can be watched whenever it's useful; these two are treated as a baseline standard for how people are expected to treat each other here, so the app asks everyone to sit through them before they can start matching.
11. **A readiness check** — a simple "I'm ready" or "I need more time" (with an option to pause your account for a while), combined with an honest disclosure that the app tracks behavior like response times to protect the community, not to punish anyone.
12. **"All set"** — the last screen before landing in the app for real.

**Why so much required upfront?** Because the app's whole premise is that trust and behavioral standards need to be established *before* two strangers start talking, not patched in afterward. A profile with no photo, for instance, is barred from ever appearing to anyone — not as an afterthought, but because a profile-less person showing up in someone's suggestions undermines the basic promise that "this is a real person who's ready to be seen."

Once someone has genuinely finished onboarding, reopening the app skips straight to the main app — nobody who's already onboarded gets routed back through any of this.

---

## 2. Discovery — Discover, Browse, and Saved

There are three ways to find people, and they exist for different reasons:

- **Discover** is the primary, low-effort path: the app hands you a small number of AI-picked suggestions, each with a short written explanation of *why* it thinks you two might get along, grounded in real shared details from both profiles — not a vague "you're 80% compatible."
- **Browse** is the opposite: full control. You can filter and search for people yourself instead of waiting on the app to suggest them.
- **Saved** is a holding pen — people you're interested in but not ready to message yet. Saved profiles don't count against any of your limits, and (deliberately) the app does not put an artificial countdown on how long a save lasts. You keep someone saved until you decide otherwise, or until they genuinely become ineligible (they delete their account, or your preferences no longer overlap).

**Why both Discover and Browse exist, rather than just one:** they serve different instincts. Discover matches the app's own quality-over-quantity stance — a small, considered set of suggestions rather than an endless feed. Browse exists because sometimes a person genuinely knows what they're looking for and shouldn't have to wait for the algorithm to surface it.

### How matching actually works

Before anything else, two people have to clear a hard bar: compatible gender preferences, compatible age ranges (both ways), neither has paused their account, neither has blocked the other, and — for Discover and Browse both — both have a real photo. None of that is negotiable or scoreable; it's pass/fail.

Past that bar, candidates get a weighted score built from real, concrete overlap: shared life transitions (the single biggest factor), shared values, personality proximity, hangout style, shared activities, meeting-frequency compatibility, and a few smaller signals like shared language or communication style. None of it is a mystery black box shown to the user as a percentage — instead, the app writes out the specific, real reasons two people might connect ("you're both navigating a career change and you both mentioned hiking").

**One rule the app holds to firmly: paying for Premium never buys a better match.** Premium status, having linked a social account, none of it ever nudges your ranking. The only thing Premium changes about discovery is *how many* suggestions you get per day, never *how good* they are.

### Why the suggestion caps are what they are

Free accounts get 2 new AI suggestions a day and can hold 4 active conversations at once; Premium gets 5 suggestions a day and 8 active conversations. Neither tier is unlimited, and that's not an oversight — it's the same "quality over quantity" principle again, made concrete: an endless supply of new people to consider would recreate exactly the disposable, dating-app feeling the whole product is trying to avoid. Premium is meant to give someone more room to breathe, not an infinite deck of replaceable people. (There's more on this reasoning, including the version of this question that applies to Premium specifically, in the Free vs. Premium section near the end of this guide.)

If someone genuinely runs out of real, compatible people to see (a real possibility in a smaller launch market), the app also sells a small one-time top-up of AI credits — a way to get a few extra suggestions on a slow day without changing anyone's subscription.

---

## 3. Messaging

The core of the app is a normal real-time chat — nothing unusual there. What's deliberately unusual is how AI is allowed to touch it.

### AI drafting and polishing, and why it can never just send something for you

Anywhere you can compose a message, there's an option to have AI help: either draft something from a rough description of what you want to say, or clean up something you've already written. In both cases, the result lands back in the same text box you were already typing in — not a separate "AI version" to compare against your own — and you have to actually edit or interact with it before Send becomes available to press.

This isn't a UX nitpick, it's the app's central AI rule made literal: *AI prepares and assists; people decide, communicate, and remain accountable.* The app is explicit that this only works if your own honest words come first and AI only ever helps you say them more clearly — it should never be putting words in your mouth you didn't actually mean. Requiring an edit before Send is the mechanical enforcement of that rule: it's genuinely not possible to have the app write and send a message on your behalf with zero human involvement.

### Why AI help has a usage limit, and what changes on Premium

AI drafting isn't unlimited, even for a single conversation. Free accounts get a handful of AI-assisted actions per day or per week depending on which feature (drafting a reply, getting activity suggestions, an on-demand "why might we connect" analysis, and two features inside the private notes tool each have their own small free allowance). Premium accounts aren't capped per-feature; instead they share one modest monthly dollar budget across all of those AI features combined, sized against the real cost of running the underlying AI model. Once free users hit their daily/weekly limit, or a Premium user's shared budget runs dry for the month, they can also buy a small pack of extra AI credits rather than wait — the same credits used for extra Discover suggestions work here too.

The reasoning is straightforward and practical: every one of these AI calls costs the app real money, and an unmetered AI-assist feature could be cheaply run into the ground with no real product benefit — the point was never "generate lots of text," it was "help you find your words when you're stuck," and a person genuinely doing that a handful of times a day is exactly the use case this is built for.

---

## 4. The no-ghost system

This is one of the app's clearest expressions of its own principles, so it's worth explaining fully.

When someone sends a message and doesn't hear back, the app doesn't just leave them wondering. On a fixed schedule, it nudges the person who hasn't replied yet — always the person who owes a reply, never the person who's waiting — through four escalating check-ins:

- **A first gentle reminder** (roughly 20–36 hours after the message, depending on how quickly that person says they usually reply): just a nudge that a message is waiting, framed as "you don't need a perfect reply."
- **A second reminder** (72 hours): "still deciding? reply, pause because life is busy, or end the connection respectfully" — the first point where pausing or ending becomes an offered option, not a punishment.
- **A final action prompt** (120 hours): the same three choices, framed a little more directly — reply, pause, or close the loop.
- **One prompt to the person who's been waiting** (125 hours, only if the other person still hasn't acted): "keep waiting, send one last follow-up, or close the connection and free up your capacity for someone else."

If nobody does anything for a full week, the connection quietly goes inactive on its own — no automated message is ever sent pretending to be a person.

**Why this exists at all:** one of the problems the app was explicitly built to push back on is how normal digital products have made ghosting the default way relationships quietly end. The stated principle is "respectful clarity" — reply, pause, or close, rather than leaving someone in indefinite uncertainty. This system is that principle turned into an actual mechanism rather than just a value statement.

**Why it's gentle instead of naggy or punitive:** the copy at every step is deliberately calm and never guilt-driven ("this isn't about pressure, delays happen for lots of reasons"). The app's theory is that people who feel loneliness or rejection-sensitivity already tend toward self-monitoring and premature negative conclusions — piling shame on top of that would work against the very thing the app is trying to help with. So the reminders assume good faith by default, and every escalation still treats pausing as just as legitimate an answer as replying.

**Why this is free for absolutely everyone, with no Premium version:** unlike the discovery caps or AI-assist limits, none of this system is gated by subscription tier at all — every account, free or paying, gets the identical timing and the identical options. This lines up with the app's own hard rule that safety and basic respectful-communication tools are never something you have to pay for; hiding this behind a paywall would directly contradict the promise that quality of *treatment* is never for sale, only quantity of *introductions* is.

---

## 5. Scheduling a meetup

Once two people are talking, either one can propose a specific date for meeting up, and the other confirms it (or reschedules — proposing a new date on an already-confirmed plan simply resets it back to "waiting on a confirm," so nothing gets locked in without both people actively agreeing).

**Why a real in-app propose/confirm step instead of just letting people casually mention a date in chat:** a plain-text mention buried in a conversation is easy to lose track of, and gives the app no reliable signal that a real plan exists — which matters, because several other features (the day-of feeling check, the post-meetup check-in) need to know a real date was actually agreed to by both people, not just floated by one. Making it a real, structured step is also what allows the app to gently prompt around it (a day-of check-in, a "how did it go" a week later) without ever reading the actual contents of anyone's conversation.

---

## 6. Before and after the meetup

### The day-of feeling check

On the day of a confirmed meetup, each person is privately asked how they're feeling about it — Excited, Neutral, or Nervous. This is answered separately and never shown to the other person.

**Why this exists, and why "Nervous" specifically gets more:** picking Nervous surfaces a short video reassuring people that a first meetup doesn't have to be effortless or perfect to be worth having — that awkwardness is a normal, expected part of two people who don't know each other yet spending time together, not a sign the match was wrong. This connects directly to the app's "perspective before assumption" principle: the instinct to write off a new connection after one slightly awkward encounter is exactly the kind of premature conclusion the app is trying to soften, and meeting someone genuinely anxious about an upcoming first meetup with reassurance rather than nothing felt like the right moment to offer it.

### The first-meetup milestone

The very first time two people engage with "let's plan something" on a brand-new connection (before any date has necessarily even been set), a one-time private check-in appears — the same Excited/Neutral/Nervous style question, with a gentle, skippable pointer toward the video library if someone wants a bit more preparation before a first-ever meetup. It only ever fires once per connection, right at that first real planning moment.

### The post-meetup check-in, and why disagreement never becomes a fight

Roughly a week after the last real planning activity on a connection (or the day after a specifically confirmed date passes), the app privately asks each person how the meetup went, with four honest options: it went well, it was rough, it didn't happen, or we're still figuring it out.

Whatever one person answers first, the app tells the *other* person, by name, what was reported, and asks them to confirm or correct it — rather than asking a second person a totally blank, disconnected question. Critically: **the two people never see each other's raw answer, and neither one can tell whether the other confirmed, denied, or simply ignored the check-in** — all three of those produce the exact same silence from the other side. Only when *both* people land on "it went well" does the meetup actually get logged and counted toward graduation; any other combination — including one person saying "it was rough" — quietly logs nothing, with zero consequence to either person.

**Why disagreement is never surfaced as conflict:** this is a direct application of "boundaries and care together" and "imperfection is normal, harm is not." Two people can walk away from the same meetup with genuinely different feelings about how it went, and the app treats that as an ordinary, private fact of life rather than something to litigate. Nobody gets told "the other person disagreed with you." If someone genuinely had a bad time, that's registered as a real, private signal (softly offered options like pausing or an honest exit) without ever turning it into a pointed disagreement between two people.

---

## 7. Graduation

After five confirmed, mutually-agreed meetups, the app shows a real milestone moment: *"You have met five times in person. That is a meaningful sign that you are building something real."* Three honest options follow — keep the chat available inside the app, move the connection to a graduated state, or say "not yet." None of them is presented as the obviously correct choice, and choosing "not yet" or "keep chat available" doesn't lock anyone out — the prompt will show again the next time a new meetup is confirmed.

Choosing "move to graduated" does one concrete thing: that connection stops counting against your active-conversation limit, freeing up room for someone new, while the conversation history and any private notes about that person stay fully intact — nothing is archived or deleted.

**Why five meetups, specifically:** this is the app's own stated definition of success — someone meeting a person from the app in real life five times is treated as strong real-world evidence a genuine friendship has taken root. Worth being honest about, though: the design document that set this number explicitly flags it as an assumption still being tested, not a settled, proven-optimal figure — the plan has always been to check in with users around meetup 3, 5, and 7 to see whether 5 actually feels like the right marker, rather than treating it as beyond question.

**Why the app doesn't try to keep people around after this:** because the entire product is built around the idea that success looks like people leaving to have their friendship offline, not staying inside the app forever. Graduating a connection frees up a capacity slot precisely so that letting a friendship "outgrow" the app is rewarded with room for something new, not treated as a loss.

Separately, and quietly in the background, the app privately checks in on itself at 30 and 90 days after a graduation — did the two people actually keep talking after leaving the chat? This isn't shown to users at all; it exists purely so the app itself can learn whether graduation is actually working as a real signal of lasting friendship, not just an app-side event.

---


---

## 8. Honest Exit

There's exactly one sanctioned way to end a connection in this app, and it's a deliberate, visible action — never just silence.

### How it shows up

There are two ways someone can reach the exit flow: a standalone "End" option always available from a conversation's own menu, usable any time on any healthy connection at the user's own initiative — or as a real, actionable option offered directly inside the no-ghost reminders and the post-meetup "it was rough" outcome card, for the moments when ending really is the honest answer to what's already happening.

### The meetup outcome card

When a post-meetup check-in resolves badly (either person reported it went rough, or the two people's answers didn't match up into a mutual "went well"), the person who had the rough experience sees a private, non-judgmental card: *"That's worth noticing, not judging."* It offers three honest paths forward — keep a private note about what happened, pause the connection for a while, or use Honest Exit — with nothing forced and no verdict handed down about who was "right."

### What Honest Exit actually walks you through

Once someone chooses to end a connection, they're asked how: send a message, or end without one (a message-less ending still quietly notifies the other person the connection is over — it isn't a silent disappearance dressed up as something else). There's an optional, completely private reason (capacity, not a match, communication mismatch, leaving the app, a safety concern, or other) that only the person who wrote it can ever see — never shown to the other person, structurally, not just as a courtesy. If sending a message, a person can write freely, start from one of a few honest template openers and finish it in their own words, or ask AI to draft or polish something — but exactly like every other AI-assist moment in this app, nothing can be sent without a real edit first.

Whichever way it ends, messaging between the two people stops immediately, and reopening it later is deliberately a bigger, more explicit step than picking a normal conversation back up — nobody accidentally slides back into a connection they'd genuinely closed.

**Why this exists, and why ghosting was never an option to begin with:** this is the single clearest instance of the "respectful clarity" principle. The app's founding read on the problem is that ordinary digital products have quietly normalized ghosting and vague disappearance as an acceptable way to end things — and this app was built specifically to refuse that as an option. Both the honest "why" and the requirement to make a real, personalized message (not a generic auto-send) exist for the same reason the AI-drafting rule exists everywhere else: an ending, delivered by a real person in their own words, is a fundamentally different, kinder thing than silence or a copy-pasted brush-off, and the app is built to make the former easy and the latter unavailable.

Genuine safety concerns are the one case that skips all of this ceremony — Block and Report are always available immediately, with no explanation owed to anyone.

---

## 9. Remember

Remember is a private notebook attached to each person you've connected with — a place to jot down what you talked about, what you enjoyed, and what you might want to ask about next time. You can type freely or let AI lightly organize a rough note into something more readable (that offer is optional, never forced — writing it exactly as-is and saving it that way is treated as an equally valid choice). Entries are private to you alone, never visible to the other person, and can be edited, deleted, or exported at any time.

**Why it exists:** the app's own reasoning is refreshingly modest about what it's trying to do — this isn't meant to be a journaling app you spend time in. It exists to help you *pay attention and follow up*, the ordinary, unglamorous work that actually makes someone feel remembered. A note like "she mentioned her dog was sick" being there to jog your memory before the next hangout is a small thing that does a lot of the real work of making a new friendship feel attentive rather than transactional.

---

## 10. The Guide video library

A library of short videos teaching the everyday mechanics of adult friendship: how it actually forms (spoiler: slowly, through repetition, not instant chemistry), how to handle an awkward first meetup, how to be honest without oversharing, why friendship isn't always an even 50/50, how to raise something that feels off without turning it into an accusation, and how to sit with a friendship changing or ending.

Two of these — "Begin With Curiosity" and "How We Show Up" — are mandatory during onboarding, framed as the baseline standard for how people are expected to treat each other here. Every other video in the library is optional, and several are designed to surface contextually at the exact moment they'd actually be useful (one appears the first time you reach out to someone new, another after your first meetup, another if plans keep falling through) rather than being something you're expected to sit down and binge.

**None of this library is Premium-gated**, and that's a deliberate stance, not an oversight: this content was conceived from the start as a baseline standard everyone gets, not a paid perk — the same "safety and community standards are never for sale" logic that keeps the no-ghost system free for everyone applies here too.

---

## 11. Coach marks — the app's short guided tips

Scattered through the app are small, one-time explanatory tooltips — a quick "here's what this tab does" on first visiting Discover, or a brief note the first time a no-ghost reminder or a meetup check-in appears. Each one shows exactly once per person, and there's a "show tips again" option buried in Settings for anyone who wants a refresher.

**Why they're deliberately non-blocking:** early on, an earlier version of this dimmed the rest of the screen enough that it could interfere with actually using the app while a tip was showing. That was corrected — a coach mark should explain something, not get in the way of the very thing it's explaining. This is a genuinely small, practical design choice, but it echoes the same instinct running through the rest of the app: even a helpful nudge shouldn't be allowed to block a person from just going and doing the thing.

---


---

## 12. Free vs. Premium, the full picture

### What Premium actually unlocks, recapped in one place

Everything Premium changes about the app boils down to a handful of concrete numbers, all of which were already explained in context above:

- **5 new Discover suggestions a day, instead of 2.**
- **8 active conversations at once, instead of 4.**
- **8 pending "say hi" requests out at once, instead of 5.**
- **A shared monthly AI-assist budget, instead of small per-feature daily/weekly limits** (drafting replies, activity ideas, connection analysis, and the two AI-assist features inside Remember).
- **A once-a-day personality-reflection regeneration** (this one's actually capped identically for both tiers — it's simply a low-cost, low-need feature either way).

That's the entire list. There's no second, hidden list of things Premium unlocks in terms of *who* you're shown or *how well* you're matched — as covered earlier, that door is explicitly, permanently closed. Referring a friend who sticks around long enough is also one of the few ways to earn a free stretch of Premium without paying, and the app's cheapest AI-credit top-up (a small one-time pack of extra suggestions or AI-assist uses) is available to both tiers identically, mostly useful to a free-tier person who's run out for the day.

### Why does Premium have limits at all, instead of being genuinely unlimited?

This is worth answering honestly rather than glossing over, because it's a fair question — and the app's own design document actually addresses it directly, in almost these exact words:

> *Unlimited introductions would recreate dating-app disposability. Premium provides flexibility, not an endless supply of replaceable people.*

That's the real, stated reasoning, not an inference. It ties straight back to the core belief this whole guide opened with — friendship is something two people slowly build, not something you find by being handed more of it faster — and to the explicit principle that "every profile should receive genuine consideration; payment never unlocks unlimited people." An unlimited Premium tier would quietly turn the app into exactly the kind of high-volume, low-consideration product it was built to be an alternative to. The whole value of a small number of suggestions is that each one is worth actually looking at; remove the ceiling entirely and that value disappears, for paying and non-paying users alike, because the whole *pool* of quality attention the app can realistically create starts to thin out.

There's a second, separate, and more practical reason underneath that — worth being upfront that this one is somewhat different in kind, less a stated philosophical stance and more an operating reality the design document also discusses at length: every AI-assisted feature in this app (drafting a message, explaining why two people might connect, organizing a memory) costs real money each time it runs. The document's own cost planning explicitly budgets for this, tracks AI spend per user, and calls for techniques like caching and smaller models specifically to keep that cost sustainable — and the actual built app's own Premium AI budget is sized directly against real, current AI pricing, not picked arbitrarily. So even setting the quality-over-quantity philosophy aside entirely, a wholly unmetered AI feature for any tier would be financially unsustainable for a small, self-funded product to offer — which is presumably part of why "neither tier is unlimited" was written into the plan as a flat rule from the very beginning, not something added later once costs became a problem.

Put simply: one reason is about protecting what makes the product *good* (scarcity that keeps attention genuine), and the other is about what makes it *survive* (a real, metered cost the app has to actually pay for every AI action). Both point the same direction, which is presumably why the ceiling exists even for people paying for the privilege of a higher one.

---


---

## 13. Safety & accountability

**Report and Block** are always available from a person's profile, from a conversation, and directly from an active no-ghost reminder — never something someone has to dig for. Reporting covers eight categories (fake identity, harassment, romantic or sexual misuse, hate, scam, an unsafe meetup, impersonation, or something else), and for the categories that are genuinely safety-relevant, the option to also block that person is pre-checked by default, though never forced. Filing a report never requires keeping the conversation open or explaining yourself to the other person first. If someone reports an unsafe meetup specifically, the app shows real, concrete emergency guidance right there in the flow (calling 911 for immediate danger, plus real hotline numbers) rather than just quietly logging it.

Blocking is immediate and works in both directions — a blocked person can't see or message the blocker again, and the reverse is also true. Genuinely important: **the blocked person is never told they were specifically blocked.** They just see the conversation become unavailable in an ordinary, unremarkable way, the same as a few other reasons a conversation can go quiet. This is a deliberate choice, not an oversight — telling someone outright "you have been blocked" can occasionally escalate a situation with someone who wasn't safe to begin with, so the app opted for quiet and ambiguous over honest-but-provocative in this one specific case, the one real exception to the app's usual instinct toward directness.

**Photo verification (a live selfie check to confirm a profile is a real person, not a stolen photo) was part of the original plan and is not yet built.** This is worth being direct about, because the original plan treated it as something that should happen before a first message can be sent, precisely because a fake or stolen-photo profile undermines the basic premise that everyone here is a real, verifiable person. Right now, the app substitutes a real photo requirement (no photo, no visibility to anyone, enforced automatically) plus real phone and email verification, which is a meaningfully weaker guarantee — those confirm someone has a working phone number, not that their photo is genuinely theirs. This is a known, deliberately flagged gap rather than a forgotten one, and closing it before any real public launch matters more than most other unfinished pieces, because it's foundational to whether "verified profile" means what it claims to mean.

A few smaller, quieter fraud checks also run in the background — flagging when multiple accounts appear to be created from the same device close together, or when a cluster of referrals complete suspiciously fast — purely for manual review, never anything an ordinary user would notice or that automatically punishes anyone.

---

## 14. Settings

Settings is where account-level, less-frequently-touched things live: editing your profile, previewing exactly what your public profile looks like to someone else before they see it, your Premium status, your blocked-accounts list (with a real way to undo a block), a private list of reports you've personally filed, your referral code and a way to share it, links to the Terms and Privacy policies, and real account deletion.

**Worth knowing honestly:** the Terms and Privacy pages that exist right now are clearly marked as placeholder content, not final legal text — real legal review hasn't happened yet, which matters more than usual for this particular app given it facilitates real strangers meeting up in person and collects some genuinely sensitive personal information (life circumstances like bereavement or divorce, private personality answers). That's a real, open item, not a finished one.

---

## All 16 real triggers, at a glance

Every prompt or pop-up moment in the app, and where it's explained above:

| Trigger | What it is | Where it's covered |
|---|---|---|
| No-ghost R1 | First gentle reminder to reply (~20–36 hrs) | The no-ghost system |
| No-ghost R2 | Second reminder: reply, pause, or end (72 hrs) | The no-ghost system |
| No-ghost R3 | Final action prompt (120 hrs) | The no-ghost system |
| No-ghost S1 | Reminder to the person still waiting (125 hrs) | The no-ghost system |
| Propose / confirm a meetup date | The in-app plan-a-date flow | Scheduling a meetup |
| Day-of feeling check | Excited/Neutral/Nervous, day of a confirmed meetup | Before and after the meetup |
| First-meetup milestone | One-time check the first time "let's plan something" is used | Before and after the meetup |
| Post-meetup check-in | "How did it go?", roughly a week after planning activity | Before and after the meetup |
| Meetup confirmation | The other person confirms/denies a reported meetup, privately | Before and after the meetup |
| Meetup outcome card | The private, non-judgmental "worth noticing, not judging" card after a rough outcome | Honest Exit |
| Graduation modal | The five-meetup milestone moment | Graduation |
| 30-day continuation check | Private, backend-only check: did contact continue after graduating? | Graduation |
| 90-day continuation check | Same, at 90 days | Graduation |
| Honest Exit | The deliberate, only sanctioned way to end a connection | Honest Exit |
| Friendship-experience survey | Five private questions about your own past experience with new friendship | Onboarding (item 9) |
| Coach marks | Short one-time tooltips explaining a screen or feature | Coach marks |

---

*This guide describes the app as it actually behaves today, verified directly against the live product rather than assumed from any planning document. Where the original design and the live app differ, the live behavior is what's described above, with a note when the difference was a deliberate, considered choice rather than an accident. Nothing in the app's code was changed in the course of writing this.*
