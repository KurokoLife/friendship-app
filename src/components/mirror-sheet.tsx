import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, Text, TextInput, View } from 'react-native';

import { supabase } from '@/lib/supabase';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400

// Limen v2 (2026-10-03): "Another way to see it" (the mirror).
//
// The user describes an ambiguous moment ("she replied with one word").
// reflection-coach (mode: mirror) returns exactly three short readings:
// their circumstances, how they might see you, and your own worry. It
// always ends with "You won't know until you ask. What would you want to
// ask them?" The user writes that question themselves, in the thread.
//
// Guardrails (build requirements, enforced server-side too):
//   - never a verdict ("you're right / they're wrong"), never sides with
//     the user (sycophantic AI reduces willingness to repair conflict,
//     Cheng et al. 2025)
//   - never states the other person's feelings as fact ("might", "could")
//   - always ends by turning the user back toward asking the real person
//     (perspective-getting beats perspective-taking, Eyal et al. 2018)
//   - safety exception: if the user describes feeling unsafe, no "both
//     sides", point to Report / Block instead
//   - one card per use, no ongoing chat thread with the AI
// See docs/LIMEN_V2_DECISIONS.md.

type Reading = { key: string; label: string; text: string };

type Props = {
  visible: boolean;
  onClose: () => void;
  otherName?: string | null;
};

export function MirrorSheet({ visible, onClose, otherName }: Props) {
  const [situation, setSituation] = useState('');
  const [loading, setLoading] = useState(false);
  const [readings, setReadings] = useState<Reading[] | null>(null);
  const [closing, setClosing] = useState<string | null>(null);
  const [safetyMessage, setSafetyMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setSituation('');
    setReadings(null);
    setClosing(null);
    setSafetyMessage(null);
    setError(null);
    setLoading(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSee = async () => {
    if (!situation.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('reflection-coach', {
        body: { mode: 'mirror', text: situation },
      });
      if (fnError) throw fnError;
      if (data?.blocked) {
        setError(data.message as string);
      } else if (data?.error) {
        setError(data.error as string);
      } else if (data?.unsafe) {
        setSafetyMessage(data.safetyMessage as string);
      } else {
        setReadings((data?.readings ?? []) as Reading[]);
        setClosing((data?.closing as string) ?? null);
      }
    } catch {
      setError("Couldn't do that right now. The only way to really know is to ask them.");
    } finally {
      setLoading(false);
    }
  };

  const name = otherName ?? 'they';

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <View className="flex-1 justify-end bg-black/30">
        <Pressable className="flex-1" onPress={handleClose} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View className="gap-4 rounded-t-3xl border-t border-stone-200 bg-stone-50 px-6 pb-8 pt-5 dark:border-stone-800 dark:bg-stone-900">
            <View className="h-1 w-10 self-center rounded-full bg-stone-300 dark:bg-stone-700" />
            <Text className="text-title text-stone-900 dark:text-stone-50">Another way to see it</Text>
            <Text className="text-caption text-stone-500 dark:text-stone-400">
              Describe the moment you're unsure about. You'll get a few possible readings, not an answer. Only {name}{' '}
              {otherName ? 'knows' : 'know'} what it really means.
            </Text>

            {!readings && !safetyMessage && (
              <>
                <TextInput
                  value={situation}
                  onChangeText={setSituation}
                  placeholder="What happened, and what's on your mind?"
                  placeholderTextColor={MUTED_ICON_COLOR}
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                  className="min-h-24 rounded-xl border border-stone-300 px-3 py-3 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
                />
                <Pressable
                  onPress={handleSee}
                  disabled={!situation.trim() || loading}
                  className={`self-start rounded-full bg-stone-900 px-5 py-2 dark:bg-stone-50 ${
                    !situation.trim() || loading ? 'opacity-40' : ''
                  }`}>
                  <Text className="text-caption font-semibold text-stone-50 dark:text-stone-900">Show me other readings</Text>
                </Pressable>
                {loading && <ActivityIndicator size="small" color={MUTED_ICON_COLOR} />}
              </>
            )}

            {error && <Text className="text-caption text-stone-500 dark:text-stone-400">{error}</Text>}

            {safetyMessage && (
              <Text className="text-body text-stone-800 dark:text-stone-100">{safetyMessage}</Text>
            )}

            {readings && (
              <View className="gap-3">
                {readings.map((r) => (
                  <View key={r.key} className="gap-1">
                    <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">{r.label}</Text>
                    <Text className="text-body text-stone-800 dark:text-stone-100">{r.text}</Text>
                  </View>
                ))}
                {closing && <Text className="text-body font-semibold text-stone-900 dark:text-stone-50">{closing}</Text>}
              </View>
            )}

            <Pressable onPress={handleClose} className="self-start pt-1">
              <Text className="text-body text-stone-500 dark:text-stone-400">
                {readings ? 'Back to the conversation' : 'Close'}
              </Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
