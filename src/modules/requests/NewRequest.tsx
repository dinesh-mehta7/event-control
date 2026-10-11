import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Send } from 'lucide-react';
import { Field, btnPrimary, inputCls } from '../../components/ui';
import { btnGhost } from '../../components/ui';
import { useRequests } from './RequestsContext';
import type { NewLine } from './types';
import { useWalkie } from '../walkie';
import { supabase } from '../walkie/lib/supabaseClient';

const UNITS = ['pcs', 'box', 'roll', 'meter', 'set', 'pair', 'kg', 'litre', 'packet'];
const blank = (): NewLine => ({ kind: 'item', name: '', unit: 'pcs', qty: 1, reason: '', note: '', inventoryItemId: null, returnRequired: false });

// The requester records what they need, why, and whether each item must be returned; stock stays hidden.
export const NewRequest: React.FC<{ onDone: (id: string) => void; copyFrom?: { title: string; purpose: string; deliverTo: string; lines: NewLine[] } | null }> = ({ onDone, copyFrom }) => {
  const { submit, me, catalogue } = useRequests();
  const walkieApp: any = useWalkie();
  const { currentUser, departments } = walkieApp;
  const [requestType, setRequestType] = useState<'items' | 'walkies'>('items');
  const [events, setEvents] = useState<any[]>([]);
  const [eventId, setEventId] = useState('');
  const [radioQty, setRadioQty] = useState({ walkies: '1', chargers: '0', earphones: '0' });
  const [title, setTitle] = useState(copyFrom?.title || '');
  const [purpose, setPurpose] = useState(copyFrom?.purpose || '');
  const [deliverTo, setDeliverTo] = useState(copyFrom?.deliverTo || '');
  const [departmentId, setDepartmentId] = useState(currentUser?.departmentId || '');
  const [neededBy, setNeededBy] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [lines, setLines] = useState<NewLine[]>(copyFrom?.lines?.length ? copyFrom.lines.map(l => ({ ...l, kind: 'item' })) : [blank()]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const set = (i: number, p: Partial<NewLine>) => setLines(ls => ls.map((l, k) => (k === i ? { ...l, ...p } : l)));
  // Typing the exact name of a catalogue item links the line to it (and fills the unit). Anything else is a free-text item.
  const setName = (i: number, name: string) => {
    const hit = catalogue.find(c => c.name.toLowerCase() === name.trim().toLowerCase());
    set(i, hit ? { name: hit.name, unit: hit.unit, inventoryItemId: hit.id } : { name, inventoryItemId: null });
  };
  const today = new Date().toISOString().slice(0, 10);
  const orgId = currentUser?.organizationId;
  const ownDept = departments.find(d => d.id === currentUser?.departmentId);
  const selectedDept = departments.find(d => d.id === departmentId);
  useEffect(() => {
    if (!departmentId && currentUser?.departmentId && departments.some(d => d.id === currentUser.departmentId)) setDepartmentId(currentUser.departmentId);
    else if (departmentId && !departments.some(d => d.id === departmentId)) setDepartmentId(currentUser?.departmentId && departments.some(d => d.id === currentUser.departmentId) ? currentUser.departmentId : '');
  }, [departmentId, departments, currentUser?.departmentId]);
  useEffect(() => {
    if (!orgId) return;
    supabase.from('event_plans').select('id,name,starts_at,status').eq('organization_id', orgId).neq('status', 'cancelled').order('starts_at', { ascending: false })
      .then(({ data, error }) => { if (error) setErr(error.message); else { setEvents(data || []); setEventId(id => id || data?.[0]?.id || ''); } });
  }, [orgId]);

  const send = async () => {
    setErr('');
    if (requestType === 'walkies') {
      const walkies = Number(radioQty.walkies), chargers = Number(radioQty.chargers), earphones = Number(radioQty.earphones);
      if (!eventId) return setErr('Choose the event this request is for.');
      if (!ownDept) return setErr('Your account is not linked to a department yet. Ask an administrator to assign your department.');
      if (![walkies, chargers, earphones].every(q => Number.isInteger(q) && q >= 0) || walkies < 1) return setErr('Enter whole-number quantities. Request at least one walkie set.');
      setBusy(true);
      const { error } = await supabase.rpc('event_radio_request_submit', { p_event_id: eventId, p_walkies: walkies, p_chargers: chargers, p_earphones: earphones });
      setBusy(false);
      if (error) return setErr(error.message || 'Could not send the Walkie request.');
      onDone('event-radio');
      return;
    }
    if (!title.trim()) return setErr('Give the request a short title.');
    if (!purpose.trim()) return setErr('Say why this is needed. The approvers use it to decide.');
    if (!deliverTo.trim()) return setErr('Say where it should be delivered.');
    if (!selectedDept) return setErr('Choose the department for this request.');
    const clean = lines.filter(l => l.name.trim());
    if (!clean.length) return setErr('Add at least one item.');
    if (clean.some(l => !(l.qty > 0) || !Number.isInteger(l.qty))) return setErr('Every item needs a whole-number quantity above zero.');
    setBusy(true);
    // The request has one shared purpose; keep the legacy per-line reason field
    // populated from it for compatibility with existing Supabase migrations.
    const r = await submit({ title: title.trim(), purpose: purpose.trim(), deliverTo: deliverTo.trim(), departmentId, neededBy, priority: urgent ? 'urgent' : 'normal', lines: clean.map(l => ({ ...l, kind: 'item', name: l.name.trim(), reason: purpose.trim() })) });
    setBusy(false);
    if (r.error || !r.id) return setErr(r.error || 'Could not send the request.');
    onDone(r.id);
  };

  const route = 'Every request goes to the IT Department Head first, regardless of the selected department. They set the budget and stock-versus-purchase arrangement, then approve it or escalate it to the Super Admin.';

  return (
    <div className="max-w-4xl space-y-4">
      <section className="rounded-xl border border-line bg-surface p-4">
        <div className="mb-3 text-xs font-medium text-mute">Request type</div>
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Request type">
          {[['items', 'Items & supplies', 'Equipment and materials for your department'], ['walkies', 'Event walkies', 'Walkie sets, chargers and earphones']].map(([value, label, hint]) => <button key={value} type="button" role="radio" aria-checked={requestType === value} onClick={() => setRequestType(value as 'items' | 'walkies')} className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${requestType === value ? 'border-blue-500/60 bg-blue-500/10' : 'border-line bg-raised/20 hover:bg-raised/50'}`}><span className="block text-sm font-medium text-ink">{label}</span><span className="mt-0.5 block text-xs text-mute">{hint}</span></button>)}
        </div>
      </section>
      {requestType === 'items' && <section className="rounded-xl border border-line bg-surface p-4">
        <h3 className="text-sm font-semibold text-ink">Request details</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Title"><input className={inputCls} value={title} maxLength={120} onChange={e => setTitle(e.target.value)} placeholder="e.g. Cables for Gate 3 counter" /></Field>
          <Field label="Deliver to"><input className={inputCls} value={deliverTo} onChange={e => setDeliverTo(e.target.value)} placeholder="Place or counter" /></Field>
          <Field label="Department"><select className={inputCls} value={departmentId} onChange={e => setDepartmentId(e.target.value)}><option value="">Choose a department</option>{departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
          <Field label="Needed by (optional)"><input type="date" min={today} className={inputCls} value={neededBy} onChange={e => setNeededBy(e.target.value)} /></Field>
          <Field label="Why is it needed?" className="sm:col-span-2"><textarea className={inputCls} rows={2} value={purpose} onChange={e => setPurpose(e.target.value)} placeholder="Explain once what these items are needed for" /></Field>
          <label className="flex cursor-pointer items-center gap-2 self-end pb-2 text-sm text-ink-soft"><input type="checkbox" className="accent-blue-600" checked={urgent} onChange={e => setUrgent(e.target.checked)} />Urgent request</label>
        </div>
      </section>}

      {requestType === 'walkies' && <section className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3">
        <div><div className="text-xs text-mute">Department</div><div className="mt-0.5 text-sm font-medium text-ink">{ownDept?.name || currentUser?.departmentName || 'Not assigned'}</div></div>
        <p className="hidden max-w-[220px] text-xs text-faint sm:block">Synced from your Walkie department assignment.</p>
      </section>}

      {requestType === 'items' && <section className="rounded-xl border border-line bg-surface p-4">
        <div className="mb-3 flex items-center justify-between gap-3"><div><h3 className="text-sm font-semibold text-ink">Items</h3><p className="mt-0.5 text-xs text-mute">Add each product, quantity, and optional specification. The reason above applies to all items.</p></div><button type="button" className={btnGhost} onClick={() => setLines(ls => [...ls, blank()])}><Plus size={14} />Add item</button></div>
        <ul className="space-y-3">
          {lines.map((l, i) => (
            <li key={i} className="space-y-3 rounded-lg border border-line bg-raised/20 p-3">
              <div className="flex items-center justify-between gap-3"><span className="text-xs font-semibold text-mute">ITEM {String(i + 1).padStart(2, '0')}</span><button type="button" aria-label={`Remove item ${i + 1}`} disabled={lines.length === 1} onClick={() => setLines(ls => ls.filter((_, k) => k !== i))} className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-mute transition-colors hover:bg-red-500/10 hover:text-red-300 disabled:opacity-30"><Trash2 size={14} /></button></div>
              <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-[minmax(0,1fr)_112px_112px]">
                <Field label="Product / catalogue item"><input className={inputCls + ' w-full'} value={l.name} onChange={e => setName(i, e.target.value)} placeholder="Enter product name" /></Field>
                <Field label="Quantity"><input type="number" min={1} step={1} className={inputCls + ' w-full tabular-nums'} value={l.qty} onChange={e => set(i, { qty: Number(e.target.value) })} /></Field>
                <Field label="Unit"><input className={inputCls + ' w-full'} list="req-units" value={l.unit} readOnly={!!l.inventoryItemId} onChange={e => set(i, { unit: e.target.value })} /></Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.6fr)] sm:items-end">
                <div>
                  <div className="mb-1.5 text-xs font-medium text-ink-soft">What should happen to this item?</div>
                  <div className="inline-flex rounded-lg border border-line bg-raised/30 p-1" role="radiogroup" aria-label={`What should happen to ${l.name || `item ${i + 1}`}?`}>
                    <button type="button" role="radio" aria-checked={l.returnRequired} onClick={() => set(i, { returnRequired: true })} className={`rounded-md px-3 py-1.5 text-xs transition-colors ${l.returnRequired ? 'bg-blue-600 text-white' : 'text-mute hover:text-ink'}`}>Return</button>
                    <button type="button" role="radio" aria-checked={!l.returnRequired} onClick={() => set(i, { returnRequired: false })} className={`rounded-md px-3 py-1.5 text-xs transition-colors ${!l.returnRequired ? 'bg-blue-600 text-white' : 'text-mute hover:text-ink'}`}>Purchase</button>
                  </div>
                </div>
                <Field label="Specification (optional)"><input className={inputCls + ' w-full'} value={l.note} onChange={e => set(i, { note: e.target.value })} placeholder="Size, model or colour" /></Field>
              </div>
            </li>
          ))}
        </ul>
        <datalist id="req-units">{UNITS.map(u => <option key={u} value={u} />)}</datalist>
      </section>}

      {requestType === 'walkies' && <section className="rounded-xl border border-line bg-surface p-4">
        <h3 className="text-sm font-semibold text-ink">Event walkies</h3><p className="mt-1 text-xs text-mute">This request goes to the event approval queue.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Event"><select className={inputCls} value={eventId} onChange={e => setEventId(e.target.value)}><option value="">Choose an event</option>{events.map(event => <option key={event.id} value={event.id}>{event.name} · {new Date(event.starts_at).toLocaleDateString('en-IN')}</option>)}</select></Field>
          <Field label="Department"><div className="flex min-h-10 items-center rounded-lg border border-line bg-raised/30 px-3 text-sm text-ink">{ownDept?.name || 'Department not assigned'}</div></Field>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {([['walkies', 'Walkie sets', 1], ['chargers', 'Chargers', 0], ['earphones', 'Earphones', 0]] as [keyof typeof radioQty, string, number][]).map(([key, label, min]) => <Field key={key} label={label}><input className={inputCls + ' tabular-nums'} type="number" min={min} step={1} value={radioQty[key]} onChange={e => setRadioQty(v => ({ ...v, [key]: e.target.value }))} /></Field>)}
        </div>
        <p className="mt-3 text-xs text-mute">The IT Department Head reviews it first; approved requests appear in Walkie-Talkie → Event radio requests.</p>
      </section>}

      {err && <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</div>}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface/50 p-3">
        <p className="text-xs text-mute">{requestType === 'walkies' ? 'Approval and tracking happen in the event Walkie queue.' : route}</p>
        <button className={btnPrimary} disabled={busy} onClick={send}><Send size={14} />{busy ? 'Sending…' : requestType === 'walkies' ? 'Send Walkie request' : 'Send item request'}</button>
      </div>
    </div>
  );
};
