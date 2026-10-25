import { ScrollView, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { goBack } from '@/lib/navigation';

// About Limen (2026-10-25). Exact wording decided in
// docs/context/05_LIMEN_REBUILD.md ("About Limen page"). Don't change it
// without asking the founder.
const HOLD_TO = [
  "Friendships are made of small moments, so that's what Limen helps with.",
  'Your messages are yours. Limen may offer a few words to start; the rest is you.',
  'Meeting in person is the point. Chatting is how you get there.',
  'You decide. Every reminder can be turned off.',
  'Limen is paid for by members, never by ads or by selling your information.',
];

export default function AboutScreen() {
  return (
    <View className="flex-1 bg-stone-50 dark:bg-stone-900">
      <SafeAreaView className="flex-1">
        <ScrollView contentContainerClassName="gap-6 px-6 pb-14 pt-6">
          <Pressable onPress={() => goBack({ pathname: '/profile', params: { view: 'settings' } })} className="min-h-11 flex-row items-center justify-center rounded-full border px-4 active:opacity-70 border-outline dark:border-stone-600 self-start">
            <Text className="text-caption font-semibold text-stone-900 dark:text-stone-50">Back</Text>
          </Pressable>
          <Text className="text-display text-stone-900 dark:text-stone-50">About Limen</Text>
          <Text className="text-body leading-relaxed text-stone-700 dark:text-stone-300">
            Most friendships don&apos;t end. They drift. Limen helps you keep up with the friends you have, reconnect
            with people you&apos;ve lost touch with, and meet someone new, in person.
          </Text>
          <View className="gap-3">
            <Text className="text-title text-stone-900 dark:text-stone-50">What we hold to</Text>
            {HOLD_TO.map((line) => (
              <View key={line} className="flex-row gap-3">
                <Text className="text-body text-accent-500 dark:text-accent-400">•</Text>
                <Text className="flex-1 text-body leading-relaxed text-stone-700 dark:text-stone-300">{line}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
