import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GuideVideoPlayer } from '@/components/guide-video-player';
import { getModule } from '@/lib/modules-data';
import { getModuleVideoUrl } from '@/lib/module-videos';

// A standalone Guide-library view, distinct from module/[id].tsx (the
// real onboarding flow's own screen, untouched by this file). Reached
// only from the Guides list, only for the modules with a real video
// (guides.tsx routes here instead of module/[id] for those two, all
// other entries still route to module/[id] exactly as before). No quiz,
// no scenario, no "Module X of 2" progress chrome, no completion
// tracking, this is a plain video-plus-context reference, not a re-entry
// into onboarding. If a module with no real video or no libraryDescription
// somehow lands here, falls back to a plain not-found message rather than
// guessing at content that doesn't exist for it.
export default function GuideDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const module = getModule(id);
  const videoUrl = module ? getModuleVideoUrl(module.id) : undefined;

  if (!module || !videoUrl) {
    return (
      <View className="flex-1 items-center justify-center bg-stone-50 px-6 dark:bg-stone-900">
        <Text className="text-center text-body text-stone-500 dark:text-stone-400">
          That guide isn&apos;t available.
        </Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-stone-50 dark:bg-stone-900">
      <SafeAreaView className="flex-1">
        <View className="px-6 pt-10">
          <Pressable onPress={() => router.back()}>
            <Text className="text-caption text-stone-500 dark:text-stone-400">Back</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerClassName="gap-5 px-6 pb-6 pt-5">
          <Text className="text-display text-stone-900 dark:text-stone-50">{module.title}</Text>

          <GuideVideoPlayer uri={videoUrl} />

          <Text className="text-body text-stone-700 dark:text-stone-300">
            {module.libraryDescription ?? module.description}
          </Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
