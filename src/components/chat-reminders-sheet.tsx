import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Switch, Text, View } from 'react-native';

import {
  PROMPT_KINDS,
  PROMPT_LABELS,
  getPromptSettings,
  setPromptSetting,
  type PromptKind,
  type PromptSettings,
} from '@/lib/prompt-settings';

// "Reminders for this chat" (2026-10-10). Turns things off for one chat.
// Something turned off for all chats in Settings shows here as off, with a
// pointer to Settings.
export function ChatRemindersSheet({
  visible,
  connectionId,
  otherName,
  onClose,
  onChanged,
}: {
  visible: boolean;
  connectionId: string;
  otherName: string;
  onClose: () => void;
  onChanged: (settings: PromptSettings) => void;
}) {
  const [settings, setSettings] = useState<PromptSettings | null>(null);
  const [busy, setBusy] = useState<PromptKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    getPromptSettings(connectionId).then(setSettings);
  }, [visible, connectionId]);

  if (!visible) return null;

  const toggle = async (kind: PromptKind, enabled: boolean) => {
    setBusy(kind);
    setError(null);
    const ok = await setPromptSetting(connectionId, kind, enabled);
    if (!ok) setError("That didn't save. Please try again.");
    const fresh = await getPromptSettings(connectionId);
    setSettings(fresh);
    onChanged(fresh);
    setBusy(null);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 items-center justify-center bg-black/40 px-6">
        <ScrollView className="w-full grow-0" contentContainerClassName="gap-4 rounded-3xl bg-stone-50 p-6 dark:bg-stone-900">
          <Text className="text-title text-stone-900 dark:text-stone-50">Reminders for this chat</Text>
          <Text className="text-body text-stone-600 dark:text-stone-300">
            Choose what Limen shows you in your chat with {otherName}. Only you see these, and {otherName} isn&apos;t told.
          </Text>
          {PROMPT_KINDS.map((kind) => {
            const s = settings?.[kind];
            const offForAll = s ? !s.all : false;
            return (
              <View key={kind} className="flex-row items-start gap-3">
                <View className="flex-1 gap-0.5">
                  <Text className="text-body font-semibold text-stone-900 dark:text-stone-50">{PROMPT_LABELS[kind].title}</Text>
                  <Text className="text-caption text-stone-500 dark:text-stone-400">
                    {offForAll ? 'Turned off for all chats in Settings.' : PROMPT_LABELS[kind].detail}
                  </Text>
                </View>
                <Switch
                  accessibilityLabel={PROMPT_LABELS[kind].title}
                  value={s ? s.all && s.chat : true}
                  disabled={!s || offForAll || busy !== null}
                  onValueChange={(v) => toggle(kind, v)}
                />
              </View>
            );
          })}
          <Text className="text-caption text-stone-500 dark:text-stone-400">
            Always on: when someone says hello and hasn&apos;t heard back yet, one gentle note. It only shows once, and
            only before you&apos;ve both written.
          </Text>
          {error && <Text className="text-caption text-red-600 dark:text-red-400">{error}</Text>}
          <View className="flex-row flex-wrap items-center gap-4">
            <Pressable onPress={onClose} className="rounded-full bg-stone-900 px-4 py-2 active:opacity-80 dark:bg-stone-50">
              <Text className="text-caption font-semibold text-stone-50 dark:text-stone-900">Done</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                onClose();
                router.push('/settings');
              }}>
              <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">Settings for all chats</Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

// A quiet "Turn off for this chat" link for cards that can be turned off.
export function TurnOffForChatLink({
  connectionId,
  kind,
  label,
  onDone,
}: {
  connectionId: string;
  kind: PromptKind;
  label?: string;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Pressable
      disabled={busy}
      onPress={async () => {
        setBusy(true);
        await setPromptSetting(connectionId, kind, false);
        setBusy(false);
        onDone();
      }}
      className="self-start">
      <Text className="text-caption text-stone-400 underline dark:text-stone-500">{label ?? 'Turn these off for this chat'}</Text>
    </Pressable>
  );
}
