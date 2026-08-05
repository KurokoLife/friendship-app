import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, Text, View } from 'react-native';

import { blockUser } from '@/lib/report-block';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400

type Props = {
  visible: boolean;
  onClose: () => void;
  onBlocked: () => void;
  blockedId: string;
  otherName: string;
};

// Block, reachable from Chat, the Other User Profile screen, and directly
// from an active no-ghost prompt card, independent of whether a Report is
// also filed. Deliberately lighter than Honest Exit's multi-step flow,
// per explicit instruction: this needs to be fast in a genuinely unsafe
// moment, one screen, one confirmation, no drafting, no reason required.
export function BlockConfirmModal({ visible, onClose, onBlocked, blockedId, otherName }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    setBusy(true);
    setError(null);
    const result = await blockUser(blockedId);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onBlocked();
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 items-center justify-center bg-black/40 px-6">
        <View className="w-full gap-4 rounded-3xl bg-stone-50 p-6 dark:bg-stone-900">
          <Text className="text-title text-stone-900 dark:text-stone-50">Block {otherName}?</Text>
          <Text className="text-body text-stone-600 dark:text-stone-300">
            They will not be able to see your profile or message you, and you will not see theirs.
            This takes effect immediately.
          </Text>
          {error && <Text className="text-caption text-red-600 dark:text-red-400">{error}</Text>}
          <View className="flex-row gap-3 pt-2">
            <Pressable onPress={onClose} disabled={busy} className="flex-1 items-center py-3">
              <Text className="text-body text-stone-500 dark:text-stone-400">Cancel</Text>
            </Pressable>
            <Pressable
              onPress={handleConfirm}
              disabled={busy}
              className={`flex-1 flex-row items-center justify-center gap-2 rounded-full bg-red-600 py-3 active:opacity-80 ${
                busy ? 'opacity-40' : ''
              }`}>
              {busy && <ActivityIndicator color="#fff" />}
              <Text className="text-body font-semibold text-white">{busy ? 'Blocking...' : 'Block'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
