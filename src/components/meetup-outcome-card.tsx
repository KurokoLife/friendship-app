import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { MicPlaceholderButton } from '@/components/mic-placeholder-button';
import { UniversalTextBox } from '@/components/universal-text-box';
import { endConnectionWithMessage, HONEST_EXIT_SENDER_TEXT, pauseConnection } from '@/lib/no-ghost';
import { supabase } from '@/lib/supabase';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400

type Props = {
  connectionId: string;
  senderId: string;
  otherName: string;
  branch: 'good' | 'not_good';
  onOpenActivitySuggestions: () => void;
  onResolved: () => void;
  // "Not now" on the not_good branch: a local, session-only dismiss, not a
  // server write (unlike onResolved, which follows a real state change,
  // e.g. Pause). Distinct from onResolved so a bare "hide this for now"
  // tap can never be mistaken for one of the real resolving actions.
  onDismiss: () => void;
  // Called instead of onResolved when the message just sent was a real
  // honest exit, ending the connection. Mirrors
  // ConversationFlowPromptCard's own onExitConfirmed prop exactly: the
  // caller (thread/[id].tsx) uses this to reload connection status and
  // keep the "Choosing honesty over silence..." confirmation visible at
  // the screen level, since this card would otherwise unmount the moment
  // the outer "connection isn't ended" gate reacts to the status change.
  onExitConfirmed?: () => void;
};

// Shown once a meetup checkin is mutually confirmed (get_meetup_checkin_
// status's own branch field), replacing the old F25 day-of/cancellation
// flow's post-meetup piece. Good branch reuses the existing 3-category
// activity engine for a fresh idea rather than building a new one.
// Remember now has a real home in the app (src/app/remember/[connectionId].tsx),
// so the aside below is a real link, not a dead one. Not-good branch reuses
// Pause and Honest Exit exactly as already built (pauseConnection,
// HONEST_EXIT_SENDER_TEXT), the same compose pattern R2/R3's own exit
// option already uses (blank field, UniversalTextBox, edit required
// before Send).
export function MeetupOutcomeCard({ connectionId, senderId, otherName, branch, onOpenActivitySuggestions, onResolved, onDismiss, onExitConfirmed }: Props) {
  const [exitMode, setExitMode] = useState(false);
  const [draft, setDraft] = useState('');
  const [edited, setEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [exitConfirmed, setExitConfirmed] = useState(false);

  const handleDraftChange = (text: string) => {
    setDraft(text);
    setEdited(true);
  };

  const handlePause = async () => {
    setBusy(true);
    await pauseConnection(connectionId);
    setBusy(false);
    onResolved();
  };

  const handleSendExit = async () => {
    if (!edited || !draft.trim() || busy) return;
    setBusy(true);
    // Real action, not just a message: end_connection_with_message
    // atomically sends this text and flips the connection's own status to
    // 'ended', matching the identical fix on the no-ghost escalation
    // card's own exit path (ConversationFlowPromptCard).
    await endConnectionWithMessage(connectionId, { content: draft.trim() });
    setBusy(false);
    setExitConfirmed(true);
    onExitConfirmed?.();
  };

  if (exitConfirmed) {
    return (
      <View className="gap-2 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
        <Text className="text-body text-stone-700 dark:text-stone-300">{HONEST_EXIT_SENDER_TEXT}</Text>
      </View>
    );
  }

  if (branch === 'good') {
    return (
      <View className="gap-3 rounded-2xl border border-accent-500/40 bg-accent-500/5 p-4">
        <Text className="text-body text-stone-800 dark:text-stone-200">
          Sounds like it went well. What matters more than meeting up again right away is doing it consistently
          over time, that&apos;s what actually builds a friendship.
        </Text>
        <Pressable
          onPress={() => router.push({ pathname: '/remember/[connectionId]', params: { connectionId } })}
          className="self-start rounded-full border border-accent-500 bg-accent-500/10 px-4 py-2 active:opacity-80">
          <Text className="text-caption font-semibold text-accent-500">Keep a note of how it went</Text>
        </Pressable>
        <Text className="text-caption text-stone-500 dark:text-stone-400">Planning another hangout?</Text>
        <Pressable
          onPress={onOpenActivitySuggestions}
          className="self-start rounded-full bg-stone-900 px-4 py-2 active:opacity-80 dark:bg-stone-50">
          <Text className="text-caption font-semibold text-stone-50 dark:text-stone-900">Get a fresh idea</Text>
        </Pressable>
      </View>
    );
  }

  // not_good
  if (exitMode) {
    return (
      <View className="gap-3 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
        <Text className="text-body text-stone-700 dark:text-stone-300">
          Write what you want to say. You can edit it as much as you want before sending.
        </Text>
        <View className="relative">
          <TextInput
            value={draft}
            onChangeText={handleDraftChange}
            onFocus={() => setEdited(true)}
            placeholder="Write what you want to say"
            placeholderTextColor={MUTED_ICON_COLOR}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            className="min-h-24 rounded-xl border border-stone-300 px-3 py-3 pr-12 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
          />
          <MicPlaceholderButton />
        </View>
        <UniversalTextBox value={draft} onChangeText={handleDraftChange} context="exit" checkEnabled={false} disabled={busy} />
        <View className="flex-row items-center gap-3">
          <Pressable
            onPress={handleSendExit}
            disabled={busy || !edited || !draft.trim()}
            className={`self-start rounded-full bg-stone-900 px-4 py-2 active:opacity-80 dark:bg-stone-50 ${
              busy || !edited || !draft.trim() ? 'opacity-40' : ''
            }`}>
            <Text className="text-caption font-semibold text-stone-50 dark:text-stone-900">Send</Text>
          </Pressable>
          <Pressable onPress={() => setExitMode(false)} disabled={busy}>
            <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">Back</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View className="gap-3 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
      <Text className="text-body text-stone-700 dark:text-stone-300">
        That&apos;s worth noticing, not judging. You can pause for now, or if this connection genuinely isn&apos;t
        working, an honest ending is always the better option here.
      </Text>
      <Pressable
        onPress={() => router.push({ pathname: '/remember/[connectionId]', params: { connectionId } })}
        className="self-start rounded-full border border-accent-500 bg-accent-500/10 px-4 py-2 active:opacity-80">
        <Text className="text-caption font-semibold text-accent-500">Keep a note about what happened</Text>
      </Pressable>
      <View className="flex-row flex-wrap gap-2">
        <Pressable
          onPress={handlePause}
          disabled={busy}
          className="rounded-full border border-stone-300 px-4 py-2 dark:border-stone-700">
          <Text className="text-caption font-semibold text-stone-600 dark:text-stone-300">
            {busy ? 'Pausing...' : 'Pause'}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setExitMode(true)}
          disabled={busy}
          className="rounded-full border border-stone-300 px-4 py-2 dark:border-stone-700">
          <Text className="text-caption font-semibold text-stone-600 dark:text-stone-300">End the connection</Text>
        </Pressable>
        <Pressable onPress={onDismiss} disabled={busy} className="rounded-full border border-stone-300 px-4 py-2 dark:border-stone-700">
          <Text className="text-caption font-semibold text-stone-600 dark:text-stone-300">Not now</Text>
        </Pressable>
      </View>
    </View>
  );
}
