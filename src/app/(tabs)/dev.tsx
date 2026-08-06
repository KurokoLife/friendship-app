import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { type CoachMarkKey, resetCoachMark, resetCoachMarks } from '@/lib/coach-marks';
import { DEV_SEED_USERS, devSignInAs } from '@/lib/dev-tools';
import { type NoGhostTriggerId } from '@/lib/no-ghost';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400, matches this app's own established placeholder color

// The 9 real coach-mark keys, for the Time Travel panel's "reset one
// specific mark" picker. Not imported from coach-marks.ts's own type
// (a type has no runtime array to iterate), kept in sync manually, same
// as every other place in this codebase that needs a real list alongside
// a type (e.g. DEV_SEED_USERS above).
const ALL_COACH_MARK_KEYS: CoachMarkKey[] = [
  'tab_discover',
  'tab_browse',
  'tab_saved',
  'tab_inbox',
  'no_ghost_prompt',
  'meetup_checkin',
  'tab_remember',
  'tab_profile',
  'credits_premium',
];

// The 5 real free-tier-capped functions (ai_function_caps) plus
// generate-personality-narrative's separate retake cap (special-cased
// inside get_ai_gate_status, not in ai_function_caps), for the Time
// Travel panel's AI-usage-cap reset picker.
const AI_CAPPED_FUNCTIONS = [
  'generate-reply-draft',
  'generate-activity-suggestions',
  'generate-connection-analysis',
  'organize-remember-entry',
  'summarize-remember-timeline',
  'generate-personality-narrative',
];

type DevConversation = {
  connection_id: string;
  display_name: string | null;
  connection_status: string | null;
};

type DevConnectionInfo = {
  user_a_id: string;
  user_a_gender: string | null;
  user_b_id: string;
  user_b_gender: string | null;
  last_sender_id: string | null;
};

// Fix #2 (2026-07-20): rebuilt for blueprint Section 10's timeline.
// Trigger identity is R1/R2/R3 (receiver) or S1 (sender, the only
// sender-side DB row now), which participant it targets is read off the
// R/S prefix, same as the previous rewrite. The sender's own passive
// reassurance lines (20h, 72h-in-Chat) have no DB row at all, computed
// live from the connection's last message, previewed by backdating the
// message (dev_set_last_message_age, 20260713000002) rather than
// force-firing a row that doesn't exist for them.
type PromptTrigger = { kind: 'prompt'; key: string; triggerId: NoGhostTriggerId; label: string };
type StatusPreviewTrigger = { kind: 'status_preview'; key: string; hoursAgo: number; label: string };
type NoGhostTrigger = PromptTrigger | StatusPreviewTrigger;

const NO_GHOST_TRIGGERS: NoGhostTrigger[] = [
  { kind: 'status_preview', key: 'sender-20h', hoursAgo: 20, label: 'Preview sender reassurance (20hr)' },
  { kind: 'status_preview', key: 'sender-72h', hoursAgo: 72, label: 'Preview sender reassurance (72hr)' },
  { kind: 'prompt', key: 'r1', triggerId: 'R1', label: 'Trigger R1 (receiver, first reminder, 20/36hr)' },
  { kind: 'prompt', key: 'r2', triggerId: 'R2', label: 'Trigger R2 (receiver, 72hr, Reply/Pause/End)' },
  { kind: 'prompt', key: 'r3', triggerId: 'R3', label: 'Trigger R3 (receiver, 120hr final)' },
  { kind: 'prompt', key: 's1', triggerId: 'S1', label: 'Trigger S1 (sender, 125hr, keep waiting/follow-up/close)' },
];

