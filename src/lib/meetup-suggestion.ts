import { supabase } from '@/lib/supabase';

export type MeetupSuggestionState = {
  connection_id: string;
  last_prompted_message_count: number;
  dismissed_permanently: boolean;
  updated_at: string;
};

const FIRST_THRESHOLD = 7;
const RESHOW_AFTER = 5;

export async function fetchMeetupSuggestionState(connectionId: string): Promise<MeetupSuggestionState | null> {
  const { data } = await supabase
    .from('meetup_suggestion_state')
    .select('*')
    .eq('connection_id', connectionId)
    .maybeSingle();
  return (data as MeetupSuggestionState | null) ?? null;
}

// Fires once the conversation reaches 7 messages, per the given "7-10
// back-and-forth exchanges" (the higher end isn't a hard upper bound,
// once the banner is showing it's controlled entirely by snooze/dismiss,
// not the original range). The old "never shown if there's already an
// active meetup plan" guard was removed along with the date-anchored
// meetup system it depended on (2026-07-28 redesign), there's no more
// "active meetup" concept to check, planning is now just an ongoing
// activity, not a single pending plan that blocks a repeat nudge.
//
// connectionStatus is checked directly here, not just relied on via the
// caller's own render gate: this function previously had no status
// awareness at all, and thread/[id].tsx's own JSX happened to already
// wrap its render site in a "connection isn't blocked/inactive" check,
// which is how the closed-connection contradiction this fixes (a rough-
// outcome exit card sitting next to a "let's plan something" banner) was
// only ever prevented by coincidence, not by this function's own logic.
// Checking it here too is defense in depth, matching this codebase's own
// established pattern of guarding a closed-connection state at more than
// one layer (see the evaluator guard lists and the messages RLS policy).
export function shouldShowMeetupSuggestion(
  messageCount: number,
  state: MeetupSuggestionState | null,
  connectionStatus: string | null
): boolean {
  if (connectionStatus === 'blocked' || connectionStatus === 'inactive' || connectionStatus === 'ended') return false;
  if (state?.dismissed_permanently) return false;
  const lastPrompted = state?.last_prompted_message_count ?? 0;
  const threshold = lastPrompted === 0 ? FIRST_THRESHOLD : lastPrompted + RESHOW_AFTER;
  return messageCount >= threshold;
}

export async function snoozeMeetupSuggestion(connectionId: string, currentMessageCount: number) {
  await supabase.rpc('snooze_meetup_suggestion', {
    p_connection_id: connectionId,
    p_current_message_count: currentMessageCount,
  });
}

export async function dismissMeetupSuggestionPermanently(connectionId: string) {
  await supabase.rpc('dismiss_meetup_suggestion_permanently', { p_connection_id: connectionId });
}
