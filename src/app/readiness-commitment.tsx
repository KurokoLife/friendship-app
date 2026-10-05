import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { track } from '@/lib/analytics';
import { getDeviceId } from '@/lib/device-id';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400

type Step = 'question' | 'pause-options' | 'paused-confirmation';

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
    router.replace('/modules-complete');
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
      <SafeAreaView className="flex-1 justify-between px-6 py-10">
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
          <ScrollView contentContainerClassName="gap-5 pt-16" showsVerticalScrollIndicator={false}>
            <Text className="text-display text-stone-900 dark:text-stone-50">
              Building real friendship takes consistent effort, showing up even when life gets
              busy, following through when you say you will, being honest when you can&apos;t.
            </Text>
            <Text className="text-body text-stone-600 dark:text-stone-300">
              Are you in a place right now where you can do that, even imperfectly?
            </Text>

            {/* Friendship-only norm (docs/DECISIONS.md section 3, item 1).
                "Removal" is real: users.suspended_at hides the account and
                blocks messaging (migration 20261004000000). */}
            <View className="gap-2 rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-stone-800">
              <Text className="text-title text-stone-900 dark:text-stone-50">Limen is for friendship only</Text>
              <Text className="text-body text-stone-600 dark:text-stone-300">
                Romantic or sexual advances, or asking for money, lead to removal.
              </Text>
            </View>

            <View className="gap-4 rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-stone-800">
              <Text className="text-title text-stone-900 dark:text-stone-50">
                Keeping this community safe
              </Text>
              {/* This rule is real now (ghosting_events,
                  is_ghosting_penalized, migration 20261004000000). */}
              <Text className="text-body text-stone-600 dark:text-stone-300">
                To keep this community safe for people who genuinely show up, we track
                follow-through privately. If you let 2 or more conversations go silent until they
                close on their own (7 days with no reply and no honest exit) within 60 days,
                you&apos;re shown last in other people&apos;s suggestions for the next 30 days. This is
                never shown to anyone, never used to label you, and it resets on its own.
              </Text>

              <Pressable onPress={() => setExpanded((v) => !v)}>
                <Text className="text-body font-semibold text-accent-500">
                  {expanded ? 'Show less' : 'Tell me more'}
                </Text>
              </Pressable>

              {expanded && (
                <View className="gap-3 rounded-2xl border border-stone-200 bg-stone-50 p-4 dark:border-stone-700 dark:bg-stone-900">
                  <View className="gap-1">
                    <Text className="text-caption font-semibold text-stone-900 dark:text-stone-50">
                      What we track
                    </Text>
                    <Text className="text-caption text-stone-500 dark:text-stone-400">
                      Patterns like whether messages get a timely reply or an honest exit, and
                      whether meetups you agree to happen or get cancelled without rescheduling,
                      over time.
                    </Text>
                  </View>
                  <View className="gap-1">
                    <Text className="text-caption font-semibold text-stone-900 dark:text-stone-50">
                      What we don&apos;t track
                    </Text>
                    <Text className="text-caption text-stone-500 dark:text-stone-400">
                      The content of your messages is never scored, read for this purpose, or used
                      to rank you. None of this ever appears on your profile, as a badge, or as a
                      score, and it&apos;s never visible to other users.
                    </Text>
                    <Text className="text-caption text-stone-500 dark:text-stone-400">
                      One exception: early messages are checked on the receiver&apos;s phone against a
                      short list of words linked to scams, such as requests for money, so we can show
                      the receiver a safety note. Nothing is scored or stored.
                    </Text>
                  </View>
                  <View className="gap-1">
                    <Text className="text-caption font-semibold text-stone-900 dark:text-stone-50">
                      What it affects
                    </Text>
                    <Text className="text-caption text-stone-500 dark:text-stone-400">
                      Only where you appear in new people&apos;s suggestions, and only after a real
                      pattern (2 or more in 60 days). A single missed reply or an honest exit is
                      never held against you.
                    </Text>
                  </View>
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
                  {saving ? 'Saving...' : "Yes, I'm ready"}
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
      </SafeAreaView>
    </View>
  );
}
