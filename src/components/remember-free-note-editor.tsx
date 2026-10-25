import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { MicPlaceholderButton } from '@/components/mic-placeholder-button';
import { loadDraft, saveDraft } from '@/lib/held-card';
import { TOPICS, type TopicKey } from '@/lib/remember';
import { palette } from '@/theme';

const MUTED_ICON_COLOR = palette.muted;
const TEXT_MAX = 4000;

// A free note about a friend (2026-10-10): one open box, the first line
// becomes the title, plus optional topic chips from a fixed list. In the
// person's own words. No AI.
export function RememberFreeNoteEditor({
  firstName,
  heading,
  draftKey,
  initialText,
  initialTopics,
  onSave,
  onCancel,
}: {
  firstName: string;
  heading: string;
  draftKey?: string;
  initialText: string;
  initialTopics: TopicKey[];
  onSave: (text: string, topics: TopicKey[]) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initialText);
  const [topics, setTopics] = useState<TopicKey[]>(initialTopics);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const empty = !text.trim();

  // Unsaved text and topics stay on this device, so a refresh doesn't lose
  // them (2026-10-10).
  const touched = useRef(false);
  useEffect(() => {
    if (!draftKey) return;
    loadDraft(draftKey).then((raw) => {
      if (!raw || touched.current) return;
      try {
        const d = JSON.parse(raw) as { text?: string; topics?: TopicKey[] };
        if (typeof d.text === 'string') setText(d.text);
        if (Array.isArray(d.topics)) setTopics(d.topics);
      } catch {
        // Ignore a broken draft.
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);
  const keep = (nextText: string, nextTopics: TopicKey[]) => {
    touched.current = true;
    if (draftKey) saveDraft(draftKey, JSON.stringify({ text: nextText, topics: nextTopics }));
  };

  const toggle = (key: TopicKey) =>
    setTopics((t) => {
      const next = t.includes(key) ? t.filter((k) => k !== key) : [...t, key];
      keep(text, next);
      return next;
    });

  const save = async () => {
    if (empty || saving) return;
    setSaving(true);
    setError(null);
    const problem = await onSave(text, topics);
    if (problem) {
      setError(problem);
      setSaving(false);
    } else if (draftKey) {
      saveDraft(draftKey, null);
    }
  };

  return (
    <View className="gap-3 rounded-3xl border border-accent-500/40 bg-white p-5 dark:bg-stone-800">
      <Text className="text-caption font-semibold text-accent-500 dark:text-accent-400">{heading}</Text>
      <View className="relative">
        <TextInput
          value={text}
          onChangeText={(v) => {
            setText(v);
            keep(v, topics);
          }}
          placeholder={`Something you want to remember about ${firstName}. The first line becomes the title.`}
          placeholderTextColor={MUTED_ICON_COLOR}
          multiline
          numberOfLines={5}
          maxLength={TEXT_MAX}
          textAlignVertical="top"
          editable={!saving}
          autoFocus
          accessibilityLabel="Your note"
          className="min-h-32 rounded-xl border border-stone-300 px-3 py-3 pr-12 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
        />
        <MicPlaceholderButton />
      </View>
      <View className="gap-2">
        <Text className="text-caption text-stone-500 dark:text-stone-400">Topic, if you like</Text>
        <View className="flex-row flex-wrap gap-2">
          {TOPICS.map((t) => {
            const on = topics.includes(t.key);
            return (
              <Pressable
                key={t.key}
                onPress={() => toggle(t.key)}
                disabled={saving}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                accessibilityLabel={`Topic: ${t.label}`}
                className={`rounded-full border px-3 py-1.5 ${
                  on
                    ? 'border-accent-500 bg-accent-500/10'
                    : 'border-stone-300 bg-transparent dark:border-stone-600'
                }`}>
                <Text
                  className={`text-caption ${
                    on ? 'font-semibold text-accent-500 dark:text-accent-400' : 'text-stone-600 dark:text-stone-300'
                  }`}>
                  {t.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      {error && <Text className="text-caption text-red-600 dark:text-red-400">{error}</Text>}
      <View className="flex-row items-center gap-4">
        <Pressable
          onPress={save}
          disabled={empty || saving}
          className={`rounded-full bg-apricot px-4 py-2 active:opacity-80 dark:bg-apricot ${
            empty || saving ? 'opacity-40' : ''
          }`}>
          <Text className="text-caption font-semibold text-white">
            {saving ? 'Saving...' : 'Save'}
          </Text>
        </Pressable>
        <Pressable className="min-h-11 flex-row items-center justify-center rounded-full border px-4 active:opacity-70 border-outline dark:border-stone-600"
          onPress={() => {
            if (draftKey) saveDraft(draftKey, null);
            onCancel();
          }}
          disabled={saving}>
          <Text className="text-caption font-semibold text-stone-900 dark:text-stone-50">Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}
