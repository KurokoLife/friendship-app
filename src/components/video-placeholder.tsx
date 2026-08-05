import { Ionicons } from '@expo/vector-icons';
import { Text, View } from 'react-native';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400

// Real video generation comes later; every module (F7's two mandatory ones
// and F8's library) shows this same placeholder card in the meantime.
// TODO: once the real video files for "Begin With Curiosity" and "How We
// Show Up" exist, connect them here (or in whatever real video component
// replaces this placeholder) keyed off `label`/the module id, this file is
// the single place both onboarding video slots currently render through.
export function VideoPlaceholder({ label }: { label?: string }) {
  return (
    <View className="items-center justify-center gap-2 rounded-2xl border border-stone-200 bg-stone-100 py-10 dark:border-stone-700 dark:bg-stone-800">
      <Ionicons name="play-circle" size={40} color={MUTED_ICON_COLOR} />
      <Text className="text-caption text-stone-400 dark:text-stone-500">
        {label ? `${label}: video coming soon` : 'Video coming soon'}
      </Text>
    </View>
  );
}
