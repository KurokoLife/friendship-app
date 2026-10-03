import { supabase } from '@/lib/supabase';

// Friendship Journey rebuild — client wrapper around the new RPC layer
// (see FRIENDSHIP_JOURNEY_DESIGN.md). This file is currently reached only
// from thread/[id].tsx's __DEV__-gated new-system path (see that file's own
// comment for why): the new backend is fully built and tested, but nothing
// here is wired into what a real production user sees yet — that's the
// deliberate cutover step, not taken in this pass.

export type ActiveIntervention = {
  intervention_type: string;
  source: 'stored' | 'computed';
  intervention_id: string | null;
  payload: Record<string, unknown>;
};

export async function getActiveIntervention(
  connectionId: string,
  viewerId: string
): Promise<ActiveIntervention | null> {
  const { data, error } = await supabase.rpc('get_active_intervention', {
    p_connection_id: connectionId,
    p_viewer_id: viewerId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return (row as ActiveIntervention | null) ?? null;
}

// ---- Meetups ----

export type MeetupStatus =
  | 'proposed'
  | 'confirmed'
  | 'rescheduled'
  | 'cancelled'
  | 'occurred'
  | 'not_occurred'
  | 'unresolved';

export type DateStatus = 'not_applicable' | 'confirmed' | 'disputed';

export async function proposeMeetup(connectionId: string, date: string): Promise<string> {
  const { data, error } = await supabase.rpc('propose_meetup', { p_connection_id: connectionId, p_date: date });
  if (error) throw error;
  return data as string;
}

export async function confirmMeetup(meetupId: string): Promise<void> {
  const { error } = await supabase.rpc('confirm_meetup', { p_meetup_id: meetupId });
  if (error) throw error;
}

export async function cancelMeetup(meetupId: string, concernResolution?: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_meetup', {
    p_meetup_id: meetupId,
    p_concern_resolution: concernResolution ?? null,
  });
  if (error) throw error;
}

export type OccurrenceReportResult =
  | { resolved: false; waiting_on_other: true }
  | { resolved: true; status: 'occurred' | 'not_occurred' | 'unresolved' };

export async function reportMeetupOccurrence(
  meetupId: string,
  reportedYes: boolean,
  reportedDate?: string | null
): Promise<OccurrenceReportResult> {
  const { data, error } = await supabase.rpc('report_meetup_occurrence', {
    p_meetup_id: meetupId,
    p_reported_yes: reportedYes,
    p_reported_date: reportedDate ?? null,
  });
  if (error) throw error;
  return data as OccurrenceReportResult;
}

// ---- Meetup date reconciliation/correction (design doc §5, cases 2 and 5) ----

export async function proposeMeetupDateResolution(meetupId: string, proposedDate: string): Promise<string> {
  const { data, error } = await supabase.rpc('propose_meetup_date_resolution', {
    p_meetup_id: meetupId,
    p_proposed_date: proposedDate,
  });
  if (error) throw error;
  return data as string;
}

export async function resolveMeetupDateResolution(resolutionId: string, approve: boolean): Promise<void> {
  const { error } = await supabase.rpc('resolve_meetup_date_resolution', {
    p_resolution_id: resolutionId,
    p_approve: approve,
  });
  if (error) throw error;
}

// ---- Meetup history (design doc §5, "User-facing meetup-history view") ----

export type MeetupHistoryEntry = {
  connection_id: string;
  sequence_number: number;
  date_status: DateStatus;
  occurred_date: string | null;
  proposed_by: string;
};

export async function fetchMeetupHistory(connectionId: string): Promise<MeetupHistoryEntry[]> {
  const { data, error } = await supabase
    .from('meetup_history')
    .select('connection_id, sequence_number, date_status, occurred_date, proposed_by')
    .eq('connection_id', connectionId)
    .order('sequence_number', { ascending: false });
  if (error) throw error;
  return (data ?? []) as MeetupHistoryEntry[];
}

// A meetup whose date is disputed and awaiting reconciliation — the data a
// "Met — date unconfirmed" row needs to offer the reconciliation action.
// Deliberately reads only date_status/id, never meetup_occurrence_reports
// (each participant's individual, possibly-differing claim stays private
// until reconciled — see the design doc's own reasoning for why).
export async function fetchDisputedMeetups(connectionId: string): Promise<{ id: string; sequence_number: number }[]> {
  const { data, error } = await supabase
    .from('meetups')
    .select('id, sequence_number')
    .eq('connection_id', connectionId)
    .eq('status', 'occurred')
    .eq('date_status', 'disputed')
    .order('sequence_number', { ascending: false });
  if (error) throw error;
  return (data ?? []) as { id: string; sequence_number: number }[];
}

