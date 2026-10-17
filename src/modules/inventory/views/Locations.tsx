import React, { useEffect, useMemo, useState } from 'react';
import { Edit3, Plus, RotateCcw, Search, Trash2 } from 'lucide-react';
import { ConfirmModal } from '../../accommodation/ui';
import { useInventory } from '../InventoryContext';
import type { Loc } from '../InventoryContext';
import type { Item } from '../types';
import type { Actions } from '../nav';
import { LocationForm } from '../modals/Catalogue';
import { D, cx, iconBtn } from '../ui/kit';
import { EmptyRow, Sheet, num, rowHover, sheetHead, sheetTable, td, th } from '../ui/sheet';

const ctl = 'h-8 rounded-md border border-line bg-field px-2.5 text-[11.5px] text-ink outline-none placeholder:text-faint focus:border-blue-500';
const rowBtn = 'inline-flex h-6 items-center gap-1 rounded border border-line px-2 text-[11px] text-ink-soft hover:bg-raised';

// Locations register on the left; the stock held at the selected location on the right.
export const LocationsView: React.FC<{ a: Actions }> = ({ a }) => {
  const { items, holdings, canManage, locations, locationLabel, addLocation, renameLocation, deleteLocation } = useInventory();
  const [form, setForm] = useState<Loc | 'new' | null>(null);
  const [del, setDel] = useState<Loc | null>(null);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState('');
  const byId = useMemo(() => new Map<string, Item>(items.map(i => [i.id, i] as [string, Item])), [items]);
  const known = useMemo(() => new Set(locations.map(l => l.id)), [locations]);
  // Saved locations, plus any location id that still holds stock but is no longer saved.
  const rows = useMemo(() => {
    const keys = locations.map(l => l.id);
    holdings.filter(h => h.qty > 0 && !keys.includes(h.location)).forEach(h => { if (!keys.includes(h.location)) keys.push(h.location); });
    return keys.map(id => { const mine = holdings.filter(h => h.location === id && h.qty > 0 && byId.has(h.itemId)); return { id, name: locationLabel(id), items: mine.length, units: mine.reduce((s, h) => s + h.qty, 0) }; })
      .sort((x, y) => y.units - x.units || x.name.localeCompare(y.name));
  }, [holdings, locations, byId, locationLabel]);
  const t = q.trim().toLowerCase();
  const shown = rows.filter(r => !t || r.name.toLowerCase().includes(t));
  useEffect(() => { if (!rows.some(r => r.id === sel)) setSel(rows[0]?.id || ''); }, [rows, sel]);
  const stock = holdings.filter(h => h.location === sel && h.qty > 0 && byId.has(h.itemId)).map(h => ({ ...h, item: byId.get(h.itemId)! })).sort((x, y) => x.item.name.localeCompare(y.item.name));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-mute">Places stock is issued to. Select a location to see what is there.</p>
        {canManage && <button className="inline-flex h-8 items-center gap-1.5 rounded-md bg-blue-600 px-3 text-[11.5px] font-semibold text-white hover:bg-blue-500" onClick={() => setForm('new')}><Plus className="h-3.5 w-3.5" />Add location</button>}
      </div>
      <div className="grid gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Sheet title="Locations" count={rows.length} tools={<label className="relative"><span className="sr-only">Find a location</span><Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Find…" className={cx(ctl, 'w-40 pl-8')} /></label>}>
          <table className={cx(sheetTable, 'min-w-[440px]')}>
            <thead className={sheetHead}><tr><th className={cx(th, 'w-10 text-right')}>#</th><th className={th}>Location</th><th className={cx(th, 'text-right')}>Items</th><th className={cx(th, 'text-right')}>Units</th>{canManage && <th className={cx(th, 'w-16')} />}</tr></thead>
            <tbody>
              {shown.map((r, n) => (
                <tr key={r.id} onClick={() => setSel(r.id)} aria-selected={sel === r.id} className={cx('cursor-pointer', sel === r.id ? 'bg-brand-soft shadow-[inset_3px_0_0_rgb(var(--c-brand))]' : rowHover)}>
                  <td className={cx(td, num, 'text-faint')}>{n + 1}</td>
                  <td className={cx(td, 'font-medium', sel === r.id ? 'text-brand' : 'text-ink')}>{r.name}</td>
                  <td className={cx(td, num, 'text-ink-soft')}>{r.items}</td>
                  <td className={cx(td, num, r.units ? 'font-semibold text-ink' : 'text-faint')}>{r.units}</td>
                  {canManage && <td className={cx(td, 'py-0.5')} onClick={e => e.stopPropagation()}>{known.has(r.id) && <div className="flex">
                    <button className={iconBtn} onClick={() => setForm({ id: r.id, name: r.name })} aria-label={`Rename ${r.name}`} title="Rename"><Edit3 className="h-3.5 w-3.5" /></button>
                    <button className={cx(iconBtn, 'hover:text-rose-400')} onClick={() => setDel({ id: r.id, name: r.name })} aria-label={`Delete ${r.name}`} title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>}</td>}
                </tr>
              ))}
              {!shown.length && <EmptyRow cols={canManage ? 5 : 4}>{rows.length ? `No location matches “${q}”.` : 'No locations yet. One is created the first time you issue stock to it.'}</EmptyRow>}
            </tbody>
          </table>
        </Sheet>

        <Sheet title={sel ? `Stock at ${locationLabel(sel)}` : 'Stock at location'} count={stock.length} footer={<span>Total <b className="tabular-nums text-ink">{stock.reduce((s, h) => s + h.qty, 0)}</b> units</span>}>
          <table className={cx(sheetTable, 'min-w-[560px]')}>
            <thead className={sheetHead}><tr><th className={cx(th, 'w-10 text-right')}>#</th><th className={th}>Item</th><th className={th}>Code</th><th className={th}>Category</th><th className={cx(th, 'text-right')}>Qty</th><th className={th}>Unit</th>{canManage && <th className={th} />}</tr></thead>
            <tbody>
              {stock.map((h, n) => (
                <tr key={h.itemId} className={rowHover}>
                  <td className={cx(td, num, 'text-faint')}>{n + 1}</td>
                  <td className={cx(td, 'max-w-[240px] truncate')}><button type="button" className="text-ink hover:text-blue-300 hover:underline" onClick={() => a.onDetail(h.item)}>{h.item.name}</button></td>
                  <td className={cx(td, 'font-mono text-mute')}>{h.item.code || '—'}</td>
                  <td className={cx(td, 'text-ink-soft')}>{h.item.category}</td>
                  <td className={cx(td, num, 'font-semibold text-ink')}>{h.qty}</td>
                  <td className={cx(td, 'text-mute')}>{h.item.unit}</td>
                  {canManage && <td className={cx(td, 'py-1')}><button type="button" className={rowBtn} onClick={() => a.openMove('return', h.itemId)}><RotateCcw className="h-3 w-3" />Return</button></td>}
                </tr>
              ))}
              {!stock.length && <EmptyRow cols={canManage ? 7 : 6}>{sel ? 'Nothing is at this location right now.' : 'Select a location.'}</EmptyRow>}
            </tbody>
          </table>
        </Sheet>
      </div>
      {form && <LocationForm initial={form === 'new' ? null : form} onClose={() => setForm(null)} onSave={n => (form === 'new' ? addLocation(n) : renameLocation(form.id, n))} />}
      {del && <ConfirmModal dark={D} title={`Delete ${del.name}?`} body="Only possible when no stock is at this location. Past history will show it as a removed location." confirmLabel="Delete" onConfirm={() => { deleteLocation(del.id); }} onClose={() => setDel(null)} />}
    </div>
  );
};
