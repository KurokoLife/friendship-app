import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';

import { supabase } from '@/lib/supabase';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400

const GENDER_LABELS: Record<string, string> = { woman: 'Woman', man: 'Man', non_binary: 'Non-binary' };
const MEET_LABELS: Record<string, string> = {
  woman: 'Women',
  man: 'Men',
  non_binary: 'Non-binary people',
  everyone: 'Everyone',
};

type Basics = {
  name: string;
  age: number | null;
  gender: string | null;
  meet: string[];
  minAge: number | null;
  maxAge: number | null;
};

function ageFrom(birthdate: string | null): number | null {
  if (!birthdate) return null;
  const [y, m, d] = birthdate.split('-').map(Number);
  const today = new Date();
  let age = today.getFullYear() - y;
  if (today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d)) age -= 1;
  return age;
}

// The basics set during sign-up (name, age, gender, who you'd like to
// meet, age range), shown at the top of Edit profile (2026-10-06).
// Name saves here. Gender, who you'd like to meet and age range open the
// sign-up screen in edit mode. Birthday is shown but not editable: it sets
// your age range for everyone else, so it stays as entered at sign-up.
export function ProfileBasicsCard() {
  const [basics, setBasics] = useState<Basics | null>(null);
  const [name, setName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const [{ data: profile }, { data: userRow }] = await Promise.all([
      supabase.from('profiles').select('display_name, birthdate, min_friend_age, max_friend_age').eq('user_id', user.id).maybeSingle(),
      supabase.from('users').select('gender_identity, meet_genders').eq('id', user.id).maybeSingle(),
    ]);
    const next: Basics = {
      name: profile?.display_name ?? '',
      age: ageFrom(profile?.birthdate ?? null),
      gender: userRow?.gender_identity ?? null,
      meet: (userRow?.meet_genders as string[] | null) ?? [],
      minAge: profile?.min_friend_age ?? null,
      maxAge: profile?.max_friend_age ?? null,
    };
    setBasics(next);
    setName(next.name);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const saveName = async () => {
    const trimmed = name.trim();
    setMessage(null);
    if (!trimmed) {
      setMessage("Your first name can't be empty.");
      return;
    }
    if (trimmed === basics?.name) return;
    setSavingName(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error } = user
      ? await supabase.from('profiles').update({ display_name: trimmed }).eq('user_id', user.id)
      : { error: new Error('no user') };
    setSavingName(false);
    if (error) {
      setMessage("That didn't save. Try again.");
      return;
    }
    setBasics((b) => (b ? { ...b, name: trimmed } : b));
    setMessage('Saved.');
  };

  if (!basics) {
    return (
      <View className="items-center rounded-2xl border border-stone-200 p-5 dark:border-stone-700">
        <ActivityIndicator color={MUTED_ICON_COLOR} />
      </View>
    );
  }

  const meetText = basics.meet.map((m) => MEET_LABELS[m] ?? m).join(', ') || 'Not set';
  const ageRangeText =
    basics.minAge !== null && basics.maxAge !== null ? `${basics.minAge} to ${basics.maxAge}` : 'Not set';

  return (
    <View className="gap-4 rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-stone-800">
      <Text className="text-title text-stone-900 dark:text-stone-50">Basics</Text>

      <View className="gap-1">
        <Text className="text-caption text-stone-500 dark:text-stone-400">First name</Text>
        <View className="flex-row items-center gap-2">
          <TextInput
            value={name}
            onChangeText={(t) => {
              setName(t);
              setMessage(null);
            }}
            onBlur={saveName}
            maxLength={40}
            className="flex-1 rounded-xl border border-stone-300 px-3 py-2 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
          />
          {name.trim() !== basics.name && (
            <Pressable onPress={saveName} disabled={savingName} className="rounded-full border border-stone-300 px-3 py-2 dark:border-stone-700">
              <Text className="text-caption font-semibold text-stone-900 dark:text-stone-50">
                {savingName ? 'Saving...' : 'Save'}
              </Text>
            </Pressable>
          )}
        </View>
        {message && <Text className="text-caption text-stone-500 dark:text-stone-400">{message}</Text>}
      </View>

      <View className="gap-0.5">
        <Text className="text-caption text-stone-500 dark:text-stone-400">Age</Text>
        <Text className="text-body text-stone-900 dark:text-stone-50">{basics.age ?? 'Not set'}</Text>
        <Text className="text-caption text-stone-500 dark:text-stone-400">
          Set from the birthday you entered at sign-up, and it can&apos;t be changed here. Others see an age range.
        </Text>
      </View>

      <Pressable
        onPress={() => router.push('/gender-identity?from=profile')}
        className="flex-row items-center justify-between gap-3 rounded-xl border border-stone-200 p-3 dark:border-stone-700">
        <View className="flex-1 gap-1">
          <Text className="text-caption text-stone-500 dark:text-stone-400">Gender</Text>
          <Text className="text-body text-stone-900 dark:text-stone-50">
            {basics.gender ? GENDER_LABELS[basics.gender] ?? basics.gender : 'Not set'}
          </Text>
          <Text className="pt-1 text-caption text-stone-500 dark:text-stone-400">Who you&apos;d like to meet</Text>
          <Text className="text-body text-stone-900 dark:text-stone-50">{meetText}</Text>
          <Text className="pt-1 text-caption text-stone-500 dark:text-stone-400">Ages you&apos;re open to</Text>
          <Text className="text-body text-stone-900 dark:text-stone-50">{ageRangeText}</Text>
        </View>
        <View className="flex-row items-center gap-1">
          <Text className="text-caption font-semibold text-accent-500">Change</Text>
          <Ionicons name="chevron-forward" size={16} color={MUTED_ICON_COLOR} />
        </View>
      </Pressable>
    </View>
  );
}
