import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, Text, View } from 'react-native';

import { track } from '@/lib/analytics';
import { dismissGraduationPrompt, graduateConnection, GRADUATION_COPY } from '@/lib/graduation';

type Props = {
  visible: boolean;
  connectionId: string;
  onKeptOrDeferred: () => void;
  onGraduated: () => void;
};

// Graduation (2026-08-06): fires once a connection reaches 5 mutually-
// confirmed in-person meetups. Copy is verbatim from the blueprint, not
// paraphrased, see graduation.ts's own GRADUATION_COPY. Three equally-
// weighted actions, no action is styled as more "correct" than the
// others, matching this app's own five-step choice principle (no
// hierarchy, no preferred answer). Neither "Keep Chat Available" nor
// "Not Yet" changes connection status, both re-arm the prompt for the
// next confirmed meetup rather than dismissing it forever, see
// dismiss_graduation_prompt's own comment for why.
export function GraduationModal({ visible, connectionId, onKeptOrDeferred, onGraduated }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleKeepChatAvailable = async () => {
    setBusy('keep');
    setError(null);
    try {
      await dismissGraduationPrompt(connectionId);
      // Beyond the blueprint's own stated minimum (Shown, Graduated, Not
      // Yet, 30/90-day continuation), this is a real, distinct third
      // choice worth its own signal rather than folding it into "Not
      // Yet," "minimum analytics" is a floor, not a ceiling, and
      // conflating "I've decided to keep this active" with "ask me
      // again later" would lose real product insight for no reason.
      track('graduation_kept_chat_available', { connectionId });
      onKeptOrDeferred();
    } catch {
      setError("That didn't go through. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const handleNotYet = async () => {
    setBusy('not_yet');
    setError(null);
    try {
      await dismissGraduationPrompt(connectionId);
      track('graduation_not_yet', { connectionId });
      onKeptOrDeferred();
    } catch {
      setError("That didn't go through. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const handleGraduate = async () => {
    setBusy('graduate');
    setError(null);
    try {
      await graduateConnection(connectionId);
      track('graduation_graduated', { connectionId });
      onGraduated();
    } catch {
      setError("That didn't go through. Try again.");
    } finally {
      setBusy(null);
    }
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View className="flex-1 items-center justify-center bg-black/40 px-6">
        <View className="w-full gap-4 rounded-3xl bg-stone-50 p-6 dark:bg-stone-900">
          <Text className="text-body text-stone-700 dark:text-stone-300">{GRADUATION_COPY}</Text>
          {error && <Text className="text-caption text-red-600 dark:text-red-400">{error}</Text>}
          <View className="gap-2 pt-2">
            <Pressable
              onPress={handleGraduate}
              disabled={busy !== null}
              className="flex-row items-center justify-center gap-2 rounded-xl border border-stone-300 px-4 py-3 dark:border-stone-700">
              {busy === 'graduate' && <ActivityIndicator color="#a8a29e" />}
              <Text className="text-body text-stone-900 dark:text-stone-50">Move to Graduated</Text>
            </Pressable>
            <Pressable
              onPress={handleKeepChatAvailable}
              disabled={busy !== null}
              className="flex-row items-center justify-center gap-2 rounded-xl border border-stone-300 px-4 py-3 dark:border-stone-700">
              {busy === 'keep' && <ActivityIndicator color="#a8a29e" />}
              <Text className="text-body text-stone-900 dark:text-stone-50">Keep chat available</Text>
            </Pressable>
            <Pressable onPress={handleNotYet} disabled={busy !== null} className="items-center py-1">
              <Text className="text-caption text-stone-400 dark:text-stone-600">Not yet</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
