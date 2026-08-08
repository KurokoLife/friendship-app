import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  EMPTY_EXPERIENCE,
  WHAT_HELPED_PENDING_COPY,
  WHEN_UNCERTAIN_PENDING_COPY,
  type FriendshipExperience,
} from '@/lib/friendship-experience';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400

// Scenario-based Big Five screener. Warm, plain-language questions for
// adults navigating life transitions, not academic trait statements. Scores
// calibrate app behavior (nudging frequency, prompt tone, etc.) and are
// never shown back to the user, along with no trait names or numbers.
type Trait = 'extraversion' | 'agreeableness' | 'conscientiousness' | 'neuroticism' | 'openness';

type BigFiveQuestion = {
  id: number;
  trait: Trait;
  prompt: string;
  options: { label: string; score: number }[];
};

// Five options per question, a genuine spectrum rather than "somewhat"
// versions of two extremes. Options are listed calmest/most-regulated to
// most-affected for questions 7 and 8 (neuroticism), so unlike every other
// question, option 1 scores 1 and option 5 scores 5 there, the reverse of
// the usual "option 1 = 5, option 5 = 1" pattern. This is deliberate, not
// an error: AGENTS.md defines "high N = gentler prompt framing," which only
// works if a higher neuroticism score actually means more reactive, not
// calmer. Every other question follows option 1 = 5 down to option 5 = 1.
// Not a validated instrument; worth revisiting if calibration feels off in
// practice.
// Exported so the Profile tab's "View my personality reflection" (Fix 4)
// can reconstruct {question, answer} pairs from the stored responses
// (big_five_scores.responses only stores {questionId: answerLabel}, not
// the question text) to regenerate the narrative on demand, without
// duplicating all 10 questions a second time.
export const QUESTIONS: BigFiveQuestion[] = [
  {
    id: 1,
    trait: 'extraversion',
    prompt: "After a full day of social plans, you're more likely to feel...",
    options: [
      { label: 'Completely energized, ready for more', score: 5 },
      { label: 'Pretty good, could do a bit more', score: 4 },
      { label: 'Satisfied but ready to wind down', score: 3 },
      { label: 'A bit drained, need some quiet', score: 2 },
      { label: 'Exhausted, need real alone time', score: 1 },
    ],
  },
  {
    id: 2,
    trait: 'extraversion',
    prompt: 'Your ideal Friday night looks like...',
    options: [
      { label: 'Out with a group, the more the better', score: 5 },
      { label: 'Plans with a few good people', score: 4 },
      { label: 'Either works depending on my mood', score: 3 },
      { label: 'Something low-key with one person', score: 2 },
      { label: 'Quiet night in on my own', score: 1 },
    ],
  },
  {
    id: 3,
    trait: 'conscientiousness',
    prompt: 'When you make plans with someone, you...',
    options: [
      { label: 'Almost always follow through no matter what', score: 5 },
      { label: 'Follow through unless something important comes up', score: 4 },
      { label: 'Usually follow through but life happens', score: 3 },
      { label: 'Sometimes need to reschedule, I try to give notice', score: 2 },
      { label: 'Struggle to commit, my schedule shifts a lot', score: 1 },
    ],
  },
  {
    id: 4,
    trait: 'conscientiousness',
    prompt: 'Your approach to your own schedule is...',
    options: [
      { label: 'I plan everything in advance and stick to it', score: 5 },
      { label: 'I plan ahead but stay flexible when needed', score: 4 },
      { label: 'Somewhere in between planned and spontaneous', score: 3 },
      { label: 'I prefer to keep things loose and see how I feel', score: 2 },
      { label: 'I go with the flow and figure it out as I go', score: 1 },
    ],
  },
  {
    id: 5,
    trait: 'agreeableness',
    prompt: 'A friend is going through something hard. Your instinct is to...',
    options: [
      { label: 'Reach out immediately, I want to be there right away', score: 5 },
      { label: 'Check in soon after I hear about it', score: 4 },
      { label: 'Give it a day or two then reach out', score: 3 },
      { label: 'Give them space and wait for them to come to me', score: 2 },
      { label: 'Let them reach out when they are ready', score: 1 },
    ],
  },
  {
    id: 6,
    trait: 'agreeableness',
    prompt: 'When you disagree with someone, you usually...',
    options: [
      { label: 'Say something directly and work through it', score: 5 },
      { label: 'Bring it up but try to keep it low-key', score: 4 },
      { label: 'Depends on how much the issue matters to me', score: 3 },
      { label: 'Usually let smaller things go to keep the peace', score: 2 },
      { label: 'Rarely bring it up, I prefer to avoid conflict', score: 1 },
    ],
  },
  {
    id: 7,
    trait: 'neuroticism',
    prompt: 'When a friend cancels last minute, your first reaction is...',
    options: [
      { label: 'Totally fine, genuinely no issue at all', score: 1 },
      { label: 'Slight disappointment but I move on quickly', score: 2 },
      { label: 'A bit disappointed, takes me a moment', score: 3 },
      { label: 'Noticeably disappointed, affects my mood for a bit', score: 4 },
      { label: 'Quite bothered, I find myself wondering if something is off', score: 5 },
    ],
  },
  {
    id: 8,
    trait: 'neuroticism',
    prompt: 'When something stressful comes up unexpectedly, you tend to...',
    options: [
      { label: 'Handle it calmly and move on without much trouble', score: 1 },
      { label: 'Feel it briefly but get back to normal quickly', score: 2 },
      { label: 'Take a little while to process before settling', score: 3 },
      { label: 'Feel it for a while before things level out', score: 4 },
      { label: 'Find it takes me significant time to recover', score: 5 },
    ],
  },
  {
    id: 9,
    trait: 'openness',
    prompt: 'Your ideal friendship involves...',
    options: [
      { label: 'Constantly exploring new things and experiences together', score: 5 },
      { label: 'Mostly new adventures with some familiar comfort', score: 4 },
      { label: 'A mix of new experiences and comfortable routines', score: 3 },
      { label: 'Mostly familiar and comfortable with occasional new things', score: 2 },
      { label: 'Consistent comfortable routines we both enjoy', score: 1 },
    ],
  },
  {
    id: 10,
    trait: 'openness',
    prompt: 'When a friend suggests something totally new to you, you...',
    options: [
      { label: 'Usually say yes right away, I love trying new things', score: 5 },
      { label: 'Lean toward yes and ask a few questions first', score: 4 },
      { label: 'Think it through before deciding', score: 3 },
      { label: 'Usually need some convincing before I try something new', score: 2 },
      { label: 'Prefer to stick with what I know works for me', score: 1 },
    ],
  },
];

