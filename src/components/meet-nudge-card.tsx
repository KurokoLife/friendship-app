import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { TurnOffForChatLink } from '@/components/chat-reminders-sheet';
import { LogMeetupForm } from '@/components/log-meetup-form';
import { supabase } from '@/lib/supabase';

// Gentle nudges to meet in person (2026-10-09). Shown privately to each
// person who has been really talking with someone (both have written) but
// never met, and isn't planning anything right now:
//   - after about 3 weeks: "Want to plan something?" (Not yet asks again
//     3 weeks later)
//   - after about 2 months and about 6 months: an honest check, once each.
// 2026-10-10: after two people meet, the same three cards start over from
// their last meetup. Every card offers "We've already met" for meetups
// made outside the app, so each one is counted.
// Time paused doesn't count. Nothing closes by itself; the app never
// forces, it only reminds that meeting is where the friendship grows.

type Stage = 'three_weeks' | 'two_months' | 'six_months';

function firstName(name: string) {
  return name.split(' ')[0] || name;
}

export function MeetNudgeCard({
  connectionId,
  otherName,
  refreshKey,
  onPlan,
  onEnd,
  onTurnedOff,
}: {
  connectionId: string;
  otherName: string;
  refreshKey?: number;
  onPlan: () => void;
  onEnd: () => void;
  // "Turn these off for this chat" (2026-10-10).
  onTurnedOff?: () => void;
}) {
  const [stage, setStage] = useState<Stage | null>(null);
  const [met, setMet] = useState(false);
  const [days, setDays] = useState(0);
  const [busy, setBusy] = useState(false);
  const [saidKeep, setSaidKeep] = useState(false);
  const [logging, setLogging] = useState(false);
  const [logged, setLogged] = useState(false);
  const name = firstName(otherName);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_meet_nudge', { p_connection_id: connectionId });
    if (error || !data) {
      setStage(null);
      return;
    }
    setStage((data as { stage: Stage; met?: boolean }).stage);
    setMet(!!(data as { met?: boolean }).met);
    setDays(Number((data as { days?: number }).days ?? 0));
  }, [connectionId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const answer = async (value: 'plan' | 'not_yet' | 'keep_chatting') => {
    if (!stage) return;
    setBusy(true);
    await supabase.rpc('answer_meet_nudge', { p_connection_id: connectionId, p_stage: stage, p_answer: value });
    setBusy(false);
    if (value === 'keep_chatting') {
      setSaidKeep(true);
      return;
    }
    setStage(null);
    if (value === 'plan') onPlan();
  };

  if (saidKeep) {
    return (
      <View className="mx-6 mt-2 gap-2 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
        <Text className="text-body text-stone-700 dark:text-stone-300">
          That&apos;s okay. Whenever you&apos;re ready, &quot;Let&apos;s plan something&quot; is right here.
        </Text>
        <Pressable
          onPress={() => {
            setSaidKeep(false);
            setStage(null);
          }}
          className="self-start">
          <Text className="text-caption font-semibold text-accent-500">OK</Text>
        </Pressable>
      </View>
    );
  }

  if (logged) {
    return (
      <View className="mx-6 mt-2 gap-2 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
        <Text className="text-body text-stone-700 dark:text-stone-300">
          Added. {name} will be asked to confirm, and it&apos;s counted once they do.
        </Text>
        <Pressable onPress={() => setLogged(false)} className="self-start">
          <Text className="text-caption font-semibold text-accent-500">OK</Text>
        </Pressable>
      </View>
    );
  }

  if (!stage) return null;

  if (logging) {
    return (
      <View className="mx-6 mt-2 gap-3 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
        <LogMeetupForm
          connectionId={connectionId}
          otherName={name}
          onCancel={() => setLogging(false)}
          onDone={() => {
            setLogging(false);
            setStage(null);
            setLogged(true);
          }}
        />
      </View>
    );
  }
  const metLink = (
    <Pressable onPress={() => setLogging(true)} className="self-start">
      <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">
        {met ? "We've met up since then" : "We've already met"}
      </Text>
    </Pressable>
  );

  const turnOff = (
    <TurnOffForChatLink
      connectionId={connectionId}
      kind="meet_nudge"
      onDone={() => {
        setStage(null);
        onTurnedOff?.();
      }}
    />
  );

  const button = (label: string, onPress: () => void, primary = false) => (
    <Pressable
      key={label}
      onPress={onPress}
      disabled={busy}
      className={`rounded-full px-4 py-2 ${
        primary ? 'bg-stone-900 dark:bg-stone-50' : 'border border-stone-300 dark:border-stone-700'
      } ${busy ? 'opacity-40' : ''}`}>
      <Text
        className={`text-caption font-semibold ${
          primary ? 'text-stone-50 dark:text-stone-900' : 'text-stone-700 dark:text-stone-300'
        }`}>
        {label}
      </Text>
    </Pressable>
  );

  if (stage === 'three_weeks') {
    return (
      <View className="mx-6 mt-2 gap-3 rounded-2xl border border-accent-500/40 bg-accent-500/5 p-4">
        <Text className="text-body text-stone-700 dark:text-stone-300">
          {met
            ? `It's been ${days < 18 ? 'a little while' : 'a few weeks'} since you and ${name} last met. Want to plan something?`
            : `You and ${name} have been talking for a few weeks. Chatting is a good start, and meeting in person is where a friendship really grows. Want to plan something?`}
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {button("Let's plan something", () => answer('plan'), true)}
          {button('Not yet', () => answer('not_yet'))}
        </View>
        {metLink}
        {turnOff}
      </View>
    );
  }

  const length = stage === 'two_months' ? 'about 2 months' : 'about 6 months';
  return (
    <View className="mx-6 mt-2 gap-3 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
      <Text className="text-body text-stone-700 dark:text-stone-300">
        {met
          ? `It's been ${length} since you and ${name} last met. Would you like to meet up again? It's okay either way.`
          : `You and ${name} have been talking for ${length} and haven't met yet. Is meeting up something you'd like with ${name}? It's okay either way.`}
      </Text>
      <Text className="text-caption text-stone-500 dark:text-stone-400">
        Only you see this. This chat uses one of your 3 active chats.
      </Text>
      <View className="flex-row flex-wrap gap-2">
        {button("Let's plan something", () => answer('plan'), true)}
        {button("I'd like to keep chatting for now", () => answer('keep_chatting'))}
        {button('End kindly', onEnd)}
      </View>
      {metLink}
      {turnOff}
    </View>
  );
}
