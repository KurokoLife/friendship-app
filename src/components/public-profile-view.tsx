import { Ionicons } from '@expo/vector-icons';
import { Image, ScrollView, Text, View } from 'react-native';

import { ProfileStories } from '@/components/profile-stories';
import { activityCategoryLabel, activityDetailLines } from '@/lib/activity-categories';
import { formatDistance } from '@/lib/distance';
import { lifeTransitionSentences } from '@/lib/life-transition';

const ACCENT_COLOR = '#B5643B'; // accent-500

// What other people see (docs/DECISIONS.md section 2). One shared view so
// Other User Profile (candidate/[id].tsx) and your own Public Profile
// Review (profile-review.tsx) can never drift apart.
//
// 1. Curiosity first: photos, first name, age range, distance, "Right
//    now, I'm...", stories, what brings you here (only if the person chose
//    to show it, the views already blank hidden ones), values, activities
//    with their details, what kind of friendship.
// 2. Then one compact "How they like to connect" box.
//
// Not shown anymore: ethnicity, 16 Personalities, communication modes,
// check-in frequency (still in the database, no longer asked or shown).

export const PUBLIC_PROFILE_COLUMNS =
  'user_id, display_name, age_band, location_city, distance_miles, life_transitions, life_transitions_other, values, values_other, activity_interests, hangout_people_preference, hangout_type_preference, meeting_freq, response_time, friendship_type, friendship_types, communication_style_openness, availability, languages, languages_other, personal_statement, bar_preference, dealbreakers, photo_url, extra_photo_urls, selfie_verified';

type ActivityInterests = {
  categories?: string[];
  details?: Record<string, Record<string, string[] | string>>;
  other?: string;
};

export type PublicProfile = {
  user_id: string;
  display_name: string | null;
  age_band: string | null;
  location_city: string | null;
  distance_miles?: number | null;
  life_transitions: string[] | null;
  life_transitions_other: string | null;
  values: string[] | null;
  values_other: string | null;
  activity_interests: ActivityInterests | null;
  hangout_people_preference: string | null;
  hangout_type_preference: string[] | null;
  meeting_freq: string | null;
  response_time: string | null;
  friendship_type: string | null;
  friendship_types?: string[] | null;
  communication_style_openness: string | null;
  availability: string[] | null;
  languages: string[] | null;
  languages_other: string | null;
  personal_statement: string | null;
  bar_preference: string | null;
  dealbreakers: string | null;
  photo_url: string | null;
  extra_photo_urls?: string[] | null;
  selfie_verified?: boolean | null;
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

function ConnectRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <View className="gap-0.5">
      <Text className="text-caption text-stone-400 dark:text-stone-600">{label}</Text>
      <Text className="text-body text-stone-700 dark:text-stone-300">{value}</Text>
    </View>
  );
}

