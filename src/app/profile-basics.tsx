import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { calculateAge } from '@/lib/age';
import { track } from '@/lib/analytics';
import { publicName, saveProfileName } from '@/lib/names';
import { FRIENDLY_SAVE_ERROR } from '@/lib/auth-errors';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400

// Three plain number boxes, Month / Day / Year (docs/DECISIONS.md,
// onboarding screen 3): typing 1985-06-15 was unnatural for the 40+
// members Limen is built for. Still no native date picker, for the same
// stale-Metro-bundle reason earlier sessions documented. US order for the
// pilot; country-specific order comes later when Limen expands.
function parseBirthdate(monthText: string, dayText: string, yearText: string): Date | null {
  const m = Number(monthText.trim());
  const d = Number(dayText.trim());
  const y = Number(yearText.trim());
  if (!Number.isInteger(m) || !Number.isInteger(d) || !Number.isInteger(y)) return null;
  if (yearText.trim().length !== 4 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(y, m - 1, d);
  if (Number.isNaN(date.getTime())) return null;
  // Guards against a technically-parseable but nonexistent date (e.g.
  // 2020-02-30 silently rolling over to March 1st), Date's own
  // constructor accepts that, this catches it by checking the fields
  // round-trip exactly.
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
    return null;
  }
  return date;
}

