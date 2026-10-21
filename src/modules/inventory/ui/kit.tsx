import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MapPin, MoreHorizontal, X } from 'lucide-react';
import { btnGhost as ghostFor, cx } from '../../accommodation/ui';
import { useCountUp, useExitTransition } from '../../../hooks/useMotion';
import { useInventory } from '../InventoryContext';
import { MOVE } from '../types';
import type { Item, Movement } from '../types';
import { SlideNav } from '../../../components/SlideNav';
import { levelOf, peopleLine, signedQty, when } from '../lib/stock';

export { cx };

// The command-center shell is always dark, so this module is dark-only.
export const D = true;
export const ghost = ghostFor(D);
export const panel = 'rounded-xl border border-line bg-surface/60';
export const primary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-blue-400/30 bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:cursor-not-allowed disabled:opacity-50';
export const iconBtn =
  'inline-grid h-7 w-7 place-items-center rounded-md text-mute transition-colors hover:bg-raised hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:opacity-40';

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'mute' | 'orange';
export const TONE: Record<Tone, string> = {
  ok: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  warn: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  bad: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  info: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  mute: 'bg-raised text-mute border-line-strong',
  orange: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
};
const DOT: Record<Tone, string> = {
  ok: 'bg-emerald-400',
  warn: 'bg-amber-400',
  bad: 'bg-rose-400',
  info: 'bg-blue-400',
  mute: 'bg-faint',
  orange: 'bg-orange-400',
};

// ---- basics -------------------------------------------------------------------
export const Badge: React.FC<{ tone: Tone; children: React.ReactNode; className?: string }> = ({
  tone,
  children,
  className,
}) => (
  <span
    className={cx(
      'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold',
      TONE[tone],
      className,
    )}
  >
    {children}
  </span>
);

export const Empty: React.FC<{ children: React.ReactNode; icon?: React.ComponentType<{ className?: string }> }> = ({
  children,
  icon: I,
}) => (
  <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-faint">
    {I && (
      <span className="grid h-9 w-9 place-items-center rounded-full border border-line bg-raised/50">
        <I className="h-4 w-4" />
      </span>
    )}
    {children}
  </div>
);

export const Section: React.FC<{
  title: React.ReactNode;
  hint?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}> = ({ title, hint, action, children, className }) => (
  <section className={cx(panel, 'overflow-hidden', className)}>
    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-faint">{hint}</p>}
      </div>
      {action}
    </header>
    {children}
  </section>
);

// Title + one-line purpose + actions, shown at the top of each view.
export const ViewHeader: React.FC<{ title: string; hint: string; children?: React.ReactNode }> = ({
  title,
  hint,
  children,
}) => (
  <div className="flex flex-wrap items-end justify-between gap-3">
    <div className="min-w-0">
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      <p className="mt-0.5 text-xs text-mute">{hint}</p>
    </div>
    {children && <div className="flex flex-wrap gap-1.5">{children}</div>}
  </div>
);

export const StatCard: React.FC<{
  label: string;
  value: number;
  tone?: Tone;
  hint?: string;
  active?: boolean;
  onClick?: () => void;
}> = ({ label, value, tone, hint, active, onClick }) => {
  const shown = useCountUp(value);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      aria-pressed={onClick ? !!active : undefined}
      className={cx(
        panel,
        'lift group px-4 py-3 text-left transition-colors disabled:cursor-default enabled:hover:border-line-strong enabled:hover:bg-raised/40',
        active && 'border-blue-500/50 bg-blue-500/5',
      )}
    >
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-mute">
        {tone && <span className={cx('h-2 w-2 rounded-full', DOT[tone])} />}
        {label}
      </div>
      <div className="mt-1.5 text-2xl font-semibold tabular-nums text-ink">{shown}</div>
      {hint && <div className="mt-0.5 text-xs text-faint">{hint}</div>}
    </button>
  );
};

// ---- stock visuals -----------------------------------------------------------
export const LEVEL_TEXT = { out: 'text-rose-400', low: 'text-amber-400', ok: 'text-emerald-400' } as const;
const LEVEL_BAR = { out: 'bg-rose-500', low: 'bg-amber-400', ok: 'bg-emerald-500' } as const;

export const LevelBadge: React.FC<{ item: Item }> = ({ item }) => {
  const l = levelOf(item);
  return l === 'out' ? <Badge tone="bad">OUT</Badge> : l === 'low' ? <Badge tone="warn">LOW</Badge> : null;
};

// In-store quantity against the low-stock level (full bar = twice the minimum).
export const StockBar: React.FC<{ item: Item; className?: string }> = ({ item, className }) => {
  const l = levelOf(item);
  const pct =
    item.minLevel > 0 ? Math.min(100, (item.inStock / (item.minLevel * 2)) * 100) : item.inStock > 0 ? 100 : 0;
  return (
    <div className={cx('h-1.5 w-full overflow-hidden rounded-full bg-raised', className)} aria-hidden>
      <div
        className={cx('meter-fill h-full rounded-full', LEVEL_BAR[l])}
        style={{ width: `${Math.max(pct, item.inStock > 0 ? 6 : 0)}%` }}
      />
    </div>
  );
};

export const HeldChips: React.FC<{ itemId: string }> = ({ itemId }) => {
  const { holdingsOf, locationLabel } = useInventory();
  const held = holdingsOf(itemId);
  if (!held.length) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {held.map(h => (
        <span
          key={h.location}
          className="inline-flex items-center gap-1 rounded-full border border-line-strong bg-raised/60 px-1.5 py-0.5 text-xs text-ink-soft"
        >
          <MapPin className="h-2.5 w-2.5 text-faint" />
          {locationLabel(h.location)} · <b className="tabular-nums">{h.qty}</b>
        </span>
      ))}
    </div>
  );
};

