-- Fix 7: schedules the batch refresh (generate-match-suggestions' new
-- batch mode, gated by MATCH_REFRESH_SECRET) every 6 hours via pg_cron +
-- pg_net, the same pattern Supabase itself documents for cron-to-Edge-
-- Function calls, and the same pg_cron mechanism this project's no-ghost
-- sweep (20260712000008) already uses for its own scheduled check.
--
-- Tried `current_setting('app.settings.anon_key', true)` first (the
-- pattern Supabase's own docs show), confirmed live it returns null,
-- these custom GUC values were never actually set at the database level
-- in this project, so a cron job relying on them would silently send
-- empty headers and fail every 6 hours with no visible error. Using the
-- literal anon key and MATCH_REFRESH_SECRET values directly instead,
-- same tradeoff already accepted elsewhere in this codebase
-- (DEV_SESSION_SECRET is a hardcoded literal in the committed
-- src/lib/dev-tools.ts), a pg_cron job definition is exactly as
-- git-committed as that file, not a new exposure category. The anon key
-- itself is public by design (it's already in the client bundle); only
-- the batch secret is the actually sensitive value here.
-- Real bug caught live, not assumed: the first version of this job only
-- set the `apikey` header, which the Edge Function platform's own gate
-- rejected outright (401 UNAUTHORIZED_NO_AUTH_HEADER, confirmed by
-- reading net._http_response after a manual test call), it also needs a
-- separate `Authorization: Bearer <anon key>` header, exactly like every
-- other call to this function. Also sets an explicit 5-minute
-- timeout_milliseconds, well above the ~2 minutes the batch refresh
-- actually took in live testing (10 users, parallelized after this same
-- test caught the sequential version running long), pg_net's own default
-- timeout is much shorter than that and would otherwise cut the request
-- off before a real response came back.
select cron.schedule(
  'refresh-match-suggestions',
  '0 */6 * * *',
  $$
  select net.http_post(
    url := 'https://vbqabdtxaahngegkvjmy.supabase.co/functions/v1/generate-match-suggestions',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZicWFiZHR4YWFobmdlZ2t2am15Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3OTE5NDUsImV4cCI6MjA5OTM2Nzk0NX0.yR9lUJLXv4VWMCDg3v4GnT1nWQW96DJFjsqyawlXGCw',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZicWFiZHR4YWFobmdlZ2t2am15Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3OTE5NDUsImV4cCI6MjA5OTM2Nzk0NX0.yR9lUJLXv4VWMCDg3v4GnT1nWQW96DJFjsqyawlXGCw',
      'x-batch-secret', '4e07dac76e4cc609570cc963c35ae708dbcbe690f0238d11'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
  $$
);
