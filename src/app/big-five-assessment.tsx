import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  allExperienceAnswered,
  EMPTY_EXPERIENCE,
  EXPERIENCE_QUESTIONS,
  type ExperienceMultiKey,
  type ExperienceSingleKey,
  type FriendshipExperience,
} from '@/lib/friendship-experience';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400

// "How you connect" (rebuilt 2026-10-18): six private questions about
// friendship habits. The four generic personality questions and the
// written summary are gone. Answers show only on the person's own Profile
// ("You as a friend"), never to anyone else, never used for matching.
// The route keeps its old name (big-five-assessment) so links still work.

function OptionRow({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      className={`rounded-xl border px-4 py-3 ${
        selected ? 'border-stone-900 bg-stone-900 dark:border-stone-50 dark:bg-stone-50' : 'border-stone-300 dark:border-stone-700'
      }`}>
      <Text className={`text-body ${selected ? 'text-stone-50 dark:text-stone-900' : 'text-stone-900 dark:text-stone-50'}`}>
        {label}
      </Text>
    </Pressable>
  );
}

export default function HowYouConnectScreen() {
  const { from } = useLocalSearchParams<{ from?: string }>();
  const isEditMode = from === 'profile';
  const [experience, setExperience] = useState<FriendshipExperience>(EMPTY_EXPERIENCE);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!isSupabaseConfigured) {
        setLoaded(true);
        return;
      }
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const { data } = await supabase.from('profiles').select('friendship_experience').eq('user_id', user.id).maybeSingle();
        const stored = data?.friendship_experience as Partial<FriendshipExperience> | null;
        if (stored) setExperience({ ...EMPTY_EXPERIENCE, ...stored });
      }
      setLoaded(true);
    })();
  }, []);

  const answered = EXPERIENCE_QUESTIONS.filter((q) =>
    q.type === 'multi' ? experience[q.key].length > 0 : experience[q.key] !== null
  ).length;
  const allAnswered = allExperienceAnswered(experience);

  const toggleMulti = (key: ExperienceMultiKey, option: string) =>
    setExperience((prev) => {
      const current = prev[key];
      return { ...prev, [key]: current.includes(option) ? current.filter((o) => o !== option) : [...current, option] };
    });
  const setSingle = (key: ExperienceSingleKey, option: string) => setExperience((prev) => ({ ...prev, [key]: option }));

  const onContinue = async () => {
    if (!allAnswered) return;
    setError(null);
    setSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSaving(false);
      setError('Your session expired. Please verify your phone number again.');
      return;
    }
    const { error: saveError } = await supabase
      .from('profiles')
      .upsert({ user_id: user.id, friendship_experience: experience });
    setSaving(false);
    if (saveError) {
      setError('Something went wrong saving that. Try again.');
      return;
    }
    router.replace(isEditMode ? '/profile' : '/profile-build?from=photo');
  };

  if (!loaded) {
    return (
      <View className="flex-1 items-center justify-center bg-stone-50 dark:bg-stone-900">
        <ActivityIndicator color={MUTED_ICON_COLOR} />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-stone-50 dark:bg-stone-900">
      <SafeAreaView className="flex-1">
        <ScrollView contentContainerClassName="gap-5 px-6 pb-6 pt-10">
          <Pressable onPress={() => router.replace(isEditMode ? '/profile' : '/gender-identity')} className="self-start">
            <Text className="text-caption text-stone-500 dark:text-stone-400">Back</Text>
          </Pressable>

          <View className="gap-3">
            <Text className="text-display text-stone-900 dark:text-stone-50">How you connect</Text>
            <Text className="text-body text-stone-500 dark:text-stone-400">
              A few questions about how friendships tend to go for you. No right answers. Only you see your answers, on
              your own profile, and they&apos;re never used to pick who you meet.
            </Text>
          </View>

          {EXPERIENCE_QUESTIONS.map((question) => (
            <View
              key={question.key}
              className="gap-3 rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-stone-800">
              <Text className="text-title text-stone-900 dark:text-stone-50">{question.prompt}</Text>
              {question.type === 'multi' && (
                <Text className="text-caption text-stone-500 dark:text-stone-400">Choose any that fit</Text>
              )}
              <View className="gap-2">
                {question.options.map((option) =>
                  question.type === 'multi' ? (
                    <OptionRow
                      key={option}
                      label={option}
                      selected={experience[question.key].includes(option)}
                      onPress={() => toggleMulti(question.key, option)}
                    />
                  ) : (
                    <OptionRow
                      key={option}
                      label={option}
                      selected={experience[question.key] === option}
                      onPress={() => setSingle(question.key, option)}
                    />
                  )
                )}
              </View>
            </View>
          ))}
        </ScrollView>

        <View className="gap-3 border-t border-stone-200 bg-stone-50 px-6 pb-6 pt-4 dark:border-stone-800 dark:bg-stone-900">
          {error && <Text className="text-caption text-red-600 dark:text-red-400">{error}</Text>}
          <Pressable
            onPress={onContinue}
            disabled={!allAnswered || saving || !isSupabaseConfigured}
            className={`flex-row items-center justify-center gap-2 rounded-full bg-stone-900 py-4 active:opacity-80 dark:bg-stone-50 ${
              !allAnswered || saving || !isSupabaseConfigured ? 'opacity-40' : ''
            }`}>
            {saving && <ActivityIndicator color={MUTED_ICON_COLOR} />}
            <Text className="text-body font-semibold text-stone-50 dark:text-stone-900">
              {allAnswered ? (isEditMode ? 'Save' : 'Continue') : `${answered} of ${EXPERIENCE_QUESTIONS.length} answered`}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}
