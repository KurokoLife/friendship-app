import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { QUESTIONS } from '@/app/big-five-assessment';
import {
  allExperienceAnswered,
  EMPTY_EXPERIENCE,
  EXPERIENCE_QUESTIONS,
  saveFriendshipExperience,
  type ExperienceMultiKey,
  type ExperienceSingleKey,
  type FriendshipExperience,
} from '@/lib/friendship-experience';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400

// "Your experience with new friendship": moved back into onboarding
// (2026-08-08), converted from FriendshipExperienceModal (a post-first-
// message overlay, 2026-07-28 through 2026-08-08) into a real onboarding
// route, matching every other step in this chain (big-five-assessment,
// etiquette-modules, etc.). Fires exactly once, right after Big Five
// completes, before etiquette-modules. No skip/"Not now" option, unlike
// the modal it replaces: every other required onboarding step in this app
// (Big Five itself included) has no skip either, and this is no longer an
// interruption of something else the user was doing, it's the next step
// in a sequence they're already moving through.
//
// The two-phase (questions -> results) structure and the results phase's
// own regenerate-the-reflection call are carried over unchanged from the
// modal, same reasoning: answering immediately regenerates and shows the
// full three-section reflection in place, so "what has helped"/"when
// uncertain" visibly go from the pending copy Big Five's own results
// screen just showed moments earlier to real, grounded content, in the
// same onboarding pass rather than the user never seeing it update again
// until they happen to revisit their Profile tab.
function OptionRow({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className={`rounded-xl border px-4 py-3 ${
        selected
          ? 'border-stone-900 bg-stone-900 dark:border-stone-50 dark:bg-stone-50'
          : 'border-stone-300 dark:border-stone-700'
      }`}>
      <Text className={`text-body ${selected ? 'text-stone-50 dark:text-stone-900' : 'text-stone-900 dark:text-stone-50'}`}>
        {label}
      </Text>
    </Pressable>
  );
}

type Phase = 'questions' | 'results';