// "Your experience with new friendship" no longer lives in this screen.
// 2026-07-28: moved from an onboarding-only phase here to a post-first-
// message trigger. 2026-08-08: moved back into onboarding, as its own real
// route (src/app/friendship-experience.tsx), reached via this screen's own
// Continue button below for a fresh (non-edit-mode) run. See
// src/lib/friendship-experience.ts for the question data, types, and
// saveFriendshipExperience, shared between that screen and this one (this
// screen still needs to know whether it's already been answered, to
// decide whether to pass it into fetchNarrative on a retake, since a
// retake never routes through the friendship-experience screen at all).

type Scores = Record<Trait, number>;

function computeScores(responses: Record<number, string>): Scores {
  const scoreFor = (q: BigFiveQuestion) => {
    const label = responses[q.id];
    return q.options.find((o) => o.label === label)?.score ?? 3;
  };
  const traitScore = (trait: Trait) => {
    const qs = QUESTIONS.filter((q) => q.trait === trait);
    const total = qs.reduce((sum, q) => sum + scoreFor(q), 0);
    return Math.round((total / qs.length) * 100) / 100;
  };
  return {
    extraversion: traitScore('extraversion'),
    agreeableness: traitScore('agreeableness'),
    conscientiousness: traitScore('conscientiousness'),
    neuroticism: traitScore('neuroticism'),
    openness: traitScore('openness'),
  };
}

function OptionRow({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`rounded-xl border px-4 py-3 ${
        selected
          ? 'border-stone-900 bg-stone-900 dark:border-stone-50 dark:bg-stone-50'
          : 'border-stone-300 dark:border-stone-700'
      }`}>
      <Text
        className={`text-body ${
          selected ? 'text-stone-50 dark:text-stone-900' : 'text-stone-900 dark:text-stone-50'
        }`}>
        {label}
      </Text>
    </Pressable>
  );
}

