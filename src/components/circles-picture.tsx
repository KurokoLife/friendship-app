import { useRef } from 'react';
import { Platform, Pressable, Text, View, useColorScheme, type GestureResponderEvent } from 'react-native';

import { Face } from '@/components/ui';
import { CIRCLES, CIRCLE_LABELS, type Circle } from '@/lib/circle';
import { circles, palette } from '@/theme';

export type PictureFace = { key: string; name: string; photoUrl?: string | null; circle: Circle };

const MAX_FACES = 6;
// Degrees, 0 = right, -90 = top.
const BASE_ANGLE: Record<Circle, number> = { close: -90, friends: -145, getting_to_know: -25, reconnect: -60 };

// The circles picture (design guide v1): "You" in the middle, rings from the
// inside out Close, Friends, Getting to know, Want to reconnect (outer ring
// dashed). Faces sit on their ring, up to 6 per ring, then a "+N" bubble.
// Tapping a face opens that person (stage 1c, 2026-10-26); tapping an empty
// part of a ring (or a "+N" bubble) jumps to that part of the list.
export function CirclesPicture({
  faces,
  size,
  onRingPress,
  onFacePress,
}: {
  faces: PictureFace[];
  size: number;
  onRingPress: (c: Circle) => void;
  onFacePress: (key: string) => void;
}) {
  const dark = useColorScheme() === 'dark';
  const ref = useRef<View>(null);
  const s = size / 380; // drawn at 380px on a laptop, scaled down on a phone
  const center = size / 2;
  // Outer radius of each ring, inside out (matches the mockup).
  const radius: Record<Circle, number> = {
    close: 65 * s,
    friends: 105 * s,
    getting_to_know: 145 * s,
    reconnect: 180 * s,
  };
  const youR = 30 * s;
  const faceSize = Math.round(40 * Math.max(s, 0.85));
  const inner = (c: Circle) => {
    const i = CIRCLES.indexOf(c);
    return i === 0 ? youR : radius[CIRCLES[i - 1]];
  };

  const ringAt = (dist: number): Circle | null => {
    for (const c of CIRCLES) if (dist <= radius[c]) return c;
    return null;
  };

  const onPress = (e: GestureResponderEvent) => {
    // Phones give locationX/Y relative to the picture. On the web, measure
    // the click against the picture's own box.
    const ev = e.nativeEvent as unknown as { locationX?: number; locationY?: number; clientX?: number; clientY?: number };
    let x = ev.locationX;
    let y = ev.locationY;
    const node = ref.current as unknown as { getBoundingClientRect?: () => { left: number; top: number } } | null;
    if (Platform.OS === 'web' && node?.getBoundingClientRect && ev.clientX !== undefined && ev.clientY !== undefined) {
      const box = node.getBoundingClientRect();
      x = ev.clientX - box.left;
      y = ev.clientY - box.top;
    }
    if (x === undefined || y === undefined) return;
    const c = ringAt(Math.hypot(x - center, y - center));
    if (c) onRingPress(c);
  };

  const label = CIRCLES.map((c) => {
    const names = faces.filter((f) => f.circle === c).map((f) => f.name.split(' ')[0]);
    return `${CIRCLE_LABELS[c]}: ${names.length ? names.join(', ') : 'nobody yet'}`;
  }).join('. ');

  return (
    <Pressable
      ref={ref}
      onPress={onPress}
      accessibilityRole="image"
      accessibilityLabel={`Your circles. ${label}.`}
      style={{ width: size, height: size, alignSelf: 'center' }}>
      <View style={{ width: size, height: size, pointerEvents: 'none' }}>
        {[...CIRCLES].reverse().map((c) => {
          const r = radius[c];
          return (
            <View
              key={c}
              style={{
                position: 'absolute',
                left: center - r,
                top: center - r,
                width: r * 2,
                height: r * 2,
                borderRadius: r,
                backgroundColor: circles[c].ring,
                borderWidth: c === 'reconnect' ? 1.5 : 1,
                borderStyle: c === 'reconnect' ? 'dashed' : 'solid',
                borderColor: circles[c].ringLine,
              }}
            />
          );
        })}
        <View
          style={{
            position: 'absolute',
            left: center - youR,
            top: center - youR,
            width: youR * 2,
            height: youR * 2,
            borderRadius: youR,
            backgroundColor: palette.apricot,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: Math.max(13, 15 * s) }}>You</Text>
        </View>
        {/* Ring labels sit at the bottom of each ring. */}
        {CIRCLES.map((c) => {
          const mid = (radius[c] + inner(c)) / 2;
          return (
            <Text
              key={`label-${c}`}
              numberOfLines={1}
              style={{
                position: 'absolute',
                left: center - 80,
                width: 160,
                top: center + mid - 8,
                textAlign: 'center',
                fontSize: 12,
                fontWeight: '600',
                color: c === 'reconnect' ? (dark ? palette.darkTextSoft : palette.inkSoft) : circles[c].text,
              }}>
              {CIRCLE_LABELS[c]}
            </Text>
          );
        })}
      </View>
      {/* Faces sit on top and take their own taps: a face opens that person. */}
      <View style={{ position: 'absolute', left: 0, top: 0, width: size, height: size, pointerEvents: 'box-none' }}>
        {CIRCLES.flatMap((c) => {
          const here = faces.filter((f) => f.circle === c);
          if (here.length === 0) return [];
          const shown = here.length > MAX_FACES ? here.slice(0, MAX_FACES - 1) : here;
          const extra = here.length - shown.length;
          const slots = shown.length + (extra > 0 ? 1 : 0);
          const mid = (radius[c] + inner(c)) / 2;
          // Each ring starts at its own angle (like the mockup) so faces don't
          // line up, and spreads around the ring, away from the label at the bottom.
          const span = c === 'close' ? 200 : 240;
          const step = slots > 1 ? Math.min(c === 'close' ? 60 : 42, span / (slots - 1)) : 0;
          const start = BASE_ANGLE[c] - (step * (slots - 1)) / 2;
          // Each face sits in a tap area at least 44px across (design guide).
          const box = Math.max(44, faceSize);
          const at = (i: number) => {
            const a = ((start + i * step) * Math.PI) / 180;
            return { left: center + mid * Math.cos(a) - box / 2, top: center + mid * Math.sin(a) - box / 2 };
          };
          const nodes = shown.map((f, i) => (
            <Pressable
              key={f.key}
              onPress={() => onFacePress(f.key)}
              accessibilityRole="button"
              accessibilityLabel={`${f.name}, ${CIRCLE_LABELS[c]}`}
              style={{ position: 'absolute', ...at(i), width: box, height: box, alignItems: 'center', justifyContent: 'center' }}>
              <Face name={f.name} photoUrl={f.photoUrl} circle={c} size={faceSize} ring />
            </Pressable>
          ));
          if (extra > 0) {
            nodes.push(
              <Pressable
                key={`more-${c}`}
                onPress={() => onRingPress(c)}
                accessibilityRole="button"
                accessibilityLabel={`${extra} more in ${CIRCLE_LABELS[c]}`}
                style={{ position: 'absolute', ...at(shown.length), width: box, height: box, alignItems: 'center', justifyContent: 'center' }}>
                <View
                  style={{
                    width: faceSize,
                    height: faceSize,
                    borderRadius: faceSize / 2,
                    backgroundColor: palette.card,
                    borderWidth: 1.5,
                    borderColor: circles[c].ringLine,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                  <Text style={{ color: circles[c].text, fontWeight: '700', fontSize: 13 }}>+{extra}</Text>
                </View>
              </Pressable>
            );
          }
          return nodes;
        })}
      </View>
    </Pressable>
  );
}