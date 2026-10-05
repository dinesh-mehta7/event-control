import React from 'react';

// Shared building blocks so every screen looks and behaves the same.
// (Page titles live in the app header, so pages only add a short description + their main action.)

export const PageIntro: React.FC<{ children?: React.ReactNode; action?: React.ReactNode }> = ({ children, action }) => (
  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
    <p className="text-sm text-mute max-w-2xl">{children}</p>
    {action && <div className="flex items-center gap-2 shrink-0">{action}</div>}
  </div>
);

export interface TabDef { id: string; label: string; count?: number; alert?: boolean }

export const Tabs: React.FC<{ tabs: TabDef[]; value: string; onChange: (id: string) => void; label?: string }> = ({ tabs, value, onChange, label = 'Sections' }) => (
  <div role="tablist" aria-label={label} className="flex items-center gap-1 border-b border-line overflow-x-auto">
    {tabs.map(t => {
      const on = t.id === value;
      return (
        <button key={t.id} role="tab" aria-selected={on} onClick={() => onChange(t.id)}
          className={`-mb-px px-3.5 py-2.5 text-sm whitespace-nowrap flex items-center gap-2 border-b-2 transition-colors ${on ? 'border-blue-500 text-ink font-semibold' : 'border-transparent text-mute hover:text-ink'}`}>
          {t.label}
          {t.count !== undefined && (
            <span className={`min-w-[20px] text-center text-xs font-medium px-1.5 py-0.5 rounded-full ${t.alert && t.count > 0 ? 'bg-amber-500/15 text-amber-300' : 'bg-raised text-mute'}`}>{t.count}</span>
          )}
        </button>
      );
    })}
  </div>
);

export const Stat: React.FC<{ icon?: any; label: string; value: React.ReactNode; hint?: string; warn?: boolean }> = ({ icon: I, label, value, hint, warn }) => (
  <div className={`rounded-xl border bg-surface p-4 ${warn ? 'border-amber-500/40' : 'border-line'}`}>
    <div className="flex items-center gap-2 text-xs font-medium text-mute">{I && <I size={14} />}{label}</div>
    <div className="text-2xl font-bold text-ink mt-1 leading-tight tabular-nums">{value}</div>
    {hint && <div className="text-xs text-mute mt-0.5 truncate">{hint}</div>}
  </div>
);

export const btnGhost = 'px-3.5 py-2 rounded-lg text-sm font-medium border border-line-strong text-ink-soft hover:bg-raised hover:text-ink whitespace-nowrap transition-colors inline-flex items-center gap-1.5';
export const th = 'px-4 py-2.5 text-left text-xs font-medium text-mute';

// Print in the light theme even when the screen is dark (paper stays white), then restore.
export const printLight = () => {
  const root = document.documentElement; const was = root.classList.contains('dark');
  if (was) root.classList.remove('dark');
  const back = () => { if (was) root.classList.add('dark'); window.removeEventListener('afterprint', back); };
  window.addEventListener('afterprint', back);
  setTimeout(() => window.print(), 50);
};

// ── Shared form + button styles and small building blocks (single source for every screen) ──────────
export const inputCls = 'bg-field border border-line-strong rounded-lg px-3 py-2 text-sm text-ink placeholder-faint w-full outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20';
export const btnPrimary = 'px-3.5 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white whitespace-nowrap transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5';
export const btnDanger = 'px-3.5 py-2 rounded-lg text-sm font-medium bg-red-600 hover:bg-red-700 text-white whitespace-nowrap transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5';
export const linkBtn = 'text-xs font-medium text-blue-400 hover:underline whitespace-nowrap';

export const Card: React.FC<{ icon?: any; title: string; tone?: string; action?: React.ReactNode; className?: string; children: React.ReactNode }> = ({ icon: I, title, tone = 'text-blue-400', action, className = '', children }) => (
  <section className={`rounded-xl border border-line bg-surface p-4 flex flex-col ${className}`}>
    <header className="flex items-center justify-between gap-3 mb-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
        {I && <span className={`grid place-items-center w-7 h-7 rounded-lg bg-raised ${tone}`}><I size={15} /></span>}{title}
      </h2>{action}
    </header>{children}
  </section>
);

export const Pill: React.FC<{ c: string; children: React.ReactNode }> = ({ c, children }) => (
  <span className={`text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${c}`}>{children}</span>
);

export const Empty: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="py-10 text-center text-sm text-mute">{children}</div>
);

export const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode; className?: string }> = ({ label, hint, children, className = '' }) => (
  <label className={`block ${className}`}>
    <span className="block text-xs font-medium text-mute mb-1">{label}</span>
    {children}
    {hint && <span className="block text-xs text-faint mt-1">{hint}</span>}
  </label>
);
