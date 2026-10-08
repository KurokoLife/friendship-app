import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { formatWhen, toIsoDate } from '@/lib/meetup-format';
import { supabase } from '@/lib/supabase';

// "Coming up" at the top of the Inbox (2026-10-08): every meetup plan in
// one place, with where it stands. Tapping a row opens that chat, where
// the plan card and its prompts live.

type Row = {
  connectionId: string;
  name: string;
  date: string;
  startTime: string | null;
  place: string | null;
  activity: string | null;
  tag: string;
  highlight: boolean;
  order: number;
};

type MeetupRow = {
  id: string;
  connection_id: string;
  status: 'proposed' | 'confirmed';
  proposed_date: string;
  confirmed_date: string | null;
  start_time: string | null;
  place: string | null;
  activity: string | null;
  proposed_by: string;
  created_at: string;
};

export function UpcomingMeetupsStrip({
  names,
  refreshKey,
}: {
  // Chats that are still open, by connection id, with the other person's name.
  names: Map<string, string>;
  refreshKey: number;
}) {
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || names.size === 0) {
        if (!cancelled) setRows([]);
        return;
      }
      const [{ data: meetups }, { data: checks }] = await Promise.all([
        supabase
          .from('meetups')
          .select('id, connection_id, status, proposed_date, confirmed_date, start_time, place, activity, proposed_by, created_at')
          .in('status', ['proposed', 'confirmed'])
          .order('created_at', { ascending: false }),
        supabase
          .from('connection_interventions')
          .select('connection_id, payload')
          .eq('intervention_type', 'meetup_occurrence_check')
          .eq('status', 'pending')
          .eq('target_user_id', user.id),
      ]);
      if (cancelled) return;

      const today = toIsoDate(new Date());
      const tomorrowDate = new Date();
      tomorrowDate.setDate(tomorrowDate.getDate() + 1);
      const tomorrow = toIsoDate(tomorrowDate);
      const next: Row[] = [];
      const seen = new Set<string>();

      for (const c of (checks ?? []) as { connection_id: string; payload: Record<string, unknown> }[]) {
        const name = names.get(c.connection_id);
        const date = c.payload?.confirmed_date as string | undefined;
        if (!name || !date || seen.has(`check:${c.connection_id}`)) continue;
        seen.add(`check:${c.connection_id}`);
        next.push({
          connectionId: c.connection_id,
          name,
          date,
          startTime: (c.payload?.start_time as string | null) ?? null,
          place: (c.payload?.place as string | null) ?? null,
          activity: null,
          tag: 'How did it go?',
          highlight: true,
          order: 0,
        });
      }

      for (const m of (meetups ?? []) as MeetupRow[]) {
        const name = names.get(m.connection_id);
        const date = m.confirmed_date ?? m.proposed_date;
        if (!name || date < today || seen.has(m.connection_id)) continue;
        seen.add(m.connection_id);
        let tag: string;
        let highlight = false;
        if (m.status === 'proposed') {
          if (m.proposed_by === user.id) {
            tag = `Waiting for ${name}`;
          } else {
            tag = 'Waiting for you';
            highlight = true;
          }
        } else if (date === today) {
          tag = 'Today';
          highlight = true;
        } else if (date === tomorrow) {
          tag = 'Tomorrow';
        } else {
          tag = 'Confirmed';
        }
        next.push({
          connectionId: m.connection_id,
          name,
          date,
          startTime: m.start_time ? m.start_time.slice(0, 5) : null,
          place: m.place,
          activity: m.activity,
          tag,
          highlight,
          order: 1,
        });
      }

      next.sort((a, b) => a.order - b.order || a.date.localeCompare(b.date));
      setRows(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [names, refreshKey]);

  if (rows.length === 0) return null;

  return (
    <View className="gap-3">
      <Text className="text-caption font-semibold uppercase text-stone-400 dark:text-stone-600">Coming up</Text>
      {rows.map((r) => (
        <Pressable
          key={`${r.connectionId}-${r.order}`}
          onPress={() => router.push({ pathname: '/thread/[id]', params: { id: r.connectionId } })}
          className="flex-row items-center justify-between gap-3 rounded-2xl border border-accent-500/30 bg-accent-500/5 p-4 active:opacity-80">
          <View className="flex-1 gap-0.5">
            <Text className="text-body font-semibold text-stone-900 dark:text-stone-50">
              {formatWhen(r.date, r.startTime)} · {r.name}
            </Text>
            {(r.place || r.activity) && (
              <Text numberOfLines={1} className="text-caption text-stone-500 dark:text-stone-400">
                {[r.activity, r.place].filter(Boolean).join(' at ')}
              </Text>
            )}
          </View>
          <View
            className={`rounded-full px-3 py-1 ${
              r.highlight ? 'bg-accent-500' : 'border border-stone-300 dark:border-stone-600'
            }`}>
            <Text
              className={`text-caption font-semibold ${
                r.highlight ? 'text-white' : 'text-stone-600 dark:text-stone-300'
              }`}>
              {r.tag}
            </Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}
