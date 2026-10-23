import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { PaddedSafeArea } from '@/components/padded-safe-area';

// Last onboarding screen (docs/DECISIONS.md onboarding screen 10). Sets the
// "up to 3 a week" expectation so a short list doesn't look broken, and
// offers the selfie check now: approval is manual and can take up to a
// day, so starting it here means most people are verified by the time
// they want to say Interested to someone.
export default function ModulesCompleteScreen() {
  return (
    <View className="flex-1 bg-stone-50 dark:bg-stone-900">
      <PaddedSafeArea className="flex-1 justify-between px-6 py-10">
        <View className="gap-4">
          <Pressable onPress={() => router.replace('/account-recovery')} className="self-start">
            <Text className="text-caption text-stone-500 dark:text-stone-400">Back</Text>
          </Pressable>
          <Text className="text-display text-stone-900 dark:text-stone-50">You&apos;re all set</Text>
          <Text className="text-body text-stone-600 dark:text-stone-300">
            You&apos;ll meet one new person each day in Discover, so take your time with each one.
          </Text>
          <Text className="text-body text-stone-600 dark:text-stone-300">
            One more thing: a quick selfie, matched to your profile photo, so everyone knows people are who they
            say they are. You can say Interested while it&apos;s checked, and chats open once it&apos;s approved.
            It usually takes less than a day.
          </Text>
        </View>

        <View className="gap-2">
          <Pressable
            onPress={() => router.replace({ pathname: '/selfie-check', params: { next: 'home' } })}
            className="items-center rounded-full bg-stone-900 py-4 active:opacity-80 dark:bg-stone-50">
            <Text className="text-body font-semibold text-stone-50 dark:text-stone-900">Do my selfie check now</Text>
          </Pressable>
          <Pressable onPress={() => router.replace('/home')} className="items-center py-3">
            <Text className="text-body text-stone-500 dark:text-stone-400">I&apos;ll do it later</Text>
          </Pressable>
        </View>
      </PaddedSafeArea>
    </View>
  );
}
