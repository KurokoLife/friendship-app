import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { goBack } from '@/lib/navigation';

// Placeholder content only, same status and reasoning as terms.tsx.
export default function PrivacyScreen() {
  return (
    <View className="flex-1 bg-stone-50 dark:bg-stone-900">
      <SafeAreaView className="flex-1">
        <View className="flex-row items-center px-6 pt-4">
          <Pressable className="min-h-11 flex-row items-center justify-center rounded-full border px-4 active:opacity-70 border-outline dark:border-stone-600" onPress={() => goBack('/settings')}>
            <Text className="text-caption font-semibold text-stone-900 dark:text-stone-50">Back</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerClassName="gap-4 px-6 pb-10 pt-6">
          <Text className="text-display text-stone-900 dark:text-stone-50">Privacy Policy</Text>
          <Text className="text-caption text-amber-600 dark:text-amber-400">
            This is placeholder text. A final Privacy Policy is forthcoming and will replace this
            page before launch.
          </Text>
          <Text className="text-body text-stone-600 dark:text-stone-400">
            In short, for now: Limen keeps the profile you choose to share, your messages so they can be
            delivered to the other person, your private notes, and when things happen (for example when a
            message was sent or a meetup was planned) so reminders can be timed.
          </Text>
          <Text className="text-body text-stone-600 dark:text-stone-400">
            No one at Limen, and no automated system, reads your chats. The only exception is a check for
            words linked to scams (like money or moving to another app), which runs on your own phone and
            keeps nothing. Your selfie is seen only by the Limen team for the selfie check and deleted once
            it&apos;s reviewed. Limen never sells your data or shows ads.
          </Text>
          <Text className="text-body text-stone-600 dark:text-stone-400">
            Full details on what is kept, for how long, and your rights over it will appear here.
          </Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
