import { Tabs } from 'expo-router';
import { useWindowDimensions } from 'react-native';

import { AppTabBar } from '@/components/app-tab-bar';
import { useAccountKey } from '@/lib/account-key';
import { useTestTools } from '@/lib/test-mode';
import { layout } from '@/theme';

// Four tabs (rebuild stage 1, 2026-10-25, docs/context/05_LIMEN_REBUILD.md):
// Your circle (home) · Chats · Discover · You, plus Test for admins and test
// accounts. Route names stay as they were (/inbox is Chats, /home is
// Discover, /profile is You) so existing links keep working; Your circle is
// /circle. Design guide v1 (stage 1b): a bottom bar on phones; on screens
// wider than ~720px the tabs move to a top bar and each screen sits in a
// centered column. Detail screens (a chat, a profile) are Stack pushes on top.
export default function TabsLayout() {
  const { allowed: showTestTab } = useTestTools();
  const accountKey = useAccountKey();
  const { width } = useWindowDimensions();
  const wide = width > layout.wideAt;
  const visible = ['circle', 'inbox', 'home', 'profile', ...(showTestTab ? ['dev'] : [])];

  return (
    <Tabs
      key={accountKey}
      initialRouteName="circle"
      tabBar={(props) => <AppTabBar {...props} wide={wide} visible={visible} />}
      screenOptions={{
        headerShown: false,
        tabBarPosition: wide ? 'top' : 'bottom',
        sceneStyle: wide ? { width: '100%', maxWidth: layout.column, alignSelf: 'center' } : undefined,
      }}>
      <Tabs.Screen name="circle" options={{ title: 'Your circle' }} />
      <Tabs.Screen name="inbox" options={{ title: 'Chats' }} />
      <Tabs.Screen name="home" options={{ title: 'Discover' }} />
      <Tabs.Screen name="profile" options={{ title: 'You' }} />
      {/* Browse was removed in Limen v2 (2026-10-03); the route file stays
          so old links don't crash. */}
      <Tabs.Screen name="browse" options={{ href: null }} />
      <Tabs.Screen name="dev" options={showTestTab ? { title: 'Test' } : { href: null }} />
    </Tabs>
  );
}
