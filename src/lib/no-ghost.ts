import { supabase } from '@/lib/supabase';

// Reply-reminder copy shown by the app, and ending a connection. The
// reminders themselves come from the Friendship Journey
// (run_no_ghost_check_v2, PrimaryInterventionCard); the older no-ghost
// prompt system that also lived here was removed in October 2026.

export const HONEST_EXIT_SENDER_TEXT =
  "Choosing honesty over silence takes real courage. That's what genuine care looks like.";
export const HONEST_EXIT_RECEIVER_TEXT =
  "Honest endings are harder to receive than to give. You deserved that honesty. That's not nothing.";

// A calm line for the person waiting on a reply, from 36 hours until the
// 125-hour "It's been quiet" card takes over. Shown by the app only.
export function senderReassuranceLine(hoursSinceSent: number): string | null {
  if (hoursSinceSent >= 36 && hoursSinceSent < 125) {
    return 'Sometimes it takes a few days to reply. This does not necessarily mean anything.';
  }
  return null;
}

// Ending a connection: one call flips the chat to 'ended' with an optional
// message and an optional private reason (only the person ending ever sees
// the reason). The other person sees the same honest "ended" note either way.
export type ConnectionEndReason =
  | 'capacity'
  | 'not_a_match'
  | 'communication_mismatch'
  | 'leaving_app'
  | 'safety'
  | 'other';

export const CONNECTION_END_REASONS: { key: ConnectionEndReason; label: string }[] = [
  { key: 'capacity', label: "I don't have the capacity right now" },
  { key: 'not_a_match', label: 'Not the right friendship match' },
  { key: 'communication_mismatch', label: "Our communication styles don't fit" },
  { key: 'leaving_app', label: "I'm leaving the app" },
  { key: 'safety', label: 'Safety concern' },
  { key: 'other', label: 'Other' },
];


export async function endConnectionWithMessage(
  connectionId: string,
  options: { content?: string; reason?: ConnectionEndReason } = {}
) {
  const { error } = await supabase.rpc('end_connection_with_message', {
    p_connection_id: connectionId,
    p_content: options.content ?? null,
    p_reason: options.reason ?? null,
  });
  if (error) throw error;
}
