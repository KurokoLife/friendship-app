const theme = require('./src/theme/tokens.js');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/app/**/*.{js,jsx,ts,tsx}', './src/components/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      // Design guide v1 (2026-10-25, docs/context/05_LIMEN_REBUILD.md). All
      // values come from src/theme/tokens.js. `stone` is a warm scale (cream
      // background, ink text), `accent-500` is the link color, `apricot` is
      // the one filled main-action color. Sentence case, rounded shapes,
      // no gradients, no shadows on cards.
      colors: {
        stone: theme.stone,
        accent: theme.accent,
        white: theme.palette.card,
        apricot: theme.palette.apricot,
        cream: theme.palette.cream,
        card: theme.palette.card,
        line: theme.palette.line,
        ink: theme.palette.ink,
        'ink-soft': theme.palette.inkSoft,
        honey: theme.palette.honey,
        'honey-line': theme.palette.honeyLine,
        outline: theme.palette.outline,
      },
      fontFamily: {
        sans: [theme.font.family, 'system-ui', 'sans-serif'],
      },
      // Named type scale so every screen shares the same hierarchy instead of
      // picking arbitrary text-2xl/text-xl sizes per screen.
      fontSize: {
        // Headings 28px on a phone, 34px on a laptop (display-lg).
        display: ['28px', { lineHeight: '34px', fontWeight: '700', letterSpacing: '-0.02em' }],
        'display-lg': ['34px', { lineHeight: '40px', fontWeight: '700', letterSpacing: '-0.02em' }],
        title: ['20px', { lineHeight: '26px', fontWeight: '600' }],
        body: ['16px', { lineHeight: '24px', fontWeight: '400' }],
        caption: ['14px', { lineHeight: '20px', fontWeight: '400' }],
      },
    },
  },
  plugins: [],
};
