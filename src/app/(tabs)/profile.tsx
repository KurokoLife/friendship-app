import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { QUESTIONS } from '@/app/big-five-assessment';
import { CoachMark } from '@/components/coach-mark';
import {
  WHAT_HELPED_PENDING_COPY,
  WHEN_UNCERTAIN_PENDING_COPY,
  type FriendshipExperience,
} from '@/lib/friendship-experience';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400

type ActivityInterests = {
  categories?: string[];
  details?: Record<string, Record<string, string[] | string>>;
  other?: string;
};

type OwnProfile = {
  display_name: string | null;
  birthdate: string | null;
  age: number | null;
  location_city: string | null;
  location_state: string | null;
  life_transitions: string[] | null;
  life_transitions_other: string | null;
  personal_statement: string | null;
  values: string[] | null;
  values_other: string | null;
  activity_interests: ActivityInterests | null;
  hangout_people_preference: string | null;
  hangout_type_preference: string[] | null;
  communication_freq: string | null;
  meeting_freq: string | null;
  response_time: string | null;
  friendship_type: string | null;
  communication_style_openness: string | null;
  availability: string[] | null;
  communication_modes: string[] | null;
  languages: string[] | null;
  languages_other: string | null;
  ethnicity: string[] | null;
  ethnicity_other: string | null;
  personality_16p: string | null;
  bar_preference: string | null;
  dealbreakers: string | null;
  photo_url: string | null;
  completion_pct: number;
  big_five_scores: { responses?: Record<string, string> } | null;
  friendship_experience: FriendshipExperience | null;
};

// Same per-category phrasing pattern candidate/[id].tsx already uses (a
// generic, warmer restatement of the fixed category someone picked, not
// anyone's real words), duplicated here rather than imported, this is a
// different screen (the viewer's own profile, not a candidate's).
const LIFE_TRANSITION_SENTENCES: Record<string, string> = {
  'Divorce or separation': "You're navigating a divorce or separation.",
  Relocation: "You're settling into a new place.",
  Bereavement: "You're carrying a loss right now.",
  'Career change': "You're in the middle of a career change.",
  'Empty nesting': "You're adjusting to an empty nest.",
  Retirement: "You're navigating retirement.",
  'Health journey': "You're on a health journey.",
  'Starting over after a long relationship': "You're starting over after a long relationship.",
  'Becoming a caregiver': "You're stepping into a caregiving role.",
  'Becoming a grandparent': "You're becoming a grandparent.",
  'Recovery journey': "You're on a recovery journey.",
  'Finding a new purpose': "You're looking for a new sense of purpose.",
};

function lifeTransitionSentences(transitions: string[] | null): string[] {
  return (transitions ?? []).map((t) => LIFE_TRANSITION_SENTENCES[t] ?? t);
}

function humanize(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDetailValue(value: string[] | string): string {
  return Array.isArray(value) ? value.join(', ') : value;
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <View className="gap-1">
      <Text className="text-caption text-stone-400 dark:text-stone-600">{label}</Text>
      <Text className="text-body text-stone-700 dark:text-stone-300">{value}</Text>
    </View>
  );
}

