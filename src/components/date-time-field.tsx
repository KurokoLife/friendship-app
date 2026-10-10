import { View, useColorScheme } from 'react-native';

// Web version of the meetup date and time fields (2026-10-08): the
// browser's own date and time pickers. The phone app uses
// date-time-field.native.tsx (the phone's own pickers).

export { FieldLabel } from './date-time-field.shared';

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

export function DateField({
  value,
  onChange,
  min,
  max,
  disabled,
}: {
  value: string;
  onChange: (iso: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
}) {
  const dark = useColorScheme() === 'dark';
  return (
    <View>
      <input
        type="date"
        aria-label="Date"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        style={webInputStyle(dark)}
      />
    </View>
  );
}

// value is "HH:MM" (24-hour) or "" when no time is set.
export function TimeField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (hhmm: string) => void;
  disabled?: boolean;
}) {
  const dark = useColorScheme() === 'dark';
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
