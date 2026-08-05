import { Pressable, Text } from 'react-native';

// Shared between F7's mandatory wizard and F8's module detail screen so a
// scenario choice looks and behaves identically in both places.
export function ModuleChoiceRow({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`rounded-xl border px-4 py-3 ${
        selected
          ? 'border-stone-900 bg-stone-900 dark:border-stone-50 dark:bg-stone-50'
          : 'border-stone-300 dark:border-stone-700'
      }`}>
      <Text
        className={`text-body ${
          selected ? 'text-stone-50 dark:text-stone-900' : 'text-stone-900 dark:text-stone-50'
        }`}>
        {label}
      </Text>
    </Pressable>
  );
}
