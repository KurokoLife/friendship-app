import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { returnToMyAccount, useTestTools } from '@/lib/test-mode';

// A small floating reminder, shown on every screen while an admin is
// acting as a test account, with a one-tap way back.
export function TestModeBanner() {
  const { actingAs } = useTestTools();
  const [busy, setBusy] = useState(false);
  if (!actingAs) return null;

  return (
    // At the top of the screen (2026-10-08): at the bottom it sat exactly
    // where first-time tips appear above the tab bar, and a tip could cover
    // the "Back to my account" button.
    // pointerEvents must be the prop, not a style: react-native-web drops a
    // 'box-none' style, which made this full-width strip swallow taps on the
    // Back / Report / Block row underneath it (2026-10-09).
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, top: 6, alignItems: 'center', zIndex: 1000 }}>
      <View className="flex-row items-center gap-2 rounded-full bg-accent-500 py-1 pl-3 pr-1 shadow">
        <Text className="text-caption font-semibold text-white">Testing as {actingAs}</Text>
        <Pressable
          disabled={busy}
          onPress={async () => {
            setBusy(true);
            const { error } = await returnToMyAccount();
            setBusy(false);
            // If the saved session couldn't be restored, go to the start so
            // the person can sign in, instead of a blank Home.
            router.replace(error ? '/' : '/home');
          }}
          className="rounded-full bg-white px-3 py-1">
          <Text className="text-caption font-semibold text-accent-500">{busy ? 'Switching...' : 'Back to me'}</Text>
        </Pressable>
      </View>
    </View>
  );
}
