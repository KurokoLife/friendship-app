import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { goBack } from '@/lib/navigation';

// Placeholder content only. Real legal text has not been written yet,
// this screen exists so onboarding's acceptance step (profile-basics.tsx)
// and Settings both have a real, navigable destination rather than a
// dead link, and so the placeholder status is honest and visible rather
// than silently pretending this is finished legal copy.
export default function TermsScreen() {
  return (
    <View className="flex-1 bg-stone-50 dark:bg-stone-900">
      <SafeAreaView className="flex-1">
        <View className="flex-row items-center px-6 pt-4">
          <Pressable onPress={() => goBack('/settings')}>
            <Text className="text-caption text-stone-500 dark:text-stone-400">Back</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerClassName="gap-4 px-6 pb-10 pt-6">
          <Text className="text-display text-stone-900 dark:text-stone-50">Terms of Service</Text>
          <Text className="text-caption text-amber-600 dark:text-amber-400">
            This is placeholder text. Final Terms of Service are forthcoming and will replace this
            page before launch.
          </Text>
          <Text className="text-body text-stone-600 dark:text-stone-400">
            By using Limen, you agree to treat other members with honesty and respect, and to follow
            the community guidelines shown elsewhere in the app. Real, complete legal terms covering
            your rights and responsibilities as a user of this app will appear here.
          </Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
