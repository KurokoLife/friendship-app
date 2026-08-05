import { Ionicons } from '@expo/vector-icons';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { useState, type ComponentType } from 'react';
import { Platform, Pressable, Text, TextInput, View } from 'react-native';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400

export type VoiceTextInputProps = {
  value: string;
  onChangeText: (text: string) => void;
  onBlur?: () => void;
  placeholder: string;
  numberOfLines?: number;
  minHeightClassName?: string;
};

const NOT_AVAILABLE_MESSAGE = 'Voice input needs a custom dev build, it is not available in Expo Go.';

// Voice-to-text via expo-speech-recognition, a native module. On a real
// custom dev build it works; under stock Expo Go the native module isn't
// linked, and importing that package throws SYNCHRONOUSLY at module-eval
// time, not just when you try to use it (2026-08-25 bug: this file used to
// statically `import` it, and since expo-router eagerly requires every
// route file, including profile-build.tsx which uses this component, to
// build its route table at boot, that throw crashed the entire app on
// launch under Expo Go, regardless of which screen was open).
//
// Fixed by never letting a static `import` of expo-speech-recognition sit
// anywhere in this file's or any eagerly-required file's top level. The
// real implementation lives in voice-text-input-native.tsx, and it is only
// ever reached via the runtime-conditional `require()` below, which Metro
// does NOT hoist/eagerly-evaluate the way it does an `import` statement, so
// under Expo Go this line is simply never reached and the crashing package
// is never touched. This mirrors this app's own existing convention for a
// native-only feature that can't work in Expo Go (see ai-credits.ts/
// premium.ts's react-native-iap usage): the control still renders and is
// still tappable, tapping it surfaces a clear, calm explanation instead of
// silently failing or being hidden, rather than a new "hide it" pattern.
const isExpoGo =
  Platform.OS !== 'web' && Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

const VoiceTextInputNative: ComponentType<VoiceTextInputProps> | null = isExpoGo
  ? null
  : (require('./voice-text-input-native') as typeof import('./voice-text-input-native'))
      .VoiceTextInputNative;

function VoiceTextInputExpoGoFallback({
  value,
  onChangeText,
  onBlur,
  placeholder,
  numberOfLines = 4,
  minHeightClassName = 'min-h-24',
}: VoiceTextInputProps) {
  const [showMessage, setShowMessage] = useState(false);

  return (
    <View className="gap-1">
      <View className="relative">
        <TextInput
          value={value}
          onChangeText={onChangeText}
          onBlur={onBlur}
          multiline
          numberOfLines={numberOfLines}
          placeholder={placeholder}
          placeholderTextColor={MUTED_ICON_COLOR}
          textAlignVertical="top"
          className={`${minHeightClassName} rounded-xl border border-stone-300 px-3 py-3 pr-12 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50`}
        />
        <Pressable
          onPress={() => setShowMessage(true)}
          className="absolute right-2 top-2 h-8 w-8 items-center justify-center rounded-full bg-stone-100 dark:bg-stone-700">
          <Ionicons name="mic-outline" size={16} color={MUTED_ICON_COLOR} />
        </Pressable>
      </View>
      {showMessage && (
        <Text className="text-caption text-amber-600 dark:text-amber-400">
          {NOT_AVAILABLE_MESSAGE}
        </Text>
      )}
    </View>
  );
}

export function VoiceTextInput(props: VoiceTextInputProps) {
  if (isExpoGo || !VoiceTextInputNative) {
    return <VoiceTextInputExpoGoFallback {...props} />;
  }
  return <VoiceTextInputNative {...props} />;
}
