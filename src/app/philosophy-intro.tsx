import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { PaddedSafeArea } from '@/components/padded-safe-area';

// Intro (2026-10-22: one screen, was two). That making friends as an adult
// is hard and it's not just you, the liking gap (after a first
// conversation, people underestimate how much the other person liked them,
// Boothby et al., 2018), and what Limen offers. Then sign-up.
export default function PhilosophyIntroScreen() {
  return (
    <View className="flex-1 bg-stone-50 dark:bg-stone-900">
      <PaddedSafeArea className="flex-1 justify-between px-6 py-10">
        <View />

        <View className="gap-6">
          <Text className="text-display text-stone-900 dark:text-stone-50">
            Making friends as an adult is hard. It&apos;s not just you.
          </Text>
          <Text className="text-body text-stone-500 dark:text-stone-400">
            Schedules fill up and people drift apart. Reaching out can feel awkward. And after meeting someone new,
            most people underestimate how much the other person liked them.
          </Text>
          <Text className="text-body text-stone-500 dark:text-stone-400">
            Limen introduces you to one person at a time and helps you keep meeting until you&apos;re simply
            friends. No swiping. No perfect profile. Just you.
          </Text>
        </View>

        <View className="gap-3">
          <Pressable
            onPress={() => router.push('/phone-verification')}
            className="items-center rounded-full bg-stone-900 py-4 active:opacity-80 dark:bg-stone-50">
            <Text className="text-body font-semibold text-stone-50 dark:text-stone-900">Join Limen</Text>
          </Pressable>
          <Pressable onPress={() => router.push('/phone-verification')} className="items-center py-2">
            <Text className="text-caption text-stone-500 dark:text-stone-400">Already a member? Sign in</Text>
          </Pressable>
          {__DEV__ && (
            <Pressable onPress={() => router.replace('/home')} className="items-center py-2">
              <Text className="text-caption text-stone-400 dark:text-stone-600">Skip to home (dev)</Text>
            </Pressable>
          )}
        </View>
      </PaddedSafeArea>
    </View>
  );
}
