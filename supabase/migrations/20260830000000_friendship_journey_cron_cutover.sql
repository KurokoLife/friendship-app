-- Friendship Journey cutover, Phase 3 Step C (2026-08-10): the coordinated
-- evaluator handoff, approved after the Phase 3 Steps 2-3 report, the
-- revised A/B/C/D cutover ordering, and the existing-data continuity audit.
--
-- Disables every old relational evaluator cron this rebuild supersedes (and
-- one, curiosity-prompt-check, that was already confirmed dead in Phase 1),
-- and enables the new combined Friendship Journey sweep in their place, in
-- one transaction so old and new relational evaluators are never both
-- active. Uses cron.alter_job(active := ...) rather than
-- cron.unschedule/cron.schedule for the disable side specifically because
-- it preserves each job's own schedule/command definition untouched,
-- making rollback a plain re-activation, not a re-creation from a
-- remembered definition. No table, column, or function is dropped here,
-- per the approved plan -- that is explicitly separate, later cleanup.
--
-- follow-up-reflection-check (jobid 5) is included in this disable list per
-- the explicit DISABLE classification from this cutover's own audit: it
-- independently created a real, actionable, user-facing relational prompt
-- (FollowUpReflectionCard, "Help me say it"/"I'll reach out my own
-- way"/"Dismiss") with zero connection-status exclusion logic of its own,
-- exactly the class of thing the approved architecture forbids running
-- outside the single priority queue. Migrating it into a real new
-- intervention type is explicitly NOT done here -- no such type exists in
-- the design doc's own priority table, and inventing one during a cutover
-- migration would violate this whole project's own design-first discipline.

select cron.alter_job(job_id := 1, active := false);  -- no-ghost-check
select cron.alter_job(job_id := 9, active := false);  -- meetup-checkin-check
select cron.alter_job(job_id := 6, active := false);  -- curiosity-prompt-check (already dead/failing before this cutover)
select cron.alter_job(job_id := 5, active := false);  -- follow-up-reflection-check

select cron.schedule(
  'friendship-journey-sweep',
  '*/15 * * * *',
  'select public.run_friendship_journey_sweep_all();'
);
