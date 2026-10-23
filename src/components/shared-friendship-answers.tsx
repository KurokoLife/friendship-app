import { Text, View } from 'react-native';

import { SHARED_EXPERIENCE, type FriendshipExperience } from '@/lib/friendship-experience';

// 2026-10-22: someone's own "How you connect" answers, shared by their choice
// with people they have a chat with. Their exact choices, nothing added or
// interpreted.
export function SharedFriendshipAnswers({ answers, name }: { answers: FriendshipExperience; name: string }) {
  const rows = SHARED_EXPERIENCE.filter((s) => answers[s.key].length > 0);
  if (rows.length === 0) return null;
  return (
    <View className="gap-3 rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-stone-800">
      <View className="gap-1">
        <Text className="text-title text-stone-900 dark:text-stone-50">How {name} approaches new friendships</Text>
        <Text className="text-caption text-stone-500 dark:text-stone-400">
          {name} chose to share this with people they connect with.
        </Text>
      </View>
      {rows.map((s) => (
        <View key={s.key} className="gap-0.5">
          <Text className="text-caption text-stone-400 dark:text-stone-500">{s.label(name)}</Text>
          <Text className="text-body text-stone-700 dark:text-stone-300">{answers[s.key].join(' · ')}</Text>
        </View>
      ))}
    </View>
  );
}
