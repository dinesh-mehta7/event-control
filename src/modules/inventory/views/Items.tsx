import React, { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  ArrowRightLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  Edit3,
  History,
  Plus,
  RotateCcw,
  Search,
  Send,
  Tag,
  Trash2,
  Upload,
  Wrench,
} from 'lucide-react';
import { useInventory } from '../InventoryContext';
import type { Item } from '../types';
import { inStage, levelOf } from '../lib/stock';
import type { Stage } from '../lib/stock';
import type { Actions } from '../nav';
import { RowMenu, cx, iconBtn } from '../ui/kit';
import type { MenuAction } from '../ui/kit';
import {
  EmptyRow,
  Sheet,
  SortTh,
  StatusTag,
  cellTone,
  num,
  rowHover,
  sheetHead,
  sheetTable,
  td,
  th,
  useSort,
} from '../ui/sheet';

type SortKey = 'name' | 'code' | 'category' | 'location' | 'minLevel' | 'inStock' | 'issued' | 'damaged' | 'total';
const ctl =
  'h-8 rounded-md border border-line bg-field px-2.5 text-[11.5px] text-ink outline-none placeholder:text-faint focus:border-blue-500';
const tool =
  'inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-[11.5px] font-medium text-ink-soft hover:bg-raised';
const STATUS = {
  out: { label: 'Out of stock', cell: cellTone.out },
  low: { label: 'Low stock', cell: cellTone.low },
  ok: { label: 'In stock', cell: 'text-ink-soft' },
} as const;

