import React, { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { useInventory } from '../InventoryContext';
import { MOVE } from '../types';
import type { Item, Movement } from '../types';
import { signedQty } from '../lib/stock';
import { cx } from './kit';

// Spreadsheet look shared by every inventory table: indigo header band, banded rows, bordered cells.
export const sheetTable = 'w-full border-collapse text-[11.5px] leading-4';
export const sheetHead =
  'sticky top-0 z-10 bg-brand-soft text-left text-[10.5px] font-semibold uppercase tracking-wide text-brand shadow-[inset_0_-2px_0_rgb(var(--c-brand)/0.55)]';
export const th = 'whitespace-nowrap border border-line/70 px-2.5 py-2';
export const td = 'whitespace-nowrap border border-line/70 px-2.5 py-1.5';
export const num = 'text-right tabular-nums';
export const rowHover = 'transition-colors even:bg-raised/40 hover:bg-brand-soft/70';
// Conditional-formatting cells: colour only where something needs attention.
export const cellTone = {
  out: 'bg-rose-500/[0.12] font-semibold text-rose-300',
  low: 'bg-amber-500/[0.12] font-semibold text-amber-300',
  damaged: 'font-semibold text-orange-300',
  total: 'bg-raised/60 font-semibold text-ink',
} as const;
// Status label with a coloured square, so state is never colour alone.
const STATUS_DOT = { out: 'bg-rose-500', low: 'bg-amber-400', ok: 'bg-emerald-500' } as const;
export const StatusTag: React.FC<{ level: 'out' | 'low' | 'ok'; label: string }> = ({ level, label }) => (
  <span className="inline-flex items-center gap-1.5">
    <i className={cx('inline-block h-2 w-2 rounded-sm', STATUS_DOT[level])} />
    {label}
  </span>
);

// Frame: title bar + scrolling grid + footer, like a worksheet.
export const Sheet: React.FC<{
  title: React.ReactNode;
  count?: number;
  tools?: React.ReactNode;
  footer?: React.ReactNode;
  maxHeight?: string;
  children: React.ReactNode;
}> = ({ title, count, tools, footer, maxHeight = 'max-h-[calc(100vh-18rem)]', children }) => (
  <section className="overflow-hidden rounded-lg border border-line bg-surface">
    <div className="flex flex-wrap items-center gap-2 border-b border-line bg-raised/30 px-2.5 py-2 text-[11.5px] text-mute">
      <i className="h-4 w-1 rounded-full bg-brand" aria-hidden />
      <span className="font-semibold text-ink">{title}</span>
      {count !== undefined && (
        <span className="rounded bg-brand-soft px-1.5 py-0.5 font-semibold tabular-nums text-brand">{count}</span>
      )}
      {tools && <div className="ml-auto flex flex-wrap items-center gap-1.5">{tools}</div>}
    </div>
    <div className={cx('min-h-[120px] overflow-auto', maxHeight)}>{children}</div>
    {footer && (
      <div className="flex flex-wrap items-center justify-between gap-2 border-t-2 border-line bg-raised/50 px-2.5 py-1.5 text-[11px] text-mute">
        {footer}
      </div>
    )}
  </section>
);

export const EmptyRow: React.FC<{ cols: number; children: React.ReactNode }> = ({ cols, children }) => (
  <tr>
    <td colSpan={cols} className="border border-line/70 px-4 py-8 text-center text-mute">
      {children}
    </td>
  </tr>
);

// Sortable column header.
export type SortDir = 'asc' | 'desc';
export function useSort<K extends string>(initial: K, dir: SortDir = 'asc') {
  const [sort, setSort] = useState<{ key: K; dir: SortDir }>({ key: initial, dir });
  const toggle = (key: K) =>
    setSort(s => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  return { sort, toggle };
}
export const SortTh: React.FC<{
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  right?: boolean;
  className?: string;
}> = ({ label, active, dir, onClick, right, className }) => (
  <th className={cx(th, 'p-0', className)} aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'flex w-full items-center gap-1 px-2.5 py-2 uppercase transition-colors hover:text-ink',
        right && 'justify-end',
        active && 'text-ink',
      )}
    >
      {label}
      {active ? (
        dir === 'asc' ? (
          <ArrowUp className="h-3 w-3" />
        ) : (
          <ArrowDown className="h-3 w-3" />
        )
      ) : (
        <ArrowUpDown className="h-3 w-3 opacity-40" />
      )}
    </button>
  </th>
);

