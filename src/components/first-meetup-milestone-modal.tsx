import { router } from 'expo-router';
import { Modal, Pressable, Text, View } from 'react-native';

import { submitFirstMeetupFeeling, type FirstMeetupFeeling } from '@/lib/meetup-milestones';

type Props = {
  visible: boolean;
  connectionId: string;
  userId: string;
  onClose: () => void;
};

const FEELING_OPTIONS: { key: FirstMeetupFeeling; label: string }[] = [
  { key: 'excited', label: 'Excited' },
  { key: 'neutral', label: 'Neutral' },
  { key: 'nervous', label: 'Nervous' },
];

// Fires once, the first time a connection ever engages with "Let's plan
// something" (see record_plan_activity's own return value). A simple tap,
// no AI inference, private (never shared with the other person, same
// stance the removed pre_meetup_curiosity_prompts held). The Guide nudge
// is a gentle pointer, not a forced interruption, closing without
// tapping anything is always available, this is explicitly not built
// like the old curiosity prompt's "cannot be fully ignored" pattern.
export function FirstMeetupMilestoneModal({ visible, connectionId, userId, onClose }: Props) {
  const handlePick = async (feeling: FirstMeetupFeeling) => {
    await submitFirstMeetupFeeling(connectionId, userId, feeling);
    onClose();
  };

  const handleGuideNudge = () => {
    onClose();
    router.push('/guides');
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 items-center justify-center bg-black/40 px-6">
        <View className="w-full gap-5 rounded-3xl bg-stone-50 p-6 dark:bg-stone-900">
          <View className="gap-2">
            <Text className="text-title text-stone-900 dark:text-stone-50">
              You&apos;re starting to plan something together
            </Text>
            <Text className="text-body text-stone-600 dark:text-stone-300">How are you feeling about this?</Text>
          </View>

          <View className="flex-row gap-2">
            {FEELING_OPTIONS.map((option) => (
              <Pressable
                key={option.key}
                onPress={() => handlePick(option.key)}
                className="flex-1 items-center rounded-2xl border border-stone-300 py-3 dark:border-stone-700">
                <Text className="text-body font-semibold text-stone-900 dark:text-stone-50">{option.label}</Text>
              </Pressable>
            ))}
          </View>

          <Pressable
            onPress={handleGuideNudge}
            className="flex-row items-center justify-between rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
            <Text className="flex-1 text-caption text-stone-600 dark:text-stone-300">
              A few thoughts on a first meetup, whenever you want them
            </Text>
            <Text className="text-caption font-semibold text-accent-500">Guide</Text>
          </Pressable>

          <Pressable onPress={onClose} className="items-center py-1">
            <Text className="text-caption text-stone-400 dark:text-stone-600">Skip</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
