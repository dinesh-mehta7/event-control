import React from 'react';
import { X } from 'lucide-react';

// ── Shared style tokens ──────────────────────────────────────────────────────
export const input =
  'bg-field border border-line-strong rounded-xl px-3 py-2 text-sm text-ink placeholder-faint w-full outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all';

export const btnPrimary =
  'inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-blue-600 hover:bg-blue-700 active:scale-95 text-white transition-all whitespace-nowrap';

export const btnGhost =
  'inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium border border-line-strong text-ink-soft hover:bg-raised hover:text-ink transition-all whitespace-nowrap';

// ── Modal overlay wrapper ─────────────────────────────────────────────────────
export const Modal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({
  title,
  onClose,
  children,
}) => (
  <div
    className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
    onMouseDown={e => {
      if (e.target === e.currentTarget) onClose();
    }}
  >
    <div className="w-full max-w-lg rounded-xl border border-line bg-surface shadow-2xl animate-slide-up max-h-[90vh] flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b border-line shrink-0">
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-mute hover:bg-raised hover:text-ink transition-colors"
        >
          <X size={16} />
        </button>
      </div>
      <div className="overflow-y-auto flex-1 px-6 py-5">{children}</div>
    </div>
  </div>
);
