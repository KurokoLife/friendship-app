-- Part 1, 2026-08-14: real enforcement of messaging_preference, confirmed
-- by direct trace (the 2026-08-12 session) to be collected once at
-- onboarding (gender-identity.tsx step 3) and never read anywhere else,
-- at any layer. A user who picked "Only people I message first" got zero
-- actual protection from that choice.
--
-- Investigated before building, per instruction: gender_identity's own
-- check constraint (users_gender_identity_check) uses the exact same
-- five string values as messaging_preference's own check constraint
-- (users_messaging_preference_check) — 'woman', 'man', 'non_binary',
-- 'transgender', 'queer' — confirmed live via pg_get_constraintdef, not
-- assumed. This means a plain string-equality comparison between a
-- sender's gender_identity and a receiver's messaging_preference is
-- correct and needs no normalization. Both columns are nullable at the
-- schema level (no NOT NULL constraint, though all 10 real accounts
-- currently have both set); a null messaging_preference is treated the
-- same as 'anyone' (no restriction), the natural "no preference stated
-- yet" default, matching this app's own established pattern for every
-- other optional/soft preference field. users' own SELECT RLS is
-- strictly self-row (auth.uid() = id, confirmed live), so reading the
-- OTHER participant's messaging_preference/gender_identity requires a
-- SECURITY DEFINER function, exactly the same reason
-- connection_has_any_message() (2026-08-07) already needed one.
--
-- Mirrors the existing first-message-photo-gate pattern exactly: scoped
-- to a connection's genuine first message only (via the same
-- connection_has_any_message() reuse), never applied to a reply on an
-- already-started conversation. Combined with the photo gate in one
-- restructured OR-branch rather than a second, separately-ANDed OR
-- block, avoiding evaluating connection_has_any_message() twice for the
-- same row.

create or replace function public.first_message_allowed_by_preference(p_connection_id uuid, p_sender_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_receiver_id uuid;
  v_receiver_pref text;
  v_sender_gender text;
begin
  select case when user_a_id = p_sender_id then user_b_id else user_a_id end
  into v_receiver_id
  from public.connections
  where id = p_connection_id;

  if v_receiver_id is null then
    return false;
  end if;

  select messaging_preference into v_receiver_pref from public.users where id = v_receiver_id;

  if v_receiver_pref is null or v_receiver_pref = 'anyone' then
    return true;
  end if;

  if v_receiver_pref = 'only_people_i_message_first' then
    return false;
  end if;

  -- v_receiver_pref is one of the five gender values at this point.
  select gender_identity into v_sender_gender from public.users where id = p_sender_id;
  return coalesce(v_sender_gender = v_receiver_pref, false);
end;
$$;

-- Proactive client-side gate, mirroring the photo gate's own pattern:
-- the viewer's own photo_url is self-row-readable directly, but the
-- OTHER participant's messaging_preference is not (users' own SELECT
-- RLS is strictly self-row, confirmed live), so there was previously no
-- way for the client to know in advance whether a first message would
-- be blocked. connection_participant_profiles (20260811000000) already
-- exists for exactly this "let a participant read the other side's
-- basic profile-adjacent fields, unfiltered" need; extending it with
-- messaging_preference is the same pattern, not a new one, and stays
-- scoped to the two real participants of that specific connection, the
-- same exposure boundary display_name/response_time already have.
drop view if exists public.connection_participant_profiles;
create view public.connection_participant_profiles as
select
  c.id as connection_id,
  case when c.user_a_id = auth.uid() then c.user_b_id else c.user_a_id end as other_user_id,
  p.display_name,
  p.response_time,
  u.messaging_preference
from public.connections c
join public.profiles p
  on p.user_id = case when c.user_a_id = auth.uid() then c.user_b_id else c.user_a_id end
join public.users u
  on u.id = p.user_id
where c.user_a_id = auth.uid() or c.user_b_id = auth.uid();

grant select on public.connection_participant_profiles to authenticated;

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
    or (
      exists (select 1 from public.profiles pr where pr.user_id = auth.uid() and pr.photo_url is not null)
      and public.first_message_allowed_by_preference(connection_id, auth.uid())
    )
  )
);
