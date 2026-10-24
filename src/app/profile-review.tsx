import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PUBLIC_PROFILE_COLUMNS, PublicProfileView, type PublicProfile } from '@/components/public-profile-view';
import { SharedFriendshipAnswers } from '@/components/shared-friendship-answers';
import { normalizeExperience, SHARED_EXPERIENCE, type FriendshipExperience } from '@/lib/friendship-experience';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { goBack } from '@/lib/navigation';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400

// Public Profile Review: your own profile exactly as another member sees
// it. Renders through the same PublicProfileView as candidate/[id].tsx,
// fed from my_public_preview (a self-scoped mirror of discovery_profiles,
// hidden life transitions already blanked the same way). Stories show
// read-only, without anyone's private "I wonder..." notes. Report, Block
// and Edit are absent by construction; Edit lives one tap away in
// Settings.
export default function ProfileReviewScreen() {
  // 2026-10-18: also the last step of joining ("Here's what people will see").
  const { from } = useLocalSearchParams<{ from?: string }>();
  const onboarding = from === 'onboarding';
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [loaded, setLoaded] = useState(false);
  // 2026-10-23: what only people you have a chat with also see.
  const [care, setCare] = useState<string | null>(null);
  const [shared, setShared] = useState<FriendshipExperience | null>(null);

  useEffect(() => {
    (async () => {
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
      // my_public_preview has no distance_miles (there is no "distance to
      // yourself"), so the column list drops it; the view falls back to
      // showing your city.
      const columns = PUBLIC_PROFILE_COLUMNS.replace(', distance_miles', '');
      const { data } = await supabase.from('my_public_preview').select(columns).eq('user_id', user.id).maybeSingle();
      setProfile(data as PublicProfile | null);
      const { data: own } = await supabase
        .from('profiles')
        .select('care_style, share_friendship_experience, friendship_experience')
        .eq('user_id', user.id)
        .maybeSingle();
      // 2026-10-24: care words no longer shown (question removed).
      setCare(null);
      const exp = own?.share_friendship_experience && own.friendship_experience ? normalizeExperience(own.friendship_experience) : null;
      setShared(exp && SHARED_EXPERIENCE.some((x) => exp[x.key].length > 0) ? exp : null);
      setLoaded(true);
    })();
  }, []);

  if (!loaded) {
    return (
      <View className="flex-1 items-center justify-center bg-stone-50 dark:bg-stone-900">
        <ActivityIndicator color={MUTED_ICON_COLOR} />
      </View>
    );
  }

  if (!profile) {
    return (
      <View className="flex-1 items-center justify-center bg-stone-50 px-6 dark:bg-stone-900">
        <Text className="text-center text-body text-stone-500 dark:text-stone-400">
          Your profile isn&apos;t ready to preview yet.
        </Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-stone-50 dark:bg-stone-900">
      <SafeAreaView className="flex-1">
        {onboarding ? (
          <View className="gap-2 px-6 pt-10">
            <Pressable onPress={() => router.replace('/readiness-commitment')} className="self-start">
              <Text className="text-caption text-stone-500 dark:text-stone-400">Back</Text>
            </Pressable>
            <Text className="text-display text-stone-900 dark:text-stone-50">Here&apos;s what people will see</Text>
            <Text className="text-body text-stone-500 dark:text-stone-400">
              Your words, the way you wrote them. You can change anything now or later.
            </Text>
          </View>
        ) : (
          <View className="gap-1 px-6 pt-10">
            <Pressable onPress={() => goBack('/settings')}>
              <Text className="text-caption text-stone-500 dark:text-stone-400">Back</Text>
            </Pressable>
            <Text className="text-caption font-semibold uppercase tracking-wide text-accent-500">Preview</Text>
            <Text className="text-caption text-stone-400 dark:text-stone-600">
              This is what another member sees when they open your profile.
            </Text>
          </View>
        )}

        <ScrollView contentContainerClassName="px-6 pb-10 pt-5">
          <PublicProfileView profile={profile} readOnly />
          {(care || shared) && (
            <View className="mt-6 gap-3 border-t border-stone-200 pt-5 dark:border-stone-800">
              <Text className="text-caption font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
                Only people you have a chat with also see
              </Text>
              {care && (
                <View className="gap-1 rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-stone-800">
                  <Text className="text-title text-stone-900 dark:text-stone-50">
                    How {(profile.display_name ?? 'you').split(' ')[0]} likes care
                  </Text>
                  <Text className="text-body text-stone-700 dark:text-stone-300">“{care}”</Text>
                </View>
              )}
              {shared && <SharedFriendshipAnswers answers={shared} name={(profile.display_name ?? 'You').split(' ')[0]} />}
            </View>
          )}
        </ScrollView>

        {onboarding && (
          <View className="gap-3 border-t border-stone-200 bg-stone-50 px-6 pb-6 pt-4 dark:border-stone-800 dark:bg-stone-900">
            <Pressable
              onPress={() => router.replace('/account-recovery')}
              className="items-center rounded-full bg-stone-900 py-4 active:opacity-80 dark:bg-stone-50">
              <Text className="text-body font-semibold text-stone-50 dark:text-stone-900">Looks good</Text>
            </Pressable>
            <Pressable onPress={() => router.push('/profile-build?from=profile')} className="items-center py-1">
              <Text className="text-body text-stone-500 dark:text-stone-400">Edit something</Text>
            </Pressable>
          </View>
        )}
      </SafeAreaView>
    </View>
  );
}
