import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
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

import { FRIENDLY_SAVE_ERROR } from '@/lib/auth-errors';
import { MAX_AGE, MIN_AGE } from '@/lib/filter-options';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400

// Identity, two steps (docs/DECISIONS.md, onboarding screen 5).
//
// Step 1, your gender: Woman / Man / Non-binary, one choice. A trans woman
// picks Woman. "Transgender" and "Queer" are no longer options: they
// describe something other than who a person is comfortable meeting, and
// orientation has no place in a friends-only app.
//
// Step 2, who you'd like to meet: any combination of Women / Men /
// Non-binary people, or Everyone. Mutual: you only see someone if each of
// you fits what the other chose (users.meet_genders, genders_match() in
// migration 20261004000000). Age range stays here.
//
// The old step 3 ("Who can message you first") is gone. The mutual
// Interested gate replaces it: chat only opens after both people choose
// each other.
const GENDER_OPTIONS: { label: string; value: string }[] = [
  { label: 'Woman', value: 'woman' },
  { label: 'Man', value: 'man' },
  { label: 'Non-binary', value: 'non_binary' },
];

const MEET_OPTIONS: { label: string; value: string }[] = [
  { label: 'Women', value: 'woman' },
  { label: 'Men', value: 'man' },
  { label: 'Non-binary people', value: 'non_binary' },
  { label: 'Everyone', value: 'everyone' },
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
      accessibilityState={{ selected }}
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
  // ?from=profile: opened from Edit profile. Loads current answers, and
  // Back / Done return to Edit profile instead of continuing sign-up.
  const { from } = useLocalSearchParams<{ from?: string }>();
  const isEditMode = from === 'profile';
  const [step, setStep] = useState(0);
  const [gender, setGender] = useState<string | null>(null);
  const [meet, setMeet] = useState<string[]>([]);
  const [minFriendAge, setMinFriendAge] = useState(String(MIN_AGE));
  const [maxFriendAge, setMaxFriendAge] = useState(String(MAX_AGE));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isEditMode) return;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const [{ data: userRow }, { data: profile }] = await Promise.all([
        supabase.from('users').select('gender_identity, meet_genders').eq('id', user.id).maybeSingle(),
        supabase.from('profiles').select('min_friend_age, max_friend_age').eq('user_id', user.id).maybeSingle(),
      ]);
      if (userRow?.gender_identity) setGender(userRow.gender_identity);
      if (userRow?.meet_genders) setMeet(userRow.meet_genders as string[]);
      if (profile?.min_friend_age != null) setMinFriendAge(String(profile.min_friend_age));
      if (profile?.max_friend_age != null) setMaxFriendAge(String(profile.max_friend_age));
    })();
  }, [isEditMode]);

  const canContinue =
    step === 0 ? gender !== null : meet.length > 0 && minFriendAge.trim() !== '' && maxFriendAge.trim() !== '';

  // "Everyone" stands on its own; picking a specific group clears it.
  const toggleMeet = (value: string) => {
    setMeet((current) => {
      if (value === 'everyone') return current.includes('everyone') ? [] : ['everyone'];
      const withoutEveryone = current.filter((v) => v !== 'everyone');
      return withoutEveryone.includes(value)
        ? withoutEveryone.filter((v) => v !== value)
        : [...withoutEveryone, value];
    });
  };

  const handleBack = () => {
    setError(null);
    if (step === 0) {
      if (isEditMode) router.back();
      else router.replace('/account-recovery');
      return;
    }
    setStep(0);
  };

  const handleContinue = async () => {
    if (step === 0) {
      setStep(1);
      return;
    }

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

    // matching_preference (the old single-choice column) is kept in step
    // for anything that still reads it: set when exactly one specific
    // group was picked, otherwise null. meet_genders is what matching uses.
    const singleSpecific = meet.length === 1 && meet[0] !== 'everyone' ? meet[0] : null;

    const [{ error: upsertError }, { error: profileError }] = await Promise.all([
      supabase.from('users').upsert({
        id: user.id,
        phone: user.phone ?? null,
        gender_identity: gender,
        meet_genders: meet,
        matching_preference: singleSpecific,
        messaging_preference: 'anyone',
      }),
      supabase.from('profiles').upsert({ user_id: user.id, min_friend_age: parsedMin, max_friend_age: parsedMax }),
    ]);

    setSaving(false);
    if (upsertError || profileError) {
      setError(FRIENDLY_SAVE_ERROR);
      return;
    }

    if (isEditMode) router.back();
    else router.replace('/profile-build');
  };

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-stone-50 dark:bg-stone-900"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <SafeAreaView className="flex-1 px-6 py-10">
        <View className="flex-row items-center justify-between">
          <Pressable onPress={handleBack}>
            <Text className="text-caption text-stone-500 dark:text-stone-400">Back</Text>
          </Pressable>
          <Text className="text-caption text-stone-400 dark:text-stone-600">Step {step + 1} of 2</Text>
        </View>

        <ScrollView className="flex-1" contentContainerClassName="gap-5 pt-6" showsVerticalScrollIndicator={false}>
          {step === 0 && (
            <View className="gap-5">
              <Text className="text-display text-stone-900 dark:text-stone-50">What&apos;s your gender?</Text>
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
                Not shown on your profile. It&apos;s used only so the people you meet also chose to meet someone like you.
              </Text>
            </View>
          )}

          {step === 1 && (
            <View className="gap-5">
              <Text className="text-display text-stone-900 dark:text-stone-50">Who would you like to meet?</Text>
              <View className="gap-3">
                {MEET_OPTIONS.map((option) => (
                  <OptionButton
                    key={option.value}
                    label={option.label}
                    selected={meet.includes(option.value)}
                    onPress={() => toggleMeet(option.value)}
                  />
                ))}
              </View>
              <Text className="text-caption text-stone-500 dark:text-stone-400">
                Choose all that apply. It works both ways: you&apos;ll only see people who also chose to meet
                someone like you. You can change this later.
              </Text>

              <View className="gap-3 pt-2">
                <Text className="text-title text-stone-900 dark:text-stone-50">What ages are you open to?</Text>
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
                  This works both ways too: you&apos;ll only see people in this range whose own range includes
                  your age. Defaults to {MIN_AGE}-{MAX_AGE}, open to anyone.
                </Text>
              </View>
            </View>
          )}
        </ScrollView>

        <View className="gap-3 pt-4">
          {!isSupabaseConfigured && (
            <Text className="text-caption text-amber-600 dark:text-amber-400">
              Supabase isn&apos;t configured yet. See .env.example.
            </Text>
          )}
          {error && <Text className="text-caption text-red-600 dark:text-red-400">{error}</Text>}
          <Pressable
            onPress={handleContinue}
            disabled={!canContinue || saving || !isSupabaseConfigured}
            className={`flex-row items-center justify-center gap-2 rounded-full bg-stone-900 py-4 active:opacity-80 dark:bg-stone-50 ${
              !canContinue || saving || !isSupabaseConfigured ? 'opacity-40' : ''
            }`}>
            {saving && <ActivityIndicator color={MUTED_ICON_COLOR} />}
            <Text className="text-body font-semibold text-stone-50 dark:text-stone-900">
              {saving ? 'Saving...' : step === 0 ? 'Continue' : 'Done'}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}
