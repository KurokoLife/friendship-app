import { router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MAX_AGE, MIN_AGE } from '@/lib/filter-options';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400

// Shared identity vocabulary across all three questions, so gender_identity
// and matching_preference use the same slugs and can be compared directly
// when discovery filtering (F11+) gets built: a person's gender_identity
// must be in a viewer's matching_preference for that person to appear in
// the viewer's discovery, and vice versa. No vague or opt-out option on any
// of the three, all three are required to complete F3.
const GENDER_OPTIONS: { label: string; value: string }[] = [
  { label: 'Woman', value: 'woman' },
  { label: 'Man', value: 'man' },
  { label: 'Non-binary', value: 'non_binary' },
  { label: 'Transgender', value: 'transgender' },
  { label: 'Queer', value: 'queer' },
];

const MATCHING_OPTIONS: { label: string; value: string }[] = [
  { label: 'Women', value: 'woman' },
  { label: 'Men', value: 'man' },
  { label: 'Non-binary people', value: 'non_binary' },
  { label: 'Transgender people', value: 'transgender' },
  { label: 'Queer people', value: 'queer' },
];

const MESSAGING_OPTIONS: { label: string; value: string }[] = [
  { label: 'Women', value: 'woman' },
  { label: 'Men', value: 'man' },
  { label: 'Non-binary people', value: 'non_binary' },
  { label: 'Transgender people', value: 'transgender' },
  { label: 'Queer people', value: 'queer' },
  { label: 'Anyone who matches my preference', value: 'anyone' },
  { label: 'Only people I message first', value: 'only_people_i_message_first' },
];

