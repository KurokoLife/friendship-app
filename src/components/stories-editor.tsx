import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { MAX_STORIES, STORY_GUIDES, STORY_MAX_LENGTH, storyGuide, type Story } from '@/lib/stories';
import { palette } from '@/theme';

const MUTED_ICON_COLOR = palette.muted;

// Stories (rebuilt 2026-10-18): up to three, in the person's own words.
// Each story can start from one of five optional guides ("A moment from
// your life.", ...) or the person's own way. The guide only helps while
// writing: readers never see which one was picked. No word count, no
// minimum, no "Reflect first" here, so nobody writes for a grader.

type Props = {
  value: Story[];
  // Local edit (no save yet).
  onChange: (stories: Story[]) => void;
  // Save (called on blur, guide pick, add, and remove).
  onCommit: (stories: Story[]) => void;
};

const EMPTY: Story = { prompt_key: '', text: '' };

export function StoriesEditor({ value, onChange, onCommit }: Props) {
  // Always show at least one box to write in.
  const stories = value.length > 0 ? value : [EMPTY];
  // Which story's guide list is open (a new, empty story starts open).
  const [openGuides, setOpenGuides] = useState<number | null>(null);

  const update = (i: number, patch: Partial<Story>, commit = false) => {
    const next = stories.map((s, idx) => (idx === i ? { ...s, ...patch } : s));
    onChange(next);
    if (commit) onCommit(next);
  };

  return (
    <View className="gap-6">
      {stories.map((s, i) => {
        const guide = storyGuide(s.prompt_key);
        const guidesOpen = openGuides === i || (!guide && s.text.trim().length === 0 && openGuides === null);
        return (
          <View key={i} className="gap-3">
            {stories.length > 1 && (
              <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">Story {i + 1}</Text>
            )}
            {guidesOpen ? (
              <View className="gap-2">
                <Text className="text-caption text-stone-500 dark:text-stone-400">
                  Pick one of these to start, or start your own way.
                </Text>
                {STORY_GUIDES.map((g) => {
                  const picked = s.prompt_key === g.key;
                  return (
                    <Pressable
                      key={g.key}
                      accessibilityRole="button"
                      accessibilityState={{ selected: picked }}
                      onPress={() => {
                        setOpenGuides(-1);
                        update(i, { prompt_key: picked ? '' : g.key }, true);
                      }}
                      className={`gap-0.5 rounded-xl border px-4 py-3 ${
                        picked
                          ? 'border-stone-900 bg-stone-900 dark:border-stone-50 dark:bg-stone-50'
                          : 'border-stone-300 dark:border-stone-700'
                      }`}>
                      <Text
                        className={`text-body font-medium ${
                          picked ? 'text-stone-50 dark:text-stone-900' : 'text-stone-900 dark:text-stone-50'
                        }`}>
                        {g.title}
                      </Text>
                      <Text
                        className={`text-caption ${
                          picked ? 'text-stone-300 dark:text-stone-400' : 'text-stone-500 dark:text-stone-400'
                        }`}>
                        {g.hint}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <View className="flex-row flex-wrap items-baseline gap-x-3 gap-y-1">
                {guide && (
                  <Text className="text-caption text-stone-500 dark:text-stone-400">
                    {guide.title} {guide.hint}
                  </Text>
                )}
                <Pressable className="min-h-11 flex-row items-center justify-center rounded-full border px-4 active:opacity-70 border-outline dark:border-stone-600" onPress={() => setOpenGuides(i)} hitSlop={6}>
                  <Text className="text-caption font-semibold text-stone-900 dark:text-stone-50">
                    {guide ? 'Other ways to start' : 'Ways to start'}
                  </Text>
                </Pressable>
              </View>
            )}
            <TextInput
              value={s.text}
              onChangeText={(t) => update(i, { text: t.slice(0, STORY_MAX_LENGTH) })}
              onFocus={() => setOpenGuides(-1)}
              onBlur={() => onCommit(stories)}
              placeholder="Write it the way you'd tell a friend."
              placeholderTextColor={MUTED_ICON_COLOR}
              multiline
              numberOfLines={6}
              textAlignVertical="top"
              accessibilityLabel={`Story ${i + 1}`}
              className="min-h-32 rounded-xl border border-stone-300 px-3 py-3 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
            />
            {stories.length > 1 && (
              <Pressable onPress={() => onCommit(stories.filter((_, idx) => idx !== i))} className="min-h-11 flex-row items-center justify-center rounded-full border px-4 active:opacity-70 border-outline dark:border-stone-600 self-start">
                <Text className="text-caption font-semibold text-stone-900 dark:text-stone-50">Remove this story</Text>
              </Pressable>
            )}
          </View>
        );
      })}

      {stories.length < MAX_STORIES && stories[stories.length - 1].text.trim().length > 0 && (
        <Pressable
          onPress={() => {
            setOpenGuides(stories.length);
            onCommit([...stories, { ...EMPTY }]);
          }}
          className="min-h-11 flex-row items-center justify-center rounded-full border px-4 active:opacity-70 border-outline dark:border-stone-600 self-start">
          <Text className="text-caption font-semibold text-stone-900 dark:text-stone-50">Add another story (up to {MAX_STORIES})</Text>
        </Pressable>
      )}
    </View>
  );
}
