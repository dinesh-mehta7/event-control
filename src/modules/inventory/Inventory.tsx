import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, MapPin, Tag, ChevronLeft, ChevronRight, ClipboardList, Download, Edit3, History, LayoutDashboard, Package, Plus, RotateCcw, Search, Send, Trash2, Upload, Wrench } from 'lucide-react';
import { Modal, ConfirmModal, btnGhost, cx, inputCls, labelCls } from '../accommodation/ui';
import { useInventory } from './InventoryContext';
import type { Loc, ItemInput } from './InventoryContext';
import { MOVE, MOVES, UNITS } from './types';
import type { Item, MoveType, Movement } from './types';
import { ServiceInbox } from '../requests/ServiceInbox';

// The command-center shell is always dark, so this module is dark-only.
const D = true;
const panel = 'rounded-xl border border-line bg-surface/50';
const chip = 'text-xs px-1.5 py-0.5 rounded-full border border-line-strong bg-raised/60 text-ink-soft';
const TONE: Record<string, string> = {
  ok: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  warn: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  bad: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  info: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  mute: 'bg-raised text-mute border-line-strong',
};
const amber = 'inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold bg-amber-600 hover:bg-amber-500 text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 disabled:opacity-50 disabled:cursor-not-allowed';
const SUB: Record<string, string> = {
  dashboard: 'Stock at a glance: what to restock, who holds what, latest activity.',
  items: 'Add, edit, delete and count every item in the store.',
  locations: 'Places stock has been issued to, and what is at each one.',
  allocations: 'Stock that is currently out at locations, and with whom.',
  returns: 'Good and damaged stock coming back from locations.',
  maintenance: 'Damaged items: mark, repair or write off.',
  history: 'Every stock movement, newest first.',
  requests: 'Department requests for items and equipment assigned to the Inventory team.',
};
type Stage = 'all' | 'low' | 'out' | 'issued' | 'damaged';
const inStage = (i: Item, s: Stage) =>
  s === 'low' ? i.inStock > 0 && i.minLevel > 0 && i.inStock <= i.minLevel
  : s === 'out' ? i.inStock === 0
  : s === 'issued' ? i.issued > 0
  : s === 'damaged' ? i.damaged > 0 : true;

type Tab = 'dashboard' | 'items' | 'locations' | 'allocations' | 'returns' | 'maintenance' | 'history' | 'requests';
const NAV: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'items', label: 'Items', icon: Package },
  { id: 'locations', label: 'Locations', icon: MapPin },
  { id: 'allocations', label: 'Allocations', icon: Send },
  { id: 'returns', label: 'Returns', icon: RotateCcw },
  { id: 'maintenance', label: 'Maintenance', icon: Wrench },
  { id: 'history', label: 'Activity History', icon: History },
  { id: 'requests', label: 'Department Requests', icon: ClipboardList },
];
type OpenMove = (type: MoveType, itemId?: string) => void;
const when = (s: string) => new Date(s).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

// ---- small shared pieces ---------------------------------------------------
const Stat: React.FC<{ label: string; value: number; dot?: string; onClick?: () => void }> = ({ label, value, dot, onClick }) => (
  <button onClick={onClick} className={cx(panel, 'px-4 py-3.5 text-left hover:bg-raised/40 transition-colors')}>
    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-mute">{dot && <span className={cx('w-2 h-2 rounded-full', dot)} />}{label}</div>
    <div className="text-2xl font-bold mt-1 tabular-nums">{value}</div>
  </button>
);
const Section: React.FC<{ title: string; action?: React.ReactNode; children: React.ReactNode }> = ({ title, action, children }) => (
  <section className={cx(panel, 'overflow-hidden')}>
    <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-line">
      <h2 className="text-sm font-bold">{title}</h2>{action}
    </div>
    {children}
  </section>
);
const Empty: React.FC<{ children: React.ReactNode }> = ({ children }) => <p className="py-10 px-4 text-center text-sm text-faint">{children}</p>;

// Latest movements (all items), refreshed whenever any stock number changes.
const useRecent = (types: MoveType[] | undefined, limit = 300) => {
  const { fetchRecent, items } = useInventory();
  const [rows, setRows] = useState<Movement[] | null>(null);
  const sig = items.reduce((a, i) => a + i.inStock + i.issued * 7 + i.damaged * 13, 0);
  const key = types ? types.join(',') : '';
  useEffect(() => { let on = true; fetchRecent(types, limit).then(r => { if (on) setRows(r); }); return () => { on = false; }; }, [key, limit, sig]); // eslint-disable-line
  return rows;
};

// Who was involved in a movement, as one readable line.
const peopleLine = (r: Movement) => [
  r.givenBy && `${r.type === 'receive' ? 'From' : 'Given by'} ${r.givenBy}`,
  r.returnedBy && `Returned by ${r.returnedBy}`,
  r.receivedBy && `Received by ${r.receivedBy}`,
  r.ref && `Ref ${r.ref}`, r.note,
].filter(Boolean).join(' · ');

const MoveList: React.FC<{ rows: Movement[] | null; empty: string }> = ({ rows, empty }) => {
  const { items, locationLabel } = useInventory();
  const byId = useMemo(() => new Map<string, Item>(items.map(i => [i.id, i] as [string, Item])), [items]);
  if (rows === null) return <Empty>Loading…</Empty>;
  if (!rows.length) return <Empty>{empty}</Empty>;
  return (
    <ul className="divide-y divide-line/70">
      {rows.map(r => {
        const it = byId.get(r.itemId);
        return (
          <li key={r.id} className="px-4 py-3 flex items-start justify-between gap-3 text-sm">
            <div className="min-w-0">
              <div className="font-semibold truncate">{it ? it.name : 'Deleted item'}</div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className={cx('text-xs font-semibold px-2 py-0.5 rounded-full border', TONE[MOVE[r.type].tone])}>{MOVE[r.type].label}</span>
                <span className="font-bold tabular-nums">{r.type === 'adjust' && r.qty > 0 ? `+${r.qty}` : r.qty}{it ? <span className="text-xs text-faint font-normal"> {it.unit}</span> : null}</span>
                {r.location && <span className="text-xs text-mute inline-flex items-center gap-1"><MapPin className="w-3 h-3" />{locationLabel(r.location)}</span>}
              </div>
              {peopleLine(r) && <div className="text-xs text-mute mt-1">{peopleLine(r)}</div>}
            </div>
            <div className="text-xs text-faint text-right shrink-0">{when(r.doneAt)}<br />{r.doneBy}</div>
          </li>
        );
      })}
    </ul>
  );
};

