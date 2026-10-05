import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// Last onboarding screen (docs/DECISIONS.md onboarding screen 10). Sets the
// "up to 3 a week" expectation so a short list doesn't look broken, and
// offers the selfie check now: approval is manual and can take up to a
// day, so starting it here means most people are verified by the time
// they want to say Interested to someone.
export default function ModulesCompleteScreen() {
  return (
    <View className="flex-1 bg-stone-50 dark:bg-stone-900">
      <SafeAreaView className="flex-1 justify-between px-6 py-10">
        <View className="gap-4 pt-16">
          <Text className="text-display text-stone-900 dark:text-stone-50">You&apos;re all set</Text>
          <Text className="text-body text-stone-600 dark:text-stone-300">
            Your first suggestions will arrive soon. You&apos;ll get up to 3 a week, so take your time with
            each one.
          </Text>
          <Text className="text-body text-stone-600 dark:text-stone-300">
            Before you can say hello to anyone, we check that you&apos;re you, with a quick selfie matched to
            your profile photo. It usually takes less than a day.
          </Text>
          <Text className="text-caption text-stone-500 dark:text-stone-400">
            Short guides live in your Profile whenever you want them.
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
      </SafeAreaView>
    </View>
  );
}
