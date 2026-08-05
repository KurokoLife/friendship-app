import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { track } from '@/lib/analytics';
import { getPremiumStatus, purchasePremiumSubscription, restorePremiumPurchase } from '@/lib/premium';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400

type Row = { label: string; free: string; premium: string };

// Numbers per the Capacity System (blueprint Sections 8/9/25, Fix #3):
// the forbidden-advantage rule ("Premium... do not increase compatibility
// ranking") is a fact about generate-match-suggestions' scoring code, not
// something this screen enforces, restated here only as plain copy, not
// re-implemented.
const COMPARISON_ROWS: Row[] = [
  { label: 'AI match suggestions per day', free: '2', premium: '5' },
  { label: 'Active conversations', free: '4', premium: '8' },
  { label: 'Pending Say Hi messages', free: '5', premium: '8' },
];

// Premium/Upgrade (2026-08-01), confirmed genuinely unbuilt before this:
// users.is_premium/premium_until both existed already (Capacity System,
// Referral system) but only ever as a manually-set flag, no purchase
// screen or payment webhook of any kind, re-confirmed absent this
// session. Uses the exact same proven pattern as the consumable AI
// credit packs (2026-07-29): real react-native-iap calls, real server-
// side receipt validation before ever touching is_premium, never trusts
// a client purchase-success callback alone. See src/lib/premium.ts's own
// header comment for what's structurally new here (a real subscription,
// not a one-time purchase) versus reused as-is.
export default function PremiumScreen() {
  const [loaded, setLoaded] = useState(false);
  const [isPremium, setIsPremium] = useState(false);
  const [premiumUntil, setPremiumUntil] = useState<string | null>(null);
  const [purchasing, setPurchasing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!isSupabaseConfigured) {
      setLoaded(true);
      return;
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoaded(true);
      return;
    }
    const status = await getPremiumStatus(user.id);
    setIsPremium(status.isPremium);
    setPremiumUntil(status.premiumUntil);
    setLoaded(true);
  };

  useEffect(() => {
    load();
  }, []);

  const handlePurchase = async () => {
    setPurchasing(true);
    setError(null);
    const result = await purchasePremiumSubscription();
    setPurchasing(false);
    if (result.status === 'success') {
      track('premium_purchased');
      setIsPremium(result.isPremium);
      setPremiumUntil(result.premiumUntil);
    } else if (result.status === 'error') {
      setError(result.message);
    }
  };

  const handleRestore = async () => {
    setPurchasing(true);
    setError(null);
    const result = await restorePremiumPurchase();
    setPurchasing(false);
    if (result.status === 'success') {
      setIsPremium(result.isPremium);
      setPremiumUntil(result.premiumUntil);
    } else if (result.status === 'error') {
      setError(result.message);
    }
  };

  if (!loaded) {
    return (
      <View className="flex-1 items-center justify-center bg-stone-50 dark:bg-stone-900">
        <ActivityIndicator color={MUTED_ICON_COLOR} />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-stone-50 dark:bg-stone-900">
      <SafeAreaView className="flex-1">
        <View className="px-6 pt-4">
          <Pressable onPress={() => router.back()}>
            <Text className="text-caption text-stone-500 dark:text-stone-400">Back</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerClassName="gap-6 px-6 pb-10 pt-6">
          <View className="gap-2">
            <Text className="text-display text-stone-900 dark:text-stone-50">Premium</Text>
            <Text className="text-body text-stone-500 dark:text-stone-400">
              $5.99/month. More room to connect, nothing about who you&apos;re shown changes.
            </Text>
          </View>

          {isPremium ? (
            <View className="gap-1 rounded-2xl border border-accent-500/40 bg-accent-500/5 p-5">
              <Text className="text-body font-semibold text-stone-900 dark:text-stone-50">
                You&apos;re on Premium
              </Text>
              {premiumUntil ? (
                <Text className="text-caption text-stone-500 dark:text-stone-400">
                  Renews or expires {new Date(premiumUntil).toLocaleDateString()}
                </Text>
              ) : (
                <Text className="text-caption text-stone-500 dark:text-stone-400">
                  No expiration on file for your account.
                </Text>
              )}
            </View>
          ) : (
            <View className="gap-3 rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-stone-800">
              {COMPARISON_ROWS.map((row) => (
                <View key={row.label} className="flex-row items-center justify-between">
                  <Text className="flex-1 text-body text-stone-600 dark:text-stone-300">{row.label}</Text>
                  <Text className="w-12 text-center text-body text-stone-400 dark:text-stone-500">{row.free}</Text>
                  <Text className="w-12 text-center text-body font-semibold text-accent-500">{row.premium}</Text>
                </View>
              ))}
              <View className="flex-row items-center justify-between border-t border-stone-100 pt-2 dark:border-stone-700">
                <Text className="flex-1 text-caption text-stone-400 dark:text-stone-600">&nbsp;</Text>
                <Text className="w-12 text-center text-caption text-stone-400 dark:text-stone-600">Free</Text>
                <Text className="w-12 text-center text-caption font-semibold text-accent-500">Premium</Text>
              </View>
            </View>
          )}

          <Text className="text-caption text-stone-400 dark:text-stone-600">
            Compatibility ranking never changes with Premium. It only affects how many suggestions and
            conversations you can have at once.
          </Text>

          {error && <Text className="text-caption text-red-600 dark:text-red-400">{error}</Text>}

          {!isPremium && (
            <Pressable
              onPress={handlePurchase}
              disabled={purchasing}
              className={`flex-row items-center justify-center gap-2 rounded-full bg-stone-900 py-4 active:opacity-80 dark:bg-stone-50 ${
                purchasing ? 'opacity-40' : ''
              }`}>
              {purchasing && <ActivityIndicator color={MUTED_ICON_COLOR} />}
              <Text className="text-body font-semibold text-stone-50 dark:text-stone-900">
                {purchasing ? 'Processing...' : 'Subscribe for $5.99/month'}
              </Text>
            </Pressable>
          )}

          {!isPremium && (
            <Pressable onPress={handleRestore} disabled={purchasing} className="items-center py-2">
              <Text className="text-caption font-semibold text-accent-500">Restore purchase</Text>
            </Pressable>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
