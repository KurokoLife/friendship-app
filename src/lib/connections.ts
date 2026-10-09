import { supabase } from '@/lib/supabase';

export type CapacityErrorReason =
  | 'active_cap_reached'
  | 'pending_cap_reached'
  | 'blocked'
  | 'ended'
  | 'unknown';

export type ConnectionResult =
  | { ok: true; connectionId: string }
  | { ok: false; error: CapacityErrorReason };

// Capacity limits (flat for everyone): 3 active conversations, 5 hellos
// waiting for a reply. Calm wording that says why the limit exists and
// what to do, never a warning (2026-10-09).
export const CAPACITY_ERROR_MESSAGES: Record<CapacityErrorReason, string> = {
  active_cap_reached:
    "You already have 3 active conversations, the most Limen keeps at once so each one gets real attention. To make room, pause or end one of them in your Inbox, then come back here.",
  pending_cap_reached:
    "You have 5 hellos still waiting for a reply. Give them a little time, or end one you've stopped waiting on, before saying hello to someone new.",
  blocked: "You can't start a conversation with this person.",
  // 20260817000000: this connection was genuinely ended (Honest Exit),
  // not just closed automatically. create_connection_with_capacity_check
  // no longer silently reopens it the way it does for 'inactive', it
  // raises this distinct reason instead so the caller can require a real,
  // separate confirmation before calling reinitiateEndedConnection below.
  ended: 'This connection was deliberately ended.',
  unknown: 'Something went wrong starting this conversation. Please try again.',
};

// Fix #3: connection creation now goes through create_connection_with_
// capacity_check (20260721000000), a SECURITY DEFINER RPC that reuses
// an existing connection in either direction exactly like this
// function's own previous client-side logic did, or enforces the
// active-conversation/pending-Say-Hi caps before inserting a genuinely
// new one. Doing the cap check and the insert together, server-side,
// avoids a client having to trust its own read of the caps (and avoids
// a race between reading and inserting).
export async function getOrCreateConnectionId(otherId: string): Promise<ConnectionResult> {
  const { data, error } = await supabase.rpc('create_connection_with_capacity_check', {
    p_other_user_id: otherId,
  });

  if (error) {
    const message = error.message ?? '';
    if (message.includes('active_cap_reached')) return { ok: false, error: 'active_cap_reached' };
    if (message.includes('pending_cap_reached')) return { ok: false, error: 'pending_cap_reached' };
    if (message.includes('blocked')) return { ok: false, error: 'blocked' };
    if (message.includes('ended')) return { ok: false, error: 'ended' };
    return { ok: false, error: 'unknown' };
  }

  return { ok: true, connectionId: data as string };
}

// 20260817000000: the deliberately higher-friction path back into a
// connection that was genuinely ended (not auto-closed). Only ever called
// after an explicit, separate confirmation step in the UI, never from the
// default "Say hello" tap, unlike getOrCreateConnectionId above, which
// reopens 'inactive' with zero friction. Subject to the exact same
// active/pending capacity checks as any other new connection.
export async function reinitiateEndedConnection(otherId: string): Promise<ConnectionResult> {
  const { data, error } = await supabase.rpc('reinitiate_ended_connection', {
    p_other_user_id: otherId,
  });

  if (error) {
    const message = error.message ?? '';
    if (message.includes('active_cap_reached')) return { ok: false, error: 'active_cap_reached' };
    if (message.includes('pending_cap_reached')) return { ok: false, error: 'pending_cap_reached' };
    if (message.includes('blocked')) return { ok: false, error: 'blocked' };
    return { ok: false, error: 'unknown' };
  }

  return { ok: true, connectionId: data as string };
}
