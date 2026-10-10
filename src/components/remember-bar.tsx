import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { fetchIdeaNotes, fetchOpenAsks, markMeetupAsked, meetupToAskAbout, type OpenAsk, type RememberMeetup } from '@/lib/remember';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400

// Slim bar at the top of a chat (2026-10-10): "What I want to remember
// about X". Opens the private notes page. After a meetup counts it asks
// once, "Anything you'd like to remember about X?". Otherwise it can show
// the newest thing the person wanted to ask next time. Both of those are
// "notes coming back" and follow that reminder setting.
export function RememberBar({
  connectionId,
  myId,
  otherName,
  notesOn,
  refreshKey,
}: {
  connectionId: string;
  myId: string;
  otherName: string;
  notesOn: boolean;
  refreshKey?: number;
}) {
  const [askMeetup, setAskMeetup] = useState<RememberMeetup | null>(null);
  const [asks, setAsks] = useState<OpenAsk[]>([]);
  const first = otherName.split(' ')[0] || otherName;
  // Coming back from the notes page refreshes the bar.
  const [focusTick, setFocusTick] = useState(0);
  useFocusEffect(useCallback(() => setFocusTick((t) => t + 1), []));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [m, a] = await Promise.all([
        notesOn ? meetupToAskAbout(connectionId, myId) : Promise.resolve(null),
        notesOn ? fetchOpenAsks(connectionId) : Promise.resolve([] as OpenAsk[]),
      ]);
      if (cancelled) return;
      setAskMeetup(m);
      setAsks(a);
    })();
    return () => {
      cancelled = true;
    };
  }, [connectionId, myId, notesOn, refreshKey, focusTick]);

  const open = () =>
    router.push({
      pathname: '/remember/[connectionId]',
      params: askMeetup ? { connectionId, askMeetup: askMeetup.id } : { connectionId },
    });

  const attention = askMeetup
    ? `Anything you'd like to remember about ${first}?`
    : asks.length > 0
      ? `Next time: ${asks[0].text}`
      : null;

  return (
    <Pressable
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel={`What I want to remember about ${first}. Only you can see this`}
      className={`mx-6 mt-3 flex-row items-center gap-3 rounded-2xl border px-4 py-2.5 ${
        askMeetup ? 'border-accent-500/40 bg-accent-500/5' : 'border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-800'
      }`}>
      <Ionicons name="lock-closed-outline" size={14} color={MUTED_ICON_COLOR} />
      <View className="flex-1">
        <Text numberOfLines={2} className="text-caption text-stone-700 dark:text-stone-300">
          What I want to remember about {first}
        </Text>
        {attention && (
          <Text numberOfLines={2} className="text-caption font-semibold text-accent-500">
            {attention}
          </Text>
        )}
      </View>
      {askMeetup ? (
        <Pressable
          onPress={async () => {
            const m = askMeetup;
            setAskMeetup(null);
            await markMeetupAsked(m.id, myId);
          }}
          hitSlop={8}>
          <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">Not now</Text>
        </Pressable>
      ) : (
        <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">Open</Text>
      )}
    </Pressable>
  );
}

// "From your notes": the questions the person wanted to ask next time,
// shown inside the planning card and the check-in. In the planning card it
// also lists their notes marked "Ideas for us" (2026-10-10). Own words
// only, and only for the person who wrote them.
export function RememberAsksLine({
  connectionId,
  otherName,
  notesOn,
  withIdeas = false,
}: {
  connectionId: string;
  otherName: string;
  notesOn: boolean;
  withIdeas?: boolean;
}) {
  const [asks, setAsks] = useState<OpenAsk[]>([]);
  const [ideas, setIdeas] = useState<{ noteId: string; text: string }[]>([]);
  const first = otherName.split(' ')[0] || otherName;

  useEffect(() => {
    let cancelled = false;
    if (!notesOn) {
      setAsks([]);
      setIdeas([]);
      return;
    }
    Promise.all([fetchOpenAsks(connectionId), withIdeas ? fetchIdeaNotes(connectionId) : Promise.resolve([])]).then(
      ([a, i]) => {
        if (cancelled) return;
        setAsks(a);
        setIdeas(i);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [connectionId, notesOn, withIdeas]);

  if (asks.length === 0 && ideas.length === 0) return null;
  return (
    <View className="gap-2 rounded-xl border border-stone-200 bg-white p-3 dark:border-stone-700 dark:bg-stone-800">
      {ideas.length > 0 && (
        <View className="gap-1">
          <Text className="text-caption font-semibold text-stone-600 dark:text-stone-300">
            From your notes: ideas for you and {first}
          </Text>
          {ideas.slice(0, 3).map((i) => (
            <Text key={i.noteId} className="text-body text-stone-800 dark:text-stone-100">
              • {i.text}
            </Text>
          ))}
        </View>
      )}
      {asks.length > 0 && (
        <View className="gap-1">
          <Text className="text-caption font-semibold text-stone-600 dark:text-stone-300">
            From your notes: next time, you wanted to ask {first} about
          </Text>
          {asks.slice(0, 3).map((a) => (
            <Text key={a.noteId} className="text-body text-stone-800 dark:text-stone-100">
              • {a.text}
            </Text>
          ))}
        </View>
      )}
      <Text className="text-caption italic text-stone-400 dark:text-stone-500">Only you see this.</Text>
    </View>
  );
}
