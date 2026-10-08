import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { supabase } from '@/lib/supabase';

// Test tools for meetups (2026-10-08): move a chat's meetup in time so
// each prompt can be checked right away instead of waiting a day.

const TESTS: { key: 'tomorrow' | 'today' | 'happened' | 'past'; label: string; hint: string }[] = [
  { key: 'tomorrow', label: 'Make it tomorrow', hint: 'Shows "Still on?"' },
  { key: 'today', label: 'Make it today', hint: 'Shows the morning-of card' },
  { key: 'happened', label: 'Make it yesterday', hint: 'Shows "Did you meet?"' },
  { key: 'past', label: 'Add a past meetup', hint: 'Adds one to the history' },
];

export function MeetupTestPanel({
  chats,
}: {
  chats: { connection_id: string; display_name: string | null; connection_status: string | null }[];
}) {
  const [chatId, setChatId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const run = async (key: string) => {
    if (!chatId) return;
    setBusy(key);
    setStatus(null);
    const { data, error } = await supabase.rpc('dev_meetup_test', { p_connection_id: chatId, p_action: key });
    setBusy(null);
    setStatus(error ? error.message : (data as string));
  };

  return (
    <View className="gap-3 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
      <View className="gap-1">
        <Text className="text-title text-stone-900 dark:text-stone-50">Meetup testing</Text>
        <Text className="text-caption text-stone-500 dark:text-stone-400">
          Pick a chat, then move its meetup in time to see each prompt. Then act as either person and open the chat.
        </Text>
      </View>
      {chats.length === 0 ? (
        <Text className="text-caption text-stone-500 dark:text-stone-400">This account has no chats yet.</Text>
      ) : (
        <View className="flex-row flex-wrap gap-2">
          {chats.map((c) => (
            <Pressable
              key={c.connection_id}
              onPress={() => {
                setChatId(c.connection_id);
                setStatus(null);
              }}
              className={`rounded-full border px-3 py-1.5 ${
                chatId === c.connection_id ? 'border-accent-500 bg-accent-500/10' : 'border-stone-300 dark:border-stone-700'
              }`}>
              <Text className="text-caption font-semibold text-stone-900 dark:text-stone-50">
                {c.display_name ?? 'A member'}
                {c.connection_status && c.connection_status !== 'active' ? ` (${c.connection_status})` : ''}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      {chatId && (
        <View className="gap-2">
          {TESTS.map((t) => (
            <Pressable
              key={t.key}
              onPress={() => run(t.key)}
              disabled={busy !== null}
              className={`flex-row items-center justify-between rounded-xl border border-stone-300 px-4 py-3 dark:border-stone-700 ${
                busy !== null ? 'opacity-50' : ''
              }`}>
              <Text className="text-body font-semibold text-stone-900 dark:text-stone-50">
                {busy === t.key ? 'Working...' : t.label}
              </Text>
              <Text className="text-caption text-stone-500 dark:text-stone-400">{t.hint}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {status && <Text className="text-caption text-stone-700 dark:text-stone-300">{status}</Text>}
    </View>
  );
}
