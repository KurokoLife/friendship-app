import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { DateField, FieldLabel } from '@/components/date-time-field';
import { logPastMeetup } from '@/lib/friendship-journey';
import { isValidIsoDate, toIsoDate } from '@/lib/meetup-format';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400

// "We met up" (2026-10-10): adds a meetup two people made outside the app,
// so every time they meet is counted, not only plans made here. The other
// person is asked to confirm; it counts once they do, or after a week if
// they don't answer.
export function LogMeetupForm({
  connectionId,
  otherName,
  onDone,
  onCancel,
}: {
  connectionId: string;
  otherName: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const today = toIsoDate(new Date());
  const [date, setDate] = useState(today);
  const [activity, setActivity] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!isValidIsoDate(date) || date > today) {
      setError('Pick today or an earlier day.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await logPastMeetup(connectionId, date, activity);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't save. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="gap-3">
      <Text className="text-body text-stone-700 dark:text-stone-300">
        Met up without planning it here? Add it, and {otherName} will be asked to confirm.
      </Text>
      <View className="gap-1">
        <FieldLabel label="When did you meet?" />
        <DateField value={date} onChange={setDate} max={today} disabled={busy} />
      </View>
      <View className="gap-1">
        <FieldLabel label="What you did" optional />
        <TextInput
          value={activity}
          onChangeText={setActivity}
          placeholder="e.g. Coffee"
          placeholderTextColor={MUTED_ICON_COLOR}
          maxLength={120}
          editable={!busy}
          className="rounded-xl border border-stone-300 px-3 py-2 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
        />
      </View>
      {error && <Text className="text-caption text-red-600 dark:text-red-400">{error}</Text>}
      <View className="flex-row items-center gap-4">
        <Pressable
          onPress={save}
          disabled={busy}
          className={`rounded-full bg-stone-900 px-4 py-2 active:opacity-80 dark:bg-stone-50 ${busy ? 'opacity-40' : ''}`}>
          <Text className="text-caption font-semibold text-stone-50 dark:text-stone-900">
            {busy ? 'Saving...' : 'Add this meetup'}
          </Text>
        </Pressable>
        <Pressable onPress={onCancel} disabled={busy}>
          <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}
