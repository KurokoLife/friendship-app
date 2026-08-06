import { Pressable, Text, View } from 'react-native';

import {
  dismissMeetupConfirmationRequest,
  formatMeetupDateShort,
  resolveMeetupConfirmation,
} from '@/lib/meetup-milestones';

type Props = {
  requestId: string;
  otherName: string;
  reportedMeetupDate: string;
  onResolved: () => void;
  onDismissed: () => void;
};

// Graduation foundation (2026-08-25): a new, separate signal from
// MeetupCheckinCard's own private 4-option emotional record. Fires only
// when the OTHER participant just reported a meetup happened (went well
// or was rough, either counts), asking this participant to confirm the
// plain fact of it, decoupled from how either side felt about it.
//
// Deny and Ignore/dismiss are deliberately styled and worded almost
// identically here, and both leave zero trace the other participant can
// ever see (enforced by RLS, not just this component), matching the
// blueprint's "disagreement is not surfaced as interpersonal conflict"
// requirement. There is no third, harsher-sounding "Deny" button that
// would make picking it feel more consequential than simply not
// answering, on purpose.
export function MeetupConfirmationCard({
  requestId,
  otherName,
  reportedMeetupDate,
  onResolved,
  onDismissed,
}: Props) {
  const handleConfirm = async () => {
    await resolveMeetupConfirmation(requestId, 'confirmed');
    onResolved();
  };

  const handleDeny = async () => {
    await resolveMeetupConfirmation(requestId, 'denied');
    onResolved();
  };

  const handleDismiss = async () => {
    await dismissMeetupConfirmationRequest(requestId);
    onDismissed();
  };

  return (
    <View className="gap-3 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
      <Text className="text-body text-stone-700 dark:text-stone-300">
        {otherName} mentioned you two met up around {formatMeetupDateShort(reportedMeetupDate)}. Did that
        happen?
      </Text>
      <View className="gap-2">
        <Pressable
          onPress={handleConfirm}
          className="rounded-xl border border-stone-300 px-4 py-3 dark:border-stone-700">
          <Text className="text-body text-stone-900 dark:text-stone-50">Yes, that happened</Text>
        </Pressable>
        <Pressable
          onPress={handleDeny}
          className="rounded-xl border border-stone-300 px-4 py-3 dark:border-stone-700">
          <Text className="text-body text-stone-900 dark:text-stone-50">No, that's not right</Text>
        </Pressable>
        <Pressable onPress={handleDismiss} className="items-center py-1">
          <Text className="text-caption text-stone-400 dark:text-stone-600">Not now</Text>
        </Pressable>
      </View>
    </View>
  );
}
