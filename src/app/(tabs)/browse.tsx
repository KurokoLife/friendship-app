import Slider from '@react-native-community/slider';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CoachMark } from '@/components/coach-mark';
import { ConnectionAnalysisSheet } from '@/components/connection-analysis-sheet';
import { CAPACITY_ERROR_MESSAGES, getOrCreateConnectionId } from '@/lib/connections';
import {
  ACTIVITY_CATEGORY_OPTIONS,
  AGE_BANDS,
  COMMUNICATION_FREQ,
  ETHNICITY_OPTIONS,
  HANGOUT_TYPES,
  LANGUAGE_OPTIONS,
  LIFE_TRANSITIONS,
  MAX_SEARCH_RADIUS_MILES,
  MEETING_FREQ,
  MIN_SEARCH_RADIUS_MILES,
  RESPONSE_TIME,
} from '@/lib/filter-options';
import { formatDistance } from '@/lib/distance';
import { lifeTransitionFragment } from '@/lib/life-transition';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400

// Blueprint Section 8: warn when a narrow search radius produces too few
// eligible profiles, distinct from the existing "no one matches these
// filters" empty state, this fires even when the pool isn't literally
// zero, a genuinely thin pool is still worth surfacing before someone
// concludes there's just no one out there. Not shown on home.tsx (For
// You): that screen's low counts are the daily AI-suggestion cap (2
// free / 5 premium) working as designed, not a radius signal, showing
// this same warning there would misattribute an intentional cap to a
// location problem.
const MIN_ELIGIBLE_POOL = 3;

type ActivityInterests = {
  categories?: string[];
  details?: Record<string, Record<string, string[] | string>>;
  other?: string;
};

type DiscoveryCandidate = {
  user_id: string;
  display_name: string | null;
  age_band: string | null;
  life_transitions: string[];
  activity_interests: ActivityInterests | null;
  personal_statement: string | null;
  location_city: string | null;
  distance_miles: number | null;
};

type ConnectionStatus = 'pending' | 'active' | 'passed';

// Saved and messaged are independent facts, same reasoning as home.tsx
// (F11) and candidate/[id].tsx, a person can be both at once.
type ConnectionState = {
  saved: boolean;
  status: ConnectionStatus | null;
};

type FilterKey =
  | 'life_transition'
  | 'age'
  | 'activities'
  | 'communication_freq'
  | 'meeting_freq'
  | 'hangout_style'
  | 'response_time'
  | 'ethnicity'
  | 'language'
  | 'radius';

const FILTER_ORDER: FilterKey[] = [
  'life_transition',
  'age',
  'activities',
  'communication_freq',
  'meeting_freq',
  'hangout_style',
  'response_time',
  'ethnicity',
  'language',
  'radius',
];

const FILTER_LABELS: Record<FilterKey, string> = {
  life_transition: 'Life transition',
  age: 'Age',
  activities: 'Activities',
  communication_freq: 'Communication',
  meeting_freq: 'Meeting frequency',
  hangout_style: 'Hangout style',
  response_time: 'Response time',
  ethnicity: 'Ethnicity',
  language: 'Language',
  radius: 'Distance',
};

// Given only a personal statement's first sentence, per the explicit
// spec ("one human detail line from their personal statement"), not the
// broader activity-interests fallback F11's server-side reasoning uses,
// this card has no AI generation at all, so there's nothing to fall back
// from. If there's no personal statement, the line is simply omitted, the
// same "only show if populated" pattern used throughout this app.
function humanDetailLine(candidate: DiscoveryCandidate): string | null {
  if (!candidate.personal_statement) return null;
  const firstSentence = candidate.personal_statement.split(/(?<=[.!?])\s+/)[0];
  return firstSentence || null;
}

function toggleInList(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function ToggleChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className={`rounded-xl border px-4 py-3 ${
        selected
          ? 'border-stone-900 bg-stone-900 dark:border-stone-50 dark:bg-stone-50'
          : 'border-stone-300 dark:border-stone-700'
      }`}>
      <Text
        className={`text-body ${
          selected ? 'text-stone-50 dark:text-stone-900' : 'text-stone-900 dark:text-stone-50'
        }`}>
        {label}
      </Text>
    </Pressable>
  );
}

