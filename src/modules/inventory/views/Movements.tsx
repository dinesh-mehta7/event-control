import React, { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { Download, RotateCcw, Search, Send, Wrench } from 'lucide-react';
import { useInventory } from '../InventoryContext';
import { MOVE, MOVES } from '../types';
import type { Item, MoveType } from '../types';
import { useRecent } from '../lib/useRecent';
import type { Actions } from '../nav';
import { cx } from '../ui/kit';
import { EmptyRow, MoveTable, Sheet, cellTone, num, rowHover, sheetHead, sheetTable, td, th } from '../ui/sheet';
import { ctl } from '../../../components/toolbar';
import { rowBtn } from '../../../components/toolbar';
import { tool } from '../../../components/toolbar';
const primaryTool =
  'inline-flex h-8 items-center gap-1.5 rounded-md bg-blue-600 px-3 text-[11.5px] font-semibold text-white hover:bg-blue-500 disabled:opacity-50';

// Stock currently out, one row per item × location.
export const IssuedView: React.FC<{ a: Actions }> = ({ a }) => {
  const { items, holdings, canManage, locationLabel } = useInventory();
  const recent = useRecent(['issue'], 200);
  const byId = useMemo(() => new Map<string, Item>(items.map(i => [i.id, i] as [string, Item])), [items]);
  const rows = useMemo(
    () =>
      holdings
        .filter(h => h.qty > 0 && byId.has(h.itemId))
        .map(h => ({ ...h, item: byId.get(h.itemId)! }))
        .sort(
          (x, y) =>
            locationLabel(x.location).localeCompare(locationLabel(y.location)) ||
            x.item.name.localeCompare(y.item.name),
        ),
    [holdings, byId, locationLabel],
  );
  const total = rows.reduce((s, r) => s + r.qty, 0);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-mute">Stock that is out at locations right now, and every issue recorded.</p>
        {canManage && (
          <button className={primaryTool} onClick={() => a.openMove('issue', items[0]?.id)} disabled={!items.length}>
            <Send className="h-3.5 w-3.5" />
            Issue stock
          </button>
        )}
      </div>
      <Sheet
        title="Currently out"
        count={rows.length}
        maxHeight="max-h-[26rem]"
        footer={
          <span>
            Total out <b className="tabular-nums text-ink">{total}</b> units across{' '}
            {new Set(rows.map(r => r.location)).size} locations
          </span>
        }
      >
        <table className={cx(sheetTable, 'min-w-[760px]')}>
          <thead className={sheetHead}>
            <tr>
              <th className={cx(th, 'w-10 text-right')}>#</th>
              <th className={th}>Location</th>
              <th className={th}>Item</th>
              <th className={th}>Code</th>
              <th className={th}>Category</th>
              <th className={cx(th, 'text-right')}>Qty out</th>
              <th className={th}>Unit</th>
              {canManage && <th className={th} />}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, n) => (
              <tr key={`${r.itemId}-${r.location}`} className={rowHover}>
                <td className={cx(td, num, 'text-faint')}>{n + 1}</td>
                <td className={cx(td, 'font-medium text-ink')}>{locationLabel(r.location)}</td>
                <td className={cx(td, 'max-w-[240px] truncate')}>
                  <button
                    type="button"
                    className="text-ink hover:text-blue-300 hover:underline"
                    onClick={() => a.onDetail(r.item)}
                  >
                    {r.item.name}
                  </button>
                </td>
                <td className={cx(td, 'font-mono text-mute')}>{r.item.code || '—'}</td>
                <td className={cx(td, 'text-ink-soft')}>{r.item.category}</td>
                <td className={cx(td, num, 'font-semibold text-ink')}>{r.qty}</td>
                <td className={cx(td, 'text-mute')}>{r.item.unit}</td>
                {canManage && (
                  <td className={cx(td, 'py-1')}>
                    <button type="button" className={rowBtn} onClick={() => a.openMove('return', r.itemId)}>
                      <RotateCcw className="h-3 w-3" />
                      Return
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {!rows.length && <EmptyRow cols={canManage ? 8 : 7}>Nothing is issued right now.</EmptyRow>}
          </tbody>
        </table>
      </Sheet>
      <MoveTable title="Issue register" rows={recent} empty="No stock has been issued yet." maxHeight="max-h-96" />
    </div>
  );
};

export const ReturnsView: React.FC<{ a: Actions }> = ({ a }) => {
  const { items, canManage } = useInventory();
  const recent = useRecent(['return', 'return_damaged'], 300);
  const first = items.find(i => i.issued > 0);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-mute">Good and damaged stock coming back from locations.</p>
        {canManage && (
          <div className="flex gap-1.5">
            <button className={tool} onClick={() => a.openMove('return_damaged', first?.id)} disabled={!first}>
              Return · damaged
            </button>
            <button className={primaryTool} onClick={() => a.openMove('return', first?.id)} disabled={!first}>
              <RotateCcw className="h-3.5 w-3.5" />
              Record return
            </button>
          </div>
        )}
      </div>
      <MoveTable title="Returns register" rows={recent} empty="No returns recorded yet." />
    </div>
  );
};

export const MaintenanceView: React.FC<{ a: Actions }> = ({ a }) => {
  const { items, canManage } = useInventory();
  const bad = items.filter(i => i.damaged > 0).sort((x, y) => y.damaged - x.damaged);
  const recent = useRecent(['damage', 'repair', 'write_off', 'return_damaged'], 300);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-mute">Damaged stock waiting to be repaired or written off.</p>
        {canManage && (
          <button className={tool} onClick={() => a.openMove('damage', items[0]?.id)} disabled={!items.length}>
            <Wrench className="h-3.5 w-3.5" />
            Mark damaged
          </button>
        )}
      </div>
      <Sheet
        title="Damaged stock"
        count={bad.length}
        maxHeight="max-h-[26rem]"
        footer={
          <span>
            Total damaged <b className="tabular-nums text-ink">{bad.reduce((s, i) => s + i.damaged, 0)}</b> units
          </span>
        }
      >
        <table className={cx(sheetTable, 'min-w-[760px]')}>
          <thead className={sheetHead}>
            <tr>
              <th className={cx(th, 'w-10 text-right')}>#</th>
              <th className={th}>Item</th>
              <th className={th}>Code</th>
              <th className={th}>Category</th>
              <th className={cx(th, 'text-right')}>Damaged</th>
              <th className={cx(th, 'text-right')}>In store</th>
              <th className={th}>Unit</th>
              {canManage && <th className={th}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {bad.map((i, n) => (
              <tr key={i.id} className={rowHover}>
                <td className={cx(td, num, 'text-faint')}>{n + 1}</td>
                <td className={cx(td, 'max-w-[240px] truncate')}>
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
                <td className={cx(td, num, cellTone.damaged)}>{i.damaged}</td>
                <td className={cx(td, num, 'text-ink-soft')}>{i.inStock}</td>
                <td className={cx(td, 'text-mute')}>{i.unit}</td>
                {canManage && (
                  <td className={cx(td, 'py-1')}>
                    <div className="flex gap-1">
                      <button type="button" className={rowBtn} onClick={() => a.openMove('repair', i.id)}>
                        Repaired
                      </button>
                      <button
                        type="button"
                        className={cx(rowBtn, 'text-rose-300')}
                        onClick={() => a.openMove('write_off', i.id)}
                      >
                        Write off
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {!bad.length && <EmptyRow cols={canManage ? 8 : 7}>Nothing is damaged.</EmptyRow>}
          </tbody>
        </table>
      </Sheet>
      <MoveTable title="Maintenance log" rows={recent} empty="No maintenance activity yet." maxHeight="max-h-96" />
    </div>
  );
};

export const HistoryView: React.FC = () => {
  const { items, locationLabel } = useInventory();
  const rows = useRecent(undefined, 1000);
  const [type, setType] = useState<'all' | MoveType>('all');
  const [q, setQ] = useState('');
  const byId = useMemo(() => new Map<string, Item>(items.map(i => [i.id, i] as [string, Item])), [items]);
  const shown = useMemo(() => {
    if (!rows) return null;
    const t = q.trim().toLowerCase();
    return rows.filter(
      r =>
        (type === 'all' || r.type === type) &&
        (!t ||
          (byId.get(r.itemId)?.name || '').toLowerCase().includes(t) ||
          [r.givenBy, r.receivedBy, r.returnedBy].some(x => x.toLowerCase().includes(t)) ||
          r.ref.toLowerCase().includes(t) ||
          r.doneBy.toLowerCase().includes(t)),
    );
  }, [rows, type, q, byId]);
  const exportExcel = () => {
    if (!shown) return;
    const sheet = XLSX.utils.json_to_sheet(
      shown.map((r, n) => {
        const it = byId.get(r.itemId);
        return {
          '#': n + 1,
          'Date & time': new Date(r.doneAt).toLocaleString('en-IN'),
          Item: it?.name || 'Deleted item',
          Code: it?.code || '',
          Movement: MOVE[r.type].label,
          Qty: r.qty,
          Unit: it?.unit || '',
          Location: r.location ? locationLabel(r.location) : '',
          'Given / from': r.givenBy,
          'Received by': r.receivedBy,
          'Returned by': r.returnedBy,
          Ref: r.ref,
          Note: r.note,
          'Recorded by': r.doneBy,
        };
      }),
    );
    sheet['!cols'] = [
      { wch: 5 },
      { wch: 20 },
      { wch: 28 },
      { wch: 12 },
      { wch: 16 },
      { wch: 7 },
      { wch: 7 },
      { wch: 18 },
      { wch: 18 },
      { wch: 18 },
      { wch: 18 },
      { wch: 14 },
      { wch: 28 },
      { wch: 18 },
    ];
    if (sheet['!ref']) sheet['!autofilter'] = { ref: sheet['!ref'] };
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Stock movements');
    XLSX.writeFile(book, `inventory_movements_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };
  return (
    <MoveTable
      title="Stock movement ledger"
      rows={shown}
      empty="No movements match."
      tools={
        <>
          <label className="relative">
            <span className="sr-only">Search history</span>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Search item, person, ref…"
              className={cx(ctl, 'w-56 pl-8')}
            />
          </label>
          <select
            value={type}
            onChange={e => setType(e.target.value as 'all' | MoveType)}
            aria-label="Movement type"
            className={cx(ctl, 'w-auto')}
          >
            <option value="all">All movements</option>
            {MOVES.map(m => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
          <button type="button" className={tool} onClick={exportExcel} disabled={!shown?.length}>
            <Download className="h-3.5 w-3.5" />
            Export Excel
          </button>
        </>
      }
    />
  );
};
