import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { PaddedSafeArea } from '@/components/padded-safe-area';
import { InlineLink, Pill } from '@/components/ui';

// Intro (rebuild stage 2, 2026-10-26): two screens, exact wording from
// docs/context/05_LIMEN_REBUILD.md "Joining (decided)". Replaces the one
// screen from 2026-10-22. The liking-gap line moved to the start of the
// profile ("Meet someone new" only).
const SCREEN_TWO_POINTS = [
  'Keep up with the friends you have.',
  "Reconnect with someone you've lost touch with.",
  'Meet someone new, one person at a time, in person.',
];

export default function PhilosophyIntroScreen() {
  const [screen, setScreen] = useState<1 | 2>(1);

  return (
    <View className="flex-1 bg-stone-50 dark:bg-stone-900">
      <PaddedSafeArea className="flex-1 justify-between px-6 py-10">
        {screen === 2 ? <Pill label="Back" className="self-start" onPress={() => setScreen(1)} /> : <View />}

        {screen === 1 ? (
          <View className="gap-6">
            <Text className="text-display text-stone-900 dark:text-stone-50">
              Most friendships don&apos;t end. They drift.
            </Text>
            <Text className="text-body text-stone-600 dark:text-stone-300">
              Busy weeks, moves, screens. It&apos;s easy to lose touch without meaning to.
            </Text>
          </View>
        ) : (
          <View className="gap-6">
            <Text className="text-display text-stone-900 dark:text-stone-50">Friendships are made of small moments.</Text>
            <Text className="text-body text-stone-600 dark:text-stone-300">
              A quick call. A coffee. Stopping by to say hi. Limen helps you make more of them.
            </Text>
            <View className="gap-3">
              {SCREEN_TWO_POINTS.map((p) => (
                <View key={p} className="flex-row gap-3">
                  <View className="mt-2 h-2 w-2 rounded-full bg-apricot" />
                  <Text className="flex-1 text-body text-stone-800 dark:text-stone-100">{p}</Text>
                </View>
              ))}
            </View>
            <Text className="text-body text-stone-600 dark:text-stone-300">
              Wherever your friendships are right now, you can start here.
            </Text>
          </View>
        )}

        {screen === 1 ? (
          <View className="gap-3">
            <Pill label="Next" variant="filled" onPress={() => setScreen(2)} />
          </View>
        ) : (
          <View className="gap-3">
            <Pill label="Join Limen" variant="filled" onPress={() => router.push('/phone-verification')} />
            <Text className="py-2 text-center text-caption text-stone-500 dark:text-stone-400">
              Already a member? <InlineLink onPress={() => router.push('/phone-verification')}>Sign in</InlineLink>
            </Text>
            {__DEV__ && <Pill label="Skip to home (dev)" onPress={() => router.replace('/circle')} />}
          </View>
        )}
      </PaddedSafeArea>
    </View>
  );
}
