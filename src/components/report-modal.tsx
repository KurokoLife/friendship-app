import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { MicPlaceholderButton } from '@/components/mic-placeholder-button';
import {
  EMERGENCY_GUIDANCE,
  fileReport,
  REPORT_CATEGORIES,
  type ReportCategory,
} from '@/lib/report-block';
import { nameThenPeriod } from '@/lib/names';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400

type Props = {
  visible: boolean;
  onClose: () => void;
  reportedId: string;
  connectionId: string | null;
  otherName: string;
};

function CategoryRow({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className={`rounded-xl border px-4 py-3 ${
        selected
          ? 'border-stone-900 bg-stone-900 dark:border-stone-50 dark:bg-stone-50'
          : 'border-stone-300 dark:border-stone-700'
      }`}>
      <Text
        className={`text-body ${
          selected ? 'text-stone-50 dark:text-stone-900' : 'text-stone-900 dark:text-stone-50'
        }`}>
        {label}
      </Text>
    </Pressable>
  );
}

// Report, reachable from Chat and the Other User Profile screen. Filing a
// report never requires any further contact with the reported person,
// this modal has no step that depends on them responding to anything.
//
// The optional detail field is a plain text box, deliberately not wired
// to this app's "Help me write" AI drafting pattern. That pattern exists
// to help a user articulate a message TO another person from their own
// raw description, it isn't a fit here: a safety report's value is being
// exactly what the reporter typed, and letting a model paraphrase or
// expand a factual account risks the same "app fabricates what the user
// didn't say" problem AGENTS.md's AI Philosophy anchor exists to prevent,
// just aimed at the app's own safety record instead of a message to a
// match. A single plain box, the user's own words only, already satisfies
// "user's words first, no forced AI involvement" as literally as
// possible, there's simply no AI step in this specific field at all.
export function ReportModal({ visible, onClose, reportedId, connectionId, otherName }: Props) {
  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [detail, setDetail] = useState('');
  const [alsoBlock, setAlsoBlock] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedCategoryDef = REPORT_CATEGORIES.find((c) => c.key === category);

  const handlePickCategory = (key: ReportCategory) => {
    setCategory(key);
    // Strongly suggest, never force, blocking alongside a report for the
    // categories where that's actually a safety concern (unsafe meetup,
    // harassment, romantic or sexual misuse), per explicit instruction.
    // Defaulted on for those, off for the rest, always changeable either
    // way before submitting.
    const def = REPORT_CATEGORIES.find((c) => c.key === key);
    setAlsoBlock(Boolean(def?.safetyRelevant));
  };

  const handleClose = () => {
    setCategory(null);
    setDetail('');
    setAlsoBlock(false);
    setSubmitting(false);
    setSubmitted(false);
    setError(null);
    onClose();
  };

  const handleSubmit = async () => {
    if (!category || submitting) return;
    setSubmitting(true);
    setError(null);
    const result = await fileReport(reportedId, connectionId, category, detail, alsoBlock);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSubmitted(true);
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View className="flex-1 justify-end bg-black/40">
        <View className="max-h-[85%] gap-4 rounded-t-3xl bg-stone-50 p-6 dark:bg-stone-900">
          {submitted ? (
            <View className="gap-4">
              <Text className="text-title text-stone-900 dark:text-stone-50">Report submitted</Text>
              <Text className="text-body text-stone-600 dark:text-stone-300">
                Thank you for letting us know. You do not need to respond to {otherName} again because
                of this.
                {alsoBlock ? ` ${otherName} has also been blocked.` : ''}
              </Text>
              <Pressable
                onPress={handleClose}
                className="items-center rounded-full bg-stone-900 py-4 active:opacity-80 dark:bg-stone-50">
                <Text className="text-body font-semibold text-stone-50 dark:text-stone-900">Done</Text>
              </Pressable>
            </View>
          ) : (
            <ScrollView contentContainerClassName="gap-4" showsVerticalScrollIndicator={false}>
              <Text className="text-title text-stone-900 dark:text-stone-50">Report {otherName}</Text>

              <View className="gap-2">
                {REPORT_CATEGORIES.map((c) => (
                  <CategoryRow
                    key={c.key}
                    label={c.label}
                    selected={category === c.key}
                    onPress={() => handlePickCategory(c.key)}
                  />
                ))}
              </View>

              {category === 'unsafe_meetup' && (
                <View className="gap-2 rounded-2xl border border-red-300 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950/40">
                  <Text className="text-body font-semibold text-red-700 dark:text-red-300">
                    {EMERGENCY_GUIDANCE.emergency}
                  </Text>
                  <Text className="text-caption text-red-600 dark:text-red-400">
                    For non-emergency support, these are available any time:
                  </Text>
                  {EMERGENCY_GUIDANCE.resources.map((r) => (
                    <Text key={r.name} className="text-caption text-red-600 dark:text-red-400">
                      {r.name}: {r.phone}
                    </Text>
                  ))}
                </View>
              )}

              {category && (
                <>
                  <View className="relative">
                    <TextInput
                      value={detail}
                      onChangeText={setDetail}
                      placeholder="Describe what happened (optional)"
                      placeholderTextColor={MUTED_ICON_COLOR}
                      multiline
                      numberOfLines={4}
                      textAlignVertical="top"
                      className="min-h-24 rounded-xl border border-stone-300 px-3 py-3 pr-12 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
                    />
                    <MicPlaceholderButton />
                  </View>

                  {selectedCategoryDef?.safetyRelevant && (
                    <Pressable
                      onPress={() => setAlsoBlock((v) => !v)}
                      className="flex-row items-center gap-3 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
                      <View
                        className={`h-5 w-5 items-center justify-center rounded border ${
                          alsoBlock
                            ? 'border-stone-900 bg-stone-900 dark:border-stone-50 dark:bg-stone-50'
                            : 'border-stone-300 dark:border-stone-700'
                        }`}>
                        {alsoBlock && <Text className="text-caption text-stone-50 dark:text-stone-900">✓</Text>}
                      </View>
                      <Text className="flex-1 text-caption text-stone-600 dark:text-stone-300">
                        Also block {nameThenPeriod(otherName)} They will not be able to see your profile or message
                        you.
                      </Text>
                    </Pressable>
                  )}
                </>
              )}

              {error && <Text className="text-caption text-red-600 dark:text-red-400">{error}</Text>}

              <View className="flex-row gap-3 pt-2">
                <Pressable onPress={handleClose} disabled={submitting} className="flex-1 items-center py-3">
                  <Text className="text-body text-stone-500 dark:text-stone-400">Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={handleSubmit}
                  disabled={!category || submitting}
                  className={`flex-1 flex-row items-center justify-center gap-2 rounded-full bg-stone-900 py-3 active:opacity-80 dark:bg-stone-50 ${
                    !category || submitting ? 'opacity-40' : ''
                  }`}>
                  {submitting && <ActivityIndicator color={MUTED_ICON_COLOR} />}
                  <Text className="text-body font-semibold text-stone-50 dark:text-stone-900">
                    {submitting ? 'Submitting...' : 'Submit report'}
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
