import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useColorScheme } from 'react-native';

import { SpotlightTarget } from '@/components/spotlight-target';

const ACCENT_COLOR = '#B5643B'; // accent-500
const MUTED_ICON_COLOR = '#a8a29e'; // stone-400

// F16: the app's first persistent tab bar, home.tsx moved here from
// src/app/home.tsx (a route group, "(tabs)" isn't part of the URL, so
// this is still /home, every existing router.push/replace('/home') call
// elsewhere in the app needed no changes). Everything before this was a
// deliberate bare Stack ("Onboarding is a linear flow"), tabs only make
// sense now that there's more than one top-level destination in the main
// app (Discover, Inbox). Detail screens (candidate profile, a message
// thread, a module) are still plain Stack pushes on top of this, not
// additional tabs, a chat thread shouldn't keep the tab bar visible.
export default function TabsLayout() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: ACCENT_COLOR,
        tabBarInactiveTintColor: MUTED_ICON_COLOR,
        tabBarStyle: {
          backgroundColor: isDark ? '#1c1917' : '#fafaf9', // stone-900 / stone-50
          borderTopColor: isDark ? '#292524' : '#e7e5e4', // stone-800 / stone-200
          borderTopWidth: 1,
        },
      }}>
      <Tabs.Screen
        name="home"
        options={{
          title: 'Discover',
          tabBarIcon: ({ color, size }) => (
            <SpotlightTarget markKey="tab_discover">
              <Ionicons name="sparkles-outline" size={size} color={color} />
            </SpotlightTarget>
          ),
        }}
      />
      {/* Limen v2 (2026-10-03): Browse is removed from the tab bar.
          Endless browsing works against commitment (choice overload,
          D'Angelo & Toma 2017); discovery is a small weekly set in
          Discover instead. The route file stays so nothing deep-linking
          to it crashes, but href: null removes it from navigation.
          See docs/LIMEN_V2_DECISIONS.md. */}
      <Tabs.Screen name="browse" options={{ href: null }} />
      <Tabs.Screen
        name="saved"
        options={{
          title: 'Saved',
          tabBarIcon: ({ color, size }) => (
            <SpotlightTarget markKey="tab_saved">
              <Ionicons name="bookmark-outline" size={size} color={color} />
            </SpotlightTarget>
          ),
        }}
      />
      <Tabs.Screen
        name="inbox"
        options={{
          title: 'Inbox',
          tabBarIcon: ({ color, size }) => (
            <SpotlightTarget markKey="tab_inbox">
              <Ionicons name="chatbubble-outline" size={size} color={color} />
            </SpotlightTarget>
          ),
        }}
      />
      <Tabs.Screen
        name="remember"
        options={{
          title: 'Remember',
          tabBarIcon: ({ color, size }) => (
            <SpotlightTarget markKey="tab_remember">
              <Ionicons name="book-outline" size={size} color={color} />
            </SpotlightTarget>
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => (
            <SpotlightTarget markKey="tab_profile">
              <Ionicons name="person-outline" size={size} color={color} />
            </SpotlightTarget>
          ),
        }}
      />
      {/* __DEV__-only account switcher. Always declared (Expo Router needs
          a Tabs.Screen per route file to control its tab bar presence),
          but href: null in production fully excludes it from the tab bar
          and from tab navigation, not just hides its icon. dev.tsx also
          self-guards with `if (!__DEV__) return null` as a second,
          independent layer. */}
      <Tabs.Screen
        name="dev"
        options={
          __DEV__
            ? {
                title: 'Dev',
                tabBarIcon: ({ color, size }) => (
                  <Ionicons name="build-outline" size={size} color={color} />
                ),
              }
            : { href: null }
        }
      />
    </Tabs>
  );
}