export const MoveBadge: React.FC<{ r: Movement }> = ({ r }) => (
  <Badge tone={MOVE[r.type].tone}>{MOVE[r.type].label}</Badge>
);

// A movement feed. `showItem` is off inside a single item's history.
export const MoveList: React.FC<{ rows: Movement[] | null; empty: string; showItem?: boolean; className?: string }> = ({
  rows,
  empty,
  showItem = true,
  className,
}) => {
  const { items, locationLabel } = useInventory();
  const byId = useMemo(() => new Map<string, Item>(items.map(i => [i.id, i] as [string, Item])), [items]);
  if (rows === null) return <Empty>Loading…</Empty>;
  if (!rows.length) return <Empty>{empty}</Empty>;
  return (
    <ul className={cx('divide-y divide-line/70', className)}>
      {rows.map(r => {
        const it = byId.get(r.itemId);
        const people = peopleLine(r);
        return (
          <li key={r.id} className="flex items-start justify-between gap-3 px-4 py-3 text-sm">
            <div className="min-w-0">
              {showItem && <div className="truncate font-semibold">{it ? it.name : 'Deleted item'}</div>}
              <div className={cx('flex flex-wrap items-center gap-2', showItem && 'mt-1')}>
                <MoveBadge r={r} />
                <span className="font-bold tabular-nums">
                  {signedQty(r)}
                  {it && <span className="text-xs font-normal text-faint"> {it.unit}</span>}
                </span>
                {r.location && (
                  <span className="inline-flex items-center gap-1 text-xs text-mute">
                    <MapPin className="h-3 w-3" />
                    {locationLabel(r.location)}
                  </span>
                )}
              </div>
              {people && <div className="mt-1 text-xs text-mute">{people}</div>}
            </div>
            <div className="shrink-0 text-right text-xs text-faint">
              {when(r.doneAt)}
              <br />
              {r.doneBy}
            </div>
          </li>
        );
      })}
    </ul>
  );
};

// ---- navigation ----------------------------------------------------------------
export interface SubTab<T extends string> {
  id: T;
  label: string;
  count?: number;
  icon?: React.ComponentType<{ className?: string }>;
}
export function SubTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: SubTab<T>[];
  value: T;
  onChange: (t: T) => void;
  label: string;
}) {
  return (
    <SlideNav variant="underline" aria-label={label} className="flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map(({ id, label: l, count, icon: I }) => (
        <button
          key={id}
          type="button"
          aria-current={value === id ? 'page' : undefined}
          onClick={() => onChange(id)}
          className={cx(
            '-mb-px inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-xs font-medium transition-colors',
            value === id ? 'border-transparent text-brand' : 'border-transparent text-mute hover:text-ink',
          )}
        >
          {I && <I className="h-3.5 w-3.5" />}
          {l}
          {count !== undefined && (
            <span
              className={cx('rounded-full px-1.5 text-xs tabular-nums', value === id ? 'bg-blue-500/15' : 'bg-raised')}
            >
              {count}
            </span>
          )}
        </button>
      ))}
    </SlideNav>
  );
}

// ---- overflow menu (portalled so table scroll containers don't clip it) --------------
export interface MenuAction {
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  danger?: boolean;
  hidden?: boolean;
}
export const RowMenu: React.FC<{ label: string; actions: MenuAction[] }> = ({ label, actions }) => {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const shown = actions.filter(a => !a.hidden);
  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    setPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (!menu.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btn.current?.focus();
      }
    };
    const scroll = () => setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', scroll, true);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', key);
      window.removeEventListener('scroll', scroll, true);
    };
  }, [open]);
  if (!shown.length) return null;
  return (
    <>
      <button
        ref={btn}
        type="button"
        className={iconBtn}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            role="menu"
            style={{ top: pos.top, right: pos.right }}
            className="animate-menu-enter fixed z-50 min-w-44 rounded-lg border border-line bg-surface p-1 shadow-2xl"
          >
            {shown.map(a => (
              <button
                key={a.label}
                role="menuitem"
                type="button"
                onClick={() => {
                  setOpen(false);
                  a.onClick();
                }}
                className={cx(
                  'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs transition-colors hover:bg-raised',
                  a.danger ? 'text-rose-400' : 'text-ink-soft',
                )}
              >
                {a.icon && <a.icon className="h-3.5 w-3.5" />}
                {a.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
};

// ---- side panel ----------------------------------------------------------------------
export const Drawer: React.FC<{
  title: string;
  subtitle?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}> = ({ title, subtitle, onClose, children, footer }) => {
  const [closing, close] = useExitTransition(onClose);
  useEffect(() => {
    // Leave Escape to a modal opened on top of the panel.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && document.querySelectorAll('[role="dialog"][aria-modal="true"]').length <= 1) close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [close]);
  const content = (
    <div
      className={cx(
        closing ? 'animate-fade-out' : 'animate-fade-in',
        'fixed inset-0 z-40 flex justify-end bg-black/50',
      )}
      onMouseDown={e => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx(
          closing ? 'animate-drawer-exit' : 'animate-drawer-enter',
          'flex h-full w-full max-w-md flex-col border-l border-line bg-surface text-ink shadow-2xl',
        )}
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold">{title}</h2>
            {subtitle && <div className="mt-1">{subtitle}</div>}
          </div>
          <button onClick={close} aria-label="Close" className={iconBtn}>
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>
        )}
      </aside>
    </div>
  );
  return typeof document === 'undefined' ? content : createPortal(content, document.body);
};
