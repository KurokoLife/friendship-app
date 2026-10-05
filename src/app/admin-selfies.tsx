import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { supabase } from '@/lib/supabase';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400

type PendingCheck = {
  userId: string;
  displayName: string | null;
  profilePhotoUrl: string | null;
  pose: string;
  selfieUrl: string | null;
  submittedAt: string;
};

// Selfie review, admins only (docs/DECISIONS.md section 3, item 5). Reached
// from Settings, which only shows the link when users.is_admin is true;
// the selfie-review edge function checks is_admin again server-side, so
// opening this screen without being an admin just shows an error.
//
// Compare the selfie with the profile photo and the requested pose.
// Approve or reject; either way the selfie file is deleted right away.
export default function AdminSelfiesScreen() {
  const [items, setItems] = useState<PendingCheck[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const { data, error: fnError } = await supabase.functions.invoke('selfie-review', { body: { action: 'list' } });
    if (fnError || data?.error) {
      setError(data?.error ?? 'Could not load selfie checks. Only admins can open this screen.');
      setItems([]);
      return;
    }
    setItems((data?.items ?? []) as PendingCheck[]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const decide = async (userId: string, approve: boolean) => {
    setDeciding(userId);
    const { data, error: fnError } = await supabase.functions.invoke('selfie-review', {
      body: { action: 'decide', userId, approve },
    });
    setDeciding(null);
    if (fnError || data?.error) {
      setError(data?.error ?? 'That decision did not save. Try again.');
      return;
    }
    setItems((prev) => (prev ?? []).filter((i) => i.userId !== userId));
  };

  return (
    <View className="flex-1 bg-stone-50 dark:bg-stone-900">
      <SafeAreaView className="flex-1">
        <ScrollView contentContainerClassName="gap-5 px-6 pb-10 pt-10">
          <Pressable onPress={() => router.back()}>
            <Text className="text-caption text-stone-500 dark:text-stone-400">Back</Text>
          </Pressable>
          <Text className="text-display text-stone-900 dark:text-stone-50">Selfie checks</Text>
          <Text className="text-caption text-stone-500 dark:text-stone-400">
            Approve only when the selfie clearly shows the same person as the profile photo, doing the requested
            pose. The selfie is deleted as soon as you decide.
          </Text>

          {error && <Text className="text-caption text-red-600 dark:text-red-400">{error}</Text>}

          {items === null ? (
            <ActivityIndicator color={MUTED_ICON_COLOR} />
          ) : items.length === 0 ? (
            <Text className="text-body text-stone-500 dark:text-stone-400">Nothing waiting for review.</Text>
          ) : (
            items.map((item) => (
              <View
                key={item.userId}
                className="gap-3 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
                <Text className="text-body font-semibold text-stone-900 dark:text-stone-50">
                  {item.displayName ?? 'A member'}
                </Text>
                <Text className="text-caption text-stone-500 dark:text-stone-400">Pose asked: {item.pose}</Text>
                <View className="flex-row gap-3">
                  <View className="flex-1 gap-1">
                    <Text className="text-caption text-stone-400 dark:text-stone-600">Profile photo</Text>
                    {item.profilePhotoUrl ? (
                      <Image source={{ uri: item.profilePhotoUrl }} className="aspect-square w-full rounded-xl bg-stone-200" />
                    ) : (
                      <Text className="text-caption text-stone-500">No photo</Text>
                    )}
                  </View>
                  <View className="flex-1 gap-1">
                    <Text className="text-caption text-stone-400 dark:text-stone-600">Selfie</Text>
                    {item.selfieUrl ? (
                      <Image source={{ uri: item.selfieUrl }} className="aspect-square w-full rounded-xl bg-stone-200" />
                    ) : (
                      <Text className="text-caption text-stone-500">File missing</Text>
                    )}
                  </View>
                </View>
                <View className="flex-row gap-2">
                  <Pressable
                    onPress={() => decide(item.userId, false)}
                    disabled={deciding === item.userId}
                    className="flex-1 items-center rounded-full border border-stone-300 py-3 dark:border-stone-600">
                    <Text className="text-caption font-semibold text-stone-600 dark:text-stone-300">Reject</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => decide(item.userId, true)}
                    disabled={deciding === item.userId}
                    className="flex-1 items-center rounded-full bg-stone-900 py-3 dark:bg-stone-50">
                    <Text className="text-caption font-semibold text-stone-50 dark:text-stone-900">
                      {deciding === item.userId ? 'Saving...' : 'Approve'}
                    </Text>
                  </Pressable>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
