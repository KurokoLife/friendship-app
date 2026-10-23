import { Ionicons } from '@expo/vector-icons';
import { useState, type ReactNode } from 'react';
import { Image, Modal, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';

import { ProfileStories } from '@/components/profile-stories';
import { activityCategoryLabel, activityDetailLines } from '@/lib/activity-categories';
import { formatDistance } from '@/lib/distance';
import { lifeTransitionSentences } from '@/lib/life-transition';

const ACCENT_COLOR = '#B5643B'; // accent-500
const MUTED_COLOR = '#a8a29e'; // stone-400

// What other people see (docs/DECISIONS.md section 2). One shared view so
// Other User Profile (candidate/[id].tsx) and your own Public Profile
// Review (profile-review.tsx) can never drift apart.
//
// 1. Curiosity first: a small photo (tap for larger), first name, age range, distance, "Right
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

// Stored values stay the same; the words people see were reworded (2026-10-18).
function barLabel(value: string | null): string | null {
  if (!value) return null;
  if (value === 'No preference') return 'Fine with me';
  if (value === 'Rather not') return "I'd rather not";
  if (value === 'I drink') return 'Fine with me';
  return value;
}

function ConnectRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <View className="gap-0.5">
      <Text className="text-caption text-stone-400 dark:text-stone-400">{label}</Text>
      <Text className="text-body text-stone-700 dark:text-stone-300">{value}</Text>
    </View>
  );
}

// Only for your own Profile tab: things you chose to hide, shown in place
// but dimmed and labelled, so you can see what others can't.
export type OwnerHiddenItems = {
  lifeTransitions: string[];
  lifeTransitionsOther: string | null;
};

function OnlyYouLabel() {
  return (
    <View className="flex-row items-center gap-1">
      <Ionicons name="lock-closed" size={12} color={MUTED_COLOR} />
      <Text className="text-caption text-stone-500 dark:text-stone-400">Only you can see this. Change in Edit.</Text>
    </View>
  );
}

