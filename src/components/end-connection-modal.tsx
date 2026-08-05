import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { MicPlaceholderButton } from '@/components/mic-placeholder-button';
import { DraftServiceError, UniversalTextBox } from '@/components/universal-text-box';
import {
  CONNECTION_END_REASONS,
  CONNECTION_END_TEMPLATES,
  endConnectionWithMessage,
  HONEST_EXIT_SENDER_TEXT,
  type ConnectionEndReason,
} from '@/lib/no-ghost';
import { supabase } from '@/lib/supabase';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400

type Props = {
  visible: boolean;
  onClose: () => void;
  onEnded: () => void;
  connectionId: string;
  otherName: string;
};

// Honest Exit's standalone entry point (blueprint Section 10's own
// 7-step decision flow, steps 1-5 built here, step 6 is the thread
// screen's own already-built honest 'ended' banner, step 7 is Block,
// already reachable independently from Chat's own header). Reachable
// directly from the thread header at the user's own initiative, on any
// healthy connection, not conditioned on an escalating no-ghost or
// meetup-outcome trigger the way the two older entry points still are.
//
// Reuses end_connection_with_message (20260817000000, extended
// 20260818000000) rather than a second parallel system: same atomic
// status-change RPC the other two entry points already call, same
// clear-prompts trigger, same evaluator guards, same Inbox label, same
// thread banner. Only what's genuinely new here is exposed in this
// modal's own UI: the message-or-not choice, private reason capture, and
// template selection.
export function EndConnectionModal({ visible, onClose, onEnded, connectionId, otherName }: Props) {
  const [sendMessage, setSendMessage] = useState(true);
  const [reason, setReason] = useState<ConnectionEndReason | null>(null);
  const [draft, setDraftRaw] = useState('');
  // Same "must actually see/edit before Send enables" gate this app
  // already enforces for every AI-draft flow (ConversationFlowPromptCard,
  // ReplyAssistPanel, etc.), extended here to templates too, per explicit
  // instruction: picking a template only pre-fills the field, it does not
  // by itself make the message ready to send.
  const [draftEdited, setDraftEdited] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);

  const handleDraftChange = (text: string) => {
    setDraftRaw(text);
    setDraftEdited(true);
  };

  const handlePickTemplate = (text: string) => {
    setDraftRaw(text);
    setDraftEdited(false);
  };

  const requestDraft = async (situation: string): Promise<string> => {
    const { data, error: fnError } = await supabase.functions.invoke('generate-reply-draft', {
      body: {
        rawInput: situation,
        recentMessages: [],
        purpose: `write a short, honest, respectful message to end this connection with ${otherName}`,
      },
    });
    if (fnError) throw fnError;
    if (data?.blocked) throw new DraftServiceError(data.message as string);
    if (data?.error) throw new DraftServiceError(data.error as string);
    if (!data?.draft) throw new Error('No draft returned');
    return data.draft as string;
  };

  const handleClose = () => {
    setSendMessage(true);
    setReason(null);
    setDraftRaw('');
    setDraftEdited(false);
    setBusy(false);
    setError(null);
    setEnded(false);
    onClose();
  };

  const canSend = sendMessage ? draftEdited && draft.trim().length > 0 : true;

  const handleEnd = async () => {
    if (!canSend || busy) return;
    setBusy(true);
    setError(null);
    try {
      await endConnectionWithMessage(connectionId, {
        content: sendMessage ? draft.trim() : undefined,
        reason: reason ?? undefined,
      });
      setEnded(true);
      onEnded();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong ending this connection.');
    } finally {
      setBusy(false);
    }
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View className="flex-1 justify-end bg-black/40">
        <View className="max-h-[85%] gap-4 rounded-t-3xl bg-stone-50 p-6 dark:bg-stone-900">
          {ended ? (
            <View className="gap-4">
              <Text className="text-title text-stone-900 dark:text-stone-50">Connection ended</Text>
              <Text className="text-body text-stone-600 dark:text-stone-300">{HONEST_EXIT_SENDER_TEXT}</Text>
              <Pressable
                onPress={handleClose}
                className="items-center rounded-full bg-stone-900 py-4 active:opacity-80 dark:bg-stone-50">
                <Text className="text-body font-semibold text-stone-50 dark:text-stone-900">Done</Text>
              </Pressable>
            </View>
          ) : (
            <ScrollView contentContainerClassName="gap-4" showsVerticalScrollIndicator={false}>
              <Text className="text-title text-stone-900 dark:text-stone-50">End connection with {otherName}?</Text>
              <Text className="text-body text-stone-600 dark:text-stone-300">
                This is a real, deliberate choice. Once ended, messaging stops for both of you, and
                starting over later takes a separate, explicit step.
              </Text>

              {/* Step 2: send a message, or end without one. Distinct from
                  S1's own "Close and make room for another", which stays
                  silent by design; ending without a message here still
                  notifies, {otherName} still sees the real, honest 'ended'
                  banner in the thread either way. */}
              <View className="gap-2">
                <Text className="text-caption font-semibold uppercase text-stone-400 dark:text-stone-600">
                  How would you like to end this?
                </Text>
                <View className="flex-row gap-2">
                  <Pressable
                    onPress={() => setSendMessage(true)}
                    className={`flex-1 items-center rounded-xl border px-3 py-3 ${
                      sendMessage
                        ? 'border-stone-900 bg-stone-900 dark:border-stone-50 dark:bg-stone-50'
                        : 'border-stone-300 dark:border-stone-700'
                    }`}>
                    <Text
                      className={`text-body ${
                        sendMessage ? 'text-stone-50 dark:text-stone-900' : 'text-stone-900 dark:text-stone-50'
                      }`}>
                      Send a message
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setSendMessage(false)}
                    className={`flex-1 items-center rounded-xl border px-3 py-3 ${
                      !sendMessage
                        ? 'border-stone-900 bg-stone-900 dark:border-stone-50 dark:bg-stone-50'
                        : 'border-stone-300 dark:border-stone-700'
                    }`}>
                    <Text
                      className={`text-body ${
                        !sendMessage ? 'text-stone-50 dark:text-stone-900' : 'text-stone-900 dark:text-stone-50'
                      }`}>
                      End without a message
                    </Text>
                  </Pressable>
                </View>
              </View>

              {/* Step 3: optional, private reason. Never shown to
                  {otherName}, structurally, not just by choice, see
                  connection_end_reasons' own own-row-only RLS. */}
              <View className="gap-2">
                <Text className="text-caption font-semibold uppercase text-stone-400 dark:text-stone-600">
                  Reason (private, optional)
                </Text>
                <Text className="text-caption text-stone-400 dark:text-stone-600">
                  Only you can ever see this. It is never shown to {otherName}.
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  {CONNECTION_END_REASONS.map((r) => (
                    <Pressable
                      key={r.key}
                      onPress={() => setReason((prev) => (prev === r.key ? null : r.key))}
                      className={`rounded-full border px-3 py-2 ${
                        reason === r.key
                          ? 'border-stone-900 bg-stone-900 dark:border-stone-50 dark:bg-stone-50'
                          : 'border-stone-300 dark:border-stone-700'
                      }`}>
                      <Text
                        className={`text-caption font-semibold ${
                          reason === r.key ? 'text-stone-50 dark:text-stone-900' : 'text-stone-600 dark:text-stone-300'
                        }`}>
                        {r.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              {/* Step 4: write freely, choose a template, ask AI to draft
                  or polish. Only shown when sending a message. */}
              {sendMessage && (
                <View className="gap-2">
                  <Text className="text-caption font-semibold uppercase text-stone-400 dark:text-stone-600">
                    Message
                  </Text>
                  <View className="flex-row flex-wrap gap-2">
                    {CONNECTION_END_TEMPLATES.map((t) => (
                      <Pressable
                        key={t.key}
                        onPress={() => handlePickTemplate(t.text)}
                        className="rounded-full border border-stone-300 px-3 py-2 dark:border-stone-700">
                        <Text className="text-caption font-semibold text-stone-600 dark:text-stone-300">
                          {t.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <View className="relative">
                    <TextInput
                      value={draft}
                      onChangeText={handleDraftChange}
                      onFocus={() => setDraftEdited(true)}
                      placeholder="Write what you want to say, or pick a starting point above"
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
                        return await requestDraft(situation);
                      } finally {
                        setDrafting(false);
                      }
                    }}
                    disabled={drafting}
                  />
                  {!draftEdited && draft.trim().length > 0 && (
                    <Text className="text-caption text-stone-400 dark:text-stone-600">
                      Edit the message before sending, make it your own.
                    </Text>
                  )}
                </View>
              )}

              {error && <Text className="text-caption text-red-600 dark:text-red-400">{error}</Text>}

              <View className="flex-row gap-3 pt-2">
                <Pressable onPress={handleClose} disabled={busy} className="flex-1 items-center py-3">
                  <Text className="text-body text-stone-500 dark:text-stone-400">Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={handleEnd}
                  disabled={!canSend || busy}
                  className={`flex-1 flex-row items-center justify-center gap-2 rounded-full bg-red-600 py-3 active:opacity-80 ${
                    !canSend || busy ? 'opacity-40' : ''
                  }`}>
                  {busy && <ActivityIndicator color="#fff" />}
                  <Text className="text-body font-semibold text-white">
                    {busy ? 'Ending...' : 'End connection'}
                  </Text>
                </Pressable>
              </View>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}
