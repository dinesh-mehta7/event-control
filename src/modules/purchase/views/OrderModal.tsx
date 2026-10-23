import React, { useEffect, useState } from 'react';
import { Check, Edit3, Trash2, Truck } from 'lucide-react';
import { Modal, ConfirmModal, btnGhost, cx, inputCls } from '../../accommodation/ui';
import { useRequests } from '../../requests/RequestsContext';
import { usePurchase } from '../PurchaseContext';
import { INCOMING, PAYABLE, poDue, poTotal } from '../types';
import type { PO, POStatus, Payment, Receipt } from '../types';
import {
  D,
  PayChip,
  PaymentList,
  ReceiptList,
  StatusChip,
  TONE,
  day,
  good,
  money,
  overdue,
  panel,
  primary,
  when,
} from './shared';
import { PayReqRow } from './PaymentsView';
import { ReasonModal } from './PaymentModals';
import { Select } from '../../../components/Select';

const Info: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <div className="text-xs uppercase tracking-wider text-faint">{label}</div>
    <div className="text-sm mt-0.5">{children || <span className="text-faint">—</span>}</div>
  </div>
);

// ---- order detail ------------------------------------------------------------------------------------------
export const OrderModal: React.FC<{
  id: string;
  onClose: () => void;
  onEdit: (id: string) => void;
  onReceive: (id: string) => void;
  onAsk: (id: string) => void;
}> = ({ id, onClose, onEdit, onReceive, onAsk }) => {
  const {
    orders,
    vendors,
    payRequests,
    trackings,
    canManage,
    canReceive,
    setStatus,
    deleteOrder,
    saveDraft,
    fetchReceipts,
    fetchPayments,
    registerTracking,
    closeRemaining,
  } = usePurchase();
  const { requests } = useRequests();
  const o = orders.find(x => x.id === id);
  const [rc, setRc] = useState<Receipt[] | null>(null);
  const [pm, setPm] = useState<Payment[] | null>(null);
  const [ask, setAsk] = useState<'cancel' | 'delete' | 'reject' | 'close' | null>(null);
  const [trackingLine, setTrackingLine] = useState('');
  const [marketplaceOrderNumber, setMarketplaceOrderNumber] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [courierSlug, setCourierSlug] = useState('');
  const [trackingBusy, setTrackingBusy] = useState(false);
  const [placingBusy, setPlacingBusy] = useState(false);
  const [showTrackingForm, setShowTrackingForm] = useState(false);
  const sig = o ? o.paid * 3 + o.items.reduce((a, i) => a + i.qtyReceived, 0) : 0;
  useEffect(() => {
    if (!o) return;
    let on = true;
    fetchReceipts(id).then(r => on && setRc(r));
    if (canManage) fetchPayments(id).then(r => on && setPm(r));
    return () => {
      on = false;
    };
  }, [id, sig]); // eslint-disable-line
  if (!o)
    return (
      <Modal title="Order" dark={D} onClose={onClose}>
        <p className="text-sm text-mute">This order no longer exists.</p>
      </Modal>
    );
  const vendor = vendors.find(v => v.id === o.vendorId);
  const resolvedVendorMode = vendor?.vendorMode || o.vendorMode;
  const readyToPlace =
    !!vendor &&
    !!resolvedVendorMode &&
    vendor.vendorMode === resolvedVendorMode &&
    o.items.length > 0 &&
    o.items.every(item => item.rate > 0);
  const total = poTotal(o);
  const due = poDue(o);
  const mine = payRequests.filter(r => r.poId === o.id);
  const asked = mine.filter(r => r.status === 'pending' || r.status === 'approved').reduce((a, r) => a + r.amount, 0);
  const tickets = Array.from(new Set(o.items.map(i => i.requestNumber).filter(Boolean)));
  const linkedRequests = requests.filter(r => tickets.includes(r.number));
  const approvedRequestBudget = linkedRequests.reduce(
    (sum, r) => sum + r.items.reduce((a, item) => a + (item.budgetAmount || 0), 0) + r.miscBudget,
    0,
  );
  const miscellaneousBudget = linkedRequests.reduce((sum, r) => sum + (r.miscBudget || 0), 0);
  const approvedLineBudget = (poItem: PO['items'][number]) => {
    for (const request of linkedRequests) {
      const part = request.parts.find(p => p.purchaseItemId === poItem.id);
      if (part) return request.items.find(item => item.id === part.itemId)?.budgetAmount ?? null;
    }
    return null;
  };
  const approvedLineBudgets = new Map<string, number>();
  for (const request of linkedRequests) {
    for (const part of request.parts) {
      if (!part.purchaseItemId || !o.items.some(item => item.id === part.purchaseItemId)) continue;
      const budget = request.items.find(item => item.id === part.itemId)?.budgetAmount;
      if (budget != null) approvedLineBudgets.set(`${request.id}:${part.itemId}`, budget);
    }
  }
  const approvedBudgetForOrderLines = Array.from(approvedLineBudgets.values()).reduce((sum, budget) => sum + budget, 0);
  const linkedLineSpend = new Map<string, { budget: number; spent: number }>();
  for (const order of orders) {
    for (const item of order.items.filter(line => tickets.includes(line.requestNumber))) {
      for (const request of linkedRequests) {
        const part = request.parts.find(candidate => candidate.purchaseItemId === item.id);
        if (!part) continue;
        const requestItem = request.items.find(candidate => candidate.id === part.itemId);
        if (!requestItem || requestItem.budgetAmount == null) continue;
        const key = `${request.id}:${requestItem.id}`;
        const current = linkedLineSpend.get(key) || { budget: requestItem.budgetAmount, spent: 0 };
        current.spent += item.qtyOrdered * item.rate;
        linkedLineSpend.set(key, current);
        break;
      }
    }
  }
  const lineBudgetOverage = Array.from(linkedLineSpend.values()).reduce(
    (sum, line) => sum + Math.max(0, line.spent - line.budget),
    0,
  );
  const hasMissingLineBudget = o.items.some(item => approvedLineBudget(item) == null);
  const linkedOrderTotal = orders.reduce(
    (sum, order) =>
      sum +
      order.items
        .filter(item => tickets.includes(item.requestNumber))
        .reduce((orderSum, item) => orderSum + item.qtyOrdered * item.rate, 0),
    0,
  );
  const remainingApprovedBudget = approvedRequestBudget - linkedOrderTotal;
  const act = (s: POStatus, msg: string, note?: string) => setStatus(o.id, s, msg, note);
  const orderTrackings = trackings.filter(t => t.poId === o.id);
  const trackingVendor = vendor?.vendorMode === 'online' ? vendor : undefined;
  const addTracking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!trackingVendor || !trackingLine || (!trackingNumber.trim() && !marketplaceOrderNumber.trim())) return;
    setTrackingBusy(true);
    const ok = await registerTracking({
      poId: o.id,
      purchaseItemId: trackingLine,
      vendorId: trackingVendor.id,
      marketplaceOrderNumber,
      trackingNumber,
      courierSlug,
    });
    setTrackingBusy(false);
    if (ok) {
      setTrackingLine('');
      setMarketplaceOrderNumber('');
      setTrackingNumber('');
      setCourierSlug('');
      setShowTrackingForm(false);
    }
  };
  const placeConfiguredOrder = async () => {
    if (!readyToPlace || !o.vendorId || !resolvedVendorMode) return;
    setPlacingBusy(true);
    const saved = await saveDraft(
      o.id,
      {
        vendorId: o.vendorId,
        vendorMode: resolvedVendorMode,
        expectedDate: o.expectedDate,
        notes: o.notes,
        miscAmount: o.miscAmount,
        rates: Object.fromEntries(o.items.map(item => [item.id, item.rate])),
      },
      true,
    );
    setPlacingBusy(false);
    if (saved) onClose();
  };
  return (
    <Modal title={`${o.number} · ${o.title}`} dark={D} onClose={onClose} xl stickyHeader>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <StatusChip s={o.status} />
        {o.vendorMode && (
          <span className="rounded-full border border-line-strong bg-raised px-2 py-0.5 text-xs font-semibold text-ink-soft">
            {o.vendorMode === 'online' ? 'Online marketplace order' : 'Offline vendor order'}
          </span>
        )}
        <PayChip po={o} />
        {overdue(o) && (
          <span className={cx('text-xs font-semibold px-2 py-0.5 rounded-full border', TONE.bad)}>Overdue</span>
        )}
      </div>
      {o.status === 'rejected' && (
        <div className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          Rejected by {o.approvedBy}: {o.decisionNote || 'no reason given'}
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-5 gap-y-3 rounded-xl border border-line bg-raised/20 px-4 py-3.5 mb-3">
        <Info label="Vendor">
          {vendor ? (
            <>
              {vendor.name}
              {vendor.phone && <div className="text-xs text-mute">{vendor.phone}</div>}
            </>
          ) : null}
        </Info>
        <Info label="Deliver to">{o.deliverTo}</Info>
        <Info label="Expected">{o.expectedDate ? day(o.expectedDate) : ''}</Info>
        <Info label="Approved request budget (incl. misc.)">
          {linkedRequests.length ? money(approvedRequestBudget) : ''}
        </Info>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-mute">
        <span>For {tickets.join(', ') || '—'}</span>
        <span>Created by {o.createdBy || '—'}</span>
        {o.approvedBy && (
          <span>
            Approved by {o.approvedBy}
            {o.approvedAt ? ` · ${day(o.approvedAt.slice(0, 10))}` : ''}
          </span>
        )}
      </div>
      {o.notes && <p className="text-xs text-mute mb-4">Note: {o.notes}</p>}

      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full text-sm min-w-[44rem] table-fixed">
          <colgroup>
            <col className="w-[32%]" />
            <col className="w-[11%]" />
            <col className="w-[10%]" />
            <col className="w-[19%]" />
            <col className="w-[13%]" />
            <col className="w-[15%]" />
          </colgroup>
          <thead>
            <tr className="text-left text-[10.5px] uppercase tracking-wide text-faint border-b border-line">
              <th className="pl-3 py-2.5 font-semibold">Item</th>
              <th className="px-2 py-2.5 font-semibold text-right">Ordered</th>
              <th className="px-2 py-2.5 font-semibold text-right">Received</th>
              <th className="px-2 py-2.5 font-semibold text-right">Approved budget</th>
              <th className="px-2 py-2.5 font-semibold text-right">Rate</th>
              <th className="px-3 py-2.5 font-semibold text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/70">
            {o.items.map(i => (
              <tr key={i.id}>
                <td className="pl-3 py-2.5">
                  <div className="font-medium">{i.name}</div>
                  <div className="text-xs text-mute">
                    {i.requestNumber ? `for ${i.requestNumber}` : ''}
                    {i.inventoryItemId ? `${i.requestNumber ? ' · ' : ''}adds to inventory stock` : ''}
                  </div>
                </td>
                <td className="px-2 py-2.5 text-right tabular-nums whitespace-nowrap">
                  {i.qtyOrdered} <span className="text-xs text-faint">{i.unit}</span>
                </td>
                <td
                  className={cx(
                    'px-2 py-2.5 text-right tabular-nums',
                    i.qtyReceived >= i.qtyOrdered
                      ? 'text-emerald-400'
                      : i.qtyReceived > 0
                        ? 'text-amber-300'
                        : 'text-faint',
                  )}
                >
                  {i.qtyReceived}
                </td>
                <td className="px-2 py-2.5 text-right tabular-nums whitespace-nowrap">
                  {approvedLineBudget(i) == null ? (
                    <span className="text-faint">—</span>
                  ) : (
                    money(approvedLineBudget(i)!)
                  )}
                </td>
                <td className="px-2 py-2.5 text-right tabular-nums whitespace-nowrap">
                  {i.rate ? money(i.rate) : <span className="text-faint">—</span>}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums font-semibold whitespace-nowrap">
                  {i.rate ? money(i.qtyOrdered * i.rate) : <span className="text-faint">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {o.miscAmount > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-line bg-raised/20 px-3 py-2 text-xs text-mute">
          <span>Miscellaneous / installation allowance (included in total)</span>
          <b className="tabular-nums text-ink">{money(o.miscAmount)}</b>
        </div>
      )}
      {linkedRequests.length > 0 && (
        <section className="mt-3 rounded-xl border border-line bg-raised/20 p-3 sm:p-4">
          <div className="text-xs font-semibold text-ink">Budget check</div>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-lg border border-line bg-surface/50 px-3 py-2">
              <div className="text-[10.5px] text-mute">Approved item budget · these lines</div>
              <div className="mt-0.5 text-sm font-semibold tabular-nums">{money(approvedBudgetForOrderLines)}</div>
            </div>
            <div className="rounded-lg border border-line bg-surface/50 px-3 py-2">
              <div className="text-[10.5px] text-mute">Miscellaneous budget</div>
              <div className="mt-0.5 text-sm font-semibold tabular-nums">{money(miscellaneousBudget)}</div>
            </div>
            <div className="rounded-lg border border-line bg-surface/50 px-3 py-2">
              <div className="text-[10.5px] text-mute">This purchase order</div>
              <div className="mt-0.5 text-sm font-semibold tabular-nums">{money(total)}</div>
            </div>
            <div className="rounded-lg border border-line bg-surface/50 px-3 py-2">
              <div className="text-[10.5px] text-mute">All linked POs · approved total</div>
              <div
                className={cx(
                  'mt-0.5 text-sm font-semibold tabular-nums',
                  remainingApprovedBudget < 0 ? 'text-rose-300' : 'text-ink',
                )}
              >
                {remainingApprovedBudget < 0
                  ? `${money(Math.abs(remainingApprovedBudget))} over`
                  : `${money(remainingApprovedBudget)} left`}
              </div>
            </div>
          </div>
          {lineBudgetOverage > 0 ? (
            <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              Linked order amounts are <b className="tabular-nums">{money(lineBudgetOverage)}</b> over the approved item
              budget.{' '}
              {remainingApprovedBudget >= 0 ? (
                <>
                  The linked requests still have <b className="tabular-nums">{money(remainingApprovedBudget)}</b>{' '}
                  against their overall approved total, which includes the separate miscellaneous budget.
                </>
              ) : (
                <>
                  The linked purchase orders are also{' '}
                  <b className="tabular-nums">{money(Math.abs(remainingApprovedBudget))}</b> over the overall approved
                  total.
                </>
              )}
            </div>
          ) : hasMissingLineBudget ? (
            <div className="mt-2 text-xs text-mute">
              Some item lines do not have an approved budget, so the item budget comparison is incomplete.
            </div>
          ) : (
            <div className="mt-2 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
              This order is within the approved item budget.
            </div>
          )}
          <div className="mt-2 text-[11.5px] text-mute">
            Approved request total: {money(approvedRequestBudget)} = item budgets{' '}
            {money(approvedRequestBudget - miscellaneousBudget)} + miscellaneous {money(miscellaneousBudget)}.
          </div>
        </section>
      )}
      <div className="flex flex-wrap justify-end gap-x-6 gap-y-2 mt-3 text-sm">
        <span className="text-mute">
          Total <b className="text-ink tabular-nums">{money(total)}</b>
        </span>
        {PAYABLE.includes(o.status) && (
          <>
            <span className="text-mute">
              Paid <b className="text-emerald-400 tabular-nums">{money(o.paid)}</b>
            </span>
            <span className="text-mute">
              Due <b className="text-amber-300 tabular-nums">{money(due)}</b>
            </span>
          </>
        )}
      </div>

      {o.vendorMode === 'online' &&
        ['ordered', 'partial', 'received'].includes(o.status) &&
        !orderTrackings.length &&
        !showTrackingForm &&
        canManage && (
          <div className="mt-5 flex items-center justify-between gap-3 rounded-xl border border-line bg-raised/20 px-4 py-3">
            <span className="text-xs text-mute">
              Save the marketplace order ID now; connect live delivery updates when the seller shares the courier AWB.
            </span>
            <button
              type="button"
              className={btnGhost(D)}
              onClick={() => {
                if (o.items.length === 1) setTrackingLine(o.items[0].id);
                setShowTrackingForm(true);
              }}
            >
              Add order details
            </button>
          </div>
        )}
      {o.vendorMode === 'online' &&
        ['ordered', 'partial', 'received'].includes(o.status) &&
        (orderTrackings.length > 0 || showTrackingForm) && (
          <section className={cx(panel, 'mt-5 overflow-hidden')}>
            <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
              <div>
                <h3 className="text-sm font-semibold">Order tracking</h3>
                <p className="mt-0.5 text-xs text-mute">
                  Save the marketplace order ID now. Add the courier AWB after dispatch for automatic delivery updates.
                </p>
              </div>
              {canManage && (
                <button
                  type="button"
                  className={btnGhost(D)}
                  onClick={() => {
                    const pending = orderTrackings.find(t => !t.trackingNumber);
                    if (pending) {
                      setTrackingLine(pending.purchaseItemId);
                      setMarketplaceOrderNumber(pending.marketplaceOrderNumber);
                    } else if (o.items.length === 1) setTrackingLine(o.items[0].id);
                    setShowTrackingForm(v => !v);
                  }}
                >
                  {showTrackingForm
                    ? 'Close'
                    : orderTrackings.some(t => !t.trackingNumber)
                      ? 'Add courier AWB'
                      : 'Add order details'}
                </button>
              )}
            </div>
            {canManage && showTrackingForm && (
              <form
                onSubmit={addTracking}
                className="grid gap-2 border-b border-line p-3 sm:grid-cols-2 xl:grid-cols-6"
              >
                <div className={cx(inputCls(D), 'flex items-center font-medium')} aria-label="Online vendor">
                  {trackingVendor?.name || 'PO vendor not set'}
                </div>
                <Select
                  aria-label="Purchase item"
                  className={inputCls(D)}
                  value={trackingLine}
                  onChange={e => setTrackingLine(e.target.value)}
                >
                  <option value="">Choose item</option>
                  {o.items.map(item => (
                    <option key={item.id} value={item.id}>
                      {item.name} · {item.qtyOrdered} {item.unit}
                    </option>
                  ))}
                </Select>
                <input
                  aria-label="Marketplace order ID"
                  className={inputCls(D)}
                  value={marketplaceOrderNumber}
                  onChange={e => setMarketplaceOrderNumber(e.target.value)}
                  placeholder="Marketplace order ID"
                />
                <input
                  aria-label="Courier tracking number or AWB (optional until dispatch)"
                  className={inputCls(D)}
                  value={trackingNumber}
                  onChange={e => setTrackingNumber(e.target.value)}
                  placeholder="Courier tracking no. / AWB (after dispatch)"
                />
                <input
                  aria-label="Courier slug (optional)"
                  className={inputCls(D)}
                  value={courierSlug}
                  onChange={e => setCourierSlug(e.target.value)}
                  placeholder="Courier (optional)"
                />
                <button
                  className={primary}
                  disabled={
                    trackingBusy ||
                    !trackingVendor ||
                    !trackingLine ||
                    (!trackingNumber.trim() && !marketplaceOrderNumber.trim())
                  }
                >
                  {trackingBusy ? 'Saving…' : trackingNumber.trim() ? 'Connect live tracking' : 'Save order ID'}
                </button>
              </form>
            )}
            {!!orderTrackings.length && (
              <ul className="divide-y divide-line/70">
                {orderTrackings.map(t => {
                  const item = o.items.find(i => i.id === t.purchaseItemId);
                  const latest = [...t.checkpoints].sort((a, b) =>
                    String(b.checkpoint_time || '').localeCompare(String(a.checkpoint_time || '')),
                  )[0];
                  return (
                    <li key={t.id} className="px-4 py-3 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-semibold text-ink">
                          {item?.name || 'Order item'} ·{' '}
                          {t.marketplace === 'other'
                            ? 'Marketplace'
                            : t.marketplace[0].toUpperCase() + t.marketplace.slice(1)}
                          {t.marketplaceOrderNumber && (
                            <span className="ml-2 font-normal text-mute">Order {t.marketplaceOrderNumber}</span>
                          )}
                        </div>
                        <span className="rounded-full bg-blue-500/10 px-2 py-1 font-semibold text-blue-300">
                          {t.subStatus || t.status}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-mute">
                        {t.marketplaceOrderNumber && <span>Marketplace order ID: {t.marketplaceOrderNumber}</span>}
                        {t.trackingNumber ? (
                          <span>
                            {t.courierSlug || 'Auto-detected courier'} · AWB {t.trackingNumber}
                          </span>
                        ) : (
                          <span>Waiting for seller to dispatch and share the courier AWB</span>
                        )}
                        {t.estimatedDelivery && <span>Expected {day(t.estimatedDelivery)}</span>}
                        {t.trackingUrl && (
                          <a
                            className="text-blue-300 hover:underline"
                            href={t.trackingUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Carrier tracking
                          </a>
                        )}
                      </div>
                      {latest && (
                        <div className="mt-2 text-ink-soft">
                          Latest: {latest.message || latest.tag || t.status}
                          {latest.location ? ` · ${latest.location}` : ''}
                          {latest.checkpoint_time ? ` · ${when(latest.checkpoint_time)}` : ''}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}

      {canManage && mine.length > 0 && (
        <div className="mt-6">
          <div className="text-xs font-semibold text-mute mb-1">Payment requests</div>
          <ul className={cx(panel, 'overflow-hidden divide-y divide-line/70')}>
            {mine.map(r => (
              <PayReqRow key={r.id} r={r} />
            ))}
          </ul>
        </div>
      )}
      {(rc === null || rc.length > 0) && (
        <div className="mt-6">
          <div className="text-xs font-semibold text-mute mb-1">Goods received</div>
          <div className={cx(panel, 'overflow-hidden')}>
            <ReceiptList rows={rc} empty="" showPo={false} />
          </div>
        </div>
      )}
      {canManage && (pm === null || pm.length > 0) && (
        <div className="mt-5">
          <div className="text-xs font-semibold text-mute mb-1">Payments made</div>
          <div className={cx(panel, 'overflow-hidden')}>
            <PaymentList rows={pm} empty="" showPo={false} />
          </div>
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-line pt-3">
        {canManage && ['draft', 'pending', 'rejected'].includes(o.status) && (
          <button className={btnGhost(D)} onClick={() => onEdit(o.id)}>
            <Edit3 className="w-3.5 h-3.5" />
            Vendor and rates
          </button>
        )}
        {canManage && ['draft', 'pending', 'rejected'].includes(o.status) && (
          <button className={primary} disabled={placingBusy || !readyToPlace} onClick={placeConfiguredOrder}>
            <Check className="w-4 h-4" />
            {placingBusy ? 'Placing…' : 'Place order'}
          </button>
        )}
        {canManage && o.status === 'approved' && (
          <button className={primary} onClick={() => act('ordered', 'Marked as ordered.')}>
            I have placed the order
          </button>
        )}
        {canManage && o.status === 'partial' && (
          <button className={cx(btnGhost(D), 'text-amber-300')} onClick={() => setAsk('close')}>
            Close the rest
          </button>
        )}
        {canReceive && INCOMING.includes(o.status) && (
          <button className={good} onClick={() => onReceive(o.id)}>
            <Truck className="w-4 h-4" />
            Arrived at store
          </button>
        )}
        {canManage && PAYABLE.includes(o.status) && due - asked > 0.009 && (
          <button className={btnGhost(D)} onClick={() => onAsk(o.id)}>
            Ask for a payment
          </button>
        )}
        {canManage &&
          ['draft', 'pending', 'approved', 'rejected', 'ordered'].includes(o.status) &&
          !o.items.some(i => i.qtyReceived > 0) && (
            <button className={cx(btnGhost(D), 'text-rose-400')} onClick={() => setAsk('cancel')}>
              Cancel order
            </button>
          )}
        {canManage && ['draft', 'rejected', 'cancelled'].includes(o.status) && (
          <button
            className={cx(btnGhost(D), 'text-rose-400')}
            onClick={() => setAsk('delete')}
            aria-label="Delete order"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {ask === 'reject' && (
        <ReasonModal
          title="Reject this order?"
          body="Purchase sees your reason, fixes the rates or the vendor, and sends it again."
          confirm="Reject order"
          onSubmit={n =>
            act('rejected', 'Order rejected.', n).then(ok => {
              if (ok) onClose();
              return ok;
            })
          }
          onClose={() => setAsk(null)}
        />
      )}
      {ask === 'close' && (
        <ReasonModal
          title="Close the rest of this order?"
          body={`Keeps what arrived (${o.items
            .filter(i => i.qtyReceived < i.qtyOrdered)
            .map(i => `${i.qtyReceived} of ${i.qtyOrdered} ${i.name}`)
            .join(
              ', ',
            )}). The rest will not come: the order total and the approved quantities on the requests are reduced, and the requesters are told.`}
          confirm="Close the rest"
          onSubmit={reason =>
            closeRemaining(o.id, reason).then(ok => {
              if (ok) onClose();
              return ok;
            })
          }
          onClose={() => setAsk(null)}
        />
      )}
      {ask === 'cancel' && (
        <ConfirmModal
          dark={D}
          title="Cancel this order?"
          body="The order is closed. Its items go back to the buy list so they can be ordered again, and the requesters are told."
          confirmLabel="Cancel order"
          onConfirm={() => {
            act('cancelled', 'Order cancelled.');
            setAsk(null);
          }}
          onClose={() => setAsk(null)}
        />
      )}
      {ask === 'delete' && (
        <ConfirmModal
          dark={D}
          title={`Delete ${o.number}?`}
          body="The order is removed. Its items go back to the buy list."
          confirmLabel="Delete"
          onConfirm={() => {
            deleteOrder(o.id).then(ok => ok && onClose());
          }}
          onClose={() => setAsk(null)}
        />
      )}
    </Modal>
  );
};
