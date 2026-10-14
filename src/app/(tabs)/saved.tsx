import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CoachMark } from '@/components/coach-mark';
import { lifeTransitionFragment } from '@/lib/life-transition';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400
const SAVE_DAYS = 30;
const SAVE_MAX = 5;

type SavedProfile = {
  connection_id: string;
  user_id: string;
  saved_at: string;
  display_name: string | null;
  age_band: string | null;
  life_transitions: string[];
  personal_statement: string | null;
};

function humanDetailLine(profile: SavedProfile): string | null {
  if (!profile.personal_statement) return null;
  const firstSentence = profile.personal_statement.split(/(?<=[.!?])\s+/)[0];
  return firstSentence || null;
}

function shortDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Saved (rebuilt 2026-10-10, docs/DECISIONS.md section 4): up to 5, each
// for 30 days. People you said Interested to moved to Inbox, Pending
// (2026-10-14).
// Anyone you start a chat with leaves Saved; they live in Inbox from then.
export default function SavedScreen() {
  const [loaded, setLoaded] = useState(false);
  const [profiles, setProfiles] = useState<SavedProfile[]>([]);
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setLoaded(true);
      return;
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoaded(true);
      return;
    }
    const { data } = await supabase.from('saved_profiles').select('*').order('saved_at', { ascending: false });
    setProfiles((data ?? []) as SavedProfile[]);
    setLoaded(true);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const handleRemove = async (userId: string) => {
    setPendingRemove(userId);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      await supabase.from('connections').update({ saved: false }).eq('user_a_id', user.id).eq('user_b_id', userId);
    }
    setProfiles((prev) => prev.filter((p) => p.user_id !== userId));
    setPendingRemove(null);
  };

  if (!loaded) {
    return (
      <View className="flex-1 items-center justify-center bg-stone-50 dark:bg-stone-900">
        <ActivityIndicator color={MUTED_ICON_COLOR} />
      </View>
    );
  }

  const nothing = profiles.length === 0;

  return (
    <View className="flex-1 bg-stone-50 dark:bg-stone-900">
      <SafeAreaView className="flex-1">
        <ScrollView contentContainerClassName="gap-4 px-6 pb-10 pt-10">
          <Text className="text-display text-stone-900 dark:text-stone-50">Saved</Text>

          <CoachMark markKey="tab_saved" text="People you save stay here for 30 days." />

          {!isSupabaseConfigured && (
            <Text className="text-caption text-amber-600 dark:text-amber-400">
              Supabase isn&apos;t configured yet. See .env.example.
            </Text>
          )}

          <Pressable onPress={() => router.push('/inbox')} className="self-start">
            <Text className="text-caption text-stone-500 dark:text-stone-400">
              People you said Interested to are in Inbox, under Pending.
            </Text>
          </Pressable>

          {nothing && isSupabaseConfigured && (
            <View className="gap-2 rounded-3xl border border-stone-100 bg-white p-7 dark:border-stone-700/60 dark:bg-stone-800">
              <Text className="text-body text-stone-600 dark:text-stone-300">
                When you save someone in Discover, they&apos;ll stay here for 30 days.
              </Text>
            </View>
          )}

          {profiles.length > 0 && (
            <View className="gap-3">
              <Text className="text-caption font-semibold uppercase text-stone-400 dark:text-stone-600">
                Saved · {profiles.length} of {SAVE_MAX}
              </Text>
              {profiles.map((p) => {
                const fragment = lifeTransitionFragment(p.life_transitions);
                const detail = humanDetailLine(p);
                const until = new Date(new Date(p.saved_at).getTime() + SAVE_DAYS * 86400000).toISOString();
                return (
                  <View
                    key={p.connection_id}
                    className="gap-3 rounded-3xl border border-stone-100 bg-white p-7 dark:border-stone-700/60 dark:bg-stone-800">
                    <Pressable onPress={() => router.push({ pathname: '/candidate/[id]', params: { id: p.user_id } })}>
                      <View className="gap-2">
                        <Text className="text-title text-stone-900 dark:text-stone-50">
                          {p.display_name ?? 'A member'}
                          {p.age_band ? `, ${p.age_band}` : ''}
                        </Text>
                        {fragment && <Text className="text-caption text-accent-500">{fragment}</Text>}
                        {detail && (
                          <Text className="text-body leading-relaxed text-stone-600 dark:text-stone-300">{detail}</Text>
                        )}
                        <Text className="text-caption text-stone-400 dark:text-stone-500">Saved until {shortDay(until)}</Text>
                      </View>
                    </Pressable>

                    <Pressable
                      onPress={() => handleRemove(p.user_id)}
                      disabled={pendingRemove === p.user_id}
                      className="flex-row items-center justify-center gap-1 rounded-full border border-stone-300 py-3 active:opacity-70 dark:border-stone-600">
                      <Ionicons name="close" size={14} color={MUTED_ICON_COLOR} />
                      <Text className="text-caption font-semibold text-stone-600 dark:text-stone-300">Remove</Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