export default function BigFiveAssessmentScreen() {
  // Fix 4: reachable from the Profile tab's edit mode to retake the
  // assessment ("?from=profile"), overwriting big_five_scores and
  // regenerating the narrative, same screen either way, just a different
  // destination once it's done.
  const { from } = useLocalSearchParams<{ from?: string }>();
  const isEditMode = from === 'profile';
  const [phase, setPhase] = useState<'questions' | 'results'>('questions');
  const [responses, setResponses] = useState<Record<number, string>>({});
  // Whether profiles.friendship_experience already has real data. For a
  // fresh (non-edit-mode) run reaching this results screen, this is always
  // false, the new friendship-experience onboarding screen that collects
  // it hasn't happened yet at this point, it's the very next step. True
  // here only for an edit-mode retake of an account that already
  // completed onboarding (and therefore already answered it once). Drives
  // whether fetchNarrative can include it, and whether the results screen
  // shows real "what helped"/"when uncertain" content or the pending copy.
  const [experience, setExperience] = useState<FriendshipExperience>(EMPTY_EXPERIENCE);
  const [hasStoredExperience, setHasStoredExperience] = useState(false);
  const [loaded, setLoaded] = useState(false);
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
      const { data } = await supabase
        .from('profiles')
        .select('big_five_scores, friendship_experience')
        .eq('user_id', user.id)
        .maybeSingle();
      const stored = data?.big_five_scores as { responses?: Record<string, string> } | null;
      if (stored?.responses) {
        const restored: Record<number, string> = {};
        for (const [id, label] of Object.entries(stored.responses)) {
          restored[Number(id)] = label;
        }
        setResponses(restored);
      }
      const storedExperience = data?.friendship_experience as Partial<FriendshipExperience> | null;
      if (storedExperience) {
        setExperience({ ...EMPTY_EXPERIENCE, ...storedExperience });
        setHasStoredExperience(true);
      }
      setLoaded(true);
    })();
  }, []);

  const answeredCount = Object.keys(responses).length;
  const allAnswered = answeredCount === QUESTIONS.length;

  // Includes friendshipExperience only when it's genuinely on file already
  // (answered via the post-first-message modal or the 7-day backstop, not
  // collected by this screen anymore). The results screen below reads
  // hasStoredExperience directly to decide whether to show the real
  // whatHelped/whenUncertain text this call returns, or the pending copy,
  // since the server itself can't tell "no evidence yet" apart from "no
  // evidence ever" and doesn't need to, see src/lib/friendship-experience.ts.
  const fetchNarrative = async () => {
    setNarrativeLoading(true);
    setNarrativeError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke(
        'generate-personality-narrative',
        {
          body: {
            answers: QUESTIONS.map((q) => ({ question: q.prompt, answer: responses[q.id] })),
            ...(hasStoredExperience ? { friendshipExperience: experience } : {}),
            // 2026-07-29: retake cap (1/day, both tiers) applies only to
            // the ?from=profile retake path, never the one-time onboarding
            // call, see AGENTS.md's F6/F11 caps entry.
            context: isEditMode ? 'retake' : 'onboarding',
          },
        }
      );
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
      setNarrativeError(
        "We couldn't put your reflection into words just yet, but your answers are saved and already helping us tune things for you."
      );
    } finally {
      setNarrativeLoading(false);
    }
  };

  const handleFinishQuestions = async () => {
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

    const scores = computeScores(responses);
    const { error: saveError } = await supabase
      .from('profiles')
      .upsert({ user_id: user.id, big_five_scores: { scores, responses } });

    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }

    // The "Your experience with new friendship" phase that used to sit
    // directly inside this screen is gone (moved through a post-first-
    // message trigger 2026-07-28, then to its own onboarding route
    // 2026-08-08, see src/app/friendship-experience.tsx). Both fresh
    // onboarding and edit-mode retakes go straight to this results phase
    // the same way; a fresh run's own Continue button below is what routes
    // to the new screen next, an edit-mode retake never does.
    setPhase('results');
    fetchNarrative();
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
                    <Text className="text-title text-stone-900 dark:text-stone-50">
                      How you tend to connect
                    </Text>
                    <Text className="text-body text-stone-700 dark:text-stone-300">{connectionStyle}</Text>
                  </View>
                  <View className="gap-2">
                    <Text className="text-title text-stone-900 dark:text-stone-50">
                      What has helped before
                    </Text>
                    <Text className="text-body text-stone-700 dark:text-stone-300">
                      {hasStoredExperience ? whatHelped : WHAT_HELPED_PENDING_COPY}
                    </Text>
                  </View>
                  <View className="gap-2">
                    <Text className="text-title text-stone-900 dark:text-stone-50">
                      When things feel uncertain
                    </Text>
                    <Text className="text-body text-stone-700 dark:text-stone-300">
                      {hasStoredExperience ? whenUncertain : WHEN_UNCERTAIN_PENDING_COPY}
                    </Text>
                  </View>
                </>
              )}
              {!narrativeLoading && narrativeError && (
                <Text className="text-body text-stone-500 dark:text-stone-400">
                  {narrativeError}
                </Text>
              )}
            </View>
          </ScrollView>

          <Pressable
            onPress={() => router.replace(isEditMode ? '/profile' : '/friendship-experience')}
            className="items-center rounded-full bg-stone-900 py-4 active:opacity-80 dark:bg-stone-50">
            <Text className="text-body font-semibold text-stone-50 dark:text-stone-900">
              {isEditMode ? 'Done' : 'Continue'}
            </Text>
          </Pressable>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-stone-50 dark:bg-stone-900">
      <SafeAreaView className="flex-1">
        <ScrollView contentContainerClassName="gap-5 px-6 pb-6 pt-10">
          <Pressable onPress={() => router.replace(isEditMode ? '/profile' : '/profile-build')}>
            <Text className="text-caption text-stone-500 dark:text-stone-400">Back</Text>
          </Pressable>

          <View className="gap-3">
            <Text className="text-display text-stone-900 dark:text-stone-50">
              A few quick reflections
            </Text>
            <Text className="text-body text-stone-500 dark:text-stone-400">
              There&apos;s no right answer here. Just go with your gut. This helps us get your
              rhythm right, like how often we check in and how we word things. We&apos;ll never
              show you a score or a label. This stays behind the scenes.
            </Text>
            <Text className="text-caption text-stone-400 dark:text-stone-600">
              {answeredCount} of {QUESTIONS.length} answered
            </Text>
          </View>

          {QUESTIONS.map((question) => (
            <View
              key={question.id}
              className="gap-3 rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-stone-800">
              <Text className="text-title text-stone-900 dark:text-stone-50">
                {question.prompt}
              </Text>
              <View className="gap-2">
                {question.options.map((option) => (
                  <OptionRow
                    key={option.label}
                    label={option.label}
                    selected={responses[question.id] === option.label}
                    onPress={() =>
                      setResponses((prev) => ({ ...prev, [question.id]: option.label }))
                    }
                  />
                ))}
              </View>
            </View>
          ))}
        </ScrollView>

        <View className="gap-3 border-t border-stone-200 bg-stone-50 px-6 pb-6 pt-4 dark:border-stone-800 dark:bg-stone-900">
          {!isSupabaseConfigured && (
            <Text className="text-caption text-amber-600 dark:text-amber-400">
              Supabase isn&apos;t configured yet. See .env.example.
            </Text>
          )}
          {error && <Text className="text-caption text-red-600 dark:text-red-400">{error}</Text>}
          <Pressable
            onPress={handleFinishQuestions}
            disabled={!allAnswered || saving || !isSupabaseConfigured}
            className={`flex-row items-center justify-center gap-2 rounded-full bg-stone-900 py-4 active:opacity-80 dark:bg-stone-50 ${
              !allAnswered || saving || !isSupabaseConfigured ? 'opacity-40' : ''
            }`}>
            {saving && <ActivityIndicator color={MUTED_ICON_COLOR} />}
            <Text className="text-body font-semibold text-stone-50 dark:text-stone-900">
              {allAnswered ? 'Continue' : `Answer all ${QUESTIONS.length} to continue`}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}
