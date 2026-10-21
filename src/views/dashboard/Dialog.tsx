import React, { useEffect, useId } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useCountUp, useExitTransition } from '../../hooks/useMotion';

// One popup shell for every dashboard drill-down: fixed header, scrolling body, Escape / backdrop to close.
export const DashboardDialog: React.FC<{
  title: string;
  subtitle?: React.ReactNode;
  icon?: React.ComponentType<{ size?: number | string }>;
  actions?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}> = ({ title, subtitle, icon: Icon, actions, onClose, children }) => {
  const id = useId();
  const [closing, close] = useExitTransition(onClose);
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [close]);
  const content = (
    <div
      className={`${closing ? 'animate-fade-out' : 'animate-fade-in'} fixed inset-0 z-[80] flex items-end justify-center bg-black/60 sm:items-center sm:p-6`}
      onMouseDown={e => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        className={`${closing ? 'animate-calm-exit' : 'animate-calm-enter'} flex max-h-[94dvh] w-full max-w-5xl flex-col overflow-hidden rounded-t-2xl border border-line bg-surface shadow-2xl sm:max-h-[88dvh] sm:rounded-xl`}
      >
        <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 sm:px-5">
          {Icon && (
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line bg-raised text-blue-300">
              <Icon size={16} />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h2 id={id} className="truncate text-sm font-semibold text-ink">
              {title}
            </h2>
            {subtitle && <div className="mt-0.5 truncate text-[11.5px] text-mute">{subtitle}</div>}
          </div>
          {actions}
          <button
            type="button"
            onClick={close}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-line text-mute hover:bg-raised hover:text-ink"
            aria-label={`Close ${title}`}
          >
            <X size={15} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">{children}</div>
      </section>
    </div>
  );
  return createPortal(content, document.body);
};

const CountUp: React.FC<{ value: number }> = ({ value }) => <>{useCountUp(value)}</>;
export const StatTile: React.FC<{ label: string; value: React.ReactNode; hint?: React.ReactNode }> = ({
  label,
  value,
  hint,
}) => (
  <div className="rounded-lg border border-line bg-raised/30 px-3 py-2.5">
    <div className="text-[11.5px] text-mute">{label}</div>
    <div className="mt-0.5 text-xl font-semibold text-ink">
      {typeof value === 'number' ? <CountUp value={value} /> : value}
    </div>
    {hint && <div className="mt-0.5 text-[10.5px] text-faint">{hint}</div>}
  </div>
);

export const Segmented = <T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) => (
  <div role="group" aria-label={label} className="inline-flex rounded-md border border-line bg-raised/40 p-0.5">
    {options.map(o => (
      <button
        key={o.id}
        type="button"
        aria-pressed={value === o.id}
        onClick={() => onChange(o.id)}
        className={`rounded px-2.5 py-1 text-[11.5px] font-medium ${value === o.id ? 'bg-surface text-ink shadow-sm' : 'text-mute hover:text-ink'}`}
      >
        {o.label}
      </button>
    ))}
  </div>
);
