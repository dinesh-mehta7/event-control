import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ClipboardList,
  Edit3,
  FileText,
  Plus,
  Search,
  ShoppingCart,
  Trash2,
  Truck,
  Wallet,
  X,
} from 'lucide-react';
import { Modal, ConfirmModal, btnGhost, cx, inputCls, labelCls } from '../accommodation/ui';
import { todayStr } from '../accommodation/dates';
import { inr } from '../../views/orgData';
import { useRequests } from '../requests/RequestsContext';
import { STATUS_LABEL as REQUEST_STATUS_LABEL, unlinkedPurchaseParts } from '../requests/types';
import { usePurchase } from './PurchaseContext';
import type { VendorInput } from './PurchaseContext';
import { useInventory } from '../inventory';
import { INCOMING, PAYABLE, PAYREQ, PAY_MODES, STATUS, payModeLabel, poDue, poTotal, poUnitsLeft } from './types';
import type { PO, POStatus, Payment, PaymentRequest, Receipt, Vendor, VendorMode } from './types';
import { supabase } from '../walkie/lib/supabaseClient';
import { useWalkie } from '../walkie';
import { digitsOnly, phoneInputProps } from '../../lib/phone';

// Requests, Orders, Receiving and Payments are one flow now. This file holds the buying half of it: the buy list,
// orders, receiving, vendors and payments. The Requests screen shows them as its tabs.
const D = true;
const panel = 'rounded-xl border border-line bg-surface/50';
const TONE: Record<string, string> = {
  ok: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  warn: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  bad: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  info: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  mute: 'bg-raised text-mute border-line-strong',
};
const primary =
  'inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold bg-blue-600 hover:bg-blue-500 text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:opacity-50 disabled:cursor-not-allowed';
const good =
  'inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed';
const money = (n: number) => inr(Math.round(n * 100) / 100);
const when = (s: string) =>
  new Date(s).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const day = (s: string) =>
  s ? new Date(`${s}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const vendorModeLabel = (mode?: VendorMode | null) =>
  mode === 'online' ? 'Online marketplace' : mode === 'offline' ? 'Offline vendor' : 'Category needed';

export type DeskView = 'buy' | 'tracking' | 'orders' | 'receiving' | 'vendors' | 'payments';

// ---- small shared pieces ---------------------------------------------------
const Section: React.FC<{ title: string; action?: React.ReactNode; children: React.ReactNode }> = ({
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
const Empty: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="py-10 px-4 text-center text-sm text-faint">{children}</p>
);
const Stat: React.FC<{ label: string; value: React.ReactNode; dot?: string; onClick?: () => void }> = ({
  label,
  value,
  dot,
  onClick,
}) => (
  <button onClick={onClick} className={cx(panel, 'px-4 py-3.5 text-left hover:bg-raised/40 transition-colors')}>
    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-mute">
      {dot && <span className={cx('w-2 h-2 rounded-full', dot)} />}
      {label}
    </div>
    <div className="text-2xl font-bold mt-1 tabular-nums">{value}</div>
  </button>
);
const StatusChip: React.FC<{ s: POStatus }> = ({ s }) => (
  <span className={cx('text-xs font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap', TONE[STATUS[s].tone])}>
    {STATUS[s].label}
  </span>
);
const PayChip: React.FC<{ po: PO }> = ({ po }) => {
  if (!PAYABLE.includes(po.status)) return null;
  const total = poTotal(po);
  if (total <= 0) return null;
  const [l, t] = po.paid <= 0 ? ['Unpaid', 'warn'] : poDue(po) > 0 ? ['Part paid', 'info'] : ['Paid', 'ok'];
  return (
    <span className={cx('text-xs font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap', TONE[t])}>{l}</span>
  );
};
const overdue = (po: PO) => INCOMING.includes(po.status) && !!po.expectedDate && po.expectedDate < todayStr();

// Latest receipts / payments, refreshed whenever an order changes.
const useLedger = <T,>(kind: 'receipts' | 'payments', limit = 300): T[] | null => {
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

const ReceiptList: React.FC<{ rows: Receipt[] | null; empty: string; showPo?: boolean }> = ({
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

const PaymentList: React.FC<{ rows: Payment[] | null; empty: string; showPo?: boolean }> = ({
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

// ---- views -----------------------------------------------------------------
const FILTERS: { key: POStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'pending', label: 'Ready to place' },
  { key: 'approved', label: 'Approved' },
  { key: 'ordered', label: 'Ordered' },
  { key: 'partial', label: 'Partly received' },
  { key: 'received', label: 'Received' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'cancelled', label: 'Cancelled' },
];

const OrdersView: React.FC<{
  filter: POStatus | 'all';
  setFilter: (f: POStatus | 'all') => void;
  open: (id: string) => void;
}> = ({ filter, setFilter, open }) => {
  const { orders, vendorName, canManage, loading } = usePurchase();
  const [q, setQ] = useState('');
  const count = (k: POStatus | 'all') => (k === 'all' ? orders.length : orders.filter(o => o.status === k).length);
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return orders.filter(
      o =>
        (filter === 'all' || o.status === filter) &&
        (!t ||
          o.number.toLowerCase().includes(t) ||
          o.title.toLowerCase().includes(t) ||
          vendorName(o.vendorId).toLowerCase().includes(t) ||
          o.requestedBy.toLowerCase().includes(t)),
    );
  }, [orders, filter, q, vendorName]);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search className="absolute left-3 top-3 h-4 w-4 text-faint" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search PO no., title, vendor…"
            aria-label="Search orders"
            className={cx(inputCls(D), 'pl-9')}
          />
        </div>
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-1" role="group" aria-label="Filter by status">
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            aria-pressed={filter === f.key}
            className={cx(
              'px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap border transition-colors',
              filter === f.key
                ? 'bg-blue-600 border-blue-500 text-white'
                : 'border-line-strong text-mute hover:bg-raised',
            )}
          >
            {f.label} <span className="opacity-70 tabular-nums">{count(f.key)}</span>
          </button>
        ))}
      </div>
      <section className={cx(panel, 'overflow-hidden')}>
        {rows.length === 0 ? (
          <Empty>
            {loading
              ? 'Loading…'
              : orders.length === 0
                ? canManage
                  ? 'No orders yet. Build one from the Buy list.'
                  : 'No orders yet.'
                : 'No orders match.'}
          </Empty>
        ) : (
          <ul className="divide-y divide-line/70">
            {rows.map(o => (
              <li key={o.id}>
                <button
                  onClick={() => open(o.id)}
                  className="w-full text-left px-4 py-3.5 hover:bg-raised/40 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-2 md:gap-4"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-blue-400 font-bold">{o.number}</span>
                      <span className="font-semibold text-sm">{o.title}</span>
                      <StatusChip s={o.status} />
                      {o.vendorMode && (
                        <span className="text-[10.5px] font-semibold text-mute">{vendorModeLabel(o.vendorMode)}</span>
                      )}
                      <PayChip po={o} />
                    </div>
                    <div className="text-xs text-mute mt-1">
                      {o.vendorId ? vendorName(o.vendorId) : 'No vendor yet'} · {o.items.length} line
                      {o.items.length === 1 ? '' : 's'}
                      {o.deliverTo ? ` · ${o.deliverTo}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-5 shrink-0 text-right">
                    <div className="text-xs">
                      <div className="text-faint">Expected</div>
                      <div className={overdue(o) ? 'text-rose-400 font-semibold' : 'text-ink-soft'}>
                        {day(o.expectedDate)}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs uppercase text-faint">Total</div>
                      <div className="font-bold tabular-nums">{money(poTotal(o))}</div>
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};

