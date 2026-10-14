import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');

export const card = (_dark: boolean) => 'bg-surface border-line shadow-sm';
export const inputCls = (_dark: boolean) =>
  'w-full px-3 py-2.5 rounded-xl border border-line bg-field text-ink placeholder-faint text-sm outline-none focus:ring-2 focus:ring-blue-500/50 disabled:opacity-50';
export const labelCls = (_dark: boolean) => 'block text-xs font-semibold mb-1.5 text-mute';
export const btnPrimary = 'inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold bg-blue-600 hover:bg-blue-500 text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:opacity-50 disabled:cursor-not-allowed';
export const btnGhost = (_dark: boolean) =>
  'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border border-line text-ink-soft hover:bg-raised transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:opacity-50';

export const Modal: React.FC<{ title: string; dark: boolean; onClose: () => void; children: React.ReactNode; wide?: boolean; xl?: boolean; stickyHeader?: boolean }> = ({ title, onClose, children, wide, xl, stickyHeader }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  const content = (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={title}
        className={cx('animate-pop-in w-full max-h-[92dvh] rounded-t-2xl sm:rounded-xl border border-line bg-surface text-ink', stickyHeader ? 'flex flex-col overflow-hidden p-0' : 'overflow-y-auto p-5 sm:p-6', xl ? 'sm:max-w-3xl' : wide ? 'sm:max-w-lg' : 'sm:max-w-md')}>
        <div className={cx('flex items-center justify-between mb-4', stickyHeader ? 'shrink-0 border-b border-line px-5 pt-5 pb-3 sm:px-6 sm:pt-6' : '')}>
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg hover:bg-raised"><X className="w-4 h-4" /></button>
        </div>
        {stickyHeader ? <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 sm:px-6 sm:pb-6">{children}</div> : children}
      </div>
    </div>
  );
  return typeof document === 'undefined' ? content : createPortal(content, document.body);
};

export const ConfirmModal: React.FC<{ dark: boolean; title: string; body: string; confirmLabel: string; onConfirm: () => void; onClose: () => void }> = ({ dark, title, body, confirmLabel, onConfirm, onClose }) => (
  <Modal title={title} dark={dark} onClose={onClose}>
    <p className="text-sm mb-5 text-mute">{body}</p>
    <div className="flex justify-end gap-2">
      <button onClick={onClose} className={btnGhost(dark)}>Cancel</button>
      <button onClick={() => { onConfirm(); onClose(); }} className="px-4 py-2.5 rounded-xl text-sm font-bold bg-rose-600 hover:bg-rose-500 text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400">{confirmLabel}</button>
    </div>
  </Modal>
);
