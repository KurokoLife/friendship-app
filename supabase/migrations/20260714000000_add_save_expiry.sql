-- F14: Save feature, 14-day expiry. `connections.saved` (added in
-- 20260711000007) has existed with no expiry at all, once saved, always
-- saved. This adds the actual expiry mechanism plus a trigger so every
-- existing save call site (home.tsx, candidate/[id].tsx, browse.tsx, all
-- three already just upsert `{ saved: true }`) gets a correct `saved_at`
-- stamp for free, with no client changes needed there.
alter table public.connections
  add column if not exists saved_at timestamptz;

-- Stamps saved_at the moment saved actually turns true (not on every
-- update to the row, e.g. a later status change on the same connection
-- shouldn't reset the 14-day clock), and clears it back to null the
-- moment saved turns false, so a future re-save starts a fresh 14-day
-- window rather than inheriting a stale timestamp.
create or replace function public.set_connection_saved_at()
returns trigger
language plpgsql
as $$
begin
  if new.saved and (tg_op = 'INSERT' or old.saved is distinct from true) then
    new.saved_at := now();
  elsif not new.saved then
    new.saved_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists connections_set_saved_at on public.connections;
create trigger connections_set_saved_at
  before insert or update on public.connections
  for each row execute function public.set_connection_saved_at();

-- The actual expiry: a save older than 14 days silently reverts to
-- unsaved (saved = false, saved_at cleared by the trigger above via the
-- same UPDATE), scheduled the same way F17's no-ghost sweep is (pg_cron,
-- already enabled on this project, see 20260712000008). Daily is
-- plenty of precision for a 14-day window, no need for no-ghost's
-- 15-minute cadence here.
create or replace function public.expire_old_saves()
returns void
language sql
security definer
as $$
  update public.connections
  set saved = false
  where saved = true
    and saved_at < now() - interval '14 days';
$$;

select cron.schedule(
  'expire-old-saves',
  '0 3 * * *',
  $$select public.expire_old_saves();$$
);

-- Saved profiles need the other participant's profile data the same way
-- inbox_conversations (20260712000005) does, and for the same reason
-- given there explicitly: a save is a real, deliberate signal from the
-- past, it shouldn't quietly vanish from someone's Saved list just
-- because the saved person has since drifted out of mutual discovery
-- compatibility or paused. So this joins public.profiles directly, not
-- discovery_profiles, same pattern, same reasoning, not re-litigated.
create or replace view public.saved_profiles as
select
  c.id as connection_id,
  c.user_b_id as user_id,
  c.saved_at,
  p.display_name,
  p.birthdate,
  extract(year from age(current_date::timestamptz, p.birthdate::timestamptz))::integer as age,
  p.life_transitions,
  p.personal_statement
from public.connections c
join public.profiles p on p.user_id = c.user_b_id
where c.user_a_id = auth.uid()
  and c.saved = true;

grant select on public.saved_profiles to authenticated;
