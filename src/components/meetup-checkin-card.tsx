import { Pressable, Text, View } from 'react-native';

import { resolveMeetupCheckin, type MeetupCheckinOutcome } from '@/lib/meetup-milestones';

type Props = {
  checkinId: string;
  otherName: string;
  // Set only when the other participant already reported a positive-
  // claiming outcome before this user answered, switches the framing
  // from a blank self-report to confirm-or-correct.
  otherReportedOutcome: 'went_well' | 'rough' | null;
  onResolved: () => void;
};

const OUTCOME_OPTIONS: { key: MeetupCheckinOutcome; label: string }[] = [
  { key: 'went_well', label: 'Yes, it went well' },
  { key: 'rough', label: 'Yes, but it was rough' },
  { key: 'didnt_happen', label: "No, it didn't happen" },
  { key: 'still_figuring', label: "We're still figuring it out" },
];

// Elapsed-time check-in (fired by the meetup-checkin-check cron job once
// roughly a week has passed since the connection's last planning
// activity with no more recent activity). No punishment anywhere in this
// card: picking "didn't happen" or leaving it unanswered has no
// consequence, same non-punitive stance as no-ghost's own "a single
// missed reply is never held against you."
export function MeetupCheckinCard({ checkinId, otherName, otherReportedOutcome, onResolved }: Props) {
  const handlePick = async (outcome: MeetupCheckinOutcome) => {
    await resolveMeetupCheckin(checkinId, outcome);
    onResolved();
  };

  const prompt = otherReportedOutcome
    ? `${otherName} mentioned you two met up. Did that happen for you too?`
    : "It's been a bit since you two talked about meeting up. How did it go?";

  return (
    <View className="gap-3 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
      <Text className="text-body text-stone-700 dark:text-stone-300">{prompt}</Text>
      <View className="gap-2">
        {OUTCOME_OPTIONS.map((option) => (
          <Pressable
            key={option.key}
            onPress={() => handlePick(option.key)}
            className="rounded-xl border border-stone-300 px-4 py-3 dark:border-stone-700">
            <Text className="text-body text-stone-900 dark:text-stone-50">{option.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