export default function FriendshipExperienceScreen() {
  const [phase, setPhase] = useState<Phase>('questions');
  const [userId, setUserId] = useState<string | null>(null);
  const [bigFiveResponses, setBigFiveResponses] = useState<Record<number, string> | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [experience, setExperience] = useState<FriendshipExperience>(EMPTY_EXPERIENCE);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionStyle, setConnectionStyle] = useState<string | null>(null);
  const [whatHelped, setWhatHelped] = useState<string | null>(null);
  const [whenUncertain, setWhenUncertain] = useState<string | null>(null);
  const [narrativeLoading, setNarrativeLoading] = useState(false);
  const [narrativeError, setNarrativeError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoaded(true);
      return;
    }
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoaded(true);
        return;
      }
      setUserId(user.id);
      const { data } = await supabase
        .from('profiles')
        .select('big_five_scores')
        .eq('user_id', user.id)
        .maybeSingle();
      const stored = (data?.big_five_scores as { responses?: Record<string, string> } | null)?.responses;
      setBigFiveResponses(
        stored ? Object.fromEntries(Object.entries(stored).map(([id, label]) => [Number(id), label])) : null
      );
      setLoaded(true);
    })();
  }, []);

  const toggleMulti = (key: ExperienceMultiKey, option: string) => {
    setExperience((prev) => {
      const current = prev[key];
      const next = current.includes(option) ? current.filter((o) => o !== option) : [...current, option];
      return { ...prev, [key]: next };
    });
  };

  const setSingle = (key: ExperienceSingleKey, option: string) => {
    setExperience((prev) => ({ ...prev, [key]: option }));
  };

  const handleFinish = async () => {
    if (!allExperienceAnswered(experience) || !userId) return;
    setError(null);
    setSaving(true);
    try {
      await saveFriendshipExperience(userId, experience);
    } catch {
      setSaving(false);
      setError("Couldn't save that right now. Please try again.");
      return;
    }
    setSaving(false);
    setPhase('results');

    setNarrativeLoading(true);
    setNarrativeError(null);
    try {
      const answers = bigFiveResponses
        ? QUESTIONS.map((q) => ({ question: q.prompt, answer: bigFiveResponses[q.id] }))
        : [];
      const { data, error: fnError } = await supabase.functions.invoke('generate-personality-narrative', {
        body: { answers, friendshipExperience: experience, context: 'retake' },
      });
      if (data?.blocked) {
        setNarrativeError(data.message as string);
        return;
      }
      if (fnError || !data?.connectionStyle || !data?.whatHelped || !data?.whenUncertain) {
        throw fnError ?? new Error('No reflection returned');
      }
      setConnectionStyle(data.connectionStyle as string);
      setWhatHelped(data.whatHelped as string);
      setWhenUncertain(data.whenUncertain as string);
    } catch {
      setNarrativeError('Your answers are saved. Your reflection will be ready next time you check your profile.');
    } finally {
      setNarrativeLoading(false);
    }
  };

  if (!loaded) {
    return (
      <View className="flex-1 items-center justify-center bg-stone-50 dark:bg-stone-900">
        <ActivityIndicator color={MUTED_ICON_COLOR} />
      </View>
    );
  }

  if (phase === 'results') {
    return (
      <View className="flex-1 bg-stone-50 dark:bg-stone-900">
        <SafeAreaView className="flex-1 justify-between px-6 py-10">
          <ScrollView contentContainerClassName="gap-5" showsVerticalScrollIndicator={false}>
            <View className="gap-2">
              <Text className="text-display text-stone-900 dark:text-stone-50">
                A little more about how you connect
              </Text>
              <Text className="text-caption text-stone-500 dark:text-stone-400">
                This is a reflection, not a label.
              </Text>
            </View>
            <View className="gap-5 rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-stone-800">
              {narrativeLoading && (
                <View className="flex-row items-center gap-3">
                  <ActivityIndicator color={MUTED_ICON_COLOR} />
                  <Text className="text-body text-stone-500 dark:text-stone-400">
                    Getting to know your answers...
                  </Text>
                </View>
              )}
              {!narrativeLoading && connectionStyle && whatHelped && whenUncertain && (
                <>
                  <View className="gap-2">
                    <Text className="text-title text-stone-900 dark:text-stone-50">How you tend to connect</Text>
                    <Text className="text-body text-stone-700 dark:text-stone-300">{connectionStyle}</Text>
                  </View>
                  <View className="gap-2">
                    <Text className="text-title text-stone-900 dark:text-stone-50">What has helped before</Text>
                    <Text className="text-body text-stone-700 dark:text-stone-300">{whatHelped}</Text>
                  </View>
                  <View className="gap-2">
                    <Text className="text-title text-stone-900 dark:text-stone-50">When things feel uncertain</Text>
                    <Text className="text-body text-stone-700 dark:text-stone-300">{whenUncertain}</Text>
                  </View>
                </>
              )}
              {!narrativeLoading && narrativeError && (
                <Text className="text-body text-stone-500 dark:text-stone-400">{narrativeError}</Text>
              )}
            </View>
          </ScrollView>

          <Pressable
            onPress={() => router.replace('/etiquette-modules')}
            className="items-center rounded-full bg-stone-900 py-4 active:opacity-80 dark:bg-stone-50">
            <Text className="text-body font-semibold text-stone-50 dark:text-stone-900">Continue</Text>
          </Pressable>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-stone-50 dark:bg-stone-900">
      <SafeAreaView className="flex-1">
        <ScrollView contentContainerClassName="gap-5 px-6 pb-6 pt-10">
          <View className="gap-3">
            <Text className="text-display text-stone-900 dark:text-stone-50">
              Your experience with new friendship
            </Text>
            <Text className="text-body text-stone-500 dark:text-stone-400">
              A few questions about where things have felt natural, uncertain, or difficult for you
              in the past. There are no right answers.
            </Text>
          </View>

          {EXPERIENCE_QUESTIONS.map((question) => (
            <View
              key={question.key}
              className="gap-3 rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-stone-800">
              <Text className="text-title text-stone-900 dark:text-stone-50">{question.prompt}</Text>
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
            onPress={handleFinish}
            disabled={!allExperienceAnswered(experience) || saving}
            className={`flex-row items-center justify-center gap-2 rounded-full bg-stone-900 py-4 active:opacity-80 dark:bg-stone-50 ${
              !allExperienceAnswered(experience) || saving ? 'opacity-40' : ''
            }`}>
            {saving && <ActivityIndicator color={MUTED_ICON_COLOR} />}
            <Text className="text-body font-semibold text-stone-50 dark:text-stone-900">
              {saving ? 'Saving...' : allExperienceAnswered(experience) ? 'Continue' : 'Answer all to continue'}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}
