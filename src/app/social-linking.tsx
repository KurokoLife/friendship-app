import { FontAwesome5, Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { isSupabaseConfigured, supabase } from '@/lib/supabase';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400
const ACCENT_COLOR = '#B5643B'; // accent-500, sparing use for the "linked" state

type OAuthProvider = 'facebook' | 'linkedin_oidc' | 'google';

const OAUTH_PROVIDERS: {
  provider: OAuthProvider;
  label: string;
  icon: string;
  chipBackground: string;
  chipBorder?: string;
  iconColor: string;
}[] = [
  {
    provider: 'facebook',
    label: 'Link Facebook',
    icon: 'facebook',
    chipBackground: '#1877F2',
    iconColor: 'white',
  },
  {
    provider: 'linkedin_oidc',
    label: 'Link LinkedIn',
    icon: 'linkedin-in',
    chipBackground: '#0A66C2',
    iconColor: 'white',
  },
  {
    provider: 'google',
    label: 'Link Google',
    icon: 'google',
    // No brand gradient here. Google's real "neutral" button style is a
    // light chip with a border and a dark glyph, which fits the restrained
    // direction better than approximating their four-color mark.
    chipBackground: '#F5F5F4',
    chipBorder: '#D6D3D1',
    iconColor: '#44403C',
  },
];

const INSTAGRAM_GRADIENT: [string, string, ...string[]] = ['#f9ce34', '#ee2a7b', '#6228d7'];

async function markSocialLinked() {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from('users').upsert({ id: user.id, social_linked: true });
}

function IconChip({
  icon,
  iconColor,
  background,
  border,
  gradient,
}: {
  icon: string;
  iconColor: string;
  background?: string;
  border?: string;
  gradient?: readonly [string, string, ...string[]];
}) {
  const content = <FontAwesome5 name={icon} size={17} color={iconColor} />;
  const size = { height: 44, width: 44, borderRadius: 12, alignItems: 'center' as const, justifyContent: 'center' as const };

  if (gradient) {
    return (
      <LinearGradient colors={gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={size}>
        {content}
      </LinearGradient>
    );
  }
  return (
    <View style={[size, { backgroundColor: background, borderWidth: border ? 1 : 0, borderColor: border }]}>
      {content}
    </View>
  );
}

function SocialCard({
  label,
  icon,
  iconColor,
  chipBackground,
  chipBorder,
  gradient,
  linked,
  loading,
  onPress,
}: {
  label: string;
  icon: string;
  iconColor: string;
  chipBackground?: string;
  chipBorder?: string;
  gradient?: readonly [string, string, ...string[]];
  linked: boolean;
  loading: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={linked || loading}
      className={`flex-row items-center gap-4 rounded-2xl border bg-white px-4 py-5 active:opacity-70 dark:bg-stone-800 ${
        linked ? 'border-accent-300 dark:border-accent-700' : 'border-stone-200 dark:border-stone-700'
      } ${loading ? 'opacity-60' : ''}`}>
      <IconChip icon={icon} iconColor={iconColor} background={chipBackground} border={chipBorder} gradient={gradient} />
      <Text className="flex-1 text-body text-stone-900 dark:text-stone-50">
        {linked ? `${label.replace('Link ', '')} linked` : label}
      </Text>
      {loading ? (
        <ActivityIndicator color={MUTED_ICON_COLOR} />
      ) : linked ? (
        <Ionicons name="checkmark-circle" size={22} color={ACCENT_COLOR} />
      ) : (
        <Ionicons name="chevron-forward" size={20} color={MUTED_ICON_COLOR} />
      )}
    </Pressable>
  );
}

export default function SocialLinkingScreen() {
  const [linked, setLinked] = useState<Record<OAuthProvider, boolean>>({
    facebook: false,
    linkedin_oidc: false,
    google: false,
  });
  const [linkingProvider, setLinkingProvider] = useState<OAuthProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const refreshIdentities = async () => {
    const { data } = await supabase.auth.getUserIdentities();
    const linkedProviders = new Set((data?.identities ?? []).map((identity) => identity.provider));
    const next = {
      facebook: linkedProviders.has('facebook'),
      linkedin_oidc: linkedProviders.has('linkedin_oidc'),
      google: linkedProviders.has('google'),
    };
    setLinked(next);
    if (next.facebook || next.linkedin_oidc || next.google) {
      await markSocialLinked();
    }
  };

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    // On web, Supabase redirects back to this screen with a `code` param
    // after the OAuth provider completes.
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      const code = url.searchParams.get('code');
      if (code) {
        supabase.auth.exchangeCodeForSession(window.location.href).then(({ error: exchangeError }) => {
          if (exchangeError) {
            setError(exchangeError.message);
          } else {
            refreshIdentities();
          }
          window.history.replaceState({}, '', url.pathname);
        });
        return;
      }
    }

    refreshIdentities();
  }, []);

  const handleLink = async (provider: OAuthProvider) => {
    setError(null);
    setInfo(null);
    setLinkingProvider(provider);

    const redirectTo = Linking.createURL('social-linking');
    const { data, error: linkError } = await supabase.auth.linkIdentity({
      provider,
      options: { redirectTo, skipBrowserRedirect: true },
    });

    if (linkError || !data?.url) {
      setError(linkError?.message ?? 'Something went wrong. Please try again.');
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
      if (exchangeError) {
        setError(exchangeError.message);
      } else {
        await refreshIdentities();
      }
    }
    setLinkingProvider(null);
  };

  const handleInstagramPress = () => {
    setError(null);
    setInfo("Instagram linking isn't available yet. Check back soon.");
  };

  const hasLinkedAny = linked.facebook || linked.linkedin_oidc || linked.google;

  return (
    <View className="flex-1 bg-stone-50 dark:bg-stone-900">
      <SafeAreaView className="flex-1 justify-between px-6 py-10">
        <Pressable onPress={() => router.replace('/gender-identity')}>
          <Text className="text-caption text-stone-500 dark:text-stone-400">Back</Text>
        </Pressable>

        <View className="gap-6">
          <View className="gap-3">
            <Text className="text-display text-stone-900 dark:text-stone-50">
              Link a social account
            </Text>
            <Text className="text-body text-stone-500 dark:text-stone-400">
              Linking an account earns you a verified identity badge on your profile. People
              tend to trust verified profiles more. It&apos;s optional, and you can always skip
              for now.
            </Text>
          </View>

          <View className="gap-3">
            <SocialCard
              label="Link Instagram"
              icon="instagram"
              iconColor="white"
              gradient={INSTAGRAM_GRADIENT}
              linked={false}
              loading={false}
              onPress={handleInstagramPress}
            />
            {OAUTH_PROVIDERS.map(({ provider, label, icon, chipBackground, chipBorder, iconColor }) => (
              <SocialCard
                key={provider}
                label={label}
                icon={icon}
                iconColor={iconColor}
                chipBackground={chipBackground}
                chipBorder={chipBorder}
                linked={linked[provider]}
                loading={linkingProvider === provider}
                onPress={() => handleLink(provider)}
              />
            ))}
          </View>

          {!isSupabaseConfigured && (
            <Text className="text-caption text-amber-600 dark:text-amber-400">
              Supabase isn&apos;t configured yet. See .env.example.
            </Text>
          )}
          {info && <Text className="text-caption text-amber-600 dark:text-amber-400">{info}</Text>}
          {error && <Text className="text-caption text-red-600 dark:text-red-400">{error}</Text>}
        </View>

        {hasLinkedAny ? (
          <Pressable
            onPress={() => router.replace('/profile-build')}
            className="items-center rounded-full bg-stone-900 py-4 active:opacity-80 dark:bg-stone-50">
            <Text className="text-body font-semibold text-stone-50 dark:text-stone-900">
              Continue
            </Text>
          </Pressable>
        ) : (
          <Pressable onPress={() => router.replace('/profile-build')} className="items-center py-3">
            <Text className="text-caption text-stone-400 dark:text-stone-600">Skip for now</Text>
          </Pressable>
        )}
      </SafeAreaView>
    </View>
  );
}
