import { Asset } from 'expo-asset';
import { Platform } from 'react-native';

import { font } from '@/theme';

// Figtree (Google Fonts, OFL), weights 400 to 700 (design guide v1).
/* eslint-disable @typescript-eslint/no-require-imports */
export const FIGTREE_FILES: Record<number, number> = {
  400: require('@expo-google-fonts/figtree/400Regular/Figtree_400Regular.ttf'),
  500: require('@expo-google-fonts/figtree/500Medium/Figtree_500Medium.ttf'),
  600: require('@expo-google-fonts/figtree/600SemiBold/Figtree_600SemiBold.ttf'),
  700: require('@expo-google-fonts/figtree/700Bold/Figtree_700Bold.ttf'),
};
/* eslint-enable @typescript-eslint/no-require-imports */

// On the web every Text is a div or span with dir="auto"; this rule is a
// little more specific than react-native-web's own text class, so all text
// uses Figtree while icons (which set their font inline) keep theirs.
// The font files ship with the app; nothing is fetched from Google.
export function installWebFont() {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  if (document.getElementById('limen-font')) return;
  const faces = Object.entries(FIGTREE_FILES)
    .map(
      ([weight, mod]) =>
        `@font-face{font-family:'${font.family}';font-style:normal;font-weight:${weight};font-display:swap;src:url(${Asset.fromModule(mod).uri}) format('truetype');}`
    )
    .join('');
  const use = `div[dir="auto"],span[dir="auto"],input[class],textarea[class]{font-family:${font.stack};}`;
  const style = document.createElement('style');
  style.id = 'limen-font';
  style.textContent = faces + use;
  document.head.appendChild(style);
}
