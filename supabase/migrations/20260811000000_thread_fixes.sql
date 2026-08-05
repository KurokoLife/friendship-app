-- Three related thread/[id].tsx fixes, 2026-08-11.
--
-- 1. connection_participant_profiles: thread/[id].tsx was reading the
--    other participant's display_name/response_time from
--    discovery_profiles, a view whose WHERE clause hard-filters on
--    gender/pause compatibility, a real photo, mutual age range, radius,
--    and block status (20260807000000/20260730000000/20260729000000).
--    Any existing connection whose two participants no longer both pass
--    every one of those filters (most commonly: one side has no photo,
--    or the pair is blocked) makes that query return null, silently
--    falling back to the screen's own "A member" placeholder, even
--    though the two people are real, already-connected participants
--    with every right to see each other's name in their own
--    conversation. inbox_conversations never had this bug, it reads
--    profiles directly via a plain (non-security-definer) view, the
--    same view-owner-bypasses-profiles'-own-self-row-RLS pattern this
--    project already established for exactly this "let a participant
--    see the other side's basic profile fields, unfiltered" need (see
--    remember_people, 20260731000000). This view follows the same
--    pattern, scoped to what thread/[id].tsx actually needs, and
--    deliberately does NOT require any messages to exist yet (unlike
--    inbox_conversations, whose own inner LATERAL join against messages
--    would silently return nothing for a brand-new, zero-message
--    connection).
create view public.connection_participant_profiles as
select
  c.id as connection_id,
  case when c.user_a_id = auth.uid() then c.user_b_id else c.user_a_id end as other_user_id,
  p.display_name,
  p.response_time
from public.connections c
join public.profiles p
  on p.user_id = case when c.user_a_id = auth.uid() then c.user_b_id else c.user_a_id end
where c.user_a_id = auth.uid() or c.user_b_id = auth.uid();

grant select on public.connection_participant_profiles to authenticated;

-- 2. Messages INSERT RLS: 'inactive' now blocks a new send, matching
--    'blocked'. unblock_user() (20260810000001) already correctly sets
--    a formerly-blocked connection's status to 'inactive', not 'active'
--    as had been assumed, its own comment ("freeing messaging back up")
--    was describing the actual, buggy real-world EFFECT of that status
--    value, not a deliberate design intent. Nothing anywhere previously
--    treated 'inactive' as non-messageable: the messages INSERT policy
--    only ever excluded 'blocked', and thread/[id].tsx's own compose
--    footer only ever gated on 'blocked' too, so re-opening a
--    just-unblocked (or any other) inactive thread and typing worked
--    exactly like an ordinary active conversation, silently resuming it
--    with no fresh start of any kind. 'inactive' is this app's own
--    deliberate "closed, quiet archive" state (see
--    setConnectionInactive's own comment in src/lib/no-ghost.ts, "close
--    the connection and make room for another", and F17's 7-day
--    auto-close), and create_connection_with_capacity_check
--    (20260721000000) already has a real fresh-start mechanism for it,
--    flipping an inactive connection back to 'pending' the moment the
--    same two people reconnect through the normal Say Hello path. This
--    closes the gap uniformly for every reason a connection can become
--    inactive, not just a post-unblock one, there is no sub-state to
--    distinguish them and the capacity system's own reuse-branch design
--    already treats every inactive connection as needing that same
--    fresh start.
drop policy "Participants can send messages in their connection" on public.messages;
create policy "Participants can send messages in their connection"
on public.messages for insert
with check (
  sender_id = auth.uid()
  and exists (
    select 1 from public.connections c
    where c.id = messages.connection_id
      and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
      and c.status is distinct from 'blocked'
      and c.status is distinct from 'inactive'
  )
  and (
    connection_has_any_message(connection_id)
    or exists (select 1 from public.profiles pr where pr.user_id = auth.uid() and pr.photo_url is not null)
  )
);
