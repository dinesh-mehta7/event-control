/** @type {import('tailwindcss').Config} */
const colors = require('tailwindcss/colors');
const plugin = require('tailwindcss/plugin');

// ---- One blue brand for the whole app (white / blue / black, red only for alerts) ----
// The accent names below (cyan, sky, indigo, purple, violet) are aliases of the same blue, kept so older
// class names still work. New code should use `blue-*` and the semantic tokens (surface, ink, mute, line...).
const brandBlue = {
  50:  '#eff6ff', 100: '#dbeafe', 200: '#bfdbfe', 300: '#93c5fd',
  400: '#60a5fa', 500: '#3b82f6', 600: '#2563eb', 700: '#1d4ed8',
  800: '#1e40af', 900: '#1e3a8a', 950: '#172554',
};

const slate = {
  50: '#f8fafc', 100: '#f1f5f9', 200: '#e2e8f0', 300: '#cbd5e1',
  400: '#94a3b8', 500: '#64748b', 600: '#475569', 700: '#334155',
  800: '#1e293b', 900: '#0f172a', 950: '#020817',
};

const ACCENTS = ['cyan', 'blue', 'sky', 'indigo', 'purple', 'violet'];
const STATUS = ['red', 'rose', 'amber', 'orange', 'yellow', 'emerald', 'green', 'teal', 'lime', 'fuchsia', 'pink'];
const LIGHT_SHADE = { 200: 700, 300: 700, 400: 600 };

const rgb = hex => { const n = parseInt(hex.slice(1), 16); return `${n >> 16} ${(n >> 8) & 255} ${n & 255}`; };
const v = name => `rgb(var(--${name}) / <alpha-value>)`;

const hueColors = {}; const lightVars = {}; const darkVars = {};
STATUS.forEach(h => {
  hueColors[h] = { ...colors[h] };
  [200, 300, 400].forEach(s => {
    hueColors[h][s] = v(`${h}-${s}`);
    darkVars[`--${h}-${s}`] = rgb(colors[h][s]);
    lightVars[`--${h}-${s}`] = rgb(colors[h][LIGHT_SHADE[s]]);
  });
});
ACCENTS.forEach(h => {
  hueColors[h] = { ...brandBlue };
  [200, 300, 400].forEach(s => {
    hueColors[h][s] = v(`${h}-${s}`);
    darkVars[`--${h}-${s}`] = rgb(brandBlue[s]);
    lightVars[`--${h}-${s}`] = rgb(brandBlue[LIGHT_SHADE[s]]);
  });
});

// Semantic tokens — light & dark. Used by ALL modules via Tailwind utilities.
const tokens = {
  light: {
    canvas:       '#e9eef5',
    surface:      '#e9eef5',
    raised:       '#e1e7ef',
    line:         '#d5dce6',
    'line-strong':'#c8d1de',
    ink:          '#020817',
    'ink-soft':   '#1e293b',
    mute:         '#526079',
    faint:        '#7a879f',
    field:        '#e9eef5',
    brand:        '#2563eb',
    'brand-soft': '#dbeafe',
    'brand-fg':   '#ffffff',
  },
  dark: {
    canvas:       '#070708',
    surface:      '#18181a',
    raised:       '#242427',
    line:         '#303034',
    'line-strong':'#414146',
    ink:          '#f5f5f5',
    'ink-soft':   '#d4d4d8',
    mute:         '#a1a1a8',
    faint:        '#77777f',
    field:        '#202023',
    brand:        '#168bff',
    'brand-soft': '#10233a',
    'brand-fg':   '#ffffff',
  },
};

const tokenColors = {};
Object.keys(tokens.light).forEach(k => {
  tokenColors[k] = v('c-' + k);
  lightVars[`--c-${k}`] = rgb(tokens.light[k]);
  darkVars[`--c-${k}`] = rgb(tokens.dark[k]);
});

module.exports = {
  content: ['./public/index.html', './src/**/*.{js,jsx,ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: { ...hueColors, slate, ...tokenColors },
      // Compact global type scale. Keep a clear hierarchy without oversized body text.
      fontSize: {
        xs:   ['0.625rem',  { lineHeight: '0.875rem' }], // 10px
        sm:   ['0.71875rem',{ lineHeight: '1rem' }],     // 11.5px
        base: ['0.78125rem',{ lineHeight: '1.125rem' }], // 12.5px
        lg:   ['0.875rem',  { lineHeight: '1.25rem' }],  // 14px
        xl:   ['1rem',      { lineHeight: '1.375rem' }], // 16px
        '2xl':['1.125rem',  { lineHeight: '1.5rem', letterSpacing: '-0.015em' }], // 18px
        '3xl':['1.3125rem', { lineHeight: '1.75rem', letterSpacing: '-0.02em' }],  // 21px
        '4xl':['1.5rem',    { lineHeight: '2rem', letterSpacing: '-0.02em' }],     // 24px
      },
      fontFamily: {
        sans: ['Inter', '"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [plugin(({ addBase }) => addBase({ ':root': lightVars, '.dark': { ...darkVars, colorScheme: 'dark' } }))],
};
