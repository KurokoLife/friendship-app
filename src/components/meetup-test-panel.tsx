import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { friendlyToolError } from '@/lib/db-version';
import { supabase } from '@/lib/supabase';

// Test tools for meetups (2026-10-08): move a chat's meetup in time so
// each prompt can be checked right away instead of waiting a day.

const TESTS: { key: 'tomorrow' | 'today' | 'happened' | 'past' | 'remind'; label: string; hint: string }[] = [
  { key: 'tomorrow', label: 'Make it tomorrow', hint: 'Shows "Still on?"' },
  { key: 'today', label: 'Make it today', hint: 'Shows the morning-of card' },
  { key: 'happened', label: 'Make it yesterday', hint: 'Shows "Did you meet?"' },
  { key: 'past', label: 'Add a past meetup', hint: 'Adds one to the history' },
  { key: 'remind', label: 'Reminder due now', hint: '"Remind me later" comes back' },
];

export function MeetupTestPanel({ chatId, chatName }: { chatId: string; chatName: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const run = async (key: string) => {
    setBusy(key);
    setStatus(null);
    const { data, error } =
      key === 'remind'
        ? await supabase.rpc('test_share_reminder_now', { p_connection_id: chatId })
        : await supabase.rpc('dev_meetup_test', { p_connection_id: chatId, p_action: key });
    setBusy(null);
    setStatus(error ? friendlyToolError(error.message) : (data as string));
  };

  return (
    <View className="gap-3 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
      <View className="gap-1">
        <Text className="text-title text-stone-900 dark:text-stone-50">Meetups</Text>
        <Text className="text-caption text-stone-500 dark:text-stone-400">
          Moves the meetup in your chat with {chatName} in time, so each prompt shows now. With no plan yet, a test plan
          is made. Then open the chat as either person.
        </Text>
      </View>
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
      {status && <Text className="text-caption text-stone-700 dark:text-stone-300">{status}</Text>}
    </View>
  );
}
