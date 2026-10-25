import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CoachMark } from '@/components/coach-mark';
import { formatDistance } from '@/lib/distance';
import { lifeTransitionFragment } from '@/lib/life-transition';
import { useTestTools } from '@/lib/test-mode';
import { fetchProfileStories } from '@/lib/stories';
import { expressInterest, lastActionErrorDetail, interestSavedCopy, SAVED_FULL_COPY, saveForLater } from '@/lib/safety';
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
  // 2026-10-18: the card shows only the person's own words.
  whatBrings?: string | null;
  storyOpening?: string | null;
  locationCity: string | null;
  distanceMiles: number | null;
  selfieVerified?: boolean;
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
    ageBand: '45-49',
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
    ageBand: '35-39',
    lifeTransitions: ['Career change'],
    reasoning: 'Dev fallback card, no signed-in session, not fetched from Supabase.',
    humanDetail: 'Dev fallback data, not a real profile.',
    locationCity: 'Portland, Oregon',
    distanceMiles: null,
  },
];

// Discover (rebuilt 2026-10-10, docs/DECISIONS.md section 4). One new
// person a day, at most 3 waiting, nobody while you have 3 active chats
// (paused ones count). Never anyone you've had a chat with. Saving moves
// the person to Saved, Interested to Your people. The database decides all
// of this (get_discover); generate-match-suggestions only adds today's
// person when get_discover says there's room for one. Saved people are
// listed below today's person (2026-10-25, the Saved tab is gone).
// Saved (2026-10-10, inside Discover since 2026-10-25): up to 5, each for
// 30 days. Anyone you start a chat with leaves Saved.
type SavedProfile = {
  connection_id: string;
  user_id: string;
  saved_at: string;
  display_name: string | null;
  age_band: string | null;
  personal_statement: string | null;
};
const SAVE_DAYS = 30;
const SAVE_MAX = 5;

function shortDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

type DiscoverState = {
  full: boolean;
  can_add: boolean;
  next_at?: string;
  on_break_until?: string | null;
  items: { candidate_id: string; reasoning: string; human_detail: string | null; created_at: string }[];
};

