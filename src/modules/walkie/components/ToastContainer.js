import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';

const EXIT_MS = 180;

// How long each kind stays up. Errors stay longer so there is time to read what to do.
const DURATION = { success: 4000, info: 5000, warning: 6000, error: 8000 };

// Colours come from the theme tokens (surface, line, ink…), so toasts follow light/dark and the palette.
const KIND = {
  success: { title: 'Done', Icon: CheckCircle2, icon: 'text-emerald-500', chip: 'bg-emerald-500/15', bar: 'bg-emerald-500' },
  error: { title: 'Something went wrong', Icon: XCircle, icon: 'text-red-500', chip: 'bg-red-500/15', bar: 'bg-red-500' },
  warning: { title: 'Heads up', Icon: AlertTriangle, icon: 'text-amber-500', chip: 'bg-amber-500/15', bar: 'bg-amber-500' },
  info: { title: 'Notice', Icon: Info, icon: 'text-blue-400', chip: 'bg-blue-500/15', bar: 'bg-blue-500' },
};

function Toast({ toast, onDismiss }) {
  const kind = KIND[toast.type] || KIND.success;
  const total = DURATION[toast.type] || DURATION.success;
  const [paused, setPaused] = useState(false);
  const remaining = useRef(total);
  const startedAt = useRef(0);

  // Auto-dismiss, paused while the pointer or keyboard focus is on the toast.
  useEffect(() => {
    if (paused || toast.leaving) return undefined;
    startedAt.current = Date.now();
    const timer = window.setTimeout(() => onDismiss(toast.id), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt.current));
    };
  }, [paused, toast.id, toast.leaving, onDismiss]);

  const { Icon } = kind;
  return (
    <div
      role={toast.type === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}
      className={`pointer-events-auto relative overflow-hidden rounded-xl border border-line bg-surface shadow-[0_12px_32px_-12px_rgb(0_0_0/0.45)] ring-1 ring-black/5
        ${toast.leaving ? 'animate-toast-exit' : 'animate-slide-up'}`}
    >
      <div className="flex items-start gap-3 py-3 pl-3.5 pr-10">
        <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full ${kind.chip}`}><Icon className={`h-4 w-4 ${kind.icon}`} strokeWidth={2.25} /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold leading-5 text-ink">{toast.title || kind.title}</p>
          <p className="mt-0.5 break-words text-[12.5px] leading-[1.45] text-mute">{toast.message}</p>
        </div>
      </div>
      <button type="button" onClick={() => onDismiss(toast.id)} aria-label="Dismiss notification"
        className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-md text-faint hover:bg-raised hover:text-ink">
        <X className="h-3.5 w-3.5" />
      </button>
      <span aria-hidden="true" className={`toast-progress absolute bottom-0 left-0 h-[2px] w-full origin-left opacity-70 ${kind.bar}`}
        style={{ animationDuration: `${total}ms`, animationPlayState: paused || toast.leaving ? 'paused' : 'running' }} />
    </div>
  );
}

export default function ToastContainer() {
  const { toasts, dismissToast } = useApp();
  // Toasts that were removed from the context stay rendered briefly so they can animate out.
  const [shown, setShown] = useState(toasts);
  const timers = useRef({});

  useEffect(() => {
    const live = new Set(toasts.map(t => t.id));
    setShown(prev => {
      const kept = prev.map(t => (live.has(t.id) ? t : { ...t, leaving: true }));
      const fresh = toasts.filter(t => !prev.some(p => p.id === t.id));
      return [...kept, ...fresh];
    });
  }, [toasts]);

  useEffect(() => {
    shown.filter(t => t.leaving && !timers.current[t.id]).forEach(t => {
      timers.current[t.id] = window.setTimeout(() => {
        delete timers.current[t.id];
        setShown(prev => prev.filter(x => x.id !== t.id));
      }, EXIT_MS);
    });
  }, [shown]);

  useEffect(() => () => Object.values(timers.current).forEach(window.clearTimeout), []);

  if (shown.length === 0) return null;

  return (
    <div aria-live="polite"
      className="pointer-events-none fixed inset-x-4 bottom-4 z-[100] flex flex-col gap-2 sm:inset-x-auto sm:bottom-5 sm:right-5 sm:w-[380px]">
      {shown.slice(-4).map(toast => <Toast key={toast.id} toast={toast} onDismiss={dismissToast} />)}
    </div>
  );
}
