import { Modal, Pressable, Text, View } from 'react-native';

type Props = {
  visible: boolean;
  otherName: string;
  note: string;
  onContinue: () => void;
};

// Remember Step 2: the original spec's "pre-meetup reminder" assumed a
// precise scheduled date to anchor a day-before notification to. That no
// longer exists (2026-07-28 milestone redesign), so this fires instead
// at the next real planning moment, when "Let's plan something" is
// re-engaged for a connection that already has approved Remember notes,
// see handlePlanSomething in thread/[id].tsx. A gentle surface, not an
// interruption, "Continue" always proceeds into the activity suggestions
// flow that would have opened anyway.
export function RememberReminderCard({ visible, otherName, note, onContinue }: Props) {
  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onContinue}>
      <View className="flex-1 items-center justify-center bg-black/40 px-6">
        <View className="w-full gap-4 rounded-3xl bg-stone-50 p-6 dark:bg-stone-900">
          <Text className="text-title text-stone-900 dark:text-stone-50">Before you plan something</Text>
          <Text className="text-body text-stone-600 dark:text-stone-300">
            Last time with {otherName}, you noted: &quot;{note}&quot;
          </Text>
          <Pressable
            onPress={onContinue}
            className="self-start rounded-full bg-stone-900 px-4 py-2 active:opacity-80 dark:bg-stone-50">
            <Text className="text-caption font-semibold text-stone-50 dark:text-stone-900">Continue</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
