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

// Dismiss (or snooze for a few hours) the person's own card. Before
// 2026-10-08, "I'll come back to this"-style buttons only reloaded the
// screen and the same card came straight back.
export async function dismissIntervention(interventionId: string, snoozeHours?: number): Promise<void> {
  const { error } = await supabase.rpc('dismiss_intervention', {
    p_intervention_id: interventionId,
    p_snooze_hours: snoozeHours ?? null,
  });
  if (error) throw error;
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

// A meetup plan (2026-10-08): date is required; time, place and what
// you'll do are optional. Proposing while a plan is active replaces it
// with a new version the other person confirms ("Change plan").
export type MeetupPlanInput = {
  date: string; // YYYY-MM-DD
  startTime?: string | null; // HH:MM, 24-hour
  place?: string | null;
  activity?: string | null;
  // Set when the place was picked from the map search.
  placeAddress?: string | null;
  placeLat?: number | null;
  placeLng?: number | null;
};

export function deviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}

export async function proposeMeetup(connectionId: string, plan: MeetupPlanInput): Promise<string> {
  const { data, error } = await supabase.rpc('propose_meetup', {
    p_connection_id: connectionId,
    p_date: plan.date,
    p_start_time: plan.startTime || null,
    p_place: plan.place?.trim() || null,
    p_activity: plan.activity?.trim() || null,
    p_time_zone: deviceTimeZone(),
    p_place_address: plan.placeAddress?.trim() || null,
    p_place_lat: plan.placeLat ?? null,
    p_place_lng: plan.placeLng ?? null,
  });
  if (error) throw error;
  return data as string;
}

// The other person picks a time from an invite (2026-10-10). A day and
// part of the day the sender offered sets the plan right away
// ('confirmed'); anything else goes to the sender to confirm ('proposed').
export async function acceptPlanInvite(
  inviteId: string,
  plan: MeetupPlanInput
): Promise<{ meetup_id: string; status: 'confirmed' | 'proposed' }> {
  const { data, error } = await supabase.rpc('accept_plan_invite', {
    p_invite_id: inviteId,
    p_date: plan.date,
    p_start_time: plan.startTime || null,
    p_place: plan.place?.trim() || null,
    p_activity: plan.activity?.trim() || null,
    p_time_zone: deviceTimeZone(),
    p_place_address: plan.placeAddress?.trim() || null,
    p_place_lat: plan.placeLat ?? null,
    p_place_lng: plan.placeLng ?? null,
  });
  if (error) throw error;
  return data as { meetup_id: string; status: 'confirmed' | 'proposed' };
}

// "We met up": a meetup two people made outside the app (2026-10-10). The
// other person is asked to confirm; it counts once they do, or after a
// week with no answer.
export async function logPastMeetup(connectionId: string, date: string, activity: string | null): Promise<void> {
  const { error } = await supabase.rpc('log_past_meetup', {
    p_connection_id: connectionId,
    p_date: date,
    p_activity: activity?.trim() || null,
    p_time_zone: deviceTimeZone(),
  });
  if (error) {
    if (/already_waiting/.test(error.message))
      throw new Error("You already added a meetup that's waiting for the other person to confirm.");
    if (/already_counted/.test(error.message)) throw new Error('A meetup on that day is already counted.');
    if (/date_in_future/.test(error.message)) throw new Error('Pick today or an earlier day.');
    if (/date_before_connected/.test(error.message)) throw new Error('Pick a day after you connected here.');
    throw new Error("That didn't save. Please try again.");
  }
}

// Fill in a detail that is still missing. Never changes an agreed detail,
// so no re-confirm is needed.
export async function addMeetupDetails(
  meetupId: string,
  details: {
    startTime?: string | null;
    place?: string | null;
    activity?: string | null;
    placeAddress?: string | null;
    placeLat?: number | null;
    placeLng?: number | null;
  }
): Promise<void> {
  const { error } = await supabase.rpc('add_meetup_details', {
    p_meetup_id: meetupId,
    p_start_time: details.startTime || null,
    p_place: details.place?.trim() || null,
    p_activity: details.activity?.trim() || null,
    p_place_address: details.placeAddress?.trim() || null,
    p_place_lat: details.placeLat ?? null,
    p_place_lng: details.placeLng ?? null,
  });
  if (error) throw error;
}

// Only "what you'll do" changed: no re-confirm needed (2026-10-09).
export async function updateMeetupActivity(meetupId: string, activity: string): Promise<void> {
  const { error } = await supabase.rpc('update_meetup_activity', { p_meetup_id: meetupId, p_activity: activity });
  if (error) throw error;
}

export type PaceKey = 'weekly' | 'few_weeks' | 'monthly' | 'occasional' | 'not_sure';
export const PACE_LABELS: Record<PaceKey, string> = {
  weekly: 'Every week or two',
  few_weeks: 'Every few weeks',
  monthly: 'About once a month',
  occasional: 'Occasionally',
  not_sure: "I'm not sure yet",
};