const VendorsView: React.FC = () => {
  const { vendors, orders, canManage, addVendor, updateVendor, deleteVendor } = usePurchase();
  const { requests } = useRequests();
  const [form, setForm] = useState<Vendor | 'new' | null>(null);
  const [del, setDel] = useState<Vendor | null>(null);
  const stat = (id: string) => {
    const os = orders.filter(o => o.vendorId === id && o.status !== 'cancelled' && o.status !== 'rejected');
    return { orders: os, count: os.length, spend: os.reduce((a, o) => a + poTotal(o), 0) };
  };
  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        {canManage && (
          <button className={primary} onClick={() => setForm('new')}>
            <Plus className="w-4 h-4" />
            Add vendor
          </button>
        )}
      </div>
      <section className={cx(panel, 'overflow-x-auto')}>
        {vendors.length === 0 ? (
          <Empty>No vendors yet.</Empty>
        ) : (
          <table className="w-full min-w-[1250px] text-xs">
            <thead className="bg-raised/40 text-left text-[10.5px] uppercase tracking-wide text-mute">
              <tr>
                {[
                  'Vendor',
                  'Category',
                  'Contact person',
                  'Phone',
                  'Email',
                  'Total orders',
                  'Total spend',
                  'Requests · status',
                  'Address',
                  '',
                ].map((heading, i) => (
                  <th key={i} className="px-3 py-2.5 font-semibold">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70">
              {vendors.map(v => {
                const s = stat(v.id);
                const linked = new Map<string, string>();
                s.orders.forEach(order =>
                  order.items.forEach(item => {
                    if (!item.requestNumber || linked.has(item.requestNumber)) return;
                    const request = requests.find(r => r.number === item.requestNumber);
                    linked.set(
                      item.requestNumber,
                      request ? REQUEST_STATUS_LABEL[request.status] : STATUS[order.status]?.label || order.status,
                    );
                  }),
                );
                return (
                  <tr key={v.id} className="hover:bg-raised/30">
                    <td className="px-3 py-3 font-semibold text-ink">{v.name}</td>
                    <td className="px-3 py-3 whitespace-nowrap">{vendorModeLabel(v.vendorMode)}</td>
                    <td className="px-3 py-3">{v.contact || '—'}</td>
                    <td className="px-3 py-3 whitespace-nowrap">{v.phone || '—'}</td>
                    <td className="px-3 py-3">{v.email || '—'}</td>
                    <td className="px-3 py-3 whitespace-nowrap tabular-nums">{s.count}</td>
                    <td className="px-3 py-3 whitespace-nowrap tabular-nums font-semibold">{money(s.spend)}</td>
                    <td className="px-3 py-3 min-w-48">
                      {linked.size ? (
                        <div className="space-y-1">
                          {Array.from(linked, ([number, status]) => (
                            <div key={number} className="whitespace-nowrap">
                              <span className="font-mono text-blue-300">{number}</span>
                              <span className="text-mute"> · {status}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-3 py-3 max-w-56 truncate">{v.address || '—'}</td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        {canManage && (
                          <>
                            <button className={btnGhost(D)} onClick={() => setForm(v)} aria-label={`Edit ${v.name}`}>
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              className={cx(btnGhost(D), 'text-rose-400')}
                              onClick={() => setDel(v)}
                              aria-label={`Delete ${v.name}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
      {form && (
        <VendorForm
          initial={form === 'new' ? null : form}
          onClose={() => setForm(null)}
          onSave={v => (form === 'new' ? addVendor(v) : updateVendor(form.id, v))}
        />
      )}
      {del && (
        <ConfirmModal
          dark={D}
          title={`Delete ${del.name}?`}
          body="Only possible if no order uses this vendor."
          confirmLabel="Delete"
          onConfirm={() => {
            deleteVendor(del.id);
          }}
          onClose={() => setDel(null)}
        />
      )}
    </div>
  );
};

const VendorForm: React.FC<{
  initial: Vendor | null;
  onClose: () => void;
  onSave: (v: VendorInput) => Promise<boolean>;
}> = ({ initial, onClose, onSave }) => {
  const [f, setF] = useState<VendorInput>({
    name: initial?.name || '',
    vendorMode: initial?.vendorMode || '',
    contact: initial?.contact || '',
    phone: initial?.phone || '',
    email: initial?.email || '',
    address: initial?.address || '',
    accountHolder: initial?.accountHolder || '',
    bankName: initial?.bankName || '',
    accountNumber: initial?.accountNumber || '',
    ifsc: initial?.ifsc || '',
    bankBranch: initial?.bankBranch || '',
    upiId: initial?.upiId || '',
    notes: initial?.notes || '',
  });
  const [busy, setBusy] = useState(false);
  const setText = (k: keyof Omit<VendorInput, 'vendorMode'>, v: string) => setF(p => ({ ...p, [k]: v }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const ok = await onSave(f);
    setBusy(false);
    if (ok) onClose();
  };
  const field = (
    id: string,
    label: string,
    k: keyof Omit<VendorInput, 'vendorMode' | 'name'>,
    type = 'text',
    required = false,
  ) => (
    <div>
      <label className={labelCls(D)} htmlFor={id}>
        {label}
        {required && <span className="ml-1 text-rose-300">*</span>}
      </label>
      <input
        id={id}
        required={required}
        type={type}
        inputMode={k === 'accountNumber' ? 'numeric' : undefined}
        {...(type === 'tel' ? phoneInputProps : {})}
        value={f[k]}
        onChange={e => setText(k, type === 'tel' ? digitsOnly(e.target.value) : e.target.value)}
        className={inputCls(D)}
      />
    </div>
  );
  return (
    <Modal title={initial ? 'Edit vendor' : 'Add vendor'} dark={D} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className={labelCls(D)} htmlFor="vn-n">
              Vendor name
            </label>
            <input
              id="vn-n"
              autoFocus
              required
              value={f.name}
              onChange={e => setText('name', e.target.value)}
              className={inputCls(D)}
            />
          </div>
          <div>
            <label className={labelCls(D)} htmlFor="vn-mode">
              Vendor category
            </label>
            <select
              id="vn-mode"
              required
              value={f.vendorMode}
              onChange={e => setF(p => ({ ...p, vendorMode: e.target.value as VendorMode | '' }))}
              className={inputCls(D)}
            >
              <option value="">Choose category…</option>
              <option value="online">Online marketplace</option>
              <option value="offline">Offline / local vendor</option>
            </select>
            <p className="mt-1 text-[10.5px] text-mute">Amazon / Flipkart or local supplier</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {field('vn-c', 'Contact person', 'contact', 'text', f.vendorMode === 'offline')}
          {field('vn-p', 'Phone', 'phone', 'tel', f.vendorMode === 'offline')}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {field('vn-e', 'Email', 'email', 'email')}
          {f.vendorMode === 'offline' && field('vn-a', 'Vendor address', 'address', 'text', true)}
        </div>
        {f.vendorMode === 'offline' && (
          <section className="space-y-3 rounded-lg border border-line bg-raised/30 p-3">
            <div>
              <h3 className="text-xs font-semibold text-ink">Bank details for offline payments</h3>
              <p className="mt-1 text-[10.5px] text-mute">
                Complete the payee and bank information before saving this local vendor.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {field('vn-holder', 'Account holder', 'accountHolder', 'text', true)}
              {field('vn-bank', 'Bank name', 'bankName', 'text', true)}
              {field('vn-account', 'Account number', 'accountNumber', 'text', true)}
              {field('vn-ifsc', 'IFSC code', 'ifsc', 'text', true)}
              {field('vn-branch', 'Bank branch', 'bankBranch', 'text', true)}
              {field('vn-upi', 'UPI ID', 'upiId')}
            </div>
          </section>
        )}
        {field('vn-t', 'Notes', 'notes')}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnGhost(D)}>
            Cancel
          </button>
          <button type="submit" disabled={busy || !f.name.trim()} className={primary}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
};

const ReceivingView: React.FC = () => {
  const { orders, vendorName } = usePurchase();
  const received = orders
    .filter(o => o.items.some(item => item.qtyReceived > 0))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const rows = useLedger<Receipt>('receipts', 300);
  return (
    <div className="space-y-5">
      <Section title={`Received orders (${received.length})`}>
        {received.length === 0 ? (
          <Empty>No orders have been received yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-xs">
              <thead className="bg-raised/40 text-left text-[10.5px] uppercase tracking-wide text-mute">
                <tr>
                  {['Purchase order', 'Request', 'Vendor', 'Items received', 'Quantity received', 'Status'].map(
                    (heading, index) => (
                      <th key={index} className="px-3 py-2.5 font-semibold">
                        {heading}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-line/70">
                {received.map(order => {
                  const items = order.items.filter(item => item.qtyReceived > 0);
                  const requestNos = Array.from(new Set(items.map(item => item.requestNumber).filter(Boolean)));
                  const receivedQty = items.reduce((sum, item) => sum + item.qtyReceived, 0);
                  return (
                    <tr key={order.id} className="hover:bg-raised/30">
                      <td className="px-3 py-2.5 whitespace-nowrap font-mono font-bold text-blue-300">
                        {order.number}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{requestNos.join(', ') || '—'}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{vendorName(order.vendorId)}</td>
                      <td className="px-3 py-2.5">
                        {items.map(item => `${item.name} × ${item.qtyReceived} ${item.unit}`).join(', ')}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap font-semibold tabular-nums text-emerald-300">
                        {receivedQty}
                      </td>
                      <td className="px-3 py-2.5">
                        <StatusChip s={order.status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
      <Section title="Goods received log">
        <ReceiptList rows={rows} empty="Nothing has been received yet." />
      </Section>
    </div>
  );
};

const Info: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <div className="text-xs uppercase tracking-wider text-faint">{label}</div>
    <div className="text-sm mt-0.5">{children || <span className="text-faint">—</span>}</div>
  </div>
);

const ReceiveModal: React.FC<{ id: string; onClose: () => void }> = ({ id, onClose }) => {
  const { orders, receive, userName } = usePurchase();
  const inventory = useInventory();
  const o = orders.find(x => x.id === id);
  const open = (o?.items || []).filter(i => i.qtyOrdered > i.qtyReceived);
  const [qty, setQty] = useState<Record<string, string>>(() =>
    Object.fromEntries(open.map(i => [i.id, String(i.qtyOrdered - i.qtyReceived)])),
  );
  const [givenBy, setGivenBy] = useState('');
  const [receivedBy, setReceivedBy] = useState(userName);
  const [location, setLocation] = useState('');
  const [challan, setChallan] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  if (!o) return null;
  const lines = open.map(i => ({
    itemId: i.id,
    qty: parseInt(qty[i.id] || '0', 10) || 0,
    left: i.qtyOrdered - i.qtyReceived,
    linked: !!i.inventoryItemId,
  }));
  const bad = lines.find(l => l.qty > l.left);
  const any = lines.some(l => l.qty > 0);
  const can = any && !bad && receivedBy.trim() !== '';
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!can) return;
    setBusy(true);
    const ok = await receive(
      o.id,
      lines.map(l => ({ itemId: l.itemId, qty: l.qty })),
      { location, givenBy, receivedBy, challan, note },
    );
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <Modal title={`Receive goods · ${o.number}`} dark={D} onClose={onClose} xl>
      <form onSubmit={submit} className="space-y-4">
        {open.length === 0 ? (
          <p className="text-sm text-mute">Everything on this order has been received.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-sm min-w-[28rem]">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-faint border-b border-line">
                  <th className="pl-3 py-2.5 font-semibold">Item</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Ordered</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Already in</th>
                  <th className="px-3 py-2.5 pr-3 font-semibold text-right w-28">Receive now</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/70">
                {open.map(i => (
                  <tr key={i.id}>
                    <td className="pl-3 py-2.5">
                      <div className="font-medium">{i.name}</div>
                      <div className="text-xs text-emerald-400">
                        {i.inventoryItemId ? 'adds to inventory stock' : 'adds to inventory catalogue on receipt'}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {i.qtyOrdered} <span className="text-xs text-faint">{i.unit}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-mute">{i.qtyReceived}</td>
                    <td className="px-3 py-2 pr-3">
                      <input
                        aria-label={`Receive now: ${i.name}`}
                        inputMode="numeric"
                        value={qty[i.id] ?? ''}
                        onChange={e => setQty(p => ({ ...p, [i.id]: e.target.value.replace(/\D/g, '') }))}
                        className={cx(inputCls(D), 'text-right !py-1.5')}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {bad && (
          <p role="alert" className="text-xs text-rose-400">
            More than is left to receive on one of the lines.
          </p>
        )}
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className={labelCls(D)} htmlFor="rc-l">
              Store location
            </label>
            <select id="rc-l" value={location} onChange={e => setLocation(e.target.value)} className={inputCls(D)}>
              <option value="">Main Store (default)</option>
              {inventory.locations.map(place => (
                <option key={place.id} value={place.id}>
                  {place.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls(D)} htmlFor="rc-g">
              Delivered by (vendor / driver)
            </label>
            <input id="rc-g" value={givenBy} onChange={e => setGivenBy(e.target.value)} className={inputCls(D)} />
          </div>
          <div>
            <label className={labelCls(D)} htmlFor="rc-r">
              Received by *
            </label>
            <input id="rc-r" value={receivedBy} onChange={e => setReceivedBy(e.target.value)} className={inputCls(D)} />
          </div>
          <div>
            <label className={labelCls(D)} htmlFor="rc-c">
              Challan / bill no.
            </label>
            <input id="rc-c" value={challan} onChange={e => setChallan(e.target.value)} className={inputCls(D)} />
          </div>
          <div>
            <label className={labelCls(D)} htmlFor="rc-n">
              Note (optional)
            </label>
            <input id="rc-n" value={note} onChange={e => setNote(e.target.value)} className={inputCls(D)} />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnGhost(D)}>
            Cancel
          </button>
          <button type="submit" disabled={!can || busy} className={good}>
            {busy ? 'Saving…' : 'Record received'}
          </button>
        </div>
      </form>
    </Modal>
  );
};

// ---- record payment ----------------------------------------------------------

// ---- a reason box (reject an order / a payment) ---------------------------------
const ReasonModal: React.FC<{
  title: string;
  body: string;
  confirm: string;
  onSubmit: (note: string) => Promise<boolean>;
  onClose: () => void;
}> = ({ title, body, confirm, onSubmit, onClose }) => {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!note.trim()) return setErr('Please write the reason. The other person will read it.');
    setBusy(true);
    const ok = await onSubmit(note.trim());
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <Modal title={title} dark={D} onClose={onClose}>
      <form onSubmit={go} className="space-y-3">
        <p className="text-sm text-mute">{body}</p>
        <textarea
          autoFocus
          rows={3}
          aria-label="Reason"
          className={inputCls(D)}
          value={note}
          onChange={e => {
            setNote(e.target.value);
            setErr('');
          }}
        />
        {err && (
          <p role="alert" className="text-xs text-rose-400">
            {err}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnGhost(D)}>
            Cancel
          </button>
          <button type="submit" disabled={busy} className={cx(primary, 'bg-rose-600 hover:bg-rose-500')}>
            {busy ? 'Saving…' : confirm}
          </button>
        </div>
      </form>
    </Modal>
  );
};

// ---- Purchase asks for a payment -------------------------------------------------
const AskPayModal: React.FC<{ id: string; onClose: () => void }> = ({ id, onClose }) => {
  const { orders, payRequests, askPayment } = usePurchase();
  const o = orders.find(x => x.id === id);
  const asked = payRequests
    .filter(r => r.poId === id && (r.status === 'pending' || r.status === 'approved'))
    .reduce((a, r) => a + r.amount, 0);
  const left = o ? Math.max(0, Math.round((poDue(o) - asked) * 100) / 100) : 0;
  const [amount, setAmount] = useState(left ? String(left) : '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  if (!o) return null;
  const amt = parseFloat(amount) || 0;
  const problem = amt > left + 0.009 ? `Only ${money(left)} can still be asked for.` : '';
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!(amt > 0) || problem) return;
    setBusy(true);
    const ok = await askPayment(o.id, amt, note.trim());
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <Modal title={`Ask for a payment · ${o.number}`} dark={D} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <div className="rounded-xl border border-line bg-canvas/60 px-4 py-3 text-xs grid grid-cols-3 gap-3 text-center">
          {(
            [
              ['Order total', poTotal(o), ''],
              ['Paid', o.paid, 'text-emerald-400'],
              ['Can still ask', left, 'text-amber-300'],
            ] as const
          ).map(([l, v, c]) => (
            <div key={l}>
              <div className="text-faint">{l}</div>
              <div className={cx('font-bold tabular-nums', c)}>{money(v)}</div>
            </div>
          ))}
        </div>
        <div>
          <label className={labelCls(D)} htmlFor="ap-a">
            Amount (₹)
          </label>
          <input
            id="ap-a"
            autoFocus
            inputMode="decimal"
            value={amount}
            onChange={e => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
            className={inputCls(D)}
          />
        </div>
        <div>
          <label className={labelCls(D)} htmlFor="ap-n">
            What is it for? (advance, balance on delivery…)
          </label>
          <input id="ap-n" value={note} onChange={e => setNote(e.target.value)} className={inputCls(D)} />
        </div>
        <p className="text-xs text-mute">
          Save the payment request here, then record it after the payment is made. No further approval is needed.
        </p>
        {problem && (
          <p role="alert" className="text-xs text-rose-400">
            {problem}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnGhost(D)}>
            Cancel
          </button>
          <button type="submit" disabled={!(amt > 0) || !!problem || busy} className={primary}>
            {busy ? 'Saving…' : 'Save payment request'}
          </button>
        </div>
      </form>
    </Modal>
  );
};

// ---- Purchase pays an approved request -----------------------------------------------
const PayNowModal: React.FC<{ id: string; onClose: () => void }> = ({ id, onClose }) => {
  const { payRequests, orders, vendors, payNow, userName, canPay } = usePurchase();
  const auth: any = useWalkie();
  const r = payRequests.find(x => x.id === id);
  const o = r ? orders.find(x => x.id === r.poId) : undefined;
  const vendor = o?.vendorId ? vendors.find(row => row.id === o.vendorId) : undefined;
  const [mode, setMode] = useState('bank');
  const [ref, setRef] = useState('');
  const [paidBy, setPaidBy] = useState(userName);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [billFile, setBillFile] = useState<File | null>(null);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState('');
  if (!r || !o) return null;
  const uploadFile = async (file: File | null, kind: 'bill' | 'proof') => {
    if (!file) return '';
    const organizationId = auth.currentUser?.organizationId;
    if (!organizationId) throw new Error('Organization could not be identified.');
    const ext =
      file.name
        .split('.')
        .pop()
        ?.toLowerCase()
        .replace(/[^a-z0-9]/g, '') || 'file';
    const path = `${organizationId}/${r.id}/${kind}-${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage
      .from('purchase-payment-documents')
      .upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
    if (error) throw error;
    return path;
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canPay) return;
    setFileError('');
    setBusy(true);
    const uploaded: string[] = [];
    try {
      const billPath = await uploadFile(billFile, 'bill');
      if (billPath) uploaded.push(billPath);
      const proofPath = await uploadFile(proofFile, 'proof');
      if (proofPath) uploaded.push(proofPath);
      const ok = await payNow(r.id, { mode, ref, paidBy, note, billPath, proofPath });
      if (!ok && uploaded.length) await supabase.storage.from('purchase-payment-documents').remove(uploaded);
      if (ok) onClose();
    } catch (error: any) {
      if (uploaded.length) await supabase.storage.from('purchase-payment-documents').remove(uploaded);
      setFileError(error?.message || 'Could not upload the payment attachments.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`Pay · ${o.number}`} dark={D} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          Record the payment of <b className="tabular-nums">{money(r.amount)}</b>
          {r.note ? ` (${r.note})` : ''}.
        </div>
        {vendor?.vendorMode === 'offline' && (
          <section className="rounded-lg border border-line bg-raised/30 p-3">
            <h3 className="text-xs font-semibold text-ink">Offline vendor payment details · {vendor.name}</h3>
            <dl className="mt-2 grid gap-x-4 gap-y-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
              {[
                ['Account holder', vendor.accountHolder],
                ['Account number', vendor.accountNumber],
                ['Bank', vendor.bankName],
                ['IFSC', vendor.ifsc],
                ['Branch', vendor.bankBranch],
                ['UPI ID', vendor.upiId],
                ['Contact', vendor.contact],
                ['Phone', vendor.phone],
                ['Address', vendor.address],
              ]
                .filter(([, value]) => value)
                .map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-[10.5px] text-mute">{label}</dt>
                    <dd className="break-words font-medium text-ink">{value}</dd>
                  </div>
                ))}
            </dl>
          </section>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls(D)} htmlFor="pn-m">
              Paid via
            </label>
            <select id="pn-m" value={mode} onChange={e => setMode(e.target.value)} className={inputCls(D)}>
              {PAY_MODES.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls(D)} htmlFor="pn-r">
              UTR / cheque / voucher no.
            </label>
            <input id="pn-r" autoFocus value={ref} onChange={e => setRef(e.target.value)} className={inputCls(D)} />
          </div>
          <div>
            <label className={labelCls(D)} htmlFor="pn-p">
              Paid by
            </label>
            <input id="pn-p" value={paidBy} onChange={e => setPaidBy(e.target.value)} className={inputCls(D)} />
          </div>
          <div>
            <label className={labelCls(D)} htmlFor="pn-n">
              Note (optional)
            </label>
            <input id="pn-n" value={note} onChange={e => setNote(e.target.value)} className={inputCls(D)} />
          </div>
        </div>
        <div className="rounded-lg border border-line bg-raised/30 p-3">
          <div className="mb-2">
            <h3 className="text-xs font-semibold text-ink">
              Payment attachments <span className="font-normal text-mute">· optional</span>
            </h3>
            <p className="mt-1 text-[10.5px] text-mute">
              Attach a bill, payment proof, or both. PDF, JPG, PNG, or WebP files up to 10 MB each.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={labelCls(D)}>
              Bill
              <input
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                onChange={e => {
                  const file = e.target.files?.[0] || null;
                  if (file && file.size > 10 * 1024 * 1024) {
                    setFileError('Each attachment must be 10 MB or smaller.');
                    e.target.value = '';
                    return;
                  }
                  if (file && !['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
                    setFileError('Choose a PDF, JPG, PNG, or WebP file.');
                    e.target.value = '';
                    return;
                  }
                  setBillFile(file);
                  setFileError('');
                }}
                className="mt-1 block w-full text-xs file:mr-2 file:rounded-md file:border-0 file:bg-raised file:px-2 file:py-1.5 file:text-ink"
              />
            </label>
            <label className={labelCls(D)}>
              Payment proof
              <input
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                onChange={e => {
                  const file = e.target.files?.[0] || null;
                  if (file && file.size > 10 * 1024 * 1024) {
                    setFileError('Each attachment must be 10 MB or smaller.');
                    e.target.value = '';
                    return;
                  }
                  if (file && !['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
                    setFileError('Choose a PDF, JPG, PNG, or WebP file.');
                    e.target.value = '';
                    return;
                  }
                  setProofFile(file);
                  setFileError('');
                }}
                className="mt-1 block w-full text-xs file:mr-2 file:rounded-md file:border-0 file:bg-raised file:px-2 file:py-1.5 file:text-ink"
              />
            </label>
          </div>
          {fileError && (
            <p role="alert" className="mt-2 text-xs text-rose-300">
              {fileError}
            </p>
          )}
        </div>
        {!canPay && (
          <p role="alert" className="text-xs text-rose-300">
            Only Accounts team members can record payments.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnGhost(D)}>
            Cancel
          </button>
          <button type="submit" disabled={busy || !canPay || !!fileError} className={good}>
            {busy ? 'Saving payment…' : 'Record payment'}
          </button>
        </div>
      </form>
    </Modal>
  );
};

// One payment request, with the buttons that fit who is looking at it.
const PayReqRow: React.FC<{ r: PaymentRequest; showOrder?: boolean; open?: (poId: string) => void }> = ({
  r,
  showOrder,
  open,
}) => {
  const { orders, canManage, canPay, withdrawPayment } = usePurchase();
  const [paying, setPaying] = useState(false);
  const o = orders.find(x => x.id === r.poId);
  return (
    <li className="px-4 py-3 flex flex-col md:flex-row md:items-center justify-between gap-2 md:gap-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <b className="tabular-nums">{money(r.amount)}</b>
          <span
            className={cx(
              'text-xs font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap',
              TONE[PAYREQ[r.status].tone],
            )}
          >
            {PAYREQ[r.status].label}
          </span>
          {showOrder && o && (
            <button onClick={() => open?.(o.id)} className="font-mono text-xs text-blue-400 font-bold hover:underline">
              {o.number}
            </button>
          )}
        </div>
        <div className="text-xs text-mute mt-0.5">
          Asked by {r.requestedBy} · {when(r.requestedAt)}
          {r.note ? ` · ${r.note}` : ''}
        </div>
        {r.decisionNote && <div className="text-xs text-mute">Note: {r.decisionNote}</div>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {['pending', 'approved'].includes(r.status) && canPay && (
          <button className={good} onClick={() => setPaying(true)}>
            <Wallet className="w-4 h-4" />
            Pay now
          </button>
        )}
        {['pending', 'approved'].includes(r.status) && canManage && (
          <button className={btnGhost(D)} onClick={() => withdrawPayment(r.id)}>
            Cancel
          </button>
        )}
      </div>
      {paying && <PayNowModal id={r.id} onClose={() => setPaying(false)} />}
    </li>
  );
};

// ---- the buy list: everything approved that the store team said must be bought -------------------------
const BuyListView: React.FC<{ editOrder: (id: string) => void }> = ({ editOrder }) => {
  const { requests } = useRequests();
  const { orders, createOrder, canManage, vendorName } = usePurchase();
  const lines = useMemo(
    () =>
      requests.flatMap(r =>
        unlinkedPurchaseParts(r)
          .map(p => ({ part: p, req: r, item: r.items.find(i => i.id === p.itemId) }))
          .filter(x => !!x.item),
      ) as { part: any; req: any; item: any }[],
    [requests],
  );
  const seenParts = useRef(new Set<string>());
  const createOrderRef = useRef(createOrder);
  createOrderRef.current = createOrder;
  useEffect(() => {
    if (!canManage || !lines.length) return;
    const byRequest = new Map<string, string[]>();
    lines.forEach(line => {
      if (!seenParts.current.has(line.part.id)) {
        const ids = byRequest.get(line.req.id) || [];
        ids.push(line.part.id);
        byRequest.set(line.req.id, ids);
      }
    });
    byRequest.forEach(ids => ids.forEach(id => seenParts.current.add(id)));
    const requestBatches: string[][] = [];
    byRequest.forEach(ids => requestBatches.push(ids));
    void (async () => {
      for (let index = 0; index < requestBatches.length; index++) await createOrderRef.current(requestBatches[index]);
    })();
  }, [lines, canManage]);
  const approvedRequests = useMemo(
    () =>
      requests.filter(request => {
        if (
          request.status !== 'approved' ||
          !request.parts.some(part => part.source === 'purchase' && part.status === 'planned')
        )
          return false;
        const tickets = orders.filter(order =>
          order.items.some(item => item.requestId === request.id || item.requestNumber === request.number),
        );
        return (
          tickets.some(order => ['draft', 'pending', 'rejected'].includes(order.status)) ||
          (!tickets.length && unlinkedPurchaseParts(request).length > 0)
        );
      }),
    [requests, orders],
  );

  return (
    <div className="space-y-5">
      <section className={cx(panel, 'overflow-x-auto')}>
        {approvedRequests.length ? (
          <table className="w-full min-w-[1050px] table-fixed border-x border-line text-[10.5px] xl:min-w-0 xl:text-[11.5px]">
            <colgroup>
              <col className="w-[9%]" />
              <col className="w-[9%]" />
              <col className="w-[10%]" />
              <col className="w-[9%]" />
              <col className="w-[7%]" />
              <col className="w-[8%]" />
              <col className="w-[7%]" />
              <col className="w-[8%]" />
              <col className="w-[8%]" />
              <col className="w-[8%]" />
              <col className="w-[7%]" />
              <col className="w-[10%]" />
            </colgroup>
            <thead className="bg-raised/40 text-left text-[10px] uppercase tracking-wide text-mute xl:text-[10px]">
              <tr>
                {[
                  'Request',
                  'Requester',
                  'Department',
                  'Item',
                  'Qty to order',
                  'Needed by',
                  'PO ticket',
                  'Vendor',
                  'Expected',
                  'Budget',
                  'Status',
                  '',
                ].map((heading, index) => (
                  <th key={index} className="border-r border-line px-1.5 py-1.5 font-bold last:border-r-0">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70">
              {approvedRequests.flatMap(request =>
                request.parts
                  .filter(part => part.source === 'purchase' && part.status === 'planned')
                  .map(part => {
                    const item = request.items.find(row => row.id === part.itemId);
                    const order = orders.find(candidate =>
                      candidate.items.some(line => line.id === part.purchaseItemId && !!part.purchaseItemId),
                    );
                    const canOpen = order && ['draft', 'pending', 'rejected'].includes(order.status);
                    return (
                      <tr key={part.id} className="hover:bg-raised/30">
                        <td className="border-r border-line/70 px-1.5 py-1.5 align-top">
                          <span className="font-mono font-bold text-blue-300">{request.number}</span>
                          <div className="mt-0.5 break-words text-mute">{request.title}</div>
                        </td>
                        <td className="border-r border-line/70 px-1.5 py-1.5 align-top break-words">
                          {request.requesterName}
                        </td>
                        <td className="border-r border-line/70 px-1.5 py-1.5 align-top break-words">
                          {request.departmentName || '—'}
                        </td>
                        <td className="border-r border-line/70 px-1.5 py-1.5 align-top break-words font-medium text-ink">
                          {item?.name || 'Request item'}
                        </td>
                        <td className="border-r border-line/70 px-1.5 py-1.5 align-top tabular-nums">
                          {part.qty} {item?.unit || ''}
                        </td>
                        <td className="border-r border-line/70 px-1.5 py-1.5 align-top">
                          {request.neededBy ? day(request.neededBy) : '—'}
                        </td>
                        <td className="border-r border-line/70 px-1.5 py-1.5 align-top break-words font-mono text-blue-300">
                          {order?.number || (part.purchaseItemId ? '—' : 'Preparing…')}
                        </td>
                        <td className="border-r border-line/70 px-1.5 py-1.5 align-top break-words">
                          {order ? vendorName(order.vendorId) : '—'}
                        </td>
                        <td className="border-r border-line/70 px-1.5 py-1.5 align-top">
                          {order?.expectedDate ? day(order.expectedDate) : '—'}
                        </td>
                        <td className="border-r border-line/70 px-1.5 py-1.5 align-top tabular-nums break-words">
                          {item?.budgetAmount != null ? money(item.budgetAmount) : '—'}
                        </td>
                        <td className="border-r border-line/70 px-1.5 py-1.5 align-top">
                          {order ? <StatusChip s={order.status} /> : <span className="text-mute">Approved</span>}
                        </td>
                        <td className="px-1 py-1.5 text-center align-top">
                          {canOpen && (
                            <button
                              type="button"
                              className={`${btnGhost(D)} !px-1.5 !py-0.5 text-[10px]`}
                              onClick={() => editOrder(order.id)}
                            >
                              Open
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  }),
              )}
            </tbody>
          </table>
        ) : (
          <Empty>No approved requests waiting to be ordered.</Empty>
        )}
      </section>
    </div>
  );
};

// Purchase-order workflow pages: Place order → Shipment waiting → Confirmed → Automated status → Delivered.
const TRACKING_STAGES = [
  { id: 'place', label: 'Place order' },
  { id: 'waiting', label: 'Shipment waiting' },
  { id: 'confirmed', label: 'Confirmed' },
  { id: 'automatic', label: 'Automated status' },
  { id: 'delivered', label: 'Delivered' },
] as const;
type TrackingStage = (typeof TRACKING_STAGES)[number]['id'];
const TRACKING_STAGE_HELP: Record<TrackingStage, string> = {
  place: 'Approved online purchase tickets that still need an order to be placed.',
  waiting: 'Orders are placed; marketplace confirmation or shipment details have not been recorded yet.',
  confirmed: 'Marketplace order ID is saved. Add the courier AWB once the seller dispatches the package.',
  automatic: 'Courier tracking is connected. New scans and delivery status sync here automatically.',
  delivered: 'The courier marked the package delivered or Procurement recorded the goods received.',
};

const OrderTrackingView: React.FC<{ open: (id: string) => void }> = ({ open }) => {
  const { orders, vendors, trackings, loading } = usePurchase();
  const [stage, setStage] = useState<TrackingStage>('place');
  const [q, setQ] = useState('');
  const onlineOrders = useMemo(
    () =>
      orders.filter(order => {
        const vendor = vendors.find(row => row.id === order.vendorId);
        return (
          (order.vendorMode || vendor?.vendorMode) === 'online' && !['cancelled', 'rejected'].includes(order.status)
        );
      }),
    [orders, vendors],
  );
  const rows = useMemo(
    () =>
      onlineOrders.map(order => {
        const trackingRows = trackings
          .filter(row => row.poId === order.id)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        const isDelivered =
          order.status === 'received' ||
          trackingRows.some(row => /deliver/i.test(row.status) || /deliver/i.test(row.subStatus));
        const hasAutomatic = trackingRows.some(row => !!row.trackingNumber);
        const hasMarketplaceConfirmation = trackingRows.some(row => !!row.marketplaceOrderNumber);
        const orderPlaced = ['ordered', 'partial', 'received'].includes(order.status);
        const currentStage: TrackingStage = isDelivered
          ? 'delivered'
          : hasAutomatic
            ? 'automatic'
            : hasMarketplaceConfirmation
              ? 'confirmed'
              : orderPlaced
                ? 'waiting'
                : 'place';
        const vendor = vendors.find(row => row.id === order.vendorId);
        const ticketNumbers = Array.from(new Set(order.items.map(item => item.requestNumber).filter(Boolean)));
        const latestTracking = trackingRows[0];
        const searchText = [
          order.number,
          order.title,
          vendor?.name || '',
          ...ticketNumbers,
          ...order.items.map(item => item.name),
          ...trackingRows.flatMap(row => [row.marketplaceOrderNumber, row.trackingNumber]),
        ]
          .join(' ')
          .toLowerCase();
        return {
          order,
          trackingRows,
          currentStage,
          vendorName: vendor?.name || 'Online marketplace',
          ticketNumbers,
          latestTracking,
          searchText,
        };
      }),
    [onlineOrders, trackings, vendors],
  );
  const visible = rows.filter(
    row => row.currentStage === stage && (!q.trim() || row.searchText.includes(q.trim().toLowerCase())),
  );
  const counts = TRACKING_STAGES.reduce(
    (result, item) => {
      result[item.id] = rows.filter(row => row.currentStage === item.id).length;
      return result;
    },
    {} as Record<TrackingStage, number>,
  );
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-ink">Order tracking</h2>
        <p className="mt-1 text-xs text-mute">
          Follow each online purchase ticket from order placement through courier delivery. Marketplace order IDs stay
          as references; AWB updates appear automatically after dispatch.
        </p>
      </div>
      <nav className="flex gap-1 overflow-x-auto border-b border-line" aria-label="Order tracking stages">
        {TRACKING_STAGES.map(item => (
          <button
            key={item.id}
            type="button"
            onClick={() => setStage(item.id)}
            aria-current={stage === item.id ? 'page' : undefined}
            className={cx(
              'relative shrink-0 px-3 py-2.5 text-xs font-semibold transition-colors',
              stage === item.id ? 'text-blue-300' : 'text-mute hover:text-ink',
            )}
          >
            {item.label}
            <span
              className={cx(
                'ml-2 rounded-full px-1.5 py-0.5 text-[10.5px] tabular-nums',
                stage === item.id ? 'bg-blue-500/15 text-blue-200' : 'bg-raised text-faint',
              )}
            >
              {counts[item.id]}
            </span>
            {stage === item.id && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-blue-500" />}
          </button>
        ))}
      </nav>
      <p className="text-xs text-mute">{TRACKING_STAGE_HELP[stage]}</p>
      <label className="relative block w-full sm:max-w-sm">
        <Search className="absolute left-3 top-3 h-4 w-4 text-faint" />
        <input
          value={q}
          onChange={event => setQ(event.target.value)}
          placeholder="Search ticket, PO, vendor or item…"
          aria-label="Search order tracking"
          className={cx(inputCls(D), 'pl-9')}
        />
      </label>
      <section className={cx(panel, 'overflow-hidden')}>
        {visible.length === 0 ? (
          <Empty>
            {loading
              ? 'Loading orders…'
              : onlineOrders.length === 0
                ? 'No online purchase orders yet.'
                : 'No orders in this stage.'}
          </Empty>
        ) : (
          <ul className="divide-y divide-line/70">
            {visible.map(({ order, trackingRows, vendorName, ticketNumbers, latestTracking }) => {
              const latestEvent =
                latestTracking &&
                [...latestTracking.checkpoints].sort((a, b) =>
                  String(b.checkpoint_time || '').localeCompare(String(a.checkpoint_time || '')),
                )[0];
              const title =
                stage === 'place'
                  ? STATUS[order.status]?.label || 'Ready to place'
                  : stage === 'waiting'
                    ? 'Waiting for shipment details'
                    : stage === 'confirmed'
                      ? 'Order ID saved · awaiting dispatch'
                      : stage === 'delivered'
                        ? order.status === 'received'
                          ? 'Goods received'
                          : 'Delivered by carrier'
                        : latestTracking?.subStatus || latestTracking?.status || 'Courier tracking active';
              return (
                <li key={order.id}>
                  <button
                    type="button"
                    onClick={() => open(order.id)}
                    className="w-full px-4 py-3.5 text-left transition-colors hover:bg-raised/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs font-bold text-blue-300">{order.number}</span>
                          <span className="font-semibold text-sm text-ink">{order.title}</span>
                          <span
                            className={cx(
                              'rounded-full px-2 py-0.5 text-[10.5px] font-semibold',
                              stage === 'delivered'
                                ? 'bg-emerald-500/10 text-emerald-300'
                                : stage === 'automatic'
                                  ? 'bg-blue-500/10 text-blue-300'
                                  : stage === 'place'
                                    ? 'bg-amber-500/10 text-amber-300'
                                    : 'bg-slate-500/10 text-slate-300',
                            )}
                          >
                            {title}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-mute">
                          {vendorName} ·{' '}
                          {ticketNumbers.length ? 'For ' + ticketNumbers.join(', ') : order.items.length + ' line(s)'} ·{' '}
                          {order.items.map(item => item.name + ' × ' + item.qtyOrdered + ' ' + item.unit).join(', ')}
                        </div>
                        {trackingRows.map(row => (
                          <div key={row.id} className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-ink-soft">
                            {row.marketplaceOrderNumber && <span>Order ID {row.marketplaceOrderNumber}</span>}
                            {row.trackingNumber && (
                              <span>
                                {row.courierSlug || 'Courier'} · AWB {row.trackingNumber}
                              </span>
                            )}
                            {row.estimatedDelivery && <span>Expected {day(row.estimatedDelivery)}</span>}
                            {row.trackingUrl && (
                              <a
                                href={row.trackingUrl}
                                target="_blank"
                                rel="noreferrer"
                                onClick={event => event.stopPropagation()}
                                className="text-blue-300 hover:underline"
                              >
                                Track shipment
                              </a>
                            )}
                          </div>
                        ))}
                        {latestEvent && (latestEvent.message || latestEvent.tag) && (
                          <div className="mt-1 text-[11.5px] text-mute">
                            Latest update: {latestEvent.message || latestEvent.tag}
                            {latestEvent.location ? ' · ' + latestEvent.location : ''}
                            {latestEvent.checkpoint_time ? ' · ' + when(latestEvent.checkpoint_time) : ''}
                          </div>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-[10.5px] text-faint">Expected</div>
                        <div className="text-xs text-ink-soft">{day(order.expectedDate)}</div>
                        <div className="mt-1 text-sm font-bold tabular-nums text-ink">{money(poTotal(order))}</div>
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
};

// Orders that have been placed but still need their marketplace/order reference details.
const OrderedView: React.FC<{ open: (id: string) => void }> = ({ open }) => {
  const { orders, vendors, trackings, loading } = usePurchase();
  const [kind, setKind] = useState<'all' | VendorMode>('all');
  const rows = orders
    .filter(
      order =>
        ['ordered', 'partial'].includes(order.status) &&
        (kind === 'all' ||
          (vendors.find(vendor => vendor.id === order.vendorId)?.vendorMode || order.vendorMode) === kind),
    )
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return (
    <div className="space-y-3">
      <div className="flex gap-2" role="group" aria-label="Filter ordered tickets by vendor type">
        {(['all', 'online', 'offline'] as const).map(value => (
          <button
            key={value}
            type="button"
            aria-pressed={kind === value}
            onClick={() => setKind(value)}
            className={cx(
              'rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
              kind === value ? 'border-blue-500 bg-blue-600 text-white' : 'border-line text-mute hover:bg-raised',
            )}
          >
            {value === 'all' ? 'All' : value === 'online' ? 'Online' : 'Offline'}
          </button>
        ))}
      </div>
      <Section title={`Ordered tickets (${rows.length})`}>
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1150px] text-xs">
              <thead className="bg-raised/40 text-left text-[10.5px] uppercase tracking-wide text-mute">
                <tr>
                  {[
                    'PO ticket',
                    'Request',
                    'Vendor',
                    'Type',
                    'Items',
                    'Expected',
                    'Total',
                    'Status',
                    'Order ID',
                    'Shipment ID',
                    '',
                  ].map((heading, index) => (
                    <th key={index} className="px-3 py-2.5 font-semibold">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line/70">
                {rows.map(order => {
                  const mode = vendors.find(vendor => vendor.id === order.vendorId)?.vendorMode || order.vendorMode;
                  const trackingRows = trackings.filter(tracking => tracking.poId === order.id);
                  const requestNos = Array.from(new Set(order.items.map(item => item.requestNumber).filter(Boolean)));
                  return (
                    <tr key={order.id} className="hover:bg-raised/30">
                      <td className="px-3 py-2.5 whitespace-nowrap font-mono font-bold text-blue-300">
                        {order.number}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{requestNos.join(', ') || '—'}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {vendors.find(vendor => vendor.id === order.vendorId)?.name || '—'}
                      </td>
                      <td className="px-3 py-2.5">
                        {mode === 'online' ? 'Online' : mode === 'offline' ? 'Offline' : '—'}
                      </td>
                      <td className="px-3 py-2.5">
                        {order.items.map(item => `${item.name} × ${item.qtyOrdered}`).join(', ')}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {order.expectedDate ? day(order.expectedDate) : '—'}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">{money(poTotal(order))}</td>
                      <td className="px-3 py-2.5">
                        <StatusChip s={order.status} />
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {trackingRows
                          .map(row => row.marketplaceOrderNumber)
                          .filter(Boolean)
                          .join(', ') || '—'}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {trackingRows
                          .map(row => row.trackingNumber)
                          .filter(Boolean)
                          .join(', ') || '—'}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {mode === 'online' && (
                          <button type="button" className={btnGhost(D)} onClick={() => open(order.id)}>
                            {trackingRows.some(row => row.marketplaceOrderNumber || row.trackingNumber)
                              ? 'Edit details'
                              : 'Add details'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>{loading ? 'Loading orders…' : 'No ordered tickets in this category.'}</Empty>
        )}
      </Section>
    </div>
  );
};

// Orders with details saved wait here until Procurement records receipt.
const WaitingView: React.FC = () => {
  const { orders, vendors, trackings, loading } = usePurchase();
  const rows = orders
    .filter(order => ['ordered', 'partial'].includes(order.status))
    .sort((a, b) => (a.expectedDate || '9999').localeCompare(b.expectedDate || '9999'));
  return (
    <Section title={`Waiting for receipt (${rows.length})`}>
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[650px] text-xs">
            <thead className="bg-raised/40 text-left text-[10.5px] uppercase tracking-wide text-mute">
              <tr>
                {['Purchase order', 'Vendor', 'Order status', 'Shipment status'].map((heading, index) => (
                  <th key={index} className="px-3 py-2.5 font-semibold">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70">
              {rows.map(order => {
                const latest = trackings
                  .filter(tracking => tracking.poId === order.id)
                  .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
                return (
                  <tr key={order.id} className="hover:bg-raised/30">
                    <td className="px-3 py-2.5 whitespace-nowrap font-mono font-bold text-blue-300">{order.number}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {vendors.find(vendor => vendor.id === order.vendorId)?.name || '—'}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusChip s={order.status} />
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {latest ? latest.subStatus || latest.status : 'Awaiting update'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>{loading ? 'Loading orders…' : 'No orders are waiting for receipt.'}</Empty>
      )}
    </Section>
  );
};
// ---- vendor + rates (the lines themselves come from the tickets) ------------------------------------------
const OrderEditModal: React.FC<{ id: string; onClose: () => void }> = ({ id, onClose }) => {
  const { orders, vendors, saveDraft } = usePurchase();
  const { requests } = useRequests();
  const o = orders.find(x => x.id === id);
  const [vendorId, setVendorId] = useState(o?.vendorId || '');
  const [expected, setExpected] = useState(o?.expectedDate || '');
  const [notes, setNotes] = useState(o?.notes || '');
  const [vendorMode, setVendorMode] = useState<VendorMode>(
    vendors.find(v => v.id === o?.vendorId)?.vendorMode || o?.vendorMode || 'online',
  );
  const [rates, setRates] = useState<Record<string, string>>(() =>
    Object.fromEntries((o?.items || []).map(i => [i.id, i.rate ? String(i.rate) : ''])),
  );
  const requestNumbers = Array.from(new Set((o?.items || []).map(item => item.requestNumber).filter(Boolean)));
  const autoMisc = requests
    .filter(
      request =>
        requestNumbers.includes(request.number) &&
        !orders.some(
          other =>
            other.id !== o?.id &&
            other.miscAmount > 0 &&
            other.items.some(item => item.requestNumber === request.number),
        ),
    )
    .reduce((sum, request) => sum + (request.miscBudget || 0), 0);
  const [miscAmount, setMiscAmount] = useState(o?.miscAmount || 0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!o?.miscAmount && autoMisc > 0) setMiscAmount(autoMisc);
  }, [o?.id, o?.miscAmount, autoMisc]);
  if (!o) return null;
  const num = (id2: string) => parseFloat(rates[id2]) || 0;
  const total = o.items.reduce((a, i) => a + i.qtyOrdered * num(i.id), 0) + miscAmount;
  const save = async (submit: boolean) => {
    setBusy(true);
    const ok = await saveDraft(
      o.id,
      {
        vendorId,
        vendorMode,
        expectedDate: expected,
        notes,
        miscAmount,
        rates: Object.fromEntries(o.items.map(i => [i.id, num(i.id)])),
      },
      submit,
    );
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <Modal title={`${o.number} · vendor and rates`} dark={D} onClose={onClose} xl>
      <div className="space-y-4">
        {o.status === 'rejected' && o.decisionNote && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            Order needs changes: {o.decisionNote}
          </div>
        )}
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          <div>
            <label className={labelCls(D)} htmlFor="oe-mode">
              Vendor type
            </label>
            <select
              id="oe-mode"
              value={vendorMode}
              onChange={e => {
                const mode = e.target.value as VendorMode;
                setVendorMode(mode);
                if (vendors.find(v => v.id === vendorId)?.vendorMode !== mode) setVendorId('');
              }}
              className={inputCls(D)}
            >
              <option value="online">Online marketplace</option>
              <option value="offline">Offline / local vendor</option>
            </select>
          </div>
          <div>
            <label className={labelCls(D)} htmlFor="oe-v">
              Choose vendor
            </label>
            <select id="oe-v" value={vendorId} onChange={e => setVendorId(e.target.value)} className={inputCls(D)}>
              <option value="">Choose {vendorMode === 'online' ? 'an online marketplace' : 'a local'} vendor…</option>
              {vendors
                .filter(v => v.vendorMode === vendorMode)
                .map(v => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label className={labelCls(D)} htmlFor="oe-d">
              Expected delivery
            </label>
            <input
              id="oe-d"
              type="date"
              value={expected}
              onChange={e => setExpected(e.target.value)}
              className={inputCls(D)}
            />
          </div>
          <div>
            <label className={labelCls(D)} htmlFor="oe-n">
              Note
            </label>
            <input id="oe-n" value={notes} onChange={e => setNotes(e.target.value)} className={inputCls(D)} />
          </div>
        </div>
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-sm min-w-[32rem]">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-faint border-b border-line">
                <th className="pl-3 py-2.5 font-semibold">Item</th>
                <th className="px-3 py-2.5 font-semibold text-right">Qty</th>
                <th className="px-3 py-2.5 font-semibold text-right w-32">Rate (₹)</th>
                <th className="px-3 py-2.5 pr-3 font-semibold text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70">
              {o.items.map(i => (
                <tr key={i.id}>
                  <td className="pl-3 py-2">
                    <div className="font-medium">{i.name}</div>
                    {i.requestNumber && <div className="text-xs text-mute">for {i.requestNumber}</div>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {i.qtyOrdered} <span className="text-xs text-faint">{i.unit}</span>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      aria-label={`Rate for ${i.name}`}
                      inputMode="decimal"
                      value={rates[i.id] ?? ''}
                      onChange={e => setRates(r => ({ ...r, [i.id]: e.target.value.replace(/[^\d.]/g, '') }))}
                      className={cx(inputCls(D), 'text-right tabular-nums')}
                    />
                  </td>
                  <td className="px-3 py-2 pr-3 text-right tabular-nums font-semibold">
                    {money(i.qtyOrdered * num(i.id))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {autoMisc > 0 && (
          <div className="rounded-lg border border-blue-500/25 bg-blue-500/5 px-3 py-2 text-xs text-ink-soft">
            Request miscellaneous / installation allowance is included automatically:{' '}
            <b className="tabular-nums">{money(miscAmount)}</b>. It is included in the PO total without creating a
            separate item line.
          </div>
        )}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span className="text-sm text-mute">
            Total <b className="text-ink tabular-nums">{money(total)}</b>
          </span>
          <div className="flex gap-2">
            <button className={btnGhost(D)} onClick={onClose}>
              Cancel
            </button>
            <button
              className={primary}
              disabled={busy || !vendorId || o.items.some(item => !(num(item.id) > 0))}
              onClick={() => save(false)}
            >
              {busy ? 'Saving…' : 'Save details'}
            </button>
          </div>
        </div>
        <p className="text-xs text-mute">
          {vendorMode === 'online'
            ? 'Place the order on the e-commerce marketplace (such as Amazon or Flipkart), then record it here. Add the marketplace order number and courier details for tracking.'
            : vendorMode === 'offline'
              ? 'Place the order directly with the local supplier, then mark it here. Marketplace tracking is not used.'
              : 'Choose a vendor category to continue: online marketplace (e-commerce brand) or offline/local supplier.'}{' '}
          Order lines come from approved requests.
        </p>
      </div>
    </Modal>
  );
};

// ---- order detail ------------------------------------------------------------------------------------------
const OrderModal: React.FC<{
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
  } = usePurchase();
  const { requests } = useRequests();
  const o = orders.find(x => x.id === id);
  const [rc, setRc] = useState<Receipt[] | null>(null);
  const [pm, setPm] = useState<Payment[] | null>(null);
  const [ask, setAsk] = useState<'cancel' | 'delete' | 'reject' | null>(null);
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
                <select
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
                </select>
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
        {canReceive && INCOMING.includes(o.status) && (
          <button className={good} onClick={() => onReceive(o.id)}>
            <Truck className="w-4 h-4" />
            Receive goods
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

// ---- payments ----------------------------------------------------------------------------------------------
const PaymentsView: React.FC<{ open: (id: string) => void; onAsk: (id: string) => void }> = ({ open, onAsk }) => {
  const { orders, payRequests, vendorName, canManage, canPay, stats, withdrawPayment } = usePurchase();
  const [payingId, setPayingId] = useState<string | null>(null);
  const ready = payRequests.filter(r => r.status === 'pending' || r.status === 'approved');
  const closed = payRequests.filter(r => ['paid', 'rejected', 'cancelled'].includes(r.status)).slice(0, 30);
  const asked = (poId: string) =>
    payRequests
      .filter(r => r.poId === poId && (r.status === 'pending' || r.status === 'approved'))
      .reduce((a, r) => a + r.amount, 0);
  const due = orders.filter(o => PAYABLE.includes(o.status) && poDue(o) - asked(o.id) > 0.009);
  const rows = useLedger<Payment>('payments', 300);
  const requestTable = (list: PaymentRequest[], actions: boolean) =>
    list.length ? (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-xs">
          <thead className="bg-raised/40 text-left text-[10.5px] uppercase tracking-wide text-mute">
            <tr>
              {['Amount', 'PO ticket', 'Status', 'Requested by', 'Requested at', 'Note', ...(actions ? [''] : [])].map(
                (heading, index) => (
                  <th key={index} className="px-3 py-2.5 font-semibold">
                    {heading}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-line/70">
            {list.map(request => {
              const order = orders.find(row => row.id === request.poId);
              return (
                <tr key={request.id} className="hover:bg-raised/30">
                  <td className="px-3 py-2.5 whitespace-nowrap font-bold tabular-nums">{money(request.amount)}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    {order ? (
                      <button
                        type="button"
                        onClick={() => open(order.id)}
                        className="font-mono font-bold text-blue-300 hover:underline"
                      >
                        {order.number}
                      </button>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{PAYREQ[request.status].label}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{request.requestedBy || '—'}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{when(request.requestedAt)}</td>
                  <td className="px-3 py-2.5">{request.note || '—'}</td>
                  {actions && (
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      <div className="flex justify-end gap-1">
                        {canPay && (
                          <button type="button" className={good} onClick={() => setPayingId(request.id)}>
                            Pay now
                          </button>
                        )}
                        {canManage && (
                          <button type="button" className={btnGhost(D)} onClick={() => withdrawPayment(request.id)}>
                            Cancel
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    ) : (
      <Empty>{actions ? 'No payment requests are ready.' : 'No earlier payment requests.'}</Empty>
    );
  return (
    <div className="space-y-5">
      <div className={cx(panel, 'overflow-x-auto')}>
        <table className="w-full min-w-[600px] text-xs">
          <thead className="bg-raised/40 text-left text-[10.5px] uppercase tracking-wide text-mute">
            <tr>
              <th className="px-3 py-2 font-semibold">Still to pay</th>
              <th className="px-3 py-2 font-semibold">Ready to pay</th>
              <th className="px-3 py-2 font-semibold">Orders with money due</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="px-3 py-2.5 text-base font-bold tabular-nums text-amber-300">{money(stats.due)}</td>
              <td className="px-3 py-2.5 text-base font-bold tabular-nums text-blue-300">{ready.length}</td>
              <td className="px-3 py-2.5 text-base font-bold tabular-nums text-rose-300">
                {orders.filter(o => PAYABLE.includes(o.status) && poDue(o) > 0).length}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <Section title={`Ready to pay (${ready.length})`}>{requestTable(ready, true)}</Section>
      <Section title={`Orders where a payment can be asked for (${due.length})`}>
        {due.length === 0 ? (
          <Empty>Nothing more to ask for.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-xs">
              <thead className="bg-raised/40 text-left text-[10.5px] uppercase tracking-wide text-mute">
                <tr>
                  {['PO ticket', 'Vendor', 'Total', 'Paid', 'Due', ''].map((heading, index) => (
                    <th key={index} className="px-3 py-2.5 font-semibold">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line/70">
                {due.map(order => (
                  <tr key={order.id} className="hover:bg-raised/30">
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => open(order.id)}
                        className="font-mono font-bold text-blue-300 hover:underline"
                      >
                        {order.number}
                      </button>
                      <span className="ml-2 text-ink-soft">{order.title}</span>
                    </td>
                    <td className="px-3 py-2.5">{vendorName(order.vendorId)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">{money(poTotal(order))}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap tabular-nums text-emerald-300">{money(order.paid)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap tabular-nums text-amber-300">{money(poDue(order))}</td>
                    <td className="px-3 py-2.5 text-right">
                      {canManage && (
                        <button className={btnGhost(D)} onClick={() => onAsk(order.id)}>
                          Ask for a payment
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
      {closed.length > 0 && <Section title="Earlier payment requests">{requestTable(closed, false)}</Section>}
      <Section title="Payments made">
        <PaymentList rows={rows} empty="No payments recorded yet." />
      </Section>
      {payingId && <PayNowModal id={payingId} onClose={() => setPayingId(null)} />}
    </div>
  );
};

// ---- the procurement desk -----------------------------------------------------------------------------
export const PurchaseDesk: React.FC<{ view: DeskView }> = ({ view }) => {
  const { loadError, canManage, canReceive, canPay } = usePurchase();
  const [filter, setFilter] = useState<POStatus | 'all'>('all');
  const [viewing, setViewing] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [receiving, setReceiving] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  return (
    <div className="space-y-5">
      {!canManage && (
        <div className="p-3 bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded-xl text-xs">
          🔒{' '}
          {canPay
            ? 'Accounts access: review payment requests and record payments. Purchase manages orders.'
            : canReceive
              ? 'You can view orders and record goods received, but not change orders.'
              : 'You can view orders but not change them.'}
        </div>
      )}
      {loadError && (
        <div role="alert" className="rounded-xl border border-rose-500/40 bg-rose-500/10 text-rose-400 text-sm p-3">
          Could not load purchases: {loadError}
        </div>
      )}
      {view === 'buy' && <BuyListView editOrder={setViewing} />}
      {view === 'tracking' && <WaitingView />}
      {view === 'orders' && <OrderedView open={setViewing} />}
      {view === 'vendors' && <VendorsView />}
      {view === 'receiving' && <ReceivingView />}
      {view === 'payments' && <PaymentsView open={setViewing} onAsk={setAsking} />}

      {viewing && !editing && !receiving && !asking && (
        <OrderModal
          id={viewing}
          onClose={() => setViewing(null)}
          onEdit={setEditing}
          onReceive={setReceiving}
          onAsk={setAsking}
        />
      )}
      {editing && <OrderEditModal id={editing} onClose={() => setEditing(null)} />}
      {receiving && <ReceiveModal id={receiving} onClose={() => setReceiving(null)} />}
      {asking && <AskPayModal id={asking} onClose={() => setAsking(null)} />}
    </div>
  );
};

const PURCHASE_TABS: { id: DeskView; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'buy', label: 'To Order', icon: ShoppingCart },
  { id: 'orders', label: 'Ordered', icon: Check },
  { id: 'tracking', label: 'Waiting', icon: ClipboardList },
  { id: 'receiving', label: 'Received', icon: Truck },
  { id: 'payments', label: 'Payments', icon: Wallet },
  { id: 'vendors', label: 'Vendors', icon: Search },
];

// Standalone Procurement workspace for approved request lines.
export const PurchaseApp: React.FC<{ initialTab?: DeskView }> = ({ initialTab = 'orders' }) => {
  const { orders } = usePurchase();
  const navRef = useRef<HTMLElement>(null);
  const tabRefs = useRef<Partial<Record<DeskView, HTMLButtonElement | null>>>({});
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });
  const [indicatorReady, setIndicatorReady] = useState(false);
  const [tab, setTab] = useState<DeskView>(() => {
    const part = location.hash.split('/')[2] as DeskView;
    return PURCHASE_TABS.some(x => x.id === part) ? part : initialTab;
  });
  const payable = orders.filter(o => PAYABLE.includes(o.status));
  const totals = [
    ['Committed', payable.reduce((sum, o) => sum + poTotal(o), 0)],
    ['Paid', payable.reduce((sum, o) => sum + o.paid, 0)],
    ['Still due', payable.reduce((sum, o) => sum + poDue(o), 0)],
  ] as const;
  useEffect(() => {
    const sync = () => {
      const part = location.hash.split('/')[2] as DeskView;
      setTab(PURCHASE_TABS.some(x => x.id === part) ? part : initialTab);
    };
    addEventListener('hashchange', sync);
    return () => removeEventListener('hashchange', sync);
  }, [initialTab]);
  useLayoutEffect(() => {
    const active = tabRefs.current[tab];
    if (!active || !navRef.current) return;
    const update = () => setIndicator({ left: active.offsetLeft, width: active.offsetWidth });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(navRef.current);
    observer.observe(active);
    const frame = requestAnimationFrame(() => setIndicatorReady(true));
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [tab]);
  const go = (next: DeskView) => {
    setTab(next);
    location.hash = `#/purchase/${next}`;
  };
  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-ink">Procurement</h2>
          <p className="text-xs text-mute">Order, receive, and pay for approved department requests.</p>
        </div>
      </header>
      <section aria-label="Purchase totals" className={cx(panel, 'overflow-x-auto')}>
        <table className="w-full min-w-[520px] text-xs">
          <thead className="bg-raised/40 text-left text-[10.5px] uppercase tracking-wide text-mute">
            <tr>
              {totals.map(([label]) => (
                <th key={label} className="px-3 py-2 font-semibold">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {totals.map(([label, amount]) => (
                <td key={label} className="px-3 py-2.5 text-sm font-semibold tabular-nums text-ink">
                  {money(amount)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </section>
      <nav
        ref={navRef}
        className="relative flex gap-1 overflow-x-auto border-b border-line"
        aria-label="Purchase sections"
      >
        <span
          aria-hidden="true"
          className={cx(
            'pointer-events-none absolute bottom-0 left-0 h-0.5 rounded-full bg-blue-500',
            indicatorReady
              ? 'transition-[transform,width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]'
              : 'transition-none',
          )}
          style={{ width: indicator.width, transform: `translateX(${indicator.left}px)` }}
        />
        {PURCHASE_TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            ref={node => {
              tabRefs.current[id] = node;
            }}
            onClick={() => go(id)}
            aria-current={tab === id ? 'page' : undefined}
            className={cx(
              'inline-flex items-center gap-1.5 whitespace-nowrap px-2.5 py-2 text-xs font-medium transition-colors duration-200',
              tab === id ? 'text-blue-400' : 'text-mute hover:text-ink',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </nav>
      <PurchaseDesk view={tab} />
    </div>
  );
};
