import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { supabase } from '@/lib/supabase';

// Gentle nudges to meet in person (2026-10-09). Shown privately to each
// person who has been really talking with someone (both have written) but
// never met, and isn't planning anything right now:
//   - after about 3 weeks: "Want to plan something?" (Not yet asks again
//     3 weeks later)
//   - after about 2 months and about 6 months: an honest check, once each.
// Time paused doesn't count. Nothing closes by itself; the app never
// forces, it only reminds that meeting is where the friendship grows.
// See supabase/migrations/20261009000006_plan_one_turn_meet_nudges.sql.

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
}: {
  connectionId: string;
  otherName: string;
  refreshKey?: number;
  onPlan: () => void;
  onEnd: () => void;
}) {
  const [stage, setStage] = useState<Stage | null>(null);
  const [busy, setBusy] = useState(false);
  const [saidKeep, setSaidKeep] = useState(false);
  const name = firstName(otherName);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_meet_nudge', { p_connection_id: connectionId });
    if (error || !data) {
      setStage(null);
      return;
    }
    setStage((data as { stage: Stage }).stage);
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
      <View className="mx-6 mt-4 gap-2 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
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

  if (!stage) return null;

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
      <View className="mx-6 mt-4 gap-3 rounded-2xl border border-accent-500/40 bg-accent-500/5 p-4">
        <Text className="text-body text-stone-700 dark:text-stone-300">
          You and {name} have been talking for a few weeks. Chatting is a good start, and meeting in person is where a
          friendship really grows. Want to plan something?
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {button("Let's plan something", () => answer('plan'), true)}
          {button('Not yet', () => answer('not_yet'))}
        </View>
      </View>
    );
  }

  const length = stage === 'two_months' ? 'about 2 months' : 'about 6 months';
  return (
    <View className="mx-6 mt-4 gap-3 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
      <Text className="text-body text-stone-700 dark:text-stone-300">
        You and {name} have been talking for {length} and haven&apos;t met yet. Is meeting up something you&apos;d like
        with {name}? It&apos;s okay either way.
      </Text>
      <Text className="text-caption text-stone-500 dark:text-stone-400">
        Only you see this. This chat uses one of your 3 active chats.
      </Text>
      <View className="flex-row flex-wrap gap-2">
        {button("Let's plan something", () => answer('plan'), true)}
        {button("I'd like to keep chatting for now", () => answer('keep_chatting'))}
        {button('End kindly', onEnd)}
      </View>
    </View>
  );
}