// ---- Pause / resume with a defined defer window (Decision 3) ----

export type PauseDuration = 'couple_days' | 'about_a_week' | 'indefinite';

export async function pauseConnectionWithDuration(connectionId: string, duration: PauseDuration): Promise<void> {
  const pausedUntil =
    duration === 'couple_days'
      ? new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString()
      : duration === 'about_a_week'
        ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
        : null;
  const { error } = await supabase.rpc('pause_connection_with_duration', {
    p_connection_id: connectionId,
    p_paused_until: pausedUntil,
  });
  if (error) throw error;
}

export async function resumeConnectionEarly(connectionId: string): Promise<void> {
  const { error } = await supabase.rpc('resume_connection_early', { p_connection_id: connectionId });
  if (error) throw error;
}

// ---- Private submissions ----

export type SecondLookResponse = 'yes' | 'maybe_later' | 'no';
export async function submitSecondLookResponse(connectionId: string, response: SecondLookResponse): Promise<void> {
  const { error } = await supabase.rpc('submit_second_look_response', {
    p_connection_id: connectionId,
    p_response: response,
  });
  if (error) throw error;
}

export type PostMeetupReflectionResponse = 'know_better' | 'open_to_another' | 'still_figuring' | 'dont_continue';
export async function submitPostMeetupReflection(
  meetupId: string,
  response: PostMeetupReflectionResponse
): Promise<void> {
  const { error } = await supabase.rpc('submit_post_meetup_reflection', {
    p_meetup_id: meetupId,
    p_response: response,
  });
  if (error) throw error;
}

export type RhythmCadence = 'weekly' | 'few_weeks' | 'monthly' | 'occasional' | 'not_sure';
export async function submitRhythmPreference(connectionId: string, cadence: RhythmCadence): Promise<void> {
  const { error } = await supabase.rpc('submit_rhythm_preference', {
    p_connection_id: connectionId,
    p_cadence: cadence,
  });
  if (error) throw error;
}

export type GraduationReadiness = 'still_helpful' | 'mostly_on_our_own' | 'not_sure';
// Limen v2: returns true when this answer completed a mutual "yes" and the
// connection graduated for both people. `note` is an optional private
// reason ("Keep going here for now"), never shown to the other person.
export async function submitGraduationReadiness(
  connectionId: string,
  readiness: GraduationReadiness,
  note?: string
): Promise<boolean> {
  const { data, error } = await supabase.rpc('submit_graduation_readiness', {
    p_connection_id: connectionId,
    p_readiness: readiness,
    p_note: note ?? null,
  });
  if (error) throw error;
  return data === true;
}

export type PreMeetupConcern = 'awkwardness' | 'low_energy' | 'plan_too_big' | 'safety' | 'other';
export async function submitPreMeetupConcern(meetupId: string, concern: PreMeetupConcern): Promise<string> {
  const { data, error } = await supabase.rpc('submit_pre_meetup_concern', { p_meetup_id: meetupId, p_concern: concern });
  if (error) throw error;
  return data as string;
}

export type PreMeetupResolution = 'reassured' | 'plan_simplified' | 'cancelled' | 'blocked' | 'rescheduled';
export async function resolvePreMeetupConcern(concernId: string, resolution: PreMeetupResolution): Promise<void> {
  const { error } = await supabase.rpc('resolve_pre_meetup_concern', {
    p_concern_id: concernId,
    p_resolution: resolution,
  });
  if (error) throw error;
}

// Part 3 of tonight's consolidated build: a deliberately separate
// mechanism from pre_meetup_concerns (see the migration's own header
// comment for why), backing the new post-meetup "why was it cancelled"
// question.
export type MeetupCancellationReason = 'schedule_conflict' | 'circumstances_changed' | 'lost_interest' | 'other';
export async function submitMeetupCancellationReason(
  meetupId: string,
  reason: MeetupCancellationReason,
  wantsReschedule?: boolean
): Promise<void> {
  const { error } = await supabase.rpc('submit_meetup_cancellation_reason', {
    p_meetup_id: meetupId,
    p_reason: reason,
    p_wants_reschedule: wantsReschedule ?? null,
  });
  if (error) throw error;
}
