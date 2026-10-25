import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, Text, View } from 'react-native';

import { Pill } from '@/components/ui';
import { CIRCLES, CIRCLE_LABELS, type Circle } from '@/lib/circle';
import { circles, palette } from '@/theme';

// Choose which circle someone is in (design guide v1: moving happens on the
// person's own page, not from a word on the list).
export function CirclePickerSheet({
  visible,
  name,
  current,
  note,
  busy,
  error,
  onPick,
  onClose,
}: {
  visible: boolean;
  name: string;
  current: Circle;
  note?: string;
  busy?: boolean;
  error?: string | null;
  onPick: (c: Circle) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable onPress={onClose} className="flex-1 items-center justify-end bg-black/40">
        <Pressable
          onPress={() => undefined}
          className="w-full max-w-[640px] gap-3 rounded-t-3xl bg-stone-50 px-6 pb-10 pt-6 dark:bg-stone-900">
          <Text className="text-title text-stone-900 dark:text-stone-50">Which circle is {name.split(' ')[0]} in?</Text>
          {CIRCLES.map((c) => {
            const on = c === current;
            return (
              <Pressable
                key={c}
                onPress={() => (on ? onClose() : onPick(c))}
                disabled={busy}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                aria-checked={on}
                className={`min-h-12 flex-row items-center gap-3 rounded-2xl border px-4 py-3 active:opacity-70 ${
                  on ? 'border-accent-500 bg-accent-50 dark:bg-stone-800' : 'border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-800'
                }`}>
                <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: circles[c].face, borderWidth: 1, borderColor: circles[c].ringLine }} />
                <Text className="flex-1 text-body text-stone-900 dark:text-stone-50">{CIRCLE_LABELS[c]}</Text>
                {on && <Ionicons name="checkmark" size={20} color={palette.link} />}
              </Pressable>
            );
          })}
          {note ? <Text className="text-caption text-stone-500 dark:text-stone-400">{note}</Text> : null}
          {error ? <Text className="text-caption text-red-700 dark:text-red-400">{error}</Text> : null}
          <Pill label="Cancel" onPress={onClose} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}
