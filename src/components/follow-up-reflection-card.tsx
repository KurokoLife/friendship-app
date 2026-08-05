import { Pressable, Text, View } from 'react-native';

import { dismissReflection, reflectionPrompt, snoozeReflection, type FollowUpReflection } from '@/lib/follow-up-reflection';

type Props = {
  reflection: FollowUpReflection;
  otherName: string;
  onHelpMeSayIt: () => void;
  onResolved: () => void;
};

// F19: private, time-based reflection prompt, 24+ hours after a real
// back-and-forth conversation. No message content is read anywhere in
// this component or its data source, only that a reflection is due for
// this connection. "Help me say it" reuses ReplyAssistPanel (F18)
// unchanged, it already does exactly what this option needs: the user's
// own words first, a Claude draft from them, edit, then send, nothing
// here needed its own Edge Function.
export function FollowUpReflectionCard({ reflection, otherName, onHelpMeSayIt, onResolved }: Props) {
  const handleOwnWay = async () => {
    await dismissReflection(reflection.id);
    onResolved();
  };

  const handleDismiss = async () => {
    await snoozeReflection(reflection.id);
    onResolved();
  };

  return (
    <View className="gap-3 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
      <Text className="text-body text-stone-700 dark:text-stone-300">{reflectionPrompt(otherName)}</Text>
      <View className="flex-row flex-wrap gap-2">
        <Pressable
          onPress={onHelpMeSayIt}
          className="rounded-full border border-stone-900 bg-stone-900 px-4 py-2 dark:border-stone-50 dark:bg-stone-50">
          <Text className="text-caption font-semibold text-stone-50 dark:text-stone-900">Help me say it</Text>
        </Pressable>
        <Pressable onPress={handleOwnWay} className="rounded-full border border-stone-300 px-4 py-2 dark:border-stone-700">
          <Text className="text-caption font-semibold text-stone-600 dark:text-stone-300">
            I&apos;ll reach out my own way
          </Text>
        </Pressable>
        <Pressable onPress={handleDismiss} className="rounded-full border border-stone-300 px-4 py-2 dark:border-stone-700">
          <Text className="text-caption font-semibold text-stone-600 dark:text-stone-300">Dismiss</Text>
        </Pressable>
      </View>
    </View>
  );
}
