import { useLocalSearchParams, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CirclePickerSheet } from '@/components/circle-picker';
import { Face, Pill, RowLink } from '@/components/ui';
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
  friendPhotoUrl,
  moveOutsideFriend,
  nextCheckIn,
  nextCheckInLine,
  removeFriendPhoto,
  removeOutsideFriend,
  rhythmFits,
  saveOutsideFriend,
  setFriendPhoto,
  type Circle,
  type OutsideFriend,
  type Rhythm,
} from '@/lib/circle';
import { goBack } from '@/lib/navigation';
import { PHOTO_RULES_TEXT, pickProfilePhoto, type PickedPhoto } from '@/lib/photo-picker';
import { palette } from '@/theme';

const MUTED_ICON_COLOR = palette.muted;

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: on }}
      aria-checked={on}
      className={`min-h-11 justify-center rounded-full border px-4 active:opacity-70 ${
        on ? 'border-stone-900 bg-stone-900 dark:border-stone-50 dark:bg-stone-50' : 'border-stone-300 dark:border-stone-600'
      }`}>
      <Text className={`text-caption font-semibold ${on ? 'text-stone-50 dark:text-stone-900' : 'text-stone-600 dark:text-stone-300'}`}>
        {label}
      </Text>
    </Pressable>
  );
}

// The next check-in line for a rhythm, from the one rule in the database
// (circle_next_check_in). Updates as the rhythm changes.
function useNextLine(name: string, friendId: string | null, rhythm: Rhythm | null): string | null {
  const [line, setLine] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (!rhythm) {
      setLine(null);
      return;
    }
    nextCheckIn(friendId, rhythm).then((day) => {
      if (live) setLine(nextCheckInLine(name.trim() || 'them', day, rhythm));
    });
    return () => {
      live = false;
    };
  }, [name, friendId, rhythm]);
  return line;
}