// Movement colour lives only in a small square next to the label (conditional-formatting style).
const MOVE_DOT: Record<string, string> = {
  ok: 'bg-emerald-500',
  warn: 'bg-amber-400',
  bad: 'bg-rose-500',
  info: 'bg-brand',
  mute: 'bg-faint',
};
export const MoveCell: React.FC<{ m: Movement }> = ({ m }) => (
  <span className="inline-flex items-center gap-1.5">
    <i className={cx('inline-block h-2 w-2 rounded-sm', MOVE_DOT[MOVE[m.type].tone])} />
    {MOVE[m.type].label}
  </span>
);
const dt = (s: string) =>
  new Date(s).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

// Ledger of stock movements as a worksheet.
export const MoveTable: React.FC<{
  rows: Movement[] | null;
  empty: string;
  showItem?: boolean;
  title: string;
  tools?: React.ReactNode;
  maxHeight?: string;
}> = ({ rows, empty, showItem = true, title, tools, maxHeight }) => {
  const { items, locationLabel } = useInventory();
  const byId = useMemo(() => new Map<string, Item>(items.map(i => [i.id, i] as [string, Item])), [items]);
  const cols = showItem ? 13 : 11;
  return (
    <Sheet title={title} count={rows?.length} tools={tools} maxHeight={maxHeight}>
      <table className={cx(sheetTable, showItem ? 'min-w-[1200px]' : 'min-w-[900px]')}>
        <thead className={sheetHead}>
          <tr>
            <th className={cx(th, 'w-10 text-right')}>#</th>
            <th className={th}>Date &amp; time</th>
            {showItem && (
              <>
                <th className={th}>Item</th>
                <th className={th}>Code</th>
              </>
            )}
            <th className={th}>Movement</th>
            <th className={cx(th, 'text-right')}>Qty</th>
            <th className={th}>Unit</th>
            <th className={th}>Location</th>
            <th className={th}>Given / from</th>
            <th className={th}>Received by</th>
            <th className={th}>Returned by</th>
            <th className={th}>Ref</th>
            <th className={th}>Recorded by</th>
          </tr>
        </thead>
        <tbody>
          {rows === null ? (
            <EmptyRow cols={cols}>Loading…</EmptyRow>
          ) : !rows.length ? (
            <EmptyRow cols={cols}>{empty}</EmptyRow>
          ) : (
            rows.map((r, i) => {
              const it = byId.get(r.itemId);
              return (
                <tr key={r.id} className={rowHover} title={r.note || undefined}>
                  <td className={cx(td, num, 'text-faint')}>{i + 1}</td>
                  <td className={cx(td, 'tabular-nums text-ink-soft')}>{dt(r.doneAt)}</td>
                  {showItem && (
                    <>
                      <td className={cx(td, 'max-w-[220px] truncate font-medium text-ink')} title={it?.name}>
                        {it ? it.name : 'Deleted item'}
                      </td>
                      <td className={cx(td, 'font-mono text-mute')}>{it?.code || '—'}</td>
                    </>
                  )}
                  <td className={td}>
                    <MoveCell m={r} />
                  </td>
                  <td className={cx(td, num, 'font-semibold text-ink')}>{signedQty(r)}</td>
                  <td className={cx(td, 'text-mute')}>{it?.unit || ''}</td>
                  <td className={cx(td, 'text-ink-soft')}>{r.location ? locationLabel(r.location) : '—'}</td>
                  <td className={cx(td, 'max-w-[150px] truncate text-ink-soft')}>{r.givenBy || '—'}</td>
                  <td className={cx(td, 'max-w-[150px] truncate text-ink-soft')}>{r.receivedBy || '—'}</td>
                  <td className={cx(td, 'max-w-[150px] truncate text-ink-soft')}>{r.returnedBy || '—'}</td>
                  <td
                    className={cx(td, 'max-w-[140px] truncate text-ink-soft')}
                    title={r.note ? `${r.ref} · ${r.note}` : r.ref}
                  >
                    {r.ref || (r.note ? <span className="text-faint">{r.note}</span> : '—')}
                  </td>
                  <td className={cx(td, 'text-mute')}>{r.doneBy}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </Sheet>
  );
};
