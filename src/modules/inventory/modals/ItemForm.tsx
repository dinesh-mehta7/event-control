import React, { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { ConfirmModal, Modal, inputCls, labelCls } from '../../accommodation/ui';
import { useInventory } from '../InventoryContext';
import type { ItemInput } from '../InventoryContext';
import { UNITS } from '../types';
import type { Item } from '../types';
import { D, cx, ghost, primary } from '../ui/kit';

export const ItemForm: React.FC<{ initial: Item | null; onClose: () => void; onSave: (i: ItemInput, opening: number) => Promise<boolean>; onDelete?: () => Promise<boolean> }> = ({ initial, onClose, onSave, onDelete }) => {
  const { categories } = useInventory();
  const [f, setF] = useState<ItemInput>({ name: initial?.name || '', code: initial?.code || '', category: initial?.category || 'General', unit: initial?.unit || 'pcs', location: initial?.location || '', minLevel: initial?.minLevel || 0 });
  const [opening, setOpening] = useState(0);
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState(false);
  const set = (k: keyof ItemInput, v: any) => setF(p => ({ ...p, [k]: v }));
  const submit = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); const ok = await onSave(f, opening); setBusy(false); if (ok) onClose(); };
  return (
    <Modal title={initial ? 'Edit item' : 'Add item'} dark={D} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-5">
        <fieldset className="space-y-3">
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-faint">Details</legend>
          <div><label className={labelCls(D)} htmlFor="it-n">Item name</label><input id="it-n" autoFocus required value={f.name} onChange={e => set('name', e.target.value)} className={inputCls(D)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={labelCls(D)} htmlFor="it-c">Code / SKU (optional)</label><input id="it-c" value={f.code} onChange={e => set('code', e.target.value)} className={inputCls(D)} /></div>
            <div><label className={labelCls(D)} htmlFor="it-cat">Category</label><input id="it-cat" list="inv-cats" value={f.category} onChange={e => set('category', e.target.value)} className={inputCls(D)} /><datalist id="inv-cats">{categories.map(c => <option key={c} value={c} />)}</datalist></div>
          </div>
        </fieldset>
        <fieldset className="space-y-3">
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-faint">Storage</legend>
          <div className="grid grid-cols-3 gap-3">
            <div><label className={labelCls(D)} htmlFor="it-u">Unit</label><input id="it-u" list="inv-units" value={f.unit} onChange={e => set('unit', e.target.value)} className={inputCls(D)} /><datalist id="inv-units">{UNITS.map(u => <option key={u} value={u} />)}</datalist></div>
            <div className="col-span-2"><label className={labelCls(D)} htmlFor="it-l">Stored at (shelf / rack)</label><input id="it-l" value={f.location} onChange={e => set('location', e.target.value)} placeholder="e.g. Warehouse A · Shelf 3" className={inputCls(D)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={labelCls(D)} htmlFor="it-m">Low-stock level</label><input id="it-m" type="number" min={0} value={f.minLevel} onChange={e => set('minLevel', +e.target.value)} className={inputCls(D)} /></div>
            {!initial && <div><label className={labelCls(D)} htmlFor="it-o">Opening stock</label><input id="it-o" type="number" min={0} value={opening} onChange={e => setOpening(Math.max(0, Math.floor(+e.target.value || 0)))} className={inputCls(D)} /></div>}
          </div>
        </fieldset>
        {initial && <p className="rounded-lg border border-line bg-raised/40 px-3 py-2 text-xs text-mute">Quantities change only through Issue / Receive / Return, so the history stays accurate.</p>}
        <div className="flex items-center justify-between gap-2 border-t border-line pt-4">
          {onDelete ? <button type="button" className={cx(ghost, 'text-rose-400')} onClick={() => setDel(true)}><Trash2 className="h-3.5 w-3.5" />Delete</button> : <span />}
          <div className="flex gap-2"><button type="button" onClick={onClose} className={ghost}>Cancel</button><button type="submit" disabled={busy} className={primary}>{busy ? 'Saving…' : 'Save'}</button></div>
        </div>
      </form>
      {del && onDelete && <ConfirmModal dark={D} title={`Delete ${initial?.name}?`} body="The item, its location holdings and its whole history will be removed." confirmLabel="Delete" onConfirm={async () => { if (await onDelete()) onClose(); }} onClose={() => setDel(false)} />}
    </Modal>
  );
};
