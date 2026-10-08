import { Platform, Text, TextInput, View, useColorScheme } from 'react-native';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400

// Date and time inputs for meetup plans (2026-10-08). On the web these are
// the browser's own date and time pickers. In the phone app they are plain
// text fields (no native picker package is installed): the date as
// YYYY-MM-DD, the time typed freely ("10:30 am", "7pm").

function webInputStyle(dark: boolean) {
  return {
    width: '100%',
    boxSizing: 'border-box' as const,
    borderRadius: 12,
    border: `1px solid ${dark ? '#44403c' : '#d6d3d1'}`,
    padding: '9px 12px',
    fontSize: 16,
    fontFamily: 'inherit',
    background: 'transparent',
    color: dark ? '#fafaf9' : '#1c1917',
    colorScheme: dark ? 'dark' : 'light',
  };
}

export function FieldLabel({ label, optional }: { label: string; optional?: boolean }) {
  return (
    <Text className="text-caption text-stone-500 dark:text-stone-400">
      {label}
      {optional ? <Text className="text-stone-400 dark:text-stone-500"> (optional)</Text> : null}
    </Text>
  );
}

export function DateField({
  value,
  onChange,
  min,
  disabled,
}: {
  value: string;
  onChange: (iso: string) => void;
  min?: string;
  disabled?: boolean;
}) {
  const dark = useColorScheme() === 'dark';
  if (Platform.OS === 'web') {
    return (
      <View>
        <input
          type="date"
          aria-label="Date"
          value={value}
          min={min}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          style={webInputStyle(dark)}
        />
      </View>
    );
  }
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder="YYYY-MM-DD"
      placeholderTextColor={MUTED_ICON_COLOR}
      autoCapitalize="none"
      editable={!disabled}
      className="rounded-xl border border-stone-300 px-3 py-2 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
    />
  );
}

// Web: value is "HH:MM" from the browser picker. Phone: free text, parsed
// by the caller with parseTimeInput().
export function TimeField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (text: string) => void;
  disabled?: boolean;
}) {
  const dark = useColorScheme() === 'dark';
  if (Platform.OS === 'web') {
    return (
      <View>
        <input
          type="time"
          aria-label="Time"
          value={value}
          step={300}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          style={webInputStyle(dark)}
        />
      </View>
    );
  }
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder="e.g. 10:30 am"
      placeholderTextColor={MUTED_ICON_COLOR}
      autoCapitalize="none"
      editable={!disabled}
      className="rounded-xl border border-stone-300 px-3 py-2 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
    />
  );
}
