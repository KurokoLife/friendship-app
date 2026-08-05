import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';

import { getSeenCoachMarks, markCoachMarkSeen, type CoachMarkKey } from '@/lib/coach-marks';
import {
  getSpotlightTarget,
  registerActiveCoachMark,
  subscribeSpotlightTarget,
  unregisterActiveCoachMark,
  type SpotlightRect,
} from '@/lib/spotlight';

type Props = {
  markKey: CoachMarkKey;
  text: string;
  // Optional second action alongside the plain dismiss ("Got it"), e.g.
  // credits_premium's "See Premium" routing to /premium. Tapping it also
  // dismisses the coach mark, matching how every other dismiss path here
  // works, it isn't a separate, un-dismissing action.
  actionLabel?: string;
  onAction?: () => void;
};

// Renders no visible content of its own anymore (2026-08-22, spotlight
// rollout). Instead: checks the same "seen" tracking as before (unchanged,
// see coach-marks.ts), resolves a real on-screen rect for what this coach
// mark refers to, and registers with the one shared SpotlightHost (mounted
// at the app root) to actually draw the dimming/ring/tooltip. The rect
// comes from one of two sources:
//  - an explicit <SpotlightTarget markKey=...> elsewhere in the tree, for
//    the 6 tab icons and the 2 prompt/checkin cards, whose real element
//    isn't this component's own rendered position;
//  - this component's own on-screen position, self-measured via the
//    invisible placeholder below, for credits_premium's 6 surfaces, whose
//    own card already contains the real "See Premium" action, so there's
//    no separate element to point at instead.
// The invisible placeholder also keeps the exact same layout space
// reserved that the old visible banner used to occupy, so no screen's
// layout shifts as a side effect of this change.
export function CoachMark({ markKey, text, actionLabel, onAction }: Props) {
  const [visible, setVisible] = useState(false);
  const [rect, setRect] = useState<SpotlightRect | null>(null);
  const selfRef = useRef<View>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const seen = await getSeenCoachMarks();
      if (!cancelled && !seen.has(markKey)) setVisible(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [markKey]);

  useEffect(() => {
    if (!visible) return;
    const existing = getSpotlightTarget(markKey);
    if (existing) setRect(existing);
    return subscribeSpotlightTarget(markKey, setRect);
  }, [visible, markKey]);

  const selfMeasure = useCallback(() => {
    // An external SpotlightTarget for this key always wins if one exists;
    // this is only ever the fallback for a key nothing else claims.
    if (getSpotlightTarget(markKey)) return;
    selfRef.current?.measureInWindow((x, y, width, height) => {
      if (width > 0 && height > 0 && !getSpotlightTarget(markKey)) {
        setRect((prev) => prev ?? { x, y, width, height });
      }
    });
  }, [markKey]);

  const handleDismiss = useCallback(() => {
    setVisible(false);
    unregisterActiveCoachMark(markKey);
    markCoachMarkSeen(markKey);
  }, [markKey]);

  useEffect(() => {
    if (!visible || !rect) return;
    registerActiveCoachMark({ markKey, rect, text, actionLabel, onAction, onDismiss: handleDismiss });
    return () => unregisterActiveCoachMark(markKey);
  }, [visible, rect, markKey, text, actionLabel, onAction, handleDismiss]);

  if (!visible) return null;

  // Renders the same card shape the old visible banner used (text plus its
  // actionLabel/"Got it" row), but invisible (opacity 0, not unmounted),
  // for two reasons: it reserves the exact layout space the visible banner
  // used to occupy so nothing on the screen shifts, and its real rendered
  // size is what self-measurement reports as the target rect for
  // credits_premium's 6 surfaces (an empty View would measure 0x0 and
  // never resolve a rect at all).
  return (
    <View
      ref={selfRef}
      collapsable={false}
      onLayout={selfMeasure}
      style={{ opacity: 0, pointerEvents: 'none' }}
      className="flex-row items-start gap-3 rounded-2xl border border-accent-500/40 bg-accent-500/5 p-4">
      <Text className="flex-1 text-body text-stone-700 dark:text-stone-300">{text}</Text>
      <View className="items-end gap-2">
        {actionLabel && <Text className="text-caption font-semibold text-accent-500">{actionLabel}</Text>}
        <Text className="text-caption font-semibold text-stone-400 dark:text-stone-600">Got it</Text>
      </View>
    </View>
  );
}
