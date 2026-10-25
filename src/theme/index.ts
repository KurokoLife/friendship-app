// Typed entry to the theme (values live in tokens.js so Tailwind can read them).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const tokens = require('./tokens.js') as {
  palette: Record<
    | 'cream' | 'card' | 'line' | 'ink' | 'inkSoft' | 'muted' | 'apricot' | 'link' | 'linkHover' | 'honey'
    | 'honeyLine' | 'outline' | 'darkBg' | 'darkCard' | 'darkLine' | 'darkText' | 'darkTextSoft' | 'darkLink',
    string
  >;
  circles: Record<'close' | 'friends' | 'getting_to_know' | 'reconnect', { ring: string; ringLine: string; face: string; text: string }>;
  stone: Record<number, string>;
  accent: Record<number, string>;
  font: { family: string; stack: string };
  layout: { wideAt: number; column: number; chatColumn: number };
};

export const { palette, circles, stone, accent, font, layout } = tokens;
