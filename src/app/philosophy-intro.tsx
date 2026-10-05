import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function PhilosophyIntroScreen() {
  return (
    <View className="flex-1 bg-stone-50 dark:bg-stone-900">
      <SafeAreaView className="flex-1 justify-between px-6 py-10">
        <View />

        <View className="gap-6">
          <Text className="text-display text-stone-900 dark:text-stone-50">
            Meeting people is only the beginning.
          </Text>
          <Text className="text-body text-stone-500 dark:text-stone-400">
            A new friendship often feels uncertain before it feels natural. Both people wonder
            whether to reach out, what an awkward moment means, or whether the other person is
            interested.
          </Text>
          {/* The liking gap: after a first conversation, people underestimate
              how much the other person liked them (Boothby et al., 2018). */}
          <Text className="text-body text-stone-500 dark:text-stone-400">
            One thing worth knowing: after a first conversation, most people underestimate how
            much the other person liked them.
          </Text>
          <Text className="text-body text-stone-500 dark:text-stone-400">
            Limen doesn&apos;t remove the uncertainty. It helps you move through it with curiosity,
            honesty, and care.
          </Text>
        </View>

        <View className="gap-3">
          <Pressable
            onPress={() => router.push('/phone-verification')}
            className="items-center rounded-full bg-stone-900 py-4 active:opacity-80 dark:bg-stone-50">
            <Text className="text-body font-semibold text-stone-50 dark:text-stone-900">
              Continue
            </Text>
          </Pressable>

          {__DEV__ && (
            <Pressable onPress={() => router.replace('/home')} className="items-center py-2">
              <Text className="text-caption text-stone-400 dark:text-stone-600">
                Skip to home (dev)
              </Text>
            </Pressable>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}
