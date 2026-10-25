// Limen theme (design guide v1, docs/context/05_LIMEN_REBUILD.md, "Design
// guide"). Every color and the font live here so they're easy to change
// after pilot feedback. Plain CommonJS so tailwind.config.js can read it;
// app code imports it through src/theme/index.ts.
//
// Light theme by default; dark only when the device is set to dark, kept
// warm. Screens use Tailwind classes; the `stone` scale below is a warm
// version of Tailwind's stone, so every existing bg-stone-50 / text-stone-900
// picks up the cream and ink without touching each screen.

const palette = {
  cream: '#FBF7F2', // page background
  card: '#FFFDFA', // cards
  line: '#EDE4DA', // borders
  ink: '#2A2420', // text
  inkSoft: '#6B5F57', // secondary text
  muted: '#8A7C71', // chevrons and quiet icons (not for text on cream)
  apricot: '#B95A1E', // main action: filled buttons, the "You" dot
  link: '#94451A', // links and accent text
  linkHover: '#7E3415',
  honey: '#FFF4DC', // suggestion card, highlights
  honeyLine: '#F0DDB2',
  outline: '#D9CCBF', // outlined pill border
  // Dark (device set to dark), kept warm.
  darkBg: '#2A2420',
  darkCard: '#332B26',
  darkLine: '#453B35',
  darkText: '#FBF7F2',
  darkTextSoft: '#B5A89C',
  darkLink: '#E0A27A',
};

// Circle colors: ring / face / face text (05, "Colors").
const circles = {
  close: { ring: '#F8E1D2', ringLine: '#EDC9B2', face: '#F3D3BF', text: '#7E3415' },
  friends: { ring: '#FBF0DD', ringLine: '#EFDDBC', face: '#F5DFAE', text: '#6E5418' },
  getting_to_know: { ring: '#EEF5F1', ringLine: '#D4E6DC', face: '#C9E3D6', text: '#2F5E49' },
  reconnect: { ring: 'transparent', ringLine: '#DCCFC2', face: '#E4DDD6', text: '#4E443D' },
};

// Warm stone scale. Keys keep Tailwind's names so existing classes work.
const stone = {
  50: palette.cream,
  100: '#F4EDE5',
  200: palette.line,
  300: '#DCCFC2',
  400: '#A89A8E',
  500: palette.inkSoft,
  600: '#574C45',
  700: '#453B35',
  800: palette.darkCard,
  900: palette.ink,
  950: '#1F1A17',
};

// Accent: 500 is the link color (safe for small text on cream). Filled
// buttons use `apricot`.
const accent = {
  50: '#FBF3EE',
  100: '#F6E3D6',
  200: '#E9C0A0',
  300: '#E0A27A',
  400: palette.darkLink,
  500: palette.link,
  600: palette.linkHover,
  700: '#743E24',
  800: '#4F2A16',
  900: '#361C0F',
};

const font = {
  family: 'Figtree',
  stack: "'Figtree', system-ui, -apple-system, 'Segoe UI', sans-serif",
};

// Wide screens (05, "Layout").
const layout = {
  wideAt: 720, // tabs move to a top bar, content sits in a column
  column: 640, // lists and cards
  chatColumn: 720,
};

module.exports = { palette, circles, stone, accent, font, layout };
