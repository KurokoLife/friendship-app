import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { goBack } from '@/lib/navigation';

// Placeholder content only, same status and reasoning as terms.tsx.
export default function PrivacyScreen() {
  return (
    <View className="flex-1 bg-stone-50 dark:bg-stone-900">
      <SafeAreaView className="flex-1">
        <View className="flex-row items-center px-6 pt-4">
          <Pressable onPress={() => goBack('/settings')}>
            <Text className="text-caption text-stone-500 dark:text-stone-400">Back</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerClassName="gap-4 px-6 pb-10 pt-6">
          <Text className="text-display text-stone-900 dark:text-stone-50">Privacy Policy</Text>
          <Text className="text-caption text-amber-600 dark:text-amber-400">
            This is placeholder text. A final Privacy Policy is forthcoming and will replace this
            page before launch.
          </Text>
          <Text className="text-body text-stone-600 dark:text-stone-400">
            Limen collects the profile information you choose to share, your messages with other
            members, and behavioral signals disclosed elsewhere in the app (see the readiness
            confirmation shown during onboarding). Real, complete details on what is collected, how
            it is used, and your rights over it will appear here.
          </Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
