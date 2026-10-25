import { useLocalSearchParams, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { goBack } from '@/lib/navigation';
import {
  CIRCLES,
  CIRCLE_LABELS,
  CIRCLE_RHYTHMS,
  DEFAULT_RHYTHM,
  NAME_MAX,
  NOTE_MAX,
  RHYTHM_LABELS,
  RHYTHM_LINES,
  fetchOutsideFriend,
  removeOutsideFriend,
  rhythmFits,
  saveOutsideFriend,
  type Circle,
  type OutsideFriend,
  type Rhythm,
} from '@/lib/people';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: on }}
      aria-checked={on}
      className={`rounded-full border px-4 py-2 active:opacity-70 ${
        on ? 'border-stone-900 bg-stone-900 dark:border-stone-50 dark:bg-stone-50' : 'border-stone-300 dark:border-stone-600'
      }`}>
      <Text className={`text-caption font-semibold ${on ? 'text-stone-50 dark:text-stone-900' : 'text-stone-600 dark:text-stone-300'}`}>
        {label}
      </Text>
    </Pressable>
  );
}

// A friend from outside Limen (rebuild stage 1, 2026-10-25). One screen for
// adding (id "new"), seeing and editing. Name, circle, how often you'd like
// to be in touch (choices that fit the circle), an optional note. No phone
// number or email: Limen never stores them. Private to you.
// Text / Call / Email and suggestions come in stage 3.
export default function FriendScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const [friend, setFriend] = useState<OutsideFriend | null>(null);
  const [loaded, setLoaded] = useState(isNew);
  const [editing, setEditing] = useState(isNew);
  const [name, setName] = useState('');
  const [circle, setCircle] = useState<Circle | null>(null);
  const [rhythm, setRhythm] = useState<Rhythm | null>(null);
  // Until the person picks how often themselves, each circle starts at its
  // own usual rhythm.
  const [rhythmPicked, setRhythmPicked] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isNew || !id) return;
    fetchOutsideFriend(id).then((f) => {
      setFriend(f);
      setLoaded(true);
    });
  }, [id, isNew]);

  const startEdit = (f: OutsideFriend) => {
    setName(f.name);
    setCircle(f.circle);
    setRhythm(f.rhythm);
    setRhythmPicked(true);
    setNote(f.note ?? '');
    setError(null);
    setEditing(true);
  };

  const pickCircle = (c: Circle) => {
    setCircle(c);
    if (!rhythmPicked || !rhythm || !rhythmFits(c, rhythm)) setRhythm(DEFAULT_RHYTHM[c]);
  };

  const save = async () => {
    if (!name.trim()) {
      setError('Add a name, even just a first name.');
      return;
    }
    if (!circle || !rhythm) {
      setError('Pick a circle.');
      return;
    }
    setSaving(true);
    setError(null);
    const result = await saveOutsideFriend(isNew ? null : (friend?.id ?? null), { name, circle, rhythm, note });
    setSaving(false);
    if ('error' in result) {
      setError("That didn't save. Please try again.");
      return;
    }
    if (isNew) {
      router.replace('/people');
      return;
    }
    const fresh = await fetchOutsideFriend(result.id);
    setFriend(fresh);
    setEditing(false);
  };

  const remove = async () => {
    if (!friend) return;
    setSaving(true);
    const ok = await removeOutsideFriend(friend.id);
    setSaving(false);
    if (!ok) {
      setError("That didn't work. Please try again.");
      return;
    }
    router.replace('/people');
  };

  if (!loaded) {
    return (
      <View className="flex-1 items-center justify-center bg-stone-50 dark:bg-stone-900">
        <ActivityIndicator color={MUTED_ICON_COLOR} />
      </View>
    );
  }

  const header = (
    <Pressable onPress={() => (editing && !isNew ? setEditing(false) : goBack('/people'))} className="self-start">
      <Text className="text-caption text-stone-500 dark:text-stone-400">{editing && !isNew ? 'Cancel' : 'Back'}</Text>
    </Pressable>
  );

  if (!isNew && !friend) {
    return (
      <View className="flex-1 bg-stone-50 dark:bg-stone-900">
        <SafeAreaView className="flex-1">
          <View className="gap-4 px-6 pt-6">
            {header}
            <Text className="text-body text-stone-600 dark:text-stone-300">This person isn&apos;t in Your people anymore.</Text>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-stone-50 dark:bg-stone-900">
      <SafeAreaView className="flex-1">
        <ScrollView contentContainerClassName="gap-6 px-6 pb-14 pt-6" keyboardShouldPersistTaps="handled">
          {header}

          {editing ? (
            <>
              <Text className="text-display text-stone-900 dark:text-stone-50">{isNew ? 'Add someone' : 'Edit'}</Text>

              <View className="gap-2">
                <Text className="text-body font-semibold text-stone-900 dark:text-stone-50">Name</Text>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="A first name is enough"
                  placeholderTextColor={MUTED_ICON_COLOR}
                  maxLength={NAME_MAX}
                  autoFocus={isNew}
                  accessibilityLabel="Name"
                  className="rounded-xl border border-stone-300 px-3 py-3 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
                />
              </View>

              <View className="gap-2">
                <Text className="text-body font-semibold text-stone-900 dark:text-stone-50">Which circle?</Text>
                <View className="flex-row flex-wrap gap-2">
                  {CIRCLES.map((c) => (
                    <Chip key={c} label={CIRCLE_LABELS[c]} on={circle === c} onPress={() => pickCircle(c)} />
                  ))}
                </View>
              </View>

              {circle && (
                <View className="gap-2">
                  <Text className="text-body font-semibold text-stone-900 dark:text-stone-50">
                    How often would you like to be in touch?
                  </Text>
                  <View className="flex-row flex-wrap gap-2">
                    {CIRCLE_RHYTHMS[circle].map((r) => (
                      <Chip key={r} label={RHYTHM_LABELS[r]} on={rhythm === r} onPress={() => {
                          setRhythm(r);
                          setRhythmPicked(true);
                        }} />
                    ))}
                  </View>
                  <Text className="text-caption text-stone-500 dark:text-stone-400">{RHYTHM_LINES[circle]}</Text>
                </View>
              )}

              <View className="gap-2">
                <Text className="text-body font-semibold text-stone-900 dark:text-stone-50">Note, if you like</Text>
                <TextInput
                  value={note}
                  onChangeText={setNote}
                  placeholder="Anything you'd like to remember about them. Only you see this."
                  placeholderTextColor={MUTED_ICON_COLOR}
                  multiline
                  numberOfLines={4}
                  maxLength={NOTE_MAX}
                  textAlignVertical="top"
                  accessibilityLabel="Note"
                  className="min-h-24 rounded-xl border border-stone-300 px-3 py-3 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
                />
              </View>

              {error && <Text className="text-caption text-red-600 dark:text-red-400">{error}</Text>}

              <Pressable
                onPress={save}
                disabled={saving}
                className={`items-center rounded-full bg-stone-900 py-4 active:opacity-80 dark:bg-stone-50 ${saving ? 'opacity-40' : ''}`}>
                <Text className="text-body font-semibold text-stone-50 dark:text-stone-900">{isNew ? 'Add' : 'Save'}</Text>
              </Pressable>

              {!isNew && friend && (
                <View className="gap-2">
                  {confirmRemove ? (
                    <View className="gap-3 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
                      <Text className="text-body text-stone-700 dark:text-stone-300">
                        Remove {friend.name} from Your people? Your note goes too.
                      </Text>
                      <View className="flex-row gap-3">
                        <Pressable onPress={() => setConfirmRemove(false)} className="flex-1 items-center py-2">
                          <Text className="text-body text-stone-500 dark:text-stone-400">Keep</Text>
                        </Pressable>
                        <Pressable
                          onPress={remove}
                          disabled={saving}
                          className="flex-1 items-center rounded-full border border-red-300 py-2 active:opacity-70 dark:border-red-800">
                          <Text className="text-body font-semibold text-red-600 dark:text-red-400">Remove</Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : (
                    <Pressable onPress={() => setConfirmRemove(true)} className="items-center py-2">
                      <Text className="text-body text-red-600 dark:text-red-400">Remove from Your people</Text>
                    </Pressable>
                  )}
                </View>
              )}
            </>
          ) : (
            friend && (
              <>
                <View className="flex-row items-start justify-between gap-3">
                  <Text className="flex-1 text-display text-stone-900 dark:text-stone-50">{friend.name}</Text>
                  <Pressable
                    onPress={() => startEdit(friend)}
                    className="rounded-full border border-stone-300 px-4 py-2 active:opacity-70 dark:border-stone-700">
                    <Text className="text-caption font-semibold text-stone-900 dark:text-stone-50">Edit</Text>
                  </Pressable>
                </View>
                <View className="gap-4 rounded-2xl border border-stone-100 bg-white p-5 dark:border-stone-700/60 dark:bg-stone-800">
                  <View className="gap-0.5">
                    <Text className="text-caption text-stone-400 dark:text-stone-400">Circle</Text>
                    <Text className="text-body text-stone-800 dark:text-stone-200">{CIRCLE_LABELS[friend.circle]}</Text>
                  </View>
                  <View className="gap-0.5">
                    <Text className="text-caption text-stone-400 dark:text-stone-400">How often you&apos;d like to be in touch</Text>
                    <Text className="text-body text-stone-800 dark:text-stone-200">{RHYTHM_LABELS[friend.rhythm]}</Text>
                  </View>
                  <View className="gap-0.5">
                    <Text className="text-caption text-stone-400 dark:text-stone-400">Note</Text>
                    <Text className="text-body text-stone-800 dark:text-stone-200">{friend.note?.trim() || 'No note yet'}</Text>
                  </View>
                </View>
                <Text className="text-caption text-stone-500 dark:text-stone-400">Only you see this.</Text>
              </>
            )
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
