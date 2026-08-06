# Limen: Current State

A plain-language reference for how the app actually works right now. Every claim here was checked directly against the live code and, where relevant, the live database, not copied from AGENTS.md's prose or a prior session's chat summary, both of which have been caught being wrong or stale multiple times across this project's history. Where something couldn't be confirmed with confidence, that's said explicitly rather than guessed at.

This is a working document. Sections are being filled in one at a time, each fully investigated before being written. The status line at the top of the file tracks what's done.

**Document status:** Complete. All 17 sections below have been investigated against live code and, where relevant, the live database, and written.

1. Onboarding
2. Discovery & Matching
3. Messaging & Connections
4. No-ghost system
5. Scheduling
6. Meetup confirmation & history
7. Graduation
8. Follow-up reflection
9. Guide/video library
10. Coach marks / app tour
11. Honest Exit
12. Remember
13. Premium & AI credits
14. Settings
15. Dev tab / Time Travel panel
16. Known bugs and open issues
17. Video hosting & infrastructure

---

## 1. Onboarding

The real, current order, confirmed screen by screen: Philosophy intro → Phone verification → Email verification → Name & birthdate → Gender identity (3 steps) → Social linking → Profile build (10 steps) → Personality reflection → Etiquette lessons → Readiness confirmation → "All set" → Home.

- **Philosophy intro.** A static welcome screen. Nothing to fill in, nothing saved.
- **Phone verification.** A real text-message code. Not skippable. This is how the account is actually created.
- **Email verification.** Genuinely optional, can be skipped. Worth noting: because of how this project's email sending is currently configured, a real confirmation code can't actually be delivered by email right now, only a clickable link works. This makes "skippable" not just a design choice but close to a practical necessity as things stand.
- **Name & birthdate.** First name and birthdate, both required (18+ is enforced, both on the device and on the server, not just a checkbox). This is also where an optional referral code can be entered, and where a required Terms of Service / Privacy Policy checkbox lives. This is the only place in onboarding where those are agreed to.
- **Gender identity (3 steps).** Who you are, who you're open to connecting with (plus a friend age range), and who's allowed to message you first. All three are required, nothing here is skippable.
- **Social linking.** Optional. Connecting a real Facebook, LinkedIn, or Google account earns a "verified" badge; an Instagram option exists on the screen but doesn't actually work yet.
- **Profile build (10 steps).** The longest part of onboarding. Genuinely required before moving on: your general location, at least one life transition you're navigating, your hangout style and preferences, your friendship type and how often you'd like to check in/meet/reply. Genuinely optional at every step: the "about you" writeup, your values, your interests, your languages/ethnicity, and your photo. Instead of being individually required, those optional pieces feed one overall "profile completeness" score that has to reach 60% before the very last step will let you continue. A photo isn't technically required to finish onboarding itself, but see Discovery & Matching below for why it's required in practice.
- **Personality reflection.** 10 short scenario questions. All 10 must be answered. The results are never shown as a score to the user; they quietly shape how the app's own tone and nudges feel for that person.
- **Etiquette lessons.** Exactly 2 required lessons ("Begin With Curiosity" and "How We Show Up"), each with a real, produced video and a short two-choice scenario at the end. Either choice completes it, there's no forced "correct answer" retry.
- **Readiness confirmation.** One combined screen (this used to be two separate screens, now merged into one). Choosing "I'm ready" is what actually turns on the behavioral-tracking disclosure and unlocks the rest of the app; choosing "I need more time" instead pauses the account for a chosen length of time (30/60/90 days) without going any further.
- **All set.** A static closing screen, then into the app itself.

---

## 2. Discovery & Matching

**Discover (the AI-suggested tab).** Built to feel instant: the app almost always reads suggestions it already generated earlier rather than asking the AI fresh every time you open the tab. A background job regenerates everyone's suggestions automatically every 6 hours, and a real, on-demand generation only happens the first time, or if that cache has gone stale.

**How compatibility is actually scored.** A 100-point additive score built from real profile overlap: shared life transitions (up to 25 points), shared values (up to 20), personality closeness (up to 15, the actual personality answers themselves are never exposed to any matching logic outside this one calculation), hangout-style compatibility (up to 10), friendship-type compatibility (up to 10), how well meeting-frequency preferences line up (up to 8), a shared language (5), communication-style compatibility (5), and shared activity interests (2). The only hard, non-negotiable filters are gender/matching preference, distance, and mutual age range. Everything else only ever adds or withholds points, it never disqualifies someone outright. A real AI model then writes the plain-language "why you might connect" reasoning, instructed to only ever describe real, actual overlap, never invent a connection that isn't there.

