import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { getSeenCoachMarks, markCoachMarkSeen } from '@/lib/coach-marks';
import { cancelMeetup, confirmMeetup, proposeMeetup } from '@/lib/friendship-journey';
import { supabase } from '@/lib/supabase';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400

type Props = {
  connectionId: string;
  myId: string;
  otherName: string;
  onChanged: () => void;
  // 2026-08-12 correction: at most one Limen video guidance offer may be
  // visible at once. Rather than a shared resolver/priority engine, this
  // component just reports upward whenever ITS OWN video_first_meetup offer
  // becomes visible; thread/[id].tsx uses that single boolean to skip
  // rendering VideoGuidanceCard entirely while true. No trigger condition,
  // seen-state, or placement here changed -- only whether a SEPARATE
  // sibling component is allowed to also show something.
  onVideoOfferChange?: (active: boolean) => void;
};

type ActiveMeetup = { id: string; proposed_date: string; proposed_by: string; status: 'proposed' | 'confirmed' };

function formatDisplayDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

// Part 2 of tonight's consolidated build: which meetup number a real
// person is looking at, "1st"/"2nd"/"3rd"/"4th"/... English ordinals, no
// library needed for a small, bounded range.
function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

// Friendship Journey rebuild -- the new-system equivalent of NextMeetupIndicator,
// reading from the new `meetups` table instead of connections.next_meetup_date
// (the old system's field, untouched).
//
// Part 2 of tonight's consolidated build: this is now the SINGLE, unified
// meetup scheduling card -- propose, confirm, cancel, propose a different
// date, all in one place. It absorbed what used to be a second, separate
// card (PrimaryInterventionCard's own meetup_confirm_needed, computed by
// get_active_intervention), which independently surfaced the identical
// "confirm this date" moment and produced a real, live-reproduced
// duplicate-card bug (both cards visible for the non-proposer at once).
// get_active_intervention no longer ever returns meetup_confirm_needed
// (20260902000000), so this component is now the only place a meetup
// proposal is ever shown or acted on. Deliberately still OUTSIDE the
// priority queue, unconditionally rendered, never forced -- the
// non-proposer can simply leave it alone with no consequence, exactly
// like every other ambient state this card already handled.
export function NextMeetupIndicatorV2({ connectionId, myId, otherName, onChanged, onVideoOfferChange }: Props) {
  const [active, setActive] = useState<ActiveMeetup | null>(null);
  // Part 2: the connection's real, mutually-confirmed meetup count
  // (connections.meetup_count, incremented only by bump_meetup_count_on_
  // occurred when a meetup genuinely resolves as occurred), fetched
  // alongside the active meetup row so "this would be your Nth meetup"
  // is always real, live data, never a guess or a client-side counter.
  const [meetupCount, setMeetupCount] = useState(0);
  const [editing, setEditing] = useState(false);
  const [dateText, setDateText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showFirstMeetupOffer, setShowFirstMeetupOffer] = useState(false);

  const load = async () => {
    const [{ data }, { data: conn }] = await Promise.all([
      supabase
        .from('meetups')
        .select('id, proposed_date, proposed_by, status')
        .eq('connection_id', connectionId)
        .in('status', ['proposed', 'confirmed'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from('connections').select('meetup_count').eq('id', connectionId).maybeSingle(),
    ]);
    const row = (data as ActiveMeetup | null) ?? null;
    setActive(row);
    setMeetupCount((conn?.meetup_count as number | undefined) ?? 0);

    if (row?.status === 'confirmed') {
      const seen = await getSeenCoachMarks();
      if (!seen.has('video_first_meetup')) {
        const { count } = await supabase
          .from('meetups')
          .select('id', { count: 'exact', head: true })
          .eq('connection_id', connectionId)
          .in('status', ['confirmed', 'occurred']);
        setShowFirstMeetupOffer((count ?? 0) <= 1);
      } else {
        setShowFirstMeetupOffer(false);
      }
    } else {
      setShowFirstMeetupOffer(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId]);

  useEffect(() => {
    onVideoOfferChange?.(showFirstMeetupOffer);
  }, [showFirstMeetupOffer, onVideoOfferChange]);

  const dismissFirstMeetupOffer = async () => {
    await markCoachMarkSeen('video_first_meetup');
    setShowFirstMeetupOffer(false);
  };

  const handlePropose = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
      setError('Enter the date as YYYY-MM-DD.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await proposeMeetup(connectionId, dateText);
      setEditing(false);
      await load();
      onChanged();
    } catch {
      setError("Couldn't save that date. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const handleConfirm = async () => {
    if (!active) return;
    setBusy(true);
    try {
      await confirmMeetup(active.id);
      await load();
      onChanged();
    } catch {
      setError("Couldn't confirm right now. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  // Part 2: the real "cancel" action, calling the same cancel_meetup RPC
  // the old meetup_confirm_needed card's "Not this time" used to call, now
  // folded into this one unified card instead of a second competing one.
  // Available to either participant, matching cancel_meetup's own
  // permissions (any real participant, not proposer-only).
  const handleCancel = async () => {
    if (!active) return;
    setBusy(true);
    setError(null);
    try {
      await cancelMeetup(active.id);
      await load();
      onChanged();
    } catch {
      setError("Couldn't cancel right now. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const nextMeetupOrdinal = ordinal(meetupCount + 1);

  if (editing) {
    return (
      <View className="mx-6 mt-4 gap-2 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
        <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">
          {active ? 'Reschedule' : `Proposing your ${nextMeetupOrdinal} meetup`}
        </Text>
        {error && <Text className="text-caption text-red-600 dark:text-red-400">{error}</Text>}
        <TextInput
          value={dateText}
          onChangeText={setDateText}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={MUTED_ICON_COLOR}
          autoCapitalize="none"
          editable={!busy}
          className="rounded-xl border border-stone-300 px-3 py-2 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
        />
        <View className="flex-row items-center gap-4">
          <Pressable
            onPress={handlePropose}
            disabled={busy}
            className={`rounded-full bg-stone-900 px-4 py-2 active:opacity-80 dark:bg-stone-50 ${busy ? 'opacity-40' : ''}`}>
            <Text className="text-caption font-semibold text-stone-50 dark:text-stone-900">
              {busy ? 'Saving...' : 'Save'}
            </Text>
          </Pressable>
          <Pressable onPress={() => setEditing(false)} disabled={busy}>
            <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">Cancel</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (!active) {
    return (
      <View className="mx-6 mt-4 flex-row items-center justify-between gap-2 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
        <Text className="text-caption text-stone-400 dark:text-stone-600">No meetup planned yet</Text>
        <Pressable
          onPress={() => {
            setDateText('');
            setError(null);
            setEditing(true);
          }}>
          <Text className="text-caption font-semibold text-accent-500">Propose a date</Text>
        </Pressable>
      </View>
    );
  }

  const iAmProposer = active.proposed_by === myId;
  const label = formatDisplayDate(active.proposed_date);

  if (active.status === 'proposed') {
    return (
      <View className="mx-6 mt-4 gap-2 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
        {/* Part 2: real meetup-number framing, using connections.meetup_count
            (the connection's real, mutually-confirmed count), not a guess. */}
        <Text className="text-caption font-semibold text-stone-400 dark:text-stone-600">
          Proposing your {nextMeetupOrdinal} meetup
        </Text>
        {error && <Text className="text-caption text-red-600 dark:text-red-400">{error}</Text>}
        <Text className="text-caption text-stone-500 dark:text-stone-400">
          {iAmProposer ? `You proposed ${label}. Waiting for ${otherName} to confirm.` : `${otherName} proposed ${label}.`}
        </Text>
        <View className="flex-row flex-wrap items-center gap-4">
          {!iAmProposer && (
            <Pressable
              onPress={handleConfirm}
              disabled={busy}
              className={`rounded-full bg-stone-900 px-4 py-2 active:opacity-80 dark:bg-stone-50 ${busy ? 'opacity-40' : ''}`}>
              <Text className="text-caption font-semibold text-stone-50 dark:text-stone-900">
                {busy ? 'Confirming...' : 'Confirm'}
              </Text>
            </Pressable>
          )}
          <Pressable onPress={() => { setDateText(active.proposed_date); setEditing(true); }} disabled={busy}>
            <Text className="text-caption font-semibold text-accent-500">Propose a different date</Text>
          </Pressable>
          <Pressable onPress={handleCancel} disabled={busy}>
            <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">
              {busy ? 'Cancelling...' : 'Cancel'}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View className="mx-6 mt-4 gap-2 rounded-2xl border border-accent-500/40 bg-accent-500/5 p-4">
      <View className="flex-row items-center justify-between gap-2">
        <Text className="text-caption text-stone-700 dark:text-stone-300">Next meetup: {label}</Text>
        <Pressable onPress={() => { setDateText(active.proposed_date); setEditing(true); }}>
          <Text className="text-caption font-semibold text-accent-500">Reschedule</Text>
        </Pressable>
      </View>
      {/* Optional, secondary, dismissible -- never blocks confirming or
          rescheduling above, matching "action first, optional video
          guidance second." */}
      {showFirstMeetupOffer && (
        <View className="flex-row flex-wrap items-center gap-3 border-t border-accent-500/20 pt-2">
          <Text className="text-caption text-stone-500 dark:text-stone-400">
            First meetup coming up? A short guide if it helps.
          </Text>
          <Pressable
            onPress={() => {
              dismissFirstMeetupOffer();
              router.push({ pathname: '/guide/[id]', params: { id: 'guide_meetup_anxiety' } });
            }}>
            <Text className="text-caption font-semibold text-accent-500">Watch</Text>
          </Pressable>
          <Pressable onPress={dismissFirstMeetupOffer}>
            <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">Not now</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
