import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { PaddedSafeArea } from '@/components/padded-safe-area';
import { Pill } from '@/components/ui';
import { fetchJoining, wantsToMeetNew } from '@/lib/joining';
import { palette } from '@/theme';

// All set, the last joining screen. With Meet someone new: sets the "one
// new person a day" expectation and offers the selfie check now (approval is
// manual and can take up to a day). Without it (2026-10-26, rebuild stage 2):
// no profile and no selfie, just Your circle (wording approved 2026-10-27).
export default function ModulesCompleteScreen() {
  const [meetNew, setMeetNew] = useState<boolean | null>(null);

  useEffect(() => {
    fetchJoining().then((j) => setMeetNew(wantsToMeetNew(j)));
  }, []);

  if (meetNew === null) {
    return (
      <View className="flex-1 items-center justify-center bg-stone-50 dark:bg-stone-900">
        <ActivityIndicator color={palette.muted} />
      </View>
    );
  }

  const back = () =>
    router.replace(meetNew ? '/account-recovery' : { pathname: '/account-recovery', params: { from: 'joining' } });

  return (
    <View className="flex-1 bg-stone-50 dark:bg-stone-900">
      <PaddedSafeArea className="flex-1 justify-between px-6 py-10">
        <View className="gap-4">
          <Pill label="Back" className="self-start" onPress={back} />
          <Text className="text-display text-stone-900 dark:text-stone-50">You&apos;re all set</Text>
          {meetNew ? (
            <>
              <Text className="text-body text-stone-600 dark:text-stone-300">
                You&apos;ll meet one new person each day in Discover, so take your time with each one.
              </Text>
              <Text className="text-body text-stone-600 dark:text-stone-300">
                One more thing: a quick selfie, matched to your profile photo, so everyone knows people are who they
                say they are. You can say Interested while it&apos;s checked, and chats open once it&apos;s approved.
                It usually takes less than a day.
              </Text>
            </>
          ) : (
            <>
              <Text className="text-body text-stone-600 dark:text-stone-300">
                Your circle is where the people you&apos;d like to stay close to live. Add more anytime, a first name is
                enough.
              </Text>
              <Text className="text-body text-stone-600 dark:text-stone-300">
                If you&apos;d like to meet someone new later, you can set up a profile from Your circle or Discover.
              </Text>
            </>
          )}
        </View>

        {meetNew ? (
          <View className="gap-2">
            <Pill
              label="Do my selfie check now"
              variant="filled"
              onPress={() => router.replace({ pathname: '/selfie-check', params: { next: 'home' } })}
            />
            <Pill label="I'll do it later" onPress={() => router.replace('/circle')} />
          </View>
        ) : (
          <Pill label="Go to Your circle" variant="filled" onPress={() => router.replace('/circle')} />
        )}
      </PaddedSafeArea>
    </View>
  );
}
