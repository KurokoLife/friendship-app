import { Fragment, useEffect, useState } from 'react';
import { Modal, Pressable, Text, View, useWindowDimensions } from 'react-native';

import {
  computeDimmingRegions,
  subscribeActiveCoachMarks,
  type ActiveCoachMark,
  type SpotlightRect,
} from '@/lib/spotlight';

const ACCENT_COLOR = '#B5643B'; // accent-500
const RING_PADDING = 6;

function padRect(rect: SpotlightRect, pad: number): SpotlightRect {
  return { x: rect.x - pad, y: rect.y - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 };
}

// One shared overlay for every currently-active coach mark (see the header
// comment in src/lib/spotlight.ts for why this is a single host rather than
// each CoachMark rendering its own Modal: two independently-dimmed, full-
// screen layers would re-cover each other's spotlight the moment both are
// open at once, a real, confirmed case in this app). Mounted once at the
// app root (src/app/_layout.tsx). Renders nothing when no coach mark is
// currently visible, matching the same "no visual footprint until earned"
// behavior the plain banner card always had.
export function SpotlightHost() {
  const [marks, setMarks] = useState<ActiveCoachMark[]>([]);
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  useEffect(() => subscribeActiveCoachMarks(setMarks), []);

  if (marks.length === 0) return null;

  const paddedRects = marks.map((m) => padRect(m.rect, RING_PADDING));
  const dimmingRegions = computeDimmingRegions(
    { x: 0, y: 0, width: screenWidth, height: screenHeight },
    paddedRects
  );

  return (
    <Modal visible transparent animationType="fade">
      <View className="flex-1" style={{ pointerEvents: 'box-none' }}>
        {/* Purely visual: no pointerEvents set here used to mean the
            default 'auto', so these regions silently blocked taps to
            whatever real UI sat underneath them (confirmed live, 2026-08-23
            session: a coach mark on a freshly-visited tab could block
            navigating to a different tab until that mark was explicitly
            dismissed). 'none' keeps the dimming purely visual, matching
            this app's own "gentle, once, dismissible hint" intent, not a
            blocking modal tour, without changing anything about the
            mark's own seen/dismissed tracking. */}
        {dimmingRegions.map((region, i) => (
          <View
            key={i}
            style={{
              position: 'absolute',
              left: region.x,
              top: region.y,
              width: region.width,
              height: region.height,
              backgroundColor: 'rgba(0,0,0,0.55)',
              pointerEvents: 'none',
            }}
          />
        ))}

        {marks.map((mark, i) => {
          const ring = paddedRects[i];
          const tooltipWidth = Math.min(320, screenWidth - 32);
          const spaceBelow = screenHeight - (ring.y + ring.height);
          const placeBelow = spaceBelow > 160 || spaceBelow > ring.y;
          const left = Math.min(
            Math.max(ring.x + ring.width / 2 - tooltipWidth / 2, 16),
            screenWidth - 16 - tooltipWidth
          );

          return (
            // A plain Fragment, not a View: an unstyled View here would sit
            // in the outer flex-1 container's normal column flow at zero
            // size, meaning `bottom: X` on the tooltip below would be
            // measured against a zero-height parent and render off-screen,
            // a real bug this session's own first live test caught (the
            // ring, which only ever uses top/left, rendered correctly; the
            // tooltip, which uses bottom for anything near the bottom of
            // the screen like a tab icon, did not, until this fix). A
            // Fragment makes both children direct siblings of the correctly
            // full-sized flex-1 container instead.
            <Fragment key={mark.markKey}>
              {/* The lit-up ring around the actual target element. Radius
                  scales with the shorter side so a small, roughly-square
                  tab icon gets a soft circular ring while a wide card gets
                  a rectangular one, matching each element's own shape. */}
              <View
                style={{
                  pointerEvents: 'none',
                  position: 'absolute',
                  left: ring.x,
                  top: ring.y,
                  width: ring.width,
                  height: ring.height,
                  borderWidth: 3,
                  borderColor: ACCENT_COLOR,
                  borderRadius: Math.min(24, Math.min(ring.width, ring.height) / 2),
                  boxShadow: `0px 0px 8px ${ACCENT_COLOR}99`,
                  elevation: 6,
                }}
              />

              <View
                style={{
                  position: 'absolute',
                  left,
                  width: tooltipWidth,
                  ...(placeBelow ? { top: ring.y + ring.height + 12 } : { bottom: screenHeight - ring.y + 12 }),
                }}
                className="gap-3 rounded-2xl border border-accent-500/50 bg-stone-50 p-4 shadow-lg dark:bg-stone-900">
                <Text className="text-body text-stone-700 dark:text-stone-300">{mark.text}</Text>
                <View className="flex-row items-center justify-end gap-4">
                  {mark.actionLabel && mark.onAction && (
                    <Pressable
                      onPress={() => {
                        mark.onAction?.();
                        mark.onDismiss();
                      }}>
                      <Text className="text-caption font-semibold text-accent-500">{mark.actionLabel}</Text>
                    </Pressable>
                  )}
                  <Pressable onPress={mark.onDismiss}>
                    <Text className="text-caption font-semibold text-stone-400 dark:text-stone-600">Got it</Text>
                  </Pressable>
                </View>
              </View>
            </Fragment>
          );
        })}
      </View>
    </Modal>
  );
}
