import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { PaddedSafeArea } from '@/components/padded-safe-area';

// Intro (2026-10-18): two short screens. First, that making friends as an
// adult is hard, and it's not just you. Then what Limen offers, keeping the
// heart of the earlier intro (the liking gap: after a first conversation,
// people underestimate how much the other person liked them, Boothby et
// al., 2018). Then "Start with you", before any phone number or form.
export default function PhilosophyIntroScreen() {
  const [page, setPage] = useState<0 | 1>(0);

  return (
    <View className="flex-1 bg-stone-50 dark:bg-stone-900">
      <PaddedSafeArea className="flex-1 justify-between px-6 py-10">
        <View className="flex-row items-center justify-between">
          {page === 1 ? (
            <Pressable onPress={() => setPage(0)}>
              <Text className="text-caption text-stone-500 dark:text-stone-400">Back</Text>
            </Pressable>
          ) : (
            <View />
          )}
          <View className="flex-row gap-1.5">
            <View className={`h-1.5 w-6 rounded-full ${page === 0 ? 'bg-accent-500' : 'bg-stone-300 dark:bg-stone-700'}`} />
            <View className={`h-1.5 w-6 rounded-full ${page === 1 ? 'bg-accent-500' : 'bg-stone-300 dark:bg-stone-700'}`} />
          </View>
        </View>

        {page === 0 ? (
          <View className="gap-6">
            <Text className="text-display text-stone-900 dark:text-stone-50">
              Making friends as an adult is hard. It&apos;s not just you.
            </Text>
            <Text className="text-body text-stone-500 dark:text-stone-400">
              Schedules fill up. People move, change, drift apart. Reaching out can feel awkward, and it&apos;s easy
              to wonder if the other person even wants to hear from you.
            </Text>
          </View>
        ) : (
          <View className="gap-6">
            <Text className="text-display text-stone-900 dark:text-stone-50">Meeting people is only the beginning.</Text>
            <Text className="text-body text-stone-500 dark:text-stone-400">
              A new friendship often feels uncertain before it feels natural. Both people wonder whether to reach out,
              what an awkward moment means, or whether the other person is interested.
            </Text>
            <Text className="text-body text-stone-500 dark:text-stone-400">
              One thing worth knowing: after a first conversation, most people underestimate how much the other person
              liked them.
            </Text>
            <Text className="text-body text-stone-500 dark:text-stone-400">
              Limen doesn&apos;t remove the uncertainty. It helps you move through it with honesty and care. It
              introduces you to one person at a time, first meetups are one on one, and you keep meeting until
              you&apos;re simply friends. No swiping. No perfect profile. Just you.
            </Text>
          </View>
        )}

        <View className="gap-3">
          <Pressable
            onPress={() => (page === 0 ? setPage(1) : router.push('/start-with-you'))}
            className="items-center rounded-full bg-stone-900 py-4 active:opacity-80 dark:bg-stone-50">
            <Text className="text-body font-semibold text-stone-50 dark:text-stone-900">
              {page === 0 ? 'Continue' : "Let's start with you"}
            </Text>
          </Pressable>
          {page === 0 && (
            <Pressable onPress={() => router.push('/phone-verification')} className="items-center py-2">
              <Text className="text-caption text-stone-500 dark:text-stone-400">Already a member? Sign in</Text>
            </Pressable>
          )}
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
