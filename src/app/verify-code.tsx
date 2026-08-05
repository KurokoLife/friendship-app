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
import { SafeAreaView } from 'react-native-safe-area-context';

import { isSupabaseConfigured, supabase } from '@/lib/supabase';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400
const RESEND_COOLDOWN_SECONDS = 30;

export default function VerifyCodeScreen() {
  const { phone } = useLocalSearchParams<{ phone: string }>();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
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
      setError(verifyError.message);
      return;
    }

    // Fix #1 (July 19 reconciliation session): Account Creation continues
    // with email/name/birthdate collection before Identity and Friend
    // Preferences (gender-identity.tsx), instead of jumping straight
    // there. See email-verification.tsx for why email is skippable while
    // profile-basics.tsx's name/birthdate are not.
    router.replace('/email-verification');
  };

  const handleResend = async () => {
    setError(null);
    setResending(true);
    const { error: resendError } = await supabase.auth.signInWithOtp({ phone });
    setResending(false);

    if (resendError) {
      setError(resendError.message);
      return;
    }

    setCooldown(RESEND_COOLDOWN_SECONDS);
  };

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-stone-50 dark:bg-stone-900"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <SafeAreaView className="flex-1 justify-between px-6 py-10">
        <View />

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

          <Pressable onPress={handleResend} disabled={resending || cooldown > 0}>
            <Text
              className={`text-caption dark:text-stone-400 ${
                cooldown > 0 ? 'text-stone-300 dark:text-stone-700' : 'text-stone-500'
              }`}>
              {cooldown > 0
                ? `Resend code in ${cooldown}s`
                : resending
                  ? 'Resending...'
                  : 'Resend code'}
            </Text>
          </Pressable>
        </View>

        <Pressable
          onPress={handleVerify}
          disabled={verifying || !isSupabaseConfigured}
          className={`flex-row items-center justify-center gap-2 rounded-full bg-stone-900 py-4 active:opacity-80 dark:bg-stone-50 ${
            verifying || !isSupabaseConfigured ? 'opacity-40' : ''
          }`}>
          {verifying && <ActivityIndicator color={MUTED_ICON_COLOR} />}
          <Text className="text-body font-semibold text-stone-50 dark:text-stone-900">
            {verifying ? 'Verifying...' : 'Verify'}
          </Text>
        </Pressable>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}
