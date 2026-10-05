import React, { useEffect, useMemo, useState } from 'react';
import { Check, X, Plus, Trash2, Wand2, PackageCheck, ShoppingCart, ExternalLink } from 'lucide-react';
import { Card, Field, Pill, btnDanger, btnGhost, btnPrimary, inputCls } from '../../components/ui';
import { useInventory } from '../inventory';
import { useRequests } from './RequestsContext';
import type { Availability } from './RequestsContext';
import { SOURCE_LABEL, lineDone } from './types';
import type { PartSource, PlanPart, Req, ReqItem, ReqPart } from './types';

const Err: React.FC<{ msg: string }> = ({ msg }) => msg ? <div role="alert" className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{msg}</div> : null;

// ── Sub-department head ────────────────────────────────────────────────────────────────────────
export const SubReviewPanel: React.FC<{ r: Req }> = ({ r }) => {
  const { subReview } = useRequests();
  const [note, setNote] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const go = async (approve: boolean) => {
    if (!approve && !note.trim()) return setErr('Say why you are rejecting it.');
    setBusy(true); setErr(''); const e = await subReview(r.id, approve, note.trim()); setBusy(false); if (e) setErr(e);
  };
  return (
    <Card title="Your decision" tone="text-amber-300">
      <p className="text-sm text-mute mb-3">Approving forwards this request to the IT owner, then the organization owner for the final quantity decision.</p>
      <Field label="Comment for the IT owner (required if you reject)"><textarea className={inputCls} rows={2} value={note} onChange={e => setNote(e.target.value)} /></Field>
      <div className="mt-3"><Err msg={err} /></div>
      <div className="flex gap-2 justify-end mt-3">
        <button className={btnGhost} disabled={busy} onClick={() => go(false)}><X size={14} />Reject</button>
        <button className={btnPrimary} disabled={busy} onClick={() => go(true)}><Check size={14} />Approve and send to IT owner</button>
      </div>
    </Card>
  );
};

// ── IT department owner: forward to the organization owner for final approval ───────────────────
export const ItReviewPanel: React.FC<{ r: Req }> = ({ r }) => {
  const { itReview } = useRequests();
  const [note, setNote] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const go = async (approve: boolean) => {
    if (!approve && !note.trim()) return setErr('Say why you are rejecting it.');
    setBusy(true); setErr(''); const e = await itReview(r.id, approve, note.trim()); setBusy(false); if (e) setErr(e);
  };
  return (
    <Card title="IT owner review" tone="text-amber-300">
      <p className="text-sm text-mute mb-3">Approve to forward it to the organization owner for final approval.</p>
      <Field label="Comment (required if you reject)"><textarea className={inputCls} rows={2} value={note} onChange={e => setNote(e.target.value)} /></Field>
      <div className="mt-3"><Err msg={err} /></div>
      <div className="flex gap-2 justify-end mt-3">
        <button className={btnGhost} disabled={busy} onClick={() => go(false)}><X size={14} />Reject</button>
        <button className={btnPrimary} disabled={busy} onClick={() => go(true)}><Check size={14} />Approve and send to owner</button>
      </div>
    </Card>
  );
};

