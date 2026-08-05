import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { BlockConfirmModal } from '@/components/block-confirm-modal';
import { MicPlaceholderButton } from '@/components/mic-placeholder-button';
import { DraftServiceError, UniversalTextBox } from '@/components/universal-text-box';
import {
  CONVERSATION_IDENTITY_MIRROR,
  dismissPrompt,
  endConnectionWithMessage,
  isSenderTrigger,
  pauseConnection,
  R_PERSPECTIVE_SHIFT,
  RECEIVER_ESCALATION_OPTIONS,
  resolveNoGhostPromptWithMessage,
  setConnectionInactive,
  triggerAwarenessText,
  type NoGhostPrompt,
  type ReceiverEscalationOptionKey,
} from '@/lib/no-ghost';
import { supabase } from '@/lib/supabase';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400

type ContextMessage = { sender: 'me' | 'them'; content: string };

type Props = {
  prompt: NoGhostPrompt;
  otherName: string;
  otherId: string;
  viewerId: string;
  connectionId: string;
  recentMessages: ContextMessage[];
  onResolved: () => void;
  // Called instead of onResolved when the message just sent was a real
  // honest exit. The caller (thread/[id].tsx) uses this to keep the
  // "Choosing honesty over silence..." confirmation visible at the
  // screen level, since this card unmounts the moment its own realtime
  // message subscription clears the active prompt, before its local
  // exitConfirmed render would otherwise get a chance to show.
  onExitConfirmed?: () => void;
  // Block, reachable from an active prompt card independent of the R2/R3
  // escalation choices or the S1/R1 compose flow, per Honest Exit's own
  // established precedent that a genuine safety concern should be able to
  // bypass any explanation requirement entirely. Called after a real
  // block_user() write, the caller (thread/[id].tsx) re-reads connection
  // status and takes it from there, this card doesn't need to know what
  // happens next.
  onBlocked?: () => void;
};

