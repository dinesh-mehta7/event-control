import React, { useEffect, useMemo, useState } from 'react';
import { FileText } from 'lucide-react';
import { cx } from '../../accommodation/ui';
import { todayStr } from '../../accommodation/dates';
import { inr } from '../../../views/orgData';
import { usePurchase } from '../PurchaseContext';
import { useInventory } from '../../inventory';
import { INCOMING, PAYABLE, STATUS, payModeLabel, poDue, poTotal } from '../types';
import type { PO, POStatus, Payment, Receipt, VendorMode } from '../types';
import { supabase } from '../../walkie/lib/supabaseClient';

// Requests, Orders, Receiving and Payments are one flow now. This file holds the buying half of it: the buy list,
// orders, receiving, vendors and payments. The Requests screen shows them as its tabs.
export const D = true;

export const panel = 'rounded-xl border border-line bg-surface/50';

export const TONE: Record<string, string> = {
  ok: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  warn: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  bad: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  info: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  mute: 'bg-raised text-mute border-line-strong',
};

export const primary =
  'inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold bg-blue-600 hover:bg-blue-500 text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:opacity-50 disabled:cursor-not-allowed';

export const good =
  'inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed';

export const money = (n: number) => inr(Math.round(n * 100) / 100);

export const when = (s: string) =>
  new Date(s).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export const day = (s: string) =>
  s ? new Date(`${s}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

export const vendorModeLabel = (mode?: VendorMode | null) =>
  mode === 'online' ? 'Online marketplace' : mode === 'offline' ? 'Offline vendor' : 'Category needed';

// ---- small shared pieces ---------------------------------------------------
export const Section: React.FC<{ title: string; action?: React.ReactNode; children: React.ReactNode }> = ({
  title,
  action,
  children,
}) => (
  <section className={cx(panel, 'overflow-hidden')}>
    <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-line">
      <h2 className="text-sm font-bold">{title}</h2>
      {action}
    </div>
    {children}
  </section>
);

export const Empty: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="py-10 px-4 text-center text-sm text-faint">{children}</p>
);

export const StatusChip: React.FC<{ s: POStatus }> = ({ s }) => (
  <span className={cx('text-xs font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap', TONE[STATUS[s].tone])}>
    {STATUS[s].label}
  </span>
);

export const PayChip: React.FC<{ po: PO }> = ({ po }) => {
  if (!PAYABLE.includes(po.status)) return null;
  const total = poTotal(po);
  if (total <= 0) return null;
  const [l, t] = po.paid <= 0 ? ['Unpaid', 'warn'] : poDue(po) > 0 ? ['Part paid', 'info'] : ['Paid', 'ok'];
  return (
    <span className={cx('text-xs font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap', TONE[t])}>{l}</span>
  );
};

export const overdue = (po: PO) => INCOMING.includes(po.status) && !!po.expectedDate && po.expectedDate < todayStr();

// Latest receipts / payments, refreshed whenever an order changes.
export const useLedger = <T,>(kind: 'receipts' | 'payments', limit = 300): T[] | null => {
  const { orders, fetchReceipts, fetchPayments } = usePurchase();
  const [rows, setRows] = useState<T[] | null>(null);
  const sig = orders.reduce(
    (a, o) => a + o.paid * 3 + o.items.reduce((b, i) => b + i.qtyReceived * 7, 0) + o.items.length,
    0,
  );
  useEffect(() => {
    let on = true;
    (kind === 'receipts' ? fetchReceipts(undefined, limit) : fetchPayments(undefined, limit)).then((r: any) => {
      if (on) setRows(r);
    });
    return () => {
      on = false;
    };
  }, [kind, limit, sig]); // eslint-disable-line
  return rows;
};

const useLookups = () => {
  const { orders } = usePurchase();
  return useMemo(() => {
    const po = new Map<string, PO>(orders.map(o => [o.id, o] as [string, PO]));
    const line = new Map<string, { name: string; unit: string; requestNumber: string }>();
    orders.forEach(o =>
      o.items.forEach(i => line.set(i.id, { name: i.name, unit: i.unit, requestNumber: i.requestNumber })),
    );
    return { po, line };
  }, [orders]);
};

export const ReceiptList: React.FC<{ rows: Receipt[] | null; empty: string; showPo?: boolean }> = ({
  rows,
  empty,
  showPo = true,
}) => {
  const { po, line } = useLookups();
  const { locationLabel } = useInventory();
  if (rows === null) return <Empty>Loading…</Empty>;
  if (!rows.length) return <Empty>{empty}</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1050px] text-xs">
        <thead className="bg-raised/60 text-left text-[10.5px] uppercase tracking-wide text-mute">
          <tr>
            <th className="px-3 py-2.5 font-semibold">Item</th>
            <th className="px-3 py-2.5 font-semibold">Quantity</th>
            {showPo && <th className="px-3 py-2.5 font-semibold">Purchase order</th>}
            <th className="px-3 py-2.5 font-semibold">Request</th>
            <th className="px-3 py-2.5 font-semibold">Deliver to</th>
            <th className="px-3 py-2.5 font-semibold">Store</th>
            <th className="px-3 py-2.5 font-semibold">Delivered by</th>
            <th className="px-3 py-2.5 font-semibold">Received by</th>
            <th className="px-3 py-2.5 font-semibold">Challan</th>
            <th className="px-3 py-2.5 font-semibold">Received at</th>
            <th className="px-3 py-2.5 font-semibold">Recorded by</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map(r => {
            const item = line.get(r.itemId);
            const order = po.get(r.poId);
            const cell = (value?: string) => value || '—';
            return (
              <tr key={r.id} className="hover:bg-raised/30">
                <td className="px-3 py-2.5 font-semibold text-ink">{item?.name || 'Removed item'}</td>
                <td className="px-3 py-2.5 whitespace-nowrap font-semibold tabular-nums text-emerald-400">
                  +{r.qty} <span className="font-normal text-mute">{item?.unit || 'pcs'}</span>
                </td>
                {showPo && (
                  <td className="px-3 py-2.5 whitespace-nowrap font-mono text-blue-300">{cell(order?.number)}</td>
                )}
                <td className="px-3 py-2.5 whitespace-nowrap">{cell(item?.requestNumber)}</td>
                <td className="px-3 py-2.5">{cell(order?.deliverTo)}</td>
                <td className="px-3 py-2.5">{r.location ? locationLabel(r.location) : '—'}</td>
                <td className="px-3 py-2.5">{cell(r.givenBy)}</td>
                <td className="px-3 py-2.5">{cell(r.receivedBy)}</td>
                <td className="px-3 py-2.5">{cell(r.challan)}</td>
                <td className="px-3 py-2.5 whitespace-nowrap">{when(r.doneAt)}</td>
                <td className="px-3 py-2.5">{cell(r.doneBy)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export const PaymentList: React.FC<{ rows: Payment[] | null; empty: string; showPo?: boolean }> = ({
  rows,
  empty,
  showPo = true,
}) => {
  const { po } = useLookups();
  if (rows === null) return <Empty>Loading…</Empty>;
  if (!rows.length) return <Empty>{empty}</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] text-xs">
        <thead className="bg-raised/40 text-left text-[10.5px] uppercase tracking-wide text-mute">
          <tr>
            {[
              'Amount',
              ...(showPo ? ['Purchase order'] : []),
              'Method',
              'Reference',
              'Paid by',
              'Note',
              'Documents',
              'Date',
              'Recorded by',
            ].map((heading, index) => (
              <th key={index} className="px-3 py-2.5 font-semibold">
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line/70">
          {rows.map(r => {
            const o = po.get(r.poId);
            return (
              <tr key={r.id} className="hover:bg-raised/30">
                <td className="px-3 py-2.5 whitespace-nowrap font-bold tabular-nums">{money(r.amount)}</td>
                {showPo && <td className="px-3 py-2.5 whitespace-nowrap">{o ? `${o.number} · ${o.title}` : '—'}</td>}
                <td className="px-3 py-2.5 whitespace-nowrap">{payModeLabel(r.mode)}</td>
                <td className="px-3 py-2.5 whitespace-nowrap">{r.ref || '—'}</td>
                <td className="px-3 py-2.5 whitespace-nowrap">{r.paidBy || '—'}</td>
                <td className="px-3 py-2.5">{r.note || '—'}</td>
                <td className="px-3 py-2.5">
                  <div className="flex gap-2">
                    {r.billPath && <PaymentAttachment path={r.billPath} label="Bill" />}
                    {r.proofPath && <PaymentAttachment path={r.proofPath} label="Proof" />}
                    {!r.billPath && !r.proofPath && '—'}
                  </div>
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap">{when(r.doneAt)}</td>
                <td className="px-3 py-2.5 whitespace-nowrap">{r.doneBy || '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

const PaymentAttachment: React.FC<{ path: string; label: string }> = ({ path, label }) => {
  const [busy, setBusy] = useState(false);
  const open = async () => {
    setBusy(true);
    const { data, error } = await supabase.storage.from('purchase-payment-documents').createSignedUrl(path, 60);
    setBusy(false);
    if (error || !data?.signedUrl) return;
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => void open()}
      className="inline-flex items-center gap-1 text-blue-300 hover:text-blue-200 disabled:opacity-60"
    >
      <FileText className="h-3 w-3" />
      {busy ? 'Opening…' : label}
    </button>
  );
};

// Purchase-order workflow pages: Place order → Shipment waiting → Confirmed → Automated status → Delivered.
export const TRACKING_STAGES = [
  { id: 'place', label: 'Place order' },
  { id: 'waiting', label: 'Shipment waiting' },
  { id: 'confirmed', label: 'Confirmed' },
  { id: 'automatic', label: 'Automated status' },
  { id: 'delivered', label: 'Delivered' },
] as const;

export type TrackingStage = (typeof TRACKING_STAGES)[number]['id'];
