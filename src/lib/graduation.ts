import { supabase } from '@/lib/supabase';

// Graduation (2026-08-06), built on last session's meetup_log/mutual-
// confirmation foundation. Trigger and copy sourced directly from the
// real blueprint text (Table 36 / "Graduation copy"), not paraphrased.

export const GRADUATION_MEETUP_THRESHOLD = 5;

// Verbatim, do not edit without re-checking the source.
export const GRADUATION_COPY =
  'You have met five times in person. That is a meaningful sign that you are building something real. You can keep this chat available, or exchange phone numbers and continue by text or phone. Your friendship does not need to stay inside the app.';

export type GraduationEligibility = {
  meetupCount: number;
  status: string | null;
  graduationDismissedAtCount: number;
};

// Reads the three fields needed to decide whether the modal should show:
// meetup_count >= 5, not already graduated, and genuinely new since the
// last dismissal (graduation_dismissed_at_count), not re-shown on every
// load once dismissed once.
export async function fetchGraduationEligibility(connectionId: string): Promise<GraduationEligibility | null> {
  const { data } = await supabase
    .from('connections')
    .select('meetup_count, status, graduation_dismissed_at_count')
    .eq('id', connectionId)
    .maybeSingle();
  if (!data) return null;
  return {
    meetupCount: data.meetup_count as number,
    status: data.status as string | null,
    graduationDismissedAtCount: data.graduation_dismissed_at_count as number,
  };
}

// Excludes every status that represents the connection no longer being a
// healthy, ongoing one, not just 'graduated' itself, a real guard: a
// connection that was just blocked or ended right after its 5th meetup
// shouldn't turn around and suggest exchanging phone numbers.
const NOT_ELIGIBLE_STATUSES = new Set(['graduated', 'blocked', 'ended', 'paused', 'inactive']);

export function shouldShowGraduationPrompt(e: GraduationEligibility | null): boolean {
  if (!e) return false;
  return (
    e.meetupCount >= GRADUATION_MEETUP_THRESHOLD &&
    !NOT_ELIGIBLE_STATUSES.has(e.status ?? '') &&
    e.meetupCount > e.graduationDismissedAtCount
  );
}

export async function graduateConnection(connectionId: string): Promise<void> {
  const { error } = await supabase.rpc('graduate_connection', { p_connection_id: connectionId });
  if (error) throw error;
}

// Shared by "Keep Chat Available" and "Not Yet", see the migration's own
// comment: both leave status untouched and both re-arm the prompt for
// the next confirmed meetup via the same mechanism, the client only
// differs in which analytics event it fires alongside this call.
export async function dismissGraduationPrompt(connectionId: string): Promise<void> {
  const { error } = await supabase.rpc('dismiss_graduation_prompt', { p_connection_id: connectionId });
  if (error) throw error;
}

// Optional 30/90-day continuation measurement (see the migration's own
// comment for why this is client-driven rather than a cron job in this
// app's specific architecture). Returns null when there's nothing to
// report (not yet due, or already recorded), or the real "did a message
// get sent after graduation" signal exactly once per checkpoint,
// idempotent against concurrent calls since the DB marks it checked in
// the same statement that computes the result.
export async function checkAndMarkGraduationContinuation(
  connectionId: string,
  days: 30 | 90
): Promise<boolean | null> {
  const { data, error } = await supabase.rpc('check_and_mark_graduation_continuation', {
    p_connection_id: connectionId,
    p_days: days,
  });
  if (error) return null;
  return data as boolean | null;
}
