import React, { useEffect, useMemo, useState } from 'react';
import { Check, X, Plus, Trash2, Wand2, PackageCheck, ShoppingCart, ArrowUpRight, ChevronDown } from 'lucide-react';
import { Card, Field, Pill, btnDanger, btnGhost, btnPrimary, inputCls } from '../../components/ui';
import { useInventory } from '../inventory';
import { useManpower } from '../manpower';
import { usePurchase } from '../purchase';
import { useRequests } from './RequestsContext';
import type { Availability } from './RequestsContext';
import { SOURCE_LABEL, fmtDate, lineDone, lineStatus } from './types';
import type { PartSource, PlanPart, Req, ReqItem, ReqPart } from './types';

const Err: React.FC<{ msg: string }> = ({ msg }) => msg ? <div role="alert" className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{msg}</div> : null;

// ── Sub Admin review ───────────────────────────────────────────────────────────────────────────
export const SubReviewPanel: React.FC<{ r: Req }> = ({ r }) => {
  const { subReview } = useRequests();
  const [note, setNote] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const go = async (approve: boolean) => {
    if (!approve && !note.trim()) return setErr('Say why you are rejecting it.');
    setBusy(true); setErr(''); const e = await subReview(r.id, approve, note.trim()); setBusy(false); if (e) setErr(e);
  };
  return (
    <Card title="Your decision" tone="text-amber-300">
      <p className="text-sm text-mute mb-3">Approving forwards this request to the IT Department Head, who can approve it or escalate it to the Super Admin.</p>
      <Field label="Comment for the IT Department Head (required if you reject)"><textarea className={inputCls} rows={2} value={note} onChange={e => setNote(e.target.value)} /></Field>
      <div className="mt-3"><Err msg={err} /></div>
      <div className="flex gap-2 justify-end mt-3">
        <button className={btnGhost} disabled={busy} onClick={() => go(false)}><X size={14} />Reject</button>
        <button className={btnPrimary} disabled={busy} onClick={() => go(true)}><Check size={14} />Approve and send to IT Department Head</button>
      </div>
    </Card>
  );
};

