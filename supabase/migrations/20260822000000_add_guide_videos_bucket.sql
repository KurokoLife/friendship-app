-- The guide-videos bucket was created directly against the live project
-- (2026-08-01) during video-hosting work, not via a tracked migration,
-- breaking this project's own convention of tracking storage/schema
-- changes as migrations. This migration reflects the bucket's actual
-- live configuration retroactively (public, 200MB per-file limit,
-- video/mp4 only), it does not change anything about the bucket, which
-- already exists with these exact settings. `on conflict do nothing`
-- makes this safe to run against the already-live project and correct
-- for a fresh environment standing this project up from scratch.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('guide-videos', 'guide-videos', true, 209715200, array['video/mp4'])
on conflict (id) do nothing;

-- Curated app assets (etiquette module videos), not user-generated
-- content: publicly readable, no client insert/update/delete policy at
-- all, matching this app's own established "no client write, only a
-- privileged path writes it" convention (no_ghost_prompts,
-- meetup_checkins, connection_end_reasons), used here for asset
-- integrity rather than privacy. Uploads happen only via the Supabase
-- CLI/dashboard with real project credentials, never from the app.
create policy "Guide videos are publicly readable"
  on storage.objects for select
  using (bucket_id = 'guide-videos');