export function PublicProfileView({
  profile,
  readOnly = false,
  ownerHidden,
  afterHeader,
}: {
  profile: PublicProfile;
  readOnly?: boolean;
  ownerHidden?: OwnerHiddenItems;
  // 2026-10-23: shown right after the name and photo (for people you have a
  // chat with: how they like care, how they approach new friendships).
  afterHeader?: ReactNode;
}) {
  const hiddenTransitions = ownerHidden ? lifeTransitionSentences(ownerHidden.lifeTransitions) : [];
  const showHiddenTransitions =
    Boolean(ownerHidden) && (hiddenTransitions.length > 0 || Boolean(ownerHidden?.lifeTransitionsOther));
  const photos = [profile.photo_url, ...(profile.extra_photo_urls ?? [])].filter(Boolean) as string[];
  const [viewerAt, setViewerAt] = useState<number | null>(null);
  const { width } = useWindowDimensions();
  const photoSize = Math.min(width - 32, 520);
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
      {/* Photo small, next to the name (2026-10-14): the profile leads with
          the person's words, not their face. Tap the photo to see it, and
          any others, larger. */}
      <View className="flex-row items-center gap-4">
        <Pressable
          onPress={() => photos.length > 0 && setViewerAt(0)}
          disabled={photos.length === 0}
          accessibilityRole={photos.length > 0 ? 'button' : undefined}
          accessibilityLabel={photos.length > 0 ? 'See photos larger' : undefined}>
          {profile.photo_url ? (
            <Image source={{ uri: profile.photo_url }} className="h-20 w-20 rounded-2xl bg-stone-200" />
          ) : (
            <View className="h-20 w-20 items-center justify-center rounded-2xl bg-stone-200 dark:bg-stone-700">
              <Text className="text-title text-stone-500 dark:text-stone-400">{initials(profile.display_name)}</Text>
            </View>
          )}
        </Pressable>
        <View className="flex-1 gap-1">
          <Text className="text-title text-stone-900 dark:text-stone-50">
            {profile.display_name ?? 'A member'}
            {profile.age_band ? `, ${profile.age_band}` : ''}
          </Text>
          {profile.selfie_verified && (
            <View className="flex-row items-center gap-1 self-start rounded-full border border-accent-500 px-2 py-0.5">
              <Ionicons name="checkmark-circle" size={12} color={ACCENT_COLOR} />
              <Text className="text-caption text-accent-500">Photo verified</Text>
            </View>
          )}
          {distance && <Text className="text-caption text-stone-500 dark:text-stone-400">{distance}</Text>}
          {photos.length > 0 && (
            <Pressable onPress={() => setViewerAt(0)} className="self-start">
              <Text className="text-caption font-semibold text-accent-500">
                {photos.length === 1 ? 'See photo' : `See ${photos.length} photos`}
              </Text>
            </Pressable>
          )}
        </View>
      </View>

      <Modal visible={viewerAt !== null} transparent animationType="fade" onRequestClose={() => setViewerAt(null)}>
        <View className="flex-1 justify-center bg-black/90">
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            style={{ flexGrow: 0, height: photoSize }}
            contentOffset={{ x: (viewerAt ?? 0) * width, y: 0 }}>
            {photos.map((uri, i) => (
              <View key={`${uri}-${i}`} style={{ width, height: photoSize }} className="items-center justify-center">
                <Image
                  source={{ uri }}
                  style={{ width: photoSize, height: photoSize }}
                  className="rounded-2xl bg-stone-800"
                  resizeMode="cover"
                  accessibilityLabel={`Photo ${i + 1} of ${photos.length}`}
                />
              </View>
            ))}
          </ScrollView>
          {photos.length > 1 && (
            <Text className="mt-3 text-center text-caption text-stone-300">Swipe to see more ({photos.length} photos)</Text>
          )}
          <Pressable onPress={() => setViewerAt(null)} className="mt-4 self-center rounded-full border border-stone-500 px-5 py-2">
            <Text className="text-caption font-semibold text-stone-100">Close</Text>
          </Pressable>
        </View>
      </Modal>

      {afterHeader}

      {/* What brings them here, in their own words (2026-10-18). */}
      {profile.life_transitions_other?.trim() && (
        <View className="gap-1 rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-stone-800">
          <Text className="text-caption text-stone-400 dark:text-stone-400">What brings them here</Text>
          <Text className="text-body text-stone-700 dark:text-stone-300">{profile.life_transitions_other}</Text>
        </View>
      )}

      {/* Stories */}
      <ProfileStories subjectUserId={profile.user_id} subjectName={profile.display_name} readOnly={readOnly} />

      {/* What they enjoy: their own line first, then any details */}
      {(activityCategories.length > 0 || profile.activity_interests?.other) && (
        <View className="gap-2">
          <Text className="text-caption text-stone-400 dark:text-stone-400">What they enjoy</Text>
          {activityCategories.map((key) => {
            const detail = profile.activity_interests?.details?.[key];
            const note = typeof detail?.note === 'string' ? detail.note.trim() : '';
            const lines = activityDetailLines(key, detail);
            return (
              <View
                key={key}
                className="gap-1 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
                <Text className="text-body font-semibold text-stone-900 dark:text-stone-50">
                  {activityCategoryLabel(key)}
                </Text>
                {note ? <Text className="text-body text-stone-700 dark:text-stone-300">{note}</Text> : null}
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
          <Text className="text-caption text-stone-400 dark:text-stone-400">Looking for</Text>
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
        <ConnectRow label="Bars or drinks" value={barLabel(profile.bar_preference)} />
        <ConnectRow label="Languages" value={languages || null} />
        <ConnectRow label="Good to know" value={profile.dealbreakers} />
      </View>
    </View>
  );
}