**Daily limits.** 2 new AI suggestions a day on the free tier, 5 a day on Premium. Someone who's hit their limit can spend a purchased AI credit to unlock exactly one more suggestion that day.

**Browse.** The manual, filter-it-yourself alternative to Discover. Same hard gender/age/block rules apply, plus an adjustable search radius (5 to 100 miles, 30 by default).

**Saved.** No longer has any time-based expiration. An earlier version of the app quietly removed a saved profile after 14 days, and that mechanism has since been found and fully removed. A saved profile today only disappears if the other account is deleted, or if the two of you fall outside each other's real, current age/gender eligibility. Softer mismatches (different values, different interests) never remove a save.

**A photo is effectively required to be seen at all.** Even though profile build (above) doesn't force a photo to finish onboarding, someone with no photo simply never appears in anyone else's Discover or Browse results, enforced directly at the database level, not just a front-end nicety.

---

## 3. Messaging & Connections

**Inbox has 6 real sections.** Awaiting your reply, Conversations (the default, healthy bucket), Paused, Graduated, Ended, and Blocked. A connection that's gone quiet long enough to auto-close (see the No-ghost system below) doesn't get its own section; it stays in Conversations with a small "Inactive" label, a deliberate choice, since that status is common enough that giving it a whole section would end up burying genuinely live conversations underneath it.

**Two real gates on sending the very first message of a new conversation**, both enforced at the database level, not just hidden in the app's own UI: you need a profile photo to send a first message (though you can still reply to one you've received even without a photo), and the other person's own stated messaging preference is respected (if they've said only a specific gender can message them first, or that no one can message them first at all, that's enforced for real, not just suggested).

**AI writing help.** A shared "help me write" tool available when composing a message (and reused for a few profile fields). Someone types their own real situation in their own words first; the AI drafts a short, first-person message grounded only in what was actually typed, never inventing a feeling or fact that wasn't there. A separate "clean up" option is also available once there's already text in the box; it only fixes clarity and grammar, explicitly instructed not to change the length or meaning. Either way, the result replaces the box in place with a real "undo" available.

**Limits on AI writing help.** 3 free uses a day (drafting and cleaning up share the same daily count, not two separate limits). Premium doesn't get a bigger daily number. Instead, every Premium account shares one real $3-a-month budget across writing help and a handful of other AI features together (see Premium & AI credits below for the full breakdown). Hitting either limit offers the same purchasable-credit unblock described elsewhere in this document.

**Active-conversation and pending "Say Hi" limits**, confirmed directly in the same capacity system used throughout the app: 4 active conversations and 5 pending Say Hi's on the free tier, 8 and 8 on Premium.

---

## 4. No-ghost system

**What it is.** A system that gently nudges someone to reply when a conversation has gone quiet, without ever letting silence be a real way to end things. The person who hasn't heard back gets a series of increasingly direct check-ins; the person who's waiting gets quiet reassurance, not pressure to chase.

**How it's triggered.** Time-based, checked automatically. A background job re-evaluates every real connection roughly every 15 minutes (confirmed against the live schedule) and looks at how long it's been since the last message. The clock only ever starts from a real message. Nothing fires on a conversation that hasn't started.

**The real timeline** (verified directly against the live database function, `run_no_ghost_check`):

| Elapsed time since last message | Who sees something | What happens |
|---|---|---|
| 20 hours (if the recipient said they usually reply the same day) or 36 hours (everyone else) | The person who hasn't replied | A gentle first reminder (R1) |
| 72 hours | The person who hasn't replied | A second reminder (R2), with real options: reply, pause the connection, or end it honestly |
| 120 hours (5 days) | The person who hasn't replied | A final reminder (R3), same real options |
| 125 hours | The person who's still waiting | Their own prompt: keep waiting, send one more follow-up, or close the conversation and free up their capacity for someone else |
| 168 hours (7 days) | Nobody, this happens silently | The connection is automatically marked inactive. No message is sent to either person. |

The person waiting for a reply also sees a quieter, passive reassurance line in the chat itself at the 20-hour and 72-hour marks (something like "they may just need more time"), separate from the reminders above. This is just informational text, not a real database event.

