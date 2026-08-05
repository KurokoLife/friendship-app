import { useRef, type ReactNode } from 'react';
import { View } from 'react-native';

import type { CoachMarkKey } from '@/lib/coach-marks';
import { registerSpotlightTarget } from '@/lib/spotlight';

type Props = {
  markKey: CoachMarkKey;
  children: ReactNode;
};

// Marks the REAL element a coach mark refers to, when that element isn't
// where the coach mark itself renders (a tab icon lives in the tab bar,
// not on the screen it labels; a prompt/checkin card sits beside its own
// coach mark but is the thing that should actually light up, not the
// tooltip text). Measures on every layout via measureInWindow (screen-
// relative coordinates, not parent-relative, which is what a full-screen
// overlay needs to draw a cutout in the right place) and republishes to
// the shared spotlight store; CoachMark reads the latest value for its own
// markKey. collapsable={false} works around a real, documented Android
// view-flattening optimization that can otherwise drop a plain wrapper
// View from the native tree before it's ever measurable.
export function SpotlightTarget({ markKey, children }: Props) {
  const ref = useRef<View>(null);

  const measure = () => {
    // A second measureInWindow call scheduled just after layout: on both
    // platforms the very first layout pass can fire before the element's
    // final on-screen position (safe-area insets, tab bar height) has
    // settled, and an over-eager first reading would register a stale
    // rect the coach mark then spotlights in the wrong place.
    ref.current?.measureInWindow((x, y, width, height) => {
      if (width > 0 && height > 0) registerSpotlightTarget(markKey, { x, y, width, height });
    });
  };

  return (
    <View ref={ref} collapsable={false} onLayout={measure}>
      {children}
    </View>
  );
}
