-- Fix #2, continued: Inbox needs to know a connection's status to
-- section Paused conversations separately (the previous view exposed
-- nothing about status at all, inbox.tsx had no way to tell a paused
-- connection apart from any other). Adding a column at the end, but
-- using drop+create rather than CREATE OR REPLACE to match this
-- project's own established convention for view changes.
drop view if exists public.inbox_conversations;

create view public.inbox_conversations as
select
  c.id as connection_id,
  case when c.user_a_id = auth.uid() then c.user_b_id else c.user_a_id end as other_user_id,
  p.display_name,
  public.age_band(p.birthdate) as age_band,
  p.life_transitions,
  c.status as connection_status,
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
