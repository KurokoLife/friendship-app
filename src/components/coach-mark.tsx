import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { getSeenCoachMarks, markCoachMarkSeen, type CoachMarkKey } from '@/lib/coach-marks';
import { Pill } from '@/components/ui';

type Props = {
  markKey: CoachMarkKey;
  // Short heading, like "Your Inbox".
  title?: string;
  text: string;
  actionLabel?: string;
  onAction?: () => void;
  // Show only once this other tip has been closed, so a screen with two
  // tips shows them one at a time.
  after?: CoachMarkKey;
};

const seenListeners = new Set<(key: CoachMarkKey) => void>();

// First-time tips (2026-10-17): a calm card that sits in the page itself,
// where it was placed, shown once per account until "Got it". It used to be
// a floating box over a dimmed screen (the spotlight), which covered real
// buttons underneath: on the Profile tab, Settings and Guide did nothing
// until the tip was closed. A card in the page can never cover anything.
// "Show tips again" in Settings brings every tip back.
export function CoachMark({ markKey, title, text, actionLabel, onAction, after }: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const seen = await getSeenCoachMarks();
      if (!cancelled && !seen.has(markKey) && (!after || seen.has(after))) setVisible(true);
    })();
    const onSeen = (key: CoachMarkKey) => {
      if (key === after && !cancelled) {
        getSeenCoachMarks().then((seen) => !cancelled && !seen.has(markKey) && setVisible(true));
      }
    };
    seenListeners.add(onSeen);
    return () => {
      cancelled = true;
      seenListeners.delete(onSeen);
    };
  }, [markKey, after]);

  const dismiss = useCallback(() => {
    setVisible(false);
    markCoachMarkSeen(markKey);
    seenListeners.forEach((fn) => fn(markKey));
  }, [markKey]);

  if (!visible) return null;

  return (
    <View
      accessibilityRole="summary"
      className="gap-2 rounded-2xl border border-honey-line bg-honey p-4 dark:border-stone-700 dark:bg-stone-800">
      <Text className="text-caption font-semibold text-accent-600 dark:text-accent-400">
        {title ? `Tip · ${title}` : 'Tip'}
      </Text>
      <Text className="text-body text-stone-700 dark:text-stone-300">{text}</Text>
      <View className="flex-row flex-wrap items-center justify-end gap-2">
        {actionLabel && onAction && (
          <Pill
            label={actionLabel}
            onPress={() => {
              onAction();
              dismiss();
            }}
          />
        )}
        <Pill label="Got it" onPress={dismiss} />
      </View>
    </View>
  );
}