const HeldChips: React.FC<{ itemId: string }> = ({ itemId }) => {
  const { holdingsOf, locationLabel } = useInventory();
  return <div className="flex flex-wrap gap-1 mt-1">{holdingsOf(itemId).map(h => <span key={h.location} className={chip}>{locationLabel(h.location)} · {h.qty}</span>)}</div>;
};

// ---- views -----------------------------------------------------------------
const DashboardView: React.FC<{ go: (t: Tab, s?: Stage) => void; openMove: OpenMove }> = ({ go, openMove }) => {
  const { items, holdings, stats, canManage, locationLabel } = useInventory();
  const recent = useRecent(undefined, 8);
  const restock = items.filter(i => inStage(i, 'low') || inStage(i, 'out')).slice(0, 8);
  const byLoc = useMemo(() => {
    const m = new Map<string, { qty: number; kinds: number }>();
    holdings.filter(h => h.qty > 0).forEach(h => { const c = m.get(h.location) || { qty: 0, kinds: 0 }; c.qty += h.qty; c.kinds += 1; m.set(h.location, c); });
    return Array.from(m.entries()).sort((a, b) => b[1].qty - a[1].qty);
  }, [holdings]);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Stat label="All items" value={stats.total} onClick={() => go('items', 'all')} />
        <Stat label="Low stock" value={stats.low} dot="bg-amber-400" onClick={() => go('items', 'low')} />
        <Stat label="Out of stock" value={stats.out} dot="bg-rose-400" onClick={() => go('items', 'out')} />
        <Stat label="Issued out" value={stats.withIssued} dot="bg-blue-400" onClick={() => go('allocations')} />
        <Stat label="Damaged" value={stats.withDamaged} dot="bg-orange-400" onClick={() => go('maintenance')} />
      </div>
      <div className="grid lg:grid-cols-2 gap-5">
        <Section title="Needs restock">
          {restock.length === 0 ? <Empty>Nothing is low right now.</Empty> : (
            <ul className="divide-y divide-line/70">
              {restock.map(i => (
                <li key={i.id} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0"><div className="font-semibold text-sm truncate">{i.name}</div><div className="text-xs text-faint">min {i.minLevel} {i.unit}</div></div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={cx('text-lg font-bold tabular-nums', i.inStock === 0 ? 'text-rose-400' : 'text-amber-400')}>{i.inStock}</span>
                    {canManage && <button className={btnGhost(D)} onClick={() => openMove('receive', i.id)}><Plus className="w-3.5 h-3.5" />Receive</button>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Held at locations" action={<button className="text-xs text-blue-400 hover:underline" onClick={() => go('locations')}>See all</button>}>
          {byLoc.length === 0 ? <Empty>No stock has been issued yet.</Empty> : (
            <ul className="divide-y divide-line/70">
              {byLoc.map(([d, v]) => (
                <li key={d} className="px-4 py-3 flex items-center justify-between text-sm"><span className="font-semibold">{locationLabel(d)}</span><span className="text-mute"><b className="text-ink tabular-nums">{v.qty}</b> units · {v.kinds} items</span></li>
              ))}
            </ul>
          )}
        </Section>
      </div>
      <Section title="Recent activity" action={<button className="text-xs text-blue-400 hover:underline" onClick={() => go('history')}>Full history</button>}>
        <MoveList rows={recent} empty="No movements yet." />
      </Section>
    </div>
  );
};

const ItemsView: React.FC<{ stage: Stage; setStage: (s: Stage) => void; openMove: OpenMove; onEdit: (i: Item | 'new') => void; onHistory: (i: Item) => void; onImport: () => void; onCategories: () => void; onDelete: (i: Item) => void }> = ({ stage, setStage, openMove, onEdit, onHistory, onImport, onCategories, onDelete }) => {
  const { items, stats, canManage, loading, holdingsOf, locationLabel, categories } = useInventory();
  const [cat, setCat] = useState('all');
  const [q, setQ] = useState('');
  const [size, setSize] = useState(50);
  const [page, setPage] = useState(0);
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return items.filter(i => inStage(i, stage) && (cat === 'all' || i.category === cat)
      && (!t || i.name.toLowerCase().includes(t) || i.code.toLowerCase().includes(t) || i.location.toLowerCase().includes(t)));
  }, [items, stage, cat, q]);
  useEffect(() => { setPage(0); }, [stage, cat, q, size]);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const view = rows.slice(page * size, page * size + size);

  const exportCSV = () => {
    const head = ['Item', 'Code', 'Category', 'Stored at', 'Unit', 'In store', 'Min level', 'Issued', 'Damaged', 'Issued at (location)'];
    const body = rows.map(i => [i.name, i.code, i.category, i.location, i.unit, i.inStock, i.minLevel, i.issued, i.damaged,
      holdingsOf(i.id).map(h => `${locationLabel(h.location)}: ${h.qty}`).join('; ')]);
    const csv = [head, ...body].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `inventory_${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  const tabs: { key: Stage; label: string; n: number; dot: string }[] = [
    { key: 'all', label: 'All items', n: stats.total, dot: '' },
    { key: 'low', label: 'Low stock', n: stats.low, dot: 'bg-amber-400' },
    { key: 'out', label: 'Out of stock', n: stats.out, dot: 'bg-rose-400' },
    { key: 'issued', label: 'Issued out', n: stats.withIssued, dot: 'bg-blue-400' },
    { key: 'damaged', label: 'Damaged', n: stats.withDamaged, dot: 'bg-orange-400' },
  ];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5 justify-end">
        <button className={btnGhost(D)} onClick={exportCSV}><Download className="w-4 h-4" />Export</button>
        {canManage && <button className={btnGhost(D)} onClick={onCategories}><Tag className="w-4 h-4" />Categories</button>}
        {canManage && <button className={btnGhost(D)} onClick={onImport}><Upload className="w-4 h-4" />Import list</button>}
        {canManage && <button className={amber} onClick={() => onEdit('new')}><Plus className="w-4 h-4" />Add item</button>}
      </div>
      <section className={cx(panel, 'overflow-hidden')}>
        <div className="flex flex-wrap items-center gap-1.5 px-2.5 py-2">
          <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-faint">Filter</span>
          {tabs.map(t => (
            <button key={t.key} onClick={() => setStage(t.key)} aria-pressed={stage === t.key}
              className={cx('inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] transition-colors', stage === t.key ? 'border-amber-500/40 bg-amber-500/10 text-amber-200' : 'border-transparent text-mute hover:border-line hover:bg-raised hover:text-ink')}>
              {t.dot && <span className={cx('w-1.5 h-1.5 rounded-full', t.dot)} />}{t.label}<span className="font-semibold tabular-nums">{t.n}</span>
            </button>
          ))}
        </div>
        <div className="p-2 flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between border-t border-line">
          <div className="relative w-full sm:max-w-sm">
            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-faint" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search item, code or location…" className={cx(inputCls(D), 'h-8 pl-8 py-1.5 text-xs')} />
          </div>
          <select value={cat} onChange={e => setCat(e.target.value)} aria-label="Category" className={cx(inputCls(D), 'h-8 w-auto py-1.5 text-xs')}>
            <option value="all">All categories</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </section>
      <section className={cx(panel, 'overflow-x-auto')}>
        <table className="w-full text-xs min-w-[54rem]">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-faint border-b border-line">
              <th className="pl-3 py-2 font-semibold">Item</th><th className="px-2 py-2 font-semibold">Stored at</th><th className="px-2 py-2 font-semibold">In store</th>
              <th className="px-2 py-2 font-semibold">Issued · at</th><th className="px-2 py-2 font-semibold">Damaged</th><th className="px-2 py-2 pr-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line/70">
            {view.map(i => {
              const out = i.inStock === 0, low = !out && i.minLevel > 0 && i.inStock <= i.minLevel;
              return (
                <tr key={i.id} className="align-middle">
                  <td className="pl-3 py-2">
                    <div className="font-semibold">{i.name}</div>
                    <div className="flex items-center gap-1.5 mt-0.5">{i.code && <span className="font-mono text-[10px] text-mute">{i.code}</span>}<span className="text-[10px] px-1.5 py-0.5 rounded-full border border-line-strong bg-raised/60 text-ink-soft">{i.category}</span></div>
                  </td>
                  <td className="px-2 py-2 text-ink-soft">{i.location || <span className="text-faint">—</span>}</td>
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-2">
                      <span className={cx('font-bold tabular-nums', out ? 'text-rose-400' : low ? 'text-amber-400' : 'text-emerald-400')}>{i.inStock}</span>
                      <span className="text-xs text-faint">{i.unit}</span>
                      {out && <span className={cx('text-xs font-bold px-1.5 py-0.5 rounded-full border', TONE.bad)}>OUT</span>}
                      {low && <span className={cx('text-xs font-bold px-1.5 py-0.5 rounded-full border', TONE.warn)}>LOW</span>}
                    </div>
                    {i.minLevel > 0 && <div className="text-xs text-faint">min {i.minLevel}</div>}
                  </td>
                  <td className="px-2 py-2">{i.issued > 0 ? <div><span className="font-bold tabular-nums">{i.issued}</span><HeldChips itemId={i.id} /></div> : <span className="text-faint">—</span>}</td>
                  <td className="px-2 py-2">{i.damaged > 0 ? <span className="font-bold tabular-nums text-orange-400">{i.damaged}</span> : <span className="text-faint">—</span>}</td>
                  <td className="px-2 py-2 pr-3">
                    <div className="flex justify-end gap-1.5">
                      {canManage && <button className={cx(btnGhost(D), 'text-amber-300')} onClick={() => openMove('issue', i.id)}><Send className="w-3.5 h-3.5" />Issue</button>}
                      {canManage && <button className={btnGhost(D)} onClick={() => openMove('receive', i.id)}><Plus className="w-3.5 h-3.5" />Receive</button>}
                      {canManage && <button className={btnGhost(D)} onClick={() => openMove('adjust', i.id)} aria-label={`Other stock actions for ${i.name}`} title="Correct count, mark damaged…"><ArrowRightLeft className="w-3.5 h-3.5" /></button>}
                      <button className={btnGhost(D)} onClick={() => onHistory(i)} aria-label={`History of ${i.name}`}><History className="w-3.5 h-3.5" /></button>
                      {canManage && <button className={btnGhost(D)} onClick={() => onEdit(i)} aria-label={`Edit ${i.name}`} title="Edit"><Edit3 className="w-3.5 h-3.5" /></button>}
                      {canManage && <button className={cx(btnGhost(D), 'text-rose-400')} onClick={() => onDelete(i)} aria-label={`Delete ${i.name}`} title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {view.length === 0 && <Empty>{loading ? 'Loading…' : items.length === 0 ? (canManage ? 'No items yet — use "Add item" or "Import list".' : 'No items added yet.') : 'No items match these filters.'}</Empty>}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-line text-xs text-mute">
          <span>{rows.length ? `${page * size + 1}–${Math.min(rows.length, page * size + size)} of ${rows.length}` : '0 results'}</span>
          <div className="flex items-center gap-2">
            <select aria-label="Rows per page" value={size} onChange={e => setSize(+e.target.value)} className={cx(inputCls(D), 'w-auto py-1 text-xs')}>{[25, 50, 100, 200].map(n => <option key={n} value={n}>{n} / page</option>)}</select>
            <button className={btnGhost(D)} disabled={page === 0} onClick={() => setPage(p => p - 1)} aria-label="Previous page"><ChevronLeft className="w-4 h-4" /></button>
            <span>{page + 1} / {pages}</span>
            <button className={btnGhost(D)} disabled={page >= pages - 1} onClick={() => setPage(p => p + 1)} aria-label="Next page"><ChevronRight className="w-4 h-4" /></button>
          </div>
        </div>
      </section>
    </div>
  );
};

const LocationsView: React.FC<{ openMove: OpenMove }> = ({ openMove }) => {
  const { items, holdings, canManage, locations, locationLabel, addLocation, renameLocation, deleteLocation } = useInventory();
  const [form, setForm] = useState<Loc | 'new' | null>(null);
  const [del, setDel] = useState<Loc | null>(null);
  const byId = useMemo(() => new Map<string, Item>(items.map(i => [i.id, i] as [string, Item])), [items]);
  const known = useMemo(() => new Set(locations.map(l => l.id)), [locations]);
  const ids = useMemo(() => {
    const keys = locations.map(l => l.id);
    holdings.filter(h => h.qty > 0 && !keys.includes(h.location)).forEach(h => { if (!keys.includes(h.location)) keys.push(h.location); });
    return keys;
  }, [holdings, locations]);
  return (
    <div className="space-y-5">
      <div className="flex justify-end">{canManage && <button className={amber} onClick={() => setForm('new')}><Plus className="w-4 h-4" />Add location</button>}</div>
      {ids.length === 0 && <Section title="Locations"><Empty>No locations yet. A location is created automatically the first time you issue stock to it, or add one here.</Empty></Section>}
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-5">
        {ids.map(d => {
          const mine = holdings.filter(h => h.location === d && h.qty > 0 && byId.has(h.itemId));
          const total = mine.reduce((a, h) => a + h.qty, 0);
          return (
            <Section key={d} title={locationLabel(d)} action={
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-mute mr-1"><b className="text-ink tabular-nums">{total}</b> units</span>
                {canManage && known.has(d) && (
                  <>
                    <button className={btnGhost(D)} onClick={() => setForm({ id: d, name: locationLabel(d) })} aria-label={`Rename ${locationLabel(d)}`} title="Rename"><Edit3 className="w-3.5 h-3.5" /></button>
                    <button className={cx(btnGhost(D), 'text-rose-400')} onClick={() => setDel({ id: d, name: locationLabel(d) })} aria-label={`Delete ${locationLabel(d)}`} title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                  </>
                )}
              </div>}>
              {mine.length === 0 ? <Empty>Nothing is at this location right now.</Empty> : (
                <ul className="divide-y divide-line/70">
                  {mine.map(h => { const it = byId.get(h.itemId) as Item; return (
                    <li key={h.itemId} className="px-4 py-2.5 flex items-center justify-between gap-2 text-sm">
                      <span className="truncate">{it.name}</span>
                      <span className="flex items-center gap-2 shrink-0"><b className="tabular-nums">{h.qty}</b><span className="text-xs text-faint">{it.unit}</span>
                        {canManage && <button className={btnGhost(D)} onClick={() => openMove('return', it.id)}><RotateCcw className="w-3.5 h-3.5" />Return</button>}
                      </span>
                    </li>
                  ); })}
                </ul>
              )}
            </Section>
          );
        })}
      </div>
      {form && <LocationForm initial={form === 'new' ? null : form} onClose={() => setForm(null)} onSave={n => (form === 'new' ? addLocation(n) : renameLocation(form.id, n))} />}
      {del && <ConfirmModal dark={D} title={`Delete ${del.name}?`} body="Only possible when no stock is at this location. Past history will show it as a removed location." confirmLabel="Delete" onConfirm={() => { deleteLocation(del.id); }} onClose={() => setDel(null)} />}
    </div>
  );
};

const LocationForm: React.FC<{ initial: Loc | null; onClose: () => void; onSave: (name: string) => Promise<boolean> }> = ({ initial, onClose, onSave }) => {
  const [name, setName] = useState(initial?.name || '');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); const ok = await onSave(name); setBusy(false); if (ok) onClose(); };
  return (
    <Modal title={initial ? 'Rename location' : 'Add location'} dark={D} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div><label className={labelCls(D)} htmlFor="lc-n">Location name</label><input id="lc-n" autoFocus required value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Gate 3 · Main Stage · Control Room A" className={inputCls(D)} /></div>
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className={btnGhost(D)}>Cancel</button><button type="submit" disabled={busy || !name.trim()} className={amber}>{busy ? 'Saving…' : 'Save'}</button></div>
      </form>
    </Modal>
  );
};

const CategoryManager: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { categories, items, addCategory, renameCategory, deleteCategory } = useInventory();
  const [name, setName] = useState('');
  const [edit, setEdit] = useState<string | null>(null);
  const [val, setVal] = useState('');
  const [del, setDel] = useState<string | null>(null);
  const count = (c: string) => items.filter(i => i.category === c).length;
  const add = async (e: React.FormEvent) => { e.preventDefault(); if (await addCategory(name)) setName(''); };
  const save = async () => { if (edit !== null && await renameCategory(edit, val)) setEdit(null); };
  return (
    <Modal title="Categories" dark={D} onClose={onClose} wide>
      <form onSubmit={add} className="flex gap-2 mb-4">
        <input aria-label="New category" value={name} onChange={e => setName(e.target.value)} placeholder="New category name" className={inputCls(D)} />
        <button type="submit" disabled={!name.trim()} className={amber}><Plus className="w-4 h-4" />Add</button>
      </form>
      <ul className="divide-y divide-line max-h-80 overflow-y-auto">
        {categories.map(c => (
          <li key={c} className="py-2.5 flex items-center justify-between gap-2 text-sm">
            {edit === c ? (
              <>
                <input aria-label={`Rename ${c}`} autoFocus value={val} onChange={e => setVal(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save(); }} className={cx(inputCls(D), 'py-1.5')} />
                <div className="flex gap-1.5 shrink-0"><button className={btnGhost(D)} onClick={() => setEdit(null)}>Cancel</button><button className={cx(btnGhost(D), 'text-amber-300')} onClick={save}>Save</button></div>
              </>
            ) : (
              <>
                <span className="min-w-0 truncate font-medium">{c} <span className="text-xs text-faint font-normal">· {count(c)} items</span></span>
                <div className="flex gap-1.5 shrink-0">
                  <button className={btnGhost(D)} onClick={() => { setEdit(c); setVal(c); }} aria-label={`Rename ${c}`} title="Rename"><Edit3 className="w-3.5 h-3.5" /></button>
                  {c.toLowerCase() !== 'general' && <button className={cx(btnGhost(D), 'text-rose-400')} onClick={() => setDel(c)} aria-label={`Delete ${c}`} title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>}
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
      <p className="text-xs text-faint mt-3">Renaming updates every item in that category. Deleting a category moves its items to “General”.</p>
      {del && <ConfirmModal dark={D} title={`Delete ${del}?`} body={`${count(del)} item(s) will move to General.`} confirmLabel="Delete" onConfirm={() => { deleteCategory(del); }} onClose={() => setDel(null)} />}
    </Modal>
  );
};

const AllocationsView: React.FC<{ openMove: OpenMove }> = ({ openMove }) => {
  const { items, canManage } = useInventory();
  const out = items.filter(i => i.issued > 0);
  const recent = useRecent(['issue'], 100);
  return (
    <div className="space-y-5">
      <div className="flex justify-end">{canManage && <button className={amber} onClick={() => openMove('issue', items[0]?.id)} disabled={!items.length}><Send className="w-4 h-4" />Issue stock</button>}</div>
      <Section title={`Currently out at locations (${out.length})`}>
        {out.length === 0 ? <Empty>Nothing is issued right now.</Empty> : (
          <ul className="divide-y divide-line/70">
            {out.map(i => (
              <li key={i.id} className="px-4 py-3 flex items-start justify-between gap-3">
                <div><div className="font-semibold text-sm">{i.name}</div><HeldChips itemId={i.id} /></div>
                <div className="flex items-center gap-2 shrink-0"><b className="tabular-nums">{i.issued}</b><span className="text-xs text-faint">{i.unit}</span>
                  {canManage && <button className={btnGhost(D)} onClick={() => openMove('return', i.id)}><RotateCcw className="w-3.5 h-3.5" />Return</button>}</div>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Recent issues"><MoveList rows={recent} empty="No stock has been issued yet." /></Section>
    </div>
  );
};

const ReturnsView: React.FC<{ openMove: OpenMove }> = ({ openMove }) => {
  const { items, canManage } = useInventory();
  const recent = useRecent(['return', 'return_damaged'], 150);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap justify-end gap-2">
        {canManage && <button className={btnGhost(D)} onClick={() => openMove('return_damaged', items.find(i => i.issued > 0)?.id)} disabled={!items.some(i => i.issued > 0)}>Return · damaged</button>}
        {canManage && <button className={amber} onClick={() => openMove('return', items.find(i => i.issued > 0)?.id)} disabled={!items.some(i => i.issued > 0)}><RotateCcw className="w-4 h-4" />Record return</button>}
      </div>
      <Section title="Recent returns"><MoveList rows={recent} empty="No returns recorded yet." /></Section>
    </div>
  );
};

const MaintenanceView: React.FC<{ openMove: OpenMove }> = ({ openMove }) => {
  const { items, canManage } = useInventory();
  const bad = items.filter(i => i.damaged > 0);
  const recent = useRecent(['damage', 'repair', 'write_off', 'return_damaged'], 150);
  return (
    <div className="space-y-5">
      <div className="flex justify-end">{canManage && <button className={btnGhost(D)} onClick={() => openMove('damage', items[0]?.id)} disabled={!items.length}><Wrench className="w-4 h-4" />Mark damaged</button>}</div>
      <Section title={`Damaged items (${bad.length})`}>
        {bad.length === 0 ? <Empty>Nothing is damaged. 🎉</Empty> : (
          <ul className="divide-y divide-line/70">
            {bad.map(i => (
              <li key={i.id} className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="font-semibold text-sm">{i.name}</div>
                <div className="flex items-center gap-2 shrink-0"><b className="tabular-nums text-orange-400">{i.damaged}</b><span className="text-xs text-faint">{i.unit}</span>
                  {canManage && <button className={btnGhost(D)} onClick={() => openMove('repair', i.id)}>Repaired</button>}
                  {canManage && <button className={cx(btnGhost(D), 'text-rose-400')} onClick={() => openMove('write_off', i.id)}>Write off</button>}</div>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Repair log"><MoveList rows={recent} empty="No maintenance activity yet." /></Section>
    </div>
  );
};

const HistoryView: React.FC = () => {
  const { items } = useInventory();
  const rows = useRecent(undefined, 400);
  const [type, setType] = useState<'all' | MoveType>('all');
  const [q, setQ] = useState('');
  const byId = useMemo(() => new Map<string, Item>(items.map(i => [i.id, i] as [string, Item])), [items]);
  const shown = useMemo(() => {
    if (!rows) return null;
    const t = q.trim().toLowerCase();
    return rows.filter(r => (type === 'all' || r.type === type) && (!t || (byId.get(r.itemId)?.name || '').toLowerCase().includes(t) || [r.givenBy, r.receivedBy, r.returnedBy].some(x => x.toLowerCase().includes(t)) || r.ref.toLowerCase().includes(t) || r.doneBy.toLowerCase().includes(t)));
  }, [rows, type, q, byId]);
  return (
    <Section title="Every stock movement" action={
      <div className="flex gap-2">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search item, person, ref…" aria-label="Search history" className={cx(inputCls(D), 'py-1.5 text-xs w-48')} />
        <select value={type} onChange={e => setType(e.target.value as 'all' | MoveType)} aria-label="Movement type" className={cx(inputCls(D), 'w-auto py-1.5 text-xs')}>
          <option value="all">All types</option>{MOVES.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
        </select>
      </div>}>
      <MoveList rows={shown} empty="No movements match." />
    </Section>
  );
};

// The CRM shell owns the global navigation; inventory uses a compact local section bar.
export const InventoryApp: React.FC = () => {
  const inv = useInventory();
  const { items, canManage, loadError } = inv;
  const [tab, setTabRaw] = useState<Tab>(() => { const t = localStorage.getItem('inv_tab') as Tab; return NAV.some(n => n.id === t) ? t : 'dashboard'; });
  const [stage, setStage] = useState<Stage>('all');
  const [editing, setEditing] = useState<Item | 'new' | null>(null);
  const [moving, setMoving] = useState<{ itemId: string; type: MoveType } | null>(null);
  const [history, setHistory] = useState<Item | null>(null);
  const [importing, setImporting] = useState(false);
  const [cats, setCats] = useState(false);
  const [deleting, setDeleting] = useState<Item | null>(null);

  const setTab = (t: Tab) => { setTabRaw(t); try { localStorage.setItem('inv_tab', t); } catch { /* ignore */ } };
  const go = (t: Tab, s?: Stage) => { if (s) setStage(s); setTab(t); };
  const openMove: OpenMove = (type, itemId) => setMoving({ itemId: itemId || items[0]?.id || '', type });
  const cur = NAV.find(n => n.id === tab) || NAV[0];

  return (
    <div className="space-y-4">
        <div className="text-xs text-mute">{SUB[tab]}</div>
        <nav className="flex gap-1 overflow-x-auto border-b border-line" aria-label="Inventory sections">
          {NAV.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => go(id)} className={cx('inline-flex items-center gap-2 px-3 py-2.5 border-b-2 text-xs font-medium whitespace-nowrap', tab === id ? 'border-blue-600 text-blue-500' : 'border-transparent text-mute hover:text-ink')}><Icon className="w-4 h-4" />{label}</button>
          ))}
        </nav>
          {!canManage && <div className="mb-5 p-3 bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded-xl text-xs">🔒 You can view the inventory but not change it.</div>}
          {loadError && <div role="alert" className="mb-5 rounded-xl border border-rose-500/40 bg-rose-500/10 text-rose-400 text-sm p-3">Could not load inventory: {loadError}</div>}
          {tab === 'dashboard' && <DashboardView go={go} openMove={openMove} />}
          {tab === 'items' && <ItemsView stage={stage} setStage={setStage} openMove={openMove} onEdit={setEditing} onHistory={setHistory} onImport={() => setImporting(true)} onCategories={() => setCats(true)} onDelete={setDeleting} />}
          {tab === 'locations' && <LocationsView openMove={openMove} />}
          {tab === 'allocations' && <AllocationsView openMove={openMove} />}
          {tab === 'returns' && <ReturnsView openMove={openMove} />}
          {tab === 'maintenance' && <MaintenanceView openMove={openMove} />}
          {tab === 'history' && <HistoryView />}
          {tab === 'requests' && <ServiceInbox kind="item" title="Inventory" />}
      

      {editing && <ItemForm initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)}
        onSave={(i, opening) => (editing === 'new' ? inv.addItem(i, opening) : inv.updateItem(editing.id, i))}
        onDelete={editing !== 'new' ? () => inv.deleteItem(editing.id) : undefined} />}
      {moving && <MoveModal start={moving} onClose={() => setMoving(null)} />}
      {history && <HistoryModal item={items.find(x => x.id === history.id) || history} onClose={() => setHistory(null)} />}
      {importing && <ImportModal onClose={() => setImporting(false)} />}
      {cats && <CategoryManager onClose={() => setCats(false)} />}
      {deleting && <ConfirmModal dark={D} title={`Delete ${deleting.name}?`} body="The item, its location holdings and its whole history will be removed." confirmLabel="Delete" onConfirm={() => { inv.deleteItem(deleting.id); }} onClose={() => setDeleting(null)} />}
    </div>
  );
};

// ---------------------------------------------------------------------------
const ItemForm: React.FC<{ initial: Item | null; onClose: () => void; onSave: (i: ItemInput, opening: number) => Promise<boolean>; onDelete?: () => Promise<boolean> }> = ({ initial, onClose, onSave, onDelete }) => {
  const { categories } = useInventory();
  const [f, setF] = useState<ItemInput>({ name: initial?.name || '', code: initial?.code || '', category: initial?.category || 'General', unit: initial?.unit || 'pcs', location: initial?.location || '', minLevel: initial?.minLevel || 0 });
  const [opening, setOpening] = useState(0);
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState(false);
  const set = (k: keyof ItemInput, v: any) => setF(p => ({ ...p, [k]: v }));
  const submit = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); const ok = await onSave(f, opening); setBusy(false); if (ok) onClose(); };
  return (
    <Modal title={initial ? 'Edit item' : 'Add item'} dark={D} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div><label className={labelCls(D)} htmlFor="it-n">Item name</label><input id="it-n" autoFocus required value={f.name} onChange={e => set('name', e.target.value)} className={inputCls(D)} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={labelCls(D)} htmlFor="it-c">Code / SKU (optional)</label><input id="it-c" value={f.code} onChange={e => set('code', e.target.value)} className={inputCls(D)} /></div>
          <div><label className={labelCls(D)} htmlFor="it-cat">Category</label><input id="it-cat" list="inv-cats" value={f.category} onChange={e => set('category', e.target.value)} className={inputCls(D)} /><datalist id="inv-cats">{categories.map(c => <option key={c} value={c} />)}</datalist></div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div><label className={labelCls(D)} htmlFor="it-u">Unit</label><input id="it-u" list="inv-units" value={f.unit} onChange={e => set('unit', e.target.value)} className={inputCls(D)} /><datalist id="inv-units">{UNITS.map(u => <option key={u} value={u} />)}</datalist></div>
          <div className="col-span-2"><label className={labelCls(D)} htmlFor="it-l">Stored at (shelf / rack)</label><input id="it-l" value={f.location} onChange={e => set('location', e.target.value)} placeholder="e.g. Warehouse A · Shelf 3" className={inputCls(D)} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={labelCls(D)} htmlFor="it-m">Low-stock level</label><input id="it-m" type="number" min={0} value={f.minLevel} onChange={e => set('minLevel', +e.target.value)} className={inputCls(D)} /></div>
          {!initial && <div><label className={labelCls(D)} htmlFor="it-o">Opening stock</label><input id="it-o" type="number" min={0} value={opening} onChange={e => setOpening(Math.max(0, Math.floor(+e.target.value || 0)))} className={inputCls(D)} /></div>}
        </div>
        {initial && <p className="text-xs text-faint">Quantities change only through Issue / Receive / Return, so the history stays accurate.</p>}
        <div className="flex items-center justify-between gap-2 pt-1">
          {onDelete ? <button type="button" className={cx(btnGhost(D), 'text-rose-400')} onClick={() => setDel(true)}><Trash2 className="w-3.5 h-3.5" />Delete</button> : <span />}
          <div className="flex gap-2"><button type="button" onClick={onClose} className={btnGhost(D)}>Cancel</button><button type="submit" disabled={busy} className={amber}>{busy ? 'Saving…' : 'Save'}</button></div>
        </div>
      </form>
      {del && onDelete && <ConfirmModal dark={D} title={`Delete ${initial?.name}?`} body="The item, its location holdings and its whole history will be removed." confirmLabel="Delete" onConfirm={async () => { if (await onDelete()) onClose(); }} onClose={() => setDel(false)} />}
    </Modal>
  );
};

const MoveModal: React.FC<{ start: { itemId: string; type: MoveType }; onClose: () => void }> = ({ start, onClose }) => {
  const { items, holdingsOf, move, locationLabel, locations, ensureLocation, userName } = useInventory();
  const [itemId, setItemId] = useState(start.itemId);
  const [type, setType] = useState<MoveType>(start.type);
  const [qty, setQty] = useState('');
  const [loc, setLoc] = useState(''); // Issue: the place name you type or pick · Return: id of the location it comes back from
  const [givenBy, setGivenBy] = useState('');
  const [receivedBy, setReceivedBy] = useState('');
  const [returnedBy, setReturnedBy] = useState('');
  const [ref, setRef] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const it = items.find(x => x.id === itemId);
  const meta = MOVE[type];
  const held = it ? holdingsOf(it.id) : [];
  const isIssue = type === 'issue';
  const isReturn = type === 'return' || type === 'return_damaged';
  const isReceive = type === 'receive';
  useEffect(() => { setLoc(''); }, [type, itemId]);
  useEffect(() => { setGivenBy(isIssue ? userName : ''); setReceivedBy(isReturn || isReceive ? userName : ''); setReturnedBy(''); }, [type]); // eslint-disable-line

  const n = qty === '' || qty === '-' ? 0 : parseInt(qty, 10) || 0;
  const delta = (() => {
    switch (type) {
      case 'receive': return { s: n, i: 0, d: 0 };
      case 'issue': return { s: -n, i: n, d: 0 };
      case 'return': return { s: n, i: -n, d: 0 };
      case 'return_damaged': return { s: 0, i: -n, d: n };
      case 'damage': return { s: -n, i: 0, d: n };
      case 'repair': return { s: n, i: 0, d: -n };
      case 'write_off': return { s: 0, i: 0, d: -n };
      default: return { s: n, i: 0, d: 0 };
    }
  })();
  const atLoc = held.find(h => h.location === loc)?.qty || 0;
  const problem = !it ? 'Pick an item.' : !n ? '' :
    it.inStock + delta.s < 0 ? `Only ${it.inStock} ${it.unit} in store.` :
    it.damaged + delta.d < 0 ? `Only ${it.damaged} damaged on record.` :
    isReturn && loc && atLoc < n ? `${locationLabel(loc)} has only ${atLoc}.` : '';
  const locOk = !meta.needsLocation || (isIssue ? loc.trim() !== '' : loc !== '');
  const peopleOk = isIssue ? receivedBy.trim() !== '' : isReturn ? returnedBy.trim() !== '' : true;
  const can = !!it && n !== 0 && (type === 'adjust' || n > 0) && locOk && peopleOk && !problem;
  const isNewPlace = isIssue && loc.trim() !== '' && !locations.some(l => l.name.toLowerCase() === loc.trim().toLowerCase());

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!can) return;
    setBusy(true);
    let locId = '';
    if (meta.needsLocation) {
      if (isIssue) { const id = await ensureLocation(loc); if (!id) { setBusy(false); return; } locId = id; } else locId = loc;
    }
    const ok = await move(itemId, { type, qty: n, location: locId, givenBy, receivedBy, returnedBy, ref, note });
    setBusy(false);
    if (ok) onClose();
  };
  const text = (id: string, label: string, v: string, set: (s: string) => void, ph = '') => (
    <div><label className={labelCls(D)} htmlFor={id}>{label}</label><input id={id} value={v} onChange={e => set(e.target.value)} placeholder={ph} className={inputCls(D)} /></div>
  );

  return (
    <Modal title="Stock movement" dark={D} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className={labelCls(D)} htmlFor="mv-i">Item</label>
          <select id="mv-i" value={itemId} onChange={e => setItemId(e.target.value)} className={inputCls(D)}>
            {items.map(i => <option key={i.id} value={i.id}>{i.name}{i.code ? ` · ${i.code}` : ''} — {i.inStock} {i.unit} in store</option>)}
          </select>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Movement type">
          {MOVES.map(m => (
            <button key={m.key} type="button" aria-pressed={type === m.key} onClick={() => setType(m.key)}
              className={cx('text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors', type === m.key ? 'bg-amber-600 border-amber-500 text-white' : TONE[m.tone])}>{m.label}</button>
          ))}
        </div>
        <p className="text-xs text-mute -mt-1">{meta.hint}.</p>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={labelCls(D)} htmlFor="mv-q">Quantity{it ? ` (${it.unit})` : ''}</label><input id="mv-q" autoFocus inputMode="numeric" value={qty} onChange={e => setQty(e.target.value.replace(type === 'adjust' ? /[^\d-]/g : /\D/g, ''))} placeholder={type === 'adjust' ? 'e.g. -2 or 5' : '0'} className={inputCls(D)} /></div>
          {isIssue && (
            <div><label className={labelCls(D)} htmlFor="mv-l">Send to location</label>
              <input id="mv-l" list="mv-locs" value={loc} onChange={e => setLoc(e.target.value)} placeholder="e.g. Gate 3, Main Stage…" autoComplete="off" className={inputCls(D)} />
              <datalist id="mv-locs">{locations.map(l => <option key={l.id} value={l.name} />)}</datalist>
              {isNewPlace && <p className="text-xs text-amber-300 mt-1">New location, it will be added.</p>}
            </div>
          )}
          {isReturn && (
            <div><label className={labelCls(D)} htmlFor="mv-l">Coming back from</label>
              <select id="mv-l" value={loc} onChange={e => setLoc(e.target.value)} className={inputCls(D)}>
                <option value="">{held.length ? 'Select location…' : 'This item is not out anywhere'}</option>
                {held.map(h => <option key={h.location} value={h.location}>{locationLabel(h.location)} (has {h.qty})</option>)}
              </select></div>
          )}
          {!meta.needsLocation && <div />}
        </div>
        {isIssue && <div className="grid grid-cols-2 gap-3">{text('mv-g', 'Given by', givenBy, setGivenBy, 'Store person')}{text('mv-r', 'Received by *', receivedBy, setReceivedBy, 'Who took it at the location')}</div>}
        {isReturn && <div className="grid grid-cols-2 gap-3">{text('mv-t', 'Returned by *', returnedBy, setReturnedBy, 'Who brought it back')}{text('mv-r', 'Received by (store)', receivedBy, setReceivedBy)}</div>}
        {isReceive && <div className="grid grid-cols-2 gap-3">{text('mv-g', 'Received from (vendor / person)', givenBy, setGivenBy)}{text('mv-r', 'Received by', receivedBy, setReceivedBy)}</div>}
        <div className="grid grid-cols-2 gap-3">
          {text('mv-f', 'Challan / PO / ticket no.', ref, setRef)}
          {text('mv-n', 'Note (optional)', note, setNote)}
        </div>

        {it && n !== 0 && (
          <div className="rounded-xl border border-line bg-canvas/60 px-4 py-3 text-xs grid grid-cols-3 gap-3 text-center">
            {([['In store', it.inStock, delta.s], ['Issued', it.issued, delta.i], ['Damaged', it.damaged, delta.d]] as const).map(([l, cur, d]) => (
              <div key={l}><div className="text-faint">{l}</div><div className="font-bold tabular-nums">{cur}{d !== 0 && <> → <span className={d > 0 ? 'text-emerald-400' : 'text-amber-400'}>{cur + d}</span></>}</div></div>
            ))}
          </div>
        )}
        {problem && <p role="alert" className="text-xs text-rose-400">{problem}</p>}
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className={btnGhost(D)}>Cancel</button><button type="submit" disabled={!can || busy} className={amber}>{busy ? 'Saving…' : 'Record'}</button></div>
      </form>
    </Modal>
  );
};

const HistoryModal: React.FC<{ item: Item; onClose: () => void }> = ({ item, onClose }) => {
  const { fetchMovements, holdingsOf, locationLabel } = useInventory();
  const [rows, setRows] = useState<Movement[] | null>(null);
  useEffect(() => { let on = true; fetchMovements(item.id).then(r => on && setRows(r)); return () => { on = false; }; }, [item.id, item.inStock, item.issued, item.damaged]); // eslint-disable-line
  const hold = holdingsOf(item.id);
  return (
    <Modal title={item.name} dark={D} onClose={onClose} wide>
      <div className="grid grid-cols-3 gap-3 text-center mb-4">
        {([['In store', item.inStock, 'text-emerald-400'], ['Issued', item.issued, 'text-blue-300'], ['Damaged', item.damaged, 'text-orange-400']] as const).map(([l, v, c]) => (
          <div key={l} className="rounded-xl border border-line bg-canvas/60 py-3"><div className="text-xs uppercase tracking-wider text-faint">{l}</div><div className={cx('text-2xl font-bold tabular-nums', c)}>{v}<span className="text-xs text-faint font-normal"> {item.unit}</span></div></div>
        ))}
      </div>
      {hold.length > 0 && (
        <div className="mb-4"><div className="text-xs font-semibold text-mute mb-1.5">At locations</div>
          <div className="flex flex-wrap gap-2">{hold.map(h => <span key={h.location} className="text-xs px-2.5 py-1 rounded-full border border-line-strong bg-raised/60">{locationLabel(h.location)} · <b>{h.qty}</b></span>)}</div></div>
      )}
      <div className="flex items-center gap-2 text-xs font-semibold text-mute mb-2"><History className="w-3.5 h-3.5" />Movement history</div>
      {rows === null ? <p className="text-sm text-faint">Loading…</p> : rows.length === 0 ? <p className="text-sm text-faint">No movements yet.</p> : (
        <ul className="divide-y divide-line max-h-72 overflow-y-auto">
          {rows.map(r => (
            <li key={r.id} className="py-2.5 flex items-start justify-between gap-3 text-sm">
              <div>
                <span className={cx('text-xs font-semibold px-2 py-0.5 rounded-full border', TONE[MOVE[r.type].tone])}>{MOVE[r.type].label}</span>
                <span className="font-bold tabular-nums ml-2">{r.qty > 0 && r.type === 'adjust' ? `+${r.qty}` : r.qty}</span>
                {r.location && <span className="text-xs text-mute ml-2">{locationLabel(r.location)}</span>}
                {peopleLine(r) && <div className="text-xs text-mute mt-1">{peopleLine(r)}</div>}
              </div>
              <div className="text-xs text-faint text-right shrink-0">{new Date(r.doneAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}<br />{r.doneBy}</div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
};

const ImportModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { importItems } = useInventory();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const parsed = useMemo(() => text.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const [name = '', qty = '', unit = '', category = '', location = '', min = ''] = l.split(/[,\t]/).map(x => x.trim());
    return { name, code: '', category: category || 'General', unit: unit || 'pcs', location, minLevel: parseInt(min, 10) || 0, opening: Math.max(0, parseInt(qty, 10) || 0) };
  }).filter(r => r.name), [text]);
  const go = async () => { setBusy(true); const r = await importItems(parsed); setBusy(false); if (r.added) onClose(); };
  return (
    <Modal title="Import items" dark={D} onClose={onClose} wide>
      <p className="text-xs text-mute mb-2">One item per line: <span className="font-mono">Name, Quantity, Unit, Category, Location, Low-stock level</span> (everything after Name is optional). Paste straight from Excel or Sheets. Items whose name already exists are skipped.</p>
      <textarea rows={9} autoFocus value={text} onChange={e => setText(e.target.value)} placeholder={'Cat6 Cable, 12, drum, Cables & Fiber, Warehouse A, 5\nWalkie Charger, 40, pcs, Radios & Comms'} className={cx(inputCls(D), 'font-mono text-xs')} />
      <div className="flex items-center justify-between mt-4">
        <span className="text-xs text-mute">{parsed.length} ready to import</span>
        <div className="flex gap-2"><button className={btnGhost(D)} onClick={onClose}>Cancel</button><button className={amber} disabled={!parsed.length || busy} onClick={go}>{busy ? 'Importing…' : `Import ${parsed.length}`}</button></div>
      </div>
    </Modal>
  );
};
