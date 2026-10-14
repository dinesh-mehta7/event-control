import type { SubDepartmentId } from '../types';
import { useEffect, useState } from 'react';

export function useStore<T>(key: string, init: T): [T, (v: T) => void] {
  const [v, set] = useState<T>(() => { try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : init; } catch { return init; } });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} }, [key, v]);
  return [v, set];
}
export const inr = (n: number) => '₹' + new Intl.NumberFormat('en-IN').format(n);

export const DEPTS: Record<SubDepartmentId, string> = {
  cctv: 'CCTV', wifi: 'WiFi', walkie: 'Walkie-Talkie', control: 'Control Rooms',
  inventory: 'Inventory', purchase: 'Purchase', accommodation: 'Accommodation', sewadars: 'Sewadars',
};
