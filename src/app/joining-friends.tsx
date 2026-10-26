import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { CirclePickerSheet } from '@/components/circle-picker';
import { PaddedSafeArea } from '@/components/padded-safe-area';
import { Face, Pill } from '@/components/ui';
import {
  CIRCLE_LABELS,
  DEFAULT_RHYTHM,
  NAME_MAX,
  fetchOutsideFriends,
  removeOutsideFriend,
  saveOutsideFriend,
  type Circle,
  type OutsideFriend,
} from '@/lib/circle';
import { saveJoining } from '@/lib/joining';
import { palette } from '@/theme';

// "Think about your friends right now." (rebuild stage 2, 2026-10-26, wording
// from docs/context/05_LIMEN_REBUILD.md). Any number of names, each with a
// circle, then the people they've lost touch with. Each name is saved into
// Your circle (outside_friends) the moment it's added, with the default
// rhythm for its circle (Close: every week, Friends: every month, Want to
// reconnect: a few times a year), changeable later on the person's page.
// Skippable.
export default function JoiningFriendsScreen() {
  const [loaded, setLoaded] = useState(false);
  const [friends, setFriends] = useState<OutsideFriend[]>([]);
  const [closeName, setCloseName] = useState('');
  const [lostName, setLostName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [picking, setPicking] = useState<OutsideFriend | null>(null);

  const reload = async () => setFriends(await fetchOutsideFriends());

  useEffect(() => {
    (async () => {
      await reload();
      setLoaded(true);
    })();
  }, []);

  const add = async (name: string, circle: Circle, clear: () => void) => {
    if (!name.trim() || busy) return;
    setBusy(true);
    const r = await saveOutsideFriend(null, { name, circle, rhythm: DEFAULT_RHYTHM[circle], note: '' });
    setBusy(false);
    if ('error' in r) {
      setError(true);
      return;
    }
    setError(false);
    clear();
    await reload();
  };

  const move = async (f: OutsideFriend, circle: Circle) => {
    setPicking(null);
    const r = await saveOutsideFriend(f.id, { name: f.name, circle, rhythm: DEFAULT_RHYTHM[circle], note: f.note ?? '' });
    setError('error' in r);
    await reload();
  };

  const remove = async (f: OutsideFriend) => {
    setError(!(await removeOutsideFriend(f.id)));
    await reload();
  };

  const done = async () => {
    setBusy(true);
    // A name typed but not added yet is added too.
    for (const [name, circle] of [[closeName, 'close'], [lostName, 'reconnect']] as const) {
      if (!name.trim()) continue;
      const r = await saveOutsideFriend(null, { name, circle, rhythm: DEFAULT_RHYTHM[circle], note: '' });
      if ('error' in r) {
        setBusy(false);
        setError(true);
        await reload();
        return;
      }
    }
    setCloseName('');
    setLostName('');
    const ok = await saveJoining({ friends_at: new Date().toISOString() });
    setBusy(false);
    if (!ok) {
      setError(true);
      return;
    }
    router.replace('/joining-help');
  };

  if (!loaded) {
    return (
      <View className="flex-1 items-center justify-center bg-stone-50 dark:bg-stone-900">
        <ActivityIndicator color={palette.muted} />
      </View>
    );
  }

  const lost = friends.filter((f) => f.circle === 'reconnect');
  const near = friends.filter((f) => f.circle !== 'reconnect');

  const nameBox = (value: string, set: (t: string) => void, onAdd: () => void, label: string) => (
    <View className="flex-row items-center gap-2">
      <TextInput
        value={value}
        onChangeText={set}
        onSubmitEditing={onAdd}
        placeholder="A first name is enough"
        placeholderTextColor={palette.muted}
        maxLength={NAME_MAX}
        returnKeyType="done"
        accessibilityLabel={label}
        className="min-h-11 flex-1 rounded-xl border border-stone-300 bg-white px-3 py-3 text-body text-stone-900 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-50"
      />
      <Pill label="Add" icon="add" disabled={!value.trim() || busy} onPress={onAdd} accessibilityLabel={`Add, ${label}`} />
    </View>
  );

  const personRow = (f: OutsideFriend) => (
    <View
      key={f.id}
      accessibilityLabel={`${f.name}, ${CIRCLE_LABELS[f.circle]}`}
      className="flex-row items-center gap-3 rounded-2xl border border-stone-200 bg-white px-3 py-2 dark:border-stone-700 dark:bg-stone-800">
      <Face name={f.name} circle={f.circle} size={36} />
      <Text className="flex-1 text-body text-stone-900 dark:text-stone-50" numberOfLines={1}>
        {f.name}
      </Text>
      <Pressable
        onPress={() => setPicking(f)}
        accessibilityRole="button"
        accessibilityLabel={`Circle for ${f.name}: ${CIRCLE_LABELS[f.circle]}. Change`}
        className="min-h-11 flex-row items-center gap-1 rounded-full border border-outline px-3 active:opacity-70 dark:border-stone-600">
        <Text className="text-caption font-semibold text-stone-900 dark:text-stone-50">{CIRCLE_LABELS[f.circle]}</Text>
        <Ionicons name="chevron-down" size={14} color={palette.inkSoft} />
      </Pressable>
      <Pressable
        onPress={() => remove(f)}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${f.name}`}
        className="h-11 w-11 items-center justify-center rounded-full active:opacity-70">
        <Ionicons name="close" size={20} color={palette.inkSoft} />
      </Pressable>
    </View>
  );

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-stone-50 dark:bg-stone-900"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <PaddedSafeArea className="flex-1">
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-6 px-6 pb-10 pt-10">
          <Pill label="Back" className="self-start" onPress={() => router.replace('/joining-hardest')} />

          <View className="gap-2">
            <Text className="text-display text-stone-900 dark:text-stone-50">Think about your friends right now.</Text>
            <Text className="text-body text-stone-600 dark:text-stone-300">
              Not counting family or a partner: who would you call with good news? Who could you ask for a hand?
            </Text>
          </View>

          <View className="gap-3">
            {nameBox(closeName, setCloseName, () => add(closeName, 'close', () => setCloseName('')), 'Someone you would call')}
            {near.map(personRow)}
            <Text className="text-caption text-stone-500 dark:text-stone-400">
              Most adults name one to four close friends. None is more common than people think.
            </Text>
          </View>

          <View className="gap-3">
            <Text className="text-title text-stone-900 dark:text-stone-50">
              Anyone you&apos;ve lost touch with but would like to hear from?
            </Text>
            {nameBox(lostName, setLostName, () => add(lostName, 'reconnect', () => setLostName('')), "Someone you've lost touch with")}
            {lost.map(personRow)}
          </View>

          <Text className="text-caption text-stone-500 dark:text-stone-400">
            Everyone you add goes into Your circle. Only you see it, and you can change anything later.
          </Text>

          {error && (
            <Text className="text-caption text-red-700 dark:text-red-400">
              That didn&apos;t save. Check your connection and try again.
            </Text>
          )}

          <View className="gap-2">
            {friends.length > 0 || closeName.trim() || lostName.trim() ? (
              <Pill label="Continue" variant="filled" disabled={busy} onPress={done} />
            ) : (
              <Pill label="Skip for now" disabled={busy} onPress={done} />
            )}
          </View>
        </ScrollView>
      </PaddedSafeArea>

      {picking && (
        <CirclePickerSheet
          visible
          name={picking.name}
          current={picking.circle}
          onPick={(c) => move(picking, c)}
          onClose={() => setPicking(null)}
        />
      )}
    </KeyboardAvoidingView>
  );
}