// Fix #1, Account Creation: display_name and birthdate, both required
// (per the given spec, unlike email above), collected here rather than
// in profile-build.tsx, matching the blueprint's own Account Creation
// section ordering, ahead of the rest of profile building. Both columns
// already existed on `profiles` (added 20260711000005), just never
// written by any onboarding screen until now.
export default function ProfileBasicsScreen() {
  const colorScheme = useColorScheme();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [birthMonth, setBirthMonth] = useState('');
  const [birthDay, setBirthDay] = useState('');
  const [birthYear, setBirthYear] = useState('');
  const [referralCode, setReferralCode] = useState('');
  // 2026-08-01: real, explicit acceptance step (a required tap, not just
  // implied by continuing), confirmed genuinely missing from onboarding
  // before this. Placed here rather than a new dedicated screen: this is
  // the earliest point in onboarding a real `users` row is guaranteed to
  // exist to write terms_accepted_at onto (the same upsert already
  // happening below for the referral system), and the only personal data
  // collected before this screen is the phone number itself.
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleContinue = async () => {
    setError(null);

    if (!firstName.trim()) {
      setError('Enter your first name.');
      return;
    }
    if (!lastName.trim()) {
      setError('Enter your last name.');
      return;
    }

    const birthdate = parseBirthdate(birthMonth, birthDay, birthYear);
    if (!birthdate) {
      setError('Enter your birthdate as month, day, and a 4-digit year.');
      return;
    }

    if (birthdate.getTime() > Date.now()) {
      setError("That birthdate hasn't happened yet.");
      return;
    }

    // Adult-eligibility check at submission, per the given spec. Also
    // enforced server-side (profiles_birthdate_adult_check,
    // 20260719000002), this client check is just a faster, clearer
    // message, not the real boundary.
    if (calculateAge(birthdate) < 18) {
      setError('You need to be 18 or older to use this app.');
      return;
    }

    setSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSaving(false);
      setError('Your session expired. Please verify your phone number again.');
      return;
    }

    const isoBirthdate = `${birthdate.getFullYear()}-${String(birthdate.getMonth() + 1).padStart(2, '0')}-${String(
      birthdate.getDate()
    ).padStart(2, '0')}`;

    // gender-identity.tsx (the next screen) is the first screen that used
    // to unconditionally create a `users` row; redeeming a code here needs
    // one to already exist (redeem_referral_code writes to the caller's
    // own row, `update ... where id = auth.uid()` silently affects zero
    // rows against a row that doesn't exist yet). A minimal upsert here
    // guarantees it, and gives every account its own shareable
    // referral_code (auto-assigned by the users_set_referral_code trigger)
    // from the earliest real point in onboarding, not just once
    // gender-identity is reached.
    const [{ error: saveError }] = await Promise.all([
      saveProfileName(user.id, firstName, lastName, { birthdate: isoBirthdate }),
      supabase.from('users').upsert({ id: user.id, terms_accepted_at: new Date().toISOString() }),
    ]);

    // Optional, skippable, same tone as email above: an unrecognized code
    // doesn't block onboarding, it just silently doesn't get credited.
    // redeem_referral_code (not a plain client upsert) is the only way to
    // resolve a code to its owner at all, users' own SELECT RLS is
    // self-row only, and it enforces no-self-referral and "can only ever
    // be set once" atomically, see that function's own comment.
    if (referralCode.trim()) {
      const { data: redeemed } = await supabase.rpc('redeem_referral_code', { p_code: referralCode.trim() });
      if (redeemed) track('referral_redeemed');
    }

    setSaving(false);

    if (saveError) {
      setError(FRIENDLY_SAVE_ERROR);
      return;
    }

    // New order (docs/DECISIONS.md): Basics, then the optional
    // account-recovery screen, then Identity.
    router.replace('/account-recovery');
  };

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
            <Text className="text-display text-stone-900 dark:text-stone-50">A couple of basics</Text>
            <Text className="text-body text-stone-500 dark:text-stone-400">
              Your name and birthdate. Others see only your first name and last initial, and a
              general age range, never your full last name or exact birthdate.
            </Text>
          </View>

          {!isSupabaseConfigured && (
            <Text className="text-caption text-amber-600 dark:text-amber-400">
              Supabase isn&apos;t configured yet. See .env.example.
            </Text>
          )}

          <View className="flex-row gap-3">
            <View className="flex-1 gap-1">
              <Text className="text-caption text-stone-500 dark:text-stone-400">First name</Text>
              <TextInput
                value={firstName}
                onChangeText={setFirstName}
                autoFocus
                autoComplete="given-name"
                maxLength={40}
                className="rounded-xl border border-stone-300 px-3 py-3 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
                placeholder="First name"
                placeholderTextColor={MUTED_ICON_COLOR}
              />
            </View>
            <View className="flex-1 gap-1">
              <Text className="text-caption text-stone-500 dark:text-stone-400">Last name</Text>
              <TextInput
                value={lastName}
                onChangeText={setLastName}
                autoComplete="family-name"
                maxLength={40}
                className="rounded-xl border border-stone-300 px-3 py-3 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
                placeholder="Last name"
                placeholderTextColor={MUTED_ICON_COLOR}
              />
            </View>
          </View>
          {firstName.trim() && lastName.trim() ? (
            <Text className="-mt-3 text-caption text-stone-400 dark:text-stone-500">
              Others will see: {publicName(firstName, lastName)}
            </Text>
          ) : null}

          <View className="gap-1">
            <Text className="text-caption text-stone-500 dark:text-stone-400">Birthdate</Text>
            <View className="flex-row gap-3">
              <TextInput
                value={birthMonth}
                onChangeText={(t) => setBirthMonth(t.replace(/\D/g, '').slice(0, 2))}
                keyboardType="number-pad"
                maxLength={2}
                accessibilityLabel="Birth month"
                className="w-20 rounded-xl border border-stone-300 px-3 py-3 text-center text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
                placeholder="MM"
                placeholderTextColor={MUTED_ICON_COLOR}
              />
              <TextInput
                value={birthDay}
                onChangeText={(t) => setBirthDay(t.replace(/\D/g, '').slice(0, 2))}
                keyboardType="number-pad"
                maxLength={2}
                accessibilityLabel="Birth day"
                className="w-20 rounded-xl border border-stone-300 px-3 py-3 text-center text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
                placeholder="DD"
                placeholderTextColor={MUTED_ICON_COLOR}
              />
              <TextInput
                value={birthYear}
                onChangeText={(t) => setBirthYear(t.replace(/\D/g, '').slice(0, 4))}
                keyboardType="number-pad"
                maxLength={4}
                accessibilityLabel="Birth year"
                className="flex-1 rounded-xl border border-stone-300 px-3 py-3 text-center text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
                placeholder="YYYY"
                placeholderTextColor={MUTED_ICON_COLOR}
              />
            </View>
          </View>

          <View className="gap-1">
            <Text className="text-caption text-stone-500 dark:text-stone-400">Referral code (optional)</Text>
            <TextInput
              value={referralCode}
              onChangeText={setReferralCode}
              autoCapitalize="characters"
              className="rounded-xl border border-stone-300 px-3 py-3 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
              placeholder="Have a code from a friend?"
              placeholderTextColor={MUTED_ICON_COLOR}
            />
            {/* No reward is promised: Premium no longer exists (docs/DECISIONS.md). */}
            <Text className="text-caption text-stone-400 dark:text-stone-600">
              If a friend invited you, add their code. It helps us see how people find Limen.
            </Text>
          </View>

          <Pressable onPress={() => setTermsAccepted((v) => !v)} className="flex-row items-start gap-3">
            <View
              className={`mt-0.5 h-5 w-5 items-center justify-center rounded border ${
                termsAccepted
                  ? 'border-stone-900 bg-stone-900 dark:border-stone-50 dark:bg-stone-50'
                  : 'border-stone-400 dark:border-stone-600'
              }`}>
              {termsAccepted && (
                <Ionicons name="checkmark" size={14} color={colorScheme === 'dark' ? '#1c1917' : '#fafaf9'} />
              )}
            </View>
            <Text className="flex-1 text-caption text-stone-500 dark:text-stone-400">
              I agree to the{' '}
              <Text className="font-semibold text-accent-500" onPress={() => router.push('/terms')}>
                Terms of Service
              </Text>{' '}
              and{' '}
              <Text className="font-semibold text-accent-500" onPress={() => router.push('/privacy')}>
                Privacy Policy
              </Text>
              .
            </Text>
          </Pressable>

          {error && <Text className="text-caption text-red-600 dark:text-red-400">{error}</Text>}
        </View>

        <Pressable
          onPress={handleContinue}
          disabled={saving || !isSupabaseConfigured || !termsAccepted}
          className={`flex-row items-center justify-center gap-2 rounded-full bg-stone-900 py-4 active:opacity-80 dark:bg-stone-50 ${
            saving || !isSupabaseConfigured || !termsAccepted ? 'opacity-40' : ''
          }`}>
          {saving && <ActivityIndicator color={MUTED_ICON_COLOR} />}
          <Text className="text-body font-semibold text-stone-50 dark:text-stone-900">
            {saving ? 'Saving...' : 'Continue'}
          </Text>
        </Pressable>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}
