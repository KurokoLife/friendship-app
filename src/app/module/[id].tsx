import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GuideVideoPlayer } from '@/components/guide-video-player';
import { ModuleChoiceRow } from '@/components/module-choice-row';
import { VideoPlaceholder } from '@/components/video-placeholder';
import { getModule } from '@/lib/modules-data';
import { getModuleVideoUrl } from '@/lib/module-videos';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400
const ACCENT_COLOR = '#B5643B'; // accent-500

// A single module, viewed either from the Guides list (tap any title,
// anytime, done or not) or, eventually, as a contextual interstitial
// (Path 1, see contextTrigger in modules-data.ts). Same format as F7:
// video placeholder, warm text, one scenario with two choices. No lock, no
// completion gate, no "unlocked" screen, watching it again just re-saves
// the same completion flag and returns to wherever the user came from.
export default function ModuleDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const module = getModule(id);

  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!module) {
    return (
      <View className="flex-1 items-center justify-center bg-stone-50 dark:bg-stone-900 px-6">
        <Text className="text-center text-body text-stone-500 dark:text-stone-400">
          That module doesn&apos;t exist.
        </Text>
      </View>
    );
  }

  const selectedChoice = module.scenario.choices.find((c) => c.label === selectedLabel);
  const hasAnswered = selectedChoice !== undefined;

  const handleDone = async () => {
    if (!hasAnswered) return;
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

    const { data } = await supabase
      .from('users')
      .select('etiquette_modules')
      .eq('id', user.id)
      .maybeSingle();
    const existing = (data?.etiquette_modules as Record<string, boolean>) ?? {};
    const updated = { ...existing, [module.id]: true };

    const { error: saveError } = await supabase
      .from('users')
      .upsert({ id: user.id, etiquette_modules: updated });

    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }

    router.back();
  };

  return (
    <View className="flex-1 bg-stone-50 dark:bg-stone-900">
      <SafeAreaView className="flex-1">
        <View className="px-6 pt-10">
          <Pressable onPress={() => router.back()}>
            <Text className="text-caption text-stone-500 dark:text-stone-400">Back</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerClassName="gap-5 px-6 pb-6 pt-5">
          <Text className="text-display text-stone-900 dark:text-stone-50">{module.title}</Text>

          {getModuleVideoUrl(module.id) ? (
            <GuideVideoPlayer uri={getModuleVideoUrl(module.id)!} />
          ) : (
            <VideoPlaceholder />
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
                  onPress={() => setSelectedLabel(choice.label)}
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
            onPress={handleDone}
            disabled={!hasAnswered || saving || !isSupabaseConfigured}
            className={`flex-row items-center justify-center gap-2 rounded-full bg-stone-900 py-4 active:opacity-80 dark:bg-stone-50 ${
              !hasAnswered || saving || !isSupabaseConfigured ? 'opacity-40' : ''
            }`}>
            {saving && <ActivityIndicator color={MUTED_ICON_COLOR} />}
            <Text className="text-body font-semibold text-stone-50 dark:text-stone-900">
              {saving ? 'Saving...' : 'Done'}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}
