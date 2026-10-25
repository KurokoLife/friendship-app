import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { PaddedSafeArea } from '@/components/padded-safe-area';

import { authErrorDetail, friendlySendCodeError, friendlyVerifyCodeError } from '@/lib/auth-errors';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { palette } from '@/theme';
import { InlineLink } from '@/components/ui';

const MUTED_ICON_COLOR = palette.muted;
const RESEND_COOLDOWN_SECONDS = 30;

export default function VerifyCodeScreen() {
  const { phone } = useLocalSearchParams<{ phone: string }>();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);

  useEffect(() => {
    if (cooldown === 0) return;
    const timer = setTimeout(() => setCooldown((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const handleVerify = async () => {
    setError(null);
    setErrorDetail(null);
    if (code.length !== 6) {
      setError('Enter the 6-digit code we texted you.');
      return;
    }

    setVerifying(true);
    const { error: verifyError } = await supabase.auth.verifyOtp({
      phone,
      token: code,
      type: 'sms',
    });
    setVerifying(false);

    if (verifyError) {
      setError(friendlyVerifyCodeError(verifyError));
      setErrorDetail(authErrorDetail(verifyError));
      return;
    }

    // Fix #1 (July 19 reconciliation session): Account Creation continues
    // with email/name/birthdate collection before Identity and Friend
    // Preferences (gender-identity.tsx), instead of jumping straight
    // there. See email-verification.tsx for why email is skippable while
    // profile-basics.tsx's name/birthdate are not.
    // The root route decides where to go: a returning member lands on Home
    // or Inbox, a new one continues to Basics (docs/DECISIONS.md, the
    // account-recovery screen now comes after Basics).
    router.replace('/');
  };

  const handleResend = async () => {
    setError(null);
    setErrorDetail(null);
    setResending(true);
    const { error: resendError } = await supabase.auth.signInWithOtp({ phone });
    setResending(false);

    if (resendError) {
      setError(friendlySendCodeError(resendError));
      setErrorDetail(authErrorDetail(resendError));
      return;
    }

    setCooldown(RESEND_COOLDOWN_SECONDS);
  };

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-stone-50 dark:bg-stone-900"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <PaddedSafeArea className="flex-1 justify-between px-6 py-10">
        <Pressable onPress={() => router.replace('/phone-verification')} className="min-h-11 flex-row items-center justify-center rounded-full border px-4 active:opacity-70 border-outline dark:border-stone-600 self-start">
          <Text className="text-caption font-semibold text-stone-900 dark:text-stone-50">Back</Text>
        </Pressable>

        <View className="gap-5">
          <View className="gap-3">
            <Text className="text-display text-stone-900 dark:text-stone-50">
              Enter the code
            </Text>
            <Text className="text-body text-stone-500 dark:text-stone-400">
              We texted a 6-digit code to {phone}.
            </Text>
          </View>

          <TextInput
            value={code}
            onChangeText={(text) => setCode(text.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad"
            maxLength={6}
            autoFocus
            className="rounded-xl border border-stone-300 px-3 py-3 text-center text-2xl tracking-[8px] text-stone-900 dark:border-stone-700 dark:text-stone-50"
            placeholder="000000"
            placeholderTextColor={MUTED_ICON_COLOR}
          />

          {error && (
            <Text className="text-caption text-red-600 dark:text-red-400">{error}</Text>
          )}
          {error && errorDetail && (
            <Text className="text-[11px] text-stone-500 dark:text-stone-400">Details: {errorDetail}</Text>
          )}

          <Pressable className="min-h-11 flex-row items-center justify-center rounded-full border px-4 active:opacity-70 border-outline dark:border-stone-600" onPress={handleResend} disabled={resending || cooldown > 0}>
            <Text
              className={`text-caption font-semibold text-stone-900 dark:text-stone-50 ${cooldown > 0 ? 'opacity-40' : ''}`}>
              {cooldown > 0
                ? `Resend code in ${cooldown}s`
                : resending
                  ? 'Resending...'
                  : 'Resend code'}
            </Text>
          </Pressable>

          <Text className="text-center text-caption text-stone-500 dark:text-stone-400">
            Wrong number? <InlineLink onPress={() => router.replace('/phone-verification')}>Change it</InlineLink>
          </Text>
        </View>

        <Pressable
          onPress={handleVerify}
          disabled={verifying || !isSupabaseConfigured}
          className={`flex-row items-center justify-center gap-2 rounded-full bg-apricot py-4 active:opacity-80 dark:bg-apricot ${
            verifying || !isSupabaseConfigured ? 'opacity-40' : ''
          }`}>
          {verifying && <ActivityIndicator color={MUTED_ICON_COLOR} />}
          <Text className="text-body font-semibold text-white">
            {verifying ? 'Verifying...' : 'Verify'}
          </Text>
        </Pressable>
      </PaddedSafeArea>
    </KeyboardAvoidingView>
  );
}
