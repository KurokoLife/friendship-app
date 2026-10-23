import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { PaddedSafeArea } from '@/components/padded-safe-area';

import { track } from '@/lib/analytics';
import { getDeviceId } from '@/lib/device-id';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400

type Step = 'question' | 'pause-options' | 'paused-confirmation';

// "Before you start" (2026-10-22 wording): the same agreements, in the warm
// tone of the rest of joining. "Removed" is real (users.suspended_at), and
// so is the quiet-chat rule (ghosting_events, is_ghosting_penalized).
const AGREEMENTS: { title: string; text: string }[] = [
  {
    title: 'Friendship only',
    text: 'No dating, no romance, and never asking for money. People who do are removed.',
  },
  {
    title: 'Honest is kinder than quiet',
    text: "If a chat isn't right for you, a short note is kinder than disappearing. Limen makes that easy.",
  },
  {
    title: 'Meet somewhere public first',
    text: 'And go with how you feel. You can leave, report or block anytime.',
  },
  {
    title: 'Answer every hello, even with a "no thanks"',
    text: "Take the time you need. If a new chat closes because you never answered, and that happens twice within two months, you'll show up later in suggestions for the next month. Nobody is told.",
  },
];

const PAUSE_OPTIONS: { label: string; days: number }[] = [
  { label: 'Pause for 30 days', days: 30 },
  { label: 'Pause for 60 days', days: 60 },
  { label: 'Pause for 90 days', days: 90 },
];