**Pause and resume.** Either person can pause a connection, which stops this whole clock immediately (verified live: nothing fires again until it's resumed, even checked days later). A pause also clears out any reminder that had already fired, so it doesn't linger after the pause. Sending a new message automatically resumes a paused connection.

**What stops the clock entirely.** A connection that's paused, inactive, blocked, or has been formally ended (see Honest Exit) is skipped by this whole system. None of the reminders above will ever fire for it, checked directly in the code's own guard condition.

**Known quirk, already fixed:** for a while, a connection that became blocked or formally ended could be left with a stale, already-fired reminder still showing, or could keep generating new reminders even after being blocked. This was found and fixed (a database trigger now clears out any pending reminder the moment a connection is paused, blocked, ended, or goes inactive, and the reminder system itself now also skips blocked/ended connections when deciding whether to fire something new). Verified fixed as of the current code.

---

## 5. Scheduling

**What it is.** A lightweight way for two people to agree on a real date to meet up, plus a same-day check-in for whoever's feeling nervous about it. This replaced an earlier, more rigid date-and-time booking system that turned out to be broken (the meetup count it was supposed to feed was never actually being written). That old system has been fully removed, not just hidden.

**How proposing and confirming works.** Either person can propose a date (a plain date, no time) from the thread screen. The other person taps to confirm it. If either person wants to change the date, proposing a new one automatically resets it back to "needs confirming." There's no separate "reschedule" button, proposing again is the reschedule.

**Day-of feeling check.** On the actual day of a confirmed meetup, the person opening the app is asked how they're feeling about it: Excited, Neutral, or Nervous. Excited and Neutral just acknowledge and move on. **Nervous plays a real, short video** (verified: a real 1080×1920 video file hosted in Supabase Storage, not a placeholder) offering some reassurance before the meetup, with a "Done" button the person taps once they've watched it (or skipped past it) to dismiss the card.

**What happens after the date passes.** A separate, elapsed-time check (not the date itself, since there's no way to know for certain someone actually opened the app on the right day) asks each participant how it went, the day after a confirmed date. This feeds into the meetup confirmation system described in the next section: a real, mutually-agreed meetup is what actually gets logged and counted, not just the date being confirmed in advance.

**What still uses the old "roughly a week since we last talked about it" trigger.** If a connection never has a confirmed date at all, there's a fallback: if a week goes by with no more planning activity, the same "how did it go" check fires anyway, on the theory that people often meet up without ever formally confirming a date in the app. Both paths (a passed confirmed date, or the week-long fallback) lead to the exact same check-in card.

---

## 6. Meetup confirmation & history

**What it is.** The mechanism that decides whether a real, in-person meetup actually counts, both for a running count shown in the app, and for a real, dated history log kept per connection. Built recently, replacing an older, more fragile version of this idea.

**How it used to work, and why it changed.** Previously, both people would independently answer "how did it go" (well / rough / didn't happen / still figuring it out), completely separately, and the count only went up if BOTH of them happened to land on "went well" specifically. There was no history behind the number at all, just a running integer with nothing recorded about when any of it happened. That old mechanism has been fully replaced.

**How it works now.** Each person still privately answers their own "how did it go" question exactly as before; that's still a private, no-strings-attached record for that person, whatever they answer. But if someone answers "yes, it went well" or "yes, but it was rough" (either one, a rough meetup still counts as a meetup that happened), the OTHER person now gets a direct, separate question: did a meetup actually happen around this date? They can say yes, say no, or just not respond.

**Only a real "yes" from both sides logs anything.** A "no," and simply not answering at all, are treated identically. Nothing gets logged either way, and there is no way for the person who originally reported the meetup to tell which of the two happened. This was built deliberately: verified directly that the database rules make it structurally impossible for the reporter to ever see whether the other person said no or just never answered, not merely a case of the screen not showing it.

**What gets recorded on a real "yes."** A dated entry in a real history table (one row per confirmed meetup, with the date and whether it was reported as having gone well or roughly), and the running meetup count on the connection goes up by exactly one.

**Where it shows up.** The top of a thread screen shows a line like "Met 3 times · Aug 5, Jul 12, Jun 28" once at least one meetup has been mutually confirmed. It's not shown at all for a connection that hasn't met yet, so it doesn't clutter a brand-new conversation.

**A known, disclosed limitation.** Any connection whose meetup count was already above zero from the OLD mechanism, before this change, has no real dated history behind that number. It's not possible to reconstruct after the fact, since the old system never tracked individual confirmations. This only affects data from before the new system existed.

---

## 7. Graduation

**What it is.** A milestone moment offered once two people have really met up five times (through the mutual-confirmation system above, not the old, less reliable count). It's meant to celebrate that the friendship has become real, and to gently suggest the conversation doesn't need to keep living inside the app.

**What it looks like.** A screen offering this exact text: *"You have met five times in person. That is a meaningful sign that you are building something real. You can keep this chat available, or exchange phone numbers and continue by text or phone. Your friendship does not need to stay inside the app."* Three choices are offered, none more prominent than the others: **Move to Graduated**, **Keep chat available**, or **Not yet**.

**None of the three choices force anything.** Choosing "Move to Graduated" doesn't delete or archive anything; the conversation, and any private notes kept about that person (see Remember), stay exactly as accessible as before. The only real effect is a status change and one practical benefit described below.

**Real effect of graduating.** A graduated connection no longer counts against how many active conversations someone is allowed to have at once (verified live: this is a real exclusion in the capacity-counting logic, confirmed by directly comparing the count before and after graduating a test connection).

**"Not yet" and "Keep chat available" behave the same way underneath.** Neither one changes anything about the connection's status. Both simply mean the prompt won't show again until there's been a genuinely new, sixth confirmed meetup. It doesn't nag on every visit, but it also doesn't disappear forever. This was a deliberate design choice (a pure "don't ask again" would mean the prompt could never resurface even after a real, later 6th or 7th meetup).

**Where a graduated connection shows up.** Its own section in the Inbox, labeled "Graduated," showing the same last-message and meetup-count information every other conversation shows.

**An optional, quieter measurement, not shown to the user.** 30 and 90 days after graduating, the app privately checks whether the two people kept messaging each other at all after that point, purely for the founder's own understanding of whether graduation is actually the right moment to suggest it. There's no user-facing prompt or notification tied to this, it's a background measurement only. This part of the spec is explicitly marked "optional" in the source material it was built from, and was built accordingly as a lightweight, no-UI addition.

**Not built.** There is no in-app way to actually exchange phone numbers. The app only recommends doing so in the text above and expects the conversation to move to texting or calling outside the app from there.

---

## 8. Follow-up reflection

**What it is.** A private prompt asking whether there's something worth following up on or celebrating from a recent conversation, a gentler, non-urgent nudge, separate from the no-ghost system above (which is specifically about someone not having replied at all).

**How it's triggered.** Automatically, checked every hour. It fires once a conversation's most recent message is at least 24 hours old, but only for a conversation that's had a genuine back-and-forth, at least one message from each person, not just an unanswered first message (an unanswered opener is the no-ghost system's territory, not this one). Both people get their own private prompt when it fires. Sending a new message in that conversation immediately clears any pending prompt, since the lull it was about no longer exists.

**Current status: confirmed active, not dropped.** This was flagged as worth double-checking, since there was a point earlier in the project where a related but different feature (a set of "your experience with new friendship" reflection questions) was intentionally moved out of onboarding. That's a separate feature from this one. This follow-up reflection prompt itself is genuinely still running on its real hourly schedule and is genuinely still shown in the conversation screen today, confirmed directly in the code, not assumed.

---

## 9. Guide/video library

**What it is.** A library of short lessons about friendship, reachable both as part of onboarding and later, any time, from a person's own Profile.

**What's in it.** 13 entries in total: 11 numbered lessons (two of which are required during onboarding, "Begin With Curiosity" and "How We Show Up") plus 2 additional entries that exist only in the library, not tied to onboarding at all ("The First Meetup Does Not Need to Be Perfect" and "Friendship Grows a Little at a Time").

**Real video vs. placeholder.** Only 4 of the 13 entries have a real, produced video: the 2 required onboarding lessons, plus the 2 library-only entries. The other 9 lessons currently show a placeholder in place of a video (real written content, just no video yet). The Guides list shows a small real video thumbnail next to each of the 4 that have one.

**Two different ways to view a lesson.** The required onboarding lessons are shown as part of a short quiz: watch (or see the placeholder), read a short explanation, then answer a simple two-choice scenario question before it's marked complete. Everything reached from the general library (including the 9 non-mandatory lessons and the 2 video-only entries) is shown as a plain, read-only screen instead: video and a short written passage, no quiz, no "lesson 3 of 11" framing.

---

## 10. Coach marks / app tour

**What it is.** Small, first-time-only tooltips that appear the first time someone lands on a specific screen or sees a specific card, explaining what it is. Not a single guided tour through the whole app; each tip is independent and can appear on its own, whenever its specific trigger is first encountered.

**Where they appear.** 9 real spots: each of the 4 main tabs shown in the tab bar, the Remember tab, the Profile tab, a first-time no-ghost reminder card, a first-time meetup check-in card, and a first-time "you've hit a usage limit, here's Premium/credits" moment (this last one can be triggered from six different places in the app, but only ever needs to be shown once).

**How "already seen" is tracked.** Per person, stored for real in the database, not just on-device, so it follows someone across sessions and devices. Someone can ask to see every tip again from Settings ("Show tips again"), which genuinely clears the record and lets every one of the 9 fire again.

**A real bug that was found and fixed.** For a while, the dimming effect behind an open tooltip could actually block taps on whatever was underneath it, meaning a tip on one screen could make it impossible to tap away to a different tab until that tip was specifically dismissed first. This has been fixed. The dimming is now purely visual and never intercepts a real tap. Confirmed directly in the current code, not just believed fixed.

---

## 11. Honest Exit

**What it is.** The one deliberate, real way to end a connection (this app's explicit alternative to ghosting). Ending a connection is always a real, chosen action, never something that just happens from silence alone.

**Three ways to reach it**, all leading to the same real action underneath: a plain "End" option always available from the top of a conversation screen (for ending a healthy conversation on someone's own initiative, not tied to any other prompt), or through two other, older prompts (the no-ghost system's own escalation card, and the "that meetup was rough" follow-up card) that also offer ending the connection as one of their real options.

**A message is optional, not required.** Someone can choose to send a short explanation, or end the connection with no message at all. Either way, the connection is genuinely closed on both sides. When there's no message, the other person still sees a plain, honest notice that the connection was deliberately ended (distinct wording from what they'd see if it simply went inactive from silence).

**Message templates give a starting phrase, not a finished sentence.** If someone picks a suggested wording (e.g., "not the right fit for each other"), it fills in the box as an unfinished sentence they're expected to keep writing, not something ready to send as-is. In practice, the Send button unlocks as soon as the person taps into that text box at all, not only once they've actually added their own words. So this is a nudge toward writing something personal, not a hard requirement enforced by the app.

**A private reason can be recorded, and it stays genuinely private.** Someone ending a connection can optionally note why (capacity, not a match, a communication mismatch, leaving the app, a safety concern, or another reason of their own). This is stored in a way that makes it structurally impossible for the other person to ever see it, enforced at the database level, not just left out of the screen.

---

## 12. Remember

**What it is.** A private notebook for keeping notes about people someone has actually spent real time with, separate from the live matching and messaging parts of the app, meant to be a lasting personal memory, not something the other person ever sees.

**Who shows up in the list.** Anyone with at least one real, mutually-confirmed meetup, or anyone with at least one note already written about them, even before a first meetup. Once someone is in this list, they generally stay there; the list isn't re-filtered by current age or gender preferences, or by whether they've since been blocked, since the point is a lasting record, not a live matching feed.

**Adding a note.** Always starts with someone's own raw, typed words. From there, two equal choices: save it exactly as written, or ask the AI to organize it into a short, cleaned-up summary (plus an optional reminder for next time), always shown back for review and must be explicitly approved before it's saved. Nothing is ever auto-saved, and using AI is never required. A note can also be tagged with the real date something happened.

**Editing, deleting, and privacy.** Notes can be edited or deleted after saving, and there's a full "delete everything about this person" option. Every note is strictly private; the other person in that friendship has no way to see anything written about them, enforced at the database level.

**Exporting.** A real export exists: every note, across everyone, as a downloadable file (or shared via the phone's normal share option on mobile).

**Voice input is not real yet.** There's a microphone icon on the note-writing screen, but tapping it doesn't record or transcribe anything, it just shows "Voice input coming soon." No actual voice-to-text exists anywhere in the app yet.

---

## 13. Premium & AI credits

**Premium price and what it unlocks.** $5.99/month, one plan. It does not change who someone is matched with or how good those matches are; the app is explicit about this. What it actually changes is capacity:

| | Free | Premium |
|---|---|---|
| New AI match suggestions per day | 2 | 5 |
| Active conversations at once | 4 | 8 |
| Pending "Say Hi" messages waiting on a reply | 5 | 8 |

**Free-tier limits on AI-assisted features**, confirmed directly against the real, live numbers stored in the database: help writing a reply, 3 times a day; activity suggestions for a meetup, once a week; the "why might we connect" analysis, once a week; organizing a Remember note with AI, twice a week; summarizing someone's whole Remember history with AI, twice a week. A separate, smaller limit (once a day, for both free and paid accounts) applies specifically to re-generating someone's own personality reflection.

**How Premium's own AI usage is limited instead.** Rather than the same per-feature daily/weekly limits, Premium accounts share one combined real-dollar budget, $3.00, across all of those same AI features together, resetting on a rolling 30 days from whenever they first use one of these features (not tied to a calendar month or a real subscription renewal date, since the app doesn't currently have one to anchor to).

**Buying extra AI credits.** A separate, one-time purchase: $1.99 for 50 credits. If someone hits any of the limits above (free or Premium), the app will automatically spend one credit to let that one specific blocked action through, rather than a broader "unlimited for a while" pass. One credit covers exactly one extra blocked action.

**A real, disclosed limitation on both of these.** The actual purchase logic (for Premium and for AI credits) is fully built, including genuine verification with Apple/Google after a purchase, never just trusting the app's own client. But neither has ever been tested by actually completing a real purchase, because that specific step requires a real phone with a real native build of the app, which isn't available in this development environment. This is an acknowledged, known gap, not something silently assumed to work.

---

## 14. Settings

Everything actually present on the Settings screen today:

- **Account**: edit profile, and a preview of what your own public profile looks like to someone else.
- **Premium**: shows whether you're currently on Premium and when it renews or expires; if not, a link to the real purchase screen (nothing is purchased from Settings itself).
- **Invite a friend**: shown only once someone has a referral code, with a real share/copy action and the actual current terms of the referral reward spelled out in plain language.
- **Notifications**: an honest note that there's no push or email notification system yet, rather than a toggle that would quietly do nothing.
- **Help**: "Show tips again," a real reset of every first-time tooltip described in the Coach marks section above.
- **Privacy & Safety**: a list of blocked accounts with a working way to unblock someone, and a collapsible list of reports you've personally filed.
- **Legal**: links to the Terms of Service and Privacy Policy.
- **Account deletion**: a real, two-step confirmation, followed by genuine, permanent deletion of the profile, matches, and conversations tied to that account.

---

## 15. Dev tab / Time Travel panel

**What it is.** A developer-only screen (never visible in a real production build) used for testing time-based and multi-step features without waiting for real time to pass or needing two physical devices. It's grown into a large, easy-to-forget system in its own right, which is why it gets its own summary here.

**Core tools, already existed before the most recent expansion:**
- Sign in as any of 9 fictional seed test accounts, to see both sides of a conversation.
- Force-fire any step of the no-ghost reminder sequence (R1/R2/R3/S1) on a chosen conversation, or run the real reminder logic with a simulated "pretend this many hours have passed" offset and see the real, honest result rather than just triggering something blindly.
- Backdate a connection's last planning activity and run the real meetup check-in logic the same way.
- Force-fire or reset the follow-up reflection prompt (see that section).

**"Time Travel" panel, a newer, larger addition covering gaps the tools above didn't reach:**
- Backdate a conversation's most recent message, or insert a brand-new message from either person with a specific, backdated timestamp, useful for setting up a specific conversation shape to test against.
- Directly set a connection's proposed/confirmed meetup date and who proposed it, without going through the real propose-and-confirm flow.
- Backdate the timestamp that controls when the private "your experience with new friendship" reflection becomes eligible to show.
- Reset a person's "seen this tip before" tooltips, either all of them or one specific one.
- Clear someone's private friendship-experience answers, to re-test what a first-time reflection looks like.
- Run the real follow-up-reflection check with a simulated time offset (this was a genuine gap before, this logic previously had no dev-facing way to run it and see a real result at all).
- Clear or backdate someone's AI usage: covers all five of the app's real usage-capped AI features plus the separate personality-reflection retake limit, either wiping it clean or pushing it back in time so the normal daily/weekly limit resets.
- Reset or backdate the shared monthly dollar-based AI allowance Premium accounts get.

**A known, disclosed limitation.** The plain "tap to sign in as a seed account" buttons in this screen have been found to be unreliable in this specific development environment. Clicks sometimes silently don't register, for reasons traced to a deeper, unresolved compatibility issue between this project's exact combination of tooling (not something wrong with this screen's own code). See the Known Bugs section for the full detail. A reliable workaround (signing in through a direct, lower-level method rather than clicking the button) exists and has been used throughout recent testing.

---

## 16. Known bugs and open issues

Each item below reflects its real, current status, checked directly against the live code rather than assumed fixed just because a past session said so.

**Dev tab sign-in buttons are unreliable, still open.** Clicking a seed account's name in the Dev tab sometimes does nothing at all, with no error shown. This was investigated in real depth in an earlier session: it isn't caused by anything specific to this app's own code, and doesn't reliably reproduce the same way twice, which points to a deeper mismatch between this exact combination of development tools rather than a straightforward bug with a clear fix. No reliable fix was found. A dependable workaround exists (signing in through a more direct, lower-level method instead of clicking the button), and has been the standard way of testing anything requiring a real signed-in session ever since, including throughout the sessions that built the meetup-confirmation, Graduation, and Time Travel systems described elsewhere in this document. This only affects developer testing, never a real user, since this whole screen doesn't exist in a real build of the app.

**A first-time tip can block taps to whatever's underneath it, on one specific screen, still open.** The "your experience with new friendship" reflection popup (a separate feature from the Follow-up reflection described earlier) can, on the Discover tab specifically, sit on top of other content in a way that swallows taps meant for whatever's underneath it, until it's explicitly dismissed. This was found and clearly flagged in an earlier session, and a direct check of the relevant file just now shows no sign it's been addressed since; no positioning/layering fix present in that component. Worth a dedicated look, not attempted here, since this document is about recording current state, not fixing things.

**Real phone numbers may not receive their verification text. Open, and the cause sits outside this codebase.** A real user reported never receiving their phone verification code. This was investigated carefully rather than assumed to be a bug in the app: the texting service (Twilio) is genuinely configured with real, working credentials, and a live test confirmed the whole pipeline genuinely attempts to send and correctly reports failures back to the app when something goes wrong. The most likely real explanation, based on direct evidence (a Google Voice number receiving the code successfully while a real mobile carrier number did not), is that the carrier is filtering the messages because this texting account hasn't yet completed a real business-registration process carriers now require (commonly called A2P 10DLC registration), a process that happens entirely outside this codebase, through Twilio's own account console, and can take real time to complete once started. Nothing about this can be fixed by changing code.

**Everything else checked this session is confirmed still working as intended**, including the meetup-confirmation privacy guarantee, the Graduation capacity exclusion, the coach-mark dimming fix, and the Honest Exit private-reason guarantee. Each was independently re-confirmed against live code or the live database while writing this document, not just repeated from an earlier claim.

---

## 17. Video hosting & infrastructure

**Where videos actually live.** Real, produced video files are hosted directly in this project's own Supabase storage (the same backend that runs the database), in a bucket set up specifically for this purpose. Nothing is embedded or bundled into the app itself; every video is streamed from a real, public URL at the time someone watches it.

**How videos are played.** A modern, currently-recommended video player component (`expo-video`) is used throughout the app, replacing an older approach that Expo itself has since marked as being phased out. The same player is reused everywhere a real video appears: onboarding's two required lessons, and the two library-only entries described in the Guide/video library section.

**Thumbnails.** The Guides list shows a small real preview frame for each of the 4 videos that exist, rather than a generic placeholder icon, pulled directly from a real moment early in each actual video, not a separately generated image file.

**A real, disclosed limitation: never tested on a real phone.** Every video, thumbnail, and player check described anywhere in this document was verified in a web browser, since that's the only environment available during development. Nothing about how this behaves on a real iOS or Android device has been confirmed. It's expected to work, since the same underlying technology is meant to work the same way across platforms, but that expectation hasn't actually been tested on real hardware. This is the same standing limitation that applies to a few other parts of the app mentioned elsewhere in this document (real purchases, and voice input once it's eventually built).
