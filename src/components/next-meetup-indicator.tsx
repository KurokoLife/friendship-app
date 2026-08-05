import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { formatMeetupDate, parseMeetupDate } from '@/lib/remember';
import {
  confirmNextMeetup,
  proposeNextMeetup,
  type NextMeetupStatus,
} from '@/lib/meetup-milestones';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400

type Props = {
  connectionId: string;
  myId: string;
  otherName: string;
  status: NextMeetupStatus;
  onChanged: () => void;
};

// Same y/m/d-component construction as remember/[connectionId].tsx's own
// dateLabel fix (item 2, this same session), never new Date(isoString)
// on a plain date-only value, which JS parses as UTC midnight and would
// display one day early for any US timezone.
function formatDisplayDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

// Persistent, always-visible regardless of how the date got there
// (direct propose, a reschedule, or auto-proposed by "Let's plan
// something", see thread/[id].tsx's own handlePlanSomething). Lightweight
// on purpose: propose is one text field, confirm is one tap, matching
// the given "kept deliberately lightweight given a real, stated 50%+
// reschedule rate" reasoning, this is meant to be revised often without
// friction, not a formal calendar invite.
export function NextMeetupIndicator({ connectionId, myId, otherName, status, onChanged }: Props) {
  const [editing, setEditing] = useState(false);
  const [dateText, setDateText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const startEdit = () => {
    setDateText(status.date ?? '');
    setError(null);
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setError(null);
  };

  const handlePropose = async () => {
    const parsed = parseMeetupDate(dateText);
    if (parsed === undefined) {
      setError('Enter the date as YYYY-MM-DD.');
      return;
    }
    if (!parsed) {
      setError('Pick a date.');
      return;
    }
    // Opposite direction from Remember's own meetup_date check
    // (past-only, a record of what happened): this is something being
    // planned, so it must be today or later. Compared using the same
    // local y/m/d construction as parseMeetupDate itself, no UTC
    // round-trip.
    const today = new Date();
    const todayLocal = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (parsed.getTime() < todayLocal.getTime()) {
      setError("That date has already passed. Pick today or later.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await proposeNextMeetup(connectionId, formatMeetupDate(parsed));
      setEditing(false);
      onChanged();
    } catch {
      setError("Couldn't save that date. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const handleConfirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await confirmNextMeetup(connectionId);
      onChanged();
    } catch {
      setError("Couldn't confirm right now. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <View className="mx-6 mt-4 gap-2 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
        <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">
          {status.date ? 'Reschedule' : 'Propose a date'}
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
          <Pressable onPress={cancelEdit} disabled={busy}>
            <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">Cancel</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (!status.date || !status.status) {
    return (
      <View className="mx-6 mt-4 flex-row items-center justify-between gap-2 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
        <Text className="text-caption text-stone-400 dark:text-stone-600">No meetup planned yet</Text>
        <Pressable onPress={startEdit}>
          <Text className="text-caption font-semibold text-accent-500">Propose a date</Text>
        </Pressable>
      </View>
    );
  }

  const iAmProposer = status.proposedBy === myId;
  const label = formatDisplayDate(status.date);

  if (status.status === 'proposed') {
    return (
      <View className="mx-6 mt-4 gap-2 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
        {error && <Text className="text-caption text-red-600 dark:text-red-400">{error}</Text>}
        <Text className="text-caption text-stone-500 dark:text-stone-400">
          {iAmProposer
            ? `You proposed ${label}. Waiting for ${otherName} to confirm.`
            : `${otherName} proposed ${label}.`}
        </Text>
        <View className="flex-row items-center gap-4">
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
          <Pressable onPress={startEdit} disabled={busy}>
            <Text className="text-caption font-semibold text-accent-500">Propose a different date</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View className="mx-6 mt-4 flex-row items-center justify-between gap-2 rounded-2xl border border-accent-500/40 bg-accent-500/5 p-4">
      <Text className="text-caption text-stone-700 dark:text-stone-300">Next meetup: {label}</Text>
      <Pressable onPress={startEdit}>
        <Text className="text-caption font-semibold text-accent-500">Reschedule</Text>
      </Pressable>
    </View>
  );
}
