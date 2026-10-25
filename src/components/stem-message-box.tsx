import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { supabase } from '@/lib/supabase';
import { palette } from '@/theme';

const MUTED_ICON_COLOR = palette.muted;

// A short message the person finishes in their own words (2026-10-08).
// Tapping a starter puts the opening words in the box; Send only turns on
// once they have added something of their own, the same rule as the Honest
// Exit starters. The app never writes the message for them.

// The chat listens here so a message sent from a card shows right away,
// without waiting for the live update (2026-10-13).
const sentListeners = new Set<(connectionId: string) => void>();
export function onChatMessageSent(listener: (connectionId: string) => void): () => void {
  sentListeners.add(listener);
  return () => {
    sentListeners.delete(listener);
  };
}

export async function sendChatMessage(connectionId: string, text: string): Promise<boolean> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { error } = await supabase
    .from('messages')
    .insert({ connection_id: connectionId, sender_id: user.id, content: text.trim(), type: 'text' });
  if (!error) sentListeners.forEach((l) => l(connectionId));
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
  // true when sent; false or a message to show when it didn't go through.
  onSend: (text: string) => Promise<boolean | string>;
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
    const result = await onSend(trimmed);
    setBusy(false);
    if (typeof result === 'string') setError(result);
    else if (!result) setError("That didn't send. Please try again.");
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
            className={`max-w-full rounded-2xl border px-3 py-1.5 ${
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
      <Text className="text-caption text-stone-500 dark:text-stone-400">
        {stem ? 'Finish it in your own words before sending.' : 'Pick a starter or write your own.'}
      </Text>
      {error && <Text className="text-caption text-red-600 dark:text-red-400">{error}</Text>}
      <View className="flex-row flex-wrap items-center gap-4">
        <Pressable
          onPress={send}
          disabled={busy || !addedOwnWords}
          className={`rounded-full bg-apricot px-4 py-2 active:opacity-80 dark:bg-apricot ${
            busy || !addedOwnWords ? 'opacity-40' : ''
          }`}>
          <Text className="text-caption font-semibold text-white">
            {busy ? 'Sending...' : sendLabel}
          </Text>
        </Pressable>
        {onCancel && (
          <Pressable className="min-h-11 flex-row items-center justify-center rounded-full border px-4 active:opacity-70 border-outline dark:border-stone-600" onPress={onCancel} disabled={busy}>
            <Text className="text-caption font-semibold text-stone-900 dark:text-stone-50">{cancelLabel}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
