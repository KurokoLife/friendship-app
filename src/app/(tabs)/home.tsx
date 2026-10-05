import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CoachMark } from '@/components/coach-mark';
import { purchaseAiCreditPack } from '@/lib/ai-credits';
import { formatDistance } from '@/lib/distance';
import { lifeTransitionFragment } from '@/lib/life-transition';
import { expressInterest, fetchMyInterestIds, WAITING_FOR_INTEREST_COPY } from '@/lib/safety';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400

// Fix 7: shown while a first-time (or post-invalidation) generation is in
// flight, same card shape as a real suggestion so the layout doesn't jump
// once real content arrives, plain pulsing stone blocks, no text.
function SuggestionSkeletonCard() {
  return (
    <View className="gap-4 rounded-3xl border border-stone-100 bg-white p-7 dark:border-stone-700/60 dark:bg-stone-800">
      <View className="gap-2">
        <View className="h-5 w-2/3 rounded-full bg-stone-200 dark:bg-stone-700" />
        <View className="h-3 w-1/3 rounded-full bg-stone-100 dark:bg-stone-700/60" />
      </View>
      <View className="gap-2">
        <View className="h-3 w-full rounded-full bg-stone-100 dark:bg-stone-700/60" />
        <View className="h-3 w-5/6 rounded-full bg-stone-100 dark:bg-stone-700/60" />
        <View className="h-3 w-3/4 rounded-full bg-stone-100 dark:bg-stone-700/60" />
      </View>
    </View>
  );
}
const ACCENT_COLOR = '#B5643B'; // accent-500

type Suggestion = {
  userId: string;
  displayName: string | null;
  ageBand: string | null;
  lifeTransitions: string[];
  reasoning: string;
  humanDetail: string | null;
  locationCity: string | null;
  distanceMiles: number | null;
};

type ConnectionStatus = 'pending' | 'active' | 'passed';

// Saved and messaged are independent facts about a connection, a person
// can be both at once, so they're tracked separately rather than as one
// status value. status is reserved for the connection's actual lifecycle
// (pending once a message is sent, later active, etc.); passed also lives
// here since it's a real terminal state, not something that coexists with
// saved or messaged.
type ConnectionState = {
  saved: boolean;
  status: ConnectionStatus | null;
};

// __DEV__-only: shown when F1's "Skip to home" shortcut lands here with no
// signed-in session (src/app/philosophy-intro.tsx skips auth entirely, it's
// a plain navigation shortcut). Static, not fetched, so this never depends
// on Supabase, RLS, or any seed data actually being loaded. Save/Message on
// these cards can't persist (upsertConnection no-ops without a user), Pass
// just removes the card locally.
const DEV_FALLBACK_SUGGESTIONS: Suggestion[] = [
  {
    userId: 'dev-fallback-1',
    displayName: 'Aisha Bello',
    ageBand: '40s',
    lifeTransitions: ['Relocation'],
    reasoning: 'Dev fallback card, no signed-in session, not fetched from Supabase.',
    humanDetail: 'Dev fallback data, not a real profile.',
    locationCity: 'Austin, Texas',
    distanceMiles: null,
  },
  {
    userId: 'dev-fallback-2',
    displayName: 'Robert Kim',
    ageBand: '50s',
    lifeTransitions: ['Bereavement'],
    reasoning: 'Dev fallback card, no signed-in session, not fetched from Supabase.',
    humanDetail: 'Dev fallback data, not a real profile.',
    locationCity: 'Chicago, Illinois',
    distanceMiles: null,
  },
  {
    userId: 'dev-fallback-3',
    displayName: 'Priya Nair',
    ageBand: '30s',
    lifeTransitions: ['Career change'],
    reasoning: 'Dev fallback card, no signed-in session, not fetched from Supabase.',
    humanDetail: 'Dev fallback data, not a real profile.',
    locationCity: 'Portland, Oregon',
    distanceMiles: null,
  },
];

