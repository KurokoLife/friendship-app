import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PUBLIC_PROFILE_COLUMNS, PublicProfileView, type PublicProfile } from '@/components/public-profile-view';
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
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [loaded, setLoaded] = useState(false);

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
        <View className="gap-1 px-6 pt-10">
          <Pressable onPress={() => goBack('/settings')}>
            <Text className="text-caption text-stone-500 dark:text-stone-400">Back</Text>
          </Pressable>
          <Text className="text-caption font-semibold uppercase tracking-wide text-accent-500">Preview</Text>
          <Text className="text-caption text-stone-400 dark:text-stone-600">
            This is what another member sees when they open your profile.
          </Text>
        </View>

        <ScrollView contentContainerClassName="px-6 pb-10 pt-5">
          <PublicProfileView profile={profile} readOnly />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
