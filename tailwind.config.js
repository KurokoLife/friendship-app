/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/app/**/*.{js,jsx,ts,tsx}', './src/components/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      // Design direction (Hinge-inspired): minimal, restrained, typography-led.
      // - Neutrals are Tailwind's `stone` scale (warm gray), not `neutral` —
      //   gives off-white/charcoal instead of stark white/black.
      //   Backgrounds: bg-stone-50 dark:bg-stone-900. Borders: stone-200/800.
      // - `accent` is the ONE brand color. Use it sparingly — a positive/
      //   selected state, a link, a small highlight. Never as a default
      //   background or body text color. Primary buttons stay monochrome
      //   (stone-900/stone-50), not accent-filled.
      // - No shadows on cards — a 1px stone border is enough definition.
      // - No gradients except where a brand requires one (Instagram).
      colors: {
        accent: {
          50: '#FBF3EE',
          100: '#F3DFD2',
          200: '#E9C0A0',
          300: '#DC9C6C',
          400: '#CE8A5F',
          500: '#B5643B',
          600: '#94502E',
          700: '#743E24',
          800: '#4F2A16',
          900: '#361C0F',
        },
      },
      // Named type scale so every screen shares the same hierarchy instead of
      // picking arbitrary text-2xl/text-xl sizes per screen.
      fontSize: {
        display: ['32px', { lineHeight: '38px', fontWeight: '600' }],
        title: ['22px', { lineHeight: '28px', fontWeight: '600' }],
        body: ['17px', { lineHeight: '26px', fontWeight: '400' }],
        caption: ['14px', { lineHeight: '20px', fontWeight: '400' }],
      },
    },
  },
  plugins: [],
};
