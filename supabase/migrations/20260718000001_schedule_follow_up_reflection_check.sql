-- F19: real scheduled background check. Hourly, not every-15-minutes like
-- no-ghost's silence detection, this feature works on a 24+ hour window
-- so hourly granularity is plenty (matches expire_old_saves' own daily
-- cadence reasoning for a similarly coarse-grained feature). Kept in its
-- own migration so a pg_cron availability problem doesn't block the core
-- table/functions from applying, same reasoning as no-ghost's own split.
select cron.schedule(
  'follow-up-reflection-check',
  '0 * * * *',
  $$select public.run_follow_up_reflection_check_all();$$
);