// The opening of a story for the card: about two lines, cut at a word.
function openingLines(text: string, max = 180): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 20)).trim()}...`;
}

function deviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}

export default function HomeScreen() {
  const [loaded, setLoaded] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [full, setFull] = useState(false);
  // Taking a break (2026-10-14, set in Settings).
  const [breakUntil, setBreakUntil] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const { allowed: testTools } = useTestTools();
  // A calm note after Save, Interested or a limit. Not an error.
  const [capacityNotice, setCapacityNotice] = useState<string | null>(null);
  const [usingDevFallback, setUsingDevFallback] = useState(false);
  // Today's person couldn't be found: nobody new fits right now, or the
  // picker didn't answer. Said plainly instead of "check back tomorrow".
  const [noneToday, setNoneToday] = useState<'nobody' | 'failed' | null>(null);
  const [saved, setSaved] = useState<SavedProfile[]>([]);
  const [removing, setRemoving] = useState<string | null>(null);

  const loadSaved = useCallback(async () => {
    const { data } = await supabase.from('saved_profiles').select('*').order('saved_at', { ascending: false });
    setSaved((data ?? []) as SavedProfile[]);
  }, []);

  const removeSaved = async (userId: string) => {
    setRemoving(userId);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      await supabase.from('connections').update({ saved: false }).eq('user_a_id', user.id).eq('user_b_id', userId);
    }
    setSaved((prev) => prev.filter((p) => p.user_id !== userId));
    setRemoving(null);
  };

  const toSuggestions = async (items: DiscoverState['items']): Promise<Suggestion[]> => {
    if (items.length === 0) return [];
    const { data: profiles } = await supabase
      .from('discovery_profiles')
      .select('user_id, display_name, age_band, life_transitions, life_transitions_other, location_city, distance_miles, selfie_verified')
      .in('user_id', items.map((i) => i.candidate_id));
    const stories = await Promise.all(items.map((i) => fetchProfileStories(i.candidate_id)));
    return items
      .map((row, idx): Suggestion | null => {
        const profile = profiles?.find((p) => p.user_id === row.candidate_id);
        if (!profile) return null;
        const firstStory = stories[idx]?.find((st) => st.text.trim())?.text.trim() ?? null;
        return {
          userId: row.candidate_id,
          displayName: profile.display_name,
          ageBand: profile.age_band,
          lifeTransitions: profile.life_transitions ?? [],
          reasoning: row.reasoning,
          humanDetail: row.human_detail ?? null,
          whatBrings: profile.life_transitions_other?.trim() || null,
          storyOpening: firstStory ? openingLines(firstStory) : null,
          locationCity: profile.location_city,
          distanceMiles: profile.distance_miles,
          selfieVerified: Boolean(profile.selfie_verified),
        };
      })
      .filter((s): s is Suggestion => s !== null);
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
      if (__DEV__) {
        setSuggestions(DEV_FALLBACK_SUGGESTIONS);
        setUsingDevFallback(true);
      }
      setLoaded(true);
      return;
    }
    setUsingDevFallback(false);
    loadSaved();
    const tz = deviceTimeZone();
    const read = async () => {
      const { data, error: rpcError } = await supabase.rpc('get_discover', { p_tz: tz });
      if (rpcError) throw rpcError;
      return data as DiscoverState;
    };
    try {
      let state = await read();
      setFull(state.full);
      setBreakUntil(state.on_break_until ?? null);
      setSuggestions(await toSuggestions(state.items));
      setLoaded(true);
      if (state.can_add) {
        // Today's new person. Only added when there's room for one.
        setGenerating(true);
        const { data: fnData, error: fnError } = await supabase.functions.invoke('generate-match-suggestions', { body: { tz } });
        if (fnData?.added) {
          setNoneToday(null);
          state = await read();
          setFull(state.full);
          setSuggestions(await toSuggestions(state.items));
        } else {
          setNoneToday(fnError || fnData?.error ? 'failed' : 'nobody');
        }
        setGenerating(false);
      }
    } catch {
      setGenerating(false);
      setLoaded(true);
      setError("We couldn't load Discover. Pull to refresh in a moment.");
    }
  }, [loadSaved]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const firstName = (id: string) =>
    (suggestions.find((s) => s.userId === id)?.displayName ?? 'They').split(' ')[0];
  const removeCard = (id: string) => setSuggestions((prev) => prev.filter((s) => s.userId !== id));

  const handleSave = async (candidateId: string) => {
    setPendingAction(candidateId + 'save');
    setCapacityNotice(null);
    setErrorDetail(null);
    const result = await saveForLater(candidateId);
    setPendingAction(null);
    if (result === 'full') {
      setCapacityNotice(SAVED_FULL_COPY);
      return;
    }
    if (result === 'error') {
      setError('Something went wrong. Please try again.');
      setErrorDetail(lastActionErrorDetail());
      return;
    }
    setError(null);
    setCapacityNotice(`Saved. ${firstName(candidateId)} is below, under Saved, for the next 30 days.`);
    removeCard(candidateId);
    loadSaved();
  };

  const handlePass = async (candidateId: string) => {
    setPendingAction(candidateId + 'passed');
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      await supabase
        .from('connections')
        .upsert({ user_a_id: user.id, user_b_id: candidateId, status: 'passed' }, { onConflict: 'user_a_id,user_b_id' });
    }
    setPendingAction(null);
    removeCard(candidateId);
  };

  // Mutual Interested gate (docs/DECISIONS.md section 3). Saying Interested
  // is private: the other person is only told if they choose this member
  // too. While waiting, the person moves to Inbox, Pending (2026-10-14).
  const handleInterested = async (candidateId: string) => {
    setPendingAction(candidateId + 'interested');
    setCapacityNotice(null);
    setErrorDetail(null);
    const name = firstName(candidateId);
    const result = await expressInterest(candidateId);
    setPendingAction(null);
    if (result.status === 'mutual') {
      router.push({ pathname: '/thread/[id]', params: { id: result.connectionId } });
    } else if (result.status === 'waiting') {
      setCapacityNotice(interestSavedCopy(name, result));
      removeCard(candidateId);
    } else if (result.status === 'ended') {
      router.push({ pathname: '/candidate/[id]', params: { id: candidateId } });
    } else {
      setCapacityNotice(result.message);
      setErrorDetail(lastActionErrorDetail());
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
            <Text className="text-display text-stone-900 dark:text-stone-50">People for you</Text>
            <Text className="text-body text-stone-500 dark:text-stone-400">
              One new person each day. Take your time with each one.
            </Text>
          </View>

          <CoachMark
            markKey="tab_discover"
            title="One new person a day"
            text="Each day you meet one new person here. Read their profile, then choose. Interested is private: they only find out if they say Interested too. Save keeps them below, under Saved, for 30 days while you think. Not for me takes them away, and nobody is told."
          />

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
          {testTools && errorDetail && (
            <Text className="text-[11px] text-stone-400 dark:text-stone-500">Details (only admins and test accounts see this): {errorDetail}</Text>
          )}
          {capacityNotice && (
            <Text className="text-caption text-stone-500 dark:text-stone-400">{capacityNotice}</Text>
          )}

          {full && (
            <View className="gap-2 rounded-3xl border border-stone-100 bg-white p-7 dark:border-stone-700/60 dark:bg-stone-800">
              <Text className="text-body text-stone-600 dark:text-stone-300">
                You&apos;re giving 3 people your attention right now. New people will show here again when you have room.
              </Text>
            </View>
          )}

          {breakUntil && (
            <View className="gap-2 rounded-3xl border border-stone-100 bg-white p-7 dark:border-stone-700/60 dark:bg-stone-800">
              <Text className="text-body text-stone-600 dark:text-stone-300">
                You&apos;re taking a break until{' '}
                {new Date(breakUntil).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}.
                New people will show here again after that.
              </Text>
              <Pressable onPress={() => router.push('/settings')} className="self-start">
                <Text className="text-caption font-semibold text-accent-500">End my break in Settings</Text>
              </Pressable>
            </View>
          )}

          {generating && <SuggestionSkeletonCard />}

          {!full && !breakUntil && !generating && suggestions.length === 0 && !error && (
            <View className="gap-2 rounded-3xl border border-stone-100 bg-white p-7 dark:border-stone-700/60 dark:bg-stone-800">
              <Text className="text-body text-stone-600 dark:text-stone-300">
                {noneToday === 'nobody'
                  ? "There's nobody new nearby who fits your settings right now. We'll look again tomorrow."
                  : noneToday === 'failed'
                    ? "Today's person couldn't be found just now. Please try again in a moment."
                    : 'A new person comes each day. Check back tomorrow.'}
              </Text>
            </View>
          )}

          {!full && suggestions.map((s) => {
            const isSaved = false;
            const isInterested = false;
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
                    <View className="flex-row flex-wrap items-center gap-2">
                      <Text className="text-title text-stone-900 dark:text-stone-50">
                        {s.displayName ?? 'A member'}
                        {s.ageBand ? `, ${s.ageBand}` : ''}
                      </Text>
                      {s.selfieVerified && (
                        <View className="flex-row items-center gap-1 rounded-full border border-accent-500 px-2 py-0.5">
                          <Ionicons name="checkmark-circle" size={12} color="#B5643B" />
                          <Text className="text-caption text-accent-500">Photo verified</Text>
                        </View>
                      )}
                    </View>
                    {distanceLabel && (
                      <Text className="text-caption text-stone-500 dark:text-stone-400">
                        {distanceLabel}
                      </Text>
                    )}
                    {/* Only their own words (2026-10-18). A short card is
                        fine: it honestly shows how much they wrote. */}
                    {s.whatBrings && (
                      <Text className="text-body leading-relaxed text-stone-700 dark:text-stone-300">
                        {s.whatBrings}
                      </Text>
                    )}
                    {s.storyOpening && (
                      <Text className="text-body italic leading-relaxed text-stone-500 dark:text-stone-400">
                        {s.storyOpening}
                      </Text>
                    )}
                  </View>
                </Pressable>

                <View className="flex-row gap-2">
                  <Pressable
                    onPress={() => handlePass(s.userId)}
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

          {/* Saved, below today's person (2026-10-25). */}
          {isSupabaseConfigured && !usingDevFallback && (
            <View className="gap-3 pt-2">
              <Text className="text-caption font-semibold uppercase text-stone-400 dark:text-stone-600">
                Saved{saved.length > 0 ? ` · ${saved.length} of ${SAVE_MAX}` : ''}
              </Text>
              {saved.length === 0 ? (
                <Text className="text-caption text-stone-500 dark:text-stone-400">
                  When you save someone, they stay here for 30 days.
                </Text>
              ) : (
                saved.map((p) => {
                  const detail = p.personal_statement?.split(/(?<=[.!?])\s+/)[0] || null;
                  const until = new Date(new Date(p.saved_at).getTime() + SAVE_DAYS * 86400000).toISOString();
                  return (
                    <View
                      key={p.connection_id}
                      className="flex-row items-center gap-3 rounded-2xl border border-stone-100 bg-white px-4 py-3 dark:border-stone-700/60 dark:bg-stone-800">
                      <Pressable
                        onPress={() => router.push({ pathname: '/candidate/[id]', params: { id: p.user_id } })}
                        className="flex-1 gap-0.5 active:opacity-70">
                        <Text className="text-body font-semibold text-stone-900 dark:text-stone-50">
                          {p.display_name ?? 'A member'}
                          {p.age_band ? `, ${p.age_band}` : ''}
                        </Text>
                        {detail && (
                          <Text numberOfLines={2} className="text-caption text-stone-600 dark:text-stone-300">
                            {detail}
                          </Text>
                        )}
                        <Text className="text-caption text-stone-400 dark:text-stone-500">Saved until {shortDay(until)}</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => removeSaved(p.user_id)}
                        disabled={removing === p.user_id}
                        hitSlop={8}
                        accessibilityLabel={`Remove ${p.display_name ?? 'this person'} from Saved`}
                        className="rounded-full px-2 py-1 active:opacity-70">
                        <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">Remove</Text>
                      </Pressable>
                    </View>
                  );
                })
              )}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
