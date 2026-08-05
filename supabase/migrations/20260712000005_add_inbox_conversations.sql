-- F16 inbox: one row per real conversation (a connection that has at
-- least one message), for the calling user only. Same security pattern as
-- discovery_profiles (20260711000005): the view runs as its owner so it
-- can read across other users' rows past their base-table RLS, but the
-- WHERE clause and the auth.uid()-scoped lateral/subquery are the real
-- access control, not the app's query logic, so it holds even if this
-- view is queried directly over the REST API.
--
-- Deliberately joins public.profiles directly (not discovery_profiles),
-- since a conversation shouldn't disappear from someone's inbox just
-- because they'd no longer surface as a fresh discovery match, the
-- gender/matching_preference compatibility check that gates discovery_
-- profiles is about who you can be SUGGESTED, not who you're already
-- talking to. Access here is instead gated by actually being a
-- participant in a real connections row with an actual message in it.
--
-- The `join lateral ... on true` (not a LEFT JOIN) is what makes this
-- "active conversations" rather than "all connections": a connection with
-- zero messages (e.g. a plain Save with no message sent) has no matching
-- lateral row and is excluded entirely.
create or replace view public.inbox_conversations as
select
  c.id as connection_id,
  case when c.user_a_id = auth.uid() then c.user_b_id else c.user_a_id end as other_user_id,
  p.display_name,
  p.birthdate,
  extract(year from age(current_date, p.birthdate))::int as age,
  p.life_transition,
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
