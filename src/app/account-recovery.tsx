import { FontAwesome5, Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { isSupabaseConfigured, supabase } from '@/lib/supabase';

// Onboarding screen 4 (docs/DECISIONS.md): one optional screen replacing
// the old Email and Social linking screens. Phone stays the required
// sign-in; this only adds a way to recover the account. Google or Apple
// fill in an email automatically and also earn the "verified" badge
// (users.social_linked), the email option keeps the old link-based
// confirmation flow. Facebook, LinkedIn and the Instagram placeholder are
// gone. Google and Apple must be switched on in Supabase (Authentication,
// Providers) before these buttons work; until then they show a plain
// "not available yet" message instead of a raw error.

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400
const ACCENT_COLOR = '#B5643B'; // accent-500
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Provider = 'google' | 'apple';

const PROVIDERS: { provider: Provider; label: string; icon: string }[] = [
  { provider: 'google', label: 'Continue with Google', icon: 'google' },
  { provider: 'apple', label: 'Continue with Apple', icon: 'apple' },
];

async function markSocialLinked() {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from('users').upsert({ id: user.id, social_linked: true });
}

export default function AccountRecoveryScreen() {
  const [linked, setLinked] = useState<Record<Provider, boolean>>({ google: false, apple: false });
  const [linkingProvider, setLinkingProvider] = useState<Provider | null>(null);
  const [mode, setMode] = useState<'choose' | 'email' | 'email-sent'>('choose');
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshIdentities = async () => {
    const { data } = await supabase.auth.getUserIdentities();
    const providers = new Set((data?.identities ?? []).map((identity) => identity.provider));
    const next = { google: providers.has('google'), apple: providers.has('apple') };
    setLinked(next);
    if (next.google || next.apple) await markSocialLinked();
  };

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    // Web OAuth comes back to this same route with ?code=..., finish the
    // exchange here.
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      if (url.searchParams.get('code')) {
        supabase.auth.exchangeCodeForSession(window.location.href).then(({ error: exchangeError }) => {
          if (exchangeError) setError("That didn't finish linking. Try again, or skip for now.");
          else refreshIdentities();
          window.history.replaceState({}, '', url.pathname);
        });
        return;
      }
    }
    refreshIdentities();
  }, []);

  const handleLink = async (provider: Provider) => {
    setError(null);
    setLinkingProvider(provider);
    const redirectTo = Linking.createURL('account-recovery');
    const { data, error: linkError } = await supabase.auth.linkIdentity({
      provider,
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (linkError || !data?.url) {
      setError(
        provider === 'apple'
          ? "Apple isn't available here yet. You can use Google or an email instead, or skip for now."
          : "Google isn't available here yet. You can use an email instead, or skip for now."
      );
      setLinkingProvider(null);
      return;
    }
    if (Platform.OS === 'web') {
      window.location.href = data.url;
      return;
    }
    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (result.type === 'success' && result.url) {
      const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(result.url);
      if (exchangeError) setError("That didn't finish linking. Try again, or skip for now.");
      else await refreshIdentities();
    }
    setLinkingProvider(null);
  };

  const handleSendEmailLink = async () => {
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
      setError("We couldn't send a link to that address. Check it and try again.");
      return;
    }
    setMode('email-sent');
  };

  const goNext = () => router.replace('/gender-identity');
  const hasLinked = linked.google || linked.apple;

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-stone-50 dark:bg-stone-900"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <SafeAreaView className="flex-1 px-6 py-10">
        <Pressable onPress={() => (mode === 'choose' ? router.replace('/profile-basics') : setMode('choose'))}>
          <Text className="text-caption text-stone-500 dark:text-stone-400">Back</Text>
        </Pressable>

        <ScrollView className="flex-1" contentContainerClassName="gap-5 pt-6" showsVerticalScrollIndicator={false}>
          <View className="gap-3">
            <Text className="text-display text-stone-900 dark:text-stone-50">Add a way to recover your account</Text>
            <Text className="text-body text-stone-500 dark:text-stone-400">
              Optional. We&apos;ll only use this to recover your account or send important updates. Linking
              Google or Apple also shows a &quot;verified&quot; badge on your profile.
            </Text>
          </View>

          {mode === 'choose' && (
            <View className="gap-3">
              {PROVIDERS.map(({ provider, label, icon }) => (
                <Pressable
                  key={provider}
                  onPress={() => handleLink(provider)}
                  disabled={linked[provider] || linkingProvider !== null}
                  className={`flex-row items-center gap-4 rounded-2xl border bg-white px-4 py-4 active:opacity-70 dark:bg-stone-800 ${
                    linked[provider] ? 'border-accent-300 dark:border-accent-700' : 'border-stone-200 dark:border-stone-700'
                  }`}>
                  <FontAwesome5 name={icon} size={18} color={MUTED_ICON_COLOR} />
                  <Text className="flex-1 text-body text-stone-900 dark:text-stone-50">
                    {linked[provider] ? `${provider === 'google' ? 'Google' : 'Apple'} linked` : label}
                  </Text>
                  {linkingProvider === provider ? (
                    <ActivityIndicator color={MUTED_ICON_COLOR} />
                  ) : linked[provider] ? (
                    <Ionicons name="checkmark-circle" size={22} color={ACCENT_COLOR} />
                  ) : null}
                </Pressable>
              ))}

              <Pressable
                onPress={() => {
                  setError(null);
                  setMode('email');
                }}
                className="flex-row items-center gap-4 rounded-2xl border border-stone-200 bg-white px-4 py-4 active:opacity-70 dark:border-stone-700 dark:bg-stone-800">
                <Ionicons name="mail-outline" size={20} color={MUTED_ICON_COLOR} />
                <Text className="flex-1 text-body text-stone-900 dark:text-stone-50">Use an email instead</Text>
              </Pressable>
            </View>
          )}

          {mode === 'email' && (
            <View className="gap-3">
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
              <Pressable
                onPress={handleSendEmailLink}
                disabled={sending}
                className={`flex-row items-center justify-center gap-2 rounded-full border border-stone-900 py-3 dark:border-stone-50 ${
                  sending ? 'opacity-40' : ''
                }`}>
                {sending && <ActivityIndicator color={MUTED_ICON_COLOR} />}
                <Text className="text-body font-semibold text-stone-900 dark:text-stone-50">
                  {sending ? 'Sending...' : 'Send confirmation link'}
                </Text>
              </Pressable>
            </View>
          )}

          {mode === 'email-sent' && (
            <Text className="text-body text-stone-500 dark:text-stone-400">
              We sent a confirmation link to {email.trim()}. Click it whenever you get a chance, you don&apos;t
              need to wait for it to keep going.
            </Text>
          )}

          {!isSupabaseConfigured && (
            <Text className="text-caption text-amber-600 dark:text-amber-400">
              Supabase isn&apos;t configured yet. See .env.example.
            </Text>
          )}
          {error && <Text className="text-caption text-red-600 dark:text-red-400">{error}</Text>}
        </ScrollView>

        <View className="gap-2 pt-4">
          {hasLinked || mode === 'email-sent' ? (
            <Pressable
              onPress={goNext}
              className="items-center rounded-full bg-stone-900 py-4 active:opacity-80 dark:bg-stone-50">
              <Text className="text-body font-semibold text-stone-50 dark:text-stone-900">Continue</Text>
            </Pressable>
          ) : (
            <Pressable onPress={goNext} className="items-center py-3">
              <Text className="text-body text-stone-500 dark:text-stone-400">Skip for now</Text>
            </Pressable>
          )}
        </View>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}
