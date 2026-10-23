import React, { useEffect, useMemo, useState } from 'react';
import { Check, Plus, Trash2, Wand2, PackageCheck, ShoppingCart, ChevronDown } from 'lucide-react';
import { Card, Field, Pill, btnGhost, btnPrimary, inputCls } from '../../../components/ui';
import { useInventory } from '../../inventory';
import { usePurchase } from '../../purchase';
import { useRequests } from '../RequestsContext';
import type { Availability } from '../RequestsContext';
import { SOURCE_LABEL, fmtDate, lineDone, lineStatus, purchaseAtStore } from '../types';
import { TASK_STATUS, useDeliveryTasks } from './useDeliveryTasks';
import type { PartSource, PlanPart, Req, ReqItem, ReqPart } from '../types';
import { Err } from './shared';
import { Select } from '../../../components/Select';

// ── Store / Walkie team: split every approved line ───────────────────────────────────────────────
interface Row {
  source: PartSource;
  qty: number;
  inventoryItemId: string | null;
}

export const productKey = (s: string) =>
  s
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const LineArranger: React.FC<{ r: Req; item: ReqItem; avail: Record<string, Availability> }> = ({ r, item, avail }) => {
  const inv = useInventory();
  const { planLine } = useRequests();
  const done = lineDone(r, item);
  const need = (item.approved ?? 0) - done;
  const planned = r.parts.filter(p => p.itemId === item.id && p.status === 'planned');
  const radio = item.kind === 'radio';

  // A request can only be fulfilled from its matching catalogue product, in the requested department's stock.
  const matchingItems = useMemo(
    () =>
      inv.allItems.filter(
        i =>
          (!r.departmentId || i.departmentId === r.departmentId) &&
          (item.inventoryItemId ? i.id === item.inventoryItemId : productKey(i.name) === productKey(item.name)),
      ),
    [inv.allItems, r.departmentId, item.inventoryItemId, item.name],
  );
  const guess = useMemo(() => {
    if (radio) return null;
    return matchingItems[0]?.id || null;
  }, [matchingItems, radio]);

  // Buying can only update the same product; otherwise it creates a catalogue entry for this request line.
  const buyId = matchingItems[0]?.id || null;
  const initial = (): Row[] => {
    if (planned.length) return planned.map(p => ({ source: p.source, qty: p.qty, inventoryItemId: p.inventoryItemId }));
    if (radio) return [{ source: 'walkie', qty: need, inventoryItemId: null }];
    const a = guess ? (avail[guess]?.available ?? 0) : 0;
    const fromStock = Math.min(a, need);
    return fromStock > 0
      ? [
          { source: 'inventory', qty: fromStock, inventoryItemId: guess },
          ...(need - fromStock > 0
            ? [{ source: 'purchase' as PartSource, qty: need - fromStock, inventoryItemId: guess }]
            : []),
        ]
      : [{ source: 'purchase', qty: need, inventoryItemId: buyId }];
  };
  const [rows, setRows] = useState<Row[]>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (inv.loading || !planned.length) return;
    setRows(current =>
      current.map(row =>
        row.inventoryItemId && !matchingItems.some(i => i.id === row.inventoryItemId)
          ? { ...row, inventoryItemId: null }
          : row,
      ),
    );
  }, [inv.loading, matchingItems, planned.length]);
  useEffect(() => {
    if (!planned.length && guess)
      setRows(rs =>
        rs.map(x => (x.inventoryItemId || x.source !== 'inventory' ? x : { ...x, inventoryItemId: guess })),
      );
  }, [guess]); // eslint-disable-line

  const sum = rows.reduce((t, x) => t + (x.qty || 0), 0);
  const set = (i: number, p: Partial<Row>) => setRows(rs => rs.map((x, k) => (k === i ? { ...x, ...p } : x)));
  const sharedItem = rows.find(x => x.inventoryItemId)?.inventoryItemId || null;
  const autoSplit = () => {
    const id = sharedItem || guess;
    const a = id ? (avail[id]?.available ?? 0) : 0;
    const s = Math.min(a, need);
    setRows([
      ...(s > 0 ? [{ source: 'inventory' as PartSource, qty: s, inventoryItemId: id }] : []),
      ...(need - s > 0 ? [{ source: 'purchase' as PartSource, qty: need - s, inventoryItemId: id }] : []),
    ]);
  };
  const save = async () => {
    setErr('');
    if (sum !== need) return setErr(`The parts add up to ${sum}, but ${need} must be arranged.`);
    if (!radio && rows.some(x => x.source === 'inventory' && !x.inventoryItemId))
      return setErr('Choose which inventory item to take from.');
    setBusy(true);
    const e = await planLine(
      item.id,
      rows
        .filter(x => x.qty > 0)
        .map(x => ({ source: x.source, qty: x.qty, inventoryItemId: radio ? null : x.inventoryItemId }) as PlanPart),
    );
    setBusy(false);
    if (e) setErr(e);
  };
  if (need <= 0) return null;
  const sources: PartSource[] = radio ? ['walkie', 'purchase'] : ['inventory', 'purchase'];
  const progress = need > 0 ? Math.min(100, (sum / need) * 100) : 0;
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface/40">
      <div className="flex items-center justify-between gap-3 border-b border-line bg-raised/30 px-4 py-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Source split</div>
          <div className="mt-0.5 text-xs text-mute">
            Allocate the remaining {need} {item.unit}
            {done ? ` · ${done} delivered` : ''}
          </div>
        </div>
        {!radio && (
          <button className={btnGhost} onClick={autoSplit}>
            <Wand2 size={14} />
            Auto-split
          </button>
        )}
      </div>
      <div className="space-y-2.5 p-3 sm:p-4">
        {rows.map((x, i) => {
          const stock = x.source === 'inventory';
          const matched = matchingItems.find(it => it.id === x.inventoryItemId) || matchingItems[0];
          return (
            <div
              key={i}
              className={`grid grid-cols-12 items-end gap-2.5 rounded-lg border border-line/80 border-l-2 bg-raised/15 p-3 ${stock ? 'border-l-blue-500/70' : 'border-l-amber-500/70'}`}
            >
              <Field label="Source" className="col-span-7 sm:col-span-3">
                <Select
                  className={inputCls}
                  value={x.source}
                  onChange={e => set(i, { source: e.target.value as PartSource })}
                >
                  {sources.map(s => (
                    <option key={s} value={s}>
                      {SOURCE_LABEL[s]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={`Quantity (${item.unit})`} className="col-span-5 sm:col-span-2">
                <input
                  type="number"
                  min={1}
                  className={inputCls + ' tabular-nums'}
                  value={x.qty}
                  onChange={e => set(i, { qty: Math.max(0, Math.floor(Number(e.target.value))) })}
                />
              </Field>
              {!radio && stock && (
                <Field label="Matching stock" className="col-span-10 sm:col-span-6">
                  <Select
                    className={inputCls}
                    value={x.inventoryItemId || ''}
                    onChange={e => set(i, { inventoryItemId: e.target.value || null })}
                  >
                    <option value="">Choose item…</option>
                    {matchingItems.map(it => (
                      <option key={it.id} value={it.id}>
                        {it.name}
                        {it.code ? ` (${it.code})` : ''} · {avail[it.id]?.available ?? it.inStock} free
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              {!radio && !stock && (
                <div className="col-span-10 sm:col-span-6 min-w-0">
                  <div className="mb-1 text-xs font-medium text-ink-soft">Purchase item</div>
                  <div className="flex h-9 items-center rounded-lg border border-line bg-field px-3 text-sm text-ink-soft">
                    {matched?.name || `New catalogue item: ${item.name}`}
                  </div>
                </div>
              )}
              <button
                aria-label="Remove part"
                disabled={rows.length === 1}
                onClick={() => setRows(rs => rs.filter((_, k) => k !== i))}
                className="col-span-2 sm:col-span-1 grid h-9 place-items-center rounded-lg text-mute transition-colors hover:bg-red-500/10 hover:text-red-300 disabled:opacity-30"
              >
                <Trash2 size={15} />
              </button>
            </div>
          );
        })}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <button
            className={btnGhost}
            onClick={() => setRows(rs => [...rs, { source: sources[0], qty: 0, inventoryItemId: sharedItem }])}
          >
            <Plus size={14} />
            Add part
          </button>
          <div className="flex min-w-[220px] flex-1 items-center justify-end gap-3 sm:max-w-md">
            <div className="h-1.5 min-w-16 flex-1 overflow-hidden rounded-full bg-line">
              <div
                className={`h-full rounded-full transition-[width,background-color] duration-300 ease-out ${sum === need ? 'bg-emerald-400' : 'bg-blue-500'}`}
                style={{ width: `${progress}%` }}
              />
            </div>
            <span
              className={`whitespace-nowrap text-xs font-medium tabular-nums ${sum === need ? 'text-emerald-300' : 'text-amber-300'}`}
            >
              {sum} / {need} {item.unit}
            </span>
            <button className={btnPrimary} disabled={busy || inv.loading} onClick={save}>
              {busy ? 'Saving…' : 'Save split'}
            </button>
          </div>
        </div>
        <Err msg={err} />
      </div>
    </div>
  );
};

// Hand over what has been arranged (issue from stock / confirm radios).
const HandOver: React.FC<{ r: Req; item: ReqItem; part: ReqPart }> = ({ r, item, part }) => {
  const inv = useInventory();
  const { deliver, orders } = useRequests();
  const radio = item.kind === 'radio';
  const order = part.purchaseItemId ? orders[part.purchaseItemId] : undefined;
  // Purchased parts can be handed over as they arrive: what is at the store minus what was already handed over.
  const atStore = part.source !== 'purchase' ? part.qty : purchaseAtStore(r, part, orders);
  const arrived = atStore > 0;
  const [loc, setLoc] = useState('');
  const [place, setPlace] = useState(r.deliverTo);
  const [who, setWho] = useState(r.requesterName);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const match = inv.locations.find(l => l.name.toLowerCase() === r.deliverTo.trim().toLowerCase());
  useEffect(() => {
    if (match && !loc) setLoc(match.id);
  }, [match]); // eslint-disable-line
  const go = async () => {
    setErr('');
    setBusy(true);
    let where = loc;
    if (!radio) {
      if (!where || where === '__new') {
        const id = await inv.ensureLocation(place.trim());
        if (!id) {
          setBusy(false);
          return setErr('Choose where it is going.');
        }
        where = id;
      }
    }
    const e = await deliver(part.id, radio ? place : where, who.trim(), '');
    setBusy(false);
    if (e) setErr(e);
  };
  if (part.source === 'purchase' && !part.purchaseItemId)
    return <div className="text-xs text-mute">Waiting for the purchase order to be raised.</div>;
  if (!arrived)
    return (
      <div className="text-xs text-mute">
        Ordered{order ? ` · ${order.received} of ${order.ordered} at the store` : ''}. You can hand it over as soon as
        some of it arrives.
        {order?.trackingStatus && (
          <span className="ml-1 text-blue-300">
            {order.marketplace === 'amazon' ? 'Amazon' : order.marketplace === 'flipkart' ? 'Flipkart' : 'Courier'}:{' '}
            {order.trackingSubStatus || order.trackingStatus}
            {order.trackingLocation ? ` · ${order.trackingLocation}` : ''}
            {order.trackingAt
              ? ` · ${new Date(order.trackingAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}`
              : ''}
            {order.trackingUrl && (
              <>
                {' '}
                ·{' '}
                <a className="hover:underline" href={order.trackingUrl} target="_blank" rel="noreferrer">
                  Track
                </a>
              </>
            )}
          </span>
        )}
      </div>
    );
  return (
    <div className="grid grid-cols-12 gap-2 items-end">
      {radio ? (
        <Field label="Allocated to / place" className="col-span-12 sm:col-span-5">
          <input className={inputCls} value={place} onChange={e => setPlace(e.target.value)} />
        </Field>
      ) : (
        <Field label="Send to location" className="col-span-12 sm:col-span-5">
          <Select className={inputCls} value={loc} onChange={e => setLoc(e.target.value)}>
            <option value="">{match ? 'Choose…' : `Use "${r.deliverTo || 'delivery place'}"`}</option>
            {inv.locations.map(l => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label="Received by" className="col-span-8 sm:col-span-4">
        <input className={inputCls} value={who} onChange={e => setWho(e.target.value)} />
      </Field>
      <button className={btnPrimary + ' col-span-4 sm:col-span-3'} disabled={busy} onClick={go}>
        <PackageCheck size={14} />
        {atStore < part.qty ? `Hand over ${atStore}` : 'Hand over'}
      </button>
      {atStore < part.qty && (
        <p className="col-span-12 text-xs text-amber-300">
          {atStore} of {part.qty} {item.unit} are at the store. Hand these over now; the other {part.qty - atStore} stay
          on this request until they arrive.
        </p>
      )}
      <div className="col-span-12">
        <Err msg={err} />
      </div>
    </div>
  );
};

const ReturnControl: React.FC<{ r: Req; item: ReqItem; part: ReqPart; canRecord: boolean }> = ({
  r,
  item,
  part,
  canRecord,
}) => {
  const { returnPart } = useRequests();
  const [qty, setQty] = useState(String(Math.max(0, part.qty - part.returnedQty)));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const remaining = Math.max(0, part.qty - part.returnedQty);
  useEffect(() => {
    setQty(String(remaining));
    setErr('');
  }, [remaining]);
  const save = async () => {
    const n = Number(qty);
    if (!Number.isInteger(n) || n < 1 || n > remaining) {
      setErr(`Enter a return quantity from 1 to ${remaining}.`);
      return;
    }
    setBusy(true);
    setErr('');
    const error = await returnPart(part.id, n, '');
    setBusy(false);
    if (error) setErr(error);
  };
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-raised/20 px-3 py-2">
      <div className="text-xs text-ink-soft">
        Return after use{' '}
        <span className="text-mute">
          · {part.returnedQty} of {part.qty} {item.unit} returned
        </span>
      </div>
      {remaining > 0 && canRecord ? (
        <div className="flex items-center gap-2 print:hidden">
          <input
            aria-label={`Return quantity for ${item.name}`}
            type="number"
            min={1}
            max={remaining}
            step={1}
            className="h-8 w-20 rounded-md border border-line bg-canvas px-2 text-right text-xs tabular-nums text-ink"
            value={qty}
            onChange={e => setQty(e.target.value)}
          />
          <button className={btnGhost} disabled={busy} onClick={save}>
            <PackageCheck size={14} />
            {busy ? 'Saving…' : `Record return (${remaining} left)`}
          </button>
        </div>
      ) : remaining === 0 ? (
        <span className="text-xs text-emerald-300">Fully returned</span>
      ) : (
        <span className="text-xs text-mute">
          {remaining} {item.unit} not yet returned
        </span>
      )}
      <Err msg={err} />
    </div>
  );
};

export const FulfilmentPanel: React.FC<{ r: Req }> = ({ r }) => {
  const {
    canArrange,
    canDecideArrangement,
    canOrderFor,
    canConfirm,
    loadAvailability,
    createPO,
    confirmReceipt,
    orders,
    me,
  } = useRequests();
  const purchase = usePurchase();
  const tasks = useDeliveryTasks(r);
  const [expanded, setExpanded] = useState(() => !['approved', 'fulfilled'].includes(r.status));
  const [avail, setAvail] = useState<Record<string, Availability>>({});
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const key = r.parts.map(p => p.id + p.status).join(',') + r.items.length;
  useEffect(() => {
    let on = true;
    loadAvailability().then(a => {
      if (on) {
        setAvail(a);
        setReady(true);
      }
    });
    return () => {
      on = false;
    };
  }, [loadAvailability, key]);
  useEffect(() => {
    setExpanded(!['approved', 'fulfilled'].includes(r.status));
  }, [r.id, r.status]);

  const lines = r.items.filter(i => (i.approved ?? 0) > 0);
  const pendingParts = r.parts.filter(p => p.status === 'planned').length;
  const deliveredParts = r.parts.filter(p => p.status === 'done').length;
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState('');
  const needsPO = r.parts.some(p => p.source === 'purchase' && !p.purchaseItemId);
  const mkPO = async () => {
    setBusy(true);
    setErr('');
    const x = await createPO(r.id);
    if (x.error) {
      setBusy(false);
      setErr(x.error);
      return;
    }
    await purchase.refresh();
    setBusy(false);
    location.hash = '#/purchase/buy';
  };
  const confirm = async () => {
    setConfirmError('');
    setConfirmBusy(true);
    const error = await confirmReceipt(r.id);
    setConfirmBusy(false);
    if (error) setConfirmError(error);
  };
  const canRecordReturn = r.requesterId === me.id || me.isExec || me.team === 'inventory' || me.level === 'dept_head';

  return (
    <Card
      title="Items and delivery"
      icon={PackageCheck}
      tone="text-emerald-300"
      action={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {/* Approval puts purchases on a draft order by itself; this is only the fallback if that did not happen. */}
          {needsPO && canOrderFor(r) && (
            <button className={btnPrimary} disabled={busy} onClick={mkPO}>
              <ShoppingCart size={14} />
              {busy ? 'Creating…' : 'Create draft order'}
            </button>
          )}
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={`fulfilment-list-${r.id}`}
            onClick={() => setExpanded(value => !value)}
            className={`${btnGhost} !px-3 !py-1.5`}
          >
            <span>{expanded ? 'Hide list' : `Show list · ${lines.length}`}</span>
            <ChevronDown
              size={15}
              className={`transition-transform duration-300 ease-out ${expanded ? 'rotate-180' : ''}`}
            />
          </button>
        </div>
      }
    >
      {!expanded && (
        <p className="-mt-1 text-xs text-mute">
          {lines.length} approved item{lines.length === 1 ? '' : 's'} <span className="mx-1 text-faint">·</span>{' '}
          {pendingParts} pending <span className="mx-1 text-faint">·</span> {deliveredParts} handed over
        </p>
      )}
      <Err msg={err} />
      <div id={`fulfilment-list-${r.id}`}>
        {expanded && (
          <div className="space-y-3 animate-fade-in">
            {lines.map(i => {
              const mine = canArrange(i.kind);
              const parts = r.parts.filter(p => p.itemId === i.id);
              const status = lineStatus(r, i, orders);
              const statusTone =
                status.tone === 'ok'
                  ? 'bg-emerald-500/15 text-emerald-300'
                  : status.tone === 'warn'
                    ? 'bg-amber-500/15 text-amber-300'
                    : status.tone === 'bad'
                      ? 'bg-red-500/15 text-red-300'
                      : 'bg-raised text-ink-soft';
              return (
                <section key={i.id} className="overflow-hidden rounded-xl border border-line bg-surface/30">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-3 py-3 sm:px-4">
                    <div className="min-w-0">
                      <div className="font-semibold text-ink">{i.name}</div>
                      <div className="mt-0.5 text-xs text-mute">
                        Asked {i.requested} {i.unit} <span className="mx-1 text-faint">·</span> Approved {i.approved}{' '}
                        {i.unit} <span className="mx-1 text-faint">·</span>{' '}
                        {i.returnRequired ? 'Return after use' : 'Purchase / keep'}{' '}
                        <span className="mx-1 text-faint">·</span> ₹
                        {(i.budgetAmount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </div>
                    </div>
                    <Pill c={statusTone}>{status.text}</Pill>
                  </div>
                  {canDecideArrangement && ready && !parts.some(p => p.status === 'planned' && p.purchaseItemId) && (
                    <LineArranger
                      key={i.id + parts.map(p => p.id + p.qty + p.status).join(',')}
                      r={r}
                      item={i}
                      avail={avail}
                    />
                  )}
                  {parts.length > 0 && (
                    <div className="divide-y divide-line">
                      {parts.map(p => (
                        <div key={p.id} className="space-y-2 px-3 py-3 sm:px-4">
                          <div className="flex items-center gap-2 flex-wrap text-sm">
                            <Pill
                              c={p.status === 'done' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-raised text-ink-soft'}
                            >
                              {p.status === 'done' ? 'Handed over' : SOURCE_LABEL[p.source]}
                            </Pill>
                            <span className="text-ink tabular-nums">
                              {p.qty} {i.unit}
                            </span>
                            {p.purchaseItemId && orders[p.purchaseItemId]?.poNumber && (
                              <span className="font-mono text-xs text-blue-300">
                                {orders[p.purchaseItemId].poNumber}
                                {orders[p.purchaseItemId].poStatus ? ` · ${orders[p.purchaseItemId].poStatus}` : ''}
                              </span>
                            )}
                            {p.purchaseItemId && orders[p.purchaseItemId] && (
                              <span className="text-xs text-mute">
                                Vendor: {orders[p.purchaseItemId].vendor || '—'} · Rate:{' '}
                                {orders[p.purchaseItemId].rate == null
                                  ? '—'
                                  : `₹${orders[p.purchaseItemId].rate.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`}
                              </span>
                            )}
                            {tasks[p.id] && (
                              <a
                                href="#/tasks"
                                className="text-xs text-mute hover:text-ink"
                                title="Delivery task on Team tasks"
                              >
                                Task:{' '}
                                <span
                                  className={`rounded-full px-1.5 py-0.5 font-medium ${(TASK_STATUS[tasks[p.id].status] || ['', 'bg-raised text-mute'])[1]}`}
                                >
                                  {(TASK_STATUS[tasks[p.id].status] || [tasks[p.id].status])[0]}
                                </span>{' '}
                                {tasks[p.id].assignedTo || tasks[p.id].team}
                              </a>
                            )}
                            {p.status === 'done' && (
                              <span className="text-xs text-mute">
                                to {p.receivedBy || p.location}
                                {p.location && p.receivedBy ? ` at ${p.location}` : ''} · by {p.doneBy}
                              </span>
                            )}
                          </div>
                          {p.status === 'planned' && mine && <HandOver r={r} item={i} part={p} />}
                          {p.status === 'planned' && !mine && (
                            <div className="text-xs text-mute">
                              {p.source === 'purchase'
                                ? !p.purchaseItemId
                                  ? 'Waiting for the draft order.'
                                  : purchaseAtStore(r, p, orders) > 0
                                    ? `${purchaseAtStore(r, p, orders)} at the store, waiting to be handed over.`
                                    : ['ordered', 'partial'].includes(orders[p.purchaseItemId]?.poStatus || '')
                                      ? 'Ordered, on the way.'
                                      : 'On a draft order. Purchase will place it.'
                                : 'Being arranged by the Department Admin.'}
                            </div>
                          )}
                          {p.status === 'done' && i.returnRequired && p.source !== 'walkie' && (
                            <ReturnControl r={r} item={i} part={p} canRecord={canRecordReturn} />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {!canDecideArrangement && parts.length === 0 && (
                    <div className="text-sm text-mute">
                      {i.name}: waiting for Department Admin to choose stock, purchase, or{' '}
                      {i.kind === 'radio' ? 'the radio pool' : 'another source'}.
                    </div>
                  )}
                </section>
              );
            })}
            {r.status === 'fulfilled' &&
              (r.confirmedAt ? (
                <div className="flex items-center gap-2 text-sm text-emerald-300">
                  <Check size={16} />
                  Closed
                  {r.confirmedBy
                    ? ` · ${r.confirmedBy === 'Closed automatically' ? 'automatically' : `confirmed by ${r.confirmedBy}`}`
                    : ''}{' '}
                  on {fmtDate(r.confirmedAt)}.
                </div>
              ) : canConfirm(r) ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 print:hidden">
                  <span className="text-sm text-emerald-200">
                    Everything approved has been handed over. Did you receive it all? It closes by itself 3 days after
                    the hand-over.
                  </span>
                  <button className={btnPrimary} disabled={confirmBusy} onClick={confirm}>
                    <Check size={14} />
                    {confirmBusy ? 'Saving…' : 'Confirm and close'}
                  </button>
                </div>
              ) : (
                <p className="text-xs text-mute">
                  Handed over. Waiting for {r.requesterName} to confirm; it closes by itself 3 days after the hand-over.
                </p>
              ))}
            <Err msg={confirmError} />
          </div>
        )}
      </div>
    </Card>
  );
};
