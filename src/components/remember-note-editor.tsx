import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { MicPlaceholderButton } from '@/components/mic-placeholder-button';
import { noteIsEmpty, type NoteFields } from '@/lib/remember';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400
const FIELD_MAX = 1000;

// One note about a friend, in the person's own words. Three short,
// optional questions plus room for anything else (2026-10-10). No AI.
export function RememberNoteEditor({
  firstName,
  heading,
  initial,
  onSave,
  onCancel,
}: {
  firstName: string;
  heading: string;
  initial: NoteFields;
  onSave: (fields: NoteFields) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [fields, setFields] = useState<NoteFields>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (key: keyof NoteFields) => (value: string) => setFields((f) => ({ ...f, [key]: value }));
  const empty = noteIsEmpty(fields);

  const save = async () => {
    if (empty || saving) return;
    setSaving(true);
    setError(null);
    const problem = await onSave(fields);
    if (problem) {
      setError(problem);
      setSaving(false);
    }
  };

  const field = (key: keyof NoteFields, label: string, placeholder: string, lines: number, mic = false) => (
    <View className="gap-1">
      <Text className="text-caption font-semibold text-stone-600 dark:text-stone-300">{label}</Text>
      <View className={mic ? 'relative' : undefined}>
        <TextInput
          value={fields[key]}
          onChangeText={set(key)}
          placeholder={placeholder}
          placeholderTextColor={MUTED_ICON_COLOR}
          multiline
          numberOfLines={lines}
          maxLength={FIELD_MAX}
          textAlignVertical="top"
          editable={!saving}
          accessibilityLabel={label}
          className={`rounded-xl border border-stone-300 px-3 py-3 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50 ${
            mic ? 'min-h-24 pr-12' : 'min-h-14'
          }`}
        />
        {mic && <MicPlaceholderButton />}
      </View>
    </View>
  );

  return (
    <View className="gap-3 rounded-3xl border border-accent-500/40 bg-white p-5 dark:bg-stone-800">
      <Text className="text-caption font-semibold text-accent-500">{heading}</Text>
      <Text className="text-caption text-stone-500 dark:text-stone-400">
        Answer any or none. Only you can see this.
      </Text>
      {field('learned', `What did you learn about ${firstName}?`, 'Something they shared', 2)}
      {field('smiled', 'What did you enjoy?', 'A moment you liked', 2)}
      {field('askNext', `Next time, I'd love to ask ${firstName}...`, 'How the trip went, how their sister is', 2)}
      {field('other', 'Anything else', 'In your own words', 3, true)}
      {error && <Text className="text-caption text-red-600 dark:text-red-400">{error}</Text>}
      <View className="flex-row items-center gap-4">
        <Pressable
          onPress={save}
          disabled={empty || saving}
          className={`rounded-full bg-stone-900 px-4 py-2 active:opacity-80 dark:bg-stone-50 ${
            empty || saving ? 'opacity-40' : ''
          }`}>
          <Text className="text-caption font-semibold text-stone-50 dark:text-stone-900">
            {saving ? 'Saving...' : 'Save'}
          </Text>
        </Pressable>
        <Pressable onPress={onCancel} disabled={saving}>
          <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}