// Your own meeting pace for a chat, and whether the other person picked
// the same one. Their answer itself is never returned.
export async function getPaceSummary(
  connectionId: string
): Promise<{ mine: PaceKey | null; bothSame: boolean } | null> {
  const { data, error } = await supabase.rpc('get_pace_summary', { p_connection_id: connectionId });
  if (error || !data) return null;
  const d = data as { mine: PaceKey | null; both_same: boolean };
  return { mine: d.mine, bothSame: Boolean(d.both_same) };
}

export type MeetupPlan = {
  id: string;
  status: 'proposed' | 'confirmed';
  date: string;
  start_time: string | null;
  place: string | null;
  place_address?: string | null;
  place_lat?: number | null;
  place_lng?: number | null;
  activity: string | null;
  time_zone: string;
  proposed_by: string;
  move_count: number;
  plan_root_id: string;
  previous: { date: string; start_time: string | null; place: string | null } | null;
  other_still_on: boolean;
  my_still_on: 'still_on' | 'needs_move' | null;
  many_moves_answered: boolean;
};

export async function getMeetupPlan(
  connectionId: string
): Promise<{ meetup: MeetupPlan | null; meetupCount: number; localToday: string | null }> {
  const { data, error } = await supabase.rpc('get_meetup_plan', { p_connection_id: connectionId });
  if (error) throw error;
  const d = (data ?? {}) as { meetup?: MeetupPlan | null; meetup_count?: number; local_today?: string };
  return { meetup: d.meetup ?? null, meetupCount: d.meetup_count ?? 0, localToday: d.local_today ?? null };
}

export type MeetupPrompt = 'still_on' | 'feeling' | 'many_moves';
export async function respondToMeetupPrompt(meetupId: string, prompt: MeetupPrompt, answer: string): Promise<void> {
  const { error } = await supabase.rpc('respond_to_meetup_prompt', {
    p_meetup_id: meetupId,
    p_prompt: prompt,
    p_answer: answer,
  });
  if (error) throw error;
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

// ---- Pause / resume (rules updated 2026-10-09) ----
// A pause always has an end date, at most 2 weeks away. Both people can
// see that the chat is paused and until when. While paused there are no
// reminders and no messages, and the chat doesn't count toward the 3
// active conversations. Only the person who paused can resume early; the
// other person can always end the connection.

export type PauseDuration = 'few_days' | 'one_week' | 'two_weeks';

export const PAUSE_OPTIONS: { key: PauseDuration; label: string; days: number }[] = [
  { key: 'few_days', label: '3 days', days: 3 },
  { key: 'one_week', label: '1 week', days: 7 },
  { key: 'two_weeks', label: '2 weeks', days: 14 },
];

const PAUSE_ERRORS: Record<string, string> = {
  already_paused: 'This chat is already paused.',
  not_open: "This chat isn't open, so there's nothing to pause.",
  pause_length: 'A pause can last up to 2 weeks.',
  pause_limit: "You've paused this chat twice in the last month. If you need more space, you can end the connection instead.",
  only_pauser_can_resume: 'Only the person who paused this chat can resume it early. It opens again on its own on the end date.',
  pause_note_required: 'Write a short note first, so they know why the chat is pausing.',
  pause_note_too_long: 'Please keep the note under 1,000 characters.',
  no_messages_yet: "There's nothing to pause yet. Say hello first.",
};

// An error whose message is safe and helpful to show as-is.
export class FriendlyError extends Error {}

function pauseErrorMessage(message: string): string {
  const key = Object.keys(PAUSE_ERRORS).find((k) => message.includes(k));
  return key ? PAUSE_ERRORS[key] : 'Something went wrong. Please try again.';
}

// A pause always comes with a short note the person writes themselves. The
// note is sent as a message in the same step, just before the chat pauses.
export async function pauseConnectionWithDuration(
  connectionId: string,
  duration: PauseDuration,
  message: string
): Promise<void> {
  const days = PAUSE_OPTIONS.find((o) => o.key === duration)?.days ?? 7;
  const { error } = await supabase.rpc('pause_connection_with_duration', {
    p_connection_id: connectionId,
    p_paused_until: new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString(),
    p_message: message.trim(),
  });
  if (error) throw new FriendlyError(pauseErrorMessage(error.message ?? ''));
}

export async function resumeConnectionEarly(connectionId: string): Promise<void> {
  const { error } = await supabase.rpc('resume_connection_early', { p_connection_id: connectionId });
  if (error) throw new FriendlyError(pauseErrorMessage(error.message ?? ''));
}

export type PauseDetails = {
  connection_id: string;
  paused_until: string;
  paused_by_me: boolean;
  other_paused_name: string | null;
};

// Pause details for one chat, or for all of the viewer's paused chats.
export async function getPauseDetails(connectionId?: string): Promise<PauseDetails[]> {
  const { data, error } = await supabase.rpc(
    'get_pause_details',
    connectionId ? { p_connection_id: connectionId } : {}
  );
  if (error) return [];
  return (data ?? []) as PauseDetails[];
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
export type MeetupCancellationReason = 'schedule_conflict' | 'circumstances_changed' | 'lost_interest' | 'other' | 'no_show';
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
