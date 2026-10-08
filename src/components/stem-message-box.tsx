import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { supabase } from '@/lib/supabase';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400

// A short message the person finishes in their own words (2026-10-08).
// Tapping a starter puts the opening words in the box; Send only turns on
// once they have added something of their own, the same rule as the Honest
// Exit starters. The app never writes the message for them.

export async function sendChatMessage(connectionId: string, text: string): Promise<boolean> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { error } = await supabase
    .from('messages')
    .insert({ connection_id: connectionId, sender_id: user.id, content: text.trim(), type: 'text' });
  return !error;
}

export function StemMessageBox({
  stems,
  sendLabel = 'Send',
  onSend,
  onCancel,
  cancelLabel = 'Back',
}: {
  stems: string[];
  sendLabel?: string;
  onSend: (text: string) => Promise<boolean>;
  onCancel?: () => void;
  cancelLabel?: string;
}) {
  const [text, setText] = useState('');
  const [stem, setStem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = text.trim();
  const addedOwnWords = stem ? trimmed.length > stem.trim().length + 1 && trimmed !== stem.trim() : trimmed.length > 0;

  const send = async () => {
    if (!addedOwnWords) return;
    setBusy(true);
    setError(null);
    const ok = await onSend(trimmed);
    setBusy(false);
    if (!ok) setError("That didn't send. Please try again.");
  };

  return (
    <View className="gap-2">
      <View className="flex-row flex-wrap gap-2">
        {stems.map((s) => (
          <Pressable
            key={s}
            onPress={() => {
              setStem(s);
              setText(s);
            }}
            className={`rounded-full border px-3 py-1.5 ${
              stem === s ? 'border-accent-500 bg-accent-500/10' : 'border-stone-300 dark:border-stone-700'
            }`}>
            <Text className="text-caption text-stone-700 dark:text-stone-300">{s.trim()}...</Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="Write it in your own words"
        placeholderTextColor={MUTED_ICON_COLOR}
        multiline
        className="min-h-20 rounded-xl border border-stone-300 px-3 py-3 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
      />
      <Text className="text-caption text-stone-400 dark:text-stone-500">
        {stem ? 'Finish it in your own words before sending.' : 'Pick a starter or write your own.'}
      </Text>
      {error && <Text className="text-caption text-red-600 dark:text-red-400">{error}</Text>}
      <View className="flex-row flex-wrap items-center gap-4">
        <Pressable
          onPress={send}
          disabled={busy || !addedOwnWords}
          className={`rounded-full bg-stone-900 px-4 py-2 active:opacity-80 dark:bg-stone-50 ${
            busy || !addedOwnWords ? 'opacity-40' : ''
          }`}>
          <Text className="text-caption font-semibold text-stone-50 dark:text-stone-900">
            {busy ? 'Sending...' : sendLabel}
          </Text>
        </Pressable>
        {onCancel && (
          <Pressable onPress={onCancel} disabled={busy}>
            <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">{cancelLabel}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
