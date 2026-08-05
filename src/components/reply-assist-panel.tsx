import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, Text, TextInput, View } from 'react-native';

import { MicPlaceholderButton } from '@/components/mic-placeholder-button';
import { DraftServiceError, UniversalTextBox } from '@/components/universal-text-box';
import { supabase } from '@/lib/supabase';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400

export type ReplyAssistContextMessage = { sender: 'me' | 'them'; content: string };

type ReplyAssistPanelProps = {
  visible: boolean;
  onClose: () => void;
  onSend: (finalText: string) => Promise<void> | void;
  recentMessages: ReplyAssistContextMessage[];
};

// F18: AI message assistance, now built on the universal text box
// pattern (2026-07-17) rather than its own bespoke two-step flow.
// UniversalTextBox owns the "describe your situation, then Claude
// drafts" step and, once something is in the field, "Clean up"/"Cancel"
// too; this panel is now just the modal shell plus the Send gate. Opens
// over the thread (not a navigation, the screen underneath is
// untouched) and still matches AGENTS.md's "the app suggests, the user
// decides and acts" principle: nothing here can reach the thread without
// the user's own hand on it, Send stays disabled until they've actually
// touched the field themselves.
export function ReplyAssistPanel({ visible, onClose, onSend, recentMessages }: ReplyAssistPanelProps) {
  const [draft, setDraft] = useState('');
  const [edited, setEdited] = useState(false);
  const [sending, setSending] = useState(false);

  const reset = () => {
    setDraft('');
    setEdited(false);
    setSending(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleChange = (text: string) => {
    setDraft(text);
    setEdited(true);
  };

  const requestDraft = async (situation: string): Promise<string> => {
    const { data, error } = await supabase.functions.invoke('generate-reply-draft', {
      body: { rawInput: situation, recentMessages },
    });
    if (error) throw error;
    if (data?.blocked) throw new DraftServiceError(data.message as string);
    if (data?.error) throw new DraftServiceError(data.error as string);
    if (!data?.draft) throw new Error('No draft returned');
    return data.draft as string;
  };

  const canSend = edited && draft.trim().length > 0 && !sending;

  const handleSend = async () => {
    if (!canSend) return;
    setSending(true);
    try {
      await onSend(draft.trim());
      reset();
      onClose();
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <View className="flex-1 justify-end bg-black/30">
        <Pressable className="flex-1" onPress={handleClose} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View className="gap-4 rounded-t-3xl border-t border-stone-200 bg-stone-50 px-6 pb-8 pt-5 dark:border-stone-800 dark:bg-stone-900">
            <View className="h-1 w-10 self-center rounded-full bg-stone-300 dark:bg-stone-700" />
            <Text className="text-title text-stone-900 dark:text-stone-50">Write a reply</Text>

            <View className="relative">
              <TextInput
                value={draft}
                onChangeText={handleChange}
                placeholder="Type your own, or use Help me write below"
                placeholderTextColor={MUTED_ICON_COLOR}
                multiline
                numberOfLines={5}
                textAlignVertical="top"
                className="min-h-32 rounded-xl border border-stone-300 px-3 py-3 pr-12 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
              />
              <MicPlaceholderButton />
            </View>

            <UniversalTextBox
              value={draft}
              onChangeText={handleChange}
              onRequestDraft={requestDraft}
              situationPrompt="What's the situation, and what do you want to say?"
            />

            {!edited && draft.length > 0 && (
              <Text className="text-caption text-stone-400 dark:text-stone-600">
                Edit the draft before sending, make it your own.
              </Text>
            )}

            <View className="flex-row items-center justify-between pt-1">
              <Pressable onPress={handleClose}>
                <Text className="text-body text-stone-500 dark:text-stone-400">Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleSend}
                disabled={!canSend}
                className={`rounded-full bg-stone-900 px-6 py-3 active:opacity-80 dark:bg-stone-50 ${
                  !canSend ? 'opacity-40' : ''
                }`}>
                <Text className="text-body font-semibold text-stone-50 dark:text-stone-900">
                  {sending ? 'Sending...' : 'Send'}
                </Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
