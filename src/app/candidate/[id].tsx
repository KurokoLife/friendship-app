import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BlockConfirmModal } from '@/components/block-confirm-modal';
import { ReportModal } from '@/components/report-modal';
import {
  CAPACITY_ERROR_MESSAGES,
  getOrCreateConnectionId,
  reinitiateEndedConnection,
} from '@/lib/connections';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400

// Explicit column list, not select('*'): discovery_profiles also carries
// location_lat/location_lng (exact coordinates, never shown on this
// screen) and gender_identity/matching_preference, none of which this
// page should ever put on the wire to a candidate's browser. Same
// reasoning AGENTS.md already applies to age_band vs raw birthdate, just
// for location precision instead of age.
const CANDIDATE_PROFILE_COLUMNS =
  'user_id, display_name, age_band, location_city, location_state, life_transitions, life_transitions_other, values, values_other, activity_interests, hangout_people_preference, hangout_type_preference, communication_freq, meeting_freq, response_time, friendship_type, communication_style_openness, availability, communication_modes, languages, languages_other, ethnicity, ethnicity_other, personal_statement, bar_preference, dealbreakers, personality_16p, photo_url';

type ActivityInterests = {
  categories?: string[];
  details?: Record<string, Record<string, string[] | string>>;
  other?: string;
};