// ── IT Department Head: approve with a budget, reject, or escalate ──────────────────────────────
export const ItReviewPanel: React.FC<{ r: Req }> = ({ r }) => {
  const { itDecide, loadAvailability } = useRequests();
  const inventory = useInventory();
  const [note, setNote] = useState('');
  const [budgets, setBudgets] = useState<Record<string, string>>(() => Object.fromEntries(r.items.map(i => [i.id, i.budgetRate == null ? '0' : String(i.budgetRate)])));
  const [miscItems, setMiscItems] = useState(r.miscItems || '');
  const [miscBudget, setMiscBudget] = useState(r.miscBudget ? String(r.miscBudget) : '');
  const [approvedQty, setApprovedQty] = useState<Record<string, string>>(() => Object.fromEntries(r.items.map(i => [i.id, String(i.approved ?? i.requested)])));
  const [cutReason, setCutReason] = useState<Record<string, string>>(() => Object.fromEntries(r.items.map(i => [i.id, i.cutReason || ''])));
  const [stockQty, setStockQty] = useState<Record<string, string>>(() => Object.fromEntries(r.items.map(i => [i.id, ''])));
  const [availability, setAvailability] = useState<Record<string, Availability>>({});
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  useEffect(() => { let on = true; loadAvailability().then(a => { if (on) setAvailability(a); }); return () => { on = false; }; }, [loadAvailability]);
  const qtyFor = (i: ReqItem) => Math.max(0, Math.min(i.requested, Math.floor(Number(approvedQty[i.id]) || 0)));
  const lineTotal = (item: ReqItem) => qtyFor(item) * (Number(budgets[item.id]) || 0);
  const total = r.items.reduce((sum, item) => sum + lineTotal(item), 0) + (Number(miscBudget) || 0);
  const matchingItems = (item: ReqItem) => inventory.items.filter(it => item.inventoryItemId ? it.id === item.inventoryItemId : productKey(it.name) === productKey(item.name));
  const go = async (action: 'approve' | 'escalate' | 'reject') => {
    if (action === 'reject' && !note.trim()) return setErr('Say why you are rejecting it.');
    if (action !== 'reject') {
      if (r.items.every(i => qtyFor(i) === 0)) return setErr('Approve at least one item, or reject the request.');
      const cut = r.items.find(i => qtyFor(i) < i.requested && !(cutReason[i.id] || '').trim());
      if (cut) return setErr(`Add a reason for reducing ${cut.name}.`);
      const missing = r.items.find(i => qtyFor(i) > 0 && (budgets[i.id] === '' || !Number.isFinite(Number(budgets[i.id])) || Number(budgets[i.id]) < 0));
      if (missing) return setErr(`Enter the item budget for ${missing.name}. Zero is allowed.`);
      const unconfirmedArrangement = r.items.find(i => i.kind !== 'radio' && qtyFor(i) > 0 && stockQty[i.id] === '');
      if (unconfirmedArrangement) return setErr(`Confirm the stock amount for ${unconfirmedArrangement.name}. Enter 0 if none will come from stock.`);
      if (miscBudget !== '' && (!Number.isFinite(Number(miscBudget)) || Number(miscBudget) < 0)) return setErr('Miscellaneous addition cannot be negative.');
      const invalidStock = r.items.find(i => {
        const qty = Math.max(0, Math.floor(Number(stockQty[i.id]) || 0));
        const id = matchingItems(i)[0]?.id || '';
        return qty > qtyFor(i) || (qty > 0 && (!id || qty > (availability[id]?.available ?? 0)));
      });
      if (invalidStock) return setErr(`Choose matching stock and stay within its available quantity for ${invalidStock.name}.`);
    }
    setBusy(true); setErr('');
    const e = await itDecide(r.id, action, note.trim(), miscItems.trim(), Number(miscBudget) || 0, r.items.map(i => {
      const approved = qtyFor(i);
      const stock = Math.min(approved, Math.max(0, Math.floor(Number(stockQty[i.id]) || 0)));
      const itemId = matchingItems(i)[0]?.id || null;
      return { id: i.id, approvedQty: approved, cutReason: (cutReason[i.id] || '').trim(), budgetRate: approved > 0 && budgets[i.id] !== '' ? Number(budgets[i.id]) : null, arrangementConfirmed: i.kind === 'radio' || stockQty[i.id] !== '', plan: [
        ...(stock > 0 ? [{ source: 'inventory' as const, qty: stock, inventoryItemId: itemId }] : []),
        ...(approved - stock > 0 ? [{ source: (i.kind === 'radio' ? 'walkie' as const : 'purchase' as const), qty: approved - stock, inventoryItemId: i.kind === 'radio' ? null : itemId }] : []),
      ] };
    }));
    setBusy(false); if (e) setErr(e);
  };
  return (
    <Card title="IT Department Head review" tone="text-amber-300">
      <p className="text-sm text-mute mb-3">Set each quantity and budget, then confirm stock for every approved item. Enter 0 when none will come from stock; Super Admin receives this saved plan if escalated.</p>
      <div className="space-y-2">
        {r.items.map(i => {
          const chosenId = matchingItems(i)[0]?.id || '';
          const stock = Math.max(0, Math.floor(Number(stockQty[i.id]) || 0));
          const available = i.kind === 'radio' ? 0 : chosenId ? availability[chosenId]?.available ?? 0 : 0;
          return <div key={i.id} className="rounded-lg border border-line bg-raised/15 p-3 sm:p-4">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-ink">{i.name}</div>
              <div className="mt-0.5 text-xs text-mute">Requested: {i.requested} {i.unit} <span className="mx-1 text-faint">·</span> Requester chose: {i.returnRequired ? 'Return after use' : 'Purchase / keep'}</div>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-[110px_minmax(0,1fr)_140px_160px_160px] md:items-end">
              <div><label htmlFor={`approved-qty-${i.id}`} className="mb-1 block text-xs font-medium text-ink-soft">Approve quantity</label><input id={`approved-qty-${i.id}`} type="number" min="0" max={i.requested} step="1" className={inputCls + ' tabular-nums'} value={approvedQty[i.id]} onChange={e => setApprovedQty(current => ({ ...current, [i.id]: e.target.value }))} /></div>
              {i.kind === 'radio' ? <div><div className="mb-1 text-xs font-medium text-ink-soft">Walkie pool</div><div className={inputCls + ' flex items-center text-xs text-mute'}>Assigned by Walkie team</div></div> : <div className="min-w-0"><div className="mb-1 flex items-center justify-between gap-1"><label htmlFor={`stock-qty-${i.id}`} className="whitespace-nowrap text-xs font-medium text-ink-soft">Use stock</label><span className="whitespace-nowrap text-[10.5px] text-mute">{available} available</span></div><input id={`stock-qty-${i.id}`} aria-label={`Quantity from inventory for ${i.name}`} type="number" min="0" max={Math.min(qtyFor(i), available)} step="1" className={inputCls + ' tabular-nums'} value={stockQty[i.id]} placeholder="Enter 0 if none" onChange={e => setStockQty(current => ({ ...current, [i.id]: e.target.value }))} /></div>}
              <Field label={i.kind === 'radio' ? 'From Walkie pool' : 'To purchase'}><div className={inputCls + ' flex items-center justify-between text-ink'}><span className="font-semibold tabular-nums">{Math.max(0, qtyFor(i) - stock)}</span><span className="text-xs text-mute">{i.unit}</span></div></Field>
              <Field label="Item budget (₹)"><input aria-label={`Item budget for ${i.name}`} type="number" min="0" step="0.01" inputMode="decimal" className={inputCls + ' text-right tabular-nums'} value={budgets[i.id]} onChange={e => setBudgets(current => ({ ...current, [i.id]: e.target.value }))} placeholder="0.00" /></Field>
              <div className="flex min-h-10 items-center justify-between gap-2 rounded-lg border border-line bg-field px-3 py-2"><span className="text-xs font-medium text-mute">Line total</span><span className="text-sm font-semibold tabular-nums text-ink">₹{lineTotal(i).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
            </div>
            {qtyFor(i) < i.requested && <Field label="Reason for reduced quantity"><input className={inputCls} maxLength={200} value={cutReason[i.id] || ''} onChange={e => setCutReason(current => ({ ...current, [i.id]: e.target.value }))} placeholder="Why is less being approved?" /></Field>}
          </div>;
        })}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px] sm:items-end"><Field label="Miscellaneous items"><input aria-label="Miscellaneous items" type="text" maxLength={300} className={inputCls} value={miscItems} onChange={e => setMiscItems(e.target.value)} placeholder="Add any extra items, if needed" /></Field><Field label="Miscellaneous addition (₹)"><input aria-label="Miscellaneous budget addition" type="number" min="0" step="0.01" inputMode="decimal" className={inputCls + ' text-right tabular-nums'} value={miscBudget} onChange={e => setMiscBudget(e.target.value)} placeholder="0.00" /></Field></div>
      <div className="mt-3 flex items-center justify-between rounded-lg bg-raised/60 px-3 py-2.5"><span className="text-xs font-medium text-mute">Estimated request budget</span><strong className="tabular-nums text-ink">₹{total.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>
      <div className="mt-3"><Field label="Note (required if you reject)"><textarea className={inputCls} rows={2} value={note} onChange={e => setNote(e.target.value)} /></Field></div>
      <div className="mt-3"><Err msg={err} /></div>
      <div className="flex flex-wrap gap-2 justify-end mt-3">
        <button className={btnGhost} disabled={busy} onClick={() => go('reject')}><X size={14} />Reject</button>
        <button className={btnGhost} disabled={busy} onClick={() => go('escalate')}><ArrowUpRight size={14} />Arrange & escalate</button>
        <button className={btnPrimary} disabled={busy} onClick={() => go('approve')}><Check size={14} />{busy ? 'Saving…' : 'Approve & proceed'}</button>
      </div>
    </Card>
  );
};

// ── Super Admin: approve, send back, or reject the saved IT Head plan ───────────────────────────
export const OwnerReviewPanel: React.FC<{ r: Req }> = ({ r }) => {
  const { ownerReview } = useRequests();
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const budget = r.items.reduce((sum, item) => sum + (item.budgetAmount || 0), 0) + r.miscBudget;
  const go = async (action: 'approve' | 'send_back' | 'reject') => {
    setBusy(true); setErr('');
    const e = await ownerReview(r.id, action);
    setBusy(false); if (e) setErr(e);
  };
  return (
    <Card title="Super Admin review" tone="text-amber-300">
      <p className="text-sm text-mute mb-3">Review the IT Department Head’s saved arrangement. Approve it, send it back for changes, or reject it.</p>
      <div className="overflow-x-auto rounded-lg border border-line"><table className="w-full min-w-[640px] text-left text-xs"><thead className="bg-raised/50 text-mute"><tr><th className="px-3 py-2">Item</th><th className="px-3 py-2">Approved</th><th className="px-3 py-2">Arrangement</th><th className="px-3 py-2 text-right">Budget</th></tr></thead><tbody className="divide-y divide-line">{r.items.map(i => <tr key={i.id}><td className="px-3 py-2.5 whitespace-nowrap text-ink">{i.name}</td><td className="px-3 py-2.5 whitespace-nowrap text-ink">{i.approved ?? 0} {i.unit}</td><td className="px-3 py-2.5 whitespace-nowrap text-ink-soft">{i.reviewPlan.length ? i.reviewPlan.map(p => `${SOURCE_LABEL[p.source]} ${p.qty}`).join(' · ') : 'No allocation'}</td><td className="px-3 py-2.5 text-right tabular-nums text-ink">₹{(i.budgetAmount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td></tr>)}{(r.miscItems || r.miscBudget > 0) && <tr><td className="px-3 py-2.5 text-ink" colSpan={3}><div>Miscellaneous items</div>{r.miscItems && <div className="mt-0.5 whitespace-normal text-mute">{r.miscItems}</div>}</td><td className="px-3 py-2.5 text-right tabular-nums text-ink">₹{r.miscBudget.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td></tr>}</tbody></table></div>
      <div className="flex items-center justify-between rounded-lg bg-raised/60 px-3 py-2.5 text-sm"><span className="text-xs font-medium text-mute">Estimated approved budget</span><strong className="tabular-nums text-ink">₹{budget.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>
      <div className="mt-3"><Err msg={err} /></div>
      <div className="flex gap-2 justify-end mt-3">
        <button className={btnGhost} disabled={busy} onClick={() => go('send_back')}><ArrowUpRight size={14} />Send back</button>
        <button className={btnDanger} disabled={busy} onClick={() => go('reject')}><X size={14} />Reject</button>
        <button className={btnPrimary} disabled={busy} onClick={() => go('approve')}><Check size={14} />Approve</button>
      </div>
    </Card>
  );
};

// After final approval, IT assigns the handover to a team or an IT Sewadar.
export const DeliveryAssignmentPanel: React.FC<{ r: Req }> = ({ r }) => {
  const { assignDelivery } = useRequests();
  const manpower = useManpower();
  const itSewadars = manpower.sewadars.filter(person => person.department.toLowerCase().includes('it'));
  const [target, setTarget] = useState(() => r.deliveryMemberId ? `member:${r.deliveryMemberId}` : r.deliveryTeam ? `team:${r.deliveryTeam}` : '');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  useEffect(() => { setTarget(r.deliveryMemberId ? `member:${r.deliveryMemberId}` : r.deliveryTeam ? `team:${r.deliveryTeam}` : ''); }, [r.id, r.deliveryMemberId, r.deliveryTeam]);
  const save = async () => {
    if (!target) return setErr('Choose a team or IT Sewadar for the delivery task.');
    setBusy(true); setErr('');
    const delivery = target.startsWith('team:') ? { team: target.slice(5), memberId: '' } : { team: '', memberId: target.slice(7) };
    const e = await assignDelivery(r.id, delivery);
    setBusy(false); if (e) setErr(e);
  };
  return <Card title="Assign delivery task" tone="text-emerald-300">
    <p className="mb-3 text-sm text-mute">This request is approved. Assign delivery now; stock tasks appear immediately, and purchase tasks appear after the goods arrive.</p>
    <div className="flex flex-wrap items-end gap-2">
      <Field label="Delivery team or IT Sewadar" className="min-w-[240px] flex-1"><select className={inputCls} value={target} onChange={e => setTarget(e.target.value)}><option value="">Choose an assignee</option>{manpower.teams.length > 0 && <optgroup label="Teams">{manpower.teams.map(team => <option key={team.id} value={`team:${team.name}`}>{team.name}</option>)}</optgroup>}{itSewadars.length > 0 && <optgroup label="IT Sewadars">{itSewadars.map(person => <option key={person.id} value={`member:${person.id}`}>{person.name}</option>)}</optgroup>}</select></Field>
      <button type="button" className={btnPrimary} disabled={busy || !target} onClick={save}>{busy ? 'Assigning…' : r.deliveryTeam || r.deliveryMemberId ? 'Update assignment' : 'Assign delivery task'}</button>
    </div>
    <div className="mt-2"><Err msg={err} /></div>
  </Card>;
};

// ── Store / Walkie team: split every approved line ───────────────────────────────────────────────
interface Row { source: PartSource; qty: number; inventoryItemId: string | null }
const productKey = (s: string) => s.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g, '');

const LineArranger: React.FC<{ r: Req; item: ReqItem; avail: Record<string, Availability> }> = ({ r, item, avail }) => {
  const inv = useInventory();
  const { planLine } = useRequests();
  const done = lineDone(r, item);
  const need = (item.approved ?? 0) - done;
  const planned = r.parts.filter(p => p.itemId === item.id && p.status === 'planned');
  const radio = item.kind === 'radio';

  // A request can only be fulfilled from its matching catalogue product.
  const matchingItems = useMemo(() => inv.items.filter(i => item.inventoryItemId
    ? i.id === item.inventoryItemId
    : productKey(i.name) === productKey(item.name)), [inv.items, item.inventoryItemId, item.name]);
  const guess = useMemo(() => {
    if (radio) return null;
    return matchingItems[0]?.id || null;
  }, [matchingItems, radio]);

  // Buying can only update the same product; otherwise it creates a catalogue entry for this request line.
  const buyId = matchingItems[0]?.id || null;
  const initial = (): Row[] => {
    if (planned.length) return planned.map(p => ({ source: p.source, qty: p.qty, inventoryItemId: p.inventoryItemId }));
    if (radio) return [{ source: 'walkie', qty: need, inventoryItemId: null }];
    const a = guess ? avail[guess]?.available ?? 0 : 0; const fromStock = Math.min(a, need);
    return fromStock > 0 ? [{ source: 'inventory', qty: fromStock, inventoryItemId: guess }, ...(need - fromStock > 0 ? [{ source: 'purchase' as PartSource, qty: need - fromStock, inventoryItemId: guess }] : [])]
      : [{ source: 'purchase', qty: need, inventoryItemId: buyId }];
  };
  const [rows, setRows] = useState<Row[]>(initial);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');

  useEffect(() => {
    if (inv.loading || !planned.length) return;
    setRows(current => current.map(row => row.inventoryItemId && !matchingItems.some(i => i.id === row.inventoryItemId)
      ? { ...row, inventoryItemId: null } : row));
  }, [inv.loading, matchingItems, planned.length]);
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
  const progress = need > 0 ? Math.min(100, (sum / need) * 100) : 0;
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface/40">
      <div className="flex items-center justify-between gap-3 border-b border-line bg-raised/30 px-4 py-3">
        <div className="min-w-0"><div className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Source split</div><div className="mt-0.5 text-xs text-mute">Allocate the remaining {need} {item.unit}{done ? ` · ${done} delivered` : ''}</div></div>
        {!radio && <button className={btnGhost} onClick={autoSplit}><Wand2 size={14} />Auto-split</button>}
      </div>
      <div className="space-y-2.5 p-3 sm:p-4">
        {rows.map((x, i) => {
          const stock = x.source === 'inventory';
          const matched = matchingItems.find(it => it.id === x.inventoryItemId) || matchingItems[0];
          return <div key={i} className={`grid grid-cols-12 items-end gap-2.5 rounded-lg border border-line/80 border-l-2 bg-raised/15 p-3 ${stock ? 'border-l-blue-500/70' : 'border-l-amber-500/70'}`}>
            <Field label="Source" className="col-span-7 sm:col-span-3">
              <select className={inputCls} value={x.source} onChange={e => set(i, { source: e.target.value as PartSource })}>{sources.map(s => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}</select>
            </Field>
            <Field label={`Quantity (${item.unit})`} className="col-span-5 sm:col-span-2"><input type="number" min={1} className={inputCls + ' tabular-nums'} value={x.qty} onChange={e => set(i, { qty: Math.max(0, Math.floor(Number(e.target.value))) })} /></Field>
            {!radio && stock && <Field label="Matching stock" className="col-span-10 sm:col-span-6">
              <select className={inputCls} value={x.inventoryItemId || ''} onChange={e => set(i, { inventoryItemId: e.target.value || null })}>
                <option value="">Choose item…</option>
                {matchingItems.map(it => <option key={it.id} value={it.id}>{it.name}{it.code ? ` (${it.code})` : ''} · {avail[it.id]?.available ?? it.inStock} free</option>)}
              </select>
            </Field>}
            {!radio && !stock && <div className="col-span-10 sm:col-span-6 min-w-0"><div className="mb-1 text-xs font-medium text-ink-soft">Purchase item</div><div className="flex h-9 items-center rounded-lg border border-line bg-field px-3 text-sm text-ink-soft">{matched?.name || `New catalogue item: ${item.name}`}</div></div>}
            <button aria-label="Remove part" disabled={rows.length === 1} onClick={() => setRows(rs => rs.filter((_, k) => k !== i))} className="col-span-2 sm:col-span-1 grid h-9 place-items-center rounded-lg text-mute transition-colors hover:bg-red-500/10 hover:text-red-300 disabled:opacity-30"><Trash2 size={15} /></button>
          </div>;
        })}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <button className={btnGhost} onClick={() => setRows(rs => [...rs, { source: sources[0], qty: 0, inventoryItemId: sharedItem }])}><Plus size={14} />Add part</button>
          <div className="flex min-w-[220px] flex-1 items-center justify-end gap-3 sm:max-w-md">
            <div className="h-1.5 min-w-16 flex-1 overflow-hidden rounded-full bg-line"><div className={`h-full rounded-full transition-[width,background-color] duration-300 ease-out ${sum === need ? 'bg-emerald-400' : 'bg-blue-500'}`} style={{ width: `${progress}%` }} /></div>
            <span className={`whitespace-nowrap text-xs font-medium tabular-nums ${sum === need ? 'text-emerald-300' : 'text-amber-300'}`}>{sum} / {need} {item.unit}</span>
            <button className={btnPrimary} disabled={busy || inv.loading} onClick={save}>{busy ? 'Saving…' : 'Save split'}</button>
          </div>
        </div>
        <Err msg={err} />
      </div>
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
  if (!arrived) return <div className="text-xs text-mute">Ordered{order ? ` · ${order.received} of ${order.ordered} arrived` : ''}. You can hand it over once it arrives.{order?.trackingStatus && <span className="ml-1 text-blue-300">{order.marketplace === 'amazon' ? 'Amazon' : order.marketplace === 'flipkart' ? 'Flipkart' : 'Courier'}: {order.trackingSubStatus || order.trackingStatus}{order.trackingLocation ? ` · ${order.trackingLocation}` : ''}{order.trackingAt ? ` · ${new Date(order.trackingAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}` : ''}{order.trackingUrl && <> · <a className="hover:underline" href={order.trackingUrl} target="_blank" rel="noreferrer">Track</a></>}</span>}</div>;
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

const ReturnControl: React.FC<{ r: Req; item: ReqItem; part: ReqPart; canRecord: boolean }> = ({ r, item, part, canRecord }) => {
  const { returnPart } = useRequests();
  const [qty, setQty] = useState(String(Math.max(0, part.qty - part.returnedQty)));
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const remaining = Math.max(0, part.qty - part.returnedQty);
  useEffect(() => { setQty(String(remaining)); setErr(''); }, [remaining]);
  const save = async () => {
    const n = Number(qty);
    if (!Number.isInteger(n) || n < 1 || n > remaining) { setErr(`Enter a return quantity from 1 to ${remaining}.`); return; }
    setBusy(true); setErr(''); const error = await returnPart(part.id, n, ''); setBusy(false); if (error) setErr(error);
  };
  return <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-raised/20 px-3 py-2">
    <div className="text-xs text-ink-soft">Return after use <span className="text-mute">· {part.returnedQty} of {part.qty} {item.unit} returned</span></div>
    {remaining > 0 && canRecord ? <div className="flex items-center gap-2 print:hidden"><input aria-label={`Return quantity for ${item.name}`} type="number" min={1} max={remaining} step={1} className="h-8 w-20 rounded-md border border-line bg-canvas px-2 text-right text-xs tabular-nums text-ink" value={qty} onChange={e => setQty(e.target.value)} /><button className={btnGhost} disabled={busy} onClick={save}><PackageCheck size={14} />{busy ? 'Saving…' : `Record return (${remaining} left)`}</button></div> : remaining === 0 ? <span className="text-xs text-emerald-300">Fully returned</span> : <span className="text-xs text-mute">{remaining} {item.unit} not yet returned</span>}
    <Err msg={err} />
  </div>;
};

export const FulfilmentPanel: React.FC<{ r: Req }> = ({ r }) => {
  const { canArrange, canDecideArrangement, canOrder, canConfirm, loadAvailability, createPO, confirmReceipt, orders, me } = useRequests();
  const purchase = usePurchase();
  const [expanded, setExpanded] = useState(() => !['approved', 'fulfilled'].includes(r.status));
  const [avail, setAvail] = useState<Record<string, Availability>>({}); const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const key = r.parts.map(p => p.id + p.status).join(',') + r.items.length;
  useEffect(() => { let on = true; loadAvailability().then(a => { if (on) { setAvail(a); setReady(true); } }); return () => { on = false; }; }, [loadAvailability, key]);
  useEffect(() => { setExpanded(!['approved', 'fulfilled'].includes(r.status)); }, [r.id, r.status]);

  const lines = r.items.filter(i => (i.approved ?? 0) > 0);
  const pendingParts = r.parts.filter(p => p.status === 'planned').length;
  const deliveredParts = r.parts.filter(p => p.status === 'done').length;
  const [confirmBusy, setConfirmBusy] = useState(false); const [confirmError, setConfirmError] = useState('');
  const needsPO = r.parts.some(p => p.source === 'purchase' && !p.purchaseItemId);
  const mkPO = async () => {
    setBusy(true); setErr(''); const x = await createPO(r.id);
    if (x.error) { setBusy(false); setErr(x.error); return; }
    await purchase.refresh();
    setBusy(false);
    location.hash = '#/purchase/buy';
  };
  const confirm = async () => { setConfirmError(''); setConfirmBusy(true); const error = await confirmReceipt(r.id); setConfirmBusy(false); if (error) setConfirmError(error); };
  const canRecordReturn = r.requesterId === me.id || me.isExec || me.team === 'inventory' || me.level === 'dept_head';

  return (
    <Card title="Items and delivery" icon={PackageCheck} tone="text-emerald-300" action={<div className="flex flex-wrap items-center justify-end gap-2">{needsPO && canOrder && <button className={btnPrimary} disabled={busy} onClick={mkPO}><ShoppingCart size={14} />{busy ? 'Creating…' : 'Create purchase order'}</button>}<button type="button" aria-expanded={expanded} aria-controls={`fulfilment-list-${r.id}`} onClick={() => setExpanded(value => !value)} className={`${btnGhost} !px-3 !py-1.5`}><span>{expanded ? 'Hide list' : `Show list · ${lines.length}`}</span><ChevronDown size={15} className={`transition-transform duration-300 ease-out ${expanded ? 'rotate-180' : ''}`} /></button></div>}>
      {!expanded && <p className="-mt-1 text-xs text-mute">{lines.length} approved item{lines.length === 1 ? '' : 's'} <span className="mx-1 text-faint">·</span> {pendingParts} pending <span className="mx-1 text-faint">·</span> {deliveredParts} delivered</p>}
      <Err msg={err} />
      <div id={`fulfilment-list-${r.id}`}>{expanded && <div className="space-y-3 animate-fade-in">
        {lines.map(i => {
          const mine = canArrange(i.kind);
          const parts = r.parts.filter(p => p.itemId === i.id);
          const status = lineStatus(r, i, orders);
          const statusTone = status.tone === 'ok' ? 'bg-emerald-500/15 text-emerald-300' : status.tone === 'warn' ? 'bg-amber-500/15 text-amber-300' : status.tone === 'bad' ? 'bg-red-500/15 text-red-300' : 'bg-raised text-ink-soft';
          return (
            <section key={i.id} className="overflow-hidden rounded-xl border border-line bg-surface/30">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-3 py-3 sm:px-4">
                <div className="min-w-0"><div className="font-semibold text-ink">{i.name}</div><div className="mt-0.5 text-xs text-mute">Asked {i.requested} {i.unit} <span className="mx-1 text-faint">·</span> Approved {i.approved} {i.unit} <span className="mx-1 text-faint">·</span> {i.returnRequired ? 'Return after use' : 'Purchase / keep'} <span className="mx-1 text-faint">·</span> ₹{(i.budgetAmount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div></div>
                <Pill c={statusTone}>{status.text}</Pill>
              </div>
              {canDecideArrangement && ready && !parts.some(p => p.status === 'planned' && p.purchaseItemId) && <LineArranger key={i.id + parts.map(p => p.id + p.qty + p.status).join(',')} r={r} item={i} avail={avail} />}
              {parts.length > 0 && (
                <div className="divide-y divide-line">
                  {parts.map(p => (
                    <div key={p.id} className="space-y-2 px-3 py-3 sm:px-4">
                      <div className="flex items-center gap-2 flex-wrap text-sm">
                        <Pill c={p.status === 'done' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-raised text-ink-soft'}>{p.status === 'done' ? 'Delivered' : SOURCE_LABEL[p.source]}</Pill>
                        <span className="text-ink tabular-nums">{p.qty} {i.unit}</span>
                        {p.purchaseItemId && orders[p.purchaseItemId]?.poNumber && <span className="font-mono text-xs text-blue-300">{orders[p.purchaseItemId].poNumber}{orders[p.purchaseItemId].poStatus ? ` · ${orders[p.purchaseItemId].poStatus}` : ''}</span>}
                        {p.purchaseItemId && orders[p.purchaseItemId] && <span className="text-xs text-mute">Vendor: {orders[p.purchaseItemId].vendor || '—'} · Rate: {orders[p.purchaseItemId].rate == null ? '—' : `₹${orders[p.purchaseItemId].rate.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`}</span>}
                        {p.status === 'done' && <span className="text-xs text-mute">to {p.receivedBy || p.location}{p.location && p.receivedBy ? ` at ${p.location}` : ''} · by {p.doneBy}</span>}
                      </div>
                      {p.status === 'planned' && mine && <HandOver r={r} item={i} part={p} />}
                      {p.status === 'planned' && !mine && <div className="text-xs text-mute">{p.source === 'purchase' ? (p.purchaseItemId ? 'Ordered, waiting for delivery.' : 'Waiting for Purchase to create an order.') : 'Being arranged by the Department Admin.'}</div>}
                      {p.status === 'done' && i.returnRequired && p.source !== 'walkie' && <ReturnControl r={r} item={i} part={p} canRecord={canRecordReturn} />}
                    </div>))}
                </div>)}
              {!canDecideArrangement && parts.length === 0 && <div className="text-sm text-mute">{i.name}: waiting for Department Admin to choose stock, purchase, or {i.kind === 'radio' ? 'the radio pool' : 'another source'}.</div>}
            </section>);
        })}
        {r.status === 'fulfilled' && (r.confirmedAt
          ? <div className="flex items-center gap-2 text-sm text-emerald-300"><Check size={16} />Receipt confirmed{r.confirmedBy ? ` by ${r.confirmedBy}` : ''} on {fmtDate(r.confirmedAt)}.</div>
          : canConfirm(r) ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 print:hidden"><span className="text-sm text-emerald-200">Everything approved has been delivered. Did you receive it all?</span><button className={btnPrimary} disabled={confirmBusy} onClick={confirm}><Check size={14} />{confirmBusy ? 'Saving…' : 'Confirm receipt'}</button></div>
            : <p className="text-xs text-mute">Delivered. Waiting for {r.requesterName} to confirm receipt.</p>)}
        <Err msg={confirmError} />
      </div>}</div>
    </Card>
  );
};
