import { router } from 'expo-router';
import { useState } from 'react';
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

import { authErrorDetail, friendlySendCodeError } from '@/lib/auth-errors';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { palette } from '@/theme';

const MUTED_ICON_COLOR = palette.muted;

function toE164(countryCode: string, number: string) {
  const countryDigits = countryCode.replace(/\D/g, '');
  const numberDigits = number.replace(/\D/g, '');
  return `+${countryDigits}${numberDigits}`;
}

export default function PhoneVerificationScreen() {
  const [countryCode, setCountryCode] = useState('+1');
  const [number, setNumber] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const handleSendCode = async () => {
    setError(null);
    setErrorDetail(null);
    const numberDigits = number.replace(/\D/g, '');
    if (numberDigits.length < 7 || numberDigits.length > 14) {
      setError("That doesn't look like a complete phone number.");
      return;
    }

    const phone = toE164(countryCode, number);
    setSending(true);
    const { error: sendError } = await supabase.auth.signInWithOtp({ phone });
    setSending(false);

    if (sendError) {
      setError(friendlySendCodeError(sendError));
      setErrorDetail(authErrorDetail(sendError));
      return;
    }

    router.push({ pathname: '/verify-code', params: { phone } });
  };

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-stone-50 dark:bg-stone-900"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <PaddedSafeArea className="flex-1 justify-between px-6 py-10">
        <Pressable onPress={() => router.replace('/philosophy-intro')} className="min-h-11 flex-row items-center justify-center rounded-full border px-4 active:opacity-70 border-outline dark:border-stone-600 self-start">
          <Text className="text-caption font-semibold text-stone-900 dark:text-stone-50">Back</Text>
        </Pressable>

        <View className="gap-5">
          <View className="gap-3">
            <Text className="text-display text-stone-900 dark:text-stone-50">
              What&apos;s your number?
            </Text>
            <Text className="text-body text-stone-500 dark:text-stone-400">
              We&apos;ll text you a code to make sure it&apos;s really you.
            </Text>
            <Text className="text-caption text-stone-500 dark:text-stone-400">
              New or returning, this is how you sign in.
            </Text>
          </View>

          {!isSupabaseConfigured && (
            <Text className="text-caption text-amber-600 dark:text-amber-400">
              Supabase isn&apos;t configured yet. Add EXPO_PUBLIC_SUPABASE_URL and
              EXPO_PUBLIC_SUPABASE_ANON_KEY to .env (see .env.example) before this can send a
              real code.
            </Text>
          )}

          <View className="flex-row gap-3">
            <TextInput
              value={countryCode}
              onChangeText={setCountryCode}
              keyboardType="phone-pad"
              className="w-16 rounded-xl border border-stone-300 px-3 py-3 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
              placeholder="+1"
              placeholderTextColor={MUTED_ICON_COLOR}
            />
            <TextInput
              value={number}
              onChangeText={setNumber}
              keyboardType="phone-pad"
              autoFocus
              className="flex-1 rounded-xl border border-stone-300 px-3 py-3 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
              placeholder="Phone number"
              placeholderTextColor={MUTED_ICON_COLOR}
            />
          </View>

          {/* SMS consent line, expected by carriers for A2P 10DLC opt-in
              where the number is collected. */}
          <Text className="text-caption text-stone-500 dark:text-stone-400">
            We&apos;ll text you a one-time code. Message and data rates may apply.
          </Text>

          {error && (
            <Text className="text-caption text-red-600 dark:text-red-400">{error}</Text>
          )}
          {error && errorDetail && (
            <Text className="text-[11px] text-stone-500 dark:text-stone-400">Details: {errorDetail}</Text>
          )}
        </View>

        <Pressable
          onPress={handleSendCode}
          disabled={sending || !isSupabaseConfigured}
          className={`flex-row items-center justify-center gap-2 rounded-full bg-apricot py-4 active:opacity-80 dark:bg-apricot ${
            sending || !isSupabaseConfigured ? 'opacity-40' : ''
          }`}>
          {sending && <ActivityIndicator color={MUTED_ICON_COLOR} />}
          <Text className="text-body font-semibold text-white">
            {sending ? 'Sending...' : 'Send code'}
          </Text>
        </Pressable>
      </PaddedSafeArea>
    </KeyboardAvoidingView>
  );
}
