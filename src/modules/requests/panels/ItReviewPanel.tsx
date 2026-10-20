import React, { useEffect, useState } from 'react';
import { Check, X, ArrowUpRight } from 'lucide-react';
import { Card, Field, btnGhost, btnPrimary, inputCls } from '../../../components/ui';
import { useInventory } from '../../inventory';
import { useRequests } from '../RequestsContext';
import type { Availability } from '../RequestsContext';
import type { Req, ReqItem } from '../types';
import { productKey } from './FulfilmentPanel';
import { Err } from './shared';

// ── IT Department Head: approve with a budget, reject, or escalate ──────────────────────────────
export const ItReviewPanel: React.FC<{ r: Req }> = ({ r }) => {
  const { itDecide, loadAvailability } = useRequests();
  const inventory = useInventory();
  const [note, setNote] = useState('');
  const [budgets, setBudgets] = useState<Record<string, string>>(() =>
    Object.fromEntries(r.items.map(i => [i.id, i.budgetRate == null ? '0' : String(i.budgetRate)])),
  );
  const [miscItems, setMiscItems] = useState(r.miscItems || '');
  const [miscBudget, setMiscBudget] = useState(r.miscBudget ? String(r.miscBudget) : '');
  const [approvedQty, setApprovedQty] = useState<Record<string, string>>(() =>
    Object.fromEntries(r.items.map(i => [i.id, String(i.approved ?? i.requested)])),
  );
  const [cutReason, setCutReason] = useState<Record<string, string>>(() =>
    Object.fromEntries(r.items.map(i => [i.id, i.cutReason || ''])),
  );
  const [stockQty, setStockQty] = useState<Record<string, string>>(() =>
    Object.fromEntries(r.items.map(i => [i.id, ''])),
  );
  const [availability, setAvailability] = useState<Record<string, Availability>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    let on = true;
    loadAvailability().then(a => {
      if (on) setAvailability(a);
    });
    return () => {
      on = false;
    };
  }, [loadAvailability]);
  const qtyFor = (i: ReqItem) => Math.max(0, Math.min(i.requested, Math.floor(Number(approvedQty[i.id]) || 0)));
  const lineTotal = (item: ReqItem) => qtyFor(item) * (Number(budgets[item.id]) || 0);
  const total = r.items.reduce((sum, item) => sum + lineTotal(item), 0) + (Number(miscBudget) || 0);
  const matchingItems = (item: ReqItem) =>
    inventory.allItems.filter(
      it =>
        (!r.departmentId || it.departmentId === r.departmentId) &&
        (item.inventoryItemId ? it.id === item.inventoryItemId : productKey(it.name) === productKey(item.name)),
    );
  const go = async (action: 'approve' | 'escalate' | 'reject') => {
    if (action === 'reject' && !note.trim()) return setErr('Say why you are rejecting it.');
    if (action !== 'reject') {
      if (r.items.every(i => qtyFor(i) === 0)) return setErr('Approve at least one item, or reject the request.');
      const cut = r.items.find(i => qtyFor(i) < i.requested && !(cutReason[i.id] || '').trim());
      if (cut) return setErr(`Add a reason for reducing ${cut.name}.`);
      const missing = r.items.find(
        i =>
          qtyFor(i) > 0 &&
          (budgets[i.id] === '' || !Number.isFinite(Number(budgets[i.id])) || Number(budgets[i.id]) < 0),
      );
      if (missing) return setErr(`Enter the item budget for ${missing.name}. Zero is allowed.`);
      const unconfirmedArrangement = r.items.find(i => i.kind !== 'radio' && qtyFor(i) > 0 && stockQty[i.id] === '');
      if (unconfirmedArrangement)
        return setErr(
          `Confirm the stock amount for ${unconfirmedArrangement.name}. Enter 0 if none will come from stock.`,
        );
      if (miscBudget !== '' && (!Number.isFinite(Number(miscBudget)) || Number(miscBudget) < 0))
        return setErr('Miscellaneous addition cannot be negative.');
      const invalidStock = r.items.find(i => {
        const qty = Math.max(0, Math.floor(Number(stockQty[i.id]) || 0));
        const id = matchingItems(i)[0]?.id || '';
        return qty > qtyFor(i) || (qty > 0 && (!id || qty > (availability[id]?.available ?? 0)));
      });
      if (invalidStock)
        return setErr(`Choose matching stock and stay within its available quantity for ${invalidStock.name}.`);
    }
    setBusy(true);
    setErr('');
    const e = await itDecide(
      r.id,
      action,
      note.trim(),
      miscItems.trim(),
      Number(miscBudget) || 0,
      r.items.map(i => {
        const approved = qtyFor(i);
        const stock = Math.min(approved, Math.max(0, Math.floor(Number(stockQty[i.id]) || 0)));
        const itemId = matchingItems(i)[0]?.id || null;
        return {
          id: i.id,
          approvedQty: approved,
          cutReason: (cutReason[i.id] || '').trim(),
          budgetRate: approved > 0 && budgets[i.id] !== '' ? Number(budgets[i.id]) : null,
          arrangementConfirmed: i.kind === 'radio' || stockQty[i.id] !== '',
          plan: [
            ...(stock > 0 ? [{ source: 'inventory' as const, qty: stock, inventoryItemId: itemId }] : []),
            ...(approved - stock > 0
              ? [
                  {
                    source: i.kind === 'radio' ? ('walkie' as const) : ('purchase' as const),
                    qty: approved - stock,
                    inventoryItemId: i.kind === 'radio' ? null : itemId,
                  },
                ]
              : []),
          ],
        };
      }),
    );
    setBusy(false);
    if (e) setErr(e);
  };
  return (
    <Card title="IT Department Head review" tone="text-amber-300">
      <p className="text-sm text-mute mb-3">
        Set each quantity and budget, then confirm stock for every approved item. Enter 0 when none will come from
        stock; Super Admin receives this saved plan if escalated.
      </p>
      <div className="space-y-2">
        {r.items.map(i => {
          const chosenId = matchingItems(i)[0]?.id || '';
          const stock = Math.max(0, Math.floor(Number(stockQty[i.id]) || 0));
          const available = i.kind === 'radio' ? 0 : chosenId ? (availability[chosenId]?.available ?? 0) : 0;
          return (
            <div key={i.id} className="rounded-lg border border-line bg-raised/15 p-3 sm:p-4">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-ink">{i.name}</div>
                <div className="mt-0.5 text-xs text-mute">
                  Requested: {i.requested} {i.unit} <span className="mx-1 text-faint">·</span> Requester chose:{' '}
                  {i.returnRequired ? 'Return after use' : 'Purchase / keep'}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <div className="min-w-[7rem] flex-1 basis-28">
                  <label htmlFor={`approved-qty-${i.id}`} className="mb-1 block text-xs font-medium text-ink-soft">
                    Approve quantity
                  </label>
                  <input
                    id={`approved-qty-${i.id}`}
                    type="number"
                    min="0"
                    max={i.requested}
                    step="1"
                    className={inputCls + ' tabular-nums'}
                    value={approvedQty[i.id]}
                    onChange={e => setApprovedQty(current => ({ ...current, [i.id]: e.target.value }))}
                  />
                </div>
                {i.kind === 'radio' ? (
                  <div className="min-w-[10rem] flex-[1.5] basis-40">
                    <div className="mb-1 text-xs font-medium text-ink-soft">Walkie pool</div>
                    <div className={inputCls + ' flex items-center text-xs text-mute'}>Assigned by Walkie team</div>
                  </div>
                ) : (
                  <div className="min-w-[10rem] flex-[1.5] basis-40">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <label
                        htmlFor={`stock-qty-${i.id}`}
                        className="whitespace-nowrap text-xs font-medium text-ink-soft"
                      >
                        Use stock
                      </label>
                      <span className="whitespace-nowrap text-[10.5px] text-mute">{available} available</span>
                    </div>
                    <input
                      id={`stock-qty-${i.id}`}
                      aria-label={`Quantity from inventory for ${i.name}`}
                      type="number"
                      min="0"
                      max={Math.min(qtyFor(i), available)}
                      step="1"
                      className={inputCls + ' tabular-nums'}
                      value={stockQty[i.id]}
                      placeholder="Enter 0 if none"
                      onChange={e => setStockQty(current => ({ ...current, [i.id]: e.target.value }))}
                    />
                  </div>
                )}
                <Field
                  className="min-w-[7rem] flex-1 basis-28"
                  label={i.kind === 'radio' ? 'From Walkie pool' : 'To purchase'}
                >
                  <div className={inputCls + ' flex items-center justify-between text-ink'}>
                    <span className="font-semibold tabular-nums">{Math.max(0, qtyFor(i) - stock)}</span>
                    <span className="text-xs text-mute">{i.unit}</span>
                  </div>
                </Field>
                <Field className="min-w-[8rem] flex-1 basis-32" label="Item budget (₹)">
                  <input
                    aria-label={`Item budget for ${i.name}`}
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    className={inputCls + ' text-right tabular-nums'}
                    value={budgets[i.id]}
                    onChange={e => setBudgets(current => ({ ...current, [i.id]: e.target.value }))}
                    placeholder="0.00"
                  />
                </Field>
                <div className="flex min-h-10 min-w-[11rem] flex-1 basis-44 items-center justify-between gap-2 rounded-lg border border-line bg-field px-3 py-2">
                  <span className="text-xs font-medium text-mute">Line total</span>
                  <span className="text-sm font-semibold tabular-nums text-ink">
                    ₹{lineTotal(i).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
              {qtyFor(i) < i.requested && (
                <Field label="Reason for reduced quantity">
                  <input
                    className={inputCls}
                    maxLength={200}
                    value={cutReason[i.id] || ''}
                    onChange={e => setCutReason(current => ({ ...current, [i.id]: e.target.value }))}
                    placeholder="Why is less being approved?"
                  />
                </Field>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px] sm:items-end">
        <Field label="Miscellaneous items">
          <input
            aria-label="Miscellaneous items"
            type="text"
            maxLength={300}
            className={inputCls}
            value={miscItems}
            onChange={e => setMiscItems(e.target.value)}
            placeholder="Add any extra items, if needed"
          />
        </Field>
        <Field label="Miscellaneous addition (₹)">
          <input
            aria-label="Miscellaneous budget addition"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            className={inputCls + ' text-right tabular-nums'}
            value={miscBudget}
            onChange={e => setMiscBudget(e.target.value)}
            placeholder="0.00"
          />
        </Field>
      </div>
      <div className="mt-3 flex items-center justify-between rounded-lg bg-raised/60 px-3 py-2.5">
        <span className="text-xs font-medium text-mute">Estimated request budget</span>
        <strong className="tabular-nums text-ink">
          ₹{total.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </strong>
      </div>
      <div className="mt-3">
        <Field label="Note (required if you reject)">
          <textarea className={inputCls} rows={2} value={note} onChange={e => setNote(e.target.value)} />
        </Field>
      </div>
      <div className="mt-3">
        <Err msg={err} />
      </div>
      <div className="flex flex-wrap gap-2 justify-end mt-3">
        <button className={btnGhost} disabled={busy} onClick={() => go('reject')}>
          <X size={14} />
          Reject
        </button>
        <button className={btnGhost} disabled={busy} onClick={() => go('escalate')}>
          <ArrowUpRight size={14} />
          Arrange & escalate
        </button>
        <button className={btnPrimary} disabled={busy} onClick={() => go('approve')}>
          <Check size={14} />
          {busy ? 'Saving…' : 'Approve & proceed'}
        </button>
      </div>
    </Card>
  );
};
