import React, { useMemo } from 'react';
import { PackageCheck, Plus, RotateCcw, Send, Wrench } from 'lucide-react';
import { useInventory } from '../InventoryContext';
import { inStage, levelOf, totalsByLocation } from '../lib/stock';
import { useRecent } from '../lib/useRecent';
import type { Actions } from '../nav';
import { cx } from '../ui/kit';
import { EmptyRow, MoveTable, Sheet, cellTone, num, rowHover, sheetHead, sheetTable, td, th } from '../ui/sheet';

const tool =
  'inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-3 text-[11.5px] font-medium text-ink-soft hover:bg-raised disabled:opacity-50';
const link = 'text-[11px] font-medium text-blue-300 hover:underline';

export const Overview: React.FC<{ a: Actions }> = ({ a }) => {
  const { items, holdings, stats, canManage, locationLabel } = useInventory();
  const recent = useRecent(undefined, 12);
  const restock = useMemo(
    () =>
      items
        .filter(i => inStage(i, 'low') || inStage(i, 'out'))
        .sort((x, y) => x.inStock - y.inStock || x.name.localeCompare(y.name)),
    [items],
  );
  const byLoc = useMemo(() => totalsByLocation(holdings), [holdings]);
  const units = useMemo(
    () =>
      items.reduce((t, i) => ({ store: t.store + i.inStock, out: t.out + i.issued, bad: t.bad + i.damaged }), {
        store: 0,
        out: 0,
        bad: 0,
      }),
    [items],
  );

  // Summary row: label / value pairs that jump to the matching filtered view.
  const summary: { label: string; value: number; sub?: string; tone?: string; bar?: string; go: () => void }[] = [
    { label: 'Items', value: stats.total, sub: `${units.store} units in store`, go: () => a.go('items', 'all') },
    {
      label: 'Low stock',
      value: stats.low,
      tone: stats.low ? 'text-amber-300' : '',
      bar: stats.low ? 'border-t-amber-400' : 'border-t-line',
      go: () => a.go('items', 'low'),
    },
    {
      label: 'Out of stock',
      value: stats.out,
      tone: stats.out ? 'text-rose-300' : '',
      bar: stats.out ? 'border-t-rose-500' : 'border-t-line',
      go: () => a.go('items', 'out'),
    },
    {
      label: 'Issued out',
      value: stats.withIssued,
      sub: `${units.out} units at locations`,
      go: () => a.go('allocations'),
    },
    {
      label: 'Damaged',
      value: stats.withDamaged,
      sub: `${units.bad} units`,
      tone: stats.withDamaged ? 'text-orange-300' : '',
      bar: stats.withDamaged ? 'border-t-orange-400' : 'border-t-line',
      go: () => a.go('maintenance'),
    },
    { label: 'Locations', value: byLoc.length, sub: 'holding stock', go: () => a.go('locations') },
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-line bg-surface sm:grid-cols-3 xl:grid-cols-6">
        {summary.map(s => (
          <button
            key={s.label}
            type="button"
            onClick={s.go}
            className={cx(
              'border-b border-r border-t-[3px] border-line/70 px-3 py-2.5 text-left transition-colors hover:bg-brand-soft/60 xl:border-b-0',
              s.bar || 'border-t-brand',
            )}
          >
            <div className="text-[10.5px] font-semibold uppercase tracking-wide text-mute">{s.label}</div>
            <div className={cx('mt-0.5 text-xl font-semibold tabular-nums text-ink', s.tone)}>{s.value}</div>
            {s.sub && <div className="text-[11px] text-faint">{s.sub}</div>}
          </button>
        ))}
      </div>

      {canManage && (
        <div className="flex flex-wrap gap-1.5">
          <button className={tool} disabled={!items.length} onClick={() => a.openMove('issue')}>
            <Send className="h-3.5 w-3.5" />
            Issue stock
          </button>
          <button className={tool} disabled={!items.length} onClick={() => a.openMove('receive')}>
            <PackageCheck className="h-3.5 w-3.5" />
            Receive stock
          </button>
          <button
            className={tool}
            disabled={!items.some(i => i.issued > 0)}
            onClick={() => a.openMove('return', items.find(i => i.issued > 0)?.id)}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Record return
          </button>
          <button className={tool} disabled={!items.length} onClick={() => a.openMove('damage')}>
            <Wrench className="h-3.5 w-3.5" />
            Mark damaged
          </button>
          <button className={tool} onClick={() => a.onEdit('new')}>
            <Plus className="h-3.5 w-3.5" />
            Add item
          </button>
        </div>
      )}

      <div className="grid gap-3 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Sheet
          title="Needs restock"
          count={restock.length}
          maxHeight="max-h-80"
          tools={
            <button type="button" className={link} onClick={() => a.go('items', 'low')}>
              Open in Items
            </button>
          }
        >
          <table className={cx(sheetTable, 'min-w-[620px]')}>
            <thead className={sheetHead}>
              <tr>
                <th className={cx(th, 'w-10 text-right')}>#</th>
                <th className={th}>Item</th>
                <th className={th}>Code</th>
                <th className={th}>Category</th>
                <th className={cx(th, 'text-right')}>In store</th>
                <th className={cx(th, 'text-right')}>Min</th>
                <th className={cx(th, 'text-right')}>Shortfall</th>
                {canManage && <th className={th} />}
              </tr>
            </thead>
            <tbody>
              {restock.map((i, n) => (
                <tr key={i.id} className={rowHover}>
                  <td className={cx(td, num, 'text-faint')}>{n + 1}</td>
                  <td className={cx(td, 'max-w-[220px] truncate font-medium')}>
                    <button
                      type="button"
                      className="text-ink hover:text-blue-300 hover:underline"
                      onClick={() => a.onDetail(i)}
                    >
                      {i.name}
                    </button>
                  </td>
                  <td className={cx(td, 'font-mono text-mute')}>{i.code || '—'}</td>
                  <td className={cx(td, 'text-ink-soft')}>{i.category}</td>
                  <td className={cx(td, num, 'font-semibold', levelOf(i) === 'out' ? cellTone.out : cellTone.low)}>
                    {i.inStock} <span className="font-normal text-faint">{i.unit}</span>
                  </td>
                  <td className={cx(td, num, 'text-mute')}>{i.minLevel}</td>
                  <td className={cx(td, num, cellTone.total)}>{Math.max(0, i.minLevel - i.inStock)}</td>
                  {canManage && (
                    <td className={cx(td, 'py-1')}>
                      <button
                        type="button"
                        className="inline-flex h-6 items-center gap-1 rounded border border-line px-2 text-[11px] text-ink-soft hover:bg-raised"
                        onClick={() => a.openMove('receive', i.id)}
                      >
                        <Plus className="h-3 w-3" />
                        Receive
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {!restock.length && <EmptyRow cols={canManage ? 8 : 7}>Nothing is low right now.</EmptyRow>}
            </tbody>
          </table>
        </Sheet>

        <Sheet
          title="Held at locations"
          count={byLoc.length}
          maxHeight="max-h-80"
          tools={
            <button type="button" className={link} onClick={() => a.go('locations')}>
              Open Locations
            </button>
          }
        >
          <table className={cx(sheetTable, 'min-w-[380px]')}>
            <thead className={sheetHead}>
              <tr>
                <th className={cx(th, 'w-10 text-right')}>#</th>
                <th className={th}>Location</th>
                <th className={cx(th, 'text-right')}>Items</th>
                <th className={cx(th, 'text-right')}>Units</th>
                <th className={cx(th, 'text-right')}>Share</th>
              </tr>
            </thead>
            <tbody>
              {byLoc.map(([loc, v], n) => (
                <tr key={loc} className={rowHover}>
                  <td className={cx(td, num, 'text-faint')}>{n + 1}</td>
                  <td className={cx(td, 'font-medium text-ink')}>{locationLabel(loc)}</td>
                  <td className={cx(td, num, 'text-ink-soft')}>{v.kinds}</td>
                  <td className={cx(td, num, 'font-semibold text-ink')}>{v.qty}</td>
                  <td className={cx(td, num, 'text-mute')}>
                    {units.out ? `${Math.round((v.qty / units.out) * 100)}%` : '—'}
                  </td>
                </tr>
              ))}
              {!byLoc.length && <EmptyRow cols={5}>No stock has been issued yet.</EmptyRow>}
            </tbody>
          </table>
        </Sheet>
      </div>

      <MoveTable
        title="Recent activity"
        rows={recent}
        empty="No movements yet."
        maxHeight="max-h-96"
        tools={
          <button type="button" className={link} onClick={() => a.go('history')}>
            Full history
          </button>
        }
      />
    </div>
  );
};
