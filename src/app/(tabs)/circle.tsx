import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CirclesPicture } from '@/components/circles-picture';
import { CoachMark } from '@/components/coach-mark';
import { Face, Pill, RowLink } from '@/components/ui';
import {
  CIRCLES,
  CIRCLE_LABELS,
  LIMEN_STATE_LABELS,
  RHYTHM_LABELS,
  fetchMyPeople,
  fetchOutsideFriends,
  type Circle,
  type LimenPerson,
  type OutsideFriend,
} from '@/lib/circle';
import {
  ackInterestClosures,
  fetchMyPending,
  fetchMySelfieStatus,
  openReadyInterests,
  type PendingPerson,
  type SelfieStatus,
} from '@/lib/safety';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { layout, palette } from '@/theme';

type Row =
  | { kind: 'limen'; key: string; name: string; circle: Circle; person: LimenPerson }
  | { kind: 'outside'; key: string; name: string; circle: Circle; friend: OutsideFriend };

// Your circle (rebuild stage 1, 2026-10-25; design pass 1b the same day,
// docs/context/05_LIMEN_REBUILD.md). The home tab. Four circles, Limen people
// and friends added by hand together. Limen people are placed on their own
// (an open or paused chat and people you said Interested to are in Getting
// to know, graduated friends in Friends); anyone can be moved from their own
// page. Ended, closed and blocked people never appear. No "last talked"
// dates anywhere: this is not a list of who you owe a message.
export default function CircleScreen() {
  const { width } = useWindowDimensions();
  const wide = width > layout.wideAt;
  const [loaded, setLoaded] = useState(false);
  const [limen, setLimen] = useState<LimenPerson[]>([]);
  const [outside, setOutside] = useState<OutsideFriend[]>([]);
  const [closed, setClosed] = useState<PendingPerson[]>([]);
  const [selfie, setSelfie] = useState<SelfieStatus>('approved');
  const scrollRef = useRef<ScrollView>(null);
  const listTop = useRef(0);
  const sectionY = useRef<Partial<Record<Circle, number>>>({});

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
      (p): Row => ({ kind: 'limen', key: `l-${p.other_user_id}`, name: p.display_name ?? 'Someone', circle: p.circle, person: p })
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

  const jumpTo = (c: Circle) => {
    const y = sectionY.current[c];
    if (y !== undefined) scrollRef.current?.scrollTo({ y: listTop.current + y - 12, animated: true });
  };

  if (!loaded) {
    return (
      <View className="flex-1 items-center justify-center bg-stone-50 dark:bg-stone-900">
        <ActivityIndicator color={palette.muted} />
      </View>
    );
  }

  const nobody = rows.length === 0;
  const waitingCount = limen.filter((p) => p.state === 'waiting').length;
  const addSomeone = () => router.push({ pathname: '/friend/[id]', params: { id: 'new' } });

  return (
    <View className="flex-1 bg-stone-50 dark:bg-stone-900">
      <SafeAreaView className="flex-1" edges={wide ? [] : ['top']}>
        <ScrollView ref={scrollRef} contentContainerClassName={`gap-6 px-5 pb-12 ${wide ? 'pt-9' : 'pt-7'}`}>
          <View className="flex-row items-center justify-between gap-3">
            <View className="flex-1 gap-0.5">
              <Text className={`${wide ? 'text-display-lg' : 'text-display'} text-stone-900 dark:text-stone-50`}>Your circle</Text>
              <Text className="text-caption text-stone-500 dark:text-stone-400">Only you see this.</Text>
            </View>
            <Pill label="Add someone" icon="add" variant="filled" onPress={addSomeone} />
          </View>

          <CoachMark
            markKey="tab_people"
            title="Your circle"
            text="People you meet on Limen show up here on their own. Add anyone else you'd like to keep up with."
          />

          {!isSupabaseConfigured && (
            <Text className="text-caption text-amber-700 dark:text-amber-400">Supabase isn&apos;t configured yet. See .env.example.</Text>
          )}

          {closed.map((c) => (
            <View
              key={`closed-${c.other_user_id}`}
              className="gap-2 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
              <Text className="text-body text-stone-700 dark:text-stone-300">
                Your interest in {(c.display_name ?? 'them').split(' ')[0]} has come to a close. It didn&apos;t turn into a
                chat this time, and that happens often. Timing, room in someone&apos;s life, and fit all play a part. New
                people are on the way.
              </Text>
            </View>
          ))}

          <CirclesPicture
            size={wide ? 380 : Math.min(300, width - 40)}
            faces={rows.map((r) => ({
              key: r.key,
              name: r.name,
              circle: r.circle,
              photoUrl: r.kind === 'limen' ? r.person.photo_url : null,
            }))}
            onRingPress={jumpTo}
          />

          {nobody && isSupabaseConfigured ? (
            // Empty state. Draft wording, waiting for the founder's OK.
            <View className="gap-2 rounded-2xl border border-stone-200 bg-white p-6 dark:border-stone-700 dark:bg-stone-800">
              <Text className="text-title text-stone-900 dark:text-stone-50">Who would you like to keep up with?</Text>
              <Text className="text-body text-stone-600 dark:text-stone-300">
                Add a friend you&apos;d like to see more of, or someone you&apos;ve lost touch with. A first name is enough,
                and only you see this list.
              </Text>
              <Text className="text-caption text-stone-500 dark:text-stone-400">People you meet on Limen will show up here too.</Text>
            </View>
          ) : (
            <View
              onLayout={(e) => {
                listTop.current = e.nativeEvent.layout.y;
              }}
              className={wide ? 'flex-row flex-wrap' : 'gap-6'}
              style={wide ? { columnGap: 24, rowGap: 20 } : undefined}>
              {CIRCLES.map((circle) => {
                const inCircle = rows.filter((r) => r.circle === circle);
                return (
                  <View
                    key={circle}
                    accessibilityLabel={CIRCLE_LABELS[circle]}
                    onLayout={(e) => {
                      sectionY.current[circle] = e.nativeEvent.layout.y;
                    }}
                    className="gap-2"
                    style={wide ? { width: (layout.column - 40 - 24) / 2 } : undefined}>
                    <Text accessibilityRole="header" className="text-caption font-semibold text-stone-500 dark:text-stone-400">
                      {CIRCLE_LABELS[circle]}
                      {inCircle.length > 0 ? ` · ${inCircle.length}` : ''}
                    </Text>
                    {circle === 'getting_to_know' && waitingCount > 0 && selfie !== 'approved' && (
                      <View className="gap-3 rounded-2xl border border-honey-line bg-honey p-4 dark:border-stone-700 dark:bg-stone-800">
                        <Text className="text-body text-stone-700 dark:text-stone-300">
                          {selfie === 'pending'
                            ? 'Your selfie is waiting for our review, usually within a day. Chats open once it is approved.'
                            : selfie === 'rejected'
                              ? "Your selfie check didn't go through. Please take a new one so chats can open."
                              : 'Chats open once your selfie check is approved. It takes a minute.'}
                        </Text>
                        {selfie !== 'pending' && (
                          <Pill label="Do the selfie check" className="self-start" onPress={() => router.push('/selfie-check')} />
                        )}
                      </View>
                    )}
                    {inCircle.length === 0 ? (
                      <Text className="text-caption text-stone-500 dark:text-stone-400">Nobody here yet.</Text>
                    ) : (
                      inCircle.map((row) => (
                        <RowLink
                          key={row.key}
                          title={row.name}
                          subtitle={row.kind === 'limen' ? LIMEN_STATE_LABELS[row.person.state] : RHYTHM_LABELS[row.friend.rhythm]}
                          accessibilityLabel={`Open ${row.name}`}
                          left={
                            <Face
                              name={row.name}
                              circle={row.circle}
                              photoUrl={row.kind === 'limen' ? row.person.photo_url : null}
                            />
                          }
                          onPress={() => open(row)}
                        />
                      ))
                    )}
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
