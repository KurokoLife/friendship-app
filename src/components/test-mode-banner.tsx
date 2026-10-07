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
    <View style={{ position: 'absolute', left: 0, right: 0, bottom: 72, alignItems: 'center', pointerEvents: 'box-none' }}>
      <View className="flex-row items-center gap-3 rounded-full bg-accent-500 px-4 py-2 shadow">
        <Text className="text-caption font-semibold text-white">Testing as {actingAs}</Text>
        <Pressable
          disabled={busy}
          onPress={async () => {
            setBusy(true);
            await returnToMyAccount();
            setBusy(false);
            router.replace('/home');
          }}
          className="rounded-full bg-white px-3 py-1">
          <Text className="text-caption font-semibold text-accent-500">{busy ? 'Switching...' : 'Back to my account'}</Text>
        </Pressable>
      </View>
    </View>
  );
}
