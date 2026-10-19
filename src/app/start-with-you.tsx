import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { PaddedSafeArea } from '@/components/padded-safe-area';
import { StoriesEditor } from '@/components/stories-editor';
import { supabase } from '@/lib/supabase';
import { WHAT_BRINGS_MAX_LENGTH, loadStartDraft, saveStartDraft, type StartDraft } from '@/lib/start-draft';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400

// Light grey examples inside the box, a different one each visit, so
// nobody copies one model answer.
const WHAT_BRINGS_EXAMPLES = [
  'Most of my friends moved away and I miss having people to call.',
  "I'm new in town and only know my coworkers so far.",
  'My kids are grown and my weekends suddenly feel very quiet.',
  "I'd love a friend to try new places with.",
];

// "Start with you" (2026-10-18): the first real step of joining, before the
// phone number. Two things in the person's own words: what brings them here,
// and a story from their life. Saved on the phone until sign-in
// (src/lib/start-draft.ts). No word counts, no "Required", no step counter.
export default function StartWithYouScreen() {
  const [draft, setDraft] = useState<StartDraft>({ whatBrings: '', stories: [] });
  const [loaded, setLoaded] = useState(false);
  const [triedContinue, setTriedContinue] = useState(false);
  const example = useMemo(() => WHAT_BRINGS_EXAMPLES[Math.floor(Math.random() * WHAT_BRINGS_EXAMPLES.length)], []);
  const latest = useRef(draft);
  latest.current = draft;

  useEffect(() => {
    loadStartDraft().then((d) => {
      setDraft(d);
      setLoaded(true);
    });
  }, []);

  const update = (patch: Partial<StartDraft>, save = false) => {
    const next = { ...latest.current, ...patch };
    setDraft(next);
    if (save) saveStartDraft(next);
  };

  const hasWhatBrings = draft.whatBrings.trim().length > 0;
  const hasStory = draft.stories.some((s) => s.text.trim().length > 0);
  const ready = hasWhatBrings && hasStory;

  const onContinue = async () => {
    if (!ready) {
      setTriedContinue(true);
      return;
    }
    await saveStartDraft(latest.current);
    // Someone who signed in first (from "Already a member? Sign in") goes on
    // to Basics, which saves this to their new profile.
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session) router.replace('/profile-basics');
    else router.push('/phone-verification');
  };

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-stone-50 dark:bg-stone-900"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <PaddedSafeArea className="flex-1">
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-7 px-6 pb-6 pt-10">
          <Pressable onPress={() => router.replace('/philosophy-intro')} className="self-start">
            <Text className="text-caption text-stone-500 dark:text-stone-400">Back</Text>
          </Pressable>

          <View className="gap-2">
            <Text className="text-display text-stone-900 dark:text-stone-50">Start with you</Text>
            <Text className="text-body text-stone-500 dark:text-stone-400">
              Write the way you&apos;d talk to someone new over coffee. Messy is fine. Short is fine. You can change
              it anytime.
            </Text>
          </View>

          <View className="gap-3">
            <Text className="text-title text-stone-900 dark:text-stone-50">What brings you to Limen?</Text>
            <TextInput
              value={draft.whatBrings}
              onChangeText={(t) => update({ whatBrings: t.slice(0, WHAT_BRINGS_MAX_LENGTH) })}
              onBlur={() => saveStartDraft(latest.current)}
              placeholder={example}
              placeholderTextColor={MUTED_ICON_COLOR}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              accessibilityLabel="What brings you to Limen?"
              className="min-h-20 rounded-xl border border-stone-300 px-3 py-3 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
            />
            <Text className="text-caption text-stone-400 dark:text-stone-500">
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
            <Text className="text-caption text-stone-400 dark:text-stone-500">
              Shown on your profile. You can share up to three.
            </Text>
          </View>
        </ScrollView>

        <View className="gap-2 border-t border-stone-200 bg-stone-50 px-6 pb-6 pt-4 dark:border-stone-800 dark:bg-stone-900">
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
            className={`items-center rounded-full bg-stone-900 py-4 active:opacity-80 dark:bg-stone-50 ${ready ? '' : 'opacity-60'}`}>
            <Text className="text-body font-semibold text-stone-50 dark:text-stone-900">Continue</Text>
          </Pressable>
        </View>
      </PaddedSafeArea>
    </KeyboardAvoidingView>
  );
}
