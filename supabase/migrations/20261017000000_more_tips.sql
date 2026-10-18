-- 2026-10-17: more first-time tips. Safe to run twice.
--
-- Tips are now a calm card inside the page (no floating box that covered
-- buttons), with clearer wording, and there are tips in more places:
-- Inbox Pending, Settings, Guide, a person's profile, and two in each chat
-- (the Pause / End / Report / Block words, then planning and notes).
-- This only allows the new tip names in coach_marks_seen, which remembers
-- which tips each person has closed.
-- limen_db_version() -> 20261017000000.

alter table public.coach_marks_seen drop constraint if exists coach_marks_seen_mark_key_check;
alter table public.coach_marks_seen add constraint coach_marks_seen_mark_key_check check (mark_key in (
  'tab_discover', 'tab_browse', 'tab_saved', 'tab_inbox', 'no_ghost_prompt', 'meetup_checkin',
  'tab_remember', 'tab_profile', 'credits_premium',
  'video_show_up', 'video_first_meetup', 'video_friendship_grows', 'video_restart',
  'video_something_off', 'video_ending',
  'inbox_pending', 'settings_intro', 'guide_intro', 'chat_actions', 'chat_bars', 'profile_view'
));

-- Old tips read differently now; show the four tab tips once more so
-- people see the clearer wording.
delete from public.coach_marks_seen
where mark_key in ('tab_discover', 'tab_saved', 'tab_inbox', 'tab_profile')
  and not exists (select 1 from public.coach_marks_seen x where x.user_id = coach_marks_seen.user_id and x.mark_key = 'settings_intro');

create or replace function public.limen_db_version()
returns text
language sql
stable
as $function$ select '20261017000000'::text $function$;
grant execute on function public.limen_db_version() to anon, authenticated;
