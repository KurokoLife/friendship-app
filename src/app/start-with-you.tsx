import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { PaddedSafeArea } from '@/components/padded-safe-area';
import { StoriesEditor } from '@/components/stories-editor';
import { normalizeStories } from '@/lib/stories';
import { supabase } from '@/lib/supabase';
import {
  WHAT_BRINGS_MAX_LENGTH,
  clearStartDraft,
  loadStartDraft,
  saveStartDraft,
  type StartDraft,
} from '@/lib/start-draft';
import { palette } from '@/theme';

const MUTED_ICON_COLOR = palette.muted;

// Light grey examples inside the box, a different one each visit, so
// nobody copies one model answer.
const WHAT_BRINGS_EXAMPLES = [
  'Most of my friends moved away and I miss having people to call.',
  "I'm new in town and only know my coworkers so far.",
  'My kids are grown and my weekends suddenly feel very quiet.',
  "I'd love a friend to try new places with.",
];

// "Start with you" (2026-10-18): two things in the person's own words: what
// brings them here, and a story from their life. No word counts, no
// "Required", no step counter.
//
// 2026-10-19: this now comes right after sign-up and Basics (it used to come
// before the phone number). Everything is saved straight to the profile as
// the person writes (when they leave a box, pick a guide, add or remove a
// story), so it follows them to any device: start on the phone, finish on a
// computer. A copy also stays on the device as a backup if a save fails.

async function saveToProfile(d: StartDraft): Promise<boolean> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { error } = await supabase.from('profiles').upsert({
    user_id: user.id,
    life_transitions_other: d.whatBrings.trim().slice(0, WHAT_BRINGS_MAX_LENGTH) || null,
    show_life_transitions: true,
    stories: d.stories.filter((s) => s.text.trim()),
  });
  return !error;
}
export default function StartWithYouScreen() {
  const [draft, setDraft] = useState<StartDraft>({ whatBrings: '', stories: [] });
  const [loaded, setLoaded] = useState(false);
  const [triedContinue, setTriedContinue] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const example = useMemo(() => WHAT_BRINGS_EXAMPLES[Math.floor(Math.random() * WHAT_BRINGS_EXAMPLES.length)], []);
  const latest = useRef(draft);
  latest.current = draft;

  useEffect(() => {
    (async () => {
      // What's saved on the account wins; a draft left on this device (older
      // order, or a save that failed) fills in anything still empty.
      const local = await loadStartDraft();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      let saved: StartDraft = { whatBrings: '', stories: [] };
      if (user) {
        const { data } = await supabase
          .from('profiles')
          .select('life_transitions_other, stories')
          .eq('user_id', user.id)
          .maybeSingle();
        saved = {
          whatBrings: data?.life_transitions_other ?? '',
          stories: normalizeStories(data?.stories).filter((st) => st.text.trim()),
        };
      }
      setDraft({
        whatBrings: saved.whatBrings.trim() ? saved.whatBrings : local.whatBrings,
        stories: saved.stories.length > 0 ? saved.stories : local.stories,
      });
      setLoaded(true);
    })();
  }, []);

  const persist = async (d: StartDraft) => {
    await saveStartDraft(d);
    const ok = await saveToProfile(d);
    setSaveError(!ok);
    return ok;
  };

  const update = (patch: Partial<StartDraft>, save = false) => {
    const next = { ...latest.current, ...patch };
    setDraft(next);
    if (save) persist(next);
  };

  const hasWhatBrings = draft.whatBrings.trim().length > 0;
  const hasStory = draft.stories.some((s) => s.text.trim().length > 0);
  const ready = hasWhatBrings && hasStory;

  const onContinue = async () => {
    if (!ready) {
      setTriedContinue(true);
      return;
    }
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      router.replace('/phone-verification');
      return;
    }
    setSaving(true);
    const ok = await persist(latest.current);
    setSaving(false);
    if (!ok) return;
    await clearStartDraft();
    router.replace('/profile-build');
  };

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-stone-50 dark:bg-stone-900"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <PaddedSafeArea className="flex-1">
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-7 px-6 pb-6 pt-10">
          <Pressable onPress={() => router.replace('/profile-basics')} className="min-h-11 flex-row items-center justify-center rounded-full border px-4 active:opacity-70 border-outline dark:border-stone-600 self-start">
            <Text className="text-caption font-semibold text-stone-900 dark:text-stone-50">Back</Text>
          </Pressable>

          <View className="gap-2">
            <Text className="text-display text-stone-900 dark:text-stone-50">Start with you</Text>
            <Text className="text-body text-stone-500 dark:text-stone-400">
              Write the way you&apos;d talk to someone new over coffee. Messy is fine. Short is fine. It saves as you
              go, so you can finish or change it anytime, on your phone or a computer.
            </Text>
          </View>

          <View className="gap-3">
            <Text className="text-title text-stone-900 dark:text-stone-50">What brings you to Limen?</Text>
            <TextInput
              value={draft.whatBrings}
              onChangeText={(t) => update({ whatBrings: t.slice(0, WHAT_BRINGS_MAX_LENGTH) })}
              onBlur={() => persist(latest.current)}
              placeholder={example}
              placeholderTextColor={MUTED_ICON_COLOR}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              accessibilityLabel="What brings you to Limen?"
              className="min-h-20 rounded-xl border border-stone-300 px-3 py-3 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
            />
            <Text className="text-caption text-stone-500 dark:text-stone-400">
              Shown on your profile so people can get to know you.
            </Text>
          </View>

          <View className="gap-3">
            <View className="gap-1">
              <Text className="text-title text-stone-900 dark:text-stone-50">
                Share a story so people can get to know you.
              </Text>
              <Text className="text-body text-stone-500 dark:text-stone-400">
                Write it the way you&apos;d tell a friend.
              </Text>
            </View>
            {loaded && (
              <StoriesEditor
                value={draft.stories}
                onChange={(stories) => update({ stories })}
                onCommit={(stories) => update({ stories }, true)}
              />
            )}
            <Text className="text-caption text-stone-500 dark:text-stone-400">
              Shown on your profile. You can share up to three.
            </Text>
          </View>
        </ScrollView>

        <View className="gap-2 border-t border-stone-200 bg-stone-50 px-6 pb-6 pt-4 dark:border-stone-800 dark:bg-stone-900">
          {saveError && (
            <Text className="text-caption text-red-600 dark:text-red-400">
              That didn&apos;t save. Check your connection and try again. Your writing is still here.
            </Text>
          )}
          {triedContinue && !ready && (
            <Text className="text-caption text-stone-500 dark:text-stone-400">
              {!hasWhatBrings && !hasStory
                ? 'A line or two for each is plenty.'
                : !hasWhatBrings
                  ? 'Add a line or two about what brings you here.'
                  : 'Add a story, even a short one.'}
            </Text>
          )}
          <Pressable
            onPress={onContinue}
            disabled={saving}
            className={`items-center rounded-full bg-apricot py-4 active:opacity-80 dark:bg-apricot ${ready ? '' : 'opacity-60'}`}>
            <Text className="text-body font-semibold text-white">Continue</Text>
          </Pressable>
        </View>
      </PaddedSafeArea>
    </KeyboardAvoidingView>
  );
}
