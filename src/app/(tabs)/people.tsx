import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CoachMark } from '@/components/coach-mark';
import {
  CIRCLES,
  CIRCLE_LABELS,
  RHYTHM_LABELS,
  fetchMyPeople,
  fetchOutsideFriends,
  moveLimenPerson,
  moveOutsideFriend,
  type Circle,
  type LimenPerson,
  type OutsideFriend,
} from '@/lib/people';
import {
  ackInterestClosures,
  fetchMyPending,
  fetchMySelfieStatus,
  openReadyInterests,
  type PendingPerson,
  type SelfieStatus,
} from '@/lib/safety';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400
const ACCENT_COLOR = '#B5643B'; // accent-500

function shortDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Why someone you said Interested to is still waiting (wording from the
// old Inbox Pending tab, 2026-10-14). The other person is never told.
function waitingLine(p: PendingPerson): string {
  const first = (p.display_name ?? 'They').split(' ')[0];
  const why =
    p.state === 'my_selfie'
      ? 'You both said Interested. Your chat opens once your selfie is approved.'
      : p.state === 'their_selfie'
        ? `You both said Interested. Your chat opens once ${first}'s selfie check is done.`
        : p.state === 'room'
          ? "You both said Interested. Your chat opens as soon as there's room for a new chat."
          : `Waiting for ${first}. If ${first} says Interested too, you can say hello.`;
  return `${why} Closes on its own on ${shortDay(p.closes_at)} if a chat hasn't opened.`;
}

const LIMEN_STATE_LABELS: Record<LimenPerson['state'], string> = {
  chat: 'Chat on Limen',
  paused: 'Chat on Limen, paused',
  waiting: 'Waiting to connect',
  friend: 'Met on Limen',
};

type Row =
  | { kind: 'limen'; key: string; name: string; circle: Circle; person: LimenPerson }
  | { kind: 'outside'; key: string; name: string; circle: Circle; friend: OutsideFriend };

// Your people (rebuild stage 1, 2026-10-25, docs/context/05_LIMEN_REBUILD.md).
// The home tab. Four circles, Limen people and friends added by hand
// together. Limen people are placed on their own (an open or paused chat
// and people you said Interested to are in Getting to know, graduated
// friends in Friends); anyone can be moved. Ended, closed and blocked
// people never appear. No "last talked" dates anywhere: this is not a
// list of who you owe a message.
export default function PeopleScreen() {
  const [loaded, setLoaded] = useState(false);
  const [limen, setLimen] = useState<LimenPerson[]>([]);
  const [outside, setOutside] = useState<OutsideFriend[]>([]);
  const [closed, setClosed] = useState<PendingPerson[]>([]);
  const [pendingById, setPendingById] = useState<Map<string, PendingPerson>>(new Map());
  const [selfie, setSelfie] = useState<SelfieStatus>('approved');
  const [moving, setMoving] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    // A pair that became ready (a selfie approved, room freed) opens first,
    // so it shows as a chat rather than as waiting.
    await openReadyInterests().catch(() => 0);
    const [people, friends, pending, selfieNow] = await Promise.all([
      fetchMyPeople(),
      fetchOutsideFriends(),
      fetchMyPending(),
      fetchMySelfieStatus(),
    ]);
    setLimen(people);
    setOutside(friends);
    setClosed(pending.filter((p) => p.state === 'closed'));
    setPendingById(new Map(pending.filter((p) => p.state !== 'closed').map((p) => [p.other_user_id, p])));
    setSelfie(selfieNow);
    setLoaded(true);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // A closed Interested is shown once.
  useEffect(() => {
    if (closed.length > 0) ackInterestClosures();
  }, [closed.length]);

  const rows: Row[] = [
    ...limen.map(
      (p): Row => ({ kind: 'limen', key: `l-${p.other_user_id}`, name: p.display_name ?? 'A member', circle: p.circle, person: p })
    ),
    ...outside.map((f): Row => ({ kind: 'outside', key: `o-${f.id}`, name: f.name, circle: f.circle, friend: f })),
  ].sort((a, b) => a.name.localeCompare(b.name));

  const open = (row: Row) => {
    if (row.kind === 'outside') {
      router.push({ pathname: '/friend/[id]', params: { id: row.friend.id } });
    } else if (row.person.connection_id) {
      router.push({ pathname: '/thread/[id]', params: { id: row.person.connection_id } });
    } else {
      // Said Interested, no chat yet: their profile.
      router.push({ pathname: '/candidate/[id]', params: { id: row.person.other_user_id } });
    }
  };

  const move = async (circle: Circle) => {
    if (!moving) return;
    setBusy(true);
    setError(null);
    const ok =
      moving.kind === 'outside' ? await moveOutsideFriend(moving.friend, circle) : await moveLimenPerson(moving.person.other_user_id, circle);
    setBusy(false);
    if (!ok) {
      setError("That didn't save. Please try again.");
      return;
    }
    setMoving(null);
    load();
  };

  if (!loaded) {
    return (
      <View className="flex-1 items-center justify-center bg-stone-50 dark:bg-stone-900">
        <ActivityIndicator color={MUTED_ICON_COLOR} />
      </View>
    );
  }

  const nobody = rows.length === 0;
  const waitingCount = limen.filter((p) => p.state === 'waiting').length;

  return (
    <View className="flex-1 bg-stone-50 dark:bg-stone-900">
      <SafeAreaView className="flex-1">
        <ScrollView contentContainerClassName="gap-5 px-6 pb-10 pt-10">
          <View className="gap-3">
            <Text className="text-display text-stone-900 dark:text-stone-50">Your people</Text>
            {!nobody && (
              <Pressable
                onPress={() => router.push({ pathname: '/friend/[id]', params: { id: 'new' } })}
                accessibilityLabel="Add someone"
                className="flex-row items-center gap-1 self-start rounded-full border border-stone-300 px-4 py-2 active:opacity-70 dark:border-stone-600">
                <Ionicons name="add" size={16} color={MUTED_ICON_COLOR} />
                <Text className="text-caption font-semibold text-stone-900 dark:text-stone-50">Add someone</Text>
              </Pressable>
            )}
          </View>

          <CoachMark
            markKey="tab_people"
            title="Your people"
            text="The people you'd like to stay close to, in four circles. People you meet on Limen show up here on their own. You can add friends from outside Limen too, and move anyone to another circle. Only you see this list."
          />

          {!isSupabaseConfigured && (
            <Text className="text-caption text-amber-600 dark:text-amber-400">
              Supabase isn&apos;t configured yet. See .env.example.
            </Text>
          )}

          {closed.map((c) => (
            <View
              key={`closed-${c.other_user_id}`}
              className="gap-2 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
              <Text className="text-body text-stone-700 dark:text-stone-300">
                Your interest in {(c.display_name ?? 'them').split(' ')[0]} has come to a close. It didn&apos;t turn
                into a chat this time, and that happens often. Timing, room in someone&apos;s life, and fit all play a part.
                New people are on the way.
              </Text>
            </View>
          ))}

          {nobody && isSupabaseConfigured ? (
            // Empty state. Draft wording, waiting for the founder's OK.
            <View className="gap-4 rounded-3xl border border-stone-100 bg-white p-7 dark:border-stone-700/60 dark:bg-stone-800">
              <Text className="text-title text-stone-900 dark:text-stone-50">Who would you like to keep up with?</Text>
              <Text className="text-body leading-relaxed text-stone-600 dark:text-stone-300">
                Add a friend you&apos;d like to see more of, or someone you&apos;ve lost touch with. A first name is
                enough, and only you see this list.
              </Text>
              <Pressable
                onPress={() => router.push({ pathname: '/friend/[id]', params: { id: 'new' } })}
                className="items-center rounded-full bg-stone-900 py-3 active:opacity-80 dark:bg-stone-50">
                <Text className="text-body font-semibold text-stone-50 dark:text-stone-900">Add someone</Text>
              </Pressable>
              <Text className="text-caption text-stone-500 dark:text-stone-400">
                People you meet on Limen will show up here too.
              </Text>
            </View>
          ) : (
            CIRCLES.map((circle) => {
              const inCircle = rows.filter((r) => r.circle === circle);
              return (
                <View key={circle} className="gap-2">
                  <Text className="text-caption font-semibold uppercase tracking-wide text-stone-400 dark:text-stone-500">
                    {CIRCLE_LABELS[circle]}
                    {inCircle.length > 0 ? ` · ${inCircle.length}` : ''}
                  </Text>
                  {circle === 'getting_to_know' && waitingCount > 0 && selfie !== 'approved' && (
                    <View className="gap-2 rounded-2xl border border-accent-500/40 bg-accent-500/5 p-4">
                      <Text className="text-body text-stone-700 dark:text-stone-300">
                        {selfie === 'pending'
                          ? 'Your selfie is waiting for our review, usually within a day. Chats open once it is approved.'
                          : selfie === 'rejected'
                            ? "Your selfie check didn't go through. Please take a new one so chats can open."
                            : 'Chats open once your selfie check is approved. It takes a minute.'}
                      </Text>
                      {selfie !== 'pending' && (
                        <Pressable onPress={() => router.push('/selfie-check')} className="self-start">
                          <Text className="text-caption font-semibold text-accent-500">Do the selfie check</Text>
                        </Pressable>
                      )}
                    </View>
                  )}
                  {inCircle.length === 0 ? (
                    <Text className="text-caption text-stone-400 dark:text-stone-500">Nobody here yet.</Text>
                  ) : (
                    inCircle.map((row) => (
                      <View
                        key={row.key}
                        className="flex-row items-center gap-3 rounded-2xl border border-stone-100 bg-white px-4 py-3 dark:border-stone-700/60 dark:bg-stone-800">
                        <Pressable
                          onPress={() => open(row)}
                          accessibilityRole="button"
                          accessibilityLabel={`Open ${row.name}`}
                          className="flex-1 gap-0.5 active:opacity-70">
                          <Text className="text-body font-semibold text-stone-900 dark:text-stone-50">{row.name}</Text>
                          <Text className="text-caption text-stone-500 dark:text-stone-400">
                            {row.kind === 'limen'
                              ? LIMEN_STATE_LABELS[row.person.state]
                              : RHYTHM_LABELS[row.friend.rhythm]}
                          </Text>
                          {row.kind === 'limen' && row.person.state === 'waiting' && pendingById.get(row.person.other_user_id) && (
                            <Text className="text-caption text-stone-400 dark:text-stone-500">
                              {waitingLine(pendingById.get(row.person.other_user_id)!)}
                            </Text>
                          )}
                        </Pressable>
                        <Pressable
                          onPress={() => {
                            setError(null);
                            setMoving(row);
                          }}
                          hitSlop={8}
                          accessibilityLabel={`Move ${row.name}`}
                          className="rounded-full px-2 py-1 active:opacity-70">
                          <Text className="text-caption font-semibold text-accent-500">Move</Text>
                        </Pressable>
                      </View>
                    ))
                  )}
                </View>
              );
            })
          )}
        </ScrollView>
      </SafeAreaView>

      <Modal visible={moving !== null} transparent animationType="fade" onRequestClose={() => setMoving(null)}>
        <Pressable onPress={() => setMoving(null)} className="flex-1 justify-end bg-black/40">
          <Pressable onPress={() => undefined} className="gap-3 rounded-t-3xl bg-stone-50 px-6 pb-10 pt-6 dark:bg-stone-900">
            {moving && (
              <>
                <Text className="text-title text-stone-900 dark:text-stone-50">Move {moving.name.split(' ')[0]} to</Text>
                {CIRCLES.map((circle) => {
                  const current = moving.circle === circle;
                  return (
                    <Pressable
                      key={circle}
                      onPress={() => (current ? setMoving(null) : move(circle))}
                      disabled={busy}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: current }}
                      aria-checked={current}
                      className={`flex-row items-center justify-between rounded-2xl border px-4 py-3 active:opacity-70 ${
                        current ? 'border-accent-500 bg-accent-500/5' : 'border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-800'
                      }`}>
                      <Text className="text-body text-stone-900 dark:text-stone-50">{CIRCLE_LABELS[circle]}</Text>
                      {current && <Ionicons name="checkmark" size={18} color={ACCENT_COLOR} />}
                    </Pressable>
                  );
                })}
                {moving.kind === 'outside' && (
                  <Text className="text-caption text-stone-500 dark:text-stone-400">
                    If how often you&apos;d like to be in touch doesn&apos;t fit the new circle, it changes to that
                    circle&apos;s usual one. You can change it anytime on their page.
                  </Text>
                )}
                {moving.kind === 'limen' && (
                  <Text className="text-caption text-stone-500 dark:text-stone-400">
                    Limen also moves people on its own when something changes, like a friendship you both decide to
                    keep going outside Limen.
                  </Text>
                )}
                {error && <Text className="text-caption text-red-600 dark:text-red-400">{error}</Text>}
                <Pressable onPress={() => setMoving(null)} className="items-center py-2">
                  <Text className="text-body text-stone-500 dark:text-stone-400">Cancel</Text>
                </Pressable>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
