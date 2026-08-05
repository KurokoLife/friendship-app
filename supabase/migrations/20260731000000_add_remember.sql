-- Remember (largest remaining unbuilt MVP feature, AGENTS.md). People
-- List, Friendship Timeline, Add Entry. Built against the milestone/
-- elapsed-time meetup system (2026-07-28 redesign), not the original
-- date-based spec: there is no scheduled_at/confirmed_at anywhere
-- anymore, so "Timeline by meetup number" uses connections.meetup_count
-- (only incremented on mutual "went well" confirmation) instead of a
-- date-ordered list, and there is no "day before" moment to anchor a
-- reminder to, so the pre-meetup reminder instead fires at the next
-- real planning moment (re-engaging "Let's plan something"), handled
-- client-side in thread/[id].tsx, not by this migration.

create table if not exists public.remember_entries (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.connections(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  raw_text text not null,
  -- Null when the user chose "Save without organizing" (the AI step is
  -- an equal, skippable choice here, not forced, matching AGENTS.md's
  -- own "the user decides and acts" anchor). Never auto-populated,
  -- only ever set from a value the user has already reviewed and
  -- approved (see organize-remember-entry and the composer component).
  organized_text text,
  -- A short, optional reminder for next time, grounded only in what the
  -- user actually wrote (see the edge function's prompt), null when
  -- nothing follow-up-worthy was mentioned or the AI step was skipped.
  follow_up_note text,
  -- Set server-side by the trigger below from connections.meetup_count
  -- at insert time, never client-supplied, so the Timeline's ordering
  -- can't be spoofed or drift from a stale client read.
  meetup_number_at_entry integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists remember_entries_connection_user_idx
  on public.remember_entries (connection_id, user_id, meetup_number_at_entry, created_at);

alter table public.remember_entries enable row level security;

-- Private, own-row only, same convention as rhythm_mismatch_dismissals
-- and calendar_optin_responses: a personal record with no cross-user
-- business rule to enforce, so direct client read/write is the
-- established pattern here, not a security-definer RPC.
create policy "Users can view their own remember entries"
  on public.remember_entries for select
  using (auth.uid() = user_id);

create policy "Users can insert their own remember entries"
  on public.remember_entries for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.connections c
      where c.id = connection_id
        and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
    )
  );

create policy "Users can delete their own remember entries"
  on public.remember_entries for delete
  using (auth.uid() = user_id);

-- No update policy: entries are edited (raw text, organized text, and
-- the follow-up) entirely client-side before the one-time approved
-- save, per AGENTS.md's "user approves before it's saved" contract.
-- Nothing in this feature's spec asks for editing an already-saved
-- entry, so that surface is deliberately not built.

create or replace function public.set_remember_entry_meetup_number()
returns trigger
language plpgsql
as $$
begin
  select coalesce(meetup_count, 0) into new.meetup_number_at_entry
  from public.connections
  where id = new.connection_id;
  return new;
end;
$$;

drop trigger if exists remember_entries_set_meetup_number on public.remember_entries;
create trigger remember_entries_set_meetup_number
  before insert on public.remember_entries
  for each row execute function public.set_remember_entry_meetup_number();

-- People List source. Same shape and the same load-bearing reasoning as
-- inbox_conversations: a plain view (not security definer), created by
-- the migration-applying role, so by Postgres's default pre-security_
-- invoker view semantics it runs as the view owner, which is how it can
-- join profiles.display_name/photo_url for the OTHER participant even
-- though profiles' own SELECT RLS is strictly auth.uid() = user_id.
-- Deliberately does NOT go through discovery_profiles/browse_profiles
-- (which additionally hard-filter on CURRENT mutual gender/age
-- compatibility): Remember is a historical record of people already
-- met, a preference drifting after the fact should not make someone
-- disappear from a feature whose whole purpose is remembering them.
-- Blocked connections are deliberately not filtered out either, for the
-- same reason, this is the user's own private memory of a real
-- friendship, not a live matching surface.
create or replace view public.remember_people as
select
  c.id as connection_id,
  case when c.user_a_id = auth.uid() then c.user_b_id else c.user_a_id end as other_user_id,
  p.display_name,
  p.photo_url,
  c.meetup_count,
  coalesce(re_count.cnt, 0) as entry_count,
  re_latest.organized_text as latest_entry_snippet,
  re_latest.raw_text as latest_entry_raw,
  re_latest.created_at as latest_entry_at
from public.connections c
join public.profiles p
  on p.user_id = case when c.user_a_id = auth.uid() then c.user_b_id else c.user_a_id end
left join lateral (
  select count(*) as cnt
  from public.remember_entries re
  where re.connection_id = c.id and re.user_id = auth.uid()
) re_count on true
left join lateral (
  select re.organized_text, re.raw_text, re.created_at
  from public.remember_entries re
  where re.connection_id = c.id and re.user_id = auth.uid()
  order by re.created_at desc
  limit 1
) re_latest on true
where (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
  and (coalesce(c.meetup_count, 0) > 0 or coalesce(re_count.cnt, 0) > 0);

grant select on public.remember_people to authenticated;
