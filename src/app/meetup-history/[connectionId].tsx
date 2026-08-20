import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  fetchMeetupHistory,
  proposeMeetupDateResolution,
  type MeetupHistoryEntry,
} from '@/lib/friendship-journey';
import { supabase } from '@/lib/supabase';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400

// Friendship Journey rebuild — the new meetup-history screen (design doc §5,
// "User-facing meetup-history view"). __DEV__-gated at the link site in
// thread/[id].tsx, same class of gating as the new intervention card: the
// route exists and is real, tested code, but nothing in production wires a
// visible path to it yet.
//
// Reads only the reconciled, factual meetup_history view — never
// meetup_occurrence_reports.reported_date (each participant's individual,
// possibly-differing claim, the private pre-reconciliation layer) and never
// anything from private_post_meetup_reflections. Private emotional
// reflections about any given meetup stay completely separate from this
// screen, structurally, not just by choice of what it happens to query.
function formatDisplayDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

export default function MeetupHistoryScreen() {
  const { connectionId } = useLocalSearchParams<{ connectionId: string }>();
  const [entries, setEntries] = useState<MeetupHistoryEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!connectionId) return;
    setEntries(await fetchMeetupHistory(connectionId));
    setLoaded(true);
  }, [connectionId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  return (
    <SafeAreaView className="flex-1 bg-stone-50 dark:bg-stone-900">
      <View className="flex-row items-center justify-between border-b border-stone-200 px-6 pb-4 pt-4 dark:border-stone-800">
        <Pressable onPress={() => router.back()}>
          <Text className="text-caption text-stone-500 dark:text-stone-400">Back</Text>
        </Pressable>
        <Text className="text-title text-stone-900 dark:text-stone-50">Meetup history</Text>
        <View style={{ width: 40 }} />
      </View>

      {!loaded ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={MUTED_ICON_COLOR} />
        </View>
      ) : entries.length === 0 ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-center text-body text-stone-400 dark:text-stone-600">
            No confirmed meetups yet. Once you both agree a meetup happened, it'll show up here.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerClassName="gap-3 px-6 py-5">
          {entries.map((entry) => (
            <MeetupHistoryRow key={entry.sequence_number} entry={entry} connectionId={connectionId} onChanged={load} />
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function MeetupHistoryRow({
  entry,
  connectionId,
  onChanged,
}: {
  entry: MeetupHistoryEntry;
  connectionId: string;
  onChanged: () => void;
}) {
  const [reconciling, setReconciling] = useState(false);
  const [date, setDate] = useState('');
  const [pendingResolutionId, setPendingResolutionId] = useState<string | null>(null);

  // Reconciliation UI is deliberately available on any occurred entry, not
  // just disputed ones — design doc §5 case 5, a confirmed date can still
  // need a later correction, using the exact same mutual-approval mechanism
  // as the initial dispute (case 2). We don't distinguish "propose" vs
  // "correct" in the UI; the RPC itself derives which one this is from the
  // meetup's current date_status.
  const propose = async () => {
    if (!date) return;
    const meetupId = await entryMeetupId(entry, connectionId);
    const id = await proposeMeetupDateResolution(meetupId, date);
    setPendingResolutionId(id);
  };

  return (
    <View className="gap-2 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
      <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">Meetup {entry.sequence_number}</Text>
      {entry.date_status === 'disputed' ? (
        <>
          <Text className="text-body text-stone-700 dark:text-stone-300">Met — date unconfirmed</Text>
          <Text className="text-caption text-stone-400 dark:text-stone-600">
            You both agree this meetup happened, but the exact date needs a little reconciling.
          </Text>
        </>
      ) : (
        <Text className="text-body text-stone-700 dark:text-stone-300">
          {entry.occurred_date ? formatDisplayDate(entry.occurred_date) : 'Date not set'}
        </Text>
      )}

      {!reconciling ? (
        <Pressable onPress={() => setReconciling(true)} className="self-start">
          <Text className="text-caption font-semibold text-accent-500">
            {entry.date_status === 'disputed' ? 'Help pin down the date' : 'This date looks wrong'}
          </Text>
        </Pressable>
      ) : (
        <View className="gap-2">
          <TextInput
            value={date}
            onChangeText={setDate}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={MUTED_ICON_COLOR}
            className="rounded-xl border border-stone-300 px-3 py-2 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
          />
          <View className="flex-row gap-2">
            <Pressable onPress={propose} disabled={!date} className="rounded-full bg-stone-900 px-4 py-2 dark:bg-stone-50">
              <Text className="text-caption font-semibold text-stone-50 dark:text-stone-900">Suggest this date</Text>
            </Pressable>
            <Pressable onPress={() => setReconciling(false)}>
              <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">Cancel</Text>
            </Pressable>
          </View>
          {pendingResolutionId && (
            <View className="gap-2 rounded-xl border border-accent-500/40 bg-accent-500/5 p-3">
              <Text className="text-caption text-stone-600 dark:text-stone-400">
                Suggested. The other participant needs to approve it before it's final — one person can never
                change shared history alone. (The approval RPC correctly refuses the proposer's own account —
                exercise it by switching to the other real test account via the Dev tab, not from here.)
              </Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

// meetup_history intentionally doesn't expose the meetup's own id (it's a
// view over reconciled, participant-safe columns only, per the design's own
// "shows only reconciled, factual data" rule) — the reconciliation actions
// need the real id, so this does one small lookup by (connection_id,
// sequence_number), the same pair the view is already ordered and keyed by.
async function entryMeetupId(entry: MeetupHistoryEntry, connectionId: string): Promise<string> {
  const { data } = await supabase
    .from('meetups')
    .select('id')
    .eq('connection_id', connectionId)
    .eq('sequence_number', entry.sequence_number)
    .single();
  return (data as { id: string }).id;
}
