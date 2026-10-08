import DateTimePicker, { DateTimePickerAndroid, type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';

import { formatMeetupDay, formatMeetupTime, parseIsoDate, toIsoDate } from '@/lib/meetup-format';

// Phone app version of the meetup date and time fields (2026-10-08): the
// phone's own pickers instead of typing. On Android the system picker opens
// as a dialog; on iPhone it opens under the field with a Done button.
// The web version is date-time-field.tsx (the browser's own pickers).

export { FieldLabel } from './date-time-field.shared';

function timeToDate(hhmm: string): Date {
  const d = new Date();
  const [h, m] = hhmm.split(':').map(Number);
  d.setHours(Number.isNaN(h) ? 12 : h, Number.isNaN(m) ? 0 : m, 0, 0);
  return d;
}

function hhmmOf(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function FieldButton({ label, placeholder, onPress, disabled }: { label: string | null; placeholder: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className="rounded-xl border border-stone-300 px-3 py-3 dark:border-stone-700">
      <Text className={`text-body ${label ? 'text-stone-900 dark:text-stone-50' : 'text-stone-400'}`}>
        {label ?? placeholder}
      </Text>
    </Pressable>
  );
}

function IosPicker({
  mode,
  value,
  min,
  onChange,
  onDone,
}: {
  mode: 'date' | 'time';
  value: Date;
  min?: Date;
  onChange: (d: Date) => void;
  onDone: () => void;
}) {
  return (
    <View className="gap-2">
      <DateTimePicker
        mode={mode}
        value={value}
        minimumDate={min}
        minuteInterval={5}
        display={mode === 'date' ? 'inline' : 'spinner'}
        onChange={(_e: DateTimePickerEvent, d?: Date) => d && onChange(d)}
      />
      <Pressable onPress={onDone} className="self-end px-2 py-1">
        <Text className="text-caption font-semibold text-accent-500">Done</Text>
      </Pressable>
    </View>
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
  const [open, setOpen] = useState(false);
  const minDate = min ? parseIsoDate(min) : undefined;
  const current = value ? parseIsoDate(value) : minDate ?? new Date();

  const show = () => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        mode: 'date',
        value: current,
        minimumDate: minDate,
        onChange: (e: DateTimePickerEvent, d?: Date) => {
          if (e.type === 'set' && d) onChange(toIsoDate(d));
        },
      });
    } else {
      if (!value) onChange(toIsoDate(current));
      setOpen((o) => !o);
    }
  };

  return (
    <View className="gap-2">
      <FieldButton label={value ? formatMeetupDay(value) : null} placeholder="Choose a date" onPress={show} disabled={disabled} />
      {open && Platform.OS === 'ios' && (
        <IosPicker mode="date" value={current} min={minDate} onChange={(d) => onChange(toIsoDate(d))} onDone={() => setOpen(false)} />
      )}
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
  const [open, setOpen] = useState(false);
  const current = value ? timeToDate(value) : timeToDate('12:00');

  const show = () => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        mode: 'time',
        value: current,
        is24Hour: false,
        onChange: (e: DateTimePickerEvent, d?: Date) => {
          if (e.type === 'set' && d) onChange(hhmmOf(d));
        },
      });
    } else {
      if (!value) onChange(hhmmOf(current));
      setOpen((o) => !o);
    }
  };

  return (
    <View className="gap-2">
      <View className="flex-row items-center gap-3">
        <View className="flex-1">
          <FieldButton label={formatMeetupTime(value)} placeholder="Choose a time" onPress={show} disabled={disabled} />
        </View>
        {value ? (
          <Pressable
            onPress={() => {
              onChange('');
              setOpen(false);
            }}
            disabled={disabled}>
            <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">Clear</Text>
          </Pressable>
        ) : null}
      </View>
      {open && Platform.OS === 'ios' && (
        <IosPicker mode="time" value={current} onChange={(d) => onChange(hhmmOf(d))} onDone={() => setOpen(false)} />
      )}
    </View>
  );
}