// ── Owner: set how much to approve per line, with a reason for every cut ─────────────────────────
export const OwnerReviewPanel: React.FC<{ r: Req }> = ({ r }) => {
  const { ownerReview, loadAvailability } = useRequests();
  const [qty, setQty] = useState<Record<string, number>>(() => Object.fromEntries(r.items.map(i => [i.id, i.requested])));
  const [why, setWhy] = useState<Record<string, string>>({});
  const [avail, setAvail] = useState<Record<string, Availability>>({});
  const [note, setNote] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  useEffect(() => { let on = true; loadAvailability().then(a => { if (on) setAvail(a); }); return () => { on = false; }; }, [loadAvailability]);
  const total = Object.values(qty).reduce((t, n) => t + (n || 0), 0);
  const cut = (i: ReqItem) => (qty[i.id] ?? 0) < i.requested;
  const go = async (approve: boolean) => {
    if (!approve && !note.trim()) return setErr('Say why you are rejecting it.');
    if (approve && total === 0) return setErr('Approve at least one line, or reject the request.');
    const missing = approve ? r.items.find(i => cut(i) && !(why[i.id] || '').trim()) : undefined;
    if (missing) return setErr(`Give a reason for reducing “${missing.name}”. The requester will see it.`);
    setBusy(true); setErr('');
    const e = await ownerReview(r.id, approve, note.trim(), r.items.map(i => ({ id: i.id, qty: Math.max(0, Math.min(i.requested, Math.floor(qty[i.id] || 0))), reason: (why[i.id] || '').trim() })));
    setBusy(false); if (e) setErr(e);
  };
  return (
    <Card title="Organization owner: final approval" tone="text-amber-300">
      <p className="text-sm text-mute mb-3">Set the final approved quantity for each line (up to what was asked, or 0 to leave it out). Any line you reduce needs a reason. The requester sees it in the notification and on the ticket.</p>
      <ul className="space-y-3">
        {r.items.map(i => {
          const a = i.inventoryItemId ? avail[i.inventoryItemId] : undefined;
          return (
            <li key={i.id} className="rounded-lg border border-line p-3 space-y-2">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink">{i.name} <span className="text-xs text-mute font-normal">· asked {i.requested} {i.unit}</span></div>
                  {i.reason && <div className="text-xs text-ink-soft mt-0.5">Reason: {i.reason}</div>}
                  {i.note && <div className="text-xs text-mute">{i.note}</div>}
                  {a ? <div className={`text-xs mt-1 ${a.available >= i.requested ? 'text-emerald-300' : 'text-amber-300'}`}>In store: {a.available} free{a.reserved ? ` (${a.reserved} already promised)` : ''}</div>
                    : <div className="text-xs mt-1 text-faint">{i.inventoryItemId ? 'Stock unknown' : 'Not in the catalogue yet'}</div>}
                </div>
                <div className="inline-flex items-center gap-1">
                  <input type="number" min={0} max={i.requested} className={inputCls + ' !w-20 text-right tabular-nums'} aria-label={`Approved quantity for ${i.name}`}
                    value={qty[i.id] ?? 0} onChange={e => setQty(q => ({ ...q, [i.id]: Math.max(0, Math.min(i.requested, Number(e.target.value))) }))} />
                  <button className="text-xs text-blue-400 hover:underline px-1" onClick={() => setQty(q => ({ ...q, [i.id]: i.requested }))}>All</button>
                  <button className="text-xs text-mute hover:underline px-1" onClick={() => setQty(q => ({ ...q, [i.id]: 0 }))}>None</button>
                </div>
              </div>
              {cut(i) && <input className={inputCls} aria-label={`Reason for reducing ${i.name}`} placeholder="Why less? (required)" maxLength={200} value={why[i.id] || ''} onChange={e => setWhy(w => ({ ...w, [i.id]: e.target.value }))} />}
            </li>
          );
        })}
      </ul>
      <div className="mt-3"><Field label="Note for the requester (required if you reject)"><textarea className={inputCls} rows={2} value={note} onChange={e => setNote(e.target.value)} /></Field></div>
      <div className="mt-3"><Err msg={err} /></div>
      <div className="flex gap-2 justify-end mt-3">
        <button className={btnDanger} disabled={busy} onClick={() => go(false)}><X size={14} />Reject</button>
        <button className={btnPrimary} disabled={busy} onClick={() => go(true)}><Check size={14} />Approve this list</button>
      </div>
    </Card>
  );
};

// ── Store / Walkie team: split every approved line ───────────────────────────────────────────────
interface Row { source: PartSource; qty: number; inventoryItemId: string | null }
const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2);

