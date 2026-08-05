import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400

// UI-only placeholder for future voice-to-text, positioned and styled to
// match VoiceTextInput's real mic button exactly (see voice-text-input.tsx),
// so the two look identical wherever they appear. Unlike VoiceTextInput,
// this requests no permission, captures no audio, and transcribes nothing.
// Tapping toggles a brief inline note rather than doing nothing, so the
// icon reads as an intentional placeholder rather than a broken control.
// Caller is responsible for wrapping its TextInput's container in
// `relative` and adding right padding (pr-12) so typed text doesn't run
// under the icon, the same layout VoiceTextInput's own field already uses.
export function MicPlaceholderButton() {
  const [tapped, setTapped] = useState(false);

  return (
    <View className="absolute right-2 top-2 z-10 items-end">
      <Pressable
        onPress={() => setTapped((v) => !v)}
        className="h-8 w-8 items-center justify-center rounded-full bg-stone-100 dark:bg-stone-700">
        <Ionicons name="mic-outline" size={16} color={MUTED_ICON_COLOR} />
      </Pressable>
      {tapped && (
        <Text className="mt-1 max-w-[110px] text-right text-caption text-stone-400 dark:text-stone-600">
          Voice input coming soon
        </Text>
      )}
    </View>
  );
}
