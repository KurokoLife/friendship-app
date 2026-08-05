import { router } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, ScrollView, Share, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CoachMark } from '@/components/coach-mark';
import { buildRememberExport, fetchRememberPeople, type RememberPerson } from '@/lib/remember';
import { isSupabaseConfigured } from '@/lib/supabase';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400

// Real export, not a UI promise: web gets an actual file download via a
// Blob and a synthetic anchor click (there's no filesystem to write to
// in a browser), every other platform gets the native Share sheet with
// the same JSON content, so the user can save or send it wherever they
// want. No new dependency needed for either path.
async function exportRememberData() {
  const json = await buildRememberExport();
  if (Platform.OS === 'web') {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'remember-export.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } else {
    await Share.share({ message: json, title: 'My Remember data' });
  }
}

function snippetFor(person: RememberPerson): string | null {
  return person.latest_entry_snippet ?? person.latest_entry_raw;
}

// People List (Remember). Shows connections worth remembering: anyone
// with at least one real, mutually-confirmed meetup, or anyone the user
// has manually written a Remember entry for even before a first meetup
// is confirmed (remember_people view, Step 3's own stated criteria).
export default function RememberScreen() {
  const [loaded, setLoaded] = useState(false);
  const [people, setPeople] = useState<RememberPerson[]>([]);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setLoaded(true);
      return;
    }
    setPeople(await fetchRememberPeople());
    setLoaded(true);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const handleExport = async () => {
    setExporting(true);
    try {
      await exportRememberData();
    } finally {
      setExporting(false);
    }
  };

  if (!loaded) {
    return (
      <View className="flex-1 items-center justify-center bg-stone-50 dark:bg-stone-900">
        <ActivityIndicator color={MUTED_ICON_COLOR} />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-stone-50 dark:bg-stone-900">
      <SafeAreaView className="flex-1">
        <ScrollView contentContainerClassName="gap-4 px-6 pb-10 pt-10">
          <View className="flex-row items-start justify-between">
            <Text className="text-display text-stone-900 dark:text-stone-50">Remember</Text>
            {people.length > 0 && (
              <Pressable onPress={handleExport} disabled={exporting}>
                <Text className={`text-caption font-semibold text-accent-500 ${exporting ? 'opacity-40' : ''}`}>
                  {exporting ? 'Exporting...' : 'Export'}
                </Text>
              </Pressable>
            )}
          </View>

          <CoachMark
            markKey="tab_remember"
            text="This is where you can log what you want to remember about someone you've met in person."
          />

          {!isSupabaseConfigured && (
            <Text className="text-caption text-amber-600 dark:text-amber-400">
              Supabase isn&apos;t configured yet. See .env.example.
            </Text>
          )}

          {people.length === 0 && isSupabaseConfigured && (
            <View className="gap-2 rounded-3xl border border-stone-100 bg-white p-7 dark:border-stone-700/60 dark:bg-stone-800">
              <Text className="text-body text-stone-600 dark:text-stone-300">
                Once you&apos;ve met up with someone, or written a note about them, they&apos;ll show up here.
              </Text>
            </View>
          )}

          {people.map((p) => {
            const snippet = snippetFor(p);
            return (
              <Pressable
                key={p.connection_id}
                onPress={() => router.push({ pathname: '/remember/[connectionId]', params: { connectionId: p.connection_id } })}
                className="flex-row items-center gap-4 rounded-3xl border border-stone-100 bg-white p-5 dark:border-stone-700/60 dark:bg-stone-800">
                {p.photo_url ? (
                  <Image source={{ uri: p.photo_url }} className="h-14 w-14 rounded-full" />
                ) : (
                  <View className="h-14 w-14 items-center justify-center rounded-full bg-stone-200 dark:bg-stone-700">
                    <Text className="text-title text-stone-500 dark:text-stone-400">
                      {(p.display_name ?? '?').charAt(0).toUpperCase()}
                    </Text>
                  </View>
                )}
                <View className="flex-1 gap-1">
                  <Text className="text-title text-stone-900 dark:text-stone-50">{p.display_name ?? 'A member'}</Text>
                  <Text className="text-caption text-stone-500 dark:text-stone-400">
                    {p.meetup_count > 0
                      ? `${p.meetup_count} ${p.meetup_count === 1 ? 'meetup' : 'meetups'}`
                      : 'No confirmed meetups yet'}
                  </Text>
                  {snippet && (
                    <Text className="text-caption text-stone-400 dark:text-stone-600" numberOfLines={1}>
                      {snippet}
                    </Text>
                  )}
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