type FullProfile = {
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

type ConnectionStatus = 'pending' | 'active' | 'passed';

// Saved and messaged are independent, a person can be both at once, see
// the matching comment in src/app/home.tsx.
type ConnectionState = {
  saved: boolean;
  status: ConnectionStatus | null;
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

// Generic, per-category phrasing (not tied to any one person's real
// words), used only to turn each life_transitions category the person
// picked themselves into a warmer sentence. Any category not in this map
// (shouldn't happen, filter-options.ts's LIFE_TRANSITIONS is a closed set)
// falls back to the raw label. Someone can now have up to 3
// (profiles.life_transitions is an array), this screen shows all of
// them, not just the first, per explicit instruction ("show all selected
// transitions").
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

// Generic, reference descriptions of each of the 16 published type codes,
// framed for friendship rather than the usual work/romance angle, not
// tied to any one person's real data. AGENTS.md: 16 Personalities is
// optional, shown on profile, never used for matching.
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

// F11: the "photo shown last, after the full profile is read" reveal.
// This is the only screen in the discovery flow that ever fetches
// photo_url, and it now renders at the very bottom of the scroll, after
// every other section, never at the top. Seed/real profiles without a
// photo show initials instead of a fetched placeholder image, no external
// image URL is ever guessed at.
export default function CandidateProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [profile, setProfile] = useState<FullProfile | null>(null);
  const [state, setState] = useState<ConnectionState>({ saved: false, status: null });
  const [loaded, setLoaded] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reportModalVisible, setReportModalVisible] = useState(false);
  const [blockConfirmVisible, setBlockConfirmVisible] = useState(false);
  // 20260817000000: the higher-friction reopening path for a genuinely
  // 'ended' connection. handleMessage's default tap never reaches
  // reinitiateEndedConnection directly, it only shows this confirm step;
  // an explicit "Start over" tap here is what actually calls it. Unlike
  // 'inactive', which getOrCreateConnectionId reopens with zero friction.
  const [reinitiateConfirmVisible, setReinitiateConfirmVisible] = useState(false);
  const [reinitiating, setReinitiating] = useState(false);

  useEffect(() => {
    (async () => {
      if (!isSupabaseConfigured || !id) {
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

      const [{ data: profileRow }, { data: connectionRow }] = await Promise.all([
        supabase
          .from('discovery_profiles')
          .select(CANDIDATE_PROFILE_COLUMNS)
          .eq('user_id', id)
          .maybeSingle(),
        supabase
          .from('connections')
          .select('status, saved')
          .eq('user_a_id', user.id)
          .eq('user_b_id', id)
          .maybeSingle(),
      ]);

      setProfile(profileRow as FullProfile | null);
      setState({
        saved: Boolean(connectionRow?.saved),
        status: (connectionRow?.status as ConnectionStatus | null) ?? null,
      });
      setLoaded(true);
    })();
  }, [id]);

  const upsertConnection = async (fields: { saved?: boolean; status?: ConnectionStatus }) => {
    if (!id) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    await supabase
      .from('connections')
      .upsert(
        { user_a_id: user.id, user_b_id: id, ...fields },
        { onConflict: 'user_a_id,user_b_id' }
      );
  };

  const handleSave = async () => {
    setPendingAction('save');
    await upsertConnection({ saved: true });
    setPendingAction(null);
    setState((prev) => ({ ...prev, saved: true }));
  };

  const handleStatus = async (status: ConnectionStatus) => {
    setPendingAction(status);
    await upsertConnection({ status });
    setPendingAction(null);
    setState((prev) => ({ ...prev, status }));
    if (status === 'passed') {
      router.back();
    }
  };

  // F16: like home.tsx's "Say hello", this always navigates into the
  // thread rather than just recording a one-time status.
  const handleMessage = async () => {
    if (!id) return;
    setPendingAction('pending');
    setError(null);
    const result = await getOrCreateConnectionId(id);
    setPendingAction(null);
    if (result.ok) {
      router.push({ pathname: '/thread/[id]', params: { id: result.connectionId } });
    } else if (result.error === 'ended') {
      // Distinct from every other capacity error: this one isn't a plain
      // failure message, it's a real, separate confirmation step (the
      // "meaningfully higher than inactive's" reopening bar), not a
      // silent flip back to pending the way tapping this same button
      // does for an inactive connection.
      setReinitiateConfirmVisible(true);
    } else {
      setError(CAPACITY_ERROR_MESSAGES[result.error]);
    }
  };

  const handleReinitiate = async () => {
    if (!id) return;
    setReinitiating(true);
    setError(null);
    const result = await reinitiateEndedConnection(id);
    setReinitiating(false);
    setReinitiateConfirmVisible(false);
    if (result.ok) {
      router.push({ pathname: '/thread/[id]', params: { id: result.connectionId } });
    } else {
      setError(CAPACITY_ERROR_MESSAGES[result.error]);
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
          That profile isn&apos;t available anymore.
        </Text>
      </View>
    );
  }

  const activityCategories = profile.activity_interests?.categories ?? [];

  return (
    <View className="flex-1 bg-stone-50 dark:bg-stone-900">
      <SafeAreaView className="flex-1">
        <View className="flex-row items-center justify-between px-6 pt-10">
          <Pressable onPress={() => router.back()}>
            <Text className="text-caption text-stone-500 dark:text-stone-400">Back</Text>
          </Pressable>
          {/* Report & Block, reachable from the Other User Profile screen
              independent of the primary action row below. */}
          <View className="flex-row gap-4">
            <Pressable onPress={() => setReportModalVisible(true)}>
              <Text className="text-caption text-stone-500 dark:text-stone-400">Report</Text>
            </Pressable>
            <Pressable onPress={() => setBlockConfirmVisible(true)}>
              <Text className="text-caption font-semibold text-red-600 dark:text-red-400">Block</Text>
            </Pressable>
          </View>
        </View>

        <ScrollView contentContainerClassName="gap-5 px-6 pb-6 pt-5">
          {/* 1. Name/age-band header, then all selected life transitions as
              warm sentences, not chips, one per line, not just the first.
              Age band only, never exact age: discovery_profiles no longer
              exposes a raw age or birthdate column at all (Fix #1, July 19
              reconciliation session), this isn't just a display choice. */}
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

          {/* 2. Personal statement. */}
          {profile.personal_statement && (
            <View className="gap-2 rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-stone-800">
              <Text className="text-body text-stone-700 dark:text-stone-300">
                {profile.personal_statement}
              </Text>
            </View>
          )}


          {/* 3. Values, as soft chips, plus any free-text addition (display
              only, never fed into match scoring). */}
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

          {/* 4. Activity interests, full nested detail, not just category
              names, plus any free-text addition (display only, never fed
              into match scoring). */}
          {(activityCategories.length > 0 || profile.activity_interests?.other) && (
            <View className="gap-2">
              <Text className="text-caption text-stone-400 dark:text-stone-600">
                Into these lately
              </Text>
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
                          <Text
                            key={field}
                            className="text-caption text-stone-600 dark:text-stone-300">
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

          {/* Rhythm and preferences, one card: hangout style, communication
              frequency, meeting frequency, response time, friendship type,
              communication style, languages, ethnicity, personality type
              (only if provided), bar preference, in that order, matching
              the field order the Profile tab already uses for the user's
              own profile (src/app/(tabs)/profile.tsx). */}
          <View className="gap-3 rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-stone-800">
            {(profile.hangout_people_preference ||
              (profile.hangout_type_preference?.length ?? 0) > 0) && (
              <View className="gap-1">
                <Text className="text-caption text-stone-400 dark:text-stone-600">
                  Hangout style
                </Text>
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
                <Text className="text-caption text-stone-400 dark:text-stone-600">
                  Communication frequency
                </Text>
                <Text className="text-body text-stone-700 dark:text-stone-300">
                  {profile.communication_freq}
                </Text>
              </View>
            )}
            {profile.meeting_freq && (
              <View className="gap-1">
                <Text className="text-caption text-stone-400 dark:text-stone-600">
                  Meeting frequency
                </Text>
                <Text className="text-body text-stone-700 dark:text-stone-300">
                  {profile.meeting_freq}
                </Text>
              </View>
            )}
            {profile.response_time && (
              <View className="gap-1">
                <Text className="text-caption text-stone-400 dark:text-stone-600">
                  Response time
                </Text>
                <Text className="text-body text-stone-700 dark:text-stone-300">
                  {profile.response_time}
                </Text>
              </View>
            )}
            {(profile.availability?.length ?? 0) > 0 && (
              <View className="gap-1">
                <Text className="text-caption text-stone-400 dark:text-stone-600">
                  Generally free
                </Text>
                <Text className="text-body text-stone-700 dark:text-stone-300">
                  {profile.availability!.join(', ')}
                </Text>
              </View>
            )}
            {profile.friendship_type && (
              <View className="gap-1">
                <Text className="text-caption text-stone-400 dark:text-stone-600">
                  Friendship type
                </Text>
                <Text className="text-body text-stone-700 dark:text-stone-300">
                  {profile.friendship_type}
                </Text>
              </View>
            )}
            {profile.communication_style_openness && (
              <View className="gap-1">
                <Text className="text-caption text-stone-400 dark:text-stone-600">
                  Communication style
                </Text>
                <Text className="text-body text-stone-700 dark:text-stone-300">
                  {profile.communication_style_openness}
                </Text>
              </View>
            )}
            {(profile.communication_modes?.length ?? 0) > 0 && (
              <View className="gap-1">
                <Text className="text-caption text-stone-400 dark:text-stone-600">
                  How they like to communicate
                </Text>
                <Text className="text-body text-stone-700 dark:text-stone-300">
                  {profile.communication_modes!.join(', ')}
                </Text>
              </View>
            )}
            {((profile.languages?.length ?? 0) > 0 || profile.languages_other) && (
              <View className="gap-1">
                <Text className="text-caption text-stone-400 dark:text-stone-600">
                  Languages
                </Text>
                <Text className="text-body text-stone-700 dark:text-stone-300">
                  {[...(profile.languages ?? []), profile.languages_other].filter(Boolean).join(', ')}
                </Text>
              </View>
            )}
            {((profile.ethnicity?.length ?? 0) > 0 || profile.ethnicity_other) && (
              <View className="gap-1">
                <Text className="text-caption text-stone-400 dark:text-stone-600">
                  Ethnicity / race
                </Text>
                <Text className="text-body text-stone-700 dark:text-stone-300">
                  {[...(profile.ethnicity ?? []), profile.ethnicity_other].filter(Boolean).join(', ')}
                </Text>
              </View>
            )}
            {profile.personality_16p && (
              <View className="gap-1">
                <Text className="text-caption text-stone-400 dark:text-stone-600">
                  Personality type
                </Text>
                <Text className="text-body text-stone-700 dark:text-stone-300">
                  {profile.personality_16p}
                </Text>
                {PERSONALITY_TYPE_DESCRIPTIONS[profile.personality_16p] && (
                  <Text className="text-caption text-stone-500 dark:text-stone-400">
                    {PERSONALITY_TYPE_DESCRIPTIONS[profile.personality_16p]}
                  </Text>
                )}
              </View>
            )}
            {profile.bar_preference && (
              <View className="gap-1">
                <Text className="text-caption text-stone-400 dark:text-stone-600">
                  Bar preference
                </Text>
                <Text className="text-body text-stone-700 dark:text-stone-300">
                  {profile.bar_preference}
                </Text>
              </View>
            )}
          </View>

          {/* 11. Dealbreakers, only if populated. */}
          {profile.dealbreakers && (
            <View className="gap-1">
              <Text className="text-caption text-stone-400 dark:text-stone-600">Hard nos</Text>
              <Text className="text-body text-stone-700 dark:text-stone-300">
                {profile.dealbreakers}
              </Text>
            </View>
          )}

          {/* 12. Photo, last, at the very bottom, never at the top. */}
          <View className="items-center gap-2 pt-4">
            {profile.photo_url ? (
              <Image
                source={{ uri: profile.photo_url }}
                className="h-32 w-32 rounded-full bg-stone-200"
              />
            ) : (
              <View className="h-32 w-32 items-center justify-center rounded-full bg-stone-200 dark:bg-stone-700">
                <Text className="text-display text-stone-500 dark:text-stone-400">
                  {initials(profile.display_name)}
                </Text>
              </View>
            )}
          </View>
        </ScrollView>

        <View className="gap-2 border-t border-stone-200 bg-stone-50 px-6 pb-6 pt-4 dark:border-stone-800 dark:bg-stone-900">
          {error && (
            <Text className="text-caption text-stone-500 dark:text-stone-400">{error}</Text>
          )}
          <View className="flex-row gap-2">
            <Pressable
              onPress={() => handleStatus('passed')}
              disabled={pendingAction === 'passed'}
              className="flex-1 items-center rounded-full border border-stone-300 py-3 active:opacity-70 dark:border-stone-600">
              <Text className="text-caption font-semibold text-stone-600 dark:text-stone-300">
                Not for me
              </Text>
            </Pressable>
            <Pressable
              onPress={handleSave}
              disabled={state.saved || pendingAction === 'save'}
              className={`flex-1 flex-row items-center justify-center gap-1 rounded-full border py-3 active:opacity-70 ${
                state.saved ? 'border-accent-500 bg-accent-500' : 'border-stone-300 dark:border-stone-600'
              }`}>
              {state.saved && <Ionicons name="checkmark" size={14} color="#fff" />}
              <Text
                className={`text-caption font-semibold ${
                  state.saved ? 'text-white' : 'text-stone-600 dark:text-stone-300'
                }`}>
                {state.saved ? 'Saved' : 'Save'}
              </Text>
            </Pressable>
            <Pressable
              onPress={handleMessage}
              disabled={pendingAction === 'pending'}
              className="flex-1 items-center rounded-full bg-stone-900 py-3 active:opacity-80 dark:bg-stone-50">
              <Text className="text-caption font-semibold text-stone-50 dark:text-stone-900">
                Say hello
              </Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>

      {id && (
        <ReportModal
          visible={reportModalVisible}
          onClose={() => setReportModalVisible(false)}
          reportedId={id}
          connectionId={null}
          otherName={profile.display_name ?? 'this person'}
        />
      )}

      {id && (
        <BlockConfirmModal
          visible={blockConfirmVisible}
          onClose={() => setBlockConfirmVisible(false)}
          onBlocked={() => {
            setBlockConfirmVisible(false);
            // The blocker shouldn't keep seeing this profile once
            // blocked (discovery/browse already exclude it going
            // forward), same reasoning "Not for me" already uses.
            router.back();
          }}
          blockedId={id}
          otherName={profile.display_name ?? 'this person'}
        />
      )}

      <Modal
        visible={reinitiateConfirmVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setReinitiateConfirmVisible(false)}>
        <View className="flex-1 items-center justify-center bg-black/40 px-6">
          <View className="w-full max-w-sm gap-4 rounded-3xl bg-white p-6 dark:bg-stone-800">
            <Text className="text-title text-stone-900 dark:text-stone-50">Start over with this connection?</Text>
            <Text className="text-body text-stone-600 dark:text-stone-400">
              This connection was deliberately ended, not paused or auto-closed. Starting a new
              conversation is a real, separate choice, not the same as picking up where you left off.
            </Text>
            {error && <Text className="text-caption text-red-600 dark:text-red-400">{error}</Text>}
            <View className="flex-row justify-end gap-4">
              <Pressable
                onPress={() => setReinitiateConfirmVisible(false)}
                disabled={reinitiating}
                className="items-center py-2">
                <Text className="text-body font-semibold text-stone-500 dark:text-stone-400">Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleReinitiate}
                disabled={reinitiating}
                className={`rounded-full bg-stone-900 px-5 py-2 active:opacity-80 dark:bg-stone-50 ${
                  reinitiating ? 'opacity-40' : ''
                }`}>
                <Text className="text-caption font-semibold text-stone-50 dark:text-stone-900">
                  {reinitiating ? 'Starting over...' : 'Start over'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
