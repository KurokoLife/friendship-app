import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { StemMessageBox } from '@/components/stem-message-box';
import {
  FriendlyError,
  PAUSE_OPTIONS,
  pauseConnectionWithDuration,
  type PauseDuration,
} from '@/lib/friendship-journey';

// What a pause means, shown wherever someone chooses one.
export function pauseExplainer(otherName: string): string {
  return `While a chat is paused there are no reminders, neither of you can send messages, and it doesn't count toward your 3 active conversations. ${otherName} will see your note, that the chat is paused, and when it opens again. You can resume sooner if you like.`;
}

// Starters the person finishes in their own words. The app never writes
// the note for them.
const PAUSE_STEMS = ['Things are busy for me right now, ', 'I need a little time, ', "I'd like to keep talking, but "];

// How long, plus the note to the other person (2026-10-09: a pause always
// comes with a note, so it never feels like going quiet). Used by the
// header's Pause and by the reminder card's "I need more time".
export function PauseForm({
  connectionId,
  otherName,
  onPaused,
  onCancel,
  cancelLabel,
}: {
  connectionId: string;
  otherName: string;
  onPaused: () => void;
  onCancel?: () => void;
  cancelLabel?: string;
}) {
  const [duration, setDuration] = useState<PauseDuration>('one_week');

  return (
    <View className="gap-3">
      <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">For how long?</Text>
      <View className="flex-row flex-wrap gap-2">
        {PAUSE_OPTIONS.map((o) => (
          <Pressable
            key={o.key}
            onPress={() => setDuration(o.key)}
            className={`rounded-full border px-4 py-2 active:opacity-80 ${
              duration === o.key ? 'border-accent-500 bg-accent-500/10' : 'border-stone-300 dark:border-stone-700'
            }`}>
            <Text className="text-caption font-semibold text-stone-900 dark:text-stone-50">{o.label}</Text>
          </Pressable>
        ))}
      </View>
      <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">
        A short note to {otherName}
      </Text>
      <StemMessageBox
        stems={PAUSE_STEMS}
        sendLabel="Pause and send"
        cancelLabel={cancelLabel}
        onCancel={onCancel}
        onSend={async (text) => {
          try {
            await pauseConnectionWithDuration(connectionId, duration, text);
            onPaused();
            return true;
          } catch (e) {
            return e instanceof FriendlyError ? e.message : "That didn't go through. Please try again.";
          }
        }}
      />
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
        <ScrollView
          className="w-full grow-0"
          contentContainerClassName="gap-4 rounded-3xl bg-stone-50 p-6 dark:bg-stone-900">
          <Text className="text-title text-stone-900 dark:text-stone-50">Pause this chat?</Text>
          <Text className="text-body text-stone-600 dark:text-stone-300">{pauseExplainer(otherName)}</Text>
          <PauseForm
            connectionId={connectionId}
            otherName={otherName}
            onPaused={onPaused}
            onCancel={onClose}
            cancelLabel="Cancel"
          />
        </ScrollView>
      </View>
    </Modal>
  );
}