// __DEV__-only account switcher. Lets a developer sign in as any of the
// eight seed test accounts to exercise real authenticated flows, most
// usefully: opening the same thread as both participants (e.g. two
// devices, or two tabs) to see F16's real-time messaging actually work
// between two live sessions. Excluded from the tab bar in production
// (`href: null` in (tabs)/_layout.tsx); this early return is a second,
// independent guard so a direct deep link to /dev in a real build still
// renders nothing.
export default function DevScreen() {
  const [signingInAs, setSigningInAs] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conversations, setConversations] = useState<DevConversation[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [hoursOffset, setHoursOffset] = useState('50');
  const [noGhostBusy, setNoGhostBusy] = useState<string | null>(null);
  const [noGhostStatus, setNoGhostStatus] = useState<string | null>(null);
  const [resettingMatches, setResettingMatches] = useState(false);
  const [resetMatchesStatus, setResetMatchesStatus] = useState<string | null>(null);
  const [connectionInfo, setConnectionInfo] = useState<DevConnectionInfo | null>(null);
  const [reflectionBusy, setReflectionBusy] = useState<string | null>(null);
  const [reflectionStatus, setReflectionStatus] = useState<string | null>(null);
  const [planActivityHoursAgo, setPlanActivityHoursAgo] = useState('170');
  const [checkinBusy, setCheckinBusy] = useState<string | null>(null);
  const [checkinDevStatus, setCheckinDevStatus] = useState<string | null>(null);
  const [reflectionOffsetHours, setReflectionOffsetHours] = useState('25');
  const [reflectionRunBusy, setReflectionRunBusy] = useState(false);
  const [reflectionRunStatus, setReflectionRunStatus] = useState<string | null>(null);

  // Time Travel panel state
  const [ttBusy, setTtBusy] = useState<string | null>(null);
  const [ttStatus, setTtStatus] = useState<string | null>(null);
  const [ttBackdateHours, setTtBackdateHours] = useState('48');
  const [ttNewMsgSenderId, setTtNewMsgSenderId] = useState<string | null>(null);
  const [ttNewMsgText, setTtNewMsgText] = useState('');
  const [ttNewMsgHoursAgo, setTtNewMsgHoursAgo] = useState('24');
  const [ttMeetupDate, setTtMeetupDate] = useState('');
  const [ttMeetupStatus, setTtMeetupStatus] = useState<'proposed' | 'confirmed' | null>(null);
  const [ttMeetupProposedBy, setTtMeetupProposedBy] = useState<string | null>(null);
  const [ttDisclosedHoursAgo, setTtDisclosedHoursAgo] = useState('192');
  const [ttSpecificMark, setTtSpecificMark] = useState<CoachMarkKey>('tab_discover');
  const [ttCapFunction, setTtCapFunction] = useState<string>('generate-reply-draft');
  const [ttCapHoursAgo, setTtCapHoursAgo] = useState('');
  const [ttPoolHoursAgo, setTtPoolHoursAgo] = useState('40');
  const [ttPoolSpent, setTtPoolSpent] = useState('0');

  const loadConversations = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setConversations([]);
      return;
    }
    const { data } = await supabase
      .from('inbox_conversations')
      .select('connection_id, display_name, connection_status')
      .order('last_message_at', { ascending: false });
    setConversations((data ?? []) as DevConversation[]);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadConversations();
    }, [loadConversations])
  );

  if (!__DEV__) return null;

  const handleSwitch = async (phone: string) => {
    setSigningInAs(phone);
    setError(null);
    const { error: signInError } = await devSignInAs(phone);
    setSigningInAs(null);
    if (signInError) {
      setError(signInError.message);
      return;
    }
    // Bug fix: this screen stays mounted across tab switches (it isn't
    // remounted just because the user navigated to /home and back), so
    // without this reset, selectedConnectionId/connectionInfo silently
    // kept pointing at the PREVIOUS account's connection. Every no-ghost
    // trigger RPC (dev_force_no_ghost_step, dev_get_connection_info, etc.)
    // participant-checks the connection against the newly signed-in
    // account, so a stale id from the old account would fail that check,
    // the trigger buttons looked like they "weren't firing." Clearing all
    // of this on every successful switch forces a fresh selection under
    // the new account, conversations itself already reloads correctly via
    // loadConversations's own useFocusEffect.
    setConversations([]);
    setSelectedConnectionId(null);
    setConnectionInfo(null);
    setNoGhostStatus(null);
    setResetMatchesStatus(null);
    setReflectionStatus(null);
    router.replace('/home');
  };

  // Clears the signed-in account's own connections and match_suggestions
  // (dev_reset_my_matches, 20260712000009), so Discover testing can
  // restart from scratch without manual SQL. Deleting a connection
  // cascades to its messages and no-ghost prompts too, a real and
  // expected side effect, not a bug.
  const handleResetMyMatches = async () => {
    setResettingMatches(true);
    setResetMatchesStatus(null);
    const { error: rpcError } = await supabase.rpc('dev_reset_my_matches');
    setResettingMatches(false);
    setResetMatchesStatus(
      rpcError
        ? rpcError.message
        : 'Cleared. All connections, messages, and match suggestions for this account are gone, Discover will regenerate from scratch next time it loads.'
    );
    loadConversations();
  };

  const handleSelectConnection = async (connectionId: string) => {
    setSelectedConnectionId(connectionId);
    setNoGhostStatus(null);
    setConnectionInfo(null);
    const { data, error: infoError } = await supabase
      .rpc('dev_get_connection_info', { p_connection_id: connectionId })
      .maybeSingle();
    if (!infoError && data) {
      setConnectionInfo(data as DevConnectionInfo);
    }
  };

  const handleTriggerPrompt = async (triggerId: NoGhostTriggerId, key: string) => {
    if (!selectedConnectionId) return;
    setNoGhostBusy(key);
    setNoGhostStatus(null);
    const { error: rpcError } = await supabase.rpc('dev_force_no_ghost_step', {
      p_connection_id: selectedConnectionId,
      p_trigger_id: triggerId,
    });
    setNoGhostBusy(null);
    setNoGhostStatus(
      rpcError
        ? rpcError.message
        : `${triggerId} triggered. Open this thread as the targeted account to see it (switch accounts above if needed).`
    );
  };

  const handleStatusPreview = async (hoursAgo: number, key: string) => {
    if (!selectedConnectionId) return;
    setNoGhostBusy(key);
    setNoGhostStatus(null);
    const { error: rpcError } = await supabase.rpc('dev_set_last_message_age', {
      p_connection_id: selectedConnectionId,
      p_hours_ago: hoursAgo,
    });
    setNoGhostBusy(null);
    setNoGhostStatus(
      rpcError
        ? rpcError.message
        : `Last message backdated to ${hoursAgo} hours ago. Open this thread as the sender of that message to see the status line (switch accounts above if needed). This also feeds the real scheduler, which may fire real receiver prompts next time it runs.`
    );
  };

  const handleReset = async () => {
    if (!selectedConnectionId) return;
    setNoGhostBusy('reset');
    setNoGhostStatus(null);
    const { error: rpcError } = await supabase.rpc('dev_reset_no_ghost', {
      p_connection_id: selectedConnectionId,
    });
    setNoGhostBusy(null);
    setNoGhostStatus(rpcError ? rpcError.message : 'All no-ghost state cleared for this thread.');
  };

  // Fix #2: quick way to verify Pause actually stops the timer without
  // going through the R2/R3 prompt card UI.
  const handlePauseConnection = async () => {
    if (!selectedConnectionId) return;
    setNoGhostBusy('pause');
    setNoGhostStatus(null);
    const { error: rpcError } = await supabase.rpc('pause_connection', {
      p_connection_id: selectedConnectionId,
    });
    setNoGhostBusy(null);
    setNoGhostStatus(
      rpcError ? rpcError.message : 'Connection paused. Any active prompts were cleared, and the scheduler will skip it until resumed.'
    );
  };

  const handleResumeConnection = async () => {
    if (!selectedConnectionId) return;
    setNoGhostBusy('resume');
    setNoGhostStatus(null);
    const { error: rpcError } = await supabase.rpc('resume_connection', {
      p_connection_id: selectedConnectionId,
    });
    setNoGhostBusy(null);
    setNoGhostStatus(rpcError ? rpcError.message : 'Connection resumed.');
  };

  const handleRunWithOffset = async () => {
    if (!selectedConnectionId) return;
    const hours = Number(hoursOffset);
    if (!Number.isFinite(hours)) {
      setNoGhostStatus('Enter a number of hours, e.g. 50.');
      return;
    }
    setNoGhostBusy('offset');
    setNoGhostStatus(null);
    const fakeNow = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
    const { error: rpcError } = await supabase.rpc('dev_run_no_ghost_check', {
      p_connection_id: selectedConnectionId,
      p_now: fakeNow,
    });
    setNoGhostBusy(null);
    setNoGhostStatus(
      rpcError
        ? rpcError.message
        : `Scheduler logic ran as if ${hours} hours had passed. Whichever steps now qualify were fired.`
    );
  };

  // F19 dev triggers: force-fires for the signed-in account only (see the
  // RPC's own comment for why, unlike no-ghost this doesn't need a
  // sender/receiver distinction, both sides get an identical prompt).
  const handleTriggerReflection = async () => {
    if (!selectedConnectionId) return;
    setReflectionBusy('trigger');
    setReflectionStatus(null);
    const { error: rpcError } = await supabase.rpc('dev_force_follow_up_reflection', {
      p_connection_id: selectedConnectionId,
    });
    setReflectionBusy(null);
    setReflectionStatus(
      rpcError ? rpcError.message : 'Reflection prompt fired for the signed-in account. Open this thread to see it.'
    );
  };

  const handleResetReflection = async () => {
    if (!selectedConnectionId) return;
    setReflectionBusy('reset');
    setReflectionStatus(null);
    const { error: rpcError } = await supabase.rpc('dev_reset_follow_up_reflection', {
      p_connection_id: selectedConnectionId,
    });
    setReflectionBusy(null);
    setReflectionStatus(rpcError ? rpcError.message : 'Reflection state cleared for this thread.');
  };

  // Time Travel panel investigation finding: run_follow_up_reflection_check
  // already accepted a simulated p_now, but had no dev-callable wrapper at
  // all (unlike no-ghost and meetup-checkin, both of which already have a
  // "run with offset" control above), and used to return void, the exact
  // "can't tell a real no-op from a bug" gap already fixed once for the
  // checkin evaluator (2026-08-01). Fixed at the DB layer (migration
  // 20260824000000) and wired here, in the existing F19 section rather
  // than a new one, since this is the same "time offset" pattern the
  // no-ghost/checkin sections above already use, just for the one real
  // evaluator that was missing it.
  const REFLECTION_RESULT_MESSAGES: Record<string, string> = {
    fired: 'Fired. A reflection row was created for both participants, open the thread as either to see it.',
    already_fired_this_cycle:
      'Nothing new happened: a reflection row already exists for this cycle. Use Reset reflection state above, or send a fresh message (which clears it automatically), then try again.',
    not_enough_time_elapsed:
      'Nothing fired: less than 24 hours have passed since the last real message. Increase the hours-ago value above.',
    not_two_sided_conversation:
      'Nothing fired: this requires a real two-sided exchange (both participants have sent at least one message), not just an unanswered opener.',
    no_messages: 'Nothing fired: this connection has no messages at all yet.',
    connection_not_found: 'Nothing fired: this connection could not be found.',
  };

  const handleRunReflectionEvaluator = async () => {
    if (!selectedConnectionId) return;
    const hours = Number(reflectionOffsetHours);
    if (!Number.isFinite(hours)) {
      setReflectionRunStatus('Enter a number of hours, e.g. 25.');
      return;
    }
    setReflectionRunBusy(true);
    setReflectionRunStatus(null);
    const fakeNow = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
    const { data, error: rpcError } = await supabase.rpc('dev_run_follow_up_reflection_check', {
      p_connection_id: selectedConnectionId,
      p_now: fakeNow,
    });
    setReflectionRunBusy(false);
    if (rpcError) {
      setReflectionRunStatus(rpcError.message);
      return;
    }
    const result = data as string | null;
    setReflectionRunStatus(
      (result && REFLECTION_RESULT_MESSAGES[result]) || `Evaluator ran, unrecognized result: ${result}`
    );
  };

  // 2026-07-28 milestone redesign dev tools: backdates last_plan_activity_at
  // directly (dev_set_last_plan_activity), same simulated-time-offset
  // pattern the no-ghost section already established, so the elapsed-time
  // checkin can be exercised without waiting a real week.
  const handleBackdatePlanActivity = async () => {
    if (!selectedConnectionId) return;
    const hours = Number(planActivityHoursAgo);
    if (!Number.isFinite(hours)) {
      setCheckinDevStatus('Enter a number of hours, e.g. 170.');
      return;
    }
    setCheckinBusy('backdate');
    setCheckinDevStatus(null);
    const { error: rpcError } = await supabase.rpc('dev_set_last_plan_activity', {
      p_connection_id: selectedConnectionId,
      p_hours_ago: hours,
    });
    setCheckinBusy(null);
    setCheckinDevStatus(
      rpcError ? rpcError.message : `last_plan_activity_at backdated to ${hours} hours ago.`
    );
  };

  // Bug fix (2026-08-01): run_meetup_checkin_check used to return void, so
  // this status message claimed success unconditionally, even when the
  // evaluator silently no-op'd because the connection's status was
  // paused/inactive/passed, the exact reason a real user's repro of this
  // tool produced "nothing happened, no card, no error." The RPC now
  // returns a real outcome, shown here honestly instead of guessed at.
  const CHECKIN_RESULT_MESSAGES: Record<string, string> = {
    fired: 'Fired. A checkin row was created for both participants, open the thread as either to see it.',
    already_fired_this_cycle:
      'Nothing new happened: a checkin row already exists for this planning cycle. Use Reset checkins below, or record fresh plan activity, then try again.',
    not_enough_time_elapsed:
      'Nothing fired: less than 7 days have passed since the backdated last_plan_activity_at. Increase the hours-ago value above and backdate again.',
    connection_not_eligible:
      "Nothing fired: this connection's status is paused, inactive, or passed, the evaluator skips those on purpose (same guard the no-ghost scheduler uses). Use Reactivate this connection below, or pick a different thread.",
    no_activity_recorded:
      'Nothing fired: this connection has no last_plan_activity_at at all yet. Backdate it above first.',
    date_pending_confirmation:
      "Nothing fired: a meetup date has been proposed on this connection but not yet confirmed by the other participant, the elapsed-time fallback deliberately does not preempt a real, still-open proposal. Confirm or clear the date first, or pick a different thread.",
  };

  const handleRunCheckinEvaluator = async () => {
    if (!selectedConnectionId) return;
    setCheckinBusy('run');
    setCheckinDevStatus(null);
    const { data, error: rpcError } = await supabase.rpc('dev_run_meetup_checkin_check', {
      p_connection_id: selectedConnectionId,
      p_now: new Date().toISOString(),
    });
    setCheckinBusy(null);
    if (rpcError) {
      setCheckinDevStatus(rpcError.message);
      return;
    }
    const result = data as string | null;
    setCheckinDevStatus(
      (result && CHECKIN_RESULT_MESSAGES[result]) || `Evaluator ran, unrecognized result: ${result}`
    );
  };

  // Dev-only escape hatch: every currently selectable seed thread in this
  // project's own accumulated test data tends to end up inactive or
  // blocked, which made the checkin flow untestable end to end without
  // this. Refuses a blocked connection server-side (dev_reactivate_
  // connection_for_testing's own guard), Block is a real safety feature,
  // not something a dev convenience button should be able to undo.
  const handleReactivateConnection = async () => {
    if (!selectedConnectionId) return;
    setCheckinBusy('reactivate');
    setCheckinDevStatus(null);
    const { error: rpcError } = await supabase.rpc('dev_reactivate_connection_for_testing', {
      p_connection_id: selectedConnectionId,
    });
    setCheckinBusy(null);
    setCheckinDevStatus(
      rpcError ? rpcError.message : "Connection status set to active. It's now eligible for the checkin evaluator."
    );
    loadConversations();
  };

  const handleResetCheckins = async () => {
    if (!selectedConnectionId) return;
    setCheckinBusy('reset');
    setCheckinDevStatus(null);
    const { error: rpcError } = await supabase.rpc('dev_reset_meetup_checkins', {
      p_connection_id: selectedConnectionId,
    });
    setCheckinBusy(null);
    setCheckinDevStatus(rpcError ? rpcError.message : 'Checkin rows cleared for this connection.');
  };

  // ---- Time Travel panel ----
  // Message/meetup capabilities below operate on the selected connection
  // above (same picker No-ghost testing already uses). User-level
  // capabilities (coach marks, friendship_experience, disclosed_at, AI
  // caps, premium pool) operate on the currently signed-in account,
  // matching this file's own established convention (dev_reset_my_matches,
  // the F19 triggers) rather than adding a new cross-account reach.

  const handleBackdateLastMessage = async () => {
    if (!selectedConnectionId) return;
    const hours = Number(ttBackdateHours);
    if (!Number.isFinite(hours)) {
      setTtStatus('Enter a number of hours, e.g. 48.');
      return;
    }
    setTtBusy('backdate-last-message');
    setTtStatus(null);
    const { data, error: rpcError } = await supabase.rpc('dev_backdate_last_message', {
      p_connection_id: selectedConnectionId,
      p_hours_ago: hours,
    });
    setTtBusy(null);
    if (rpcError) {
      setTtStatus(rpcError.message);
      return;
    }
    if (!data?.found) {
      setTtStatus('This connection has no messages yet, nothing to backdate.');
      return;
    }
    setTtStatus(
      `Before: ${new Date(data.old_created_at).toLocaleString()} → After: ${new Date(data.new_created_at).toLocaleString()}. Reload the thread to see it.`
    );
  };

  const handleSendBackdatedMessage = async () => {
    if (!selectedConnectionId || !ttNewMsgSenderId) {
      setTtStatus('Select a connection and a sender first.');
      return;
    }
    const content = ttNewMsgText.trim();
    if (!content) {
      setTtStatus('Enter some message text first.');
      return;
    }
    const hours = Number(ttNewMsgHoursAgo);
    if (!Number.isFinite(hours)) {
      setTtStatus('Enter a number of hours, e.g. 24.');
      return;
    }
    setTtBusy('send-message');
    setTtStatus(null);
    const { data, error: rpcError } = await supabase.rpc('dev_send_backdated_message', {
      p_connection_id: selectedConnectionId,
      p_sender_id: ttNewMsgSenderId,
      p_content: content,
      p_hours_ago: hours,
    });
    setTtBusy(null);
    setTtStatus(
      rpcError
        ? rpcError.message
        : `Sent. created_at set to ${new Date(data.created_at).toLocaleString()}. Reload the thread to see it. Note: this bypasses the real send-time gates (photo requirement, messaging_preference, blocked/inactive/ended), it's for seeding test data, not exercising those checks.`
    );
  };

  const handleSetNextMeetup = async () => {
    if (!selectedConnectionId) return;
    setTtBusy('set-next-meetup');
    setTtStatus(null);
    const { data, error: rpcError } = await supabase.rpc('dev_set_next_meetup', {
      p_connection_id: selectedConnectionId,
      p_date: ttMeetupDate.trim() || null,
      p_status: ttMeetupStatus,
      p_proposed_by: ttMeetupProposedBy,
    });
    setTtBusy(null);
    setTtStatus(
      rpcError
        ? rpcError.message
        : `Before: ${JSON.stringify(data.old)} → After: ${JSON.stringify(data.new)}. Reload the thread to see it.`
    );
  };

  const handleBackdateDisclosedAt = async () => {
    const hours = Number(ttDisclosedHoursAgo);
    if (!Number.isFinite(hours)) {
      setTtStatus('Enter a number of hours, e.g. 192 (8 days).');
      return;
    }
    setTtBusy('disclosed-at');
    setTtStatus(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setTtBusy(null);
      setTtStatus('Sign in as a seed account first.');
      return;
    }
    const newValue = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const { error: updateError } = await supabase
      .from('users')
      .update({ behavioral_tracking_disclosed_at: newValue })
      .eq('id', user.id);
    setTtBusy(null);
    setTtStatus(
      updateError
        ? updateError.message
        : `behavioral_tracking_disclosed_at set to ${new Date(newValue).toLocaleString()} for the signed-in account. This feeds the friendship-experience prompt's 7-day no-message backstop, reload Discover to see it.`
    );
  };

  const handleResetAllCoachMarks = async () => {
    setTtBusy('reset-all-marks');
    setTtStatus(null);
    await resetCoachMarks();
    setTtBusy(null);
    setTtStatus('All coach marks cleared for the signed-in account. Reload any tab to see its tip again.');
  };

  const handleResetOneCoachMark = async () => {
    setTtBusy('reset-one-mark');
    setTtStatus(null);
    await resetCoachMark(ttSpecificMark);
    setTtBusy(null);
    setTtStatus(`"${ttSpecificMark}" cleared for the signed-in account. Reload the relevant screen to see it again.`);
  };

  const handleResetFriendshipExperience = async () => {
    setTtBusy('reset-experience');
    setTtStatus(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setTtBusy(null);
      setTtStatus('Sign in as a seed account first.');
      return;
    }
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ friendship_experience: null })
      .eq('user_id', user.id);
    setTtBusy(null);
    setTtStatus(
      updateError
        ? updateError.message
        : 'friendship_experience cleared for the signed-in account. The AI reflection will fall back to pending copy for "What has helped"/"When uncertain" until answered again.'
    );
  };

  const handleResetAiCap = async (mode: 'clear' | 'backdate') => {
    setTtBusy(`ai-cap-${mode}`);
    setTtStatus(null);
    const hours = mode === 'backdate' ? Number(ttCapHoursAgo) : null;
    if (mode === 'backdate' && !Number.isFinite(hours)) {
      setTtBusy(null);
      setTtStatus('Enter a number of hours to backdate by, e.g. 200.');
      return;
    }
    const { data, error: rpcError } = await supabase.rpc('dev_reset_ai_usage', {
      p_function_name: ttCapFunction,
      p_hours_ago: mode === 'backdate' ? hours : null,
    });
    setTtBusy(null);
    setTtStatus(
      rpcError
        ? rpcError.message
        : `${data.mode === 'cleared' ? 'Cleared' : 'Backdated'} ${data.rows_affected} usage row(s) for ${ttCapFunction} on the signed-in account.`
    );
  };

  const handleResetPremiumPool = async () => {
    const hours = Number(ttPoolHoursAgo);
    const spent = Number(ttPoolSpent);
    if (!Number.isFinite(hours) || !Number.isFinite(spent)) {
      setTtStatus('Enter valid numbers for both hours-ago and spent ($).');
      return;
    }
    setTtBusy('premium-pool');
    setTtStatus(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setTtBusy(null);
      setTtStatus('Sign in as a seed account first.');
      return;
    }
    const newPeriodStart = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const { error: updateError } = await supabase
      .from('users')
      .update({ premium_pool_period_start: newPeriodStart, premium_pool_spent_usd: spent })
      .eq('id', user.id);
    setTtBusy(null);
    setTtStatus(
      updateError
        ? updateError.message
        : `premium_pool_period_start set to ${new Date(newPeriodStart).toLocaleString()}, premium_pool_spent_usd set to $${spent.toFixed(2)}. Only affects a premium account; the pool is otherwise unread for free-tier accounts.`
    );
  };

  return (
    <View className="flex-1 bg-stone-50 dark:bg-stone-900">
      <SafeAreaView className="flex-1">
        <ScrollView contentContainerClassName="gap-4 px-6 pb-10 pt-10">
          <View className="gap-2">
            <Text className="text-display text-stone-900 dark:text-stone-50">Dev</Text>
            <Text className="text-body text-stone-500 dark:text-stone-400">
              Sign in as a seed test account. Requires
              supabase/seed/seed-dev-passwords.sql to have been run in Studio first.
            </Text>
          </View>

          {error && <Text className="text-caption text-red-600 dark:text-red-400">{error}</Text>}

          <View className="gap-2">
            {DEV_SEED_USERS.map((u) => (
              <Pressable
                key={u.phone}
                onPress={() => handleSwitch(u.phone)}
                disabled={signingInAs === u.phone}
                className="rounded-2xl border border-stone-200 bg-white p-4 active:opacity-70 dark:border-stone-700 dark:bg-stone-800">
                <Text className="text-body text-stone-900 dark:text-stone-50">
                  {signingInAs === u.phone ? 'Signing in...' : u.displayName}
                </Text>
              </Pressable>
            ))}
          </View>

          <View className="gap-2 border-t border-stone-200 pt-6 dark:border-stone-800">
            <Text className="text-title text-stone-900 dark:text-stone-50">Match testing</Text>
            <Text className="text-caption text-stone-500 dark:text-stone-400">
              Deletes all connections, messages, and match suggestions for the currently
              signed-in account.
            </Text>
            <Pressable
              onPress={handleResetMyMatches}
              disabled={resettingMatches}
              className="self-start rounded-full border border-red-300 px-4 py-2 dark:border-red-800">
              <Text className="text-caption font-semibold text-red-600 dark:text-red-400">
                {resettingMatches ? 'Resetting...' : 'Reset my matches'}
              </Text>
            </Pressable>
            {resetMatchesStatus && (
              <Text className="text-caption text-stone-500 dark:text-stone-400">
                {resetMatchesStatus}
              </Text>
            )}
          </View>

          <View className="gap-3 border-t border-stone-200 pt-6 dark:border-stone-800">
            <View className="gap-1">
              <Text className="text-title text-stone-900 dark:text-stone-50">
                No-ghost testing
              </Text>
              <Text className="text-caption text-stone-500 dark:text-stone-400">
                Requires being signed in as one of the two people in the selected thread (use the
                switcher above). The two &quot;Preview sender reassurance&quot; buttons backdate
                the last message and create no row, open the thread as the sender to see the line.
                R1/R2/R3/S1 each force-fire a real prompt row.
              </Text>
            </View>

            {conversations.length === 0 ? (
              <Text className="text-caption text-stone-400 dark:text-stone-600">
                No active conversations for the signed-in account yet.
              </Text>
            ) : (
              <View className="gap-2">
                {conversations.map((c) => (
                  <Pressable
                    key={c.connection_id}
                    onPress={() => handleSelectConnection(c.connection_id)}
                    className={`rounded-xl border px-4 py-3 ${
                      selectedConnectionId === c.connection_id
                        ? 'border-accent-500 bg-accent-500/10'
                        : 'border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-800'
                    }`}>
                    <Text className="text-body text-stone-900 dark:text-stone-50">
                      {c.display_name ?? 'A member'}
                      {c.connection_status ? ` (${c.connection_status})` : ''}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}

            {selectedConnectionId && (
              <View className="gap-3">
                <View className="gap-2">
                  {NO_GHOST_TRIGGERS.map((t) => (
                    <Pressable
                      key={t.key}
                      onPress={() =>
                        t.kind === 'prompt'
                          ? handleTriggerPrompt(t.triggerId, t.key)
                          : handleStatusPreview(t.hoursAgo, t.key)
                      }
                      disabled={noGhostBusy === t.key}
                      className="rounded-full border border-stone-300 px-4 py-2 dark:border-stone-700">
                      <Text className="text-caption font-semibold text-stone-700 dark:text-stone-300">
                        {noGhostBusy === t.key ? 'Triggering...' : t.label}
                      </Text>
                    </Pressable>
                  ))}
                  <Pressable
                    onPress={handleReset}
                    disabled={noGhostBusy === 'reset'}
                    className="rounded-full border border-red-300 px-4 py-2 dark:border-red-800">
                    <Text className="text-caption font-semibold text-red-600 dark:text-red-400">
                      {noGhostBusy === 'reset' ? 'Resetting...' : 'Reset all no-ghost state'}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={handlePauseConnection}
                    disabled={noGhostBusy === 'pause'}
                    className="rounded-full border border-stone-300 px-4 py-2 dark:border-stone-700">
                    <Text className="text-caption font-semibold text-stone-700 dark:text-stone-300">
                      {noGhostBusy === 'pause' ? 'Pausing...' : 'Pause this connection'}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={handleResumeConnection}
                    disabled={noGhostBusy === 'resume'}
                    className="rounded-full border border-stone-300 px-4 py-2 dark:border-stone-700">
                    <Text className="text-caption font-semibold text-stone-700 dark:text-stone-300">
                      {noGhostBusy === 'resume' ? 'Resuming...' : 'Resume this connection'}
                    </Text>
                  </Pressable>
                </View>

                <View className="gap-2 rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
                  <Text className="text-caption text-stone-500 dark:text-stone-400">
                    Time offset override (hours from now, e.g. 50)
                  </Text>
                  <View className="flex-row items-center gap-2">
                    <TextInput
                      value={hoursOffset}
                      onChangeText={setHoursOffset}
                      keyboardType="numeric"
                      className="w-24 rounded-lg border border-stone-300 px-3 py-2 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
                    />
                    <Pressable
                      onPress={handleRunWithOffset}
                      disabled={noGhostBusy === 'offset'}
                      className="rounded-full bg-stone-900 px-4 py-2 active:opacity-80 dark:bg-stone-50">
                      <Text className="text-caption font-semibold text-stone-50 dark:text-stone-900">
                        {noGhostBusy === 'offset' ? 'Running...' : 'Run scheduler with offset'}
                      </Text>
                    </Pressable>
                  </View>
                </View>

                {noGhostStatus && (
                  <Text className="text-caption text-stone-500 dark:text-stone-400">
                    {noGhostStatus}
                  </Text>
                )}
              </View>
            )}
          </View>

          <View className="gap-3 border-t border-stone-200 pt-6 dark:border-stone-800">
            <View className="gap-1">
              <Text className="text-title text-stone-900 dark:text-stone-50">
                F19 follow-up reflection testing
              </Text>
              <Text className="text-caption text-stone-500 dark:text-stone-400">
                Uses the same selected thread above. Fires for the signed-in account only.
              </Text>
            </View>
            {selectedConnectionId ? (
              <View className="gap-2">
                <Pressable
                  onPress={handleTriggerReflection}
                  disabled={reflectionBusy === 'trigger'}
                  className="rounded-full border border-stone-300 px-4 py-2 dark:border-stone-700">
                  <Text className="text-caption font-semibold text-stone-700 dark:text-stone-300">
                    {reflectionBusy === 'trigger' ? 'Triggering...' : 'Trigger follow-up reflection'}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={handleResetReflection}
                  disabled={reflectionBusy === 'reset'}
                  className="rounded-full border border-red-300 px-4 py-2 dark:border-red-800">
                  <Text className="text-caption font-semibold text-red-600 dark:text-red-400">
                    {reflectionBusy === 'reset' ? 'Resetting...' : 'Reset reflection state'}
                  </Text>
                </Pressable>
                {reflectionStatus && (
                  <Text className="text-caption text-stone-500 dark:text-stone-400">{reflectionStatus}</Text>
                )}
                <View className="gap-2 rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
                  <Text className="text-caption text-stone-500 dark:text-stone-400">
                    Run the real evaluator (requires 24hr+ since the last message, and a genuine
                    two-sided exchange), as if this many hours from now had passed
                  </Text>
                  <View className="flex-row items-center gap-2">
                    <TextInput
                      value={reflectionOffsetHours}
                      onChangeText={setReflectionOffsetHours}
                      keyboardType="numeric"
                      className="w-24 rounded-lg border border-stone-300 px-3 py-2 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
                    />
                    <Pressable
                      onPress={handleRunReflectionEvaluator}
                      disabled={reflectionRunBusy}
                      className="rounded-full bg-stone-900 px-4 py-2 active:opacity-80 dark:bg-stone-50">
                      <Text className="text-caption font-semibold text-stone-50 dark:text-stone-900">
                        {reflectionRunBusy ? 'Running...' : 'Run evaluator now'}
                      </Text>
                    </Pressable>
                  </View>
                  {reflectionRunStatus && (
                    <Text className="text-caption text-stone-500 dark:text-stone-400">{reflectionRunStatus}</Text>
                  )}
                </View>
              </View>
            ) : (
              <Text className="text-caption text-stone-400 dark:text-stone-600">
                Select a conversation above first.
              </Text>
            )}
          </View>

          <View className="gap-3 border-t border-stone-200 pt-6 dark:border-stone-800">
            <View className="gap-1">
              <Text className="text-title text-stone-900 dark:text-stone-50">
                Meetup milestone testing
              </Text>
              <Text className="text-caption text-stone-500 dark:text-stone-400">
                Uses the same selected thread above. Backdate last_plan_activity_at (default 170,
                just past the real 7-day/168hr threshold), then run the checkin evaluator to fire a
                real row for both participants without waiting a real week. The evaluator only
                fires for a connection whose status is not paused, inactive, or passed, the status
                shown next to each thread above tells you upfront whether it qualifies, and Run
                checkin evaluator now will say exactly why nothing happened if it doesn't.
              </Text>
            </View>
            {selectedConnectionId ? (
              <View className="gap-2">
                <View className="gap-2 rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
                  <Text className="text-caption text-stone-500 dark:text-stone-400">
                    Hours ago to backdate last_plan_activity_at
                  </Text>
                  <View className="flex-row items-center gap-2">
                    <TextInput
                      value={planActivityHoursAgo}
                      onChangeText={setPlanActivityHoursAgo}
                      keyboardType="numeric"
                      className="w-24 rounded-lg border border-stone-300 px-3 py-2 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
                    />
                    <Pressable
                      onPress={handleBackdatePlanActivity}
                      disabled={checkinBusy === 'backdate'}
                      className="rounded-full bg-stone-900 px-4 py-2 active:opacity-80 dark:bg-stone-50">
                      <Text className="text-caption font-semibold text-stone-50 dark:text-stone-900">
                        {checkinBusy === 'backdate' ? 'Backdating...' : 'Backdate'}
                      </Text>
                    </Pressable>
                  </View>
                </View>
                <Pressable
                  onPress={handleRunCheckinEvaluator}
                  disabled={checkinBusy === 'run'}
                  className="rounded-full border border-stone-300 px-4 py-2 dark:border-stone-700">
                  <Text className="text-caption font-semibold text-stone-700 dark:text-stone-300">
                    {checkinBusy === 'run' ? 'Running...' : 'Run checkin evaluator now'}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={handleReactivateConnection}
                  disabled={checkinBusy === 'reactivate'}
                  className="rounded-full border border-stone-300 px-4 py-2 dark:border-stone-700">
                  <Text className="text-caption font-semibold text-stone-700 dark:text-stone-300">
                    {checkinBusy === 'reactivate' ? 'Reactivating...' : 'Reactivate this connection (set status to active)'}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={handleResetCheckins}
                  disabled={checkinBusy === 'reset'}
                  className="rounded-full border border-red-300 px-4 py-2 dark:border-red-800">
                  <Text className="text-caption font-semibold text-red-600 dark:text-red-400">
                    {checkinBusy === 'reset' ? 'Resetting...' : 'Reset checkin state'}
                  </Text>
                </Pressable>
                {checkinDevStatus && (
                  <Text className="text-caption text-stone-500 dark:text-stone-400">{checkinDevStatus}</Text>
                )}
              </View>
            ) : (
              <Text className="text-caption text-stone-400 dark:text-stone-600">
                Select a conversation above first.
              </Text>
            )}
          </View>

          <View className="gap-3 border-t border-stone-200 pt-6 dark:border-stone-800">
            <View className="gap-1">
              <Text className="text-title text-stone-900 dark:text-stone-50">Time Travel</Text>
              <Text className="text-caption text-stone-500 dark:text-stone-400">
                Trigger and verify time-based features directly, without a new session each time.
                Message/meetup tools below use the same connection selected under No-ghost testing
                above. Already covered elsewhere, not duplicated here: backdating
                last_plan_activity_at (Meetup milestone testing above), and running the no-ghost /
                meetup-checkin evaluators with a simulated time offset (their own sections above).
                The follow-up-reflection evaluator&apos;s own &quot;Run evaluator now&quot; is in the
                F19 section above too. User-level tools below (coach marks, friendship experience,
                disclosed-at, AI caps, premium pool) act on whichever account is currently signed in.
              </Text>
            </View>

            {ttStatus && (
              <View className="rounded-xl border border-accent-500/40 bg-accent-500/5 p-3">
                <Text className="text-caption text-stone-700 dark:text-stone-300">{ttStatus}</Text>
              </View>
            )}

            <View className="gap-2 rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
              <Text className="text-caption font-semibold text-stone-700 dark:text-stone-300">
                Backdate most recent message
              </Text>
              {selectedConnectionId ? (
                <View className="flex-row items-center gap-2">
                  <TextInput
                    value={ttBackdateHours}
                    onChangeText={setTtBackdateHours}
                    keyboardType="numeric"
                    className="w-24 rounded-lg border border-stone-300 px-3 py-2 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
                  />
                  <Pressable
                    onPress={handleBackdateLastMessage}
                    disabled={ttBusy === 'backdate-last-message'}
                    className="rounded-full bg-stone-900 px-4 py-2 active:opacity-80 dark:bg-stone-50">
                    <Text className="text-caption font-semibold text-stone-50 dark:text-stone-900">
                      {ttBusy === 'backdate-last-message' ? 'Backdating...' : 'Backdate (hours ago)'}
                    </Text>
                  </Pressable>
                </View>
              ) : (
                <Text className="text-caption text-stone-400 dark:text-stone-600">
                  Select a conversation above first.
                </Text>
              )}
            </View>

            <View className="gap-2 rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
              <Text className="text-caption font-semibold text-stone-700 dark:text-stone-300">
                Send a new message, any sender, backdated
              </Text>
              {selectedConnectionId && connectionInfo ? (
                <View className="gap-2">
                  <View className="flex-row gap-2">
                    <Pressable
                      onPress={() => setTtNewMsgSenderId(connectionInfo.user_a_id)}
                      className={`rounded-full border px-3 py-2 ${
                        ttNewMsgSenderId === connectionInfo.user_a_id
                          ? 'border-accent-500 bg-accent-500/10'
                          : 'border-stone-300 dark:border-stone-700'
                      }`}>
                      <Text className="text-caption text-stone-700 dark:text-stone-300">
                        Sender: user A ({connectionInfo.user_a_id.slice(0, 8)})
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setTtNewMsgSenderId(connectionInfo.user_b_id)}
                      className={`rounded-full border px-3 py-2 ${
                        ttNewMsgSenderId === connectionInfo.user_b_id
                          ? 'border-accent-500 bg-accent-500/10'
                          : 'border-stone-300 dark:border-stone-700'
                      }`}>
                      <Text className="text-caption text-stone-700 dark:text-stone-300">
                        Sender: user B ({connectionInfo.user_b_id.slice(0, 8)})
                      </Text>
                    </Pressable>
                  </View>
                  <TextInput
                    value={ttNewMsgText}
                    onChangeText={setTtNewMsgText}
                    placeholder="Message text"
                    placeholderTextColor={MUTED_ICON_COLOR}
                    multiline
                    className="rounded-lg border border-stone-300 px-3 py-2 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
                  />
                  <View className="flex-row items-center gap-2">
                    <Text className="text-caption text-stone-500 dark:text-stone-400">Hours ago</Text>
                    <TextInput
                      value={ttNewMsgHoursAgo}
                      onChangeText={setTtNewMsgHoursAgo}
                      keyboardType="numeric"
                      className="w-24 rounded-lg border border-stone-300 px-3 py-2 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
                    />
                    <Pressable
                      onPress={handleSendBackdatedMessage}
                      disabled={ttBusy === 'send-message'}
                      className="rounded-full bg-stone-900 px-4 py-2 active:opacity-80 dark:bg-stone-50">
                      <Text className="text-caption font-semibold text-stone-50 dark:text-stone-900">
                        {ttBusy === 'send-message' ? 'Sending...' : 'Send'}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <Text className="text-caption text-stone-400 dark:text-stone-600">
                  Select a conversation above first.
                </Text>
              )}
            </View>

            <View className="gap-2 rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
              <Text className="text-caption font-semibold text-stone-700 dark:text-stone-300">
                Set next-meetup date / status / proposed-by directly
              </Text>
              {selectedConnectionId && connectionInfo ? (
                <View className="gap-2">
                  <TextInput
                    value={ttMeetupDate}
                    onChangeText={setTtMeetupDate}
                    placeholder="YYYY-MM-DD (blank to clear)"
                    placeholderTextColor={MUTED_ICON_COLOR}
                    className="rounded-lg border border-stone-300 px-3 py-2 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
                  />
                  <View className="flex-row flex-wrap gap-2">
                    {(['proposed', 'confirmed', null] as const).map((s) => (
                      <Pressable
                        key={s ?? 'none'}
                        onPress={() => setTtMeetupStatus(s)}
                        className={`rounded-full border px-3 py-2 ${
                          ttMeetupStatus === s
                            ? 'border-accent-500 bg-accent-500/10'
                            : 'border-stone-300 dark:border-stone-700'
                        }`}>
                        <Text className="text-caption text-stone-700 dark:text-stone-300">
                          Status: {s ?? 'none (clear)'}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <View className="flex-row flex-wrap gap-2">
                    {([connectionInfo.user_a_id, connectionInfo.user_b_id, null] as const).map((id) => (
                      <Pressable
                        key={id ?? 'none'}
                        onPress={() => setTtMeetupProposedBy(id)}
                        className={`rounded-full border px-3 py-2 ${
                          ttMeetupProposedBy === id
                            ? 'border-accent-500 bg-accent-500/10'
                            : 'border-stone-300 dark:border-stone-700'
                        }`}>
                        <Text className="text-caption text-stone-700 dark:text-stone-300">
                          Proposed by: {id ? `${id === connectionInfo.user_a_id ? 'A' : 'B'} (${id.slice(0, 8)})` : 'none'}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <Pressable
                    onPress={handleSetNextMeetup}
                    disabled={ttBusy === 'set-next-meetup'}
                    className="self-start rounded-full bg-stone-900 px-4 py-2 active:opacity-80 dark:bg-stone-50">
                    <Text className="text-caption font-semibold text-stone-50 dark:text-stone-900">
                      {ttBusy === 'set-next-meetup' ? 'Applying...' : 'Apply'}
                    </Text>
                  </Pressable>
                </View>
              ) : (
                <Text className="text-caption text-stone-400 dark:text-stone-600">
                  Select a conversation above first.
                </Text>
              )}
            </View>

            <View className="gap-2 rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
              <Text className="text-caption font-semibold text-stone-700 dark:text-stone-300">
                Backdate behavioral_tracking_disclosed_at (signed-in account)
              </Text>
              <View className="flex-row items-center gap-2">
                <TextInput
                  value={ttDisclosedHoursAgo}
                  onChangeText={setTtDisclosedHoursAgo}
                  keyboardType="numeric"
                  className="w-24 rounded-lg border border-stone-300 px-3 py-2 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
                />
                <Pressable
                  onPress={handleBackdateDisclosedAt}
                  disabled={ttBusy === 'disclosed-at'}
                  className="rounded-full bg-stone-900 px-4 py-2 active:opacity-80 dark:bg-stone-50">
                  <Text className="text-caption font-semibold text-stone-50 dark:text-stone-900">
                    {ttBusy === 'disclosed-at' ? 'Backdating...' : 'Backdate (hours ago)'}
                  </Text>
                </Pressable>
              </View>
            </View>

            <View className="gap-2 rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
              <Text className="text-caption font-semibold text-stone-700 dark:text-stone-300">
                Reset coach marks (signed-in account)
              </Text>
              <Pressable
                onPress={handleResetAllCoachMarks}
                disabled={ttBusy === 'reset-all-marks'}
                className="self-start rounded-full border border-red-300 px-4 py-2 dark:border-red-800">
                <Text className="text-caption font-semibold text-red-600 dark:text-red-400">
                  {ttBusy === 'reset-all-marks' ? 'Resetting...' : 'Reset all marks'}
                </Text>
              </Pressable>
              <View className="flex-row flex-wrap gap-2">
                {ALL_COACH_MARK_KEYS.map((k) => (
                  <Pressable
                    key={k}
                    onPress={() => setTtSpecificMark(k)}
                    className={`rounded-full border px-3 py-2 ${
                      ttSpecificMark === k
                        ? 'border-accent-500 bg-accent-500/10'
                        : 'border-stone-300 dark:border-stone-700'
                    }`}>
                    <Text className="text-caption text-stone-700 dark:text-stone-300">{k}</Text>
                  </Pressable>
                ))}
              </View>
              <Pressable
                onPress={handleResetOneCoachMark}
                disabled={ttBusy === 'reset-one-mark'}
                className="self-start rounded-full border border-stone-300 px-4 py-2 dark:border-stone-700">
                <Text className="text-caption font-semibold text-stone-700 dark:text-stone-300">
                  {ttBusy === 'reset-one-mark' ? 'Resetting...' : `Reset just "${ttSpecificMark}"`}
                </Text>
              </Pressable>
            </View>

            <View className="gap-2 rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
              <Text className="text-caption font-semibold text-stone-700 dark:text-stone-300">
                Reset friendship_experience (signed-in account)
              </Text>
              <Pressable
                onPress={handleResetFriendshipExperience}
                disabled={ttBusy === 'reset-experience'}
                className="self-start rounded-full border border-red-300 px-4 py-2 dark:border-red-800">
                <Text className="text-caption font-semibold text-red-600 dark:text-red-400">
                  {ttBusy === 'reset-experience' ? 'Resetting...' : 'Clear friendship_experience'}
                </Text>
              </Pressable>
            </View>

            <View className="gap-2 rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
              <Text className="text-caption font-semibold text-stone-700 dark:text-stone-300">
                Reset/backdate an AI usage cap (signed-in account)
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {AI_CAPPED_FUNCTIONS.map((fn) => (
                  <Pressable
                    key={fn}
                    onPress={() => setTtCapFunction(fn)}
                    className={`rounded-full border px-3 py-2 ${
                      ttCapFunction === fn
                        ? 'border-accent-500 bg-accent-500/10'
                        : 'border-stone-300 dark:border-stone-700'
                    }`}>
                    <Text className="text-caption text-stone-700 dark:text-stone-300">{fn}</Text>
                  </Pressable>
                ))}
              </View>
              <Pressable
                onPress={() => handleResetAiCap('clear')}
                disabled={ttBusy === 'ai-cap-clear'}
                className="self-start rounded-full border border-red-300 px-4 py-2 dark:border-red-800">
                <Text className="text-caption font-semibold text-red-600 dark:text-red-400">
                  {ttBusy === 'ai-cap-clear' ? 'Clearing...' : `Clear all usage for ${ttCapFunction}`}
                </Text>
              </Pressable>
              <View className="flex-row items-center gap-2">
                <Text className="text-caption text-stone-500 dark:text-stone-400">
                  Or backdate existing usage by (hours)
                </Text>
                <TextInput
                  value={ttCapHoursAgo}
                  onChangeText={setTtCapHoursAgo}
                  keyboardType="numeric"
                  placeholder="e.g. 200"
                  placeholderTextColor={MUTED_ICON_COLOR}
                  className="w-24 rounded-lg border border-stone-300 px-3 py-2 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
                />
                <Pressable
                  onPress={() => handleResetAiCap('backdate')}
                  disabled={ttBusy === 'ai-cap-backdate'}
                  className="rounded-full bg-stone-900 px-4 py-2 active:opacity-80 dark:bg-stone-50">
                  <Text className="text-caption font-semibold text-stone-50 dark:text-stone-900">
                    {ttBusy === 'ai-cap-backdate' ? 'Backdating...' : 'Backdate'}
                  </Text>
                </Pressable>
              </View>
            </View>

            <View className="gap-2 rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
              <Text className="text-caption font-semibold text-stone-700 dark:text-stone-300">
                Reset/backdate premium pool (signed-in account)
              </Text>
              <View className="flex-row items-center gap-2">
                <Text className="text-caption text-stone-500 dark:text-stone-400">Period start, hours ago</Text>
                <TextInput
                  value={ttPoolHoursAgo}
                  onChangeText={setTtPoolHoursAgo}
                  keyboardType="numeric"
                  className="w-20 rounded-lg border border-stone-300 px-3 py-2 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
                />
              </View>
              <View className="flex-row items-center gap-2">
                <Text className="text-caption text-stone-500 dark:text-stone-400">Spent so far ($)</Text>
                <TextInput
                  value={ttPoolSpent}
                  onChangeText={setTtPoolSpent}
                  keyboardType="numeric"
                  className="w-20 rounded-lg border border-stone-300 px-3 py-2 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
                />
                <Pressable
                  onPress={handleResetPremiumPool}
                  disabled={ttBusy === 'premium-pool'}
                  className="rounded-full bg-stone-900 px-4 py-2 active:opacity-80 dark:bg-stone-50">
                  <Text className="text-caption font-semibold text-stone-50 dark:text-stone-900">
                    {ttBusy === 'premium-pool' ? 'Applying...' : 'Apply'}
                  </Text>
                </Pressable>
              </View>
              <Text className="text-caption text-stone-400 dark:text-stone-600">
                Set spent to 0 with any period-start to simulate a fresh pool, or a value ≥ $3.00 to
                simulate an exhausted one. Only has an effect for a premium account.
              </Text>
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