export const ItemsView: React.FC<{ a: Actions; stage: Stage; setStage: (s: Stage) => void }> = ({
  a,
  stage,
  setStage,
}) => {
  const { items, stats, canManage, loading, holdingsOf, locationLabel, categories } = useInventory();
  const [cat, setCat] = useState('all');
  const [q, setQ] = useState('');
  const [size, setSize] = useState(100);
  const [page, setPage] = useState(0);
  const { sort, toggle } = useSort<SortKey>('name');

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = items.filter(
      i =>
        inStage(i, stage) &&
        (cat === 'all' || i.category === cat) &&
        (!t ||
          i.name.toLowerCase().includes(t) ||
          i.code.toLowerCase().includes(t) ||
          i.location.toLowerCase().includes(t)),
    );
    const val = (i: Item): string | number =>
      sort.key === 'total' ? i.inStock + i.issued + i.damaged : (i as any)[sort.key];
    return [...list].sort((x, y) => {
      const p = val(x),
        r = val(y);
      const c =
        typeof p === 'number' && typeof r === 'number'
          ? p - r
          : String(p).localeCompare(String(r), undefined, { numeric: true });
      return sort.dir === 'asc' ? c : -c;
    });
  }, [items, stage, cat, q, sort]);
  useEffect(() => {
    setPage(0);
  }, [stage, cat, q, size, sort]);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const view = rows.slice(page * size, page * size + size);
  const totals = rows.reduce((t, i) => ({ s: t.s + i.inStock, i: t.i + i.issued, d: t.d + i.damaged }), {
    s: 0,
    i: 0,
    d: 0,
  });

  const exportExcel = () => {
    const data = rows.map((i, n) => ({
      '#': n + 1,
      Item: i.name,
      Code: i.code,
      Category: i.category,
      Unit: i.unit,
      'Stored at': i.location,
      'Min level': i.minLevel,
      'In store': i.inStock,
      Issued: i.issued,
      Damaged: i.damaged,
      Total: i.inStock + i.issued + i.damaged,
      Status: STATUS[levelOf(i)].label,
      'Held at locations': holdingsOf(i.id)
        .map(h => `${locationLabel(h.location)}: ${h.qty}`)
        .join('; '),
    }));
    const sheet = XLSX.utils.json_to_sheet(data);
    sheet['!cols'] = [
      { wch: 5 },
      { wch: 30 },
      { wch: 14 },
      { wch: 18 },
      { wch: 8 },
      { wch: 22 },
      { wch: 9 },
      { wch: 9 },
      { wch: 8 },
      { wch: 9 },
      { wch: 8 },
      { wch: 13 },
      { wch: 40 },
    ];
    if (sheet['!ref']) sheet['!autofilter'] = { ref: sheet['!ref'] };
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Inventory');
    XLSX.writeFile(book, `inventory_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };
  const more = (i: Item): MenuAction[] => [
    { label: 'History', icon: History, onClick: () => a.onDetail(i) },
    {
      label: 'Return from location',
      icon: RotateCcw,
      onClick: () => a.openMove('return', i.id),
      hidden: !canManage || i.issued === 0,
    },
    { label: 'Mark damaged', icon: Wrench, onClick: () => a.openMove('damage', i.id), hidden: !canManage },
    { label: 'Correct count', icon: ArrowRightLeft, onClick: () => a.openMove('adjust', i.id), hidden: !canManage },
    { label: 'Edit item', icon: Edit3, onClick: () => a.onEdit(i), hidden: !canManage },
    { label: 'Delete item', icon: Trash2, onClick: () => a.onDelete(i), danger: true, hidden: !canManage },
  ];
  const filters: { key: Stage; label: string; n: number }[] = [
    { key: 'all', label: 'All', n: stats.total },
    { key: 'low', label: 'Low', n: stats.low },
    { key: 'out', label: 'Out', n: stats.out },
    { key: 'issued', label: 'Issued', n: stats.withIssued },
    { key: 'damaged', label: 'Damaged', n: stats.withDamaged },
  ];
  const sortTh = (key: SortKey, label: string, right = false) => (
    <SortTh label={label} active={sort.key === key} dir={sort.dir} onClick={() => toggle(key)} right={right} />
  );
  const cols = canManage ? 14 : 13;

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-2.5 xl:flex-row xl:items-center">
        <div className="grid min-w-0 flex-1 grid-cols-1 items-center gap-2 sm:grid-cols-[minmax(12rem,20rem)_12rem_auto]">
          <label className="relative block min-w-0">
            <span className="sr-only">Search items</span>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Search item, code or shelf…"
              className={cx(ctl, 'w-full pl-8')}
            />
          </label>
          <select
            value={cat}
            onChange={e => setCat(e.target.value)}
            aria-label="Category"
            className={cx(ctl, 'w-full')}
          >
            <option value="all">All categories</option>
            {categories.map(c => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <div
            role="group"
            aria-label="Stock filter"
            className="inline-flex h-8 w-max items-stretch rounded-md border border-line bg-raised/40 p-0.5"
          >
            {filters.map(f => (
              <button
                key={f.key}
                type="button"
                aria-pressed={stage === f.key}
                onClick={() => setStage(f.key)}
                className={cx(
                  'flex items-center gap-1 rounded px-2.5 text-[11.5px] font-medium',
                  stage === f.key ? 'bg-brand-soft text-brand shadow-sm' : 'text-mute hover:text-ink',
                )}
              >
                {f.label}
                <span className="tabular-nums text-faint">{f.n}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button className={tool} onClick={exportExcel} disabled={!rows.length}>
            <Download className="h-3.5 w-3.5" />
            Export Excel
          </button>
          {canManage && (
            <button className={tool} onClick={a.onCategories}>
              <Tag className="h-3.5 w-3.5" />
              Categories
            </button>
          )}
          {canManage && (
            <button className={tool} onClick={a.onImport}>
              <Upload className="h-3.5 w-3.5" />
              Import
            </button>
          )}
          {canManage && (
            <button
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-blue-600 px-3 text-[11.5px] font-semibold text-white hover:bg-blue-500"
              onClick={() => a.onEdit('new')}
            >
              <Plus className="h-3.5 w-3.5" />
              Add item
            </button>
          )}
        </div>
      </div>

      <Sheet
        title="Stock register"
        count={rows.length}
        footer={
          <>
            <span>
              {rows.length
                ? `Rows ${page * size + 1}–${Math.min(rows.length, page * size + size)} of ${rows.length}`
                : '0 rows'}{' '}
              · In store <b className="tabular-nums text-ink">{totals.s}</b> · Issued{' '}
              <b className="tabular-nums text-ink">{totals.i}</b> · Damaged{' '}
              <b className="tabular-nums text-ink">{totals.d}</b>
            </span>
            <span className="flex items-center gap-1.5">
              <select
                aria-label="Rows per page"
                value={size}
                onChange={e => setSize(+e.target.value)}
                className={cx(ctl, 'h-7 w-auto px-1.5')}
              >
                {[50, 100, 200, 500].map(n => (
                  <option key={n} value={n}>
                    {n} rows
                  </option>
                ))}
              </select>
              <button
                className={iconBtn}
                disabled={page === 0}
                onClick={() => setPage(p => p - 1)}
                aria-label="Previous page"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="tabular-nums">
                {page + 1} / {pages}
              </span>
              <button
                className={iconBtn}
                disabled={page >= pages - 1}
                onClick={() => setPage(p => p + 1)}
                aria-label="Next page"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </span>
          </>
        }
      >
        <table className={cx(sheetTable, 'min-w-[1250px]')}>
          <thead className={sheetHead}>
            <tr>
              <th className={cx(th, 'w-10 text-right')}>#</th>
              {sortTh('name', 'Item')}
              {sortTh('code', 'Code')}
              {sortTh('category', 'Category')}
              <th className={th}>Unit</th>
              {sortTh('location', 'Stored at')}
              {sortTh('minLevel', 'Min', true)}
              {sortTh('inStock', 'In store', true)}
              {sortTh('issued', 'Issued', true)}
              {sortTh('damaged', 'Damaged', true)}
              {sortTh('total', 'Total', true)}
              <th className={th}>Status</th>
              <th className={th}>Held at locations</th>
              {canManage && <th className={cx(th, 'w-40')}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {view.map((i, n) => {
              const l = levelOf(i);
              const held = holdingsOf(i.id);
              return (
                <tr key={i.id} className={rowHover}>
                  <td className={cx(td, num, 'text-faint')}>{page * size + n + 1}</td>
                  <td className={cx(td, 'max-w-[260px] truncate font-semibold')} title={i.name}>
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
                  <td className={cx(td, 'text-mute')}>{i.unit}</td>
                  <td className={cx(td, 'max-w-[180px] truncate text-ink-soft')} title={i.location}>
                    {i.location || '—'}
                  </td>
                  <td className={cx(td, num, 'text-mute')}>{i.minLevel || '—'}</td>
                  <td className={cx(td, num, 'font-semibold', l === 'ok' ? 'text-ink' : STATUS[l].cell)}>
                    {i.inStock}
                  </td>
                  <td className={cx(td, num, i.issued ? 'text-ink' : 'text-faint')}>{i.issued}</td>
                  <td className={cx(td, num, i.damaged ? cellTone.damaged : 'text-faint')}>{i.damaged}</td>
                  <td className={cx(td, num, cellTone.total)}>{i.inStock + i.issued + i.damaged}</td>
                  <td className={cx(td, STATUS[l].cell)}>
                    <StatusTag level={l} label={STATUS[l].label} />
                  </td>
                  <td
                    className={cx(td, 'max-w-[260px] truncate text-ink-soft')}
                    title={held.map(h => `${locationLabel(h.location)}: ${h.qty}`).join(', ')}
                  >
                    {held.length ? (
                      held.map(h => `${locationLabel(h.location)} (${h.qty})`).join(', ')
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </td>
                  {canManage && (
                    <td className={cx(td, 'py-1')}>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          className="inline-flex h-6 items-center gap-1 rounded border border-line px-2 text-[11px] text-ink-soft hover:bg-raised"
                          onClick={() => a.openMove('issue', i.id)}
                        >
                          <Send className="h-3 w-3" />
                          Issue
                        </button>
                        <button
                          type="button"
                          className="inline-flex h-6 items-center gap-1 rounded border border-line px-2 text-[11px] text-ink-soft hover:bg-raised"
                          onClick={() => a.openMove('receive', i.id)}
                        >
                          <Plus className="h-3 w-3" />
                          Receive
                        </button>
                        <RowMenu label={`More actions for ${i.name}`} actions={more(i)} />
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
            {!view.length && (
              <EmptyRow cols={cols}>
                {loading
                  ? 'Loading…'
                  : items.length === 0
                    ? canManage
                      ? 'No items yet — use "Add item" or "Import".'
                      : 'No items added yet.'
                    : 'No items match these filters.'}
              </EmptyRow>
            )}
          </tbody>
        </table>
      </Sheet>
    </div>
  );
};
