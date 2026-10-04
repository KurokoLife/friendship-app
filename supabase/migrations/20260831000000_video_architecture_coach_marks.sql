-- Video trigger/placement architecture update, post-Friendship-Journey-
-- cutover (2026-08-11). Extends the existing coach_marks_seen infrastructure
-- with 6 new global, per-user, once-ever keys for the new contextual video
-- guidance system, rather than inventing a second tracking mechanism, per
-- explicit instruction. Video 1 (mandatory onboarding, always in Guide) and
-- Video 3 (attached directly to NextMeetupIndicatorV2's own ambient state,
-- see that component) don't need a mark of their own here: Video 1 has no
-- dismissible contextual surfacing to track, and Video 3's own "seen" flag
-- is added below as video_first_meetup, so this covers 6 of the 7 approved
-- videos' contextual (non-mandatory) exposure.
--
-- Dropped and recreated (not ALTER ... ADD CHECK) since this constraint has
-- no name to target directly in a plain ADD/DROP, matching how every other
-- CHECK-constraint extension in this project's migration history has been
-- done (e.g. next_meetup_feelings_feeling_check, 2026-08-22).
alter table public.coach_marks_seen drop constraint coach_marks_seen_mark_key_check;
alter table public.coach_marks_seen add constraint coach_marks_seen_mark_key_check check (mark_key in (
  'tab_discover',
  'tab_browse',
  'tab_saved',
  'tab_inbox',
  'no_ghost_prompt',
  'meetup_checkin',
  'tab_remember',
  'tab_profile',
  'credits_premium',
  'video_show_up',           -- Video 2, first real conversation stage
  'video_first_meetup',      -- Video 3, first confirmed meetup
  'video_friendship_grows',  -- Video 4, first occurred meetup + private openness
  'video_restart',           -- Video 5, first conversation_restart_prompt
  'video_something_off',     -- Video 6, private pre-meetup concern / repeated cancellation
  'video_ending'             -- Video 7, Honest Exit / connection ended
));
