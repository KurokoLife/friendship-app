import { useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GuideVideoPlayer } from '@/components/guide-video-player';
import { getGuideOnlyEntry } from '@/lib/guide-only-entries';
import { getModule } from '@/lib/modules-data';
import { getGuideOnlyEntryVideoUrl, getModuleVideoUrl } from '@/lib/module-videos';
import { goBack } from '@/lib/navigation';

// A standalone Guide-library view, distinct from module/[id].tsx (the
// real onboarding flow's own screen, untouched by this file). Reached
// only from the Guides list, only for entries with a real video (guides.tsx
// routes here instead of module/[id] for those, all other module entries
// still route to module/[id] exactly as before). No quiz, no scenario, no
// "Module X of 2" progress chrome, no completion tracking, this is a plain
// video-plus-context reference, not a re-entry into onboarding.
//
// Resolves against two independent sources, checked in order: MODULES
// (the 2 onboarding modules with a real video) and GUIDE_ONLY_ENTRIES (real
// videos with no onboarding role at all, e.g. the anxiety video, added
// 2026-08-25). Both resolve to the same {title, description, videoUrl}
// shape this screen actually needs, so the render below doesn't care which
// source a given id came from.
export default function GuideDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const module = getModule(id);
  const guideOnly = module ? undefined : getGuideOnlyEntry(id);

  const title = module?.title ?? guideOnly?.title;
  const description = module?.libraryDescription ?? module?.description ?? guideOnly?.libraryDescription;
  const videoUrl = module ? getModuleVideoUrl(module.id) : guideOnly ? getGuideOnlyEntryVideoUrl(guideOnly.id) : undefined;

  if (!title || !description || !videoUrl) {
    return (
      <View className="flex-1 items-center justify-center gap-4 bg-stone-50 px-6 dark:bg-stone-900">
        <Text className="text-center text-body text-stone-500 dark:text-stone-400">
          That guide isn&apos;t available.
        </Text>
        <Pressable onPress={() => goBack('/guides')}>
          <Text className="text-caption font-semibold text-accent-500">Go back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-stone-50 dark:bg-stone-900">
      <SafeAreaView className="flex-1">
        <View className="px-6 pt-10">
          <Pressable onPress={() => goBack('/guides')}>
            <Text className="text-caption text-stone-500 dark:text-stone-400">Back</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerClassName="gap-5 px-6 pb-6 pt-5">
          <Text className="text-display text-stone-900 dark:text-stone-50">{title}</Text>

          <GuideVideoPlayer uri={videoUrl} />

          <Text className="text-body text-stone-700 dark:text-stone-300">{description}</Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
