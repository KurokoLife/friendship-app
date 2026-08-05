import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { isSupabaseConfigured, supabase } from '@/lib/supabase';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400

type ActivityInterests = {
  categories?: string[];
  details?: Record<string, Record<string, string[] | string>>;
  other?: string;
};

type PreviewProfile = {
  user_id: string;
  display_name: string | null;
  age_band: string | null;
  location_city: string | null;
  location_state: string | null;
  life_transitions: string[] | null;
  life_transitions_other: string | null;
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
  personal_statement: string | null;
  bar_preference: string | null;
  dealbreakers: string | null;
  personality_16p: string | null;
  photo_url: string | null;
};

function initials(name: string | null): string {
  if (!name) return '?';
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

// Same reference maps as candidate/[id].tsx, duplicated rather than
// imported: that screen doesn't export them, and this preview is
// intentionally a parallel, independent read path (my_public_preview,
// not discovery_profiles), not a wrapper around the other-user screen
// itself, see this screen's own header comment for why.
const LIFE_TRANSITION_SENTENCES: Record<string, string> = {
  'Divorce or separation': 'Navigating life after a divorce or separation.',
  Relocation: 'Settling into a new place after a recent move.',
  Bereavement: 'Finding their way through grief and loss.',
  'Career change': 'Navigating a career change after years in one field.',
  'Empty nesting': 'Adjusting to a quieter house now that the kids are grown.',
  Retirement: 'Settling into a new rhythm after retirement.',
  'Health journey': 'Navigating a health journey.',
  'Starting over after a long relationship': 'Starting over after a long relationship.',
  'Becoming a caregiver': 'Adjusting to a new role as a caregiver.',
  'Becoming a grandparent': 'Settling into a new role as a grandparent.',
  'Recovery journey': 'Navigating a recovery journey.',
  'Finding a new purpose': 'Looking for a new sense of purpose.',
};

function lifeTransitionSentences(transitions: string[] | null): string[] {
  if (!transitions || transitions.length === 0) return [];
  return transitions.map((t) => LIFE_TRANSITION_SENTENCES[t] ?? t);
}

const PERSONALITY_TYPE_DESCRIPTIONS: Record<string, string> = {
  INTJ: 'Strategic and independent, values friendships with room for deep, honest conversation over small talk.',
  INTP: "Curious and analytical, bonds over ideas and doesn't need constant contact to feel close.",
  ENTJ: 'Direct and driven, shows care through action and appreciates friends who are equally straightforward.',
  ENTP: 'Quick witted and exploratory, thrives on playful debate and spontaneous plans.',
  INFJ: 'Thoughtful and empathetic, seeks a few deep, meaningful friendships over a wide social circle.',
  INFP: 'Guided by personal values, drawn to authentic one on one connection over group settings.',
  ENFJ: 'Warm and attentive, often the one checking in first and remembering the small details.',
  ENFP: 'Enthusiastic and warm, makes friends easily and loves bringing people together.',
  ISTJ: 'Reliable and steady, shows friendship through consistency and follow through, not grand gestures.',
  ISFJ: 'Loyal and considerate, quietly devoted to the people already in their life.',
  ESTJ: 'Organized and dependable, the one who actually plans the get together and follows through.',
  ESFJ: 'Sociable and caring, keeps a group connected and remembers what matters to everyone.',
  ISTP: 'Easygoing and low key, prefers shared activities over long talks to build closeness.',
  ISFP: 'Gentle and present, values quiet, low pressure time together over big social events.',
  ESTP: "Energetic and spontaneous, friendship often looks like showing up for whatever's happening.",
  ESFP: 'Fun loving and expressive, brings energy to a group and connects easily with new people.',
};

function humanize(key: string): string {
  return key
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function formatDetailValue(value: string[] | string): string {
  return Array.isArray(value) ? value.join(', ') : value;
}

// Public Profile Review (2026-08-01), confirmed genuinely unbuilt before
// this (a real, live "Public Profile Review" gap this project's own
// 2026-07-26 audit already confirmed by name, re-checked absent again
// this session). Deliberately reuses candidate/[id].tsx's exact section
// order and rendering logic (1: name/age-band/location/transitions, 2:
// personal statement, 3: values, 4: activities, the combined rhythm
// card, dealbreakers, photo last) rather than a new template, per
// explicit instruction, fed from my_public_preview (a self-scoped mirror
// of discovery_profiles' own column list and age_band computation, see
// that migration) instead of the other-user-scoped discovery_profiles.
// Report/Block/Edit are all absent by construction, this is a preview of
// your own profile, not a live view of someone else's, there is nothing
// here to report, block, or edit inline (Edit already lives one tap away
// via Settings).
export default function ProfileReviewScreen() {
  const [profile, setProfile] = useState<PreviewProfile | null>(null);
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
      const { data } = await supabase.from('my_public_preview').select('*').eq('user_id', user.id).maybeSingle();
      setProfile(data as PreviewProfile | null);
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
      <View className="flex-1 items-center justify-center bg-stone-50 dark:bg-stone-900 px-6">
        <Text className="text-center text-body text-stone-500 dark:text-stone-400">
          Your profile isn&apos;t ready to preview yet.
        </Text>
      </View>
    );
  }

  const activityCategories = profile.activity_interests?.categories ?? [];

  return (
    <View className="flex-1 bg-stone-50 dark:bg-stone-900">
      <SafeAreaView className="flex-1">
        <View className="gap-1 px-6 pt-10">
          <Pressable onPress={() => router.back()}>
            <Text className="text-caption text-stone-500 dark:text-stone-400">Back</Text>
          </Pressable>
          <Text className="text-caption font-semibold uppercase tracking-wide text-accent-500">
            Preview
          </Text>
          <Text className="text-caption text-stone-400 dark:text-stone-600">
            This is exactly what another compatible member sees when they open your profile.
          </Text>
        </View>

        <ScrollView contentContainerClassName="gap-5 px-6 pb-10 pt-5">
          <View className="gap-2">
            <Text className="text-title text-stone-900 dark:text-stone-50">
              {profile.display_name ?? 'A member'}
              {profile.age_band ? `, ${profile.age_band}` : ''}
            </Text>
            {(profile.location_city || profile.location_state) && (
              <Text className="text-caption text-stone-500 dark:text-stone-400">
                {[profile.location_city, profile.location_state].filter(Boolean).join(', ')}
              </Text>
            )}
            {lifeTransitionSentences(profile.life_transitions).map((sentence, index) => (
              <Text key={index} className="text-body text-accent-500">
                {sentence}
              </Text>
            ))}
            {profile.life_transitions_other && (
              <Text className="text-body text-accent-500">{profile.life_transitions_other}</Text>
            )}
          </View>

          {profile.personal_statement && (
            <View className="gap-2 rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-stone-800">
              <Text className="text-body text-stone-700 dark:text-stone-300">{profile.personal_statement}</Text>
            </View>
          )}

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
                <Text className="text-caption text-stone-600 dark:text-stone-300">Also: {profile.values_other}</Text>
              )}
            </View>
          )}

          {(activityCategories.length > 0 || profile.activity_interests?.other) && (
            <View className="gap-2">
              <Text className="text-caption text-stone-400 dark:text-stone-600">Into these lately</Text>
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
            {(profile.hangout_people_preference || (profile.hangout_type_preference?.length ?? 0) > 0) && (
              <View className="gap-1">
                <Text className="text-caption text-stone-400 dark:text-stone-600">Hangout style</Text>
                {profile.hangout_people_preference && (
                  <Text className="text-body text-stone-700 dark:text-stone-300">
                    Prefers {profile.hangout_people_preference} hangouts
                  </Text>
                )}
                {(profile.hangout_type_preference?.length ?? 0) > 0 && (
                  <Text className="text-body text-stone-700 dark:text-stone-300">
                    {profile.hangout_type_preference!.join(', ')}
                  </Text>
                )}
              </View>
            )}
            {profile.communication_freq && (
              <View className="gap-1">
                <Text className="text-caption text-stone-400 dark:text-stone-600">Communication frequency</Text>
                <Text className="text-body text-stone-700 dark:text-stone-300">{profile.communication_freq}</Text>
              </View>
            )}
            {profile.meeting_freq && (
              <View className="gap-1">
                <Text className="text-caption text-stone-400 dark:text-stone-600">Meeting frequency</Text>
                <Text className="text-body text-stone-700 dark:text-stone-300">{profile.meeting_freq}</Text>
              </View>
            )}
            {profile.response_time && (
              <View className="gap-1">
                <Text className="text-caption text-stone-400 dark:text-stone-600">Response time</Text>
                <Text className="text-body text-stone-700 dark:text-stone-300">{profile.response_time}</Text>
              </View>
            )}
            {(profile.availability?.length ?? 0) > 0 && (
              <View className="gap-1">
                <Text className="text-caption text-stone-400 dark:text-stone-600">Generally free</Text>
                <Text className="text-body text-stone-700 dark:text-stone-300">
                  {profile.availability!.join(', ')}
                </Text>
              </View>
            )}
            {profile.friendship_type && (
              <View className="gap-1">
                <Text className="text-caption text-stone-400 dark:text-stone-600">Friendship type</Text>
                <Text className="text-body text-stone-700 dark:text-stone-300">{profile.friendship_type}</Text>
              </View>
            )}
            {profile.communication_style_openness && (
              <View className="gap-1">
                <Text className="text-caption text-stone-400 dark:text-stone-600">Communication style</Text>
                <Text className="text-body text-stone-700 dark:text-stone-300">
                  {profile.communication_style_openness}
                </Text>
              </View>
            )}
            {(profile.communication_modes?.length ?? 0) > 0 && (
              <View className="gap-1">
                <Text className="text-caption text-stone-400 dark:text-stone-600">How they like to communicate</Text>
                <Text className="text-body text-stone-700 dark:text-stone-300">
                  {profile.communication_modes!.join(', ')}
                </Text>
              </View>
            )}
            {((profile.languages?.length ?? 0) > 0 || profile.languages_other) && (
              <View className="gap-1">
                <Text className="text-caption text-stone-400 dark:text-stone-600">Languages</Text>
                <Text className="text-body text-stone-700 dark:text-stone-300">
                  {[...(profile.languages ?? []), profile.languages_other].filter(Boolean).join(', ')}
                </Text>
              </View>
            )}
            {((profile.ethnicity?.length ?? 0) > 0 || profile.ethnicity_other) && (
              <View className="gap-1">
                <Text className="text-caption text-stone-400 dark:text-stone-600">Ethnicity / race</Text>
                <Text className="text-body text-stone-700 dark:text-stone-300">
                  {[...(profile.ethnicity ?? []), profile.ethnicity_other].filter(Boolean).join(', ')}
                </Text>
              </View>
            )}
            {profile.personality_16p && (
              <View className="gap-1">
                <Text className="text-caption text-stone-400 dark:text-stone-600">Personality type</Text>
                <Text className="text-body text-stone-700 dark:text-stone-300">{profile.personality_16p}</Text>
                {PERSONALITY_TYPE_DESCRIPTIONS[profile.personality_16p] && (
                  <Text className="text-caption text-stone-500 dark:text-stone-400">
                    {PERSONALITY_TYPE_DESCRIPTIONS[profile.personality_16p]}
                  </Text>
                )}
              </View>
            )}
            {profile.bar_preference && (
              <View className="gap-1">
                <Text className="text-caption text-stone-400 dark:text-stone-600">Bar preference</Text>
                <Text className="text-body text-stone-700 dark:text-stone-300">{profile.bar_preference}</Text>
              </View>
            )}
          </View>

          {profile.dealbreakers && (
            <View className="gap-1">
              <Text className="text-caption text-stone-400 dark:text-stone-600">Hard nos</Text>
              <Text className="text-body text-stone-700 dark:text-stone-300">{profile.dealbreakers}</Text>
            </View>
          )}

          <View className="items-center gap-2 pt-4">
            {profile.photo_url ? (
              <Image source={{ uri: profile.photo_url }} className="h-32 w-32 rounded-full bg-stone-200" />
            ) : (
              <View className="h-32 w-32 items-center justify-center rounded-full bg-stone-200 dark:bg-stone-700">
                <Text className="text-display text-stone-500 dark:text-stone-400">
                  {initials(profile.display_name)}
                </Text>
              </View>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
