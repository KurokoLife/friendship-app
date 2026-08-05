import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { CoachMark } from '@/components/coach-mark';
import { MicPlaceholderButton } from '@/components/mic-placeholder-button';
import {
  formatMeetupDate,
  organizeRememberEntry,
  parseMeetupDate,
  RememberBlockedError,
  saveRememberEntry,
} from '@/lib/remember';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400

type Props = {
  visible: boolean;
  connectionId: string;
  userId: string;
  otherName: string;
  onClose: () => void;
  onSaved: () => void;
};

const PROMPT_SUGGESTIONS = ['What did you talk about?', 'Anything you want to remember to ask next time?', 'How did it feel to spend time together?'];

type Stage = 'writing' | 'organizing' | 'reviewing_raw' | 'reviewing_ai';

// Add Entry. Same AI-articulates-never-fabricates contract as every
// other AI-assist surface in this app: the user's raw words always come
// first (typed before either path below ever runs), and organizing is
// an equal, skippable choice, not a forced step, matching "the user
// decides and acts, nothing moves without the human choosing." Voice
// input is a placeholder only (MicPlaceholderButton), per explicit
// scope, no real voice-to-text exists anywhere in this app yet.
export function RememberEntryComposer({ visible, connectionId, userId, otherName, onClose, onSaved }: Props) {
  const [stage, setStage] = useState<Stage>('writing');
  const [rawText, setRawText] = useState('');
  const [meetupDateText, setMeetupDateText] = useState('');
  const [reviewSummary, setReviewSummary] = useState('');
  const [reviewFollowUp, setReviewFollowUp] = useState('');
  const [error, setError] = useState<string | null>(null);
  // 2026-08-12: only true for a real free-tier cap/pool block
  // (RememberBlockedError with tier === 'free'), shows an "Upgrade to
  // Premium" link. A real, previously undetected bug: this whole
  // surface used to swallow the blocked message entirely via a bare
  // `catch {}`, replacing it with a generic fallback string, the user
  // never saw the real reason or any option to act on it.
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setStage('writing');
    setRawText('');
    setMeetupDateText('');
    setReviewSummary('');
    setReviewFollowUp('');
    setError(null);
    setShowUpgrade(false);
    setSaving(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleOrganize = async () => {
    if (!rawText.trim()) return;
    setStage('organizing');
    setError(null);
    setShowUpgrade(false);
    try {
      const { summary, followUp } = await organizeRememberEntry(rawText.trim(), otherName);
      setReviewSummary(summary);
      setReviewFollowUp(followUp ?? '');
      setStage('reviewing_ai');
    } catch (err) {
      if (err instanceof RememberBlockedError) {
        setError(err.message);
        setShowUpgrade(err.tier === 'free');
      } else {
        setError("Couldn't organize that right now. You can try again, or save it as written.");
      }
      setStage('writing');
    }
  };

  const handleSaveWithoutOrganizing = () => {
    if (!rawText.trim()) return;
    setStage('reviewing_raw');
  };

  const handleConfirmSave = async () => {
    const parsedDate = parseMeetupDate(meetupDateText);
    if (parsedDate === undefined) {
      setError('Enter the date as YYYY-MM-DD, or leave it blank.');
      return;
    }
    if (parsedDate && parsedDate.getTime() > Date.now()) {
      setError("That date hasn't happened yet.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const meetupDate = parsedDate ? formatMeetupDate(parsedDate) : null;
      await saveRememberEntry({
        connectionId,
        userId,
        rawText: rawText.trim(),
        organizedText: stage === 'reviewing_ai' ? reviewSummary.trim() || null : null,
        followUpNote: stage === 'reviewing_ai' ? reviewFollowUp.trim() || null : null,
        meetupDate,
      });
      reset();
      onSaved();
    } catch {
      setError("Couldn't save that entry. Please try again.");
      setSaving(false);
    }
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View className="flex-1 items-center justify-center bg-black/40 px-6">
        <View className="max-h-[85%] w-full gap-4 rounded-3xl bg-stone-50 p-6 dark:bg-stone-900">
          <ScrollView contentContainerClassName="gap-4">
            <Text className="text-title text-stone-900 dark:text-stone-50">Add an entry about {otherName}</Text>

            {error && (
              <View className="gap-2">
                <Text className="text-caption text-red-600 dark:text-red-400">{error}</Text>
                {showUpgrade && (
                  <CoachMark
                    markKey="credits_premium"
                    text="Free plans include a daily/weekly cap on AI help. Once you hit it, you can buy a small pack of extra credits, or upgrade to Premium for a much larger monthly allowance."
                    actionLabel="See Premium"
                    onAction={() => router.push('/premium')}
                  />
                )}
                {showUpgrade && (
                  <Pressable onPress={() => router.push('/premium')} className="self-start">
                    <Text className="text-caption font-semibold text-accent-500">Upgrade to Premium</Text>
                  </Pressable>
                )}
              </View>
            )}

            {(stage === 'writing' || stage === 'organizing') && (
              <View className="gap-3">
                <View className="relative">
                  <TextInput
                    value={rawText}
                    onChangeText={setRawText}
                    placeholder="Write in your own words, this is just for you"
                    placeholderTextColor={MUTED_ICON_COLOR}
                    multiline
                    numberOfLines={5}
                    textAlignVertical="top"
                    editable={stage === 'writing'}
                    className="min-h-32 rounded-xl border border-stone-300 px-3 py-3 pr-12 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
                  />
                  <MicPlaceholderButton />
                </View>

                <View className="gap-1">
                  <Text className="text-caption text-stone-400 dark:text-stone-600">When did this happen? (optional)</Text>
                  <TextInput
                    value={meetupDateText}
                    onChangeText={setMeetupDateText}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={MUTED_ICON_COLOR}
                    editable={stage === 'writing'}
                    autoCapitalize="none"
                    className="rounded-xl border border-stone-300 px-3 py-3 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
                  />
                </View>

                {stage === 'writing' && !rawText.trim() && (
                  <View className="gap-1">
                    <Text className="text-caption text-stone-400 dark:text-stone-600">Not sure what to write?</Text>
                    {PROMPT_SUGGESTIONS.map((p) => (
                      <Text key={p} className="text-caption text-stone-400 dark:text-stone-600">
                        {'•'} {p}
                      </Text>
                    ))}
                  </View>
                )}

                {stage === 'organizing' && (
                  <View className="flex-row items-center gap-2">
                    <ActivityIndicator size="small" color={MUTED_ICON_COLOR} />
                    <Text className="text-caption text-stone-400 dark:text-stone-600">Organizing...</Text>
                  </View>
                )}

                {stage === 'writing' && (
                  <View className="flex-row flex-wrap items-center gap-4">
                    <Pressable onPress={handleOrganize} disabled={!rawText.trim()}>
                      <Text
                        className={`text-caption font-semibold text-accent-500 ${!rawText.trim() ? 'opacity-40' : ''}`}>
                        Organize with AI
                      </Text>
                    </Pressable>
                    <Pressable onPress={handleSaveWithoutOrganizing} disabled={!rawText.trim()}>
                      <Text
                        className={`text-caption font-semibold text-stone-500 dark:text-stone-400 ${!rawText.trim() ? 'opacity-40' : ''}`}>
                        Save as written
                      </Text>
                    </Pressable>
                    <Pressable onPress={handleClose}>
                      <Text className="text-caption text-stone-400 dark:text-stone-600">Cancel</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            )}

            {stage === 'reviewing_raw' && (
              <View className="gap-3">
                <Text className="text-caption text-stone-500 dark:text-stone-400">What you wrote</Text>
                <Text className="text-body text-stone-800 dark:text-stone-200">{rawText}</Text>
                <View className="flex-row items-center gap-4">
                  <Pressable
                    onPress={handleConfirmSave}
                    disabled={saving}
                    className={`rounded-full bg-stone-900 px-4 py-2 active:opacity-80 dark:bg-stone-50 ${saving ? 'opacity-40' : ''}`}>
                    <Text className="text-caption font-semibold text-stone-50 dark:text-stone-900">
                      {saving ? 'Saving...' : 'Save entry'}
                    </Text>
                  </Pressable>
                  <Pressable onPress={() => setStage('writing')} disabled={saving}>
                    <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">Back</Text>
                  </Pressable>
                </View>
              </View>
            )}

            {stage === 'reviewing_ai' && (
              <View className="gap-4">
                <View className="gap-1">
                  <Text className="text-caption text-stone-400 dark:text-stone-600">What you wrote</Text>
                  <Text className="text-body text-stone-500 dark:text-stone-400">{rawText}</Text>
                </View>

                <View className="gap-1">
                  <Text className="text-caption text-stone-500 dark:text-stone-400">Summary, edit if you want</Text>
                  <TextInput
                    value={reviewSummary}
                    onChangeText={setReviewSummary}
                    multiline
                    numberOfLines={3}
                    textAlignVertical="top"
                    editable={!saving}
                    className="min-h-20 rounded-xl border border-stone-300 px-3 py-3 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
                  />
                </View>

                <View className="gap-1">
                  <Text className="text-caption text-stone-500 dark:text-stone-400">
                    Reminder for next time, optional
                  </Text>
                  <TextInput
                    value={reviewFollowUp}
                    onChangeText={setReviewFollowUp}
                    placeholder="Nothing to follow up on"
                    placeholderTextColor={MUTED_ICON_COLOR}
                    multiline
                    numberOfLines={2}
                    textAlignVertical="top"
                    editable={!saving}
                    className="min-h-14 rounded-xl border border-stone-300 px-3 py-3 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
                  />
                </View>

                <View className="flex-row items-center gap-4">
                  <Pressable
                    onPress={handleConfirmSave}
                    disabled={saving || !reviewSummary.trim()}
                    className={`rounded-full bg-stone-900 px-4 py-2 active:opacity-80 dark:bg-stone-50 ${
                      saving || !reviewSummary.trim() ? 'opacity-40' : ''
                    }`}>
                    <Text className="text-caption font-semibold text-stone-50 dark:text-stone-900">
                      {saving ? 'Saving...' : 'Approve and save'}
                    </Text>
                  </Pressable>
                  <Pressable onPress={() => setStage('writing')} disabled={saving}>
                    <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">
                      Edit my own words instead
                    </Text>
                  </Pressable>
                </View>
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
