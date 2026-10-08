import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { QUESTIONS } from '@/app/big-five-assessment';
import { CoachMark } from '@/components/coach-mark';
import { PUBLIC_PROFILE_COLUMNS, PublicProfileView, type PublicProfile } from '@/components/public-profile-view';
import {
  WHAT_HELPED_PENDING_COPY,
  WHEN_UNCERTAIN_PENDING_COPY,
  type FriendshipExperience,
} from '@/lib/friendship-experience';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400

// The private, own-row fields this tab needs beyond the public view.
type OwnProfile = {
  birthdate: string | null;
  age: number | null;
  location_city: string | null;
  life_transitions: string[] | null;
  life_transitions_other: string | null;
  show_life_transitions: boolean | null;
  care_style: string | null;
  min_friend_age: number | null;
  max_friend_age: number | null;
  search_radius_miles: number | null;
  gender_identity: string | null;
  meet_genders: string[] | null;
  completion_pct: number;
  big_five_scores: { responses?: Record<string, string> } | null;
  friendship_experience: FriendshipExperience | null;
};

const GENDER_LABELS: Record<string, string> = { woman: 'Woman', man: 'Man', non_binary: 'Non-binary' };
const MEET_LABELS: Record<string, string> = {
  woman: 'Women',
  man: 'Men',
  non_binary: 'Non-binary people',
  everyone: 'Everyone',
};

function PrivateRow({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <View className="gap-0.5">
      <Text className="text-caption text-stone-400 dark:text-stone-400">{label}</Text>
      <Text className="text-body text-stone-700 dark:text-stone-300">{value}</Text>
      <Text className="text-caption text-stone-500 dark:text-stone-400">{note}</Text>
    </View>
  );
}

