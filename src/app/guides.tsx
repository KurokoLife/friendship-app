import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { MODULES } from '@/lib/modules-data';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400
const ACCENT_COLOR = '#B5643B'; // accent-500

// Path 2 (secondary): a quiet reference list, meant to live inside profile
// settings, which doesn't exist yet in this codebase, so this is a
// standalone route for now, ready to be embedded there. Deliberately no
// progress bar, no lock icons, no completion counter, no time estimates.
// Any title, done or not, is tappable, anytime.
export default function GuidesScreen() {
  const [completed, setCompleted] = useState<Record<string, boolean>>({});
  const [loaded, setLoaded] = useState(false);

  const loadStatus = useCallback(async () => {
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
      .from('users')
      .select('etiquette_modules')
      .eq('id', user.id)
      .maybeSingle();
    setCompleted((data?.etiquette_modules as Record<string, boolean>) ?? {});
    setLoaded(true);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadStatus();
    }, [loadStatus])
  );

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
        <ScrollView contentContainerClassName="gap-5 px-6 pb-6 pt-10">
          <View className="gap-2">
            <Text className="text-title text-stone-900 dark:text-stone-50">Guides</Text>
            <Text className="text-body text-stone-500 dark:text-stone-400">
              Short reflections on friendship, whenever you want them.
            </Text>
          </View>

          <View className="gap-1">
            {MODULES.map((module) => {
              const isDone = Boolean(completed[module.id]);
              return (
                <Pressable
                  key={module.id}
                  onPress={() =>
                    router.push({ pathname: '/module/[id]', params: { id: module.id } })
                  }
                  className="flex-row items-start gap-3 rounded-xl px-2 py-3 active:opacity-60">
                  <View className="w-5 items-center pt-1">
                    {isDone && (
                      <Ionicons name="checkmark" size={16} color={ACCENT_COLOR} />
                    )}
                  </View>
                  <View className="flex-1 gap-0.5">
                    <View className="flex-row flex-wrap items-baseline gap-2">
                      <Text className="text-body text-stone-900 dark:text-stone-50">
                        {module.title}
                      </Text>
                      {/* module.mandatory is exactly the two videos shown
                          during onboarding (etiquette-modules.tsx filters
                          on this same flag), a quiet tag rather than a
                          badge/pill, matching this screen's own stated
                          "no gamification" design (no progress bar, no
                          lock icons, no completion counter). Signals to
                          someone browsing independently that they've
                          already seen this during signup, not new
                          content. */}
                      {module.mandatory && (
                        <Text className="text-caption text-stone-400 dark:text-stone-600">
                          (Onboarding)
                        </Text>
                      )}
                    </View>
                    <Text className="text-caption text-stone-500 dark:text-stone-400">
                      {module.description}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
