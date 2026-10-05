import React, { useEffect } from 'react';
import { X } from 'lucide-react';

export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');

export const card = (dark: boolean) => (dark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm');
export const inputCls = (dark: boolean) =>
  `w-full px-3 py-2.5 rounded-xl border text-sm outline-none focus:ring-2 focus:ring-blue-500/50 disabled:opacity-50 ${
    dark ? 'bg-slate-950 border-slate-700 text-slate-100 placeholder-slate-500' : 'bg-white border-slate-300 text-slate-900 placeholder-slate-400'}`;
export const labelCls = (dark: boolean) => `block text-xs font-semibold mb-1.5 ${dark ? 'text-slate-400' : 'text-slate-600'}`;
export const btnPrimary = 'inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold bg-blue-600 hover:bg-blue-500 text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:opacity-50 disabled:cursor-not-allowed';
export const btnGhost = (dark: boolean) =>
  `inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:opacity-50 ${
    dark ? 'border-slate-700 text-slate-300 hover:bg-slate-800' : 'border-slate-300 text-slate-700 hover:bg-slate-100'}`;

export const Modal: React.FC<{ title: string; dark: boolean; onClose: () => void; children: React.ReactNode; wide?: boolean; xl?: boolean }> = ({ title, dark, onClose, children, wide, xl }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={title}
        className={cx('w-full max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-xl border p-5 sm:p-6', xl ? 'sm:max-w-3xl' : wide ? 'sm:max-w-lg' : 'sm:max-w-md', dark ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-white border-slate-200 text-slate-900')}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className={cx('p-1.5 rounded-lg', dark ? 'hover:bg-slate-800' : 'hover:bg-slate-100')}><X className="w-4 h-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
};

export const ConfirmModal: React.FC<{ dark: boolean; title: string; body: string; confirmLabel: string; onConfirm: () => void; onClose: () => void }> = ({ dark, title, body, confirmLabel, onConfirm, onClose }) => (
  <Modal title={title} dark={dark} onClose={onClose}>
    <p className={cx('text-sm mb-5', dark ? 'text-slate-300' : 'text-slate-600')}>{body}</p>
    <div className="flex justify-end gap-2">
      <button onClick={onClose} className={btnGhost(dark)}>Cancel</button>
      <button onClick={() => { onConfirm(); onClose(); }} className="px-4 py-2.5 rounded-xl text-sm font-bold bg-rose-600 hover:bg-rose-500 text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400">{confirmLabel}</button>
    </div>
  </Modal>
);
