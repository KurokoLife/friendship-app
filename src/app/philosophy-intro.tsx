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
            A new friendship often feels uncertain before it feels natural.
          </Text>
          <Text className="text-body text-stone-500 dark:text-stone-400">
            Both people may wonder whether to reach out, what an awkward moment means, or whether
            the other person is interested.
          </Text>
          <Text className="text-body text-stone-500 dark:text-stone-400">
            This app does not remove that uncertainty. It helps make the invisible parts of
            building friendship easier to understand, and easier to move through with curiosity,
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
