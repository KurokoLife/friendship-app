import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from 'react-native';

import { PaddedSafeArea } from '@/components/padded-safe-area';
import { CheckRow, Pill } from '@/components/ui';
import { HARDEST_OPTIONS, HARDEST_OTHER_MAX, fetchJoining, saveJoining, type HardestKey } from '@/lib/joining';
import { palette } from '@/theme';

// "What's hardest about friendship for you right now?" (rebuild stage 2,
// 2026-10-26, wording from docs/context/05_LIMEN_REBUILD.md). Pick any, plus
// "Something else" in their own words. Private: only the person can read it
// (joining_answers, own-row RLS). Never used for matching. Saves as you go.
export default function JoiningHardestScreen() {
  const [loaded, setLoaded] = useState(false);
  const [picked, setPicked] = useState<HardestKey[]>([]);
  const [other, setOther] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const latest = useRef({ picked, other });
  latest.current = { picked, other };

  useEffect(() => {
    (async () => {
      const j = await fetchJoining();
      if (j) {
        setPicked(j.hardest ?? []);
        setOther(j.hardest_other ?? '');
      }
      setLoaded(true);
    })();
  }, []);

  const persist = async (p: HardestKey[], o: string) => {
    const ok = await saveJoining({
      hardest: p,
      hardest_other: p.includes('other') && o.trim() ? o.trim().slice(0, HARDEST_OTHER_MAX) : null,
    });
    setSaveError(!ok);
    return ok;
  };

  const toggle = (key: HardestKey) => {
    const next = picked.includes(key) ? picked.filter((k) => k !== key) : [...picked, key];
    setPicked(next);
    persist(next, latest.current.other);
  };

  const onContinue = async () => {
    setSaving(true);
    const ok = await persist(latest.current.picked, latest.current.other);
    const marked = ok && (await saveJoining({ hardest_at: new Date().toISOString() }));
    setSaving(false);
    if (!marked) {
      setSaveError(true);
      return;
    }
    router.replace('/joining-friends');
  };

  if (!loaded) {
    return (
      <View className="flex-1 items-center justify-center bg-stone-50 dark:bg-stone-900">
        <ActivityIndicator color={palette.muted} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-stone-50 dark:bg-stone-900"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <PaddedSafeArea className="flex-1">
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-6 px-6 pb-10 pt-10">
          <Pill label="Back" className="self-start" onPress={() => router.replace('/profile-basics')} />

          <View className="gap-2">
            <Text className="text-display text-stone-900 dark:text-stone-50">
              What&apos;s hardest about friendship for you right now?
            </Text>
            <Text className="text-body text-stone-600 dark:text-stone-300">
              Pick any. So Limen knows where to help first. Only you see this.
            </Text>
          </View>

          <View className="gap-2">
            {HARDEST_OPTIONS.map((o) => (
              <CheckRow key={o.key} label={o.label} checked={picked.includes(o.key)} onPress={() => toggle(o.key)} />
            ))}
          </View>

          {picked.includes('other') && (
            <View className="gap-2">
              <TextInput
                value={other}
                onChangeText={(t) => setOther(t.slice(0, HARDEST_OTHER_MAX))}
                onBlur={() => persist(latest.current.picked, latest.current.other)}
                placeholder="In your own words"
                placeholderTextColor={palette.muted}
                accessibilityLabel="Something else, in your own words"
                multiline
                className="min-h-24 rounded-2xl border border-stone-200 bg-white p-4 text-body text-stone-900 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-50"
                style={{ textAlignVertical: 'top' }}
              />
            </View>
          )}

          {saveError && (
            <Text className="text-caption text-red-700 dark:text-red-400">
              That didn&apos;t save. Check your connection and try again.
            </Text>
          )}

          <Pill label={saving ? 'Saving...' : 'Continue'} variant="filled" disabled={saving} onPress={onContinue} />
        </ScrollView>
      </PaddedSafeArea>
    </KeyboardAvoidingView>
  );
}
