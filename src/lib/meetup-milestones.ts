import { supabase } from '@/lib/supabase';

// Replaces the old date-anchored meetups system (2026-07-28 redesign).
// No specific scheduled_at/confirmed_at date is collected anywhere in
// this file, on purpose, per the three constraints that drove the
// redesign: no intrusive date-entry form, no reading message content to
// infer a date, and no way to know "the right moment" for a day-of
// prompt without one. Instead, triggers anchor to a milestone (first
// real engagement with "Let's plan something") and elapsed time since
// the last engagement.

export type FirstMeetupFeeling = 'excited' | 'neutral' | 'nervous';

export type MeetupCheckinOutcome = 'went_well' | 'rough' | 'didnt_happen' | 'still_figuring';

// Item 4, 2026-08-16: the next-meetup date UI, layered on top of the
// milestone/elapsed-time system above rather than replacing it. Plain
// YYYY-MM-DD strings throughout, never a Date object round-tripped
// through toISOString/new Date(iso), the exact bug class item 2 of this
// same session fixed on the Remember side, see formatMeetupDate/
// parseMeetupDate in remember.ts (reused here, not duplicated).
export type NextMeetupStatus = {
  date: string | null;
  status: 'proposed' | 'confirmed' | null;
  proposedBy: string | null;
};

export async function fetchNextMeetupStatus(connectionId: string): Promise<NextMeetupStatus> {
  const { data } = await supabase
    .from('connections')
    .select('next_meetup_date, next_meetup_status, next_meetup_proposed_by')
    .eq('id', connectionId)
    .maybeSingle();
  return {
    date: data?.next_meetup_date ?? null,
    status: (data?.next_meetup_status as NextMeetupStatus['status']) ?? null,
    proposedBy: data?.next_meetup_proposed_by ?? null,
  };
}

// Also used for rescheduling, see the migration's own comment: calling
// this again on an already-confirmed date unconditionally reverts it to
// 'proposed' with a fresh one-tap confirm needed, no separate reschedule
// path.
export async function proposeNextMeetup(connectionId: string, date: string): Promise<void> {
  const { error } = await supabase.rpc('propose_next_meetup', { p_connection_id: connectionId, p_date: date });
  if (error) throw error;
}

export async function confirmNextMeetup(connectionId: string): Promise<void> {
  const { error } = await supabase.rpc('confirm_next_meetup', { p_connection_id: connectionId });
  if (error) throw error;
}

// Day-of feeling check, own-row insert (no RPC needed, matching
// first_meetup_feelings' own established pattern), upsert since a
// second tap on the same real day for the same date cycle should be a
// harmless no-op, not a duplicate-key error. Real three-option picker
// since the 2026-08-22 video-hosting session (migration
// 20260822000001), matching first_meetup_feelings' own feeling column
// exactly; previously hardcoded to 'neutral' only.
export async function submitNextMeetupFeeling(
  connectionId: string,
  userId: string,
  meetupDate: string,
  feeling: FirstMeetupFeeling
): Promise<void> {
  await supabase
    .from('next_meetup_feelings')
    .upsert(
      { connection_id: connectionId, user_id: userId, meetup_date: meetupDate, feeling },
      { onConflict: 'connection_id,user_id,meetup_date' }
    );
}

export async function hasAckedNextMeetupFeeling(connectionId: string, userId: string, meetupDate: string): Promise<boolean> {
  const { data } = await supabase
    .from('next_meetup_feelings')
    .select('id')
    .eq('connection_id', connectionId)
    .eq('user_id', userId)
    .eq('meetup_date', meetupDate)
    .maybeSingle();
  return Boolean(data);
}

export type MeetupCheckinStatus = {
  checkin_id: string;
  my_outcome: MeetupCheckinOutcome | null;
  my_resolved_at: string | null;
  other_reported_outcome: 'went_well' | 'rough' | null;
  other_outcome: MeetupCheckinOutcome | null;
  other_resolved: boolean;
  mutually_confirmed_occurred: boolean;
  branch: 'good' | 'not_good' | null;
  // Persisted "Not now" dismissal (meetup_outcome_dismissals,
  // 2026-07-28), replacing an earlier client-only dismiss that didn't
  // survive this app's router.replace()-only navigation, see that
  // migration's own header comment.
  outcome_dismissed: boolean;
};

// Records real engagement with "Let's plan something" (opened, an idea
// picked, etc.), returns whether this was the first time ever for this
// connection. The caller uses that to decide whether to show the
// first-time milestone (self-report + Guide nudge) before proceeding.
export async function recordPlanActivity(connectionId: string): Promise<boolean> {
  const { data } = await supabase.rpc('record_plan_activity', { p_connection_id: connectionId });
  return Boolean(data);
}

