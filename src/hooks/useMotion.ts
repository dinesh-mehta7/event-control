import { useCallback, useEffect, useRef, useState } from 'react';

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Lets a popup play its exit animation before the parent unmounts it.
// `requestClose` marks it as closing, then calls `onClose` once the animation is done.
export function useExitTransition(onClose: () => void, duration = 140) {
  const [closing, setClosing] = useState(false);
  const timer = useRef<number>();
  const latest = useRef(onClose);
  latest.current = onClose;
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const requestClose = useCallback(() => {
    if (prefersReducedMotion()) {
      latest.current();
      return;
    }
    setClosing(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => latest.current(), duration);
  }, [duration]);
  return [closing, requestClose] as const;
}

// Counts a number up (or down) to its new value with an ease-out curve.
export function useCountUp(value: number, duration = 600) {
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? value : 0));
  const from = useRef(shown);
  useEffect(() => {
    if (!Number.isFinite(value) || prefersReducedMotion()) {
      setShown(value);
      from.current = value;
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 3;
      const next = Math.round(a + (value - a) * eased);
      setShown(next);
      from.current = next;
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return shown;
}

// Theme choices. "saffron" is the Royal theme: a dark theme with the sign-in page's saffron + gold palette.
export type ThemeChoice = 'light' | 'dark' | 'saffron';
export const themeChoiceOf = (settings: any): ThemeChoice =>
  settings?.theme === 'dark' ? (settings?.palette === 'saffron' ? 'saffron' : 'dark') : 'light';
export const settingsFor = (choice: ThemeChoice) => ({
  theme: choice === 'light' ? 'light' : 'dark',
  palette: choice === 'saffron' ? 'saffron' : 'indigo',
});

// Applies the theme classes; on a real switch the colours cross-fade briefly instead of snapping.
let lastTheme: string | null = null;
export function applyTheme(dark: boolean, palette?: string) {
  const root = document.documentElement;
  const saffron = dark && palette === 'saffron';
  const id = saffron ? 'saffron' : dark ? 'dark' : 'light';
  if (lastTheme !== null && lastTheme !== id && !prefersReducedMotion()) {
    root.classList.add('theme-transition');
    window.setTimeout(() => root.classList.remove('theme-transition'), 320);
  }
  lastTheme = id;
  root.classList.toggle('dark', dark);
  root.classList.toggle('theme-saffron', saffron);
}
