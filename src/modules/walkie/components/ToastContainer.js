import React from 'react';
import { useApp } from '../context/AppContext';
import { AlertCircle, CheckCircle } from 'lucide-react';

export default function ToastContainer() {
  const { toasts } = useApp();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 space-y-2 max-w-sm w-full">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`p-4 rounded-xl shadow-2xl border flex items-center justify-between gap-3 animate-slide-up text-white
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
