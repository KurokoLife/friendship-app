import FontAwesome5 from '@expo/vector-icons/FontAwesome5';
import Ionicons from '@expo/vector-icons/Ionicons';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { AppState, useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { SpotlightHost } from '@/components/spotlight-host';
import { TestModeBanner } from '@/components/test-mode-banner';
import { initAnalytics } from '@/lib/analytics';
import { clearCoachMarksCache } from '@/lib/coach-marks';
import { recordActiveDayIfSignedIn } from '@/lib/referral';
import { supabase } from '@/lib/supabase';
import '@/global.css';

initAnalytics();

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();

  // @expo/vector-icons renders nothing until its font has loaded, so
  // preload it here rather than per-screen. Otherwise icons can silently
  // never appear depending on load timing.
  const [iconFontsLoaded] = useFonts({
    ...FontAwesome5.font,
    ...Ionicons.font,
  });

  // Referral 14-active-day tracking: this is the one component mounted
  // for the app's entire lifetime, so it's the reliable place to record
  // "the app was genuinely open with a real session today" (no-op for a
  // signed-out visitor, see recordActiveDayIfSignedIn).
  //
  // A real bug was caught live testing the first version of this effect:
  // calling recordActiveDayIfSignedIn() once on mount with an empty dep
  // array missed real sign-ins entirely. supabase-js restores a persisted
  // session asynchronously, so a mount-time call can fire before that
  // restore finishes and see no user; and because the effect never runs
  // again, a sign-in that happens LATER in the same JS session (finishing
  // phone verification, switching accounts via the Dev tab) never
  // retriggered it either. Fixed by driving this off
  // supabase.auth.onAuthStateChange instead of a one-shot mount call: it
  // fires once with the real session after startup hydration completes
  // (covers the original cold-start case correctly) and again on every
  // real sign-in and token refresh (covers everything the old mount-only
  // version silently missed). recordActiveDayIfSignedIn's own no-op-if-
  // signed-out check makes it safe to call on every event unconditionally.
  // The AppState listener stays as a second trigger for a narrower case
  // onAuthStateChange doesn't cover: a session that was already valid
  // sitting untouched in the background across a real calendar-day
  // boundary, with no new sign-in or token refresh to fire an auth event.
  useEffect(() => {
    const { data: authListener } = supabase.auth.onAuthStateChange(() => {
      recordActiveDayIfSignedIn();
      // Coach marks (20260820000000): clears the shared in-memory "seen"
      // cache on every real auth event, cheap and safe to call
      // unconditionally, same reasoning recordActiveDayIfSignedIn already
      // established, so a Dev-tab account switch never reuses one
      // account's seen marks for another's.
      clearCoachMarksCache();
    });
    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        recordActiveDayIfSignedIn();
      }
    });
    return () => {
      authListener.subscription.unsubscribe();
      appStateSubscription.remove();
    };
  }, []);

  if (!iconFontsLoaded) {
    return null;
  }

  return (
    <SafeAreaProvider>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <AnimatedSplashOverlay />
        <Stack screenOptions={{ headerShown: false }} />
        <SpotlightHost />
        <TestModeBanner />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
