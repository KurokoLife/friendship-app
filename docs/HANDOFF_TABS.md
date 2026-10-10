# Handoff: working on Remember and the other tabs

Written 2026-10-10 at the end of the chat/Inbox round, for a new chat that
picks up the tabs. Read this first, then the files it points to.

## 1. Working with the founder

- Plain, non-technical, step by step. The founder gets confused by jargon and long lists.
- For each task, ask about Goal / Context / Action / Output before building, unless it's already clear.
- Don't just agree. Say what you think is best and why.
- Keep replies short. Give links and exact steps when the founder has to do something.
- Update PROGRESS.md (a dated session entry) and AGENTS.md (a bullet under "LIMEN V2 DECISIONS") every session. Record decisions in docs/DECISIONS.md.

## 2. Product rules that apply everywhere

- AI never writes, rewrites, or polishes a message to another person. Starters are fine, but the person must add their own words before sending (`StemMessageBox`).
- The app never reads message content. Reminders and nudges use timing only.
- Respect intention and agency: equal choices, no pushing, never act on someone's behalf, never replace a human.
- Reduce anxiety and uncertainty. Calm, honest copy. Never "your turn".
- No em dashes in app copy. No therapy language.
- Private stays private. Use own-row RLS, and RPCs that never return the other person's private answers.
- Every chat card can be turned off or put away. Only one prompt card shows in a chat at a time (`get_active_intervention` ranks them).

## 3. Where things are

- Repo: `KurokoLife/friendship-app`, branch `limen-v2-ethics-alignment`. Publish with:
  `git push origin limen-v2-ethics-alignment && git push origin limen-v2-ethics-alignment:master`
- Commit trailers (end every commit message with these):
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_011o18t9xFhCBHutCQzEa8HQ`
- **Database changes:** add a new file in `supabase/migrations/` (name `YYYYMMDDNNNNNN_short_name.sql`, safe to run twice). Make it bump `limen_db_version()` to the new file's number. Update `REQUIRED_DB_VERSION` and the `RECENT_DB_UPDATES` list in `src/lib/db-version.ts`. The founder runs it by pasting the raw GitHub link into the Supabase SQL Editor:
  `https://raw.githubusercontent.com/KurokoLife/friendship-app/limen-v2-ethics-alignment/supabase/migrations/<file>`
- **Server functions** (`supabase/functions/*`): the founder pastes the file into the Supabase dashboard (Edge Functions, the function, Code, Deploy). There's no CLI access from the workspace.
- **Testing:** the local test copy in `qa/` (see `qa/README.md`). Run `npx tsc --noEmit` before every commit.
- **Test tab** in the app (admins and test accounts): "Act as" a test account, then use time-travel tools per chat (quiet chat, meetups, nudges, reminders).

## 4. Docs, in order of trust

1. `docs/DECISIONS.md`: founder decisions by area, with a status table. Area 9: Remember decided and built 2026-10-10; Guide has a draft plan (section 9b), not decided.
2. AGENTS.md, section "LIMEN V2 DECISIONS": the newest decisions (Oct 3 to Oct 10). They supersede everything else in AGENTS.md. The long F1 to F33 sections below them are history and are often stale (Premium, credits, Browse, R2/R3 reminders and the old meetup system are all gone).
3. `docs/LIMEN_V2_DECISIONS.md`: the Oct 3 ethics review (no AI writing, 3 suggestions a week, flat caps, graduation, stories, money).
4. PROGRESS.md: the session log. Read the last 8 entries (Oct 8 to Oct 10). Older entries are history.
5. `CURRENT_STATE.md`, `FULL_APP_INVENTORY.md`, `APP_SCREENS_REFERENCE.md`, `PRODUCT_GUIDE.md`: older overviews from August. Check them against the code before trusting anything.

## 5. The tabs today

The tab bar is set in `src/app/(tabs)/_layout.tsx`: Discover, Saved, Inbox, Profile (Remember tab removed 2026-10-10, notes now live in each chat), and Test (admins and test accounts only). Browse is hidden (`href: null`). The account key there remounts every tab when someone switches accounts.

