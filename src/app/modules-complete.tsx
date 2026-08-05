import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// F8's "All set" screen. Onboarding update (2026-07-26): moved to the end
// of onboarding, now shown right after the single merged readiness/safety
// confirmation (readiness-commitment.tsx, F9+F10 combined) and routes
// straight into the main app, replacing the old order where this screen
// came before both of those confirmations.
export default function ModulesCompleteScreen() {
  return (
    <View className="flex-1 bg-stone-50 dark:bg-stone-900">
      <SafeAreaView className="flex-1 justify-between px-6 py-10">
        <View className="gap-4 pt-16">
          <Text className="text-display text-stone-900 dark:text-stone-50">You&apos;re all set</Text>
          <Text className="text-body text-stone-600 dark:text-stone-300">
            You&apos;ll find short guides in your profile when you&apos;re ready, on things like
            the honest exit, what to do when friendship feels one-sided, and how to show up even
            when life gets in the way. They&apos;re there when you need them, not homework.
          </Text>
        </View>

        <Pressable
          onPress={() => router.replace('/home')}
          className="items-center rounded-full bg-stone-900 py-4 active:opacity-80 dark:bg-stone-50">
          <Text className="text-body font-semibold text-stone-50 dark:text-stone-900">
            Take me to the app
          </Text>
        </Pressable>
      </SafeAreaView>
    </View>
  );
}