export function PublicProfileView({ profile, readOnly = false }: { profile: PublicProfile; readOnly?: boolean }) {
  const extraPhotos = (profile.extra_photo_urls ?? []).filter(Boolean);
  const distance = formatDistance(profile.distance_miles ?? null, profile.location_city);
  const activityCategories = profile.activity_interests?.categories ?? [];
  const transitions = lifeTransitionSentences(profile.life_transitions);
  const languages = [...(profile.languages ?? []), profile.languages_other].filter(Boolean).join(', ');
  const hangout = (profile.hangout_type_preference ?? []).join(', ');
  const friendshipTypes = (
    profile.friendship_types?.length ? profile.friendship_types : [profile.friendship_type]
  ).filter(Boolean) as string[];

  return (
    <View className="gap-5">
      {/* Photos */}
      <View className="gap-3">
        {profile.photo_url ? (
          <Image source={{ uri: profile.photo_url }} className="aspect-square w-full rounded-3xl bg-stone-200" />
        ) : (
          <View className="aspect-square w-full items-center justify-center rounded-3xl bg-stone-200 dark:bg-stone-700">
            <Text className="text-display text-stone-500 dark:text-stone-400">{initials(profile.display_name)}</Text>
          </View>
        )}
        {extraPhotos.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-3">
            {extraPhotos.map((uri) => (
              <Image key={uri} source={{ uri }} className="h-28 w-28 rounded-2xl bg-stone-200" />
            ))}
          </ScrollView>
        )}
      </View>

      {/* Name, age range, distance */}
      <View className="gap-1">
        <View className="flex-row flex-wrap items-center gap-2">
          <Text className="text-title text-stone-900 dark:text-stone-50">
            {profile.display_name ?? 'A member'}
            {profile.age_band ? `, ${profile.age_band}` : ''}
          </Text>
          {profile.selfie_verified && (
            <View className="flex-row items-center gap-1 rounded-full border border-accent-500 px-2 py-0.5">
              <Ionicons name="checkmark-circle" size={12} color={ACCENT_COLOR} />
              <Text className="text-caption text-accent-500">Photo verified</Text>
            </View>
          )}
        </View>
        {distance && <Text className="text-caption text-stone-500 dark:text-stone-400">{distance}</Text>}
      </View>

      {/* Right now, I'm... */}
      {profile.personal_statement && (
        <View className="gap-1 rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-stone-800">
          <Text className="text-caption text-stone-400 dark:text-stone-600">Right now, I&apos;m...</Text>
          <Text className="text-body text-stone-700 dark:text-stone-300">{profile.personal_statement}</Text>
        </View>
      )}

      {/* Stories */}
      <ProfileStories subjectUserId={profile.user_id} subjectName={profile.display_name} readOnly={readOnly} />

      {/* What brings them here, only when they chose to show it */}
      {(transitions.length > 0 || profile.life_transitions_other) && (
        <View className="gap-1">
          <Text className="text-caption text-stone-400 dark:text-stone-600">What brings them here</Text>
          {transitions.map((sentence) => (
            <Text key={sentence} className="text-body text-accent-500">
              {sentence}
            </Text>
          ))}
          {profile.life_transitions_other && (
            <Text className="text-body text-accent-500">{profile.life_transitions_other}</Text>
          )}
        </View>
      )}

      {/* Values */}
      {((profile.values?.length ?? 0) > 0 || profile.values_other) && (
        <View className="gap-2">
          <Text className="text-caption text-stone-400 dark:text-stone-600">What matters to them</Text>
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

      {/* Activities, with whatever details they filled in */}
      {(activityCategories.length > 0 || profile.activity_interests?.other) && (
        <View className="gap-2">
          <Text className="text-caption text-stone-400 dark:text-stone-600">Into these lately</Text>
          {activityCategories.map((key) => {
            const lines = activityDetailLines(key, profile.activity_interests?.details?.[key]);
            return (
              <View
                key={key}
                className="gap-1 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
                <Text className="text-body font-semibold text-stone-900 dark:text-stone-50">
                  {activityCategoryLabel(key)}
                </Text>
                {lines.map((line) => (
                  <Text key={line} className="text-caption text-stone-600 dark:text-stone-300">
                    {line}
                  </Text>
                ))}
              </View>
            );
          })}
          {profile.activity_interests?.other && (
            <Text className="text-caption text-stone-600 dark:text-stone-300">
              Also: {profile.activity_interests.other}
            </Text>
          )}
        </View>
      )}

      {/* What kind of friendship */}
      {friendshipTypes.length > 0 && (
        <View className="gap-1">
          <Text className="text-caption text-stone-400 dark:text-stone-600">Looking for</Text>
          <Text className="text-body text-stone-700 dark:text-stone-300">{friendshipTypes.join(', ')}</Text>
        </View>
      )}

      {/* How they like to connect */}
      <View className="gap-3 rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-stone-800">
        <Text className="text-body font-semibold text-stone-900 dark:text-stone-50">How they like to connect</Text>
        <ConnectRow label="Meeting up" value={profile.meeting_freq} />
        <ConnectRow label="Replies" value={profile.response_time} />
        <ConnectRow
          label="Generally free"
          value={(profile.availability?.length ?? 0) > 0 ? profile.availability!.join(', ') : null}
        />
        <ConnectRow label="Opening up" value={profile.communication_style_openness} />
        <ConnectRow label="Hangout style" value={hangout || null} />
        <ConnectRow label="Bars or drinks for meetups" value={profile.bar_preference} />
        <ConnectRow label="Languages" value={languages || null} />
        <ConnectRow label="Hard nos" value={profile.dealbreakers} />
      </View>
    </View>
  );
}
