import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GuideVideoPlayer } from '@/components/guide-video-player';
import { ModuleChoiceRow } from '@/components/module-choice-row';
import { VideoPlaceholder } from '@/components/video-placeholder';
import { getModuleVideoUrl } from '@/lib/module-videos';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { MODULES as ALL_MODULES } from '@/lib/modules-data';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400
const ACCENT_COLOR = '#B5643B'; // accent-500

// F7: mandatory, cannot skip, these are the app's quality filter (AGENTS.md).
// Modules are a video placeholder for now (real video generation comes
// later); the warm text card carries the actual content until then. Each
// module ends in one real scenario with two choices. Picking either one
// completes the module: the right choice gets a brief reinforcement, the
// wrong one gets a perspective shift showing what the other person
// experiences. That's the teaching moment, not a forced retry, so there's
// no "take another look" gate here.
//
// Content lives in src/lib/modules-data.ts (shared with F8's module
// library) so the two mandatory modules can't drift from how they're
// described on the library cards.
const MODULES = ALL_MODULES.filter((m) => m.mandatory);

export default function EtiquetteModulesScreen() {
  const [step, setStep] = useState(0);
  const [selections, setSelections] = useState<(string | null)[]>([null, null]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const module = MODULES[step];
  const selectedLabel = selections[step];
  const selectedChoice = module.scenario.choices.find((c) => c.label === selectedLabel);
  const hasAnswered = selectedChoice !== undefined;

  const handleSelect = (label: string) => {
    const next = [...selections];
    next[step] = label;
    setSelections(next);
  };

  const handleBack = () => {
    setError(null);
    setStep((current) => Math.max(0, current - 1));
  };

  const handleContinue = async () => {
    if (!hasAnswered) return;

    if (step < MODULES.length - 1) {
      setStep((current) => current + 1);
      return;
    }

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

    const etiquetteModules = Object.fromEntries(MODULES.map((m) => [m.id, true]));
    const { error: saveError } = await supabase
      .from('users')
      .upsert({ id: user.id, etiquette_modules: etiquetteModules });

    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }

    router.replace('/readiness-commitment');
  };

  return (
    <View className="flex-1 bg-stone-50 dark:bg-stone-900">
      <SafeAreaView className="flex-1">
        <View className="gap-2 px-6 pt-10">
          <View className="flex-row items-center justify-between">
            {step > 0 ? (
              <Pressable onPress={handleBack}>
                <Text className="text-caption text-stone-500 dark:text-stone-400">Back</Text>
              </Pressable>
            ) : (
              <View />
            )}
            <Text className="text-caption text-stone-400 dark:text-stone-600">
              Module {step + 1} of {MODULES.length}
            </Text>
          </View>
          <View className="flex-row gap-2">
            {MODULES.map((m, index) => (
              <View
                key={m.id}
                className={`h-1.5 flex-1 rounded-full ${
                  index <= step ? 'bg-stone-900 dark:bg-stone-50' : 'bg-stone-200 dark:bg-stone-700'
                }`}
              />
            ))}
          </View>
        </View>

        <ScrollView contentContainerClassName="gap-5 px-6 pb-6 pt-5">
          <Text className="text-display text-stone-900 dark:text-stone-50">{module.title}</Text>

          {getModuleVideoUrl(module.id) ? (
            <GuideVideoPlayer uri={getModuleVideoUrl(module.id)!} />
          ) : (
            <VideoPlaceholder label={module.title} />
          )}

          <View className="gap-3 rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-stone-800">
            {module.concept.map((paragraph) => (
              <Text key={paragraph} className="text-body text-stone-700 dark:text-stone-300">
                {paragraph}
              </Text>
            ))}
          </View>

          <View className="gap-3">
            <Text className="text-title text-stone-900 dark:text-stone-50">
              {module.scenario.prompt}
            </Text>
            <View className="gap-2">
              {module.scenario.choices.map((choice) => (
                <ModuleChoiceRow
                  key={choice.label}
                  label={choice.label}
                  selected={selectedLabel === choice.label}
                  onPress={() => handleSelect(choice.label)}
                />
              ))}
            </View>
            {hasAnswered && (
              <View className="flex-row items-start gap-2 rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
                <Ionicons
                  name={selectedChoice.correct ? 'checkmark-circle' : 'sparkles'}
                  size={18}
                  color={selectedChoice.correct ? ACCENT_COLOR : MUTED_ICON_COLOR}
                />
                <Text className="flex-1 text-caption text-stone-600 dark:text-stone-300">
                  {selectedChoice.feedback}
                </Text>
              </View>
            )}
          </View>
        </ScrollView>

        <View className="gap-3 border-t border-stone-200 bg-stone-50 px-6 pb-6 pt-4 dark:border-stone-800 dark:bg-stone-900">
          {!isSupabaseConfigured && (
            <Text className="text-caption text-amber-600 dark:text-amber-400">
              Supabase isn&apos;t configured yet. See .env.example.
            </Text>
          )}
          {error && <Text className="text-caption text-red-600 dark:text-red-400">{error}</Text>}
          <Pressable
            onPress={handleContinue}
            disabled={!hasAnswered || saving || !isSupabaseConfigured}
            className={`flex-row items-center justify-center gap-2 rounded-full bg-stone-900 py-4 active:opacity-80 dark:bg-stone-50 ${
              !hasAnswered || saving || !isSupabaseConfigured ? 'opacity-40' : ''
            }`}>
            {saving && <ActivityIndicator color={MUTED_ICON_COLOR} />}
            <Text className="text-body font-semibold text-stone-50 dark:text-stone-900">
              {saving ? 'Saving...' : step < MODULES.length - 1 ? 'Continue' : 'Done'}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}