// A friend from outside Limen (stage 1, 2026-10-25; person page stage 1c,
// 2026-10-26). One screen for adding (id "new"), the person page and
// editing. The person page shows their face, name, circle, how often you'd
// like to be in touch, when Limen will bring them up again, your note, and
// Edit. No phone number or email: Limen never stores them. Private to you.
// Text / Call / Email and suggestions come in stage 3.
export default function FriendScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const [friend, setFriend] = useState<OutsideFriend | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(isNew);
  const [editing, setEditing] = useState(isNew);
  const [name, setName] = useState('');
  const [circle, setCircle] = useState<Circle | null>(null);
  const [rhythm, setRhythm] = useState<Rhythm | null>(null);
  // Until the person picks how often themselves, each circle starts at its
  // own usual rhythm.
  const [rhythmPicked, setRhythmPicked] = useState(false);
  const [note, setNote] = useState('');
  // A photo picked in the form, uploaded on save (or "remove" the saved one).
  const [newPhoto, setNewPhoto] = useState<PickedPhoto | null>(null);
  const [dropPhoto, setDropPhoto] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [moving, setMoving] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async (friendId: string) => {
    const f = await fetchOutsideFriend(friendId);
    setFriend(f);
    setPhotoUrl(await friendPhotoUrl(f?.photo_path ?? null));
    setLoaded(true);
  };

  useEffect(() => {
    if (isNew || !id) return;
    load(id);
  }, [id, isNew]);

  // The count starts from the last time you reached out, or the day they
  // were added (today, for someone new). The database decides.
  const friendId = isNew ? null : (friend?.id ?? null);
  const pageLine = useNextLine(friend?.name ?? '', friendId, friend && !editing ? friend.rhythm : null);
  const formLine = useNextLine(name, friendId, editing ? rhythm : null);

  const startEdit = (f: OutsideFriend) => {
    setName(f.name);
    setCircle(f.circle);
    setRhythm(f.rhythm);
    setRhythmPicked(true);
    setNote(f.note ?? '');
    setNewPhoto(null);
    setDropPhoto(false);
    setError(null);
    setEditing(true);
  };

  const pickCircle = (c: Circle) => {
    setCircle(c);
    if (!rhythmPicked || !rhythm || !rhythmFits(c, rhythm)) setRhythm(DEFAULT_RHYTHM[c]);
  };

  const choosePhoto = async () => {
    setError(null);
    const picked = await pickProfilePhoto();
    if (picked.ok) {
      setNewPhoto(picked.photo);
      setDropPhoto(false);
    } else if (!('cancelled' in picked && picked.cancelled)) {
      setError('message' in picked && picked.message ? picked.message : "That photo didn't work. Try another.");
    }
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
    if ('error' in result) {
      setSaving(false);
      setError("That didn't save. Please try again.");
      return;
    }
    let photoOk = true;
    if (newPhoto) photoOk = await setFriendPhoto(result.id, newPhoto);
    else if (dropPhoto && friend) photoOk = await removeFriendPhoto(friend);
    setSaving(false);
    if (!photoOk) {
      // The rest is saved; say so plainly and stay in the form.
      setError("Saved, but the photo didn't upload. Try again.");
      if (isNew) router.replace({ pathname: '/friend/[id]', params: { id: result.id } });
      return;
    }
    if (isNew) {
      router.replace('/circle');
      return;
    }
    await load(result.id);
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
    router.replace('/circle');
  };

  if (!loaded) {
    return (
      <View className="flex-1 items-center justify-center bg-stone-50 dark:bg-stone-900">
        <ActivityIndicator color={MUTED_ICON_COLOR} />
      </View>
    );
  }

  const header = (
    <Pill
      label={editing && !isNew ? 'Cancel' : 'Back'}
      icon={editing && !isNew ? undefined : 'chevron-back'}
      className="self-start"
      onPress={() => (editing && !isNew ? setEditing(false) : goBack('/circle'))}
    />
  );

  if (!isNew && !friend) {
    return (
      <View className="flex-1 bg-stone-50 dark:bg-stone-900">
        <SafeAreaView className="flex-1">
          <View className="gap-4 px-6 pt-6">
            {header}
            <Text className="text-body text-stone-600 dark:text-stone-300">This person isn&apos;t in Your circle anymore.</Text>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  // The face in the form: the newly picked photo, the saved one, or the initial.
  const formFaceUrl = newPhoto ? newPhoto.uri : dropPhoto ? null : photoUrl;
  const formCircle = circle ?? friend?.circle ?? 'getting_to_know';

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
                      <Chip
                        key={r}
                        label={RHYTHM_LABELS[r]}
                        on={rhythm === r}
                        onPress={() => {
                          setRhythm(r);
                          setRhythmPicked(true);
                        }}
                      />
                    ))}
                  </View>
                  {formLine && (
                    <Text accessibilityLiveRegion="polite" className="text-body text-stone-700 dark:text-stone-300">
                      {formLine}
                    </Text>
                  )}
                  <Text className="text-caption text-stone-500 dark:text-stone-400">{RHYTHM_LINES[circle]}</Text>
                </View>
              )}

              <View className="gap-2">
                <Text className="text-body font-semibold text-stone-900 dark:text-stone-50">Photo, if you like</Text>
                <View className="flex-row flex-wrap items-center gap-3">
                  <Face name={name.trim() || '?'} circle={formCircle} photoUrl={formFaceUrl} size={56} />
                  <Pill label={formFaceUrl ? 'Choose another photo' : 'Choose a photo'} onPress={choosePhoto} />
                  {formFaceUrl && (
                    <Pill
                      label="Remove photo"
                      onPress={() => {
                        setNewPhoto(null);
                        setDropPhoto(true);
                      }}
                    />
                  )}
                </View>
                <Text className="text-caption text-stone-500 dark:text-stone-400">
                  Only you see it, and it&apos;s used for nothing else. {PHOTO_RULES_TEXT}
                </Text>
              </View>

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

              {error && <Text className="text-caption text-red-700 dark:text-red-400">{error}</Text>}

              <Pressable
                onPress={save}
                disabled={saving}
                accessibilityRole="button"
                className={`min-h-12 items-center justify-center rounded-full bg-apricot py-3 active:opacity-80 ${saving ? 'opacity-40' : ''}`}>
                <Text className="text-body font-semibold text-white">{isNew ? 'Add' : 'Save'}</Text>
              </Pressable>

              {!isNew && friend && (
                <View className="gap-2">
                  {confirmRemove ? (
                    <View className="gap-3 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
                      <Text className="text-body text-stone-700 dark:text-stone-300">
                        Remove {friend.name} from Your circle? Your note and photo go too.
                      </Text>
                      <View className="flex-row gap-3">
                        <Pill label="Keep" className="flex-1" onPress={() => setConfirmRemove(false)} />
                        <Pill label="Remove" variant="danger" className="flex-1" disabled={saving} onPress={remove} />
                      </View>
                    </View>
                  ) : (
                    <Pill label="Remove from Your circle" variant="danger" onPress={() => setConfirmRemove(true)} />
                  )}
                </View>
              )}
            </>
          ) : (
            friend && (
              <>
                {/* The person page. */}
                <View className="items-center gap-3">
                  <Face name={friend.name} circle={friend.circle} photoUrl={photoUrl} size={96} />
                  <Text accessibilityRole="header" className="text-center text-display text-stone-900 dark:text-stone-50">
                    {friend.name}
                  </Text>
                  <Pill label="Edit" icon="create-outline" onPress={() => startEdit(friend)} />
                </View>
                {/* Stage 3 puts the reach-out buttons here (Text / Call / Email
                    on the phone app; "Reach out however you usually do" and
                    "I reached out" on a computer). */}
                <RowLink
                  title={`Circle: ${CIRCLE_LABELS[friend.circle]}`}
                  subtitle="Move to another circle"
                  accessibilityLabel={`Circle: ${CIRCLE_LABELS[friend.circle]}. Move to another circle`}
                  onPress={() => {
                    setMoveError(null);
                    setMoving(true);
                  }}
                />
                <View className="gap-4 rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-stone-800">
                  <View className="gap-0.5">
                    <Text className="text-caption text-stone-500 dark:text-stone-400">How often you&apos;d like to be in touch</Text>
                    <Text className="text-body text-stone-800 dark:text-stone-200">{RHYTHM_LABELS[friend.rhythm]}</Text>
                    {pageLine && <Text className="text-body text-stone-700 dark:text-stone-300">{pageLine}</Text>}
                  </View>
                  <View className="gap-0.5">
                    <Text className="text-caption text-stone-500 dark:text-stone-400">Note</Text>
                    <Text className="text-body text-stone-800 dark:text-stone-200">{friend.note?.trim() || 'No note yet'}</Text>
                  </View>
                </View>
                <Text className="text-caption text-stone-500 dark:text-stone-400">Only you see this.</Text>
                <CirclePickerSheet
                  visible={moving}
                  name={friend.name}
                  current={friend.circle}
                  busy={saving}
                  error={moveError}
                  note="If how often you'd like to be in touch doesn't fit the new circle, it changes to that circle's usual one. You can change it with Edit."
                  onClose={() => setMoving(false)}
                  onPick={async (c) => {
                    setSaving(true);
                    const ok = await moveOutsideFriend(friend, c);
                    setSaving(false);
                    if (!ok) {
                      setMoveError("That didn't save. Please try again.");
                      return;
                    }
                    setMoving(false);
                    await load(friend.id);
                  }}
                />
              </>
            )
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