function OptionButton({
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

export default function GenderIdentityScreen() {
  const [step, setStep] = useState(0);
  const [gender, setGender] = useState<string | null>(null);
  const [matching, setMatching] = useState<string | null>(null);
  const [messaging, setMessaging] = useState<string | null>(null);
  // Fix #1 (July 19 reconciliation session): min/max friend age
  // preference, added as a 4th step on this existing screen rather than
  // a new one, per explicit instruction ("add alongside it, don't build
  // a new screen"). A HARD eligibility filter (discovery_profiles/
  // browse_profiles/compatible_candidates_for, 20260719000003), not a
  // scoring bonus, same tier as the gender/pause compatibility check
  // above. Defaults match profiles.min_friend_age/max_friend_age's own
  // DB defaults (18/100, effectively "open to anyone"), so leaving these
  // untouched is a real, valid, permissive choice, not an error state.
  const [minFriendAge, setMinFriendAge] = useState(String(MIN_AGE));
  const [maxFriendAge, setMaxFriendAge] = useState(String(MAX_AGE));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Grouping update (2026-07-26): matching preference and age-range now
  // share one screen (step 1), per the required onboarding regroup. Gender
  // identity (step 0) and messaging preference (step 2, now the final
  // step) stay separate, unchanged in content, values, or persisted field
  // names, only their position in this same multi-step screen moved.
  const canContinue =
    step === 0
      ? gender !== null
      : step === 1
        ? matching !== null && minFriendAge.trim() !== '' && maxFriendAge.trim() !== ''
        : messaging !== null;

  const handleBack = () => {
    setError(null);
    setStep((current) => Math.max(0, current - 1));
  };

  const handleContinue = async () => {
    if (step === 0) {
      setStep(1);
      return;
    }

    if (step === 1) {
      setError(null);
      const parsedMin = parseInt(minFriendAge, 10);
      const parsedMax = parseInt(maxFriendAge, 10);
      if (Number.isNaN(parsedMin) || Number.isNaN(parsedMax) || parsedMin < MIN_AGE || parsedMax > MAX_AGE) {
        setError(`Enter ages between ${MIN_AGE} and ${MAX_AGE}.`);
        return;
      }
      if (parsedMin > parsedMax) {
        setError('Minimum age must be less than or equal to maximum age.');
        return;
      }
      setStep(2);
      return;
    }

    // step === 2, final submit
    setError(null);

    const parsedMin = parseInt(minFriendAge, 10);
    const parsedMax = parseInt(maxFriendAge, 10);

    setSaving(true);

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      setSaving(false);
      setError('Your session expired. Please verify your phone number again.');
      return;
    }

    const [{ error: upsertError }, { error: profileError }] = await Promise.all([
      supabase.from('users').upsert({
        id: user.id,
        phone: user.phone ?? null,
        gender_identity: gender,
        matching_preference: matching,
        messaging_preference: messaging,
      }),
      supabase
        .from('profiles')
        .upsert({ user_id: user.id, min_friend_age: parsedMin, max_friend_age: parsedMax }),
    ]);

    setSaving(false);

    if (upsertError || profileError) {
      setError((upsertError ?? profileError)!.message);
      return;
    }

    router.replace('/social-linking');
  };

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-stone-50 dark:bg-stone-900"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <SafeAreaView className="flex-1 px-6 py-10">
        <View className="flex-row items-center justify-between">
          {step > 0 ? (
            <Pressable onPress={handleBack}>
              <Text className="text-caption text-stone-500 dark:text-stone-400">Back</Text>
            </Pressable>
          ) : (
            <View />
          )}
          <Text className="text-caption text-stone-400 dark:text-stone-600">
            Step {step + 1} of 3
          </Text>
        </View>

        {/* All three steps share one outer scroll container, top-anchored
            with a fixed gap below the header row, rather than each step
            picking its own wrapper (a plain View for steps 0/2, a
            ScrollView for step 1). That mismatch was a real bug, not a
            style choice: a ScrollView as a direct child of a
            `justify-between` column expands to fill the whole middle
            slot and top-aligns its own content, while a plain View sizes
            to its content and lets `justify-between` distribute space
            evenly, so step 1 alone rendered jammed against the header
            with a large gap before Continue, instead of matching steps
            0 and 2. This single shared ScrollView (flex-1, so it still
            scrolls if a step's content is ever taller than the screen)
            makes all three steps render identically regardless of how
            much content each one has. */}
        <ScrollView
          className="flex-1"
          contentContainerClassName="gap-5 pt-6"
          showsVerticalScrollIndicator={false}>
          {step === 0 && (
            <View className="gap-5">
              <Text className="text-display text-stone-900 dark:text-stone-50">
                How do you identify?
              </Text>
              <View className="gap-3">
                {GENDER_OPTIONS.map((option) => (
                  <OptionButton
                    key={option.value}
                    label={option.label}
                    selected={gender === option.value}
                    onPress={() => setGender(option.value)}
                  />
                ))}
              </View>
              <Text className="text-caption text-stone-500 dark:text-stone-400">
                This is shown on your profile, and it&apos;s also what other people are matching
                against when they set who they want to connect with.
              </Text>
            </View>
          )}

          {step === 1 && (
            <View className="gap-5">
              <Text className="text-display text-stone-900 dark:text-stone-50">
                Who would you like to connect with?
              </Text>
              <View className="gap-3">
                {MATCHING_OPTIONS.map((option) => (
                  <OptionButton
                    key={option.value}
                    label={option.label}
                    selected={matching === option.value}
                    onPress={() => setMatching(option.value)}
                  />
                ))}
              </View>
              <Text className="text-caption text-stone-500 dark:text-stone-400">
                This is your gender filter. It&apos;s permanent across all discovery (AI matches
                and browse), and it&apos;s always free.
              </Text>

              <View className="gap-3 pt-2">
                <Text className="text-title text-stone-900 dark:text-stone-50">
                  What ages are you open to connecting with?
                </Text>
                <View className="flex-row gap-3">
                  <View className="flex-1 gap-1">
                    <Text className="text-caption text-stone-500 dark:text-stone-400">Minimum age</Text>
                    <TextInput
                      value={minFriendAge}
                      onChangeText={(text) => setMinFriendAge(text.replace(/[^0-9]/g, ''))}
                      keyboardType="number-pad"
                      className="rounded-xl border border-stone-300 px-3 py-3 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
                      placeholderTextColor={MUTED_ICON_COLOR}
                    />
                  </View>
                  <View className="flex-1 gap-1">
                    <Text className="text-caption text-stone-500 dark:text-stone-400">Maximum age</Text>
                    <TextInput
                      value={maxFriendAge}
                      onChangeText={(text) => setMaxFriendAge(text.replace(/[^0-9]/g, ''))}
                      keyboardType="number-pad"
                      className="rounded-xl border border-stone-300 px-3 py-3 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
                      placeholderTextColor={MUTED_ICON_COLOR}
                    />
                  </View>
                </View>
                <Text className="text-caption text-stone-500 dark:text-stone-400">
                  This is a hard filter, not just a preference: you&apos;ll only be shown to people whose
                  own range includes your age, and only people in this range are shown to you. Defaults
                  to {MIN_AGE}-{MAX_AGE}, open to anyone.
                </Text>
              </View>
            </View>
          )}

          {step === 2 && (
            <View className="gap-5">
              <Text className="text-display text-stone-900 dark:text-stone-50">
                Who can message you first?
              </Text>
              <View className="gap-3">
                {MESSAGING_OPTIONS.map((option) => (
                  <OptionButton
                    key={option.value}
                    label={option.label}
                    selected={messaging === option.value}
                    onPress={() => setMessaging(option.value)}
                  />
                ))}
              </View>
            </View>
          )}
        </ScrollView>

        <View className="gap-4 pt-4">
          {!isSupabaseConfigured && (
            <Text className="text-caption text-amber-600 dark:text-amber-400">
              Supabase isn&apos;t configured yet. See .env.example.
            </Text>
          )}

          {error && (
            <Text className="text-caption text-red-600 dark:text-red-400">{error}</Text>
          )}

          <Pressable
            onPress={handleContinue}
            disabled={!canContinue || saving || !isSupabaseConfigured}
            className={`flex-row items-center justify-center gap-2 rounded-full bg-stone-900 py-4 active:opacity-80 dark:bg-stone-50 ${
              !canContinue || saving || !isSupabaseConfigured ? 'opacity-40' : ''
            }`}>
            {saving && <ActivityIndicator color={MUTED_ICON_COLOR} />}
            <Text className="text-body font-semibold text-stone-50 dark:text-stone-900">
              {saving ? 'Saving...' : step < 2 ? 'Continue' : 'Done'}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}
