import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import {
  PART_LABELS,
  PART_START_TIME,
  dayLabel,
  fetchPlanInvites,
  isoDay,
  slotKey,
  type PlanInvite,
  type PlanSlot,
} from '@/lib/plan-board';
import { supabase } from '@/lib/supabase';

// An invite to meet, sent from "Let's plan something" (2026-10-10). It
// shows in the chat like a message: the sender's own note, then the ideas
// and times they picked. The other person replies in the chat as usual, or
// taps "Pick a time that works": the plan editor opens filled in, and a
// time the sender offered sets the plan right away.

export type InvitePick = { inviteId: string; date: string; startTime: string; activity: string };

export function usePlanInvites(connectionId: string | null, refreshKey?: number) {
  const [invites, setInvites] = useState<Record<string, PlanInvite>>({});

  const load = useCallback(async () => {
    if (!connectionId) return;
    const list = await fetchPlanInvites(connectionId);
    const byMessage: Record<string, PlanInvite> = {};
    for (const inv of list) if (inv.message_id) byMessage[inv.message_id] = inv;
    setInvites(byMessage);
  }, [connectionId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  useEffect(() => {
    if (!connectionId) return;
    const channel = supabase
      .channel(`invites-${connectionId}-${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'plan_invites', filter: `connection_id=eq.${connectionId}` },
        () => load()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [connectionId, load]);

  return { invites, reload: load };
}

function slotText(s: { day: string; part: string }) {
  return `${dayLabel(s.day)}, ${PART_LABELS[s.part as PlanSlot['part']]?.toLowerCase() ?? s.part}`;
}

function Choice({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityState={{ selected }}
      className={`max-w-full rounded-2xl border px-3 py-1.5 ${
        selected ? 'border-accent-500 bg-accent-500/15' : 'border-stone-300 dark:border-stone-600'
      }`}>
      <Text className="text-caption text-stone-700 dark:text-stone-200">{label}</Text>
    </Pressable>
  );
}

export function PlanInviteBubble({
  invite,
  myId,
  otherName,
  onPickTime,
  onSetPlan,
}: {
  invite: PlanInvite;
  myId: string;
  otherName: string;
  onPickTime: (pick: InvitePick) => void;
  onSetPlan: (activity: string) => void;
}) {
  const name = otherName.split(' ')[0] || otherName;
  const isMine = invite.sender_id === myId;
  const today = isoDay(new Date());
  const futureTimes = invite.times.filter((t) => t.day >= today);
  const [choosing, setChoosing] = useState(false);
  const [ideaId, setIdeaId] = useState<string | null>(invite.ideas.length === 1 ? invite.ideas[0].id : null);
  const [time, setTime] = useState<string | null>(futureTimes.length === 1 ? slotKey(futureTimes[0]) : null);

  const chosenIdea = invite.ideas.find((i) => i.id === ideaId) ?? null;
  const chosenTime = futureTimes.find((t) => slotKey(t) === time) ?? null;

  let status: ReactNode = null;
  if (invite.status === 'accepted' && invite.accepted_day) {
    const who = invite.accepted_by === myId ? 'You' : name;
    const when = `${dayLabel(invite.accepted_day)}${invite.accepted_part ? `, ${PART_LABELS[invite.accepted_part].toLowerCase()}` : ''}`;
    status = (
      <Text className="text-caption font-semibold text-accent-500">
        {invite.accepted_confirmed
          ? `✓ ${who} picked ${when}${invite.accepted_idea ? ` · ${invite.accepted_idea}` : ''}. It's in your plan above.`
          : isMine
            ? `${name} suggested ${when}. Confirm it in the plan above.`
            : `You suggested ${when}. Waiting for ${name} to confirm.`}
      </Text>
    );
  } else if (invite.status === 'closed') {
    status = (
      <Text className="text-caption text-stone-500 dark:text-stone-400">
        {invite.closed_reason === 'replaced' ? 'A newer invite replaced this one.' : 'You made a plan.'}
      </Text>
    );
  } else if (futureTimes.length === 0) {
    status = <Text className="text-caption text-stone-500 dark:text-stone-400">These times have passed.</Text>;
  } else if (isMine) {
    status = (
      <View className="gap-1">
        <Text className="text-caption text-stone-500 dark:text-stone-400">
          {name} can reply in the chat, or pick a time here.
        </Text>
        <Pressable onPress={() => onSetPlan(invite.ideas[0]?.title ?? '')} className="self-start">
          <Text className="text-caption font-semibold text-accent-500">Agreed on something in the chat? Set the plan</Text>
        </Pressable>
      </View>
    );
  } else if (!choosing) {
    status = (
      <View className="gap-1">
        <Pressable
          onPress={() => setChoosing(true)}
          className="self-start rounded-full bg-stone-900 px-4 py-2 active:opacity-80 dark:bg-stone-50">
          <Text className="text-caption font-semibold text-stone-50 dark:text-stone-900">Pick a time that works</Text>
        </Pressable>
        <Text className="text-caption text-stone-500 dark:text-stone-400">Or just reply in the chat.</Text>
      </View>
    );
  } else {
    status = (
      <View className="gap-2 border-t border-stone-200 pt-2 dark:border-stone-700">
        {invite.ideas.length > 1 && (
          <>
            <Text className="text-caption font-semibold text-stone-600 dark:text-stone-300">Which idea?</Text>
            <View className="flex-row flex-wrap gap-2">
              {invite.ideas.map((i) => (
                <Choice key={i.id} label={i.title} selected={i.id === ideaId} onPress={() => setIdeaId(i.id)} />
              ))}
            </View>
          </>
        )}
        <Text className="text-caption font-semibold text-stone-600 dark:text-stone-300">Which time?</Text>
        <View className="flex-row flex-wrap gap-2">
          {futureTimes.map((t) => (
            <Choice key={slotKey(t)} label={slotText(t)} selected={slotKey(t) === time} onPress={() => setTime(slotKey(t))} />
          ))}
        </View>
        <View className="flex-row flex-wrap items-center gap-4">
          <Pressable
            disabled={!chosenIdea || !chosenTime}
            onPress={() =>
              chosenIdea &&
              chosenTime &&
              onPickTime({
                inviteId: invite.id,
                date: chosenTime.day,
                startTime: PART_START_TIME[chosenTime.part],
                activity: chosenIdea.title,
              })
            }
            className={`rounded-full bg-stone-900 px-4 py-2 active:opacity-80 dark:bg-stone-50 ${
              !chosenIdea || !chosenTime ? 'opacity-40' : ''
            }`}>
            <Text className="text-caption font-semibold text-stone-50 dark:text-stone-900">Next: exact time and place</Text>
          </Pressable>
          <Pressable onPress={() => setChoosing(false)}>
            <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">Back</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View className="max-w-[88%] gap-2 rounded-2xl border border-accent-500/50 bg-white px-4 py-3 dark:bg-stone-800">
      <Text className="text-caption font-semibold text-accent-500">
        {isMine ? 'Your invite to meet' : `${name}'s invite to meet`}
      </Text>
      {invite.note && <Text className="text-body text-stone-800 dark:text-stone-100">{invite.note}</Text>}
      <View className="gap-0.5">
        <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">Ideas</Text>
        {invite.ideas.map((i) => (
          <Text key={i.id} className="text-body text-stone-700 dark:text-stone-200">
            • {i.title}
          </Text>
        ))}
      </View>
      <View className="gap-0.5">
        <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">Times</Text>
        {invite.times.map((t) => (
          <Text
            key={slotKey(t)}
            className={`text-body ${t.day < today ? 'text-stone-400 line-through dark:text-stone-600' : 'text-stone-700 dark:text-stone-200'}`}>
            • {slotText(t)}
          </Text>
        ))}
      </View>
      {status}
    </View>
  );
}
