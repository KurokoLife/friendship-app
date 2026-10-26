import { Ionicons } from '@expo/vector-icons';
import { Image, Pressable, Text, View, type GestureResponderEvent } from 'react-native';
import { useState, type ReactNode } from 'react';

import { circles, palette } from '@/theme';

// Taps (design guide v1, docs/context/05_LIMEN_REBUILD.md, "Taps"), one rule
// across the app:
// - Actions are pill buttons: one filled apricot pill for the main action,
//   outlined pills for the others; at most one filled button per card.
// - Anything that opens something is a whole tappable row with a chevron.
// - Links only inside sentences, accent color and underlined.
// - Touch targets at least 44px tall.

type PillProps = {
  label: string;
  onPress?: (e: GestureResponderEvent) => void;
  variant?: 'filled' | 'outline' | 'danger';
  icon?: keyof typeof Ionicons.glyphMap;
  disabled?: boolean;
  className?: string;
  accessibilityLabel?: string;
};

export function Pill({ label, onPress, variant = 'outline', icon, disabled, className = '', accessibilityLabel }: PillProps) {
  const filled = variant === 'filled';
  const danger = variant === 'danger';
  const textColor = filled ? '#FFFFFF' : danger ? '#B42318' : palette.ink;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      className={`min-h-11 flex-row items-center justify-center gap-2 rounded-full px-5 active:opacity-80 ${
        filled
          ? 'bg-apricot'
          : danger
            ? 'border border-red-200 bg-white dark:border-red-900 dark:bg-stone-800'
            : 'border border-outline bg-white dark:border-stone-600 dark:bg-stone-800'
      } ${disabled ? 'opacity-40' : ''} ${className}`}>
      {icon && <Ionicons name={icon} size={18} color={textColor} />}
      <Text
        className={`text-body font-semibold ${
          filled ? 'text-white' : danger ? 'text-red-700 dark:text-red-400' : 'text-stone-900 dark:text-stone-50'
        }`}>
        {label}
      </Text>
    </Pressable>
  );
}

// A link inside a sentence. Put it inside a <Text>.
export function InlineLink({ children, onPress }: { children: ReactNode; onPress: () => void }) {
  return (
    <Text
      onPress={onPress}
      accessibilityRole="link"
      className="font-semibold text-accent-500 underline dark:text-accent-400">
      {children}
    </Text>
  );
}

// A whole row that opens something, with a chevron.
export function RowLink({
  title,
  subtitle,
  left,
  onPress,
  accessibilityLabel,
  className = '',
}: {
  title: string;
  subtitle?: string | null;
  left?: ReactNode;
  onPress: () => void;
  accessibilityLabel?: string;
  className?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      className={`min-h-[64px] flex-row items-center gap-3 rounded-2xl border border-stone-200 bg-white px-[14px] py-3 active:opacity-80 dark:border-stone-700 dark:bg-stone-800 ${className}`}>
      {left}
      <View className="flex-1 gap-0.5">
        <Text className="text-body font-semibold text-stone-900 dark:text-stone-50" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? <Text className="text-caption text-stone-500 dark:text-stone-400">{subtitle}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={20} color={palette.muted} />
    </Pressable>
  );
}

export type CircleKey = keyof typeof circles;

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0];
  // "PoPo" -> "Po" like the mockup; a single short name -> its first letter.
  if (parts.length === 1) {
    const m = first.match(/^([A-Z][a-z])[A-Z]/);
    return m ? m[1] : first[0].toUpperCase();
  }
  return first[0].toUpperCase();
}

// A round face: the person's photo, or a colored initial by circle.
export function Face({
  name,
  photoUrl,
  circle,
  size = 40,
  ring = false,
}: {
  name: string;
  photoUrl?: string | null;
  circle: CircleKey;
  size?: number;
  ring?: boolean;
}) {
  const c = circles[circle];
  const border = ring ? { borderWidth: 3, borderColor: palette.card } : null;
  const [failed, setFailed] = useState(false);
  if (photoUrl && !failed) {
    return (
      <Image
        source={{ uri: photoUrl }}
        onError={() => setFailed(true)}
        accessibilityIgnoresInvertColors
        style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.face }, border]}
      />
    );
  }
  return (
    <View
      style={[
        { width: size, height: size, borderRadius: size / 2, backgroundColor: c.face, alignItems: 'center', justifyContent: 'center' },
        border,
      ]}>
      <Text style={{ color: c.text, fontSize: Math.round(size * 0.38), fontWeight: '700' }}>{initials(name)}</Text>
    </View>
  );
}

// One choice in a "pick any" list: the whole row is the tap target, with a
// checkbox on the left (stage 2, joining).
export function CheckRow({ label, checked, onPress }: { label: string; checked: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      aria-checked={checked}
      accessibilityLabel={label}
      className={`min-h-12 flex-row items-center gap-3 rounded-2xl border px-4 py-3 active:opacity-80 ${
        checked
          ? 'border-apricot bg-honey dark:border-apricot dark:bg-stone-800'
          : 'border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-800'
      }`}>
      <Ionicons name={checked ? 'checkbox' : 'square-outline'} size={22} color={checked ? palette.apricot : palette.muted} />
      <Text className="flex-1 text-body text-stone-900 dark:text-stone-50">{label}</Text>
    </Pressable>
  );
}
