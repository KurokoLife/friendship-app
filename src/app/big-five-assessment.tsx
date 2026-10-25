import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  allExperienceAnswered,
  EMPTY_EXPERIENCE,
  EXPERIENCE_QUESTIONS,
  normalizeExperience,
  type ExperienceKey,
  type FriendshipExperience,
} from '@/lib/friendship-experience';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { palette } from '@/theme';

const MUTED_ICON_COLOR = palette.muted;

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
  // 2026-10-22: share the four questions about now with people you're
  // connected with, or keep everything private. Two equal choices, no default
  // while joining; someone who answered before keeps theirs private.
  const [share, setShare] = useState<boolean | null>(null);

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
        const { data } = await supabase
          .from('profiles')
          .select('friendship_experience, share_friendship_experience')
          .eq('user_id', user.id)
          .maybeSingle();
        if (data?.friendship_experience) {
          setExperience(normalizeExperience(data.friendship_experience));
          setShare(!!data.share_friendship_experience);
        }
      }
      setLoaded(true);
    })();
  }, []);

  const answered = EXPERIENCE_QUESTIONS.filter((q) => experience[q.key].length > 0).length;
  const allAnswered = allExperienceAnswered(experience) && share !== null;

  const toggleMulti = (key: ExperienceKey, option: string) =>
    setExperience((prev) => {
      const current = prev[key];
      return { ...prev, [key]: current.includes(option) ? current.filter((o) => o !== option) : [...current, option] };
    });

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
      .upsert({ user_id: user.id, friendship_experience: experience, share_friendship_experience: share === true });
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
          <Pressable onPress={() => router.replace(isEditMode ? '/profile' : '/gender-identity')} className="min-h-11 flex-row items-center justify-center rounded-full border px-4 active:opacity-70 border-outline dark:border-stone-600 self-start">
            <Text className="text-caption font-semibold text-stone-900 dark:text-stone-50">Back</Text>
          </Pressable>

          <View className="gap-3">
            <Text className="text-display text-stone-900 dark:text-stone-50">How you connect</Text>
            <Text className="text-body text-stone-500 dark:text-stone-400">
              A few questions about how friendships tend to go for you. No right answers. They&apos;re never used to
              pick who you meet, and at the end you choose whether people you connect with can see some of them.
            </Text>
          </View>

          {EXPERIENCE_QUESTIONS.map((question) => (
            <View
              key={question.key}
              className="gap-3 rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-stone-800">
              <Text className="text-title text-stone-900 dark:text-stone-50">{question.prompt}</Text>
              <Text className="text-caption text-stone-500 dark:text-stone-400">Choose any that fit</Text>
              <View className="gap-2">
                {question.options.map((option) => (
                  <OptionRow
                    key={option}
                    label={option}
                    selected={experience[question.key].includes(option)}
                    onPress={() => toggleMulti(question.key, option)}
                  />
                ))}
              </View>
            </View>
          ))}

          <View className="gap-3 rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-stone-800">
            <Text className="text-title text-stone-900 dark:text-stone-50">Share with people you connect with?</Text>
            <Text className="text-body text-stone-500 dark:text-stone-400">
              Knowing what feels hard for someone helps the other person make it easier. And people usually see
              this kind of sharing more kindly than the person sharing expects.
            </Text>
            <Text className="text-caption text-stone-500 dark:text-stone-400">
              If you share, only people you have a chat with see your answers to the last four questions. Never
              anyone else, and never your answers about past friendships. You can change this anytime.
            </Text>
            <View className="gap-2">
              <OptionRow label="Share with people I connect with" selected={share === true} onPress={() => setShare(true)} />
              <OptionRow label="Keep private" selected={share === false} onPress={() => setShare(false)} />
            </View>
          </View>
        </ScrollView>

        <View className="gap-3 border-t border-stone-200 bg-stone-50 px-6 pb-6 pt-4 dark:border-stone-800 dark:bg-stone-900">
          {error && <Text className="text-caption text-red-600 dark:text-red-400">{error}</Text>}
          <Pressable
            onPress={onContinue}
            disabled={!allAnswered || saving || !isSupabaseConfigured}
            className={`flex-row items-center justify-center gap-2 rounded-full bg-apricot py-4 active:opacity-80 dark:bg-apricot ${
              !allAnswered || saving || !isSupabaseConfigured ? 'opacity-40' : ''
            }`}>
            {saving && <ActivityIndicator color={MUTED_ICON_COLOR} />}
            <Text className="text-body font-semibold text-white">
              {allAnswered
                ? isEditMode
                  ? 'Save'
                  : 'Continue'
                : answered < EXPERIENCE_QUESTIONS.length
                  ? `${answered} of ${EXPERIENCE_QUESTIONS.length} answered`
                  : 'Choose whether to share'}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}
