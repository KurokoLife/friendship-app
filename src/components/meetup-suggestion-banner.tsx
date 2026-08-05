import { Pressable, Text, View } from 'react-native';

type Props = {
  onYes: () => void;
  onNotYet: () => void;
  onDontRemindMe: () => void;
};

// F22: non-intrusive banner, deliberately styled like a quiet inline note
// rather than a modal or an urgent-looking card, matching "non-intrusive"
// literally. Shown at the top of the thread, above the message list.
export function MeetupSuggestionBanner({ onYes, onNotYet, onDontRemindMe }: Props) {
  return (
    <View className="gap-3 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
      <Text className="text-body text-stone-700 dark:text-stone-300">
        Friendships are built in person. Ready to suggest meeting up?
      </Text>
      <View className="flex-row flex-wrap gap-2">
        <Pressable
          onPress={onYes}
          className="rounded-full border border-stone-900 bg-stone-900 px-4 py-2 dark:border-stone-50 dark:bg-stone-50">
          <Text className="text-caption font-semibold text-stone-50 dark:text-stone-900">
            Yes, let&apos;s plan something
          </Text>
        </Pressable>
        <Pressable onPress={onNotYet} className="rounded-full border border-stone-300 px-4 py-2 dark:border-stone-700">
          <Text className="text-caption font-semibold text-stone-600 dark:text-stone-300">Not yet</Text>
        </Pressable>
        <Pressable
          onPress={onDontRemindMe}
          className="rounded-full border border-stone-300 px-4 py-2 dark:border-stone-700">
          <Text className="text-caption font-semibold text-stone-600 dark:text-stone-300">
            Don&apos;t remind me
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
