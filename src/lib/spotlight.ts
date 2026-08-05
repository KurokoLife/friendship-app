import type { CoachMarkKey } from './coach-marks';

export type SpotlightRect = { x: number; y: number; width: number; height: number };

// Part 1: target rects. Written by <SpotlightTarget markKey=...> wrapping
// the REAL element a coach mark refers to (a tab icon, a specific prompt
// card) when that element lives somewhere other than the coach mark's own
// rendered position. CoachMark reads this to decide what to spotlight;
// falls back to measuring its own position when nothing is registered
// (credits_premium's 6 surfaces: its own card already contains the real
// "See Premium" button, so there's no separate element to point at).
const targetRects = new Map<CoachMarkKey, SpotlightRect>();
const targetListeners = new Map<CoachMarkKey, Set<(rect: SpotlightRect) => void>>();

export function registerSpotlightTarget(key: CoachMarkKey, rect: SpotlightRect): void {
  targetRects.set(key, rect);
  targetListeners.get(key)?.forEach((fn) => fn(rect));
}

export function unregisterSpotlightTarget(key: CoachMarkKey): void {
  targetRects.delete(key);
}

export function getSpotlightTarget(key: CoachMarkKey): SpotlightRect | undefined {
  return targetRects.get(key);
}

export function subscribeSpotlightTarget(key: CoachMarkKey, listener: (rect: SpotlightRect) => void): () => void {
  if (!targetListeners.has(key)) targetListeners.set(key, new Set());
  targetListeners.get(key)!.add(listener);
  return () => targetListeners.get(key)?.delete(listener);
}

// Part 2: active tooltips. Written by a CoachMark instance once it has
// resolved both "am I unseen" (existing coach_marks_seen logic, untouched)
// and "where is my target rect" (Part 1). Read by the one shared
// SpotlightHost, mounted once at the app root, which renders the dimming +
// spotlight ring + anchored tooltip for every currently-active entry. A
// single shared host, rather than each CoachMark rendering its own Modal,
// is what makes 2 simultaneously-active coach marks (a real, confirmed
// case: an active no-ghost prompt plus a credits-blocked draft attempt on
// the same thread screen, see the 2026-08-20 session) render as one
// correctly-composited dimming layer with two real cutouts, instead of two
// independent full-screen dimming layers stacking on top of each other and
// re-covering one another's spotlight.
export type ActiveCoachMark = {
  markKey: CoachMarkKey;
  rect: SpotlightRect;
  text: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss: () => void;
};

const activeMarks = new Map<CoachMarkKey, ActiveCoachMark>();
const activeListeners = new Set<(marks: ActiveCoachMark[]) => void>();

function notifyActiveListeners(): void {
  const snapshot = Array.from(activeMarks.values());
  activeListeners.forEach((fn) => fn(snapshot));
}

export function registerActiveCoachMark(entry: ActiveCoachMark): void {
  activeMarks.set(entry.markKey, entry);
  notifyActiveListeners();
}

export function unregisterActiveCoachMark(key: CoachMarkKey): void {
  if (activeMarks.delete(key)) notifyActiveListeners();
}

export function subscribeActiveCoachMarks(listener: (marks: ActiveCoachMark[]) => void): () => void {
  activeListeners.add(listener);
  listener(Array.from(activeMarks.values()));
  return () => {
    activeListeners.delete(listener);
  };
}

// Rectangle subtraction: computes the set of non-overlapping fill regions
// covering `screen` minus every rect in `holes`, the general technique
// behind the dimming layer's "cut a hole" look without SVG masking (which
// would need an extra dependency and doesn't buy anything a few plain
// Views don't already do here). Standard box-splitting, generalizes to any
// number of holes, not just the single-spotlight case.
function subtractOne(region: SpotlightRect, hole: SpotlightRect): SpotlightRect[] {
  const ix1 = Math.max(region.x, hole.x);
  const iy1 = Math.max(region.y, hole.y);
  const ix2 = Math.min(region.x + region.width, hole.x + hole.width);
  const iy2 = Math.min(region.y + region.height, hole.y + hole.height);
  if (ix1 >= ix2 || iy1 >= iy2) return [region];

  const pieces: SpotlightRect[] = [];
  if (iy1 > region.y) {
    pieces.push({ x: region.x, y: region.y, width: region.width, height: iy1 - region.y });
  }
  if (iy2 < region.y + region.height) {
    pieces.push({ x: region.x, y: iy2, width: region.width, height: region.y + region.height - iy2 });
  }
  if (ix1 > region.x) {
    pieces.push({ x: region.x, y: iy1, width: ix1 - region.x, height: iy2 - iy1 });
  }
  if (ix2 < region.x + region.width) {
    pieces.push({ x: ix2, y: iy1, width: region.x + region.width - ix2, height: iy2 - iy1 });
  }
  return pieces;
}

export function computeDimmingRegions(screen: SpotlightRect, holes: SpotlightRect[]): SpotlightRect[] {
  let regions: SpotlightRect[] = [screen];
  for (const hole of holes) {
    regions = regions.flatMap((r) => subtractOne(r, hole));
  }
  return regions.filter((r) => r.width > 0.5 && r.height > 0.5);
}
