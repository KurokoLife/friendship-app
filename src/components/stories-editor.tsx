import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { UniversalTextBox } from '@/components/universal-text-box';
import { MAX_STORIES, STORY_MAX_LENGTH, STORY_PROMPTS, STORY_REFLECTION_QUESTIONS, storyPromptLabel, type Story } from '@/lib/stories';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400

// Limen v2 (2026-10-03): write 2-3 short Stories in your own words. No AI
// writing or polishing; Reflect offers memory-jogging questions only.
// See docs/LIMEN_V2_DECISIONS.md.

type Props = {
  value: Story[];
  // Local edit (no save yet).
  onChange: (stories: Story[]) => void;
  // Save (called on blur, add, and remove).
  onCommit: (stories: Story[]) => void;
};

export function StoriesEditor({ value, onChange, onCommit }: Props) {
  const [picking, setPicking] = useState(false);
  const used = new Set(value.map((s) => s.prompt_key));

  const setText = (i: number, text: string) => {
    const next = value.map((s, idx) => (idx === i ? { ...s, text: text.slice(0, STORY_MAX_LENGTH) } : s));
    onChange(next);
  };

  return (
    <View className="gap-4">
      {value.map((s, i) => (
        <View key={`${s.prompt_key}-${i}`} className="gap-2">
          <Text className="text-caption font-semibold uppercase text-stone-500 dark:text-stone-400">
            {storyPromptLabel(s.prompt_key)}
          </Text>
          <TextInput
            value={s.text}
            onChangeText={(t) => setText(i, t)}
            onBlur={() => onCommit(value)}
            placeholder="Tell it the way you'd tell a friend. About 80 to 200 words."
            placeholderTextColor={MUTED_ICON_COLOR}
            multiline
            numberOfLines={5}
            textAlignVertical="top"
            className="min-h-28 rounded-xl border border-stone-300 px-3 py-3 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
          />
          <UniversalTextBox
            value={s.text}
            onChangeText={(t) => setText(i, t)}
            context="profile"
            reflectionQuestions={STORY_REFLECTION_QUESTIONS}
          />
          <Pressable onPress={() => onCommit(value.filter((_, idx) => idx !== i))} className="self-start">
            <Text className="text-caption text-stone-400 dark:text-stone-600">Remove this story</Text>
          </Pressable>
        </View>
      ))}

      {value.length < MAX_STORIES && !picking && (
        <Pressable onPress={() => setPicking(true)} className="self-start">
          <Text className="text-caption font-semibold text-accent-500">
            {value.length === 0 ? 'Add a story' : 'Add another story'}
          </Text>
        </Pressable>
      )}

      {picking && (
        <View className="gap-2">
          <Text className="text-caption text-stone-500 dark:text-stone-400">Pick a prompt:</Text>
          <View className="flex-row flex-wrap gap-2">
            {STORY_PROMPTS.filter((p) => !used.has(p.key)).map((p) => (
              <Pressable
                key={p.key}
                onPress={() => {
                  setPicking(false);
                  onCommit([...value, { prompt_key: p.key, text: '' }]);
                }}
                className="rounded-full border border-stone-300 px-3 py-2 dark:border-stone-700">
                <Text className="text-caption font-semibold text-stone-600 dark:text-stone-300">{p.label}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable onPress={() => setPicking(false)} className="self-start">
            <Text className="text-caption text-stone-500 dark:text-stone-400">Cancel</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
