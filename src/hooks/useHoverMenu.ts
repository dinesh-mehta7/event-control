import { useEffect, useRef, useState } from 'react';
import type React from 'react';

// Dropdown that opens while the mouse is over it. Spread `hover` on the wrapper (and on a portaled
// panel, if any) and `trigger` on the button: a mouse click opens it (or keeps it open, e.g. after Esc
// while still hovering), touch and keyboard toggle it.
// The short close delay lets the pointer cross the gap between button and panel.
// Click outside (anything not inside `ref` or `panelRef`) or Esc closes it.
export function useHoverMenu<T extends HTMLElement = HTMLDivElement>(closeDelay = 150) {
  const [open, setOpen] = useState(false);
  const ref = useRef<T>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const lastPointer = useRef('');
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !panelRef.current?.contains(t)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  const hover = {
    onPointerEnter: (e: React.PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      window.clearTimeout(closeTimer.current);
      setOpen(true);
    },
    onPointerLeave: (e: React.PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      closeTimer.current = window.setTimeout(() => setOpen(false), closeDelay);
    },
  };
  const trigger = {
    onPointerDown: (e: React.PointerEvent) => {
      lastPointer.current = e.pointerType;
    },
    onClick: () => {
      if (lastPointer.current === 'mouse') setOpen(true);
      else setOpen(o => !o);
      lastPointer.current = '';
    },
  };
  return { open, setOpen, ref, panelRef, hover, trigger };
}

// Panel stays mounted so it fades/scales both in and out. Its pt-2 gap is part of the hover area.
export const hoverMenuPanel = (open: boolean, align: 'left' | 'right' = 'right') =>
  `absolute top-full z-50 pt-2 transition-[opacity,transform,visibility] duration-200 ease-out ${
    align === 'right' ? 'right-0 origin-top-right' : 'left-0 origin-top-left'
  } ${open ? 'visible opacity-100 translate-y-0 scale-100' : 'invisible opacity-0 -translate-y-1 scale-95 pointer-events-none'}`;
export const hoverMenuList = 'w-56 rounded-xl border border-line bg-surface p-1.5 shadow-2xl';
