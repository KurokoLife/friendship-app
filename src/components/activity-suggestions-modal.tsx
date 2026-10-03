import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { CoachMark } from '@/components/coach-mark';
import { MicPlaceholderButton } from '@/components/mic-placeholder-button';
import { UniversalTextBox } from '@/components/universal-text-box';
import { supabase } from '@/lib/supabase';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400

type Suggestion = {
  category: 'low_effort' | 'interest_based' | 'link_out';
  label: string;
  description: string;
  isFree: boolean;
  freeAlternative: string | null;
  source: 'ticketmaster' | 'eventbrite' | 'curated' | 'link_out';
  // Replaces the old sharedInterest field: always attributed correctly
  // by the server ("you both like X", "you like X", or "{name} likes
  // X"), never implies sharing that was never confirmed. Category labels
  // below are deliberately neutral so they read correctly regardless of
  // which attribution interestNote ends up carrying.
  interestNote?: string;
  message: string;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  connectionId: string;
  onSend: (finalText: string) => Promise<void> | void;
};

type Step = 'loading' | 'pick' | 'draft' | 'error';

// F23 rebuild (2026-07-26, widened 2026-07-28): always three categories,
// never filtered by friendship_type or gated on whether there's been a
// first meetup yet. Wording is AI-generated and varies on every refresh
// (see the edge function), these are just the fixed slot labels.
const CATEGORY_LABELS: Record<Suggestion['category'], string> = {
  low_effort: 'Low effort',
  interest_based: 'An idea for you two',
  link_out: 'Something else to try',
};

