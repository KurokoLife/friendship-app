import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { CoachMark } from '@/components/coach-mark';
import { supabase } from '@/lib/supabase';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400

type Analysis = {
  sharedTraits: string[];
  compatibleRhythms: string[];
  frictionPoints: string[];
};

type ConnectionAnalysisSheetProps = {
  visible: boolean;
  candidateId: string | null;
  candidateName: string;
  isSaved: boolean;
  onClose: () => void;
  onSave: () => Promise<void> | void;
  onStartConversation: () => Promise<void> | void;
};

function Section({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <View className="gap-2">
      <Text className="text-caption font-semibold text-stone-400 dark:text-stone-600">{title}</Text>
      <View className="gap-2">
        {items.map((item, index) => (
          <Text key={index} className="text-body leading-relaxed text-stone-700 dark:text-stone-300">
            {item}
          </Text>
        ))}
      </View>
    </View>
  );
}

// F13: "Why might we connect?", tapped from a Browse (F12) card. Opens
// over the results, doesn't navigate away, same bottom-sheet Modal
// pattern already used for F18's reply-assist panel and F12's filter
// sheets. Fetches fresh every time it opens for a given candidate, this
// is genuinely on-demand, not a cached daily batch like F11's
// suggestions.
export function ConnectionAnalysisSheet({
  visible,
  candidateId,
  candidateName,
  isSaved,
  onClose,
  onSave,
  onStartConversation,
}: ConnectionAnalysisSheetProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 2026-08-12: true only for a free-tier block, shows a real "Upgrade
  // to Premium" link next to the existing "Try again", same reasoning
  // as universal-text-box/activity-suggestions-modal.
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!visible || !candidateId) return;
    setAnalysis(null);
    setError(null);
    setShowUpgrade(false);
    setLoading(true);
    (async () => {
      const { data, error: fnError } = await supabase.functions.invoke('generate-connection-analysis', {
        body: { candidateId },
      });
      if (data?.blocked) {
        setError(data.message as string);
        setShowUpgrade(data.tier === 'free');
        setLoading(false);
        return;
      }
      if (fnError || !data?.analysis) {
        setError("Couldn't put this together right now. You can try again.");
        setLoading(false);
        return;
      }
      setAnalysis(data.analysis as Analysis);
      setLoading(false);
    })();
  }, [visible, candidateId]);

  const handleSave = async () => {
    setSaving(true);
    await onSave();
    setSaving(false);
  };

  const handleStart = async () => {
    setStarting(true);
    await onStartConversation();
    setStarting(false);
  };

  const hasNothingToShow =
    analysis &&
    analysis.sharedTraits.length === 0 &&
    analysis.compatibleRhythms.length === 0 &&
    analysis.frictionPoints.length === 0;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/30">
        <Pressable className="flex-1" onPress={onClose} />
        <View className="max-h-[85%] gap-4 rounded-t-3xl border-t border-stone-200 bg-stone-50 px-6 pb-8 pt-5 dark:border-stone-800 dark:bg-stone-900">
          <View className="h-1 w-10 self-center rounded-full bg-stone-300 dark:bg-stone-700" />
          <Text className="text-title text-stone-900 dark:text-stone-50">
            Why might you and {candidateName} connect?
          </Text>

          <ScrollView contentContainerClassName="gap-5">
            {loading && (
              <View className="items-center gap-3 py-8">
                <ActivityIndicator color={MUTED_ICON_COLOR} />
                <Text className="text-caption text-stone-400 dark:text-stone-600">
                  Looking at what you two might have in common.
                </Text>
              </View>
            )}

            {error && !loading && (
              <View className="gap-3 py-4">
                <Text className="text-body text-stone-600 dark:text-stone-300">{error}</Text>
                {showUpgrade && (
                  <CoachMark
                    markKey="credits_premium"
                    text="Free plans include a daily/weekly cap on AI help. Once you hit it, you can buy a small pack of extra credits, or upgrade to Premium for a much larger monthly allowance."
                    actionLabel="See Premium"
                    onAction={() => router.push('/premium')}
                  />
                )}
                <View className="flex-row flex-wrap items-center gap-3">
                  <Pressable
                    onPress={() => {
                      if (candidateId) {
                        setError(null);
                        setShowUpgrade(false);
                        setLoading(true);
                        supabase.functions
                          .invoke('generate-connection-analysis', { body: { candidateId } })
                          .then(({ data, error: fnError }) => {
                            if (data?.blocked) {
                              setError(data.message as string);
                              setShowUpgrade(data.tier === 'free');
                            } else if (fnError || !data?.analysis) {
                              setError("Couldn't put this together right now. You can try again.");
                            } else {
                              setAnalysis(data.analysis as Analysis);
                            }
                            setLoading(false);
                          });
                      }
                    }}
                    className="items-center self-start rounded-full border border-stone-300 px-5 py-2 active:opacity-70 dark:border-stone-600">
                    <Text className="text-caption font-semibold text-stone-700 dark:text-stone-300">
                      Try again
                    </Text>
                  </Pressable>
                  {showUpgrade && (
                    <Pressable onPress={() => router.push('/premium')} className="self-start">
                      <Text className="text-caption font-semibold text-accent-500">Upgrade to Premium</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            )}

            {analysis && !loading && !error && (
              <>
                {hasNothingToShow && (
                  <Text className="text-body text-stone-600 dark:text-stone-300">
                    There isn&apos;t much overlap to point to yet from your profiles alone,
                    that doesn&apos;t mean a connection couldn&apos;t work, just that it isn&apos;t
                    obvious from the data.
                  </Text>
                )}
                <Section title="What you share" items={analysis.sharedTraits} />
                <Section title="How your rhythms line up" items={analysis.compatibleRhythms} />
                <Section title="Worth talking through" items={analysis.frictionPoints} />
              </>
            )}
          </ScrollView>

          <View className="gap-2 pt-1">
            <Pressable
              onPress={handleStart}
              disabled={starting}
              className={`items-center rounded-full bg-stone-900 py-4 active:opacity-80 dark:bg-stone-50 ${
                starting ? 'opacity-40' : ''
              }`}>
              <Text className="text-body font-semibold text-stone-50 dark:text-stone-900">
                Start a conversation
              </Text>
            </Pressable>
            <Pressable
              onPress={handleSave}
              disabled={isSaved || saving}
              className={`items-center rounded-full border py-4 active:opacity-70 ${
                isSaved
                  ? 'border-accent-500 bg-accent-500'
                  : 'border-stone-300 dark:border-stone-600'
              }`}>
              <Text
                className={`text-body font-semibold ${
                  isSaved ? 'text-white' : 'text-stone-700 dark:text-stone-300'
                }`}>
                {isSaved ? 'Saved' : 'Save for later'}
              </Text>
            </Pressable>
            <Pressable onPress={onClose}>
              <Text className="text-center text-body text-stone-500 dark:text-stone-400">
                Back to browse
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
