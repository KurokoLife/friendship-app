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
import { SafeAreaView } from 'react-native-safe-area-context';

import { isSupabaseConfigured, supabase } from '@/lib/supabase';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Fix #1 (July 19 reconciliation session), Account Creation: email, added
// alongside the existing phone verification. Unlike display_name and
// birthdate, email is not called "required" in the given spec, so this
// screen is skippable, an account can complete onboarding without one.
//
// The user already has an active session at this point (phone
// verification already succeeded, verify-code.tsx). Adding an email to
// an already-authenticated session is a different Supabase Auth call than
// initial sign-in: supabase.auth.updateUser({ email }) triggers Supabase's
// own "confirm email change" flow and emails a confirmation link to the
// new address.
//
// Root-caused why this never actually worked (a real bug, not a doc
// error): this project is on the free tier using Supabase's own default
// mailer, which cannot render custom templates (confirmed directly,
// PATCHing the template returns "Email template modification is not
// available for free tier projects using the default email provider").
// The stock "Confirm your new email address" template only ever embeds
// {{ .ConfirmationURL }}, never {{ .Token }}, so a real user is never
// shown a code, only a link, no matter what any in-app screen expects.
// The previous code-entry screen (verify-email-code.tsx) was consequently
// unreachable through any real, legitimate path and has been removed.
// Since email is optional here, this screen no longer blocks continuing
// onboarding on that link actually being clicked: the confirmation link
// still works (mailer_secure_email_change and the app's own session-aware
// landing route both handle it whenever the user does click it, see
// src/app/index.tsx), but the user moves on immediately after the email
// is sent, matching "optional, skippable" and matching what the existing
// Skip button already did.
export default function EmailVerificationScreen() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSendLink = async () => {
    setError(null);
    const trimmed = email.trim();
    if (!EMAIL_PATTERN.test(trimmed)) {
      setError("That doesn't look like a complete email address.");
      return;
    }

    setSending(true);
    const { error: updateError } = await supabase.auth.updateUser({ email: trimmed });
    setSending(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setSent(true);
  };

  if (sent) {
    return (
      <KeyboardAvoidingView
        className="flex-1 bg-stone-50 dark:bg-stone-900"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <SafeAreaView className="flex-1 justify-between px-6 py-10">
          <Pressable onPress={() => router.replace('/phone-verification')}>
            <Text className="text-caption text-stone-500 dark:text-stone-400">Back</Text>
          </Pressable>

          <View className="gap-5">
            <View className="gap-3">
              <Text className="text-display text-stone-900 dark:text-stone-50">Check your email</Text>
              <Text className="text-body text-stone-500 dark:text-stone-400">
                We sent a confirmation link to {email.trim()}. Click it whenever you get a chance,
                you do not need to wait for it to keep going now.
              </Text>
            </View>
          </View>

          <Pressable
            onPress={() => router.replace('/profile-basics')}
            className="items-center rounded-full bg-stone-900 py-4 active:opacity-80 dark:bg-stone-50">
            <Text className="text-body font-semibold text-stone-50 dark:text-stone-900">Continue</Text>
          </Pressable>
        </SafeAreaView>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-stone-50 dark:bg-stone-900"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <SafeAreaView className="flex-1 justify-between px-6 py-10">
        <Pressable onPress={() => router.replace('/phone-verification')}>
          <Text className="text-caption text-stone-500 dark:text-stone-400">Back</Text>
        </Pressable>

        <View className="gap-5">
          <View className="gap-3">
            <Text className="text-display text-stone-900 dark:text-stone-50">
              What&apos;s your email?
            </Text>
            <Text className="text-body text-stone-500 dark:text-stone-400">
              We&apos;ll email you a link to confirm it. You can add this later if you&apos;d rather
              skip it for now.
            </Text>
          </View>

          {!isSupabaseConfigured && (
            <Text className="text-caption text-amber-600 dark:text-amber-400">
              Supabase isn&apos;t configured yet. See .env.example.
            </Text>
          )}

          <TextInput
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            className="rounded-xl border border-stone-300 px-3 py-3 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
            placeholder="you@example.com"
            placeholderTextColor={MUTED_ICON_COLOR}
          />

          {error && <Text className="text-caption text-red-600 dark:text-red-400">{error}</Text>}
        </View>

        <View className="gap-3">
          <Pressable
            onPress={handleSendLink}
            disabled={sending || !isSupabaseConfigured}
            className={`flex-row items-center justify-center gap-2 rounded-full bg-stone-900 py-4 active:opacity-80 dark:bg-stone-50 ${
              sending || !isSupabaseConfigured ? 'opacity-40' : ''
            }`}>
            {sending && <ActivityIndicator color={MUTED_ICON_COLOR} />}
            <Text className="text-body font-semibold text-stone-50 dark:text-stone-900">
              {sending ? 'Sending...' : 'Send link'}
            </Text>
          </Pressable>
          <Pressable onPress={() => router.replace('/profile-basics')} className="items-center py-2">
            <Text className="text-caption text-stone-500 dark:text-stone-400">Skip for now</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}
