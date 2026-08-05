import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DEV_SEED_USERS, devSignInAs } from '@/lib/dev-tools';
import { type NoGhostTriggerId } from '@/lib/no-ghost';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

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
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
