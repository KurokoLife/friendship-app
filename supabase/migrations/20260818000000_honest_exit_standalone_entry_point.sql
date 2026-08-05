-- Remaining Honest Exit gaps, built directly on the 'ended' status
-- infrastructure from 20260817000000: a standalone "End Connection" entry
-- point usable on any healthy connection at the user's own initiative
-- (not just reachable via an escalating no-ghost/rough-outcome trigger),
-- a message-less closure that still notifies (distinct from S1's own
-- silent "close and make room", which stays silent by design), private
-- reason capture (never shown to the other participant, stored separately
-- from reports' own, non-private category system), and wording templates.
--
-- Sourced from blueprint Section 10's own Honest Exit decision flow and
-- template copy (Friendship_App_Blueprint_v4.docx, unzipped from the
-- user's own Downloads folder, same technique earlier Fix #2/#3 sessions
-- used): "1. User selects End Connection. 2. User chooses whether to send
-- a message or end without a personal message. 3. Optional private
-- reason: capacity, not a match, communication mismatch, leaving the app,
-- safety concern or other. 4. If messaging, user writes freely, chooses a
-- template, asks AI to draft from the selected intention or asks AI to
-- polish existing text. 5. User reviews and explicitly sends. 6. Recipient
-- sees the user's message or a neutral system closure. 7. Safety concerns
-- may bypass explanation through immediate Block and Report."
--
-- One deliberate deviation from that same source text, flagged rather
-- than silently resolved either way: blueprint's own System-only-closure
-- line reads "A reason is shown only when they chose to share one,"
-- implying a shared reason could surface to the recipient. This session's
-- own explicit instruction is stricter and more specific ("private only,
-- never shown to the other participant"), and wins here: the reason is
-- never exposed to the other participant under any circumstance, enforced
-- structurally by RLS (see connection_end_reasons below), not just by a
-- UI choice not to render it.

-- 1. Private reason capture. Its own table, not folded into `reports`
-- (which serves a different, non-private, moderation-facing purpose with
-- its own 8-category vocabulary already built for Report & Block).
-- Own-row RLS, no client write policy at all, matching the same
-- "structurally private" convention already used for
-- first_meetup_feelings/no_ghost_prompts: the only writer is
-- end_connection_with_message below.
create table public.connection_end_reasons (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.connections(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  reason text not null check (reason in ('capacity', 'not_a_match', 'communication_mismatch', 'leaving_app', 'safety', 'other')),
  created_at timestamptz not null default now()
);

alter table public.connection_end_reasons enable row level security;

create policy "Users can read their own end reasons"
  on public.connection_end_reasons for select
  using (auth.uid() = user_id);

-- 2. end_connection_with_message extended: p_content becomes optional
-- (a message-less closure still flips status and still shows the other
-- participant the real, already-built honest 'ended' banner, this is the
-- "notify" half of the message-less path, distinct from S1's own
-- deliberately silent "close and make room"), and a new optional
-- p_reason writes the private row above. Argument list changed (a new
-- third parameter), so this must be dropped and recreated, not a plain
-- CREATE OR REPLACE, matching this project's own established convention
-- for any signature change (e.g. get_meetup_checkin_status's return-type
-- change on 2026-08-02). Fully backward compatible for both existing
-- call sites (the no-ghost R2/R3 escalation card, the meetup-outcome
-- rough card): both still always pass real, non-empty content and no
-- reason, so their own behavior is completely unchanged.
drop function if exists public.end_connection_with_message(uuid, text);

create function public.end_connection_with_message(
  p_connection_id uuid,
  p_content text default null,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid;
begin
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1 from public.connections c
    where c.id = p_connection_id
      and (c.user_a_id = v_caller or c.user_b_id = v_caller)
  ) then
    raise exception 'Not a participant of this connection';
  end if;

  if p_reason is not null and p_reason not in ('capacity', 'not_a_match', 'communication_mismatch', 'leaving_app', 'safety', 'other') then
    raise exception 'Unknown reason: %', p_reason;
  end if;

  if p_content is not null and length(trim(p_content)) > 0 then
    insert into public.messages (connection_id, sender_id, content, type)
    values (p_connection_id, v_caller, p_content, 'honest_exit');
  end if;

  if p_reason is not null then
    insert into public.connection_end_reasons (connection_id, user_id, reason)
    values (p_connection_id, v_caller, p_reason);
  end if;

  update public.connections set status = 'ended' where id = p_connection_id;
end;
$$;
grant execute on function public.end_connection_with_message(uuid, text, text) to authenticated;
