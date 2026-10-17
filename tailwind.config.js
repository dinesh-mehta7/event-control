/** @type {import('tailwindcss').Config} */
const colors = require('tailwindcss/colors');
const plugin = require('tailwindcss/plugin');

// ---- One indigo brand for the whole app (graphite neutrals, indigo accent, red only for alerts) ----
// The accent names below (blue, cyan, sky, indigo, purple, violet) are aliases of the same indigo, kept so
// existing class names still work. New code should use `blue-*` and the semantic tokens (surface, ink, mute, line...).
const brandBlue = {
  50:  '#eef0ff', 100: '#e0e4ff', 200: '#c7cdfe', 300: '#a3aafb',
  400: '#7c83f7', 500: '#6366f1', 600: '#4f46e5', 700: '#4338ca',
  800: '#3730a3', 900: '#312e81', 950: '#1e1b4b',
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
// Every accent shade is a CSS variable, so a theme can recolour buttons, links and highlights at once.
const SHADES = Object.keys(brandBlue);
ACCENTS.forEach(h => {
  hueColors[h] = {};
  SHADES.forEach(s => { hueColors[h][s] = v(`accent-${s}`); });
});
SHADES.forEach(s => {
  darkVars[`--accent-${s}`] = rgb(brandBlue[s]);
  lightVars[`--accent-${s}`] = rgb(brandBlue[LIGHT_SHADE[s] || s]);
});

// ---- Royal theme (id "saffron"): the sign-in page's charcoal with its gold → saffron accents ----
// 300 = the page's gold (#ffc23d family), 400 = its link amber (#ffb35c), 500 = its saffron (#ff8a1f).
const saffron = {
  50:  '#fff8e6', 100: '#ffefc4', 200: '#ffe08f', 300: '#ffcf55',
  400: '#ffb35c', 500: '#ff8a1f', 600: '#f07a12', 700: '#c9630f',
  800: '#9c4b0e', 900: '#733810', 950: '#3d1d07',
};
const saffronVars = {};
SHADES.forEach(s => { saffronVars[`--accent-${s}`] = rgb(saffron[s]); });

// Semantic tokens — light & dark. Used by ALL modules via Tailwind utilities.
const tokens = {
  light: {
    canvas:       '#f5f5f6',
    surface:      '#ffffff',
    raised:       '#efeff1',
    line:         '#e3e3e7',
    'line-strong':'#d1d1d6',
    ink:          '#111114',
    'ink-soft':   '#2a2b30',
    mute:         '#5b5c66',
    faint:        '#8a8b94',
    field:        '#ffffff',
    brand:        '#4f46e5',
    'brand-soft': '#eef0ff',
    'brand-fg':   '#ffffff',
    // Chart series: one hue per meaning, tuned for contrast on each theme.
    'chart-1':    '#4f46e5', // primary series (indigo)
    'chart-2':    '#0e8fa3', // secondary series (cyan)
    'chart-3':    '#b7791f', // warning / attention (amber)
    'chart-ok':   '#16865a', // complete / healthy (green)
  },
  dark: {
    canvas:       '#101113',
    surface:      '#17181b',
    raised:       '#1f2024',
    line:         '#2b2d32',
    'line-strong':'#3a3c42',
    ink:          '#ececee',
    'ink-soft':   '#cfd0d4',
    mute:         '#9a9ba3',
    faint:        '#6f7079',
    field:        '#1b1c20',
    brand:        '#7c83f7',
    'brand-soft': '#1e1f3a',
    'brand-fg':   '#ffffff',
    'chart-1':    '#7c83f7',
    'chart-2':    '#1a9fb3', // validated: lightness band, CVD ΔE 11.3 vs chart-1 on #17181b
    'chart-3':    '#e0a030',
    'chart-ok':   '#34c38f',
  },
  saffron: {
    // Same values as the sign-in page: --bg, the card (rgba(20,21,26,.78) on --bg), --line, --text, --muted, --dim.
    canvas:       '#0d0e11',
    surface:      '#14151a',
    raised:       '#1c1d23',
    line:         '#25262c',
    'line-strong':'#35363d',
    ink:          '#eef0f5',
    'ink-soft':   '#cfd2da',
    mute:         '#9097a6',
    faint:        '#626a7a',
    field:        '#101115',
    brand:        '#ffb35c',
    'brand-soft': '#2a1e10',
    'brand-fg':   '#1a1206',
    // validated on #15161b: lightness band, chroma, CVD ΔE ≥ 8.7, contrast ≥ 3:1
    'chart-1':    '#e07018',
    'chart-2':    '#1996ab',
    'chart-3':    '#b08e1e',
    'chart-ok':   '#2aa274',
  },
};

const tokenColors = {};
Object.keys(tokens.light).forEach(k => {
  tokenColors[k] = v('c-' + k);
  lightVars[`--c-${k}`] = rgb(tokens.light[k]);
  darkVars[`--c-${k}`] = rgb(tokens.dark[k]);
  saffronVars[`--c-${k}`] = rgb(tokens.saffron[k]);
});

module.exports = {
  content: ['./public/index.html', './src/**/*.{js,jsx,ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: { ...hueColors, slate, ...tokenColors },
      // Global type scale in exact pixels (the html root is 13px, so rem values here would shrink).
      // Readable enterprise sizes: 10.5px is the smallest text in the app.
      fontSize: {
        xs:   ['10.5px', { lineHeight: '15px' }],
        sm:   ['12px',   { lineHeight: '17px' }],
        base: ['13px',   { lineHeight: '19px' }],
        lg:   ['14.5px', { lineHeight: '21px' }],
        xl:   ['16px',   { lineHeight: '23px' }],
        '2xl':['18px',   { lineHeight: '25px', letterSpacing: '-0.015em' }],
        '3xl':['21px',   { lineHeight: '28px', letterSpacing: '-0.02em' }],
        '4xl':['24px',   { lineHeight: '31px', letterSpacing: '-0.02em' }],
      },
      fontFamily: {
        sans: ['Inter', '"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [plugin(({ addBase }) => addBase({ ':root': lightVars, '.dark': { ...darkVars, colorScheme: 'dark' }, '.dark.theme-saffron': saffronVars }))],
};
