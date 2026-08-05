-- Life transition changes from one fixed category to up to three, per an
-- expanded 13-option list. text -> text[], matching the same pattern
-- already used for values (<=5) and hangout_type_preference (<=2): an
-- open array with only a length cap enforced at the DB level, not a
-- per-element enum check, no other array column in this schema enforces
-- per-element membership either.
alter table public.profiles
  add column if not exists life_transitions text[];

-- Backfill any existing single value into the new array column before the
-- old column is dropped, wrapping a real value in a one-element array
-- rather than discarding it.
update public.profiles
set life_transitions = array[life_transition]
where life_transition is not null and life_transitions is null;

alter table public.profiles
  add constraint profiles_life_transitions_check check (coalesce(array_length(life_transitions, 1), 0) <= 3);

-- Neither CREATE OR REPLACE VIEW nor ALTER VIEW RENAME COLUMN alone can
-- get this view from life_transition (text) to life_transitions (text[]),
-- confirmed live: the first attempt hit "cannot change name of view
-- column", renaming first and then replacing hit "cannot change data type
-- of view column", Postgres only allows CREATE OR REPLACE to keep an
-- existing output column's name AND type unchanged, or append new
-- columns at the end, not both rename and retype an existing one. A full
-- drop and recreate is required instead. Confirmed beforehand (a
-- read-only pg_depend query) that nothing else in the database depends on
-- this view, so a plain drop needs no cascade. The view must be dropped
-- before life_transition is removed below, dropping a column a view still
-- depends on fails outright. Every other column and the view's own
-- auth.uid() mutual compatibility and F9 pause filter are unchanged.
drop view public.discovery_profiles;

create view public.discovery_profiles as
select
  u.id as user_id,
  u.gender_identity,
  u.matching_preference,
  p.display_name,
  p.birthdate,
  extract(year from age(current_date::timestamptz, p.birthdate::timestamptz))::integer as age,
  p.life_transitions,
  p.activity_interests,
  p."values",
  p.hangout_people_preference,
  p.hangout_type_preference,
  p.communication_freq,
  p.meeting_freq,
  p.response_time,
  p.personal_statement,
  p.bar_preference,
  p.photo_url,
  p.completion_pct,
  p.dealbreakers,
  p.personality_16p,
  p.current_situation
from users u
join profiles p on p.user_id = u.id
join users viewer on viewer.id = auth.uid()
where u.id <> auth.uid()
  and u.gender_identity = viewer.matching_preference
  and u.matching_preference = viewer.gender_identity
  and (u.paused_until is null or u.paused_until <= now());

-- A dropped-and-recreated view starts with no grants at all, the original
-- discovery_profiles migration (20260711000005) explicitly granted this
-- rather than relying on any default privilege, restoring it explicitly
-- here too rather than assuming Supabase's default ACLs would cover a
-- freshly created view the same way.
grant select on public.discovery_profiles to authenticated;

-- inbox_conversations (20260712000005) also selects directly from
-- profiles, not through discovery_profiles, "deliberately", per its own
-- original migration comment, so an existing conversation doesn't vanish
-- from someone's inbox over a discovery-matching technicality. Confirmed
-- live this was the actual, real blocker on dropping life_transition
-- below (the first attempt at this migration failed outright:
-- "cannot drop column life_transition ... other objects depend on it ...
-- view inbox_conversations depends on column life_transition"), so it
-- needs the identical rename treatment discovery_profiles needed above,
-- confirmed beforehand that nothing else depends on it either.
drop view public.inbox_conversations;

create view public.inbox_conversations as
select
  c.id as connection_id,
  case when c.user_a_id = auth.uid() then c.user_b_id else c.user_a_id end as other_user_id,
  p.display_name,
  p.birthdate,
  extract(year from age(current_date::timestamptz, p.birthdate::timestamptz))::integer as age,
  p.life_transitions,
  lm.content as last_message_content,
  lm.created_at as last_message_at,
  lm.sender_id as last_message_sender_id,
  (exists (
    select 1 from messages um
    where um.connection_id = c.id and um.sender_id <> auth.uid() and um.read_at is null
  )) as has_unread
from connections c
join profiles p on p.user_id = case when c.user_a_id = auth.uid() then c.user_b_id else c.user_a_id end
join lateral (
  select m.content, m.created_at, m.sender_id
  from messages m
  where m.connection_id = c.id
  order by m.created_at desc
  limit 1
) lm on true
where c.user_a_id = auth.uid() or c.user_b_id = auth.uid();

grant select on public.inbox_conversations to authenticated;

alter table public.profiles
  drop column if exists life_transition;