// F11: the home screen users land on after onboarding. AI matching is the
// primary discovery path (F12's filter/browse is secondary and separate).
// No swipe gesture anywhere, Save/Message/Pass are all deliberate taps.
// Photo is never part of this screen's data at all, not just hidden in the
// UI, discovery_profiles' photo_url is only fetched once someone taps a
// card and opens the full profile at /candidate/[id].
// Fix 7: match_suggestions is read directly here (a plain, instant
// query), not by calling generate-match-suggestions on every page load.
// The Edge Function is only invoked as a fallback when this comes back
// empty (a brand new user, or a cache the invalidation trigger just
// cleared), the same "generate once, cache it" path that function has
// always had, just no longer the ONLY path. Freshness is a rolling 24
// hour window (created_at), matching the Edge Function's own cache
// check, kept in sync by hand since a Deno function can't import this.
// Limen v2: suggestions are weekly (3 per rolling 7 days, same for everyone).
const CACHE_FRESHNESS_MS = 7 * 24 * 60 * 60 * 1000;

export default function HomeScreen() {
  const [loaded, setLoaded] = useState(false);
  // True only while a first-time (or post-invalidation) generation is
  // actually in flight, distinct from `loaded`, drives the skeleton below
  // rather than a blank screen or the generic full-screen spinner.
  const [generating, setGenerating] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [states, setStates] = useState<Record<string, ConnectionState>>({});
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Fix #3: kept separate from `error` above (styled for real load
  // failures), a capacity limit is calm, expected app behavior per the
  // blueprint's own "avoid shaming labels" framing, not an error.
  const [capacityNotice, setCapacityNotice] = useState<string | null>(null);
  // Mutual Interested gate (docs/DECISIONS.md section 3): the people this
  // member already said Interested to. Only their own outgoing choices,
  // nobody can see who chose them.
  const [interestedIds, setInterestedIds] = useState<Set<string>>(new Set());
  const [usingDevFallback, setUsingDevFallback] = useState(false);
  // Consumable AI credits (2026-07-29): capReached is a new signal from
  // generate-match-suggestions, confirmed absent before this (the cache-
  // first architecture previously just silently served fewer/cached
  // suggestions with nothing telling the client it happened). Only shown
  // when there's truly nothing left to show, see the render below, never
  // layered on top of real suggestions that are still available.
  const [capReached, setCapReached] = useState(false);
  const [aiCredits, setAiCredits] = useState(0);
  const [purchasing, setPurchasing] = useState(false);
  const [purchaseMessage, setPurchaseMessage] = useState<string | null>(null);

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
      if (__DEV__) {
        setSuggestions(DEV_FALLBACK_SUGGESTIONS);
        setStates({});
        setUsingDevFallback(true);
      }
      setLoaded(true);
      return;
    }
    setUsingDevFallback(false);
    fetchMyInterestIds().then(setInterestedIds);

    const freshCutoff = new Date(Date.now() - CACHE_FRESHNESS_MS).toISOString();
    const [{ data: cachedRows }, { data: connections }] = await Promise.all([
      supabase
        .from('match_suggestions')
        .select('candidate_id, reasoning, human_detail')
        .eq('user_id', user.id)
        .gte('created_at', freshCutoff),
      supabase.from('connections').select('user_b_id, status, saved').eq('user_a_id', user.id),
    ]);

    const stateMap: Record<string, ConnectionState> = {};
    for (const row of connections ?? []) {
      stateMap[row.user_b_id] = {
        saved: Boolean(row.saved),
        status: (row.status as ConnectionStatus | null) ?? null,
      };
    }

    if (cachedRows && cachedRows.length > 0) {
      const candidateIds = cachedRows.map((r) => r.candidate_id);
      const { data: candidateProfiles } = await supabase
        .from('discovery_profiles')
        .select('user_id, display_name, age_band, life_transitions, location_city, distance_miles')
        .in('user_id', candidateIds);

      const visible = cachedRows
        .map((row) => {
          const profile = candidateProfiles?.find((p) => p.user_id === row.candidate_id);
          if (!profile) return null;
          return {
            userId: row.candidate_id,
            displayName: profile.display_name,
            ageBand: profile.age_band,
            lifeTransitions: profile.life_transitions ?? [],
            reasoning: row.reasoning,
            humanDetail: row.human_detail ?? null,
            locationCity: profile.location_city,
            distanceMiles: profile.distance_miles,
          };
        })
        .filter((s): s is Suggestion => s !== null)
        .filter((s) => stateMap[s.userId]?.status !== 'passed');

      setSuggestions(visible);
      setStates(stateMap);
      setLoaded(true);
      return;
    }

    // Cache empty or fully stale: a real first-time generation, this can
    // be slightly slower, the skeleton below covers it instead of a
    // blank screen.
    setStates(stateMap);
    setLoaded(true);
    setGenerating(true);
    const { data: fnData, error: fnError } = await supabase.functions.invoke('generate-match-suggestions');
    setGenerating(false);

    if (fnError) {
      setError("We couldn't load today's suggestions. Pull to refresh in a moment.");
      return;
    }

    const visible = ((fnData?.suggestions ?? []) as Suggestion[]).filter(
      (s) => stateMap[s.userId]?.status !== 'passed'
    );
    setSuggestions(visible);
    setCapReached(Boolean(fnData?.capReached));
    setAiCredits(typeof fnData?.aiCredits === 'number' ? fnData.aiCredits : 0);
  }, []);

  const handleBuyCredits = async () => {
    setPurchasing(true);
    setPurchaseMessage(null);
    try {
      const result = await purchaseAiCreditPack();
      if (result.status === 'success') {
        setAiCredits(result.newBalance);
        setPurchaseMessage(`50 credits added. You now have ${result.newBalance}.`);
        setCapReached(false);
        await load();
      } else if (result.status === 'cancelled') {
        // No message shown, a cancelled purchase sheet isn't an error,
        // matches this app's own "no shaming labels" framing for capacity
        // limits above.
      } else {
        setPurchaseMessage(result.message);
      }
    } catch (err) {
      setPurchaseMessage(err instanceof Error ? err.message : 'Something went wrong with that purchase.');
    } finally {
      setPurchasing(false);
    }
  };

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
      setSuggestions((prev) => prev.filter((s) => s.userId !== candidateId));
    }
  };

  // Mutual Interested gate (docs/DECISIONS.md section 3) replaces "Say
  // hello". Saying Interested is private: the other person is only told if
  // they choose this member too, and then a chat opens for both. Before the
  // selfie check is approved, the tap leads to the selfie check instead.
  const handleInterested = async (candidateId: string) => {
    setPendingAction(candidateId + 'interested');
    setCapacityNotice(null);
    const result = await expressInterest(candidateId);
    setPendingAction(null);
    if (result.status === 'mutual') {
      router.push({ pathname: '/thread/[id]', params: { id: result.connectionId } });
    } else if (result.status === 'waiting') {
      setInterestedIds((prev) => new Set(prev).add(candidateId));
      setCapacityNotice(WAITING_FOR_INTEREST_COPY);
    } else if (result.status === 'not_verified') {
      router.push('/selfie-check');
    } else if (result.status === 'ended') {
      // Starting over after an honest exit needs its own confirmation,
      // which lives on the profile screen.
      router.push({ pathname: '/candidate/[id]', params: { id: candidateId } });
    } else {
      setCapacityNotice(result.message);
    }
  };

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
        <ScrollView contentContainerClassName="gap-6 px-6 pb-10 pt-10">
          <View className="gap-2">
            <Text className="text-display text-stone-900 dark:text-stone-50">
              Today&apos;s suggestions
            </Text>
            <Text className="text-body text-stone-500 dark:text-stone-400">
              A few people we think you might click with, and why.
            </Text>
          </View>

          <CoachMark markKey="tab_discover" text="Discover shows AI-suggested matches picked for you." />

          {!isSupabaseConfigured && (
            <Text className="text-caption text-amber-600 dark:text-amber-400">
              Supabase isn&apos;t configured yet. See .env.example.
            </Text>
          )}
          {usingDevFallback && (
            <Text className="text-caption text-amber-600 dark:text-amber-400">
              Dev fallback data, no signed-in session. Not from Supabase.
            </Text>
          )}
          {error && <Text className="text-caption text-red-600 dark:text-red-400">{error}</Text>}
          {capacityNotice && (
            <Text className="text-caption text-stone-500 dark:text-stone-400">{capacityNotice}</Text>
          )}

          {generating && (
            <>
              <SuggestionSkeletonCard />
              <SuggestionSkeletonCard />
            </>
          )}

          {!generating && suggestions.length === 0 && !error && capReached && (
            <View className="gap-3 rounded-3xl border border-stone-100 bg-white p-7 dark:border-stone-700/60 dark:bg-stone-800">
              {/* Limen v2: a small, curated set each week, the same for
                  everyone. No credits or Premium unlock more. */}
              <Text className="text-body text-stone-600 dark:text-stone-300">
                That&apos;s this week&apos;s suggestions. A few at a time is on purpose, it leaves room to really get
                to know someone. New ones arrive later this week.
              </Text>
            </View>
          )}

          {!generating && suggestions.length === 0 && !error && !capReached && (
            <View className="gap-2 rounded-3xl border border-stone-100 bg-white p-7 dark:border-stone-700/60 dark:bg-stone-800">
              <Text className="text-body text-stone-600 dark:text-stone-300">
                No new suggestions right now. We look for a few thoughtful matches each week.
              </Text>
            </View>
          )}

          {!generating && suggestions.map((s) => {
            const state = states[s.userId];
            const isSaved = state?.saved ?? false;
            const isInterested = interestedIds.has(s.userId);
            const fragment = lifeTransitionFragment(s.lifeTransitions);
            const distanceLabel = formatDistance(s.distanceMiles, s.locationCity);
            return (
              <View
                key={s.userId}
                className="gap-5 rounded-3xl border border-stone-100 bg-white p-7 dark:border-stone-700/60 dark:bg-stone-800">
                <Pressable
                  onPress={() =>
                    router.push({ pathname: '/candidate/[id]', params: { id: s.userId } })
                  }>
                  <View className="gap-3">
                    <View className="flex-row items-baseline gap-2">
                      <Text className="text-title text-stone-900 dark:text-stone-50">
                        {s.displayName ?? 'A member'}
                        {s.ageBand ? `, ${s.ageBand}` : ''}
                      </Text>
                    </View>
                    {fragment && (
                      <Text className="text-caption text-accent-500">{fragment}</Text>
                    )}
                    {distanceLabel && (
                      <Text className="text-caption text-stone-400 dark:text-stone-600">
                        {distanceLabel}
                      </Text>
                    )}
                    <Text className="text-body leading-relaxed text-stone-700 dark:text-stone-300">
                      {s.reasoning}
                    </Text>
                    {s.humanDetail && (
                      <Text className="text-caption leading-relaxed text-stone-500 dark:text-stone-400">
                        {s.humanDetail}
                      </Text>
                    )}
                  </View>
                </Pressable>

                <View className="flex-row gap-2">
                  <Pressable
                    onPress={() => handleStatus(s.userId, 'passed')}
                    disabled={pendingAction === s.userId + 'passed'}
                    className="flex-1 items-center rounded-full border border-stone-300 py-3 active:opacity-70 dark:border-stone-600">
                    <Text className="text-caption font-semibold text-stone-600 dark:text-stone-300">
                      Not for me
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => handleSave(s.userId)}
                    disabled={isSaved || pendingAction === s.userId + 'save'}
                    className={`flex-1 flex-row items-center justify-center gap-1 rounded-full border py-3 active:opacity-70 ${
                      isSaved ? 'border-accent-500 bg-accent-500' : 'border-stone-300 dark:border-stone-600'
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
                    onPress={() => handleInterested(s.userId)}
                    disabled={isInterested || pendingAction === s.userId + 'interested'}
                    className={`flex-1 flex-row items-center justify-center gap-1 rounded-full py-3 active:opacity-80 ${
                      isInterested ? 'border border-accent-500' : 'bg-stone-900 dark:bg-stone-50'
                    }`}>
                    {isInterested && <Ionicons name="checkmark" size={14} color={ACCENT_COLOR} />}
                    <Text
                      className={`text-caption font-semibold ${
                        isInterested ? 'text-accent-500' : 'text-stone-50 dark:text-stone-900'
                      }`}>
                      Interested
                    </Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
