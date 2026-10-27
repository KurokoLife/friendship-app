# Limen: status, open decisions and to-dos

Last updated 2026-10-27. The detailed decisions per area are in docs/DECISIONS.md (in the repo).

## Rebuild (docs/context/05_LIMEN_REBUILD.md)

| Stage | Status |
|---|---|
| 1. New home and tabs | Built 2026-10-25 (migration 20261025000000). Empty-state wording approved Oct 26 |
| 1b. Design pass | Built 2026-10-25 (migration 20261025000001). Look is version 1; founder to review after pilot feedback |
| 1c. Your circle fixes | Built 2026-10-26 (migration 20261026000000; redeploy delete-account). "soon" and "won't bring X up" wording approved Oct 26 |
| 2. Joining | Built 2026-10-26 (migrations 20261026000001, 20261027000000). Drafts decided Oct 27: the profile card comes back 30 days after Not now and ends after the third; new Discover invitation line; the rest approved (docs/DECISIONS.md section 14). Voice pass on profile screens left for stage 6 |
| 3. Suggestions (needs a real phone test) | Not started |
| 4. Say hi | Not started |
| 5. Planning | Not started |
| 6. Finishing pass | Not started |

## Review status by area

| Area | Status |
|---|---|
| 1. Onboarding | Decided and built (Oct 4) |
| 2. Profile | Decided and built (Oct 4, reviewed Oct 14: small photo, Edit profile list with matching labels, connection summary, take a break) |
| 3. Safety | Decided and built (Oct 4, selfie rules updated Oct 9) |
| 4. Discover and matching | Decided and built (Oct 10, Pending tab Oct 14): one a day, Saved and Interested for 30 days, Inbox tabs incl. Pending |
| 5. Chat and reflection | Decided and built (Oct 13): Check and "Another way to see it" removed, Reflect first tips, care words in the header |
| 6. Reminders | Decided and built (Oct 10) |
| 7. Meetups and planning | Decided and built (Oct 8 to 13; Plan something on one screen Oct 13). Morning-of video waits (see below) |
| 8. Graduation | Decided (Oct 13): 6 meetups over 8+ weeks, each planned 2+, no pace needed; decision at 10 meetups or 6 months; supportive question wording |
| 9. Remember | Decided and built (Oct 10): in the chat, no AI, no tab |
| 9b. Guide | Removed 2026-10-25 (rebuild stage 1) |
| 10. Money and settings | Settings reviewed Oct 14. Money: free during the pilot; decided after the Guide ("Limen: Money decision page" doc). Promo/invite codes hidden for now |

Suggested next: Guide (9b, founder working on videos separately; includes the "reply within 48 hours" guide text and the Short guides switch), then Money and settings (10). Later: changing your phone number.

## Open founder decisions

(Oct 25: the Guide is removed, so items 1 and 2 no longer apply.)

1. Guide: are 3 videos (two at joining, one before the first meetup) enough for launch? Should the other reads move to the moments they help? Guide offers were removed from inside chats on Oct 10 ("A short guide on showing up for a new connection" and "Friendship tends to grow a little at a time"); decide where those belong now.
2. Morning-of video "The First Meetup Does Not Need to Be Perfect" is also offered before later meetups. Update its title or content to fit any meetup (waiting; a reminder is set for Oct 17).
3. Discover: watch in the pilot whether one a day feels right, and whether people run out of new people in smaller cities.
5. Graduation thresholds were confirmed Oct 13 (twice a month is a good pace); revisit only if pilot data says otherwise.
6. Pricing decided Oct 14: free pilot, then 21-day free trial, then $39 for 90 days. Still open (Money decision page): auto-renew or reminder, when the trial starts, what stops after it, hardship pass, graduated friends free. Build after the Guide.

Decided recently (don't re-ask): a meetup added with "Met up already? Add it" counts after a week even without the other person's yes. Remember has no AI and no tab. No "share my plan" feature.

## Founder to-do list (not code)

- Twilio A2P 10DLC registration, so real mobile carriers deliver the sign-in code (Google Voice numbers work today, real carriers may filter).
- Turn on Google and Apple sign-in in Supabase (Authentication → Providers). Apple also needs an Apple Developer key.
- Lawyer-reviewed Terms of Service and Privacy Policy, plus selfie (biometric) consent wording. The pages in the app are placeholders.
- Make your own account an admin to review selfies (Supabase SQL Editor): `update public.users set is_admin = true where id = '<your user id>';`
- Keep the database and server functions up to date: run each new migration from its raw GitHub link, and redeploy changed functions from the dashboard.
- Decide on a report data retention policy (legal question).

## Not built yet (deferred on purpose)

- Push notifications (everything shows when the app is opened).
- Voice input (mic icons are placeholders; needs a custom app build).
- Store products for the Journey pass.
- Stories: a private "what people asked you" view for the writer.
- "Wonder before meeting": two private curiosity notes before a meetup and "Did you learn either?" afterward.
- "Follow the thread" (an idea from the old Check feature, now removed).
- Real phone-device testing (only the web version has been tested end to end).

## Cleanup debt (safe to leave, remove when convenient)

- Old purchase code: `src/lib/ai-credits.ts`, `src/lib/premium.ts`, receipt functions.
- Hidden Browse tab and its connection-analysis sheet; `generate-activity-suggestions`.
- Old planning and intervention functions and tables in the database (unused).
- History moved to docs/archive/ on Oct 10 (full old AGENTS.md and PROGRESS.md). Searchable, often out of date, never auto-loaded.
