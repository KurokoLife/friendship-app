import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';

import { PATTERN_OPTIONS, fetchPatternAnswers, type PatternEntry } from '@/lib/suggestions';

// Your own answers to "What usually gets in the way?" (stage 3, 2026-10-28;
// 05: "You tab privately shows the pattern back; the person draws the
// conclusion"). Just what you answered and when: no counts, no advice.
export function PatternNotes() {
  const [entries, setEntries] = useState<PatternEntry[]>([]);

  useFocusEffect(
    useCallback(() => {
      fetchPatternAnswers().then(setEntries);
    }, [])
  );

  if (entries.length === 0) return null;
  const label = (k: PatternEntry['answer']) => PATTERN_OPTIONS.find((o) => o.key === k)?.label ?? k;

  return (
    <View
      accessibilityLabel="When you put off a check-in"
      className="gap-2 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
      <Text className="text-body font-semibold text-stone-900 dark:text-stone-50">When you put off a check-in</Text>
      <Text className="text-caption text-stone-500 dark:text-stone-400">What you said got in the way. Only you see this.</Text>
      {entries.map((e) => (
        <View key={e.created_at} className="flex-row justify-between gap-3">
          <Text className="flex-1 text-body text-stone-800 dark:text-stone-200">{label(e.answer)}</Text>
          <Text className="text-caption text-stone-500 dark:text-stone-400">
            {new Date(e.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </Text>
        </View>
      ))}
    </View>
  );
}
