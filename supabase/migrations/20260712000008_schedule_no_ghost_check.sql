-- F17: real scheduled background check, every 15 minutes, calling the
-- same run_no_ghost_check_all() the dev tool's time-offset path also
-- calls (with real now(), no override). Kept in its own migration, apart
-- from 20260712000007, so a pg_cron availability problem on this project
-- doesn't block the core table/functions from applying.
create extension if not exists pg_cron;

select cron.schedule(
  'no-ghost-check',
  '*/15 * * * *',
  $$select public.run_no_ghost_check_all();$$
);
