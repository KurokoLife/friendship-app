import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';

import { PaddedSafeArea } from '@/components/padded-safe-area';
import { CheckRow, Pill } from '@/components/ui';
import {
  GOAL_OPTIONS,
  fetchJoining,
  finishJoiningWithoutProfile,
  goalsFromHardest,
  saveJoining,
  type GoalKey,
} from '@/lib/joining';
import { palette } from '@/theme';

// "Here's where Limen can help. Change anything you like." (rebuild stage 2,
// 2026-10-26, wording from docs/context/05_LIMEN_REBUILD.md). Filled in from
// "What's hardest" (HARDEST_TO_GOALS) until the person changes it, and saved
// as they go. "Meet someone new" leads into the profile; without it, the
// profile is skipped and they finish with Keep your account safe and All set.
export default function JoiningHelpScreen() {
  const [loaded, setLoaded] = useState(false);
  const [goals, setGoals] = useState<GoalKey[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const latest = useRef(goals);
  latest.current = goals;

  useEffect(() => {
    (async () => {
      const j = await fetchJoining();
      setGoals(j?.goals ?? goalsFromHardest(j?.hardest ?? []));
      setLoaded(true);
    })();
  }, []);

  const toggle = (key: GoalKey) => {
    const next = goals.includes(key) ? goals.filter((k) => k !== key) : [...goals, key];
    const ordered = GOAL_OPTIONS.map((g) => g.key).filter((k) => next.includes(k));
    setGoals(ordered);
    saveJoining({ goals: ordered }).then((ok) => setError(!ok));
  };

  const onContinue = async () => {
    setSaving(true);
    const chosen = latest.current;
    let ok = await saveJoining({ goals: chosen, goals_at: new Date().toISOString() });
    if (ok && !chosen.includes('meet_new')) ok = await finishJoiningWithoutProfile();
    setSaving(false);
    if (!ok) {
      setError(true);
      return;
    }
    if (chosen.includes('meet_new')) router.replace('/start-with-you');
    else router.replace({ pathname: '/account-recovery', params: { from: 'joining' } });
  };

  if (!loaded) {
    return (
      <View className="flex-1 items-center justify-center bg-stone-50 dark:bg-stone-900">
        <ActivityIndicator color={palette.muted} />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-stone-50 dark:bg-stone-900">
      <PaddedSafeArea className="flex-1">
        <ScrollView contentContainerClassName="gap-6 px-6 pb-10 pt-10">
          <Pill label="Back" className="self-start" onPress={() => router.replace('/joining-friends')} />

          <View className="gap-2">
            <Text className="text-display text-stone-900 dark:text-stone-50">Here&apos;s where Limen can help.</Text>
            <Text className="text-body text-stone-600 dark:text-stone-300">Change anything you like.</Text>
          </View>

          <View className="gap-2">
            {GOAL_OPTIONS.map((g) => (
              <CheckRow key={g.key} label={g.label} checked={goals.includes(g.key)} onPress={() => toggle(g.key)} />
            ))}
          </View>

          <Text className="text-caption text-stone-500 dark:text-stone-400">
            {goals.includes('meet_new')
              ? "Next, a short profile in your own words, so the people you meet can get to know you."
              : 'You can choose Meet someone new anytime later.'}
          </Text>

          {error && (
            <Text className="text-caption text-red-700 dark:text-red-400">
              That didn&apos;t save. Check your connection and try again.
            </Text>
          )}

          <Pill
            label={saving ? 'Saving...' : 'Continue'}
            variant="filled"
            disabled={saving || goals.length === 0}
            onPress={onContinue}
          />
          {goals.length === 0 && (
            <Text className="text-caption text-stone-500 dark:text-stone-400">Pick at least one.</Text>
          )}
        </ScrollView>
      </PaddedSafeArea>
    </View>
  );
}
