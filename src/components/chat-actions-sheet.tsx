import { Modal, Pressable, Text, View } from 'react-native';

// 2026-10-23 (founder): Pause, End, Report and Block in one menu behind the
// ⋯ at the top of a chat. Block stays clearly marked in red.
type Props = {
  visible: boolean;
  onClose: () => void;
  canPause: boolean;
  canEnd: boolean;
  onPause: () => void;
  onEnd: () => void;
  onReport: () => void;
  onBlock: () => void;
};

function Row({ label, hint, danger, onPress }: { label: string; hint: string; danger?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" className="gap-0.5 py-3 active:opacity-70">
      <Text className={`text-body font-semibold ${danger ? 'text-red-600 dark:text-red-400' : 'text-stone-900 dark:text-stone-50'}`}>
        {label}
      </Text>
      <Text className="text-caption text-stone-500 dark:text-stone-400">{hint}</Text>
    </Pressable>
  );
}

export function ChatActionsSheet({ visible, onClose, canPause, canEnd, onPause, onEnd, onReport, onBlock }: Props) {
  const pick = (fn: () => void) => () => {
    onClose();
    fn();
  };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/30">
        <Pressable className="flex-1" onPress={onClose} accessibilityLabel="Close" />
        <View className="gap-1 rounded-t-3xl border-t border-stone-200 bg-stone-50 px-6 pb-8 pt-5 dark:border-stone-800 dark:bg-stone-900">
          <View className="mb-2 h-1 w-10 self-center rounded-full bg-stone-300 dark:bg-stone-700" />
          {canPause && <Row label="Pause" hint="Take a short break, with a note so they aren't left guessing." onPress={pick(onPause)} />}
          {canEnd && <Row label="End" hint="Close this chat honestly." onPress={pick(onEnd)} />}
          <Row label="Report" hint="Tell the Limen team privately if something felt wrong." onPress={pick(onReport)} />
          <Row label="Block" hint="Stop all contact right away." danger onPress={pick(onBlock)} />
          <Pressable onPress={onClose} className="min-h-11 flex-row items-center justify-center rounded-full border px-4 active:opacity-70 border-outline dark:border-stone-600">
            <Text className="text-body font-semibold text-stone-900 dark:text-stone-50">Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