const LineArranger: React.FC<{ r: Req; item: ReqItem; avail: Record<string, Availability> }> = ({ r, item, avail }) => {
  const inv = useInventory();
  const { planLine } = useRequests();
  const done = lineDone(r, item);
  const need = (item.approved ?? 0) - done;
  const planned = r.parts.filter(p => p.itemId === item.id && p.status === 'planned');
  const radio = item.kind === 'radio';

  // Best guess at the matching inventory item (by name); the team can change it.
  const guess = useMemo(() => {
    if (radio) return null;
    if (item.inventoryItemId && inv.items.some(i => i.id === item.inventoryItemId)) return item.inventoryItemId;
    const w = words(item.name); if (!w.length) return null;
    let best: { id: string; s: number } | null = null;
    inv.items.forEach(i => { const iw = words(i.name); const s = w.filter(x => iw.includes(x)).length; if (s > 0 && (!best || s > best.s)) best = { id: i.id, s }; });
    return best ? (best as { id: string }).id : null;
  }, [inv.items, item.name, item.inventoryItemId, radio]);

  // When BUYING, link to a catalogue item only if the requester picked it or the name matches exactly. Otherwise it is a new item.
  const buyId = useMemo(() => (item.inventoryItemId && inv.items.some(i => i.id === item.inventoryItemId) ? item.inventoryItemId
    : inv.items.find(i => i.name.trim().toLowerCase() === item.name.trim().toLowerCase())?.id || null), [inv.items, item.inventoryItemId, item.name]);
  const initial = (): Row[] => {
    if (planned.length) return planned.map(p => ({ source: p.source, qty: p.qty, inventoryItemId: p.inventoryItemId }));
    if (radio) return [{ source: 'walkie', qty: need, inventoryItemId: null }];
    const a = guess ? avail[guess]?.available ?? 0 : 0; const fromStock = Math.min(a, need);
    return fromStock > 0 ? [{ source: 'inventory', qty: fromStock, inventoryItemId: guess }, ...(need - fromStock > 0 ? [{ source: 'purchase' as PartSource, qty: need - fromStock, inventoryItemId: guess }] : [])]
      : [{ source: 'purchase', qty: need, inventoryItemId: buyId }];
  };
  const [rows, setRows] = useState<Row[]>(initial);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');

  useEffect(() => { if (!planned.length && guess) setRows(rs => rs.map(x => (x.inventoryItemId || x.source !== 'inventory' ? x : { ...x, inventoryItemId: guess }))); }, [guess]); // eslint-disable-line

  const sum = rows.reduce((t, x) => t + (x.qty || 0), 0);
  const set = (i: number, p: Partial<Row>) => setRows(rs => rs.map((x, k) => (k === i ? { ...x, ...p } : x)));
  const sharedItem = rows.find(x => x.inventoryItemId)?.inventoryItemId || null;
  const autoSplit = () => {
    const id = sharedItem || guess; const a = id ? avail[id]?.available ?? 0 : 0; const s = Math.min(a, need);
    setRows([...(s > 0 ? [{ source: 'inventory' as PartSource, qty: s, inventoryItemId: id }] : []), ...(need - s > 0 ? [{ source: 'purchase' as PartSource, qty: need - s, inventoryItemId: id }] : [])]);
  };
  const save = async () => {
    setErr('');
    if (sum !== need) return setErr(`The parts add up to ${sum}, but ${need} must be arranged.`);
    if (!radio && rows.some(x => x.source === 'inventory' && !x.inventoryItemId)) return setErr('Choose which inventory item to take from.');
    setBusy(true); const e = await planLine(item.id, rows.filter(x => x.qty > 0).map(x => ({ source: x.source, qty: x.qty, inventoryItemId: radio ? null : x.inventoryItemId }) as PlanPart)); setBusy(false);
    if (e) setErr(e);
  };
  if (need <= 0) return null;
  const sources: PartSource[] = radio ? ['walkie', 'purchase'] : ['inventory', 'purchase'];
  return (
    <div className="rounded-lg border border-line p-3 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div><div className="text-sm font-medium text-ink">{item.name}</div><div className="text-xs text-mute">Approved {item.approved} {item.unit}{done ? ` · ${done} delivered` : ''} · arrange {need}</div></div>
        <div className="flex gap-2">
          {!radio && <button className={btnGhost} onClick={autoSplit}><Wand2 size={14} />Auto-split</button>}
        </div>
      </div>
      {rows.map((x, i) => (
        <div key={i} className="grid grid-cols-12 gap-2 items-end">
          <Field label="Source" className="col-span-12 sm:col-span-3">
            <select className={inputCls} value={x.source} onChange={e => set(i, { source: e.target.value as PartSource })}>{sources.map(s => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}</select>
          </Field>
          <Field label="Quantity" className="col-span-4 sm:col-span-2"><input type="number" min={1} className={inputCls + ' tabular-nums'} value={x.qty} onChange={e => set(i, { qty: Math.max(0, Math.floor(Number(e.target.value))) })} /></Field>
          {!radio && (
            <Field label={x.source === 'inventory' ? 'Take from (stock available)' : 'Buying: goes into this catalogue item'} className="col-span-8 sm:col-span-6">
              <select className={inputCls} value={x.inventoryItemId || ''} onChange={e => set(i, { inventoryItemId: e.target.value || null })}>
                <option value="">{x.source === 'inventory' ? 'Choose…' : `New item: “${item.name}” (added to the catalogue)`}</option>
                {inv.items.map(it => <option key={it.id} value={it.id}>{it.name}{it.code ? ` (${it.code})` : ''} · {avail[it.id]?.available ?? it.inStock} free</option>)}
              </select>
            </Field>)}
          <button aria-label="Remove part" disabled={rows.length === 1} onClick={() => setRows(rs => rs.filter((_, k) => k !== i))} className="col-span-12 sm:col-span-1 grid place-items-center h-9 rounded-lg text-mute hover:text-red-300 hover:bg-red-500/10 disabled:opacity-30"><Trash2 size={15} /></button>
        </div>))}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <button className={btnGhost} onClick={() => setRows(rs => [...rs, { source: sources[0], qty: 0, inventoryItemId: sharedItem }])}><Plus size={14} />Add part</button>
        <div className="flex items-center gap-3">
          <span className={`text-xs tabular-nums ${sum === need ? 'text-emerald-300' : 'text-amber-300'}`}>{sum} of {need} arranged</span>
          <button className={btnPrimary} disabled={busy} onClick={save}>{planned.length ? 'Update arrangement' : 'Confirm arrangement'}</button>
        </div>
      </div>
      <Err msg={err} />
    </div>
  );
};

// Hand over what has been arranged (issue from stock / confirm radios).
const HandOver: React.FC<{ r: Req; item: ReqItem; part: ReqPart }> = ({ r, item, part }) => {
  const inv = useInventory(); const { deliver, orders } = useRequests();
  const radio = item.kind === 'radio';
  const order = part.purchaseItemId ? orders[part.purchaseItemId] : undefined;
  const arrived = part.source !== 'purchase' ? true : order ? order.received >= part.qty : false;
  const [loc, setLoc] = useState(''); const [place, setPlace] = useState(r.deliverTo); const [who, setWho] = useState(r.requesterName);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const match = inv.locations.find(l => l.name.toLowerCase() === r.deliverTo.trim().toLowerCase());
  useEffect(() => { if (match && !loc) setLoc(match.id); }, [match]); // eslint-disable-line
  const go = async () => {
    setErr(''); setBusy(true);
    let where = loc;
    if (!radio) { if (!where || where === '__new') { const id = await inv.ensureLocation(place.trim()); if (!id) { setBusy(false); return setErr('Choose where it is going.'); } where = id; } }
    const e = await deliver(part.id, radio ? place : where, who.trim(), ''); setBusy(false); if (e) setErr(e);
  };
  if (part.source === 'purchase' && !part.purchaseItemId) return <div className="text-xs text-mute">Waiting for the purchase order to be raised.</div>;
  if (!arrived) return <div className="text-xs text-mute">Ordered{order ? ` (${order.poNumber ? order.poNumber + ' · ' : ''}${order.received} of ${order.ordered} arrived)` : ''}. You can hand it over once it arrives.</div>;
  return (
    <div className="grid grid-cols-12 gap-2 items-end">
      {radio ? <Field label="Allocated to / place" className="col-span-12 sm:col-span-5"><input className={inputCls} value={place} onChange={e => setPlace(e.target.value)} /></Field> : (
        <Field label="Send to location" className="col-span-12 sm:col-span-5">
          <select className={inputCls} value={loc} onChange={e => setLoc(e.target.value)}>
            <option value="">{match ? 'Choose…' : `Use "${r.deliverTo || 'delivery place'}"`}</option>
            {inv.locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </Field>)}
      <Field label="Received by" className="col-span-8 sm:col-span-4"><input className={inputCls} value={who} onChange={e => setWho(e.target.value)} /></Field>
      <button className={btnPrimary + ' col-span-4 sm:col-span-3'} disabled={busy} onClick={go}><PackageCheck size={14} />{radio ? 'Confirm' : 'Issue'}</button>
      <div className="col-span-12"><Err msg={err} /></div>
    </div>
  );
};

export const FulfilmentPanel: React.FC<{ r: Req }> = ({ r }) => {
  const { canArrange, canOrder, loadAvailability, createPO, orders } = useRequests();
  const [avail, setAvail] = useState<Record<string, Availability>>({}); const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const key = r.parts.map(p => p.id + p.status).join(',') + r.items.length;
  useEffect(() => { let on = true; loadAvailability().then(a => { if (on) { setAvail(a); setReady(true); } }); return () => { on = false; }; }, [loadAvailability, key]);

  const lines = r.items.filter(i => (i.approved ?? 0) > 0);
  const needsPO = r.parts.some(p => p.source === 'purchase' && !p.purchaseItemId);
  const pos = Array.from(new Set(r.parts.map(p => (p.purchaseItemId ? orders[p.purchaseItemId]?.poNumber : '')).filter((x): x is string => !!x)));
  const mkPO = async () => { setBusy(true); setErr(''); const x = await createPO(r.id); setBusy(false); if (x.error) setErr(x.error); };

  return (
    <Card title="Arrange and hand over" icon={PackageCheck} tone="text-emerald-300">
      <div className="space-y-3">
        {lines.map(i => {
          const mine = canArrange(i.kind);
          const parts = r.parts.filter(p => p.itemId === i.id);
          return (
            <div key={i.id} className="space-y-2">
              {mine && ready && !parts.some(p => p.status === 'planned' && p.purchaseItemId) && <LineArranger key={i.id + parts.map(p => p.id + p.qty + p.status).join(',')} r={r} item={i} avail={avail} />}
              {parts.length > 0 && (
                <div className="rounded-lg border border-line divide-y divide-line">
                  <div className="px-3 py-2 text-sm font-medium text-ink">{i.name} <span className="text-xs text-mute font-normal">· approved {i.approved} {i.unit}</span></div>
                  {parts.map(p => (
                    <div key={p.id} className="px-3 py-2.5 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap text-sm">
                        <Pill c={p.status === 'done' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-raised text-ink-soft'}>{p.status === 'done' ? 'Delivered' : SOURCE_LABEL[p.source]}</Pill>
                        <span className="text-ink tabular-nums">{p.qty} {i.unit}</span>
                        {p.status === 'done' && <span className="text-xs text-mute">to {p.receivedBy || p.location}{p.location && p.receivedBy ? ` at ${p.location}` : ''} · by {p.doneBy}</span>}
                      </div>
                      {p.status === 'planned' && mine && <HandOver r={r} item={i} part={p} />}
                      {p.status === 'planned' && !mine && <div className="text-xs text-mute">{p.source === 'purchase' ? (p.purchaseItemId ? 'Ordered, waiting for delivery.' : 'To be ordered by the Purchase team.') : 'Being arranged by the store team.'}</div>}
                    </div>))}
                </div>)}
              {!mine && parts.length === 0 && <div className="text-sm text-mute">{i.name}: waiting for the {i.kind === 'radio' ? 'Walkie-Talkie' : 'Inventory'} team to arrange it.</div>}
            </div>);
        })}
        {(needsPO || pos.length > 0) && (
          <div className="rounded-lg bg-raised/60 p-3 flex items-center justify-between gap-3 flex-wrap">
            <div className="text-sm text-ink-soft flex items-center gap-2"><ShoppingCart size={15} className="text-amber-300" />
              {needsPO ? 'Some items are not in stock and need a purchase order.' : `Purchase order${pos.length > 1 ? 's' : ''}: ${pos.join(', ')}`}</div>
            <div className="flex gap-2">
              {needsPO && canOrder && <button className={btnPrimary} disabled={busy} onClick={mkPO}>Create purchase order</button>}
              {canOrder && pos.length > 0 && <a className={btnGhost} href="#/purchase"><ExternalLink size={14} />Open Purchase</a>}
            </div>
          </div>)}
        <Err msg={err} />
      </div>
    </Card>
  );
};
