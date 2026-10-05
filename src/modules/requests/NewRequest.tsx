import React, { useState } from 'react';
import { Plus, Trash2, Send } from 'lucide-react';
import { Card, Field, btnPrimary, inputCls } from '../../components/ui';
import { btnGhost } from '../../components/ui';
import { useRequests } from './RequestsContext';
import type { NewLine } from './types';

const UNITS = ['pcs', 'box', 'roll', 'meter', 'set', 'pair', 'kg', 'litre', 'packet'];
const blank = (): NewLine => ({ kind: 'item', name: '', unit: 'pcs', qty: 1, reason: '', note: '', inventoryItemId: null });

// The requester only says WHAT they need, HOW MANY and WHY. They never see stock levels.
export const NewRequest: React.FC<{ onDone: (id: string) => void; copyFrom?: { title: string; purpose: string; deliverTo: string; lines: NewLine[] } | null }> = ({ onDone, copyFrom }) => {
  const { submit, me, catalogue } = useRequests();
  const [title, setTitle] = useState(copyFrom?.title || '');
  const [purpose, setPurpose] = useState(copyFrom?.purpose || '');
  const [deliverTo, setDeliverTo] = useState(copyFrom?.deliverTo || '');
  const [neededBy, setNeededBy] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [lines, setLines] = useState<NewLine[]>(copyFrom?.lines?.length ? copyFrom.lines : [blank()]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const set = (i: number, p: Partial<NewLine>) => setLines(ls => ls.map((l, k) => (k === i ? { ...l, ...p } : l)));
  // Typing the exact name of a catalogue item links the line to it (and fills the unit). Anything else is a free-text item.
  const setName = (i: number, name: string) => {
    const hit = catalogue.find(c => c.name.toLowerCase() === name.trim().toLowerCase());
    set(i, hit ? { name: hit.name, unit: hit.unit, inventoryItemId: hit.id } : { name, inventoryItemId: null });
  };
  const today = new Date().toISOString().slice(0, 10);

  const send = async () => {
    setErr('');
    if (!title.trim()) return setErr('Give the request a short title.');
    if (!purpose.trim()) return setErr('Say why this is needed. The owner uses it to decide.');
    if (!deliverTo.trim()) return setErr('Say where it should be delivered.');
    const clean = lines.filter(l => l.name.trim());
    if (!clean.length) return setErr('Add at least one item.');
    if (clean.some(l => !(l.qty > 0) || !Number.isInteger(l.qty))) return setErr('Every item needs a whole-number quantity above zero.');
    const noReason = clean.find(l => !l.reason.trim());
    if (noReason) return setErr(`Say why you need “${noReason.name.trim()}”. A reason on every line helps the owner decide.`);
    setBusy(true);
    const r = await submit({ title: title.trim(), purpose: purpose.trim(), deliverTo: deliverTo.trim(), neededBy, priority: urgent ? 'urgent' : 'normal', lines: clean.map(l => ({ ...l, name: l.name.trim() })) });
    setBusy(false);
    if (r.error || !r.id) return setErr(r.error || 'Could not send the request.');
    onDone(r.id);
  };

  const route = me.level === 'owner' || me.level === 'dept_head'
    ? 'It goes to the organization owner for final approval.'
    : me.level === 'sub_dept_head' || !me.team
      ? 'It goes to the IT owner, then the organization owner for approval.'
      : 'It goes to your branch head, then the IT owner and organization owner.';

  return (
    <div className="space-y-4 max-w-3xl">
      <Card title="What do you need?">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Short title" className="sm:col-span-2"><input className={inputCls} value={title} maxLength={120} onChange={e => setTitle(e.target.value)} placeholder="e.g. Cables and radios for Gate 3 counter" /></Field>
          <Field label="Why is this request needed?" hint="The whole request in a sentence or two. Each item below also needs its own reason." className="sm:col-span-2">
            <textarea className={inputCls} rows={3} value={purpose} onChange={e => setPurpose(e.target.value)} placeholder="What it is for, who will use it, what happens without it" />
          </Field>
          <Field label="Deliver to"><input className={inputCls} value={deliverTo} onChange={e => setDeliverTo(e.target.value)} placeholder="Place or counter" /></Field>
          <Field label="Needed by (optional)"><input type="date" min={today} className={inputCls} value={neededBy} onChange={e => setNeededBy(e.target.value)} /></Field>
          <label className="flex items-center gap-2 text-sm text-ink-soft sm:col-span-2 cursor-pointer">
            <input type="checkbox" className="accent-blue-600" checked={urgent} onChange={e => setUrgent(e.target.checked)} />
            Mark as urgent
          </label>
        </div>
      </Card>

      <Card title="Items" action={<button className={btnGhost} onClick={() => setLines(ls => [...ls, blank()])}><Plus size={14} />Add item</button>}>
        <ul className="space-y-3">
          {lines.map((l, i) => (
            <li key={i} className="grid grid-cols-12 gap-2 items-end rounded-lg border border-line p-3">
              <Field label="Item" hint={l.inventoryItemId ? 'From the catalogue' : l.name.trim() ? 'Not in the catalogue yet. The store team will add it.' : 'Start typing to pick from the catalogue'} className="col-span-12 sm:col-span-6">
                <input className={inputCls} list="req-catalogue" value={l.name} onChange={e => setName(i, e.target.value)} placeholder={l.kind === 'radio' ? 'Walkie-talkie sets' : 'Item name'} />
              </Field>
              <Field label="Quantity" className="col-span-4 sm:col-span-2"><input type="number" min={1} step={1} className={inputCls + ' tabular-nums'} value={l.qty} onChange={e => set(i, { qty: Number(e.target.value) })} /></Field>
              <Field label="Unit" className="col-span-4 sm:col-span-2">
                <input className={inputCls} list="req-units" value={l.unit} readOnly={!!l.inventoryItemId} onChange={e => set(i, { unit: e.target.value })} />
              </Field>
              <Field label="Type" className="col-span-4 sm:col-span-2">
                <select className={inputCls} value={l.kind} onChange={e => set(i, { kind: e.target.value as any })}>
                  <option value="item">Item</option><option value="radio">Walkie-talkie</option>
                </select>
              </Field>
              <Field label="Why do you need this item?" className="col-span-11 sm:col-span-11"><input className={inputCls} value={l.reason} maxLength={200} onChange={e => set(i, { reason: e.target.value })} placeholder="e.g. 6 for the counter, 4 spare for the night shift" /></Field>
              <button aria-label="Remove item" disabled={lines.length === 1} onClick={() => setLines(ls => ls.filter((_, k) => k !== i))}
                className="col-span-1 grid place-items-center h-9 rounded-lg text-mute hover:text-red-300 hover:bg-red-500/10 disabled:opacity-30"><Trash2 size={15} /></button>
              <Field label="Size, model, colour (optional)" className="col-span-12"><input className={inputCls} value={l.note} onChange={e => set(i, { note: e.target.value })} placeholder="Anything that helps the store pick the right one" /></Field>
            </li>
          ))}
        </ul>
        <datalist id="req-units">{UNITS.map(u => <option key={u} value={u} />)}</datalist>
        <datalist id="req-catalogue">{catalogue.map(c => <option key={c.id} value={c.name}>{c.category} · {c.unit}</option>)}</datalist>
      </Card>

      {err && <div role="alert" className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{err}</div>}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-mute">{route}</p>
        <button className={btnPrimary} disabled={busy} onClick={send}><Send size={14} />{busy ? 'Sending…' : 'Send request'}</button>
      </div>
    </div>
  );
};