// Small rounded pill, used only for Activities, which has enough options
// (18) that a full-width vertical list would take far more scrolling than
// a wrapping grid. Selected uses accent color specifically, per explicit
// instruction for this filter, most other selected states in this app use
// a monochrome fill, this one is a deliberate exception.
function GridChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className={`rounded-full border px-3 py-2 ${
        selected ? 'border-accent-500 bg-accent-500' : 'border-stone-300 dark:border-stone-600'
      }`}>
      <Text
        className={`text-caption font-semibold ${
          selected ? 'text-white' : 'text-stone-700 dark:text-stone-300'
        }`}>
        {label}
      </Text>
    </Pressable>
  );
}

// F12: filter/browse, the secondary discovery path alongside F11's AI
// matching. Gender compatibility is never a filter option here, it's the
// same permanent, free onboarding default F11 already relies on, baked
// into browse_profiles itself (auth.uid()-scoped mutual compatibility,
// and, as of the F9 pause enforcement work, excluding anyone currently
// paused too), so simply querying that view is enough to guarantee both
// rules hold here without repeating any of that logic client-side.
//
// Reads browse_profiles, not discovery_profiles (2026-07-16): the two
// views apply the identical two filters (gender/pause), but are kept
// separate on purpose so Browse stays a plain directory of every
// compatible, non-paused user, filtered only by what the user picks here
// themselves, and never picks up columns or behavior added to
// discovery_profiles for Discovery's own AI-scoring needs (Big Five
// proximity, dealbreaker checks, and so on all live in
// generate-match-suggestions, not in either view, but keeping the two
// views independent means that stays true even as each one evolves).
export default function BrowseScreen() {
  const [loaded, setLoaded] = useState(false);
  const [candidates, setCandidates] = useState<DiscoveryCandidate[]>([]);
  const [states, setStates] = useState<Record<string, ConnectionState>>({});
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [whyOpenFor, setWhyOpenFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Fix #3: kept separate from `error` above (which is styled for real
  // load failures), a capacity limit is calm, expected app behavior per
  // the blueprint's own "avoid shaming labels" framing, not an error.
  const [capacityNotice, setCapacityNotice] = useState<string | null>(null);

  const [openFilter, setOpenFilter] = useState<FilterKey | null>(null);
  const [lifeTransitions, setLifeTransitions] = useState<string[]>([]);
  // Fix #1 (July 19 reconciliation session): age filtering moved from two
  // number inputs querying a raw `age` column to a band multi-select,
  // discovery_profiles/browse_profiles no longer expose exact age at all.
  const [ageBandFilter, setAgeBandFilter] = useState<string[]>([]);
  const [activities, setActivities] = useState<string[]>([]);
  const [communicationFreqs, setCommunicationFreqs] = useState<string[]>([]);
  const [meetingFreqs, setMeetingFreqs] = useState<string[]>([]);
  const [hangoutPeople, setHangoutPeople] = useState<string[]>([]);
  const [hangoutTypes, setHangoutTypes] = useState<string[]>([]);
  const [responseTimes, setResponseTimes] = useState<string[]>([]);
  const [ethnicityFilter, setEthnicityFilter] = useState<string[]>([]);
  const [languageFilter, setLanguageFilter] = useState<string[]>([]);
  // Fix 6: session-only, defaults to the account's own saved
  // search_radius_miles once loaded (see load() below), never written
  // back to the profile itself. browse_profiles already hard-caps at that
  // same saved value server-side, so this can only narrow further within
  // a session, never widen past it.
  const [profileDefaultRadius, setProfileDefaultRadius] = useState(MAX_SEARCH_RADIUS_MILES);
  const [radiusMiles, setRadiusMiles] = useState(MAX_SEARCH_RADIUS_MILES);
  // Only fetched once per screen lifetime, not on every load() (a
  // useFocusEffect re-run every time the tab regains focus), so a
  // mid-session radius adjustment doesn't get silently reset back to the
  // profile default the next time the user tabs away and back.
  const radiusInitialized = useRef(false);

  const isFilterActive = (key: FilterKey): boolean => {
    switch (key) {
      case 'life_transition':
        return lifeTransitions.length > 0;
      case 'age':
        return ageBandFilter.length > 0;
      case 'activities':
        return activities.length > 0;
      case 'communication_freq':
        return communicationFreqs.length > 0;
      case 'meeting_freq':
        return meetingFreqs.length > 0;
      case 'hangout_style':
        return hangoutPeople.length > 0 || hangoutTypes.length > 0;
      case 'response_time':
        return responseTimes.length > 0;
      case 'ethnicity':
        return ethnicityFilter.length > 0;
      case 'language':
        return languageFilter.length > 0;
      case 'radius':
        return radiusMiles !== profileDefaultRadius;
    }
  };

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setLoaded(true);
      return;
    }
    setError(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoaded(true);
      return;
    }

    let query = supabase
      .from('browse_profiles')
      .select(
        'user_id, display_name, age_band, life_transitions, activity_interests, personal_statement, location_city, distance_miles, ethnicity, languages'
      );

    // life_transitions is now an array column (up to 3 per person), an
    // exact-list .in() no longer applies, overlaps matches anyone who has
    // at least one of the selected transitions, same OR-within-a-facet
    // semantics every other multi-select filter on this screen already
    // uses.
    if (lifeTransitions.length) query = query.overlaps('life_transitions', lifeTransitions);
    // Fix #1: age filtering is now a plain multi-select on the public
    // age_band column, same shape as ethnicity/language below, since
    // exact age is no longer a queryable column on this view at all.
    if (ageBandFilter.length) query = query.in('age_band', ageBandFilter);
    if (communicationFreqs.length) query = query.in('communication_freq', communicationFreqs);
    if (meetingFreqs.length) query = query.in('meeting_freq', meetingFreqs);
    if (hangoutPeople.length) query = query.in('hangout_people_preference', hangoutPeople);
    if (hangoutTypes.length) query = query.overlaps('hangout_type_preference', hangoutTypes);
    if (responseTimes.length) query = query.in('response_time', responseTimes);
    if (ethnicityFilter.length) query = query.overlaps('ethnicity', ethnicityFilter);
    if (languageFilter.length) query = query.overlaps('languages', languageFilter);

    const [{ data, error: queryError }, { data: connections }, { data: ownProfile }] = await Promise.all([
      query,
      supabase.from('connections').select('user_b_id, status, saved').eq('user_a_id', user.id),
      radiusInitialized.current
        ? Promise.resolve({ data: null })
        : supabase.from('profiles').select('search_radius_miles').eq('user_id', user.id).maybeSingle(),
    ]);

    if (queryError) {
      setError("We couldn't load results. Pull to refresh in a moment.");
      setLoaded(true);
      return;
    }

    // Fix 6: only set once (radiusInitialized guards the fetch above too,
    // so ownProfile is only ever non-null the first time this runs), a
    // session-adjusted radiusMiles should survive later refocuses.
    let effectiveRadius = radiusMiles;
    if (!radiusInitialized.current) {
      radiusInitialized.current = true;
      const savedRadius = ownProfile?.search_radius_miles ?? MAX_SEARCH_RADIUS_MILES;
      setProfileDefaultRadius(savedRadius);
      setRadiusMiles(savedRadius);
      effectiveRadius = savedRadius;
    }

    const stateMap: Record<string, ConnectionState> = {};
    for (const row of connections ?? []) {
      stateMap[row.user_b_id] = {
        saved: Boolean(row.saved),
        status: (row.status as ConnectionStatus | null) ?? null,
      };
    }

    // activity_interests lives inside a jsonb column, filtering on its
    // nested categories array is done here rather than fighting PostgREST's
    // JSON operators through the query builder, the same pragmatic,
    // plain-JS-over-a-fetched-pool approach generate-match-suggestions
    // already uses for its own overlap scoring.
    let results = (data ?? []) as DiscoveryCandidate[];
    if (activities.length) {
      results = results.filter((c) =>
        (c.activity_interests?.categories ?? []).some((cat) => activities.includes(cat))
      );
    }
    // Radius is a client-side narrowing filter on top of browse_profiles'
    // own server-side hard cap (the account's saved search_radius_miles),
    // a candidate with no computed distance (missing location on either
    // side) is not excluded by a session radius adjustment, same
    // "don't hide on missing data" rule the view itself already applies.
    results = results.filter((c) => c.distance_miles === null || c.distance_miles <= effectiveRadius);
    results = results.filter((c) => stateMap[c.user_id]?.status !== 'passed');

    setCandidates(results);
    setStates(stateMap);
    setLoaded(true);
  }, [
    lifeTransitions,
    ageBandFilter,
    activities,
    communicationFreqs,
    meetingFreqs,
    hangoutPeople,
    hangoutTypes,
    responseTimes,
    ethnicityFilter,
    languageFilter,
    radiusMiles,
  ]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const upsertConnection = async (
    candidateId: string,
    fields: { saved?: boolean; status?: ConnectionStatus }
  ) => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    await supabase
      .from('connections')
      .upsert(
        { user_a_id: user.id, user_b_id: candidateId, ...fields },
        { onConflict: 'user_a_id,user_b_id' }
      );
  };

  const handleSave = async (candidateId: string) => {
    setPendingAction(candidateId + 'save');
    await upsertConnection(candidateId, { saved: true });
    setPendingAction(null);
    setStates((prev) => ({
      ...prev,
      [candidateId]: { ...(prev[candidateId] ?? { status: null }), saved: true },
    }));
  };

  const handleStatus = async (candidateId: string, status: ConnectionStatus) => {
    setPendingAction(candidateId + status);
    await upsertConnection(candidateId, { status });
    setPendingAction(null);
    setStates((prev) => ({
      ...prev,
      [candidateId]: { ...(prev[candidateId] ?? { saved: false }), status },
    }));
    if (status === 'passed') {
      setCandidates((prev) => prev.filter((c) => c.user_id !== candidateId));
    }
  };

  const handleSayHello = async (candidateId: string) => {
    setPendingAction(candidateId + 'pending');
    setCapacityNotice(null);
    const result = await getOrCreateConnectionId(candidateId);
    setPendingAction(null);
    if (result.ok) {
      router.push({ pathname: '/thread/[id]', params: { id: result.connectionId } });
    } else {
      setCapacityNotice(CAPACITY_ERROR_MESSAGES[result.error]);
    }
  };

  const renderFilterOptions = () => {
    if (!openFilter) return null;
    switch (openFilter) {
      case 'life_transition':
        return LIFE_TRANSITIONS.map((option) => (
          <ToggleChip
            key={option}
            label={option}
            selected={lifeTransitions.includes(option)}
            onPress={() => setLifeTransitions((prev) => toggleInList(prev, option))}
          />
        ));
      case 'age':
        return AGE_BANDS.map((option) => (
          <ToggleChip
            key={option}
            label={option}
            selected={ageBandFilter.includes(option)}
            onPress={() => setAgeBandFilter((prev) => toggleInList(prev, option))}
          />
        ));
      case 'activities':
        return (
          <View className="flex-row flex-wrap gap-2">
            {ACTIVITY_CATEGORY_OPTIONS.map((option) => (
              <GridChip
                key={option.key}
                label={option.label}
                selected={activities.includes(option.key)}
                onPress={() => setActivities((prev) => toggleInList(prev, option.key))}
              />
            ))}
          </View>
        );
      case 'communication_freq':
        return COMMUNICATION_FREQ.map((option) => (
          <ToggleChip
            key={option}
            label={option}
            selected={communicationFreqs.includes(option)}
            onPress={() => setCommunicationFreqs((prev) => toggleInList(prev, option))}
          />
        ));
      case 'meeting_freq':
        return MEETING_FREQ.map((option) => (
          <ToggleChip
            key={option}
            label={option}
            selected={meetingFreqs.includes(option)}
            onPress={() => setMeetingFreqs((prev) => toggleInList(prev, option))}
          />
        ));
      case 'hangout_style':
        return (
          <>
            {HANGOUT_TYPES.map((option) => (
              <ToggleChip
                key={option}
                label={option}
                selected={hangoutTypes.includes(option)}
                onPress={() => setHangoutTypes((prev) => toggleInList(prev, option))}
              />
            ))}
          </>
        );
      case 'response_time':
        return RESPONSE_TIME.map((option) => (
          <ToggleChip
            key={option}
            label={option}
            selected={responseTimes.includes(option)}
            onPress={() => setResponseTimes((prev) => toggleInList(prev, option))}
          />
        ));
      case 'ethnicity':
        return ETHNICITY_OPTIONS.map((option) => (
          <ToggleChip
            key={option}
            label={option}
            selected={ethnicityFilter.includes(option)}
            onPress={() => setEthnicityFilter((prev) => toggleInList(prev, option))}
          />
        ));
      case 'language':
        return LANGUAGE_OPTIONS.map((option) => (
          <ToggleChip
            key={option}
            label={option}
            selected={languageFilter.includes(option)}
            onPress={() => setLanguageFilter((prev) => toggleInList(prev, option))}
          />
        ));
      case 'radius':
        return (
          <View className="gap-2 py-2">
            <Text className="text-caption text-stone-400 dark:text-stone-600">
              Within {radiusMiles} miles (your profile default is {profileDefaultRadius})
            </Text>
            <Slider
              minimumValue={MIN_SEARCH_RADIUS_MILES}
              maximumValue={profileDefaultRadius}
              step={1}
              value={radiusMiles}
              onSlidingComplete={(value) => setRadiusMiles(Math.round(value))}
              minimumTrackTintColor="#B5643B"
            />
          </View>
        );
    }
  };

  // Age is a range slider, not a multi-select list, "Select all"/"Clear
  // all" only make sense for the six list-based filters, the sheet simply
  // doesn't render this row for 'age' (see the modal below).
  const handleSelectAll = () => {
    switch (openFilter) {
      case 'life_transition':
        setLifeTransitions([...LIFE_TRANSITIONS]);
        break;
      case 'activities':
        setActivities(ACTIVITY_CATEGORY_OPTIONS.map((o) => o.key));
        break;
      case 'communication_freq':
        setCommunicationFreqs([...COMMUNICATION_FREQ]);
        break;
      case 'meeting_freq':
        setMeetingFreqs([...MEETING_FREQ]);
        break;
      case 'hangout_style':
        setHangoutTypes([...HANGOUT_TYPES]);
        break;
      case 'response_time':
        setResponseTimes([...RESPONSE_TIME]);
        break;
      case 'ethnicity':
        setEthnicityFilter([...ETHNICITY_OPTIONS]);
        break;
      case 'language':
        setLanguageFilter([...LANGUAGE_OPTIONS]);
        break;
      case 'age':
        setAgeBandFilter([...AGE_BANDS]);
        break;
      case 'radius':
      case null:
        break;
    }
  };

  const handleClearAll = () => {
    switch (openFilter) {
      case 'life_transition':
        setLifeTransitions([]);
        break;
      case 'activities':
        setActivities([]);
        break;
      case 'communication_freq':
        setCommunicationFreqs([]);
        break;
      case 'meeting_freq':
        setMeetingFreqs([]);
        break;
      case 'hangout_style':
        setHangoutPeople([]);
        setHangoutTypes([]);
        break;
      case 'response_time':
        setResponseTimes([]);
        break;
      case 'ethnicity':
        setEthnicityFilter([]);
        break;
      case 'language':
        setLanguageFilter([]);
        break;
      case 'age':
        setAgeBandFilter([]);
        break;
      case 'radius':
      case null:
        break;
    }
  };

  const handleResetRadius = () => setRadiusMiles(profileDefaultRadius);

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
        <View className="gap-2 px-6 pt-10">
          <Text className="text-display text-stone-900 dark:text-stone-50">Browse</Text>
          <Text className="text-body text-stone-500 dark:text-stone-400">
            Filter by what matters to you, and see everyone who fits.
          </Text>
          <CoachMark
            markKey="tab_browse"
            text="Browse lets you search and filter for people yourself."
          />
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="gap-2 px-6 py-4">
          {FILTER_ORDER.map((key) => {
            const active = isFilterActive(key);
            return (
              <Pressable
                key={key}
                onPress={() => setOpenFilter(key)}
                // Explicit fixed height, not just padding, so this chip
                // structurally cannot grow no matter what else is on
                // screen, tapping it only ever calls setOpenFilter, which
                // renders the completely separate Modal below, nothing
                // about the tap or the filter's content ever touches this
                // element's own layout.
                style={{ height: 36 }}
                className={`items-center justify-center rounded-full border px-4 ${
                  active
                    ? 'border-accent-500 bg-accent-500'
                    : 'border-stone-300 dark:border-stone-600'
                }`}>
                <Text
                  numberOfLines={1}
                  className={`text-caption font-semibold ${
                    active ? 'text-white' : 'text-stone-700 dark:text-stone-300'
                  }`}>
                  {FILTER_LABELS[key]}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {!isSupabaseConfigured && (
          <Text className="px-6 text-caption text-amber-600 dark:text-amber-400">
            Supabase isn&apos;t configured yet. See .env.example.
          </Text>
        )}
        {error && (
          <Text className="px-6 text-caption text-red-600 dark:text-red-400">{error}</Text>
        )}
        {capacityNotice && (
          <Text className="px-6 text-caption text-stone-500 dark:text-stone-400">{capacityNotice}</Text>
        )}

        {/* pt-4 restores the same breathing room every other tab screen
            gives its content (home/saved/inbox/remember/profile all wrap
            header+content in one ScrollView with pt-10); Browse's filter
            chip row already carries its own py-4, so this results
            ScrollView only needed the missing top half of that gap, not
            a full second pt-10. */}
        <ScrollView contentContainerClassName="gap-6 px-6 pb-10 pt-4">
          {candidates.length > 0 && candidates.length < MIN_ELIGIBLE_POOL && (
            <View className="gap-1 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
              <Text className="text-body text-stone-600 dark:text-stone-300">
                Only {candidates.length} {candidates.length === 1 ? 'person' : 'people'} within this
                distance right now.
              </Text>
              {radiusMiles < profileDefaultRadius ? (
                <Pressable onPress={() => setOpenFilter('radius')}>
                  <Text className="text-caption font-semibold text-accent-500">
                    Try widening your radius
                  </Text>
                </Pressable>
              ) : (
                <Text className="text-caption text-stone-400 dark:text-stone-600">
                  You can increase your search radius in your profile to see more people.
                </Text>
              )}
            </View>
          )}

          {candidates.length === 0 && !error && (
            <View className="gap-2 rounded-3xl border border-stone-100 bg-white p-7 dark:border-stone-700/60 dark:bg-stone-800">
              <Text className="text-body text-stone-600 dark:text-stone-300">
                No one matches these filters right now. Try adjusting them or check back later.
              </Text>
            </View>
          )}

          {candidates.map((c) => {
            const state = states[c.user_id];
            const isSaved = state?.saved ?? false;
            const fragment = lifeTransitionFragment(c.life_transitions);
            const detail = humanDetailLine(c);
            const distanceLabel = formatDistance(c.distance_miles, c.location_city);
            return (
              <View
                key={c.user_id}
                className="gap-5 rounded-3xl border border-stone-100 bg-white p-7 dark:border-stone-700/60 dark:bg-stone-800">
                <Pressable
                  onPress={() =>
                    router.push({ pathname: '/candidate/[id]', params: { id: c.user_id } })
                  }>
                  <View className="gap-3">
                    <Text className="text-title text-stone-900 dark:text-stone-50">
                      {c.display_name ?? 'A member'}
                      {c.age_band ? `, ${c.age_band}` : ''}
                    </Text>
                    {fragment && <Text className="text-caption text-accent-500">{fragment}</Text>}
                    {distanceLabel && (
                      <Text className="text-caption text-stone-400 dark:text-stone-600">
                        {distanceLabel}
                      </Text>
                    )}
                    {detail && (
                      <Text className="text-body leading-relaxed text-stone-600 dark:text-stone-300">
                        {detail}
                      </Text>
                    )}
                  </View>
                </Pressable>

                <Pressable onPress={() => setWhyOpenFor(c.user_id)}>
                  <Text className="text-caption font-semibold text-accent-500">
                    Why might we connect?
                  </Text>
                </Pressable>

                <View className="flex-row gap-2">
                  <Pressable
                    onPress={() => handleStatus(c.user_id, 'passed')}
                    disabled={pendingAction === c.user_id + 'passed'}
                    className="flex-1 items-center rounded-full border border-stone-300 py-3 active:opacity-70 dark:border-stone-600">
                    <Text className="text-caption font-semibold text-stone-600 dark:text-stone-300">
                      Not for me
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => handleSave(c.user_id)}
                    disabled={isSaved || pendingAction === c.user_id + 'save'}
                    className={`flex-1 flex-row items-center justify-center gap-1 rounded-full border py-3 active:opacity-70 ${
                      isSaved
                        ? 'border-accent-500 bg-accent-500'
                        : 'border-stone-300 dark:border-stone-600'
                    }`}>
                    {isSaved && <Ionicons name="checkmark" size={14} color="#fff" />}
                    <Text
                      className={`text-caption font-semibold ${
                        isSaved ? 'text-white' : 'text-stone-600 dark:text-stone-300'
                      }`}>
                      {isSaved ? 'Saved' : 'Save'}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => handleSayHello(c.user_id)}
                    disabled={pendingAction === c.user_id + 'pending'}
                    className="flex-1 items-center rounded-full bg-stone-900 py-3 active:opacity-80 dark:bg-stone-50">
                    <Text className="text-caption font-semibold text-stone-50 dark:text-stone-900">
                      Say hello
                    </Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
        </ScrollView>
      </SafeAreaView>

      <Modal
        visible={openFilter !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setOpenFilter(null)}>
        <View className="flex-1 justify-end bg-black/30">
          <Pressable className="flex-1" onPress={() => setOpenFilter(null)} />
          {/* Hardcoded 500px, not a percentage and not computed from
              Dimensions, per explicit instruction, so the sheet is exactly
              the same fixed size no matter which filter is open or how
              much content it has. The ScrollView below is flex-1, filling
              whatever space is left after the handle/header and the Done
              button, so it, not the sheet, is what scrolls. */}
          <View
            style={{ height: 500 }}
            className="gap-4 rounded-t-3xl border-t border-stone-200 bg-stone-50 px-6 pb-8 pt-5 dark:border-stone-800 dark:bg-stone-900">
            <View className="h-1 w-10 self-center rounded-full bg-stone-300 dark:bg-stone-700" />
            <View className="flex-row items-center justify-between">
              {openFilter && (
                <Text className="text-title text-stone-900 dark:text-stone-50">
                  {FILTER_LABELS[openFilter]}
                </Text>
              )}
              {openFilter && openFilter !== 'radius' && (
                <View className="flex-row gap-4">
                  <Pressable onPress={handleSelectAll}>
                    <Text className="text-caption font-semibold text-accent-500">Select all</Text>
                  </Pressable>
                  <Pressable onPress={handleClearAll}>
                    <Text className="text-caption font-semibold text-accent-500">Clear all</Text>
                  </Pressable>
                </View>
              )}
              {openFilter === 'radius' && (
                <Pressable onPress={handleResetRadius}>
                  <Text className="text-caption font-semibold text-accent-500">Reset</Text>
                </Pressable>
              )}
            </View>
            <ScrollView className="flex-1" contentContainerClassName="gap-3">
              {renderFilterOptions()}
            </ScrollView>
            <Pressable
              onPress={() => setOpenFilter(null)}
              className="items-center rounded-full bg-stone-900 py-4 active:opacity-80 dark:bg-stone-50">
              <Text className="text-body font-semibold text-stone-50 dark:text-stone-900">
                Done
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <ConnectionAnalysisSheet
        visible={whyOpenFor !== null}
        candidateId={whyOpenFor}
        candidateName={candidates.find((c) => c.user_id === whyOpenFor)?.display_name ?? 'this person'}
        isSaved={Boolean(whyOpenFor && states[whyOpenFor]?.saved)}
        onClose={() => setWhyOpenFor(null)}
        onSave={async () => {
          if (whyOpenFor) await handleSave(whyOpenFor);
        }}
        onStartConversation={async () => {
          if (whyOpenFor) await handleSayHello(whyOpenFor);
        }}
      />
    </View>
  );
}
