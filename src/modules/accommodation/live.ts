import type { MealRow, MealStatus } from './types';
import { minutesOf } from './dates';

// Which meal should the "live" card show right now?
//  1. a meal that is being prepared / distributed (kitchen is working on it)
//  2. otherwise the meal whose time window contains the current time
//  3. otherwise the next meal still to come
//  4. otherwise (day is over) the most recent meal
export function pickLive(day: MealRow[], nowMin: number): MealRow | null {
  if (!day.length) return null;
  const sorted = [...day].sort((a, b) => minutesOf(a.start) - minutesOf(b.start));
  const inWindow = (m: MealRow) => nowMin >= minutesOf(m.start) && nowMin < minutesOf(m.end);

  const active = sorted.filter(m => m.status === 'preparing' || m.status === 'distributing');
  if (active.length) return active.find(inWindow) || active[0];

  const current = sorted.find(inWindow);
  if (current) return current;

  const next = sorted.find(m => minutesOf(m.start) > nowMin && m.status !== 'distributed');
  if (next) return next;

  return [...sorted].reverse().find(m => minutesOf(m.start) <= nowMin) || sorted[sorted.length - 1];
}

export const statusTone = (s: MealStatus, dark: boolean) => {
  switch (s) {
    case 'preparing': return dark ? 'bg-amber-500/15 text-amber-300 border-amber-500/30' : 'bg-amber-50 text-amber-700 border-amber-200';
    case 'distributing': return dark ? 'bg-blue-500/15 text-blue-300 border-blue-500/30' : 'bg-blue-50 text-blue-700 border-blue-200';
    case 'distributed': return dark ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'bg-emerald-50 text-emerald-700 border-emerald-200';
    default: return dark ? 'bg-slate-800 text-slate-400 border-slate-700' : 'bg-slate-100 text-slate-500 border-slate-200';
  }
};
