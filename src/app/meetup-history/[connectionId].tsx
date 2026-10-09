import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { formatMeetupTime, parseIsoDate } from '@/lib/meetup-format';
import { supabase } from '@/lib/supabase';
import { goBack } from '@/lib/navigation';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400

// Meetup history (rebuilt 2026-10-08): every meetup you both said happened,
// numbered in order (1st, 2nd, ...), with the date, time and place from the
// plan. Before, the number shown was an internal version number that went
// up every time a plan moved ("Meetup 7" for a first meetup), and every row
// had a "This date looks wrong" link that led nowhere (the other person had
// no way to approve a fix). The date now always comes from the plan both
// people confirmed, so there is nothing to correct.

type Row = {
  id: string;
  occurred_date: string | null;
  confirmed_date: string | null;
  start_time: string | null;
  place: string | null;
  activity: string | null;
};

function formatLongDate(iso: string): string {
  return parseIsoDate(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' });
}

export default function MeetupHistoryScreen() {
  const { connectionId } = useLocalSearchParams<{ connectionId: string }>();
  const [rows, setRows] = useState<Row[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!connectionId) return;
    const { data } = await supabase
      .from('meetups')
      .select('id, occurred_date, confirmed_date, start_time, place, activity, created_at')
      .eq('connection_id', connectionId)
      .eq('status', 'occurred')
      .order('created_at', { ascending: true });
    const list = ((data ?? []) as (Row & { created_at: string })[]).sort((a, b) =>
      (a.occurred_date ?? a.confirmed_date ?? a.created_at).localeCompare(b.occurred_date ?? b.confirmed_date ?? b.created_at)
    );
    setRows(list);
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
        <Pressable onPress={() => goBack(`/thread/${connectionId}`)}>
          <Text className="text-caption text-stone-500 dark:text-stone-400">Back</Text>
        </Pressable>
        <Text className="text-title text-stone-900 dark:text-stone-50">Meetup history</Text>
        <View style={{ width: 40 }} />
      </View>

      {!loaded ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={MUTED_ICON_COLOR} />
        </View>
      ) : rows.length === 0 ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-center text-body text-stone-400 dark:text-stone-600">
            No meetups yet. Once you both say a meetup happened, it shows up here.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerClassName="gap-3 px-6 py-5">
          {[...rows].reverse().map((row, i) => {
            const number = rows.length - i;
            const date = row.occurred_date ?? row.confirmed_date;
            const time = formatMeetupTime(row.start_time);
            return (
              <View
                key={row.id}
                className="gap-1 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
                <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">Meetup {number}</Text>
                <Text className="text-body text-stone-900 dark:text-stone-50">
                  {date ? formatLongDate(date) : 'Date not recorded'}
                  {time ? ` · ${time}` : ''}
                </Text>
                {(row.activity || row.place) && (
                  <Text className="text-caption text-stone-500 dark:text-stone-400">
                    {[row.activity, row.place].filter(Boolean).join(' at ')}
                  </Text>
                )}
              </View>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