// The Profile tab (rebuilt 2026-10-06). The top is your profile exactly
// as others see it (the same PublicProfileView as Other User Profile and
// the preview page). Anything you chose to hide is shown in place, dimmed,
// with a lock label. Everything that is always private sits in one
// "Only you can see this" box underneath. Edit reuses profile-build.tsx.
export default function ProfileScreen() {
  const [loaded, setLoaded] = useState(false);
  const [profile, setProfile] = useState<OwnProfile | null>(null);
  const [publicProfile, setPublicProfile] = useState<PublicProfile | null>(null);
  const [reflectionOpen, setReflectionOpen] = useState(false);
  const [connectionStyle, setConnectionStyle] = useState<string | null>(null);
  const [whatHelped, setWhatHelped] = useState<string | null>(null);
  const [whenUncertain, setWhenUncertain] = useState<string | null>(null);
  const [narrativeLoading, setNarrativeLoading] = useState(false);
  const [narrativeError, setNarrativeError] = useState<string | null>(null);

  const load = useCallback(async () => {
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
    const [{ data }, { data: preview }, { data: userRow }] = await Promise.all([
      supabase
        .from('profiles')
        .select(
          'birthdate, location_city, life_transitions, life_transitions_other, show_life_transitions, care_style, min_friend_age, max_friend_age, search_radius_miles, completion_pct, big_five_scores, friendship_experience'
        )
        .eq('user_id', user.id)
        .maybeSingle(),
      // my_public_preview has no distance_miles (no distance to yourself).
      supabase
        .from('my_public_preview')
        .select(PUBLIC_PROFILE_COLUMNS.replace(', distance_miles', ''))
        .eq('user_id', user.id)
        .maybeSingle(),
      supabase.from('users').select('gender_identity, meet_genders').eq('id', user.id).maybeSingle(),
    ]);

    if (data) {
      const age = data.birthdate
        ? Math.floor((Date.now() - new Date(data.birthdate).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
        : null;
      setProfile({
        ...data,
        age,
        gender_identity: userRow?.gender_identity ?? null,
        meet_genders: (userRow?.meet_genders as string[] | null) ?? null,
      } as OwnProfile);
    }
    setPublicProfile((preview as PublicProfile | null) ?? null);
    setLoaded(true);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Bug found and fixed 2026-07-28, unrelated to that day's friendship-
  // experience timing change but discovered while touching this same
  // display logic: this button read `data.narrative`, a field the server
  // hasn't returned since the July 26 rebuild to the three-section
  // {connectionStyle, whatHelped, whenUncertain} shape, so it silently
  // fell back to the generic error text every single time, for every
  // user. Also now sends the caller's own friendship_experience (if
  // they've answered it) so a retake reflects real, grounded content
  // instead of always showing pending copy once that data exists.
  const openReflection = async () => {
    setReflectionOpen(true);
    setConnectionStyle(null);
    setWhatHelped(null);
    setWhenUncertain(null);
    setNarrativeError(null);
    const responses = profile?.big_five_scores?.responses;
    if (!responses) {
      setNarrativeError("You haven't taken the personality reflection yet.");
      return;
    }
    setNarrativeLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-personality-narrative', {
        body: {
          answers: QUESTIONS.map((q) => ({ question: q.prompt, answer: responses[String(q.id)] })),
          ...(profile?.friendship_experience ? { friendshipExperience: profile.friendship_experience } : {}),
          // 2026-07-29: this is always a retake (viewing an already-taken
          // reflection from the Profile tab), the 1/day cap applies.
          context: 'retake',
        },
      });
      if (data?.blocked) {
        setNarrativeError(data.message as string);
        return;
      }
      if (error || !data?.connectionStyle || !data?.whatHelped || !data?.whenUncertain) {
        throw error ?? new Error('No reflection returned');
      }
      setConnectionStyle(data.connectionStyle as string);
      setWhatHelped(data.whatHelped as string);
      setWhenUncertain(data.whenUncertain as string);
    } catch {
      setNarrativeError(
        "We couldn't put your reflection into words just now, but your answers are saved."
      );
    } finally {
      setNarrativeLoading(false);
    }
  };

  if (!loaded) {
    return (
      <View className="flex-1 items-center justify-center bg-stone-50 dark:bg-stone-900">
        <ActivityIndicator color={MUTED_ICON_COLOR} />
      </View>
    );
  }

  if (!profile) {
    return (
      <View className="flex-1 items-center justify-center bg-stone-50 dark:bg-stone-900 px-6">
        <Text className="text-center text-body text-stone-500 dark:text-stone-400">
          {isSupabaseConfigured ? 'Sign in to see your profile.' : "Supabase isn't configured yet."}
        </Text>
      </View>
    );
  }

  const hiddenByChoice = profile.show_life_transitions === false;

  return (
    <View className="flex-1 bg-stone-50 dark:bg-stone-900">
      <SafeAreaView className="flex-1">
        <ScrollView contentContainerClassName="gap-5 px-6 pb-10 pt-10">
          <View className="flex-row items-start justify-between">
            <View className="gap-2">
              <Text className="text-display text-stone-900 dark:text-stone-50">Your profile</Text>
              <View className="h-2 w-40 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-700">
                <View className="h-2 rounded-full bg-accent-500" style={{ width: `${profile.completion_pct}%` }} />
              </View>
              <Text className="text-caption text-stone-500 dark:text-stone-400">
                {profile.completion_pct}% complete
              </Text>
            </View>
            <Pressable
              onPress={() => router.push('/profile-build?from=profile')}
              className="flex-row items-center gap-1 rounded-full border border-stone-300 px-4 py-2 dark:border-stone-700">
              <Ionicons name="pencil-outline" size={14} color={MUTED_ICON_COLOR} />
              <Text className="text-caption font-semibold text-stone-900 dark:text-stone-50">Edit</Text>
            </Pressable>
          </View>

          <CoachMark
            markKey="tab_profile"
            text="This is your profile as others see it. Anything marked with a lock is only visible to you."
          />

          {publicProfile ? (
            <PublicProfileView
              profile={publicProfile}
              readOnly
              ownerHidden={
                hiddenByChoice
                  ? {
                      lifeTransitions: profile.life_transitions ?? [],
                      lifeTransitionsOther: profile.life_transitions_other,
                    }
                  : undefined
              }
            />
          ) : (
            <Text className="text-body text-stone-500 dark:text-stone-400">
              Your profile isn&apos;t ready to show yet. Tap Edit to finish it.
            </Text>
          )}

          {/* Always private */}
          <View className="gap-4 rounded-2xl border border-dashed border-stone-300 p-5 dark:border-stone-600">
            <View className="flex-row items-center gap-2">
              <Ionicons name="lock-closed" size={14} color={MUTED_ICON_COLOR} />
              <Text className="text-body font-semibold text-stone-900 dark:text-stone-50">Only you can see this</Text>
            </View>
            {profile.age !== null && (
              <PrivateRow
                label="Your exact age"
                value={String(profile.age)}
                note={`Others see an age range${publicProfile?.age_band ? `: ${publicProfile.age_band}` : ''}.`}
              />
            )}
            <PrivateRow
              label="Your gender"
              value={profile.gender_identity ? GENDER_LABELS[profile.gender_identity] ?? profile.gender_identity : 'Not set'}
              note="Used only so the people you meet also chose to meet someone like you. Not shown on your profile."
            />
            <PrivateRow
              label="Who you'd like to meet"
              value={(profile.meet_genders ?? []).map((m) => MEET_LABELS[m] ?? m).join(', ') || 'Not set'}
              note="Works both ways: you only see people who would also like to meet you."
            />
            <PrivateRow
              label="Ages you're open to"
              value={
                profile.min_friend_age != null && profile.max_friend_age != null
                  ? `${profile.min_friend_age} to ${profile.max_friend_age}`
                  : 'Not set'
              }
              note="Also works both ways."
            />
            <PrivateRow
              label="How far you'll go to meet"
              value={profile.search_radius_miles != null ? `Up to ${profile.search_radius_miles} miles` : 'Not set'}
              note="Others only see roughly how far away you are."
            />
            <PrivateRow
              label="Phone number and ZIP code"
              value="Never shown"
              note={`Others only see your city${profile.location_city ? `: ${profile.location_city}` : ''}.`}
            />
            <PrivateRow
              label="How you like to be cared for"
              value={profile.care_style?.trim() ? profile.care_style : 'Not filled in yet'}
              note="Shown only to people you're already connected with."
            />
            <View className="gap-1">
              <Text className="text-caption text-stone-400 dark:text-stone-400">Your personality reflection</Text>
              <Text className="text-caption text-stone-500 dark:text-stone-400">
                Private, and used only to help you.
              </Text>
              <Pressable onPress={openReflection} className="pt-1">
                <Text className="text-body font-semibold text-accent-500">View my personality reflection</Text>
              </Pressable>
            </View>
          </View>

          <Pressable
            onPress={() => router.push('/profile-review')}
            className="items-center rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
            <Text className="text-body font-semibold text-accent-500">See exactly what others see</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push('/settings')}
            className="items-center rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
            <Text className="text-body font-semibold text-accent-500">Settings</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push('/guides')}
            className="items-center rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
            <Text className="text-body font-semibold text-accent-500">Guide</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>

      <Modal visible={reflectionOpen} transparent animationType="slide" onRequestClose={() => setReflectionOpen(false)}>
        <View className="flex-1 justify-end bg-black/40">
          <View className="gap-4 rounded-t-3xl bg-stone-50 p-6 pb-10 dark:bg-stone-900">
            <Text className="text-title text-stone-900 dark:text-stone-50">Your personality reflection</Text>
            {narrativeLoading && (
              <View className="flex-row items-center gap-3">
                <ActivityIndicator color={MUTED_ICON_COLOR} />
                <Text className="text-body text-stone-500 dark:text-stone-400">
                  Getting to know your answers...
                </Text>
              </View>
            )}
            {!narrativeLoading && connectionStyle && whatHelped && whenUncertain && (
              <ScrollView contentContainerClassName="gap-4">
                <View className="gap-1">
                  <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">
                    How you tend to connect
                  </Text>
                  <Text className="text-body text-stone-900 dark:text-stone-50">{connectionStyle}</Text>
                </View>
                <View className="gap-1">
                  <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">
                    What has helped before
                  </Text>
                  <Text className="text-body text-stone-900 dark:text-stone-50">
                    {profile?.friendship_experience ? whatHelped : WHAT_HELPED_PENDING_COPY}
                  </Text>
                </View>
                <View className="gap-1">
                  <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">
                    When things feel uncertain
                  </Text>
                  <Text className="text-body text-stone-900 dark:text-stone-50">
                    {profile?.friendship_experience ? whenUncertain : WHEN_UNCERTAIN_PENDING_COPY}
                  </Text>
                </View>
              </ScrollView>
            )}
            {!narrativeLoading && narrativeError && (
              <Text className="text-body text-stone-500 dark:text-stone-400">{narrativeError}</Text>
            )}
            <Pressable onPress={() => setReflectionOpen(false)} className="items-center py-2">
              <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}
