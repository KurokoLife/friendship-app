-- Fix #1, continued: inbox_conversations (20260712000005) also exposed
-- raw birthdate and exact age directly, found by the same full grep
-- sweep that caught saved_profiles. Same treatment: both removed,
-- replaced with public.age_band(). Requires a real drop (not CREATE OR
-- REPLACE), removing two columns down to one is a real column-shape
-- change, same reason every other view rewrite in this project needed it.
--
-- Real, separate, pre-existing bug found and fixed in the same pass:
-- this view still referenced `p.life_transition` (singular), a column
-- that no longer exists, confirmed live via information_schema (only
-- `life_transitions`/`life_transitions_other` exist on profiles). That
-- column was dropped by 20260713000005_life_transitions_array.sql
-- without this view being updated, meaning every query against
-- inbox_conversations has been failing outright since that migration,
-- not silently returning stale or empty data, a real error inbox.tsx's
-- `const { data } = await supabase...` call has no error handling for
-- (it would have just left the inbox list empty with no visible error).
-- Fixed by pointing at `p.life_transitions` (the real column), matching
-- what inbox.tsx's own Conversation type already expected.
drop view if exists public.inbox_conversations;

create view public.inbox_conversations as
select
  c.id as connection_id,
  case when c.user_a_id = auth.uid() then c.user_b_id else c.user_a_id end as other_user_id,
  p.display_name,
  public.age_band(p.birthdate) as age_band,
  p.life_transitions,
  lm.content as last_message_content,
  lm.created_at as last_message_at,
  lm.sender_id as last_message_sender_id,
  exists (
    select 1 from public.messages um
    where um.connection_id = c.id
      and um.sender_id <> auth.uid()
      and um.read_at is null
  ) as has_unread
from public.connections c
join public.profiles p
  on p.user_id = (case when c.user_a_id = auth.uid() then c.user_b_id else c.user_a_id end)
join lateral (
  select content, created_at, sender_id
  from public.messages m
  where m.connection_id = c.id
  order by m.created_at desc
  limit 1
) lm on true
where c.user_a_id = auth.uid() or c.user_b_id = auth.uid();

grant select on public.inbox_conversations to authenticated;