// F9 + F10, merged into one confirmation (2026-07-26 onboarding update).
// This screen used to be two separate screens back to back
// (readiness-commitment.tsx's own "I'm ready"/"I need more time" question,
// then behavioral-tracking-disclosure.tsx's separate "I understand"
// screen). Both are still here, same wording, same interaction, now on
// one screen with one final action: choosing "Yes, I'm ready" writes both
// readiness_status/paused_until AND behavioral_tracking_disclosed_at in a
// single update, rather than two separate screens each writing once.
// "I need more time" still only pauses the account, exactly as before,
// the account never reaches the tracking disclosure at all in that case,
// same as the old two-screen flow, since a paused user isn't entering the
// live app yet.
export default function ReadinessCommitmentScreen() {
  const [step, setStep] = useState<Step>('question');
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleReady = async () => {
    setError(null);
    setSaving(true);

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      setSaving(false);
      setError('Your session expired. Please verify your phone number again.');
      return;
    }

    // Fraud signal (2026-08-01): recorded just before the update below,
    // whose write is what actually triggers the device-clustering/
    // referral-pattern check server-side (check_fraud_signals, migration
    // 20260810000000). A plain self-row insert, not something this
    // screen's own success path depends on, a failure here is swallowed
    // rather than blocking onboarding completion over a soft signal.
    try {
      const deviceId = await getDeviceId();
      await supabase.from('onboarding_device_ids').insert({ user_id: user.id, device_id: deviceId });
    } catch {
      // Non-blocking, see comment above.
    }

    const { error: updateError } = await supabase
      .from('users')
      .update({
        readiness_status: 'ready',
        paused_until: null,
        behavioral_tracking_disclosed_at: new Date().toISOString(),
      })
      .eq('id', user.id);

    setSaving(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    track('onboarding_completed');
    router.replace('/profile-review?from=onboarding');
  };

  const handlePause = async (days: number) => {
    setError(null);
    setSaving(true);

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      setSaving(false);
      setError('Your session expired. Please verify your phone number again.');
      return;
    }

    const pausedUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

    const { error: updateError } = await supabase
      .from('users')
      .update({ readiness_status: 'paused', paused_until: pausedUntil })
      .eq('id', user.id);

    setSaving(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setStep('paused-confirmation');
  };

  if (step === 'paused-confirmation') {
    return (
      <View className="flex-1 items-center justify-center bg-stone-50 px-6 dark:bg-stone-900">
        <Text className="text-center text-title text-stone-900 dark:text-stone-50">
          We&apos;ll be here when you&apos;re ready.
        </Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-stone-50 dark:bg-stone-900">
      <PaddedSafeArea className="flex-1 justify-between px-6 py-10">
        {step === 'pause-options' ? (
          <View className="gap-5 pt-16">
            <Pressable onPress={() => setStep('question')}>
              <Text className="text-caption text-stone-500 dark:text-stone-400">Back</Text>
            </Pressable>
            <Text className="text-display text-stone-900 dark:text-stone-50">
              How long do you need?
            </Text>
            <Text className="text-body text-stone-600 dark:text-stone-300">
              Your account is preserved, there&apos;s no penalty, and you can come back anytime.
            </Text>
            <Text className="text-caption text-stone-500 dark:text-stone-400">
              While paused, you won&apos;t appear in other people&apos;s suggestions. Your profile
              and conversations are preserved.
            </Text>
            <View className="gap-3 pt-2">
              {PAUSE_OPTIONS.map((option) => (
                <Pressable
                  key={option.days}
                  onPress={() => handlePause(option.days)}
                  disabled={saving}
                  className={`items-center rounded-xl border border-stone-300 py-4 active:opacity-80 dark:border-stone-700 ${
                    saving ? 'opacity-40' : ''
                  }`}>
                  <Text className="text-body text-stone-900 dark:text-stone-50">{option.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : (
          <ScrollView contentContainerClassName="gap-5" showsVerticalScrollIndicator={false}>
            <Pressable onPress={() => router.replace('/profile-build?from=photo')} className="self-start">
              <Text className="text-caption text-stone-500 dark:text-stone-400">Back</Text>
            </Pressable>
            {/* 2026-10-18: replaces the two onboarding videos and their quiz.
                Their messages now show as single lines at the moment they
                matter. "Removal" is real: users.suspended_at. The quiet-chat
                rule is real too (ghosting_events, is_ghosting_penalized). */}
            <View className="gap-2">
              <Text className="text-display text-stone-900 dark:text-stone-50">Before you start</Text>
              <Text className="text-body text-stone-500 dark:text-stone-400">
                Everyone here agrees to the same few things, so you know what to expect from each other.
              </Text>
            </View>
            <View className="gap-5 rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-stone-800">
              {AGREEMENTS.map((a) => (
                <View key={a.title} className="gap-1">
                  <Text className="text-body font-semibold text-stone-900 dark:text-stone-50">{a.title}</Text>
                  <Text className="text-body text-stone-600 dark:text-stone-300">{a.text}</Text>
                </View>
              ))}
              <Pressable onPress={() => setExpanded((v) => !v)}>
                <Text className="text-body font-semibold text-accent-500">
                  {expanded ? 'Show less' : 'More about quiet chats'}
                </Text>
              </Pressable>

              {expanded && (
                <View className="gap-2 rounded-2xl border border-stone-200 bg-stone-50 p-4 dark:border-stone-700 dark:bg-stone-900">
                  <Text className="text-caption text-stone-500 dark:text-stone-400">
                    Only a chat that closes because you never replied counts, and only when it happens 2 or more
                    times in 60 days. Ending a chat honestly, pausing, or taking a few days to reply never counts.
                  </Text>
                  <Text className="text-caption text-stone-500 dark:text-stone-400">
                    It only changes where you appear in new people&apos;s suggestions for a while. It never shows on
                    your profile, nobody else sees it, and nobody reads your messages to decide it.
                  </Text>
                </View>
              )}
            </View>
          </ScrollView>
        )}

        <View className="gap-4 pt-6">
          {!isSupabaseConfigured && (
            <Text className="text-caption text-amber-600 dark:text-amber-400">
              Supabase isn&apos;t configured yet. See .env.example.
            </Text>
          )}

          {error && <Text className="text-caption text-red-600 dark:text-red-400">{error}</Text>}

          {step === 'question' && (
            <>
              <Pressable
                onPress={handleReady}
                disabled={saving || !isSupabaseConfigured}
                className={`flex-row items-center justify-center gap-2 rounded-full bg-stone-900 py-4 active:opacity-80 dark:bg-stone-50 ${
                  saving || !isSupabaseConfigured ? 'opacity-40' : ''
                }`}>
                {saving && <ActivityIndicator color={MUTED_ICON_COLOR} />}
                <Text className="text-body font-semibold text-stone-50 dark:text-stone-900">
                  {saving ? 'Saving...' : 'Sounds good'}
                </Text>
              </Pressable>
              <Pressable onPress={() => setStep('pause-options')} disabled={saving}>
                <Text className="text-center text-body text-stone-500 dark:text-stone-400">
                  I need more time
                </Text>
              </Pressable>
            </>
          )}
        </View>
      </PaddedSafeArea>
    </View>
  );
}
