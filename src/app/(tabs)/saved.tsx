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

// F14: no artificial expiration (blueprint Section 8, locked decision:
// "Do not pressure users with artificial expiration"). Fix #4 removed a
// previously-live 14-day expiry (cron job plus a countdown badge here)
// that contradicted this, confirmed genuinely active before removing it,
// not just a stale doc claim. A save only ever disappears now because
// the other account was deleted (handled by the database itself, a
// deleted account's connection row is gone via cascade, not just
// hidden) or because the pair no longer passes the same hard eligibility
// checks (mutual gender preference, mutual age range) discovery_profiles/
// browse_profiles already enforce, see saved_profiles
// (20260721000001_remove_save_expiry_add_eligibility.sql). Softer
// compatibility drift (values, activities, interests changing) does NOT
// remove a save, a deliberate past signal shouldn't vanish just because
// the saved person's scored compatibility drifted, only a genuine
// eligibility change does.
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
    const { data } = await supabase
      .from('saved_profiles')
      .select('*')
      .order('saved_at', { ascending: false });
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
      await supabase
        .from('connections')
        .update({ saved: false })
        .eq('user_a_id', user.id)
        .eq('user_b_id', userId);
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

  return (
    <View className="flex-1 bg-stone-50 dark:bg-stone-900">
      <SafeAreaView className="flex-1">
        <ScrollView contentContainerClassName="gap-4 px-6 pb-10 pt-10">
          <Text className="text-display text-stone-900 dark:text-stone-50">Saved</Text>

          <CoachMark markKey="tab_saved" text="This is where the profiles you've saved live." />

          {!isSupabaseConfigured && (
            <Text className="text-caption text-amber-600 dark:text-amber-400">
              Supabase isn&apos;t configured yet. See .env.example.
            </Text>
          )}

          {profiles.length === 0 && isSupabaseConfigured && (
            <View className="gap-2 rounded-3xl border border-stone-100 bg-white p-7 dark:border-stone-700/60 dark:bg-stone-800">
              <Text className="text-body text-stone-600 dark:text-stone-300">
                When you save someone from Discover or Browse, they&apos;ll show up here.
              </Text>
            </View>
          )}

          {profiles.map((p) => {
            const fragment = lifeTransitionFragment(p.life_transitions);
            const detail = humanDetailLine(p);
            return (
              <View
                key={p.connection_id}
                className="gap-3 rounded-3xl border border-stone-100 bg-white p-7 dark:border-stone-700/60 dark:bg-stone-800">
                <Pressable
                  onPress={() =>
                    router.push({ pathname: '/candidate/[id]', params: { id: p.user_id } })
                  }>
                  <View className="gap-2">
                    <Text className="text-title text-stone-900 dark:text-stone-50">
                      {p.display_name ?? 'A member'}
                      {p.age_band ? `, ${p.age_band}` : ''}
                    </Text>
                    {fragment && <Text className="text-caption text-accent-500">{fragment}</Text>}
                    {detail && (
                      <Text className="text-body leading-relaxed text-stone-600 dark:text-stone-300">
                        {detail}
                      </Text>
                    )}
                  </View>
                </Pressable>

                <Pressable
                  onPress={() => handleRemove(p.user_id)}
                  disabled={pendingRemove === p.user_id}
                  className="flex-row items-center justify-center gap-1 rounded-full border border-stone-300 py-3 active:opacity-70 dark:border-stone-600">
                  <Ionicons name="close" size={14} color={MUTED_ICON_COLOR} />
                  <Text className="text-caption font-semibold text-stone-600 dark:text-stone-300">
                    Remove
                  </Text>
                </Pressable>
              </View>
            );
          })}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
