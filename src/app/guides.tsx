import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GuideVideoThumbnail } from '@/components/guide-video-player';
import { GUIDE_ONLY_ENTRIES } from '@/lib/guide-only-entries';
import { getGuideOnlyEntryVideoUrl, getModuleVideoUrl } from '@/lib/module-videos';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { MODULES } from '@/lib/modules-data';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400
const ACCENT_COLOR = '#B5643B'; // accent-500

// One row shape both MODULES and GUIDE_ONLY_ENTRIES render into, so the
// list below doesn't need two near-duplicate JSX blocks. isDone/mandatory
// are always false for a guide-only entry: it has no etiquette_modules
// completion tracking and no onboarding role at all.
type GuideRow = {
  id: string;
  title: string;
  description: string;
  mandatory: boolean;
  videoUrl: string | undefined;
};

function GuideListRow({ row, isDone }: { row: GuideRow; isDone: boolean }) {
  return (
    <Pressable
      onPress={() =>
        router.push(
          row.videoUrl
            ? { pathname: '/guide/[id]', params: { id: row.id } }
            : { pathname: '/module/[id]', params: { id: row.id } }
        )
      }
      className="flex-row items-start gap-3 rounded-xl px-2 py-3 active:opacity-60">
      <View className="w-5 items-center pt-1">{isDone && <Ionicons name="checkmark" size={16} color={ACCENT_COLOR} />}</View>
      {row.videoUrl && <GuideVideoThumbnail uri={row.videoUrl} />}
      <View className="flex-1 gap-0.5">
        <View className="flex-row flex-wrap items-baseline gap-2">
          <Text className="text-body text-stone-900 dark:text-stone-50">{row.title}</Text>
          {/* mandatory is exactly the two videos shown during onboarding
              (etiquette-modules.tsx filters on this same flag), a quiet
              tag rather than a badge/pill, matching this screen's own
              stated "no gamification" design. Never shown for a
              guide-only entry, it has no onboarding role. */}
          {row.mandatory && (
            <Text className="text-caption text-stone-400 dark:text-stone-600">(Onboarding)</Text>
          )}
        </View>
        <Text className="text-caption text-stone-500 dark:text-stone-400">{row.description}</Text>
      </View>
    </Pressable>
  );
}

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

  // The 2 mandatory onboarding modules with a real video (module_curiosity,
  // module_show_up), then the anxiety video (guide_meetup_anxiety, added
  // 2026-08-25, no onboarding role), then the remaining 9 text-only
  // modules, untouched, in their existing order. Placed right after the
  // 2 onboarding videos rather than at the very end: it's the third real,
  // produced video in this list, and grouping the videos together felt
  // like the more discoverable ordering for someone browsing rather than
  // burying it after 9 unrelated text entries.
  const onboardingVideoRows: GuideRow[] = MODULES.slice(0, 2).map((m) => ({
    id: m.id,
    title: m.title,
    description: m.description,
    mandatory: m.mandatory,
    videoUrl: getModuleVideoUrl(m.id),
  }));
  const anxietyRow: GuideRow[] = GUIDE_ONLY_ENTRIES.map((e) => ({
    id: e.id,
    title: e.title,
    description: e.description,
    mandatory: false,
    videoUrl: getGuideOnlyEntryVideoUrl(e.id),
  }));
  const remainingRows: GuideRow[] = MODULES.slice(2).map((m) => ({
    id: m.id,
    title: m.title,
    description: m.description,
    mandatory: m.mandatory,
    videoUrl: getModuleVideoUrl(m.id),
  }));
  const rows = [...onboardingVideoRows, ...anxietyRow, ...remainingRows];

  return (
    <View className="flex-1 bg-stone-50 dark:bg-stone-900">
      <SafeAreaView className="flex-1">
        <View className="px-6 pt-10">
          <Pressable onPress={() => router.back()}>
            <Text className="text-caption text-stone-500 dark:text-stone-400">Back</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerClassName="gap-5 px-6 pb-6 pt-5">
          <View className="gap-2">
            <Text className="text-title text-stone-900 dark:text-stone-50">Guides</Text>
            <Text className="text-body text-stone-500 dark:text-stone-400">
              Short reflections on friendship, whenever you want them.
            </Text>
          </View>

          <View className="gap-1">
            {rows.map((row) => (
              <GuideListRow key={row.id} row={row} isDone={Boolean(completed[row.id])} />
            ))}
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
