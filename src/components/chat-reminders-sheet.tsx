import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Switch, Text, View } from 'react-native';

import {
  PROMPT_KINDS,
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    getPromptSettings(connectionId).then(setSettings);
  }, [visible, connectionId]);

  if (!visible) return null;

  // 2026-10-23 (founder): one switch per chat. On means every kind of
  // reminder can show here (anything turned off for all chats in Settings
  // stays off); off turns them all off for this chat only.
  const chatOn = settings ? PROMPT_KINDS.every((k) => settings[k]?.chat !== false) : true;
  const someOffForAll = settings ? PROMPT_KINDS.some((k) => settings[k] && !settings[k].all) : false;

  const toggleAll = async (enabled: boolean) => {
    setBusy(true);
    setError(null);
    let ok = true;
    for (const kind of PROMPT_KINDS) {
      if (!(await setPromptSetting(connectionId, kind, enabled))) ok = false;
    }
    if (!ok) setError("That didn't save. Please try again.");
    const fresh = await getPromptSettings(connectionId);
    setSettings(fresh);
    onChanged(fresh);
    setBusy(false);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 items-center justify-center bg-black/40 px-6">
        <ScrollView className="w-full grow-0" contentContainerClassName="gap-4 rounded-3xl bg-stone-50 p-6 dark:bg-stone-900">
          <Text className="text-title text-stone-900 dark:text-stone-50">Reminders for this chat</Text>
          <View className="flex-row items-start gap-3">
            <View className="flex-1 gap-0.5">
              <Text className="text-body font-semibold text-stone-900 dark:text-stone-50">
                Reminders and nudges with {otherName}
              </Text>
              <Text className="text-caption text-stone-500 dark:text-stone-400">
                Check-ins, nudges to meet, the morning-of check, the calendar question and your notes coming back. Only you see these, and{' '}
                {otherName} isn&apos;t told.
              </Text>
            </View>
            <Switch
              accessibilityLabel={`Reminders and nudges with ${otherName}`}
              value={chatOn}
              disabled={!settings || busy}
              onValueChange={toggleAll}
            />
          </View>
          {someOffForAll && (
            <Text className="text-caption text-stone-500 dark:text-stone-400">
              Some are turned off for all chats. You can change those in Settings, Reminders and nudges.
            </Text>
          )}
          <Text className="text-caption text-stone-500 dark:text-stone-400">
            Always on: when someone says hello and hasn&apos;t heard back yet, one gentle note. It only shows once, and
            only before you&apos;ve both written.
          </Text>
          {error && <Text className="text-caption text-red-600 dark:text-red-400">{error}</Text>}
          <View className="flex-row flex-wrap items-center gap-4">
            <Pressable onPress={onClose} className="rounded-full bg-apricot px-4 py-2 active:opacity-80 dark:bg-apricot">
              <Text className="text-caption font-semibold text-white">Done</Text>
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
      className="min-h-11 flex-row items-center justify-center rounded-full border px-4 active:opacity-70 border-outline dark:border-stone-600 self-start">
      <Text className="text-caption font-semibold text-stone-900 dark:text-stone-50">{label ?? 'Turn these off for this chat'}</Text>
    </Pressable>
  );
}