| Tab | File | State |
|---|---|---|
| Discover | `(tabs)/home.tsx` | 3 suggestions per rolling week (`generate-match-suggestions`). Interested gate and approved-selfie check before the first message. Area 4 is only partly decided. |
| Saved | `(tabs)/saved.tsx` | No expiry. A save disappears only if the account is deleted or the pair no longer fits gender or age (`saved_profiles` view). Not reviewed in v2. |
| Inbox | `(tabs)/inbox.tsx` | Reviewed and rebuilt Oct 8 to 10: New hellos, invites to meet, planning stages, capacity line ("N of 3 active conversations"), Paused / Ended / Closed / Graduated sections. Considered done. |
| Remember | `(tabs)/remember.tsx`, `remember/[connectionId].tsx` | **Rebuilt 2026-10-10 inside the chat** (docs/DECISIONS.md section 9). The tab file is gone; section 6 below describes the old version. |
| Profile | `(tabs)/profile.tsx` | Rebuilt Oct 6: your profile as others see it, private fields in an "Only you can see this" box. Links to Edit (`profile-build.tsx`), Guide (`guides.tsx`) and Settings. Area 2 decided. |
| Guide (no tab) | `guides.tsx`, `guide/[id].tsx`, `module/[id].tsx` | Flat list: 2 onboarding videos, "The First Meetup Does Not Need to Be Perfect", "Friendship Grows a Little at a Time", then 9 text modules. Data in `src/lib/modules-data.ts`, `src/lib/guide-only-entries.ts`, `src/lib/module-videos.ts`. Reached only from Profile. |
| Settings (no tab) | `settings.tsx` | Edit profile, Reminders and nudges (on/off for all chats), blocked accounts, reports, Terms/Privacy, delete account. Area 10 not reviewed. |

## 6. Remember before 2026-10-10 (replaced, kept for history)

- **People list** (`remember_people` view): anyone you've met at least once (`connections.meetup_count > 0`, kept up to date by the meetup counting from Oct 10) or written a note about.
- **Timeline per person:** entries grouped by meetup number (`meetup_number_at_entry`, set by a trigger), each with an optional date. Each entry can be edited or deleted, and all history with one person can be deleted with a two-tap confirm.
- **Add entry** (`remember-entry-composer.tsx`): own words first, optional prompt captions, and a mic placeholder that does nothing yet. The person chooses "Save as written" or **"Organize with AI"**: the `organize-remember-entry` function rewrites the note into a summary plus a follow-up line, which the person edits and approves.
- **"Summarize for me"** on the timeline: the `summarize-remember-timeline` function summarizes the raw notes.
- **Export** of all notes as JSON (download on web, Share sheet on the phone).
- **Before planning:** when someone taps "Let's plan something" (after the first time) and has a note about that person, `RememberReminderCard` shows the latest note first (`thread/[id].tsx`, around line 690).
- **Private:** own-row RLS only. The other person never sees anything.
- **Leftover Premium copy (confirmed):** both AI buttons still go through the old free-tier caps (`get_ai_gate_status`). When a cap is hit, the screen still says "buy 50 credits" / "Upgrade to Premium" and shows a "See Premium" tip (`remember-entry-composer.tsx` around line 140, `remember/[connectionId].tsx` around line 300, `organize-remember-entry` around line 80). This contradicts the no-Premium decision and needs fixing whatever the founder decides about AI here.

## 7. Questions to raise with the founder for Remember (and Guide)

1. **AI organizing and summarizing private notes.** No message is sent, so it doesn't break the "AI never writes messages" rule. But principle 4 says AI never does what the human is supposed to do, and remembering someone is part of caring. Options: keep as is, keep "Summarize" only, keep neither, or replace both with reflective prompts ("What did you learn about them?", "Anything to ask next time?").
2. **Where Remember shows up.** There's no link from a chat to that person's notes anymore (the old meetup-outcome card that linked there was retired). Should the after-a-meetup card offer "Write a note for yourself", and should the chat header link to the notes?
3. **What to remember.** Free text only, or a few light fields (things they mentioned, things to ask next time, dates that matter to them)? Remember should stay low effort.
4. **The before-planning reminder:** keep it as a separate pop-up, or fold it into the planning card?
5. **Graduation and closed chats:** keep notes after a chat ends or graduates (currently kept), and say so in the app?
6. **Voice notes:** the mic placeholder (needs a custom app build).
7. **Guide:** keep it reached only from Profile, or make it a tab? Categories and search (old spec F8)? The morning-of video waits on the founder (a reminder is set for Oct 17).
8. **Discover, Saved, Settings:** still to review (areas 4 and 10).

## 8. Open items carried over

- The morning-of video "The First Meetup Does Not Need to Be Perfect" is also offered before later meetups. The founder will update it later. A reminder is scheduled for Oct 17 in the old chat.
- Decided: a meetup added with "Met up already? Add it" counts after a week even without the other person's yes. Keep as is.
- Legacy code still in the repo but unreachable: IAP (`ai-credits.ts`, `premium.ts`), Browse, `generate-activity-suggestions`, the old save/match planning functions in SQL, the old intervention tables. Clean up when convenient.
- No push notifications exist. Everything shows when the app is opened.

## 9. Suggested first message in the new chat

> Please read docs/HANDOFF_TABS.md, docs/DECISIONS.md, the "LIMEN V2 DECISIONS" section of AGENTS.md, and the last few PROGRESS.md entries. Then set up the local test copy (qa/README.md). We're reviewing the Remember tab first. Look at what's built, then ask me your questions before changing anything.
