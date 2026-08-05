import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
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
import { supabase } from '@/lib/supabase';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400

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

type Props = {
  visible: boolean;
  userId: string;
  // The 10 stored Big Five responses ({questionId: answerLabel}), needed
  // to regenerate a full three-section reflection right after answering,
  // reconstructed the same way profile.tsx's own retake flow already
  // does. Null only if this somehow fires before that data exists, in
  // practice shouldn't happen since the eligibility check itself requires
  // onboarding to be complete.
  bigFiveResponses: Record<number, string> | null;
  onClose: () => void;
};

type Phase = 'questions' | 'results';

// "Your experience with new friendship," moved 2026-07-28 from an
// onboarding-only phase in big-five-assessment.tsx to this post-first-
// message trigger (see src/lib/friendship-experience.ts's
// shouldShowFriendshipExperiencePrompt and home.tsx for where this is
// shown from). Same five questions, same private/never-shared/never-
// scored contract, just asked once there's an actual friendship to
// reflect on rather than before one exists. Answering immediately
// regenerates and shows the full three-section reflection in place, so
// "what has helped"/"when uncertain" visibly go from pending copy to
// real, grounded content in the same interaction.
export function FriendshipExperienceModal({ visible, userId, bigFiveResponses, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>('questions');
  const [experience, setExperience] = useState<FriendshipExperience>(EMPTY_EXPERIENCE);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionStyle, setConnectionStyle] = useState<string | null>(null);
  const [whatHelped, setWhatHelped] = useState<string | null>(null);
  const [whenUncertain, setWhenUncertain] = useState<string | null>(null);
  const [narrativeLoading, setNarrativeLoading] = useState(false);
  const [narrativeError, setNarrativeError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setPhase('questions');
      setExperience(EMPTY_EXPERIENCE);
      setError(null);
      setConnectionStyle(null);
      setWhatHelped(null);
      setWhenUncertain(null);
      setNarrativeError(null);
    }
  }, [visible]);

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
    if (!allExperienceAnswered(experience)) return;
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

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-stone-50 dark:bg-stone-900">
        <SafeAreaView className="flex-1">
          {phase === 'questions' && (
            <>
              <ScrollView contentContainerClassName="gap-5 px-6 pb-6 pt-10">
                <View className="gap-3">
                  <Text className="text-display text-stone-900 dark:text-stone-50">
                    Your experience with new friendship
                  </Text>
                  <Text className="text-body text-stone-500 dark:text-stone-400">
                    Now that you&apos;ve started connecting with someone, these questions help the app
                    understand where things have felt natural, uncertain, or difficult for you. There
                    are no right answers.
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
                <Pressable onPress={onClose} className="items-center py-1">
                  <Text className="text-caption text-stone-400 dark:text-stone-600">Not now</Text>
                </Pressable>
              </View>
            </>
          )}

          {phase === 'results' && (
            <>
              <ScrollView contentContainerClassName="gap-5 px-6 pb-6 pt-10">
                <View className="gap-2">
                  <Text className="text-display text-stone-900 dark:text-stone-50">
                    A little about how you connect
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

              <View className="border-t border-stone-200 bg-stone-50 px-6 pb-6 pt-4 dark:border-stone-800 dark:bg-stone-900">
                <Pressable
                  onPress={onClose}
                  className="items-center rounded-full bg-stone-900 py-4 active:opacity-80 dark:bg-stone-50">
                  <Text className="text-body font-semibold text-stone-50 dark:text-stone-900">Done</Text>
                </Pressable>
              </View>
            </>
          )}
        </SafeAreaView>
      </View>
    </Modal>
  );
}