export async function submitFirstMeetupFeeling(connectionId: string, userId: string, feeling: FirstMeetupFeeling) {
  await supabase
    .from('first_meetup_feelings')
    .upsert({ connection_id: connectionId, user_id: userId, feeling }, { onConflict: 'connection_id,user_id' });
}

export async function resolveMeetupCheckin(checkinId: string, outcome: MeetupCheckinOutcome) {
  await supabase.rpc('resolve_meetup_checkin', { p_checkin_id: checkinId, p_outcome: outcome });
}

// Graduation foundation (2026-08-25): meetup_count now only increments on
// a real mutual confirmation, not the old "both independently said
// went_well" comparison. Whenever a MeetupCheckinCard resolution reports
// a meetup happened (went_well/rough), resolve_meetup_checkin creates one
// of these targeting the OTHER participant, decoupled from that other
// participant's own, separate meetup_checkins resolution. Own-row RLS,
// SELECT-only for the confirmer, structurally invisible to the reporter,
// see the migration's own comment for why that matters here specifically.
export type MeetupConfirmationRequest = {
  id: string;
  connection_id: string;
  reporter_id: string;
  reported_outcome: MeetupCheckinOutcome;
  reported_meetup_date: string;
  created_at: string;
};

export async function fetchPendingMeetupConfirmation(connectionId: string): Promise<MeetupConfirmationRequest | null> {
  const { data } = await supabase
    .from('meetup_confirmation_requests')
    .select('id, connection_id, reporter_id, reported_outcome, reported_meetup_date, created_at')
    .eq('connection_id', connectionId)
    .is('resolved_at', null)
    .is('dismissed_at', null)
    .maybeSingle();
  return (data as MeetupConfirmationRequest | null) ?? null;
}

// Confirm logs the meetup for real (meetup_log + meetup_count, atomically,
// server-side) and is the only path that does either now. Deny does
// nothing further. The reporter can never tell which of the two happened,
// or whether this was ever answered at all, enforced by RLS, not just by
// this client never asking.
export async function resolveMeetupConfirmation(requestId: string, resolution: 'confirmed' | 'denied'): Promise<void> {
  const { error } = await supabase.rpc('resolve_meetup_confirmation', {
    p_request_id: requestId,
    p_resolution: resolution,
  });
  if (error) throw error;
}

// "Ignore": marks dismissed so the card stops re-showing, without
// recording an actual answer, functionally identical to a genuine silent
// non-response either way (see the migration's own comment).
export async function dismissMeetupConfirmationRequest(requestId: string): Promise<void> {
  const { error } = await supabase.rpc('dismiss_meetup_confirmation', { p_request_id: requestId });
  if (error) throw error;
}

export type MeetupLogEntry = {
  id: string;
  meetup_date: string;
  outcome: MeetupCheckinOutcome;
};

// Both participants can read this (a shared, mutually-confirmed fact),
// used by the thread header's "Met N times · date, date, date" display.
// Ordered most-recent-first, matching how a person would naturally think
// about "the last few times we met."
export async function fetchMeetupLog(connectionId: string): Promise<MeetupLogEntry[]> {
  const { data } = await supabase
    .from('meetup_log')
    .select('id, meetup_date, outcome')
    .eq('connection_id', connectionId)
    .order('meetup_date', { ascending: false });
  return (data ?? []) as MeetupLogEntry[];
}

// Short "Aug 5" label for the thread header. Parses the plain YYYY-MM-DD
// string's own y/m/d components directly via the local Date constructor,
// never new Date(isoString), the same UTC-midnight-vs-local-timezone
// off-by-one-day bug remember.ts's own parseMeetupDate/formatMeetupDate
// were built to avoid (see that file's header comment).
export function formatMeetupDateShort(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// "Not now" on the not_good outcome card: a real, persisted dismissal
// (meetup_outcome_dismissals), a plain own-row insert, no RPC needed, this
// is a personal record with no cross-participant reconciliation, unlike
// resolveMeetupCheckin above. Still not permanent in the sense of "never
// resurface": a genuinely new checkin cycle gets its own checkin_id,
// which was never dismissed, so a fresh not_good outcome still shows.
export async function dismissMeetupOutcome(checkinId: string, userId: string) {
  await supabase.from('meetup_outcome_dismissals').insert({ checkin_id: checkinId, user_id: userId });
}

// Reads the caller's own checkin plus whatever can be known about mutual
// resolution, so the thread screen can show the right card (a resolved
// good/not_good branch) even when it was the OTHER participant's answer
// that completed the reconciliation, not something visible from a plain
// client-side read of the caller's own row alone.
export async function fetchMeetupCheckinStatus(connectionId: string): Promise<MeetupCheckinStatus | null> {
  const { data } = await supabase.rpc('get_meetup_checkin_status', { p_connection_id: connectionId });
  const row = Array.isArray(data) ? data[0] : data;
  return (row as MeetupCheckinStatus | null) ?? null;
}
