import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import { AlertCircle, CheckCircle } from 'lucide-react';

const EXIT_MS = 180;

export default function ToastContainer() {
  const { toasts } = useApp();
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
    <div className="fixed bottom-5 right-5 z-50 space-y-2 max-w-sm w-full" role="status" aria-live="polite">
      {shown.map((toast) => (
        <div
          key={toast.id}
          className={`p-4 rounded-xl shadow-2xl border flex items-center justify-between gap-3 text-white
            ${toast.leaving ? 'animate-toast-exit' : 'animate-slide-up'}
            ${toast.type === 'error' ? 'bg-rose-600 border-rose-700'
              : toast.type === 'warning' ? 'bg-amber-500 border-amber-600'
              : toast.type === 'info' ? 'bg-blue-600 border-blue-700'
              : 'bg-emerald-600 border-emerald-700'}`}
        >
          <div className="flex items-center gap-2">
            {toast.type === 'error' ? (
              <AlertCircle className="w-5 h-5 shrink-0" />
            ) : (
              <CheckCircle className="w-5 h-5 shrink-0" />
            )}
            <p className="text-sm font-semibold">{toast.message}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
