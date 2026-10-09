import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { JOURNEY_PRICE_OPTIONS, MONETIZATION_PHASE } from '@/lib/monetization';
import { goBack } from '@/lib/navigation';

// Limen v2 (2026-10-03): this route used to sell "Premium" ($5.99/month)
// for more suggestions, more active conversations, and more pending
// hellos. Selling capacity is gone (choice overload works against
// commitment, and it contradicts the founder's stated values), and so is
// the auto-renewing subscription. The route name stays /premium so older
// links don't break.
//
// Plan (docs/LIMEN_V2_DECISIONS.md, "Monetization"):
//   1. Pilot: everything free.                      <- current phase
//   2. Late pilot: optional "Founding member" contribution that also
//      funds free journeys for others.
//   3. Launch: one-time 6-month Journey pass, pick-your-price, every
//      feature included, "Free, no questions asked" is a full option.
// No ads, no data sales, no paywalled features, no auto-renew by default.
// Purchases for phases 2 and 3 need new store products (non-renewing),
// which aren't wired yet; see the decisions doc.

export default function SupportLimenScreen() {
  return (
    <SafeAreaView className="flex-1 bg-stone-50 dark:bg-stone-900">
      <ScrollView contentContainerClassName="gap-5 px-6 py-6">
        <Pressable onPress={() => goBack('/settings')}>
          <Text className="text-body text-stone-500 dark:text-stone-400">Back</Text>
        </Pressable>

        <Text className="text-title text-stone-900 dark:text-stone-50">How Limen is paid for</Text>

        <Text className="text-body text-stone-700 dark:text-stone-300">
          Everyone gets the same Limen. Nobody can pay for more matches, more conversations, or more AI. A few
          people at a time, given real attention, is the whole idea.
        </Text>

        {MONETIZATION_PHASE === 'pilot' ? (
          <View className="gap-2 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
            <Text className="text-body font-semibold text-stone-900 dark:text-stone-50">Free during the pilot</Text>
            <Text className="text-body text-stone-700 dark:text-stone-300">
              You don&apos;t need to pay anything right now. Thank you for helping shape Limen.
            </Text>
          </View>
        ) : null}

        <View className="gap-2">
          <Text className="text-body font-semibold text-stone-900 dark:text-stone-50">What comes after the pilot</Text>
          <Text className="text-body text-stone-700 dark:text-stone-300">
            A one-time 6-month Journey pass, not a subscription. You choose what you pay:
          </Text>
          {JOURNEY_PRICE_OPTIONS.map((o) => (
            <Text key={o.key} className="text-body text-stone-700 dark:text-stone-300">
              • {o.label}
              {o.note ? `, ${o.note}` : ''}
            </Text>
          ))}
          <Text className="text-caption text-stone-500 dark:text-stone-400">
            Free is a real option. No proof, no questions about income or insurance, and no features held back.
          </Text>
        </View>

        <View className="gap-2">
          <Text className="text-body font-semibold text-stone-900 dark:text-stone-50">What Limen will never do</Text>
          <Text className="text-body text-stone-700 dark:text-stone-300">
            Show ads, sell or share your data, lock features behind a paywall, or renew you automatically.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