// Fix 4: the Profile tab, a locked, read-only view of the signed-in
// user's own profile in the exact field order given, with an Edit button
// that reuses profile-build.tsx as its edit mode (see that screen's own
// isEditMode handling) rather than building a second edit form.
export default function ProfileScreen() {
  const [loaded, setLoaded] = useState(false);
  const [profile, setProfile] = useState<OwnProfile | null>(null);
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
    const { data } = await supabase
      .from('profiles')
      .select(
        'display_name, birthdate, location_city, location_state, life_transitions, life_transitions_other, personal_statement, values, values_other, activity_interests, hangout_people_preference, hangout_type_preference, communication_freq, meeting_freq, response_time, friendship_type, communication_style_openness, availability, communication_modes, languages, languages_other, ethnicity, ethnicity_other, personality_16p, bar_preference, dealbreakers, photo_url, completion_pct, big_five_scores, friendship_experience'
      )
      .eq('user_id', user.id)
      .maybeSingle();

    if (data) {
      const age = data.birthdate
        ? Math.floor((Date.now() - new Date(data.birthdate).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
        : null;
      setProfile({ ...data, age } as OwnProfile);
    }
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

  const activityCategories = profile.activity_interests?.categories ?? [];

  return (
    <View className="flex-1 bg-stone-50 dark:bg-stone-900">
      <SafeAreaView className="flex-1">
        <ScrollView contentContainerClassName="gap-5 px-6 pb-10 pt-10">
          <View className="flex-row items-start justify-between">
            <View className="gap-2">
              <Text className="text-display text-stone-900 dark:text-stone-50">
                {profile.display_name ?? 'Your profile'}
                {profile.age ? `, ${profile.age}` : ''}
              </Text>
              <View className="h-2 w-40 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-700">
                <View
                  className="h-2 rounded-full bg-accent-500"
                  style={{ width: `${profile.completion_pct}%` }}
                />
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
            text="This is your own profile. You can edit it here, find the Guide video library, and manage your account in Settings."
          />

          <Row
            label="Location"
            value={[profile.location_city, profile.location_state].filter(Boolean).join(', ') || null}
          />

          {lifeTransitionSentences(profile.life_transitions).length > 0 && (
            <View className="gap-1">
              <Text className="text-caption text-stone-400 dark:text-stone-600">What brings you here</Text>
              {lifeTransitionSentences(profile.life_transitions).map((s, i) => (
                <Text key={i} className="text-body text-accent-500">
                  {s}
                </Text>
              ))}
              {profile.life_transitions_other && (
                <Text className="text-body text-accent-500">{profile.life_transitions_other}</Text>
              )}
            </View>
          )}

          <Row label="About you" value={profile.personal_statement} />

          {((profile.values?.length ?? 0) > 0 || profile.values_other) && (
            <View className="gap-2">
              <Text className="text-caption text-stone-400 dark:text-stone-600">Values</Text>
              <View className="flex-row flex-wrap gap-2">
                {profile.values?.map((v) => (
                  <View
                    key={v}
                    className="rounded-full border border-stone-200 bg-white px-3 py-1 dark:border-stone-700 dark:bg-stone-800">
                    <Text className="text-caption text-stone-700 dark:text-stone-300">{v}</Text>
                  </View>
                ))}
              </View>
              {profile.values_other && (
                <Text className="text-caption text-stone-600 dark:text-stone-300">
                  Also: {profile.values_other}
                </Text>
              )}
            </View>
          )}

          {(activityCategories.length > 0 || profile.activity_interests?.other) && (
            <View className="gap-2">
              <Text className="text-caption text-stone-400 dark:text-stone-600">Activity interests</Text>
              <View className="gap-2">
                {activityCategories.map((catKey) => {
                  const catDetails = profile.activity_interests?.details?.[catKey];
                  return (
                    <View
                      key={catKey}
                      className="gap-1 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
                      <Text className="text-body font-semibold text-stone-900 dark:text-stone-50">
                        {humanize(catKey)}
                      </Text>
                      {catDetails &&
                        Object.entries(catDetails).map(([field, value]) => (
                          <Text key={field} className="text-caption text-stone-600 dark:text-stone-300">
                            {humanize(field)}: {formatDetailValue(value)}
                          </Text>
                        ))}
                    </View>
                  );
                })}
              </View>
              {profile.activity_interests?.other && (
                <Text className="text-caption text-stone-600 dark:text-stone-300">
                  Also: {profile.activity_interests.other}
                </Text>
              )}
            </View>
          )}

          <View className="gap-3 rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-stone-800">
            <Row
              label="Hangout style"
              value={
                profile.hangout_people_preference || (profile.hangout_type_preference?.length ?? 0) > 0
                  ? [profile.hangout_people_preference, ...(profile.hangout_type_preference ?? [])]
                      .filter(Boolean)
                      .join(', ')
                  : null
              }
            />
            <Row label="Check-in frequency" value={profile.communication_freq} />
            <Row label="Meeting frequency" value={profile.meeting_freq} />
            <Row label="Response time" value={profile.response_time} />
            <Row label="Friendship type" value={profile.friendship_type} />
            <Row label="Communication style" value={profile.communication_style_openness} />
            <Row
              label="How you like to communicate"
              value={(profile.communication_modes?.length ?? 0) > 0 ? profile.communication_modes!.join(', ') : null}
            />
            <Row
              label="When you're generally free"
              value={(profile.availability?.length ?? 0) > 0 ? profile.availability!.join(', ') : null}
            />
            <Row
              label="Languages"
              value={
                (profile.languages?.length ?? 0) > 0 || profile.languages_other
                  ? [...(profile.languages ?? []), profile.languages_other].filter(Boolean).join(', ')
                  : null
              }
            />
            {((profile.ethnicity?.length ?? 0) > 0 || profile.ethnicity_other) && (
              <Row
                label="Ethnicity / race"
                value={[...(profile.ethnicity ?? []), profile.ethnicity_other].filter(Boolean).join(', ')}
              />
            )}
            <Row label="Bar preference" value={profile.bar_preference} />
          </View>

          <Pressable
            onPress={openReflection}
            className="items-center rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
            <Text className="text-body font-semibold text-accent-500">View my personality reflection</Text>
          </Pressable>

          {/* 2026-08-01: "Invite a friend" relocated to the new Settings
              screen (per the earlier decision to consolidate account-
              level surfaces there), this tab keeps only profile content
              and a single entry point into Settings. */}
          <Pressable
            onPress={() => router.push('/settings')}
            className="items-center rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
            <Text className="text-body font-semibold text-accent-500">Settings</Text>
          </Pressable>

          {/* Guide (F8) still doesn't have its own tab or the full
              four-category restructure blueprint calls for, that's a
              separate, larger, still-outstanding rebuild. This is just a
              real, always-reachable entry point to what already exists
              (guides.tsx, previously unreachable from anywhere in the
              app), added as part of the 2026-07-28 meetup redesign since
              its first-time milestone nudge needed somewhere real to
              point to. */}
          <Pressable
            onPress={() => router.push('/guides')}
            className="items-center rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
            <Text className="text-body font-semibold text-accent-500">Guide</Text>
          </Pressable>

          {profile.dealbreakers && (
            <View className="gap-1">
              <Text className="text-caption text-stone-400 dark:text-stone-600">Hard nos</Text>
              <Text className="text-body text-stone-700 dark:text-stone-300">{profile.dealbreakers}</Text>
            </View>
          )}

          <View className="items-center pt-2">
            {profile.photo_url ? (
              <Image source={{ uri: profile.photo_url }} className="h-24 w-24 rounded-full" />
            ) : (
              <View className="h-24 w-24 items-center justify-center rounded-full bg-stone-100 dark:bg-stone-700">
                <Text className="text-caption text-stone-400 dark:text-stone-500">No photo</Text>
              </View>
            )}
          </View>
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
