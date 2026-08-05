import { Ionicons } from '@expo/vector-icons';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400

type VoiceTextInputProps = {
  value: string;
  onChangeText: (text: string) => void;
  onBlur?: () => void;
  placeholder: string;
  numberOfLines?: number;
  minHeightClassName?: string;
};

// Voice-to-text via expo-speech-recognition, a native module (with a web
// fallback, but no Expo Go support on iOS/Android, it needs a custom dev
// build, see PROGRESS.md). Tapping the mic starts a session; live interim
// results are appended after whatever text was already in the field, so
// dictating doesn't erase existing writing. Tapping again (or the
// recognizer ending on its own) stops it. The result lands in the same
// plain TextInput as before, fully editable afterward, this only adds a
// way to fill it by speaking.
export function VoiceTextInput({
  value,
  onChangeText,
  onBlur,
  placeholder,
  numberOfLines = 4,
  minHeightClassName = 'min-h-24',
}: VoiceTextInputProps) {
  const [recognizing, setRecognizing] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const baseTextRef = useRef('');

  useSpeechRecognitionEvent('start', () => setRecognizing(true));
  useSpeechRecognitionEvent('end', () => setRecognizing(false));
  useSpeechRecognitionEvent('result', (event) => {
    const transcript = event.results[0]?.transcript ?? '';
    const base = baseTextRef.current;
    onChangeText(base ? `${base} ${transcript}` : transcript);
  });
  useSpeechRecognitionEvent('error', (event) => {
    setRecognizing(false);
    setMicError(event.message || 'Voice input ran into a problem.');
  });

  const toggleRecording = async () => {
    if (recognizing) {
      ExpoSpeechRecognitionModule.stop();
      return;
    }
    setMicError(null);
    try {
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) {
        setMicError('Microphone permission was not granted.');
        return;
      }
      baseTextRef.current = value.trim();
      ExpoSpeechRecognitionModule.start({
        lang: 'en-US',
        interimResults: true,
        continuous: false,
      });
    } catch {
      setMicError('Voice input needs a custom dev build, it is not available in Expo Go.');
    }
  };

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
          onPress={toggleRecording}
          className={`absolute right-2 top-2 h-8 w-8 items-center justify-center rounded-full ${
            recognizing ? 'bg-accent-500' : 'bg-stone-100 dark:bg-stone-700'
          }`}>
          <Ionicons
            name={recognizing ? 'mic' : 'mic-outline'}
            size={16}
            color={recognizing ? '#fff' : MUTED_ICON_COLOR}
          />
        </Pressable>
      </View>
      {micError && (
        <Text className="text-caption text-amber-600 dark:text-amber-400">{micError}</Text>
      )}
    </View>
  );
}