// F23: fetched fresh every time this opens (not cached, unlike match
// suggestions, an activity suggestion is meant to be timely and cheap to
// regenerate, not something worth a persistence layer). User picks one,
// edits the Claude-drafted message (edit is required before Send, same
// gate ReplyAssistPanel already enforces), sends manually. This never
// creates a meetups row itself, "plan a meetup" (F21) is the only place
// that actually schedules something, this is just a chat message.
export function ActivitySuggestionsModal({ visible, onClose, connectionId, onSend }: Props) {
  const [step, setStep] = useState<Step>('loading');
  // 2026-07-29: holds the real blocked-cap/pool message when that's why
  // this failed, falls back to the generic line below otherwise.
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // 2026-08-12: true only for a free-tier block (data.tier), shows a
  // real "Upgrade to Premium" link, same reasoning as universal-text-box.
  const [errorShowUpgrade, setErrorShowUpgrade] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selected, setSelected] = useState<Suggestion | null>(null);
  const [draft, setDraft] = useState('');
  const [edited, setEdited] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setStep('loading');
    setErrorMessage(null);
    setErrorShowUpgrade(false);
    setSuggestions([]);
    setSelected(null);
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke('generate-activity-suggestions', {
          body: { connectionId },
        });
        if (data?.blocked) {
          setErrorMessage(data.message as string);
          setErrorShowUpgrade(data.tier === 'free');
          setStep('error');
          return;
        }
        if (error || !data?.suggestions?.length) throw error ?? new Error('No suggestions returned');
        setSuggestions(data.suggestions as Suggestion[]);
        setStep('pick');
      } catch {
        setStep('error');
      }
    })();
  }, [visible, connectionId]);

  const handleClose = () => {
    setStep('loading');
    setSelected(null);
    setDraft('');
    setEdited(false);
    onClose();
  };

  const handlePick = (s: Suggestion) => {
    setSelected(s);
    // Limen v2: the idea is suggested, the invitation is the user's own
    // words. The AI-generated `message` is no longer pre-filled.
    setDraft('');
    setEdited(false);
    setStep('draft');
  };

  const canSend = edited && draft.trim().length > 0 && !sending;

  const handleSend = async () => {
    if (!canSend) return;
    setSending(true);
    try {
      await onSend(draft.trim());
      handleClose();
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <View className="flex-1 justify-end bg-black/30">
        <Pressable className="flex-1" onPress={handleClose} />
        <View className="max-h-[80%] gap-4 rounded-t-3xl border-t border-stone-200 bg-stone-50 px-6 pb-8 pt-5 dark:border-stone-800 dark:bg-stone-900">
          <View className="h-1 w-10 self-center rounded-full bg-stone-300 dark:bg-stone-700" />

          {step === 'loading' && (
            <View className="items-center gap-3 py-10">
              <ActivityIndicator color={MUTED_ICON_COLOR} />
              <Text className="text-body text-stone-500 dark:text-stone-400">Finding a few ideas...</Text>
            </View>
          )}

          {step === 'error' && (
            <View className="items-center gap-3 py-6">
              <Text className="text-center text-body text-stone-500 dark:text-stone-400">
                {errorMessage ?? "Couldn't load suggestions right now. Try again in a moment."}
              </Text>
              {errorShowUpgrade && (
                <CoachMark
                  markKey="credits_premium"
                  text="Free plans include a daily/weekly cap on AI help. Once you hit it, you can buy a small pack of extra credits, or upgrade to Premium for a much larger monthly allowance."
                  actionLabel="See Premium"
                  onAction={() => {
                    handleClose();
                    router.push('/premium');
                  }}
                />
              )}
              {errorShowUpgrade && (
                <Pressable
                  onPress={() => {
                    handleClose();
                    router.push('/premium');
                  }}>
                  <Text className="text-body font-semibold text-accent-500">Upgrade to Premium</Text>
                </Pressable>
              )}
              <Pressable onPress={handleClose}>
                <Text className="text-body font-semibold text-accent-500">Close</Text>
              </Pressable>
            </View>
          )}

          {step === 'pick' && (
            <>
              <Text className="text-title text-stone-900 dark:text-stone-50">A few ideas</Text>
              <ScrollView contentContainerClassName="gap-3">
                {suggestions.map((s) => (
                  <Pressable
                    key={s.category}
                    onPress={() => handlePick(s)}
                    className="gap-1 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
                    <Text className="text-caption text-stone-400 dark:text-stone-600">
                      {CATEGORY_LABELS[s.category]}
                      {s.interestNote ? ` · ${s.interestNote}` : ''}
                    </Text>
                    <Text className="text-body font-semibold text-stone-900 dark:text-stone-50">{s.label}</Text>
                    <Text className="text-caption text-stone-600 dark:text-stone-300">{s.description}</Text>
                    {s.freeAlternative && (
                      <Text className="text-caption text-stone-400 dark:text-stone-600">{s.freeAlternative}</Text>
                    )}
                  </Pressable>
                ))}
              </ScrollView>
              <Pressable onPress={handleClose} className="items-center py-1">
                <Text className="text-body text-stone-500 dark:text-stone-400">Cancel</Text>
              </Pressable>
            </>
          )}

          {step === 'draft' && selected && (
            <>
              <Text className="text-title text-stone-900 dark:text-stone-50">
                Invite them in your own words
              </Text>
              <Text className="text-caption text-stone-500 dark:text-stone-400">
                Idea: {selected.label}. {selected.description}
              </Text>
              <View className="relative">
                <TextInput
                  value={draft}
                  onChangeText={(text) => {
                    setDraft(text);
                    setEdited(true);
                  }}
                  onFocus={() => setEdited(true)}
                  multiline
                  numberOfLines={5}
                  textAlignVertical="top"
                  className="min-h-32 rounded-xl border border-stone-300 px-3 py-3 pr-12 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
                />
                <MicPlaceholderButton />
              </View>
              <UniversalTextBox
                value={draft}
                onChangeText={(text) => {
                  setDraft(text);
                  setEdited(true);
                }}
                context="plan"
              />
              <View className="flex-row items-center justify-between pt-1">
                <Pressable onPress={() => setStep('pick')}>
                  <Text className="text-body text-stone-500 dark:text-stone-400">Back</Text>
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
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}