// Fix #2: rebuilt for the blueprint Section 10 timeline. Renders a
// genuinely different shape per trigger: R2/R3 get the three-choice
// escalation (Reply / Pause / End the connection), Pause now being a
// real, immediate state change rather than a drafted message; R1/S1
// share the single "Help me write" compose flow the rest of this app's
// message-assistance features already use.
export function ConversationFlowPromptCard({
  prompt,
  otherName,
  otherId,
  viewerId,
  connectionId,
  recentMessages,
  onResolved,
  onExitConfirmed,
  onBlocked,
}: Props) {
  const [blockConfirmVisible, setBlockConfirmVisible] = useState(false);
  const [draft, setDraftRaw] = useState('');
  // Bug A/D fix: text sent from this card must be visibly shown and
  // reviewed before Send enables, same rule this app already enforces in
  // ReplyAssistPanel and meetup-cancel/[id].tsx (Honest Exit's own
  // compose steps). A freshly AI-drafted or canned-option value starts
  // unedited; the visible TextInput's own onChangeText/onFocus is what
  // flips this, proving the user actually saw the field, not just that
  // a value exists in state.
  const [draftEdited, setDraftEdited] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selectedOption, setSelectedOption] = useState<ReceiverEscalationOptionKey | null>(null);
  const [exitConfirmed, setExitConfirmed] = useState(false);

  const isSender = isSenderTrigger(prompt.trigger_id);
  const awareness = triggerAwarenessText(prompt.trigger_id);

  // Matches ReplyAssistPanel's own handleChange: used as the onChangeText
  // for both the visible TextInput and UniversalTextBox, so an AI draft
  // landing in the field (via UniversalTextBox's own "Help me write" flow)
  // marks it seen the same way a real keystroke would, since either way
  // the text is now on screen in front of the user, not hidden.
  const handleDraftChange = (text: string) => {
    setDraftRaw(text);
    setDraftEdited(true);
  };

  const requestDraft = async (situation: string, purpose: string): Promise<string> => {
    const { data, error } = await supabase.functions.invoke('generate-reply-draft', {
      body: { rawInput: situation, recentMessages, purpose },
    });
    if (error) throw error;
    if (data?.blocked) throw new DraftServiceError(data.message as string);
    if (data?.error) throw new DraftServiceError(data.error as string);
    if (!data?.draft) throw new Error('No draft returned');
    return data.draft as string;
  };

  const handleDismiss = async () => {
    setBusy(true);
    await dismissPrompt(prompt.id);
    setBusy(false);
    onResolved();
  };

  const handleSetInactive = async () => {
    setBusy(true);
    await setConnectionInactive(connectionId, prompt.id);
    setBusy(false);
    onResolved();
  };

  const handlePause = async () => {
    setBusy(true);
    await pauseConnection(connectionId, prompt.id);
    setBusy(false);
    onResolved();
  };

  const handleSendFreeform = async (messageType: 'text' | 'honest_exit') => {
    if (!draftEdited || !draft.trim() || busy) return;
    setBusy(true);
    await resolveNoGhostPromptWithMessage(prompt, connectionId, viewerId, draft.trim(), messageType);
    setBusy(false);
    if (messageType === 'honest_exit') {
      setExitConfirmed(true);
      onExitConfirmed?.();
      return;
    }
    onResolved();
  };

  // AI philosophy fix: this used to pre-fill a canned message the
  // instant an option was picked, which is the same violation as the
  // sender-side draft flow, an AI/canned version standing in for the
  // user's own words with no real choice attached. The field now starts
  // blank; the user types their own reply directly, or taps "Help me
  // write" below if they want AI help, exactly like the S1/R1 flow.
  const handlePickEscalationOption = (option: (typeof RECEIVER_ESCALATION_OPTIONS)[number]) => {
    setSelectedOption(option.key);
    setDraftRaw('');
    setDraftEdited(false);
  };

  const handleSendEscalation = async () => {
    if (!selectedOption || !draftEdited || !draft.trim() || busy) return;
    setBusy(true);
    if (selectedOption === 'exit') {
      // Real action, not just a message: end_connection_with_message
      // atomically sends this text and flips the connection's own status
      // to 'ended', which is what actually stops messaging and clears
      // this very prompt (via the clear_prompts_on_connection_closed
      // trigger), not a separate, skippable follow-up step.
      await endConnectionWithMessage(connectionId, { content: draft.trim() });
      setBusy(false);
      setExitConfirmed(true);
      onExitConfirmed?.();
      return;
    }
    await resolveNoGhostPromptWithMessage(prompt, connectionId, viewerId, draft.trim(), 'text');
    setBusy(false);
    onResolved();
  };

  if (exitConfirmed) {
    return (
      <View className="gap-2 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
        <Text className="text-body text-stone-700 dark:text-stone-300">
          Choosing honesty over silence takes real courage. That&apos;s what genuine care looks like.
        </Text>
      </View>
    );
  }

  // R2, R3: shared shape, "Reply, Pause or [consider Honest Exit / End]"
  // per the blueprint's own 72h/120h copy.
  if (prompt.trigger_id === 'R2' || prompt.trigger_id === 'R3') {
    return (
      <View className="gap-3 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
        <Text className="text-body text-stone-700 dark:text-stone-300">{awareness}</Text>
        <Text className="text-body text-stone-600 dark:text-stone-400">{R_PERSPECTIVE_SHIFT}</Text>
        <Text className="text-body font-medium text-stone-800 dark:text-stone-200">
          {CONVERSATION_IDENTITY_MIRROR}
        </Text>
        <View className="flex-row flex-wrap gap-2">
          <Pressable
            onPress={() => handlePickEscalationOption(RECEIVER_ESCALATION_OPTIONS[0])}
            disabled={busy}
            className={`rounded-full border px-4 py-2 ${
              selectedOption === 'reply'
                ? 'border-stone-900 bg-stone-900 dark:border-stone-50 dark:bg-stone-50'
                : 'border-stone-300 dark:border-stone-700'
            }`}>
            <Text
              className={`text-caption font-semibold ${
                selectedOption === 'reply' ? 'text-stone-50 dark:text-stone-900' : 'text-stone-600 dark:text-stone-300'
              }`}>
              Reply
            </Text>
          </Pressable>
          <Pressable
            onPress={handlePause}
            disabled={busy}
            className="rounded-full border border-stone-300 px-4 py-2 dark:border-stone-700">
            <Text className="text-caption font-semibold text-stone-600 dark:text-stone-300">
              {busy ? 'Pausing...' : 'Pause'}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => handlePickEscalationOption(RECEIVER_ESCALATION_OPTIONS[1])}
            disabled={busy}
            className={`rounded-full border px-4 py-2 ${
              selectedOption === 'exit'
                ? 'border-stone-900 bg-stone-900 dark:border-stone-50 dark:bg-stone-50'
                : 'border-stone-300 dark:border-stone-700'
            }`}>
            <Text
              className={`text-caption font-semibold ${
                selectedOption === 'exit' ? 'text-stone-50 dark:text-stone-900' : 'text-stone-600 dark:text-stone-300'
              }`}>
              End the connection
            </Text>
          </Pressable>
          {/* Block, reachable directly from an active R2/R3 prompt,
              independent of Reply/Pause/End: a safety concern can arise
              at any point in a conversation, it shouldn't have to wait
              for the main Chat screen's own header action. Same
              lightweight confirm as everywhere else Block appears, no
              explanation required, per Honest Exit's own established
              "safety concerns bypass explanation" precedent. */}
          <Pressable
            onPress={() => setBlockConfirmVisible(true)}
            disabled={busy}
            className="rounded-full border border-red-300 px-4 py-2 dark:border-red-800">
            <Text className="text-caption font-semibold text-red-600 dark:text-red-400">Block</Text>
          </Pressable>
        </View>
        {selectedOption && (
          <View className="gap-2">
            <View className="relative">
              <TextInput
                value={draft}
                onChangeText={handleDraftChange}
                onFocus={() => setDraftEdited(true)}
                placeholder="Write what you want to say"
                placeholderTextColor={MUTED_ICON_COLOR}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
                className="min-h-24 rounded-xl border border-stone-300 px-3 py-3 pr-12 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
              />
              <MicPlaceholderButton />
            </View>
            <UniversalTextBox
              value={draft}
              onChangeText={handleDraftChange}
              onRequestDraft={async (situation) => {
                setDrafting(true);
                try {
                  return await requestDraft(
                    situation,
                    selectedOption === 'exit'
                      ? 'write a short, honest, respectful message to end this connection'
                      : 'write a short, warm reply to catch up after being slow to respond'
                  );
                } finally {
                  setDrafting(false);
                }
              }}
              disabled={drafting}
            />
            {!draftEdited && draft.trim().length > 0 && (
              <Text className="text-caption text-stone-400 dark:text-stone-600">
                Edit the draft before sending, make it your own.
              </Text>
            )}
            <Pressable
              onPress={handleSendEscalation}
              disabled={busy || !draftEdited || !draft.trim()}
              className={`self-start rounded-full bg-stone-900 px-4 py-2 active:opacity-80 dark:bg-stone-50 ${
                busy || !draftEdited || !draft.trim() ? 'opacity-40' : ''
              }`}>
              <Text className="text-caption font-semibold text-stone-50 dark:text-stone-900">Send</Text>
            </Pressable>
          </View>
        )}
        <BlockConfirmModal
          visible={blockConfirmVisible}
          onClose={() => setBlockConfirmVisible(false)}
          onBlocked={() => {
            setBlockConfirmVisible(false);
            onBlocked?.();
          }}
          blockedId={otherId}
          otherName={otherName}
        />
      </View>
    );
  }

  // S1, R1: single "Help me write" flow (live Claude draft from a brief
  // user-described situation).
  const draftPurpose =
    prompt.trigger_id === 'S1'
      ? 'write a short, honest, respectful message to close out this connection, or a brief warm follow-up if they would rather keep waiting'
      : 'write a short, warm reply to a friend whose message has been waiting a little while';

  return (
    <View className="gap-3 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
      <Text className="text-body text-stone-700 dark:text-stone-300">{awareness}</Text>

      {/* Always visible, not gated on having content: the user now types
          their situation description directly into this same field when
          using "Help me write" below (single-box pattern), so it has to
          be here to type into before any content exists, not just after. */}
      <View className="relative">
        <TextInput
          value={draft}
          onChangeText={handleDraftChange}
          onFocus={() => setDraftEdited(true)}
          placeholder="Write what you want to say, or use Help me write below"
          placeholderTextColor={MUTED_ICON_COLOR}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
          className="min-h-24 rounded-xl border border-stone-300 px-3 py-3 pr-12 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
        />
        <MicPlaceholderButton />
      </View>

      <UniversalTextBox
        value={draft}
        onChangeText={handleDraftChange}
        onRequestDraft={async (situation) => {
          setDrafting(true);
          try {
            return await requestDraft(situation, draftPurpose);
          } finally {
            setDrafting(false);
          }
        }}
        // Rename, S1 (sender, 125h) only: "Help Me Write" instead of the
        // default "Draft it", for consistency with the rest of this
        // specific flow. R1 keeps the default label, not part of this
        // rename's stated scope.
        draftActionLabel={prompt.trigger_id === 'S1' ? 'Help Me Write' : undefined}
        disabled={drafting}
      />

      {!draftEdited && draft.trim().length > 0 && (
        <Text className="text-caption text-stone-400 dark:text-stone-600">
          Edit the draft before sending, make it your own.
        </Text>
      )}

      {draft.trim().length > 0 && (
        <Pressable
          onPress={() => handleSendFreeform('text')}
          disabled={busy || !draftEdited || !draft.trim()}
          className={`self-start rounded-full bg-stone-900 px-4 py-2 active:opacity-80 dark:bg-stone-50 ${
            busy || !draftEdited || !draft.trim() ? 'opacity-40' : ''
          }`}>
          <Text className="text-caption font-semibold text-stone-50 dark:text-stone-900">Send</Text>
        </Pressable>
      )}

      {/* Bug B fix: these are real, always-clickable actions independent
          of the draft/compose flow above (a user can pick either without
          ever touching "Help me write"), but the old plain-text-link
          styling with no border/pill made them visually indistinguishable
          from disabled controls, and the "Closing archives..." caption
          right below used the same muted color and read as a third,
          silently-broken option. Now styled like every other secondary
          action in this app (bordered pill, matching R2/R3's Pause
          button), and the caption is pushed clearly below/outside the
          button row with lighter, non-bold, italic styling so it can't be
          mistaken for a third pressable. */}
      <View className="flex-row flex-wrap gap-2 pt-1">
        {prompt.trigger_id === 'S1' && (
          <Pressable
            onPress={handleSetInactive}
            disabled={busy}
            className="rounded-full border border-stone-300 px-4 py-2 dark:border-stone-700">
            <Text className="text-caption font-semibold text-stone-600 dark:text-stone-300">
              {busy ? 'Closing...' : 'Close and make room for another'}
            </Text>
          </Pressable>
        )}
        <Pressable
          onPress={handleDismiss}
          disabled={busy}
          className="rounded-full border border-stone-300 px-4 py-2 dark:border-stone-700">
          <Text className="text-caption font-semibold text-stone-600 dark:text-stone-300">
            {prompt.trigger_id === 'S1' ? (busy ? 'Waiting...' : 'Keep waiting') : busy ? 'Dismissing...' : 'Dismiss'}
          </Text>
        </Pressable>
        {/* Block, reachable directly from S1/R1 too, same reasoning as
            R2/R3 above: a safety concern doesn't wait for a specific
            checkpoint to arrive. */}
        <Pressable
          onPress={() => setBlockConfirmVisible(true)}
          disabled={busy}
          className="rounded-full border border-red-300 px-4 py-2 dark:border-red-800">
          <Text className="text-caption font-semibold text-red-600 dark:text-red-400">Block</Text>
        </Pressable>
      </View>
      {isSender && prompt.trigger_id === 'S1' && (
        <Text className="text-caption italic text-stone-400 dark:text-stone-600">
          Closing archives this conversation quietly, no penalty either way.
        </Text>
      )}
      <BlockConfirmModal
        visible={blockConfirmVisible}
        onClose={() => setBlockConfirmVisible(false)}
        onBlocked={() => {
          setBlockConfirmVisible(false);
          onBlocked?.();
        }}
        blockedId={otherId}
        otherName={otherName}
      />
    </View>
  );
}
