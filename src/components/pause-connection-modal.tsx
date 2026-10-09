import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, Text, View } from 'react-native';

import {
  FriendlyError,
  PAUSE_OPTIONS,
  pauseConnectionWithDuration,
  type PauseDuration,
} from '@/lib/friendship-journey';

// What a pause means, shown wherever someone chooses one.
export function pauseExplainer(otherName: string): string {
  return `While a chat is paused there are no reminders, neither of you can send messages, and it doesn't count toward your 3 active conversations. ${otherName} will see that it's paused and when it opens again. You can resume sooner if you like.`;
}

// The three pause lengths, used by the header's Pause and by the reminder
// card's "I need more time".
export function PauseChoices({
  connectionId,
  onPaused,
}: {
  connectionId: string;
  onPaused: () => void;
}) {
  const [busy, setBusy] = useState<PauseDuration | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pause = async (duration: PauseDuration) => {
    if (busy) return;
    setBusy(duration);
    setError(null);
    try {
      await pauseConnectionWithDuration(connectionId, duration);
      onPaused();
    } catch (e) {
      setError(e instanceof FriendlyError ? e.message : "That didn't go through. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <View className="gap-2">
      <View className="flex-row flex-wrap gap-2">
        {PAUSE_OPTIONS.map((o) => (
          <Pressable
            key={o.key}
            onPress={() => pause(o.key)}
            disabled={busy !== null}
            className={`flex-row items-center gap-2 rounded-full border border-stone-300 px-4 py-2 active:opacity-80 dark:border-stone-700 ${
              busy !== null && busy !== o.key ? 'opacity-40' : ''
            }`}>
            {busy === o.key && <ActivityIndicator size="small" color="#a8a29e" />}
            <Text className="text-caption font-semibold text-stone-900 dark:text-stone-50">{o.label}</Text>
          </Pressable>
        ))}
      </View>
      {error && <Text className="text-caption text-red-600 dark:text-red-400">{error}</Text>}
    </View>
  );
}

export function PauseConnectionModal({
  visible,
  onClose,
  onPaused,
  connectionId,
  otherName,
}: {
  visible: boolean;
  onClose: () => void;
  onPaused: () => void;
  connectionId: string;
  otherName: string;
}) {
  if (!visible) return null;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 items-center justify-center bg-black/40 px-6">
        <View className="w-full gap-4 rounded-3xl bg-stone-50 p-6 dark:bg-stone-900">
          <Text className="text-title text-stone-900 dark:text-stone-50">Pause this chat?</Text>
          <Text className="text-body text-stone-600 dark:text-stone-300">{pauseExplainer(otherName)}</Text>
          <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">For how long?</Text>
          <PauseChoices connectionId={connectionId} onPaused={onPaused} />
          <Pressable onPress={onClose} className="items-center py-2">
            <Text className="text-body text-stone-500 dark:text-stone-400">Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
