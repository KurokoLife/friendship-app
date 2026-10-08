import { Text } from 'react-native';

export function FieldLabel({ label, optional }: { label: string; optional?: boolean }) {
  return (
    <Text className="text-caption text-stone-500 dark:text-stone-400">
      {label}
      {optional ? <Text className="text-stone-400 dark:text-stone-500"> (optional)</Text> : null}
    </Text>
  );
}
