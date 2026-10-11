import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, ClipboardList, Edit3, Plus, Search, ShoppingCart, Trash2, Truck, Wallet, X } from 'lucide-react';
import { Modal, ConfirmModal, btnGhost, cx, inputCls, labelCls } from '../accommodation/ui';
import { todayStr } from '../accommodation/dates';
import { inr } from '../../pages/orgData';
import { useRequests } from '../requests/RequestsContext';
import { unlinkedPurchaseParts } from '../requests/types';
import { exportRequestsXlsx } from '../requests/exportXlsx';
import { usePurchase } from './PurchaseContext';
import type { VendorInput } from './PurchaseContext';
import { useInventory } from '../inventory';
import { INCOMING, PAYABLE, PAYREQ, PAY_MODES, STATUS, payModeLabel, poDue, poTotal, poUnitsLeft } from './types';
import type { PO, POStatus, Payment, PaymentRequest, Receipt, Vendor, VendorMode } from './types';

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
const primary = 'inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold bg-blue-600 hover:bg-blue-500 text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:opacity-50 disabled:cursor-not-allowed';
const good = 'inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed';
const money = (n: number) => inr(Math.round(n * 100) / 100);
const when = (s: string) => new Date(s).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const day = (s: string) => (s ? new Date(`${s}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const vendorModeLabel = (mode?: VendorMode | null) => mode === 'online' ? 'Online marketplace' : mode === 'offline' ? 'Offline vendor' : 'Category needed';

export type DeskView = 'buy' | 'tracking' | 'orders' | 'receiving' | 'vendors' | 'payments';

// ---- small shared pieces ---------------------------------------------------
const Section: React.FC<{ title: string; action?: React.ReactNode; children: React.ReactNode }> = ({ title, action, children }) => (
  <section className={cx(panel, 'overflow-hidden')}>
    <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-line"><h2 className="text-sm font-bold">{title}</h2>{action}</div>
    {children}
  </section>
);
const Empty: React.FC<{ children: React.ReactNode }> = ({ children }) => <p className="py-10 px-4 text-center text-sm text-faint">{children}</p>;
const Stat: React.FC<{ label: string; value: React.ReactNode; dot?: string; onClick?: () => void }> = ({ label, value, dot, onClick }) => (
  <button onClick={onClick} className={cx(panel, 'px-4 py-3.5 text-left hover:bg-raised/40 transition-colors')}>
    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-mute">{dot && <span className={cx('w-2 h-2 rounded-full', dot)} />}{label}</div>
    <div className="text-2xl font-bold mt-1 tabular-nums">{value}</div>
  </button>
);
const StatusChip: React.FC<{ s: POStatus }> = ({ s }) => <span className={cx('text-xs font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap', TONE[STATUS[s].tone])}>{STATUS[s].label}</span>;
const PayChip: React.FC<{ po: PO }> = ({ po }) => {
  if (!PAYABLE.includes(po.status)) return null;
  const total = poTotal(po);
  if (total <= 0) return null;
  const [l, t] = po.paid <= 0 ? ['Unpaid', 'warn'] : poDue(po) > 0 ? ['Part paid', 'info'] : ['Paid', 'ok'];
  return <span className={cx('text-xs font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap', TONE[t])}>{l}</span>;
};
const overdue = (po: PO) => INCOMING.includes(po.status) && !!po.expectedDate && po.expectedDate < todayStr();

// Latest receipts / payments, refreshed whenever an order changes.
const useLedger = <T,>(kind: 'receipts' | 'payments', limit = 300): T[] | null => {
  const { orders, fetchReceipts, fetchPayments } = usePurchase();
  const [rows, setRows] = useState<T[] | null>(null);
  const sig = orders.reduce((a, o) => a + o.paid * 3 + o.items.reduce((b, i) => b + i.qtyReceived * 7, 0) + o.items.length, 0);
  useEffect(() => {
    let on = true;
    (kind === 'receipts' ? fetchReceipts(undefined, limit) : fetchPayments(undefined, limit)).then((r: any) => { if (on) setRows(r); });
    return () => { on = false; };
  }, [kind, limit, sig]); // eslint-disable-line
  return rows;
};

const useLookups = () => {
  const { orders } = usePurchase();
  return useMemo(() => {
    const po = new Map<string, PO>(orders.map(o => [o.id, o] as [string, PO]));
    const line = new Map<string, { name: string; unit: string; requestNumber: string }>();
    orders.forEach(o => o.items.forEach(i => line.set(i.id, { name: i.name, unit: i.unit, requestNumber: i.requestNumber })));
    return { po, line };
  }, [orders]);
};

const ReceiptList: React.FC<{ rows: Receipt[] | null; empty: string; showPo?: boolean }> = ({ rows, empty, showPo = true }) => {
  const { po, line } = useLookups();
  const { locationLabel } = useInventory();
  if (rows === null) return <Empty>Loading…</Empty>;
  if (!rows.length) return <Empty>{empty}</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1050px] text-xs">
        <thead className="bg-raised/60 text-left text-[10px] uppercase tracking-wide text-mute"><tr>
          <th className="px-3 py-2.5 font-semibold">Item</th><th className="px-3 py-2.5 font-semibold">Quantity</th>
          {showPo && <th className="px-3 py-2.5 font-semibold">Purchase order</th>}
          <th className="px-3 py-2.5 font-semibold">Request</th><th className="px-3 py-2.5 font-semibold">Deliver to</th>
          <th className="px-3 py-2.5 font-semibold">Store</th><th className="px-3 py-2.5 font-semibold">Delivered by</th>
          <th className="px-3 py-2.5 font-semibold">Received by</th><th className="px-3 py-2.5 font-semibold">Challan</th>
          <th className="px-3 py-2.5 font-semibold">Received at</th><th className="px-3 py-2.5 font-semibold">Recorded by</th>
        </tr></thead>
        <tbody className="divide-y divide-line">{rows.map(r => {
          const item = line.get(r.itemId); const order = po.get(r.poId);
          const cell = (value?: string) => value || '—';
          return <tr key={r.id} className="hover:bg-raised/30">
            <td className="px-3 py-2.5 font-semibold text-ink">{item?.name || 'Removed item'}</td>
            <td className="px-3 py-2.5 whitespace-nowrap font-semibold tabular-nums text-emerald-400">+{r.qty} <span className="font-normal text-mute">{item?.unit || 'pcs'}</span></td>
            {showPo && <td className="px-3 py-2.5 whitespace-nowrap font-mono text-blue-300">{cell(order?.number)}</td>}
            <td className="px-3 py-2.5 whitespace-nowrap">{cell(item?.requestNumber)}</td>
            <td className="px-3 py-2.5">{cell(order?.deliverTo)}</td>
            <td className="px-3 py-2.5">{r.location ? locationLabel(r.location) : '—'}</td>
            <td className="px-3 py-2.5">{cell(r.givenBy)}</td><td className="px-3 py-2.5">{cell(r.receivedBy)}</td>
            <td className="px-3 py-2.5">{cell(r.challan)}</td><td className="px-3 py-2.5 whitespace-nowrap">{when(r.doneAt)}</td>
            <td className="px-3 py-2.5">{cell(r.doneBy)}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>
  );
};

const PaymentList: React.FC<{ rows: Payment[] | null; empty: string; showPo?: boolean }> = ({ rows, empty, showPo = true }) => {
  const { po } = useLookups();
  if (rows === null) return <Empty>Loading…</Empty>;
  if (!rows.length) return <Empty>{empty}</Empty>;
  return (
    <ul className="divide-y divide-line/70">
      {rows.map(r => {
        const o = po.get(r.poId);
        const meta = [payModeLabel(r.mode), r.ref && `Ref ${r.ref}`, r.paidBy && `Paid by ${r.paidBy}`, r.note].filter(Boolean).join(' · ');
        return (
          <li key={r.id} className="px-4 py-3 flex items-start justify-between gap-3 text-sm">
            <div className="min-w-0">
              <div className="font-bold tabular-nums">{money(r.amount)}</div>
              {showPo && o && <div className="text-xs text-mute mt-0.5">{o.number} · {o.title}</div>}
              <div className="text-xs text-mute mt-1">{meta}</div>
            </div>
            <div className="text-xs text-faint text-right shrink-0">{when(r.doneAt)}<br />{r.doneBy}</div>
          </li>
        );
      })}
    </ul>
  );
};

// ---- views -----------------------------------------------------------------
const FILTERS: { key: POStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'draft', label: 'Draft' }, { key: 'pending', label: 'Ready to place' }, { key: 'approved', label: 'Approved' },
  { key: 'ordered', label: 'Ordered' }, { key: 'partial', label: 'Partly received' }, { key: 'received', label: 'Received' }, { key: 'rejected', label: 'Rejected' }, { key: 'cancelled', label: 'Cancelled' },
];

const OrdersView: React.FC<{ filter: POStatus | 'all'; setFilter: (f: POStatus | 'all') => void; open: (id: string) => void }> = ({ filter, setFilter, open }) => {
  const { orders, vendorName, canManage, loading } = usePurchase();
  const [q, setQ] = useState('');
  const count = (k: POStatus | 'all') => (k === 'all' ? orders.length : orders.filter(o => o.status === k).length);
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return orders.filter(o => (filter === 'all' || o.status === filter)
      && (!t || o.number.toLowerCase().includes(t) || o.title.toLowerCase().includes(t) || vendorName(o.vendorId).toLowerCase().includes(t) || o.requestedBy.toLowerCase().includes(t)));
  }, [orders, filter, q, vendorName]);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search className="absolute left-3 top-3 h-4 w-4 text-faint" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search PO no., title, vendor…" aria-label="Search orders" className={cx(inputCls(D), 'pl-9')} />
        </div>
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-1" role="group" aria-label="Filter by status">
        {FILTERS.map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)} aria-pressed={filter === f.key}
            className={cx('px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap border transition-colors', filter === f.key ? 'bg-blue-600 border-blue-500 text-white' : 'border-line-strong text-mute hover:bg-raised')}>
            {f.label} <span className="opacity-70 tabular-nums">{count(f.key)}</span>
          </button>
        ))}
      </div>
      <section className={cx(panel, 'overflow-hidden')}>
        {rows.length === 0 ? <Empty>{loading ? 'Loading…' : orders.length === 0 ? (canManage ? 'No orders yet. Build one from the Buy list.' : 'No orders yet.') : 'No orders match.'}</Empty> : (
          <ul className="divide-y divide-line/70">
            {rows.map(o => (
              <li key={o.id}>
                <button onClick={() => open(o.id)} className="w-full text-left px-4 py-3.5 hover:bg-raised/40 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-2 md:gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs text-blue-400 font-bold">{o.number}</span><span className="font-semibold text-sm">{o.title}</span><StatusChip s={o.status} />{o.vendorMode && <span className="text-[10px] font-semibold text-mute">{vendorModeLabel(o.vendorMode)}</span>}<PayChip po={o} /></div>
                    <div className="text-xs text-mute mt-1">{o.vendorId ? vendorName(o.vendorId) : 'No vendor yet'} · {o.items.length} line{o.items.length === 1 ? '' : 's'}{o.deliverTo ? ` · ${o.deliverTo}` : ''}</div>
                  </div>
                  <div className="flex items-center gap-5 shrink-0 text-right">
                    <div className="text-xs"><div className="text-faint">Expected</div><div className={overdue(o) ? 'text-rose-400 font-semibold' : 'text-ink-soft'}>{day(o.expectedDate)}</div></div>
                    <div><div className="text-xs uppercase text-faint">Total</div><div className="font-bold tabular-nums">{money(poTotal(o))}</div></div>
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
  const [form, setForm] = useState<Vendor | 'new' | null>(null);
  const [del, setDel] = useState<Vendor | null>(null);
  const stat = (id: string) => { const os = orders.filter(o => o.vendorId === id && o.status !== 'cancelled' && o.status !== 'rejected'); return { n: os.length, v: os.reduce((a, o) => a + poTotal(o), 0) }; };
  return (
    <div className="space-y-5">
      <div className="flex justify-end">{canManage && <button className={primary} onClick={() => setForm('new')}><Plus className="w-4 h-4" />Add vendor</button>}</div>
      <section className={cx(panel, 'overflow-hidden')}>
        {vendors.length === 0 ? <Empty>No vendors yet.</Empty> : (
          <ul className="divide-y divide-line/70">
            {vendors.map(v => {
              const s = stat(v.id);
              return (
                <li key={v.id} className="px-4 py-3.5 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-sm">{v.name}</span><span className={cx('rounded-full border px-2 py-0.5 text-[10px] font-semibold', v.vendorMode === 'online' ? 'border-blue-500/30 bg-blue-500/10 text-blue-300' : v.vendorMode === 'offline' ? 'border-violet-500/30 bg-violet-500/10 text-violet-300' : 'border-amber-500/30 bg-amber-500/10 text-amber-300')}>{vendorModeLabel(v.vendorMode)}</span></div>
                    <div className="text-xs text-mute mt-0.5">{[v.contact, v.phone, v.email].filter(Boolean).join(' · ') || 'No contact details'}</div>
                    {v.address && <div className="text-xs text-faint mt-0.5">{v.address}</div>}
                    <div className="text-xs text-faint mt-1">{s.n} order{s.n === 1 ? '' : 's'} · {money(s.v)}</div>
                  </div>
                  {canManage && (
                    <div className="flex gap-1.5 shrink-0">
                      <button className={btnGhost(D)} onClick={() => setForm(v)} aria-label={`Edit ${v.name}`}><Edit3 className="w-3.5 h-3.5" /></button>
                      <button className={cx(btnGhost(D), 'text-rose-400')} onClick={() => setDel(v)} aria-label={`Delete ${v.name}`}><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {form && <VendorForm initial={form === 'new' ? null : form} onClose={() => setForm(null)} onSave={v => (form === 'new' ? addVendor(v) : updateVendor(form.id, v))} />}
      {del && <ConfirmModal dark={D} title={`Delete ${del.name}?`} body="Only possible if no order uses this vendor." confirmLabel="Delete" onConfirm={() => { deleteVendor(del.id); }} onClose={() => setDel(null)} />}
    </div>
  );
};

const VendorForm: React.FC<{ initial: Vendor | null; onClose: () => void; onSave: (v: VendorInput) => Promise<boolean> }> = ({ initial, onClose, onSave }) => {
  const [f, setF] = useState<VendorInput>({ name: initial?.name || '', vendorMode: initial?.vendorMode || '', contact: initial?.contact || '', phone: initial?.phone || '', email: initial?.email || '', address: initial?.address || '', notes: initial?.notes || '' });
  const [busy, setBusy] = useState(false);
  const setText = (k: 'name' | 'contact' | 'phone' | 'email' | 'address' | 'notes', v: string) => setF(p => ({ ...p, [k]: v }));
  const submit = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); const ok = await onSave(f); setBusy(false); if (ok) onClose(); };
  const field = (id: string, label: string, k: 'contact' | 'phone' | 'email' | 'address' | 'notes', type = 'text') => <div><label className={labelCls(D)} htmlFor={id}>{label}</label><input id={id} type={type} value={f[k]} onChange={e => setText(k, e.target.value)} className={inputCls(D)} /></div>;
  return (
    <Modal title={initial ? 'Edit vendor' : 'Add vendor'} dark={D} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-3"><div><label className={labelCls(D)} htmlFor="vn-n">Vendor name</label><input id="vn-n" autoFocus required value={f.name} onChange={e => setText('name', e.target.value)} className={inputCls(D)} /></div><div><label className={labelCls(D)} htmlFor="vn-mode">Vendor category</label><select id="vn-mode" required value={f.vendorMode} onChange={e => setF(p => ({ ...p, vendorMode: e.target.value as VendorMode | '' }))} className={inputCls(D)}><option value="">Choose category…</option><option value="online">Online marketplace</option><option value="offline">Offline / local vendor</option></select><p className="mt-1 text-[10px] text-mute">Amazon / Flipkart or local supplier</p></div></div>
        <div className="grid grid-cols-2 gap-3">{field('vn-c', 'Contact person', 'contact')}{field('vn-p', 'Phone', 'phone', 'tel')}</div>
        {field('vn-e', 'Email', 'email', 'email')}
        {f.vendorMode === 'offline' && field('vn-a', 'Vendor address', 'address')}
        {field('vn-t', 'Notes', 'notes')}
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className={btnGhost(D)}>Cancel</button><button type="submit" disabled={busy || !f.name.trim()} className={primary}>{busy ? 'Saving…' : 'Save'}</button></div>
      </form>
    </Modal>
  );
};

const ReceivingView: React.FC<{ open: (id: string) => void; onReceive: (id: string) => void }> = ({ open, onReceive }) => {
  const { orders, vendorName, canReceive } = usePurchase();
  const incoming = orders.filter(o => INCOMING.includes(o.status)).sort((a, b) => (a.expectedDate || '9999').localeCompare(b.expectedDate || '9999'));
  const rows = useLedger<Receipt>('receipts', 300);
  return (
    <div className="space-y-5">
      <Section title={`Waiting to be received (${incoming.length})`}>
        {incoming.length === 0 ? <Empty>No orders are waiting for delivery.</Empty> : (
          <ul className="divide-y divide-line/70">
            {incoming.map(o => (
              <li key={o.id} className="px-4 py-3 flex items-center justify-between gap-3">
                <button className="min-w-0 text-left" onClick={() => open(o.id)}>
                  <div className="font-semibold text-sm truncate">{o.number} · {o.title}</div>
                  <div className="text-xs text-faint">{vendorName(o.vendorId)} · {poUnitsLeft(o)} units left · <span className={overdue(o) ? 'text-rose-400 font-semibold' : ''}>{o.expectedDate ? day(o.expectedDate) : 'no date'}</span></div>
                </button>
                {canReceive && <button className={cx(btnGhost(D), 'text-emerald-300 shrink-0')} onClick={() => onReceive(o.id)}><Truck className="w-3.5 h-3.5" />Receive goods</button>}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Goods received log"><ReceiptList rows={rows} empty="Nothing has been received yet." /></Section>
    </div>
  );
};

const Info: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div><div className="text-xs uppercase tracking-wider text-faint">{label}</div><div className="text-sm mt-0.5">{children || <span className="text-faint">—</span>}</div></div>
);

const ReceiveModal: React.FC<{ id: string; onClose: () => void }> = ({ id, onClose }) => {
  const { orders, receive, userName } = usePurchase();
  const inventory = useInventory();
  const o = orders.find(x => x.id === id);
  const open = (o?.items || []).filter(i => i.qtyOrdered > i.qtyReceived);
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(open.map(i => [i.id, String(i.qtyOrdered - i.qtyReceived)])));
  const [givenBy, setGivenBy] = useState('');
  const [receivedBy, setReceivedBy] = useState(userName);
  const [location, setLocation] = useState('');
  const [challan, setChallan] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  if (!o) return null;
  const lines = open.map(i => ({ itemId: i.id, qty: parseInt(qty[i.id] || '0', 10) || 0, left: i.qtyOrdered - i.qtyReceived, linked: !!i.inventoryItemId }));
  const bad = lines.find(l => l.qty > l.left);
  const any = lines.some(l => l.qty > 0);
  const can = any && !bad && receivedBy.trim() !== '';
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!can) return;
    setBusy(true); const ok = await receive(o.id, lines.map(l => ({ itemId: l.itemId, qty: l.qty })), { location, givenBy, receivedBy, challan, note }); setBusy(false);
    if (ok) onClose();
  };
  return (
    <Modal title={`Receive goods · ${o.number}`} dark={D} onClose={onClose} xl>
      <form onSubmit={submit} className="space-y-4">
        {open.length === 0 ? <p className="text-sm text-mute">Everything on this order has been received.</p> : (
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-sm min-w-[28rem]">
              <thead><tr className="text-left text-xs uppercase tracking-wider text-faint border-b border-line"><th className="pl-3 py-2.5 font-semibold">Item</th><th className="px-3 py-2.5 font-semibold text-right">Ordered</th><th className="px-3 py-2.5 font-semibold text-right">Already in</th><th className="px-3 py-2.5 pr-3 font-semibold text-right w-28">Receive now</th></tr></thead>
              <tbody className="divide-y divide-line/70">
                {open.map(i => (
                  <tr key={i.id}>
                    <td className="pl-3 py-2.5"><div className="font-medium">{i.name}</div><div className="text-xs text-emerald-400">{i.inventoryItemId ? 'adds to inventory stock' : 'adds to inventory catalogue on receipt'}</div></td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{i.qtyOrdered} <span className="text-xs text-faint">{i.unit}</span></td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-mute">{i.qtyReceived}</td>
                    <td className="px-3 py-2 pr-3"><input aria-label={`Receive now: ${i.name}`} inputMode="numeric" value={qty[i.id] ?? ''} onChange={e => setQty(p => ({ ...p, [i.id]: e.target.value.replace(/\D/g, '') }))} className={cx(inputCls(D), 'text-right py-1.5')} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {bad && <p role="alert" className="text-xs text-rose-400">More than is left to receive on one of the lines.</p>}
        <div className="grid sm:grid-cols-2 gap-3">
          <div><label className={labelCls(D)} htmlFor="rc-l">Store location</label><select id="rc-l" value={location} onChange={e => setLocation(e.target.value)} className={inputCls(D)}><option value="">Main Store (default)</option>{inventory.locations.map(place => <option key={place.id} value={place.id}>{place.name}</option>)}</select></div>
          <div><label className={labelCls(D)} htmlFor="rc-g">Delivered by (vendor / driver)</label><input id="rc-g" value={givenBy} onChange={e => setGivenBy(e.target.value)} className={inputCls(D)} /></div>
          <div><label className={labelCls(D)} htmlFor="rc-r">Received by *</label><input id="rc-r" value={receivedBy} onChange={e => setReceivedBy(e.target.value)} className={inputCls(D)} /></div>
          <div><label className={labelCls(D)} htmlFor="rc-c">Challan / bill no.</label><input id="rc-c" value={challan} onChange={e => setChallan(e.target.value)} className={inputCls(D)} /></div>
          <div><label className={labelCls(D)} htmlFor="rc-n">Note (optional)</label><input id="rc-n" value={note} onChange={e => setNote(e.target.value)} className={inputCls(D)} /></div>
        </div>
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className={btnGhost(D)}>Cancel</button><button type="submit" disabled={!can || busy} className={good}>{busy ? 'Saving…' : 'Record received'}</button></div>
      </form>
    </Modal>
  );
};

// ---- record payment ----------------------------------------------------------

// ---- a reason box (reject an order / a payment) ---------------------------------
const ReasonModal: React.FC<{ title: string; body: string; confirm: string; onSubmit: (note: string) => Promise<boolean>; onClose: () => void }> = ({ title, body, confirm, onSubmit, onClose }) => {
  const [note, setNote] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const go = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!note.trim()) return setErr('Please write the reason. The other person will read it.');
    setBusy(true); const ok = await onSubmit(note.trim()); setBusy(false); if (ok) onClose();
  };
  return (
    <Modal title={title} dark={D} onClose={onClose}>
      <form onSubmit={go} className="space-y-3">
        <p className="text-sm text-mute">{body}</p>
        <textarea autoFocus rows={3} aria-label="Reason" className={inputCls(D)} value={note} onChange={e => { setNote(e.target.value); setErr(''); }} />
        {err && <p role="alert" className="text-xs text-rose-400">{err}</p>}
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className={btnGhost(D)}>Cancel</button><button type="submit" disabled={busy} className={cx(primary, 'bg-rose-600 hover:bg-rose-500')}>{busy ? 'Saving…' : confirm}</button></div>
      </form>
    </Modal>
  );
};

// ---- Purchase asks for a payment -------------------------------------------------
const AskPayModal: React.FC<{ id: string; onClose: () => void }> = ({ id, onClose }) => {
  const { orders, payRequests, askPayment } = usePurchase();
  const o = orders.find(x => x.id === id);
  const asked = payRequests.filter(r => r.poId === id && (r.status === 'pending' || r.status === 'approved')).reduce((a, r) => a + r.amount, 0);
  const left = o ? Math.max(0, Math.round((poDue(o) - asked) * 100) / 100) : 0;
  const [amount, setAmount] = useState(left ? String(left) : ''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  if (!o) return null;
  const amt = parseFloat(amount) || 0;
  const problem = amt > left + 0.009 ? `Only ${money(left)} can still be asked for.` : '';
  const submit = async (e: React.FormEvent) => { e.preventDefault(); if (!(amt > 0) || problem) return; setBusy(true); const ok = await askPayment(o.id, amt, note.trim()); setBusy(false); if (ok) onClose(); };
  return (
    <Modal title={`Ask for a payment · ${o.number}`} dark={D} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <div className="rounded-xl border border-line bg-canvas/60 px-4 py-3 text-xs grid grid-cols-3 gap-3 text-center">
          {([['Order total', poTotal(o), ''], ['Paid', o.paid, 'text-emerald-400'], ['Can still ask', left, 'text-amber-300']] as const).map(([l, v, c]) => <div key={l}><div className="text-faint">{l}</div><div className={cx('font-bold tabular-nums', c)}>{money(v)}</div></div>)}
        </div>
        <div><label className={labelCls(D)} htmlFor="ap-a">Amount (₹)</label><input id="ap-a" autoFocus inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value.replace(/[^\d.]/g, ''))} className={inputCls(D)} /></div>
        <div><label className={labelCls(D)} htmlFor="ap-n">What is it for? (advance, balance on delivery…)</label><input id="ap-n" value={note} onChange={e => setNote(e.target.value)} className={inputCls(D)} /></div>
        <p className="text-xs text-mute">Save the payment request here, then record it after the payment is made. No further approval is needed.</p>
        {problem && <p role="alert" className="text-xs text-rose-400">{problem}</p>}
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className={btnGhost(D)}>Cancel</button><button type="submit" disabled={!(amt > 0) || !!problem || busy} className={primary}>{busy ? 'Saving…' : 'Save payment request'}</button></div>
      </form>
    </Modal>
  );
};

// ---- Purchase pays an approved request -----------------------------------------------
const PayNowModal: React.FC<{ id: string; onClose: () => void }> = ({ id, onClose }) => {
  const { payRequests, orders, payNow, userName } = usePurchase();
  const r = payRequests.find(x => x.id === id); const o = r ? orders.find(x => x.id === r.poId) : undefined;
  const [mode, setMode] = useState('bank'); const [ref, setRef] = useState(''); const [paidBy, setPaidBy] = useState(userName); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  if (!r || !o) return null;
  const submit = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); const ok = await payNow(r.id, { mode, ref, paidBy, note }); setBusy(false); if (ok) onClose(); };
  return (
    <Modal title={`Pay · ${o.number}`} dark={D} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">Record the payment of <b className="tabular-nums">{money(r.amount)}</b>{r.note ? ` (${r.note})` : ''}.</div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={labelCls(D)} htmlFor="pn-m">Paid via</label><select id="pn-m" value={mode} onChange={e => setMode(e.target.value)} className={inputCls(D)}>{PAY_MODES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div><label className={labelCls(D)} htmlFor="pn-r">UTR / cheque / voucher no.</label><input id="pn-r" autoFocus value={ref} onChange={e => setRef(e.target.value)} className={inputCls(D)} /></div>
          <div><label className={labelCls(D)} htmlFor="pn-p">Paid by</label><input id="pn-p" value={paidBy} onChange={e => setPaidBy(e.target.value)} className={inputCls(D)} /></div>
          <div><label className={labelCls(D)} htmlFor="pn-n">Note (optional)</label><input id="pn-n" value={note} onChange={e => setNote(e.target.value)} className={inputCls(D)} /></div>
        </div>
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className={btnGhost(D)}>Cancel</button><button type="submit" disabled={busy} className={good}>{busy ? 'Saving…' : 'I have paid. Record it'}</button></div>
      </form>
    </Modal>
  );
};

// One payment request, with the buttons that fit who is looking at it.
const PayReqRow: React.FC<{ r: PaymentRequest; showOrder?: boolean; open?: (poId: string) => void }> = ({ r, showOrder, open }) => {
  const { orders, canManage, withdrawPayment } = usePurchase();
  const [paying, setPaying] = useState(false);
  const o = orders.find(x => x.id === r.poId);
  return (
    <li className="px-4 py-3 flex flex-col md:flex-row md:items-center justify-between gap-2 md:gap-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <b className="tabular-nums">{money(r.amount)}</b>
          <span className={cx('text-xs font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap', TONE[PAYREQ[r.status].tone])}>{PAYREQ[r.status].label}</span>
          {showOrder && o && <button onClick={() => open?.(o.id)} className="font-mono text-xs text-blue-400 font-bold hover:underline">{o.number}</button>}
        </div>
        <div className="text-xs text-mute mt-0.5">Asked by {r.requestedBy} · {when(r.requestedAt)}{r.note ? ` · ${r.note}` : ''}</div>
        {r.decisionNote && <div className="text-xs text-mute">Note: {r.decisionNote}</div>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {['pending', 'approved'].includes(r.status) && canManage && <><button className={good} onClick={() => setPaying(true)}><Wallet className="w-4 h-4" />Pay now</button><button className={btnGhost(D)} onClick={() => withdrawPayment(r.id)}>Cancel</button></>}
      </div>
      {paying && <PayNowModal id={r.id} onClose={() => setPaying(false)} />}
    </li>
  );
};

// ---- the buy list: everything approved that the store team said must be bought -------------------------
const BuyListView: React.FC<{ editOrder: (id: string) => void }> = ({ editOrder }) => {
  const { requests, orders: reqOrders, loadAvailability } = useRequests();
  const { orders, createOrder, canManage } = usePurchase();
  const [sel, setSel] = useState<Set<string>>(new Set()); const [busy, setBusy] = useState(false); const [q, setQ] = useState('');
  const lines = useMemo(() => requests.flatMap(r => unlinkedPurchaseParts(r)
    .map(p => ({ part: p, req: r, item: r.items.find(i => i.id === p.itemId) })).filter(x => !!x.item)) as { part: any; req: any; item: any }[], [requests]);
  const groups = useMemo(() => {
    const m = new Map<string, { key: string; name: string; unit: string; rows: typeof lines }>();
    lines.forEach(l => {
      const key = l.part.inventoryItemId || l.item.inventoryItemId || l.item.name.trim().toLowerCase();
      const g = m.get(key) || { key, name: l.item.name, unit: l.item.unit, rows: [] as typeof lines }; g.rows.push(l); m.set(key, g);
    });
    const t = q.trim().toLowerCase();
    return Array.from(m.values()).filter(g => !t || g.name.toLowerCase().includes(t) || g.rows.some(r => r.req.number.toLowerCase().includes(t))).sort((a, b) => a.name.localeCompare(b.name));
  }, [lines, q]);
  const unfinishedOrders = useMemo(() => {
    const t = q.trim().toLowerCase();
    return orders.filter(o => !o.vendorId && ['draft', 'pending', 'rejected'].includes(o.status)
      && (!t || o.number.toLowerCase().includes(t) || o.title.toLowerCase().includes(t) || o.items.some(i => i.name.toLowerCase().includes(t))))
      .sort((a, b) => a.createdAt < b.createdAt ? 1 : -1);
  }, [orders, q]);
  // Parts that left the list (ordered by someone else) disappear from the selection.
  useEffect(() => { setSel(s => { const ids = new Set(lines.map(l => l.part.id)); const n = new Set(Array.from(s).filter(x => ids.has(x))); return n.size === s.size ? s : n; }); }, [lines]);
  const toggle = (id: string) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleGroup = (ids: string[]) => setSel(s => { const n = new Set(s); const all = ids.every(i => n.has(i)); ids.forEach(i => (all ? n.delete(i) : n.add(i))); return n; });
  const chosen = lines.filter(l => sel.has(l.part.id));
  const tickets = new Set(chosen.map(l => l.req.number)).size;
  const make = async () => { setBusy(true); const id = await createOrder(chosen.map(l => l.part.id)); setBusy(false); if (id) { setSel(new Set()); editOrder(id); } };
  const dl = async () => exportRequestsXlsx(requests.filter(r => r.status === 'approved'), reqOrders, await loadAvailability(), 'buy-list');

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div className="relative w-full sm:max-w-sm"><Search className="absolute left-3 top-3 h-4 w-4 text-faint" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search item or ticket…" aria-label="Search the buy list" className={cx(inputCls(D), 'pl-9')} /></div>
        <button className={btnGhost(D)} onClick={dl}>Excel</button>
      </div>
      <p className="text-xs text-mute">Approved purchase demand that has no vendor or placed order stays here. Finish draft orders by choosing a vendor, or select unlinked request lines to create a new PO.</p>
      {unfinishedOrders.length > 0 && <Section title={`Orders needing a vendor · ${unfinishedOrders.length}`}>
        <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-xs">
          <thead className="bg-raised/40 text-left text-[10px] uppercase tracking-wide text-mute"><tr>{['Purchase order', 'Vendor / lines', 'Expected', 'Total', ''].map((x, i) => <th key={i} className="px-4 py-2.5 font-semibold">{x}</th>)}</tr></thead>
          <tbody className="divide-y divide-line/70">
            {unfinishedOrders.map(o => <tr key={o.id} className="hover:bg-raised/30">
              <td className="px-4 py-3"><div className="flex items-center gap-2"><span className="font-mono font-bold text-blue-400">{o.number}</span><span className="text-mute">For {Array.from(new Set(o.items.map(i => i.requestNumber).filter(Boolean))).join(', ') || 'request'}</span><span className="rounded-full bg-slate-500/10 px-2 py-0.5 font-medium text-slate-300">{o.status === 'rejected' ? 'Needs changes' : o.status === 'pending' ? 'Ready to place' : 'Draft'}</span>{o.vendorMode && <span className="text-[10px] font-semibold text-mute">{vendorModeLabel(o.vendorMode)}</span>}</div></td>
              <td className="px-4 py-3 text-ink-soft"><div>No vendor yet · {o.items.length} line{o.items.length === 1 ? '' : 's'} · {o.deliverTo || o.items.map(i => i.name).join(', ')}</div></td>
              <td className="px-4 py-3 text-ink-soft whitespace-nowrap">{o.expectedDate ? day(o.expectedDate) : '—'}</td>
              <td className="px-4 py-3 text-right font-semibold tabular-nums text-ink whitespace-nowrap">{money(poTotal(o))}</td>
              <td className="px-4 py-3 text-right"><button type="button" className={btnGhost(D)} onClick={() => editOrder(o.id)}>Choose vendor</button></td>
            </tr>)}
          </tbody>
        </table></div>
      </Section>}
      {groups.length === 0 && unfinishedOrders.length === 0 ? <section className={cx(panel, 'px-5 py-8 text-center')}><p className="text-sm font-medium text-ink-soft">Nothing to buy right now.</p><p className="mx-auto mt-1 max-w-xl text-xs leading-relaxed text-mute">Approved quantities with a selected vendor or already placed order are tracked under Orders.</p></section> : groups.map(g => {
        const ids = g.rows.map(r => r.part.id); const total = g.rows.reduce((a, r) => a + r.part.qty, 0);
        return (
          <section key={g.key} className={cx(panel, 'overflow-hidden')}>
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-line">
              <label className="flex items-center gap-2 text-sm font-bold cursor-pointer min-w-0">
                {canManage && <input type="checkbox" className="accent-blue-600" aria-label={`Select all ${g.name}`} checked={ids.every(i => sel.has(i))} onChange={() => toggleGroup(ids)} />}
                <span className="truncate">{g.name}</span>
              </label>
              <span className="text-sm tabular-nums text-amber-300 font-semibold shrink-0">{total} {g.unit} to buy</span>
            </div>
            <ul className="divide-y divide-line/70">
              {g.rows.map(({ part, req }) => (
                <li key={part.id} className="px-4 py-2.5 flex items-center gap-3">
                  {canManage && <input type="checkbox" className="accent-blue-600" aria-label={`Select ${req.number}`} checked={sel.has(part.id)} onChange={() => toggle(part.id)} />}
                  <div className="min-w-0 flex-1 text-sm"><span className="font-mono text-xs text-blue-400 font-bold">{req.number}</span> <span className="text-ink-soft">{req.title}</span>
                    <div className="text-xs text-mute">{req.requesterName}{req.deliverTo ? ` · deliver to ${req.deliverTo}` : ''}{req.neededBy ? ` · needed by ${day(req.neededBy)}` : ''}{req.priority === 'urgent' ? ' · URGENT' : ''}</div></div>
                  <span className="tabular-nums text-sm shrink-0">{part.qty} {g.unit}</span>
                </li>))}
            </ul>
          </section>);
      })}
      {canManage && chosen.length > 0 && (
        <div className="sticky bottom-3 z-10 rounded-xl border border-blue-500/40 bg-surface shadow-lg px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm"><b>{chosen.length}</b> line{chosen.length === 1 ? '' : 's'} selected from <b>{tickets}</b> ticket{tickets === 1 ? '' : 's'}</div>
          <div className="flex gap-2"><button className={btnGhost(D)} onClick={() => setSel(new Set())}>Clear</button><button className={primary} disabled={busy} onClick={make}><ShoppingCart className="w-4 h-4" />{busy ? 'Creating…' : 'Create one order'}</button></div>
        </div>)}
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
type TrackingStage = typeof TRACKING_STAGES[number]['id'];
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
  const onlineOrders = useMemo(() => orders.filter(order => {
    const vendor = vendors.find(row => row.id === order.vendorId);
    return (order.vendorMode || vendor?.vendorMode) === 'online' && !['cancelled', 'rejected'].includes(order.status);
  }), [orders, vendors]);
  const rows = useMemo(() => onlineOrders.map(order => {
    const trackingRows = trackings.filter(row => row.poId === order.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const isDelivered = order.status === 'received' || trackingRows.some(row => /deliver/i.test(row.status) || /deliver/i.test(row.subStatus));
    const hasAutomatic = trackingRows.some(row => !!row.trackingNumber);
    const hasMarketplaceConfirmation = trackingRows.some(row => !!row.marketplaceOrderNumber);
    const orderPlaced = ['ordered', 'partial', 'received'].includes(order.status);
    const currentStage: TrackingStage = isDelivered ? 'delivered' : hasAutomatic ? 'automatic' : hasMarketplaceConfirmation ? 'confirmed' : orderPlaced ? 'waiting' : 'place';
    const vendor = vendors.find(row => row.id === order.vendorId);
    const ticketNumbers = Array.from(new Set(order.items.map(item => item.requestNumber).filter(Boolean)));
    const latestTracking = trackingRows[0];
    const searchText = [order.number, order.title, vendor?.name || '', ...ticketNumbers, ...order.items.map(item => item.name), ...trackingRows.flatMap(row => [row.marketplaceOrderNumber, row.trackingNumber])].join(' ').toLowerCase();
    return { order, trackingRows, currentStage, vendorName: vendor?.name || 'Online marketplace', ticketNumbers, latestTracking, searchText };
  }), [onlineOrders, trackings, vendors]);
  const visible = rows.filter(row => row.currentStage === stage && (!q.trim() || row.searchText.includes(q.trim().toLowerCase())));
  const counts = TRACKING_STAGES.reduce((result, item) => {
    result[item.id] = rows.filter(row => row.currentStage === item.id).length;
    return result;
  }, {} as Record<TrackingStage, number>);
  return <div className="space-y-4">
    <div><h2 className="text-sm font-semibold text-ink">Order tracking</h2><p className="mt-1 text-xs text-mute">Follow each online purchase ticket from order placement through courier delivery. Marketplace order IDs stay as references; AWB updates appear automatically after dispatch.</p></div>
    <nav className="flex gap-1 overflow-x-auto border-b border-line" aria-label="Order tracking stages">
      {TRACKING_STAGES.map(item => <button key={item.id} type="button" onClick={() => setStage(item.id)} aria-current={stage === item.id ? 'page' : undefined} className={cx('relative shrink-0 px-3 py-2.5 text-xs font-semibold transition-colors', stage === item.id ? 'text-blue-300' : 'text-mute hover:text-ink')}>
        {item.label}<span className={cx('ml-2 rounded-full px-1.5 py-0.5 text-[10px] tabular-nums', stage === item.id ? 'bg-blue-500/15 text-blue-200' : 'bg-raised text-faint')}>{counts[item.id]}</span>
        {stage === item.id && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-blue-500" />}
      </button>)}
    </nav>
    <p className="text-xs text-mute">{TRACKING_STAGE_HELP[stage]}</p>
    <label className="relative block w-full sm:max-w-sm"><Search className="absolute left-3 top-3 h-4 w-4 text-faint" /><input value={q} onChange={event => setQ(event.target.value)} placeholder="Search ticket, PO, vendor or item…" aria-label="Search order tracking" className={cx(inputCls(D), 'pl-9')} /></label>
    <section className={cx(panel, 'overflow-hidden')}>
      {visible.length === 0 ? <Empty>{loading ? 'Loading orders…' : onlineOrders.length === 0 ? 'No online purchase orders yet.' : 'No orders in this stage.'}</Empty> : <ul className="divide-y divide-line/70">{visible.map(({ order, trackingRows, vendorName, ticketNumbers, latestTracking }) => {
        const latestEvent = latestTracking && [...latestTracking.checkpoints].sort((a, b) => String(b.checkpoint_time || '').localeCompare(String(a.checkpoint_time || '')))[0];
        const title = stage === 'place' ? STATUS[order.status]?.label || 'Ready to place' : stage === 'waiting' ? 'Waiting for shipment details' : stage === 'confirmed' ? 'Order ID saved · awaiting dispatch' : stage === 'delivered' ? order.status === 'received' ? 'Goods received' : 'Delivered by carrier' : latestTracking?.subStatus || latestTracking?.status || 'Courier tracking active';
        return <li key={order.id}><button type="button" onClick={() => open(order.id)} className="w-full px-4 py-3.5 text-left transition-colors hover:bg-raised/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
          <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs font-bold text-blue-300">{order.number}</span><span className="font-semibold text-sm text-ink">{order.title}</span><span className={cx('rounded-full px-2 py-0.5 text-[10px] font-semibold', stage === 'delivered' ? 'bg-emerald-500/10 text-emerald-300' : stage === 'automatic' ? 'bg-blue-500/10 text-blue-300' : stage === 'place' ? 'bg-amber-500/10 text-amber-300' : 'bg-slate-500/10 text-slate-300')}>{title}</span></div>
            <div className="mt-1 text-xs text-mute">{vendorName} · {ticketNumbers.length ? 'For ' + ticketNumbers.join(', ') : order.items.length + ' line(s)'} · {order.items.map(item => item.name + ' × ' + item.qtyOrdered + ' ' + item.unit).join(', ')}</div>
            {trackingRows.map(row => <div key={row.id} className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-soft">{row.marketplaceOrderNumber && <span>Order ID {row.marketplaceOrderNumber}</span>}{row.trackingNumber && <span>{row.courierSlug || 'Courier'} · AWB {row.trackingNumber}</span>}{row.estimatedDelivery && <span>Expected {day(row.estimatedDelivery)}</span>}{row.trackingUrl && <a href={row.trackingUrl} target="_blank" rel="noreferrer" onClick={event => event.stopPropagation()} className="text-blue-300 hover:underline">Track shipment</a>}</div>)}
            {latestEvent && (latestEvent.message || latestEvent.tag) && <div className="mt-1 text-[11px] text-mute">Latest update: {latestEvent.message || latestEvent.tag}{latestEvent.location ? ' · ' + latestEvent.location : ''}{latestEvent.checkpoint_time ? ' · ' + when(latestEvent.checkpoint_time) : ''}</div>}
          </div><div className="shrink-0 text-right"><div className="text-[10px] text-faint">Expected</div><div className="text-xs text-ink-soft">{day(order.expectedDate)}</div><div className="mt-1 text-sm font-bold tabular-nums text-ink">{money(poTotal(order))}</div></div></div>
        </button></li>;
      })}</ul>}
    </section>
  </div>;
};
// ---- vendor + rates (the lines themselves come from the tickets) ------------------------------------------
const OrderEditModal: React.FC<{ id: string; onClose: () => void }> = ({ id, onClose }) => {
  const { orders, vendors, saveDraft } = usePurchase();
  const o = orders.find(x => x.id === id);
  const [vendorId, setVendorId] = useState(o?.vendorId || ''); const [expected, setExpected] = useState(o?.expectedDate || ''); const [notes, setNotes] = useState(o?.notes || '');
  const [vendorMode, setVendorMode] = useState<VendorMode>(vendors.find(v => v.id === o?.vendorId)?.vendorMode || o?.vendorMode || 'online');
  const [rates, setRates] = useState<Record<string, string>>(() => Object.fromEntries((o?.items || []).map(i => [i.id, i.rate ? String(i.rate) : ''])));
  const [busy, setBusy] = useState(false);
  if (!o) return null;
  const num = (id2: string) => parseFloat(rates[id2]) || 0;
  const total = o.items.reduce((a, i) => a + i.qtyOrdered * num(i.id), 0);
  const save = async (submit: boolean) => {
    setBusy(true);
    const ok = await saveDraft(o.id, { vendorId, vendorMode, expectedDate: expected, notes, rates: Object.fromEntries(o.items.map(i => [i.id, num(i.id)])) }, submit);
    setBusy(false); if (ok) onClose();
  };
  return (
    <Modal title={`${o.number} · vendor and rates`} dark={D} onClose={onClose} xl>
      <div className="space-y-4">
        {o.status === 'rejected' && o.decisionNote && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">Order needs changes: {o.decisionNote}</div>}
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          <div><label className={labelCls(D)} htmlFor="oe-mode">Vendor type</label>
            <select id="oe-mode" value={vendorMode} onChange={e => { const mode = e.target.value as VendorMode; setVendorMode(mode); if (vendors.find(v => v.id === vendorId)?.vendorMode !== mode) setVendorId(''); }} className={inputCls(D)}><option value="online">Online marketplace</option><option value="offline">Offline / local vendor</option></select></div>
          <div><label className={labelCls(D)} htmlFor="oe-v">Choose vendor</label>
            <select id="oe-v" value={vendorId} onChange={e => setVendorId(e.target.value)} className={inputCls(D)}><option value="">Choose {vendorMode === 'online' ? 'an online marketplace' : 'a local'} vendor…</option>{vendors.filter(v => v.vendorMode === vendorMode).map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></div>
          <div><label className={labelCls(D)} htmlFor="oe-d">Expected delivery</label><input id="oe-d" type="date" value={expected} onChange={e => setExpected(e.target.value)} className={inputCls(D)} /></div>
          <div><label className={labelCls(D)} htmlFor="oe-n">Note</label><input id="oe-n" value={notes} onChange={e => setNotes(e.target.value)} className={inputCls(D)} /></div>
        </div>
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-sm min-w-[32rem]">
            <thead><tr className="text-left text-xs uppercase tracking-wider text-faint border-b border-line"><th className="pl-3 py-2.5 font-semibold">Item</th><th className="px-3 py-2.5 font-semibold text-right">Qty</th><th className="px-3 py-2.5 font-semibold text-right w-32">Rate (₹)</th><th className="px-3 py-2.5 pr-3 font-semibold text-right">Amount</th></tr></thead>
            <tbody className="divide-y divide-line/70">
              {o.items.map(i => (
                <tr key={i.id}>
                  <td className="pl-3 py-2"><div className="font-medium">{i.name}</div>{i.requestNumber && <div className="text-xs text-mute">for {i.requestNumber}</div>}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{i.qtyOrdered} <span className="text-xs text-faint">{i.unit}</span></td>
                  <td className="px-3 py-2"><input aria-label={`Rate for ${i.name}`} inputMode="decimal" value={rates[i.id] ?? ''} onChange={e => setRates(r => ({ ...r, [i.id]: e.target.value.replace(/[^\d.]/g, '') }))} className={cx(inputCls(D), 'text-right tabular-nums')} /></td>
                  <td className="px-3 py-2 pr-3 text-right tabular-nums font-semibold">{money(i.qtyOrdered * num(i.id))}</td>
                </tr>))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span className="text-sm text-mute">Total <b className="text-ink tabular-nums">{money(total)}</b></span>
          <div className="flex gap-2"><button className={btnGhost(D)} onClick={onClose}>Cancel</button><button className={btnGhost(D)} disabled={busy} onClick={() => save(false)}>Save draft</button>{vendorMode && <button className={primary} disabled={busy} onClick={() => save(true)}>{busy ? 'Saving…' : vendorMode === 'online' ? 'Place marketplace order & track' : 'Mark local order placed'}</button>}</div>
        </div>
        <p className="text-xs text-mute">{vendorMode === 'online' ? 'Place the order on the e-commerce marketplace (such as Amazon or Flipkart), then record it here. Add the marketplace order number and courier details for tracking.' : vendorMode === 'offline' ? 'Place the order directly with the local supplier, then mark it here. Marketplace tracking is not used.' : 'Choose a vendor category to continue: online marketplace (e-commerce brand) or offline/local supplier.'} Order lines come from approved requests.</p>
      </div>
    </Modal>
  );
};

// ---- order detail ------------------------------------------------------------------------------------------
const OrderModal: React.FC<{ id: string; onClose: () => void; onEdit: (id: string) => void; onReceive: (id: string) => void; onAsk: (id: string) => void }> = ({ id, onClose, onEdit, onReceive, onAsk }) => {
  const { orders, vendors, payRequests, trackings, canManage, canReceive, setStatus, deleteOrder, fetchReceipts, fetchPayments, registerTracking } = usePurchase();
  const { requests } = useRequests();
  const o = orders.find(x => x.id === id);
  const [rc, setRc] = useState<Receipt[] | null>(null);
  const [pm, setPm] = useState<Payment[] | null>(null);
  const [ask, setAsk] = useState<'cancel' | 'delete' | 'reject' | null>(null);
  const [trackingLine, setTrackingLine] = useState('');
  const [trackingVendorId, setTrackingVendorId] = useState(o?.vendorId || '');
  const [marketplaceOrderNumber, setMarketplaceOrderNumber] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [courierSlug, setCourierSlug] = useState('');
  const [trackingBusy, setTrackingBusy] = useState(false);
  const [showTrackingForm, setShowTrackingForm] = useState(false);
  const sig = o ? o.paid * 3 + o.items.reduce((a, i) => a + i.qtyReceived, 0) : 0;
  useEffect(() => { if (!o) return; let on = true; fetchReceipts(id).then(r => on && setRc(r)); if (canManage) fetchPayments(id).then(r => on && setPm(r)); return () => { on = false; }; }, [id, sig]); // eslint-disable-line
  useEffect(() => {
    if (!o) return;
    const current = vendors.find(v => v.id === o.vendorId && v.vendorMode === 'online');
    setTrackingVendorId(previous => vendors.some(v => v.id === previous && v.vendorMode === 'online') ? previous : current?.id || vendors.find(v => v.vendorMode === 'online')?.id || '');
  }, [id, o?.vendorId, vendors]);
  if (!o) return <Modal title="Order" dark={D} onClose={onClose}><p className="text-sm text-mute">This order no longer exists.</p></Modal>;
  const vendor = vendors.find(v => v.id === o.vendorId);
  const total = poTotal(o); const due = poDue(o);
  const mine = payRequests.filter(r => r.poId === o.id);
  const asked = mine.filter(r => r.status === 'pending' || r.status === 'approved').reduce((a, r) => a + r.amount, 0);
  const tickets = Array.from(new Set(o.items.map(i => i.requestNumber).filter(Boolean)));
  const linkedRequests = requests.filter(r => tickets.includes(r.number));
  const approvedRequestBudget = linkedRequests.reduce((sum, r) => sum + r.items.reduce((a, item) => a + (item.budgetAmount || 0), 0) + r.miscBudget, 0);
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
  const lineBudgetOverage = Array.from(linkedLineSpend.values()).reduce((sum, line) => sum + Math.max(0, line.spent - line.budget), 0);
  const hasMissingLineBudget = o.items.some(item => approvedLineBudget(item) == null);
  const linkedOrderTotal = orders.reduce((sum, order) => sum + order.items.filter(item => tickets.includes(item.requestNumber)).reduce((orderSum, item) => orderSum + item.qtyOrdered * item.rate, 0), 0);
  const remainingApprovedBudget = approvedRequestBudget - linkedOrderTotal;
  const act = (s: POStatus, msg: string, note?: string) => setStatus(o.id, s, msg, note);
  const orderTrackings = trackings.filter(t => t.poId === o.id);
  const trackingVendors = vendors.filter(v => v.vendorMode === 'online');
  const trackingVendor = trackingVendors.find(v => v.id === trackingVendorId);
  const addTracking = async (e: React.FormEvent) => {
    e.preventDefault(); if (!trackingVendor || !trackingLine || (!trackingNumber.trim() && !marketplaceOrderNumber.trim())) return;
    setTrackingBusy(true);
    const ok = await registerTracking({ poId: o.id, purchaseItemId: trackingLine, vendorId: trackingVendor.id, marketplaceOrderNumber, trackingNumber, courierSlug });
    setTrackingBusy(false);
    if (ok) { setTrackingLine(''); setMarketplaceOrderNumber(''); setTrackingNumber(''); setCourierSlug(''); setShowTrackingForm(false); }
  };
  return (
    <Modal title={`${o.number} · ${o.title}`} dark={D} onClose={onClose} xl>
      <div className="flex flex-wrap items-center gap-2 mb-4"><StatusChip s={o.status} />{o.vendorMode && <span className="rounded-full border border-line-strong bg-raised px-2 py-0.5 text-xs font-semibold text-ink-soft">{o.vendorMode === 'online' ? 'Online marketplace order' : 'Offline vendor order'}</span>}<PayChip po={o} />{overdue(o) && <span className={cx('text-xs font-semibold px-2 py-0.5 rounded-full border', TONE.bad)}>Overdue</span>}</div>
      {o.status === 'rejected' && <div className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">Rejected by {o.approvedBy}: {o.decisionNote || 'no reason given'}</div>}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-5 gap-y-3 rounded-xl border border-line bg-raised/20 px-4 py-3.5 mb-3">
        <Info label="Vendor">{vendor ? <>{vendor.name}{vendor.phone && <div className="text-xs text-mute">{vendor.phone}</div>}</> : null}</Info>
        <Info label="Deliver to">{o.deliverTo}</Info>
        <Info label="Expected">{o.expectedDate ? day(o.expectedDate) : ''}</Info>
        <Info label="Approved request budget (incl. misc.)">{linkedRequests.length ? money(approvedRequestBudget) : ''}</Info>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-mute"><span>For {tickets.join(', ') || '—'}</span><span>Created by {o.createdBy || '—'}</span>{o.approvedBy && <span>Approved by {o.approvedBy}{o.approvedAt ? ` · ${day(o.approvedAt.slice(0, 10))}` : ''}</span>}</div>
      {o.notes && <p className="text-xs text-mute mb-4">Note: {o.notes}</p>}

      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full text-sm min-w-[44rem] table-fixed">
          <colgroup><col className="w-[32%]" /><col className="w-[11%]" /><col className="w-[10%]" /><col className="w-[19%]" /><col className="w-[13%]" /><col className="w-[15%]" /></colgroup>
          <thead><tr className="text-left text-[10px] uppercase tracking-wide text-faint border-b border-line"><th className="pl-3 py-2.5 font-semibold">Item</th><th className="px-2 py-2.5 font-semibold text-right">Ordered</th><th className="px-2 py-2.5 font-semibold text-right">Received</th><th className="px-2 py-2.5 font-semibold text-right">Approved budget</th><th className="px-2 py-2.5 font-semibold text-right">Rate</th><th className="px-3 py-2.5 font-semibold text-right">Amount</th></tr></thead>
          <tbody className="divide-y divide-line/70">
            {o.items.map(i => (
              <tr key={i.id}>
                <td className="pl-3 py-2.5"><div className="font-medium">{i.name}</div><div className="text-xs text-mute">{i.requestNumber ? `for ${i.requestNumber}` : ''}{i.inventoryItemId ? `${i.requestNumber ? ' · ' : ''}adds to inventory stock` : ''}</div></td>
                <td className="px-2 py-2.5 text-right tabular-nums whitespace-nowrap">{i.qtyOrdered} <span className="text-xs text-faint">{i.unit}</span></td>
                <td className={cx('px-2 py-2.5 text-right tabular-nums', i.qtyReceived >= i.qtyOrdered ? 'text-emerald-400' : i.qtyReceived > 0 ? 'text-amber-300' : 'text-faint')}>{i.qtyReceived}</td>
                <td className="px-2 py-2.5 text-right tabular-nums whitespace-nowrap">{approvedLineBudget(i) == null ? <span className="text-faint">—</span> : money(approvedLineBudget(i)!)}</td>
                <td className="px-2 py-2.5 text-right tabular-nums whitespace-nowrap">{i.rate ? money(i.rate) : <span className="text-faint">—</span>}</td>
                <td className="px-3 py-2.5 text-right tabular-nums font-semibold whitespace-nowrap">{i.rate ? money(i.qtyOrdered * i.rate) : <span className="text-faint">—</span>}</td>
              </tr>))}
          </tbody>
        </table>
      </div>
      {linkedRequests.length > 0 && <section className="mt-3 rounded-xl border border-line bg-raised/20 p-3 sm:p-4">
        <div className="text-xs font-semibold text-ink">Budget check</div>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-lg border border-line bg-surface/50 px-3 py-2"><div className="text-[10px] text-mute">Approved item budget · these lines</div><div className="mt-0.5 text-sm font-semibold tabular-nums">{money(approvedBudgetForOrderLines)}</div></div>
          <div className="rounded-lg border border-line bg-surface/50 px-3 py-2"><div className="text-[10px] text-mute">Miscellaneous budget</div><div className="mt-0.5 text-sm font-semibold tabular-nums">{money(miscellaneousBudget)}</div></div>
          <div className="rounded-lg border border-line bg-surface/50 px-3 py-2"><div className="text-[10px] text-mute">This purchase order</div><div className="mt-0.5 text-sm font-semibold tabular-nums">{money(total)}</div></div>
          <div className="rounded-lg border border-line bg-surface/50 px-3 py-2"><div className="text-[10px] text-mute">All linked POs · approved total</div><div className={cx('mt-0.5 text-sm font-semibold tabular-nums', remainingApprovedBudget < 0 ? 'text-rose-300' : 'text-ink')}>{remainingApprovedBudget < 0 ? `${money(Math.abs(remainingApprovedBudget))} over` : `${money(remainingApprovedBudget)} left`}</div></div>
        </div>
        {lineBudgetOverage > 0 ? <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          Linked order amounts are <b className="tabular-nums">{money(lineBudgetOverage)}</b> over the approved item budget. {remainingApprovedBudget >= 0 ? <>The linked requests still have <b className="tabular-nums">{money(remainingApprovedBudget)}</b> against their overall approved total, which includes the separate miscellaneous budget.</> : <>The linked purchase orders are also <b className="tabular-nums">{money(Math.abs(remainingApprovedBudget))}</b> over the overall approved total.</>}
        </div> : hasMissingLineBudget ? <div className="mt-2 text-xs text-mute">Some item lines do not have an approved budget, so the item budget comparison is incomplete.</div> : <div className="mt-2 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">This order is within the approved item budget.</div>}
        <div className="mt-2 text-[11px] text-mute">Approved request total: {money(approvedRequestBudget)} = item budgets {money(approvedRequestBudget - miscellaneousBudget)} + miscellaneous {money(miscellaneousBudget)}.</div>
      </section>}
      <div className="flex flex-wrap justify-end gap-x-6 gap-y-2 mt-3 text-sm">
        <span className="text-mute">Total <b className="text-ink tabular-nums">{money(total)}</b></span>
        {PAYABLE.includes(o.status) && <><span className="text-mute">Paid <b className="text-emerald-400 tabular-nums">{money(o.paid)}</b></span><span className="text-mute">Due <b className="text-amber-300 tabular-nums">{money(due)}</b></span></>}
      </div>

      {o.vendorMode === 'online' && ['ordered', 'partial', 'received'].includes(o.status) && !orderTrackings.length && !showTrackingForm && canManage && <div className="mt-5 flex items-center justify-between gap-3 rounded-xl border border-line bg-raised/20 px-4 py-3"><span className="text-xs text-mute">Save the marketplace order ID now; connect live delivery updates when the seller shares the courier AWB.</span><button type="button" className={btnGhost(D)} onClick={() => { if (o.items.length === 1) setTrackingLine(o.items[0].id); setShowTrackingForm(true); }}>Add order details</button></div>}
      {o.vendorMode === 'online' && ['ordered', 'partial', 'received'].includes(o.status) && (orderTrackings.length > 0 || showTrackingForm) && <section className={cx(panel, 'mt-5 overflow-hidden')}>
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3"><div><h3 className="text-sm font-semibold">Order tracking</h3><p className="mt-0.5 text-xs text-mute">Save the marketplace order ID now. Add the courier AWB after dispatch for automatic delivery updates.</p></div>{canManage && <button type="button" className={btnGhost(D)} onClick={() => { const pending = orderTrackings.find(t => !t.trackingNumber); if (pending) { setTrackingLine(pending.purchaseItemId); setMarketplaceOrderNumber(pending.marketplaceOrderNumber); } else if (o.items.length === 1) setTrackingLine(o.items[0].id); setShowTrackingForm(v => !v); }}>{showTrackingForm ? 'Close' : orderTrackings.some(t => !t.trackingNumber) ? 'Add courier AWB' : 'Add order details'}</button>}</div>
        {canManage && showTrackingForm && <form onSubmit={addTracking} className="grid gap-2 border-b border-line p-3 sm:grid-cols-2 xl:grid-cols-6">
          <div><select aria-label="Online vendor" required className={inputCls(D)} value={trackingVendorId} onChange={e => setTrackingVendorId(e.target.value)}><option value="">Choose online vendor</option>{trackingVendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select><p className="mt-1 text-[10px] text-mute">Choose the online vendor saved on this PO.</p></div>
          <select aria-label="Purchase item" className={inputCls(D)} value={trackingLine} onChange={e => setTrackingLine(e.target.value)}><option value="">Choose item</option>{o.items.map(item => <option key={item.id} value={item.id}>{item.name} · {item.qtyOrdered} {item.unit}</option>)}</select>
          <input aria-label="Marketplace order ID" className={inputCls(D)} value={marketplaceOrderNumber} onChange={e => setMarketplaceOrderNumber(e.target.value)} placeholder="Marketplace order ID" />
          <input aria-label="Courier tracking number or AWB (optional until dispatch)" className={inputCls(D)} value={trackingNumber} onChange={e => setTrackingNumber(e.target.value)} placeholder="Courier tracking no. / AWB (after dispatch)" />
          <input aria-label="Courier slug (optional)" className={inputCls(D)} value={courierSlug} onChange={e => setCourierSlug(e.target.value)} placeholder="Courier (optional)" />
          <button className={primary} disabled={trackingBusy || !trackingVendor || !trackingLine || (!trackingNumber.trim() && !marketplaceOrderNumber.trim())}>{trackingBusy ? 'Saving…' : trackingNumber.trim() ? 'Connect live tracking' : 'Save order ID'}</button>
        </form>}
        {!!orderTrackings.length && <ul className="divide-y divide-line/70">{orderTrackings.map(t => {
          const item = o.items.find(i => i.id === t.purchaseItemId);
          const latest = [...t.checkpoints].sort((a, b) => String(b.checkpoint_time || '').localeCompare(String(a.checkpoint_time || '')))[0];
          return <li key={t.id} className="px-4 py-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2"><div className="font-semibold text-ink">{item?.name || 'Order item'} · {t.marketplace === 'other' ? 'Marketplace' : t.marketplace[0].toUpperCase() + t.marketplace.slice(1)}{t.marketplaceOrderNumber && <span className="ml-2 font-normal text-mute">Order {t.marketplaceOrderNumber}</span>}</div><span className="rounded-full bg-blue-500/10 px-2 py-1 font-semibold text-blue-300">{t.subStatus || t.status}</span></div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-mute">{t.marketplaceOrderNumber && <span>Marketplace order ID: {t.marketplaceOrderNumber}</span>}{t.trackingNumber ? <span>{t.courierSlug || 'Auto-detected courier'} · AWB {t.trackingNumber}</span> : <span>Waiting for seller to dispatch and share the courier AWB</span>}{t.estimatedDelivery && <span>Expected {day(t.estimatedDelivery)}</span>}{t.trackingUrl && <a className="text-blue-300 hover:underline" href={t.trackingUrl} target="_blank" rel="noreferrer">Carrier tracking</a>}</div>
            {latest && <div className="mt-2 text-ink-soft">Latest: {latest.message || latest.tag || t.status}{latest.location ? ` · ${latest.location}` : ''}{latest.checkpoint_time ? ` · ${when(latest.checkpoint_time)}` : ''}</div>}
          </li>;
        })}</ul>}
      </section>}

      {canManage && mine.length > 0 && <div className="mt-6"><div className="text-xs font-semibold text-mute mb-1">Payment requests</div><ul className={cx(panel, 'overflow-hidden divide-y divide-line/70')}>{mine.map(r => <PayReqRow key={r.id} r={r} />)}</ul></div>}
      {(rc === null || rc.length > 0) && <div className="mt-6"><div className="text-xs font-semibold text-mute mb-1">Goods received</div><div className={cx(panel, 'overflow-hidden')}><ReceiptList rows={rc} empty="" showPo={false} /></div></div>}
      {canManage && (pm === null || pm.length > 0) && <div className="mt-5"><div className="text-xs font-semibold text-mute mb-1">Payments made</div><div className={cx(panel, 'overflow-hidden')}><PaymentList rows={pm} empty="" showPo={false} /></div></div>}

      <div className="sticky bottom-0 z-10 -mx-5 mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface/95 px-5 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        {canManage && ['draft', 'pending', 'rejected'].includes(o.status) && <button className={btnGhost(D)} onClick={() => onEdit(o.id)}><Edit3 className="w-3.5 h-3.5" />Vendor and rates</button>}
        {canManage && ['draft', 'pending', 'rejected'].includes(o.status) && <button className={primary} onClick={() => onEdit(o.id)}><Check className="w-4 h-4" />{o.vendorMode === 'offline' ? 'Mark local order placed' : o.vendorMode === 'online' ? 'Place marketplace order & track' : 'Choose vendor category'}</button>}
        {canManage && o.status === 'approved' && <button className={primary} onClick={() => act('ordered', 'Marked as ordered.')}>I have placed the order</button>}
        {canReceive && INCOMING.includes(o.status) && <button className={good} onClick={() => onReceive(o.id)}><Truck className="w-4 h-4" />Receive goods</button>}
        {canManage && PAYABLE.includes(o.status) && due - asked > 0.009 && <button className={btnGhost(D)} onClick={() => onAsk(o.id)}>Ask for a payment</button>}
        {canManage && ['draft', 'pending', 'approved', 'rejected', 'ordered'].includes(o.status) && !o.items.some(i => i.qtyReceived > 0) && <button className={cx(btnGhost(D), 'text-rose-400')} onClick={() => setAsk('cancel')}>Cancel order</button>}
        {canManage && ['draft', 'rejected', 'cancelled'].includes(o.status) && <button className={cx(btnGhost(D), 'text-rose-400')} onClick={() => setAsk('delete')} aria-label="Delete order"><Trash2 className="w-3.5 h-3.5" /></button>}
      </div>

      {ask === 'reject' && <ReasonModal title="Reject this order?" body="Purchase sees your reason, fixes the rates or the vendor, and sends it again." confirm="Reject order" onSubmit={n => act('rejected', 'Order rejected.', n).then(ok => { if (ok) onClose(); return ok; })} onClose={() => setAsk(null)} />}
      {ask === 'cancel' && <ConfirmModal dark={D} title="Cancel this order?" body="The order is closed. Its items go back to the buy list so they can be ordered again, and the requesters are told." confirmLabel="Cancel order" onConfirm={() => { act('cancelled', 'Order cancelled.'); setAsk(null); }} onClose={() => setAsk(null)} />}
      {ask === 'delete' && <ConfirmModal dark={D} title={`Delete ${o.number}?`} body="The order is removed. Its items go back to the buy list." confirmLabel="Delete" onConfirm={() => { deleteOrder(o.id).then(ok => ok && onClose()); }} onClose={() => setAsk(null)} />}
    </Modal>
  );
};

// ---- payments ----------------------------------------------------------------------------------------------
const PaymentsView: React.FC<{ open: (id: string) => void; onAsk: (id: string) => void }> = ({ open, onAsk }) => {
  const { orders, payRequests, vendorName, canManage, stats } = usePurchase();
  const ready = payRequests.filter(r => r.status === 'pending' || r.status === 'approved');
  const closed = payRequests.filter(r => ['paid', 'rejected', 'cancelled'].includes(r.status)).slice(0, 30);
  const asked = (poId: string) => payRequests.filter(r => r.poId === poId && (r.status === 'pending' || r.status === 'approved')).reduce((a, r) => a + r.amount, 0);
  const due = orders.filter(o => PAYABLE.includes(o.status) && poDue(o) - asked(o.id) > 0.009);
  const rows = useLedger<Payment>('payments', 300);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <Stat label="Still to pay" value={money(stats.due)} dot="bg-amber-400" />
        <Stat label="Ready to pay" value={ready.length} dot="bg-blue-400" />
        <Stat label="Orders with money due" value={orders.filter(o => PAYABLE.includes(o.status) && poDue(o) > 0).length} dot="bg-rose-400" />
      </div>
      {ready.length > 0 && <Section title={`Ready to pay (${ready.length})`}><ul className="divide-y divide-line/70">{ready.map(r => <PayReqRow key={r.id} r={r} showOrder open={open} />)}</ul></Section>}
      <Section title={`Orders where a payment can be asked for (${due.length})`}>
        {due.length === 0 ? <Empty>Nothing more to ask for.</Empty> : (
          <ul className="divide-y divide-line/70">
            {due.map(o => (
              <li key={o.id} className="px-4 py-3 flex items-center justify-between gap-3">
                <button className="min-w-0 text-left" onClick={() => open(o.id)}>
                  <div className="font-semibold text-sm truncate">{o.number} · {o.title}</div>
                  <div className="text-xs text-faint">{vendorName(o.vendorId)} · total {money(poTotal(o))} · paid {money(o.paid)}</div>
                </button>
                <div className="flex items-center gap-2 shrink-0"><b className="tabular-nums text-amber-300">{money(poDue(o))}</b>{canManage && <button className={btnGhost(D)} onClick={() => onAsk(o.id)}>Ask for a payment</button>}</div>
              </li>))}
          </ul>)}
      </Section>
      {closed.length > 0 && <Section title="Earlier payment requests"><ul className="divide-y divide-line/70">{closed.map(r => <PayReqRow key={r.id} r={r} showOrder open={open} />)}</ul></Section>}
      <Section title="Payments made"><PaymentList rows={rows} empty="No payments recorded yet." /></Section>
    </div>
  );
};

// ---- the procurement desk -----------------------------------------------------------------------------
export const PurchaseDesk: React.FC<{ view: DeskView }> = ({ view }) => {
  const { loadError, canManage, canReceive } = usePurchase();
  const [filter, setFilter] = useState<POStatus | 'all'>('all');
  const [viewing, setViewing] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [receiving, setReceiving] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  return (
    <div className="space-y-5">
      {!canManage && <div className="p-3 bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded-xl text-xs">🔒 {canReceive ? 'You can view orders and record goods received, but not change orders.' : 'You can view orders but not change them.'}</div>}
      {loadError && <div role="alert" className="rounded-xl border border-rose-500/40 bg-rose-500/10 text-rose-400 text-sm p-3">Could not load purchases: {loadError}</div>}
      {view === 'buy' && <BuyListView editOrder={setEditing} />}
      {view === 'tracking' && <OrderTrackingView open={setViewing} />}
      {view === 'orders' && <OrdersView filter={filter} setFilter={setFilter} open={setViewing} />}
      {view === 'vendors' && <VendorsView />}
      {view === 'receiving' && <ReceivingView open={setViewing} onReceive={setReceiving} />}
      {view === 'payments' && <PaymentsView open={setViewing} onAsk={setAsking} />}

      {viewing && !editing && !receiving && !asking && <OrderModal id={viewing} onClose={() => setViewing(null)} onEdit={setEditing} onReceive={setReceiving} onAsk={setAsking} />}
      {editing && <OrderEditModal id={editing} onClose={() => setEditing(null)} />}
      {receiving && <ReceiveModal id={receiving} onClose={() => setReceiving(null)} />}
      {asking && <AskPayModal id={asking} onClose={() => setAsking(null)} />}
    </div>
  );
};

const PURCHASE_TABS: { id: DeskView; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'buy', label: 'Buy list', icon: ShoppingCart }, { id: 'tracking', label: 'Order tracking', icon: ClipboardList }, { id: 'orders', label: 'Orders', icon: Check },
  { id: 'receiving', label: 'Receiving', icon: Truck }, { id: 'payments', label: 'Payments', icon: Wallet },
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
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [tab]);
  const go = (next: DeskView) => { setTab(next); location.hash = `#/purchase/${next}`; };
  return <div className="space-y-3">
    <header className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-base font-semibold text-ink">Procurement</h2><p className="text-xs text-mute">Order, receive, and pay for approved department requests.</p></div></header>
    <section aria-label="Purchase totals" className="grid grid-cols-3 gap-2">
      {totals.map(([label, amount]) => <div key={label} className="rounded-lg border border-line bg-surface px-3 py-2"><div className="text-[10px] font-medium text-mute">{label}</div><div className="mt-0.5 truncate text-sm font-semibold tabular-nums text-ink">{money(amount)}</div></div>)}
    </section>
    <nav ref={navRef} className="relative flex gap-1 overflow-x-auto border-b border-line" aria-label="Purchase sections">
      <span aria-hidden="true" className={cx('pointer-events-none absolute bottom-0 left-0 h-0.5 rounded-full bg-blue-500', indicatorReady ? 'transition-[transform,width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]' : 'transition-none')} style={{ width: indicator.width, transform: `translateX(${indicator.left}px)` }} />
      {PURCHASE_TABS.map(({ id, label, icon: Icon }) => <button key={id} ref={node => { tabRefs.current[id] = node; }} onClick={() => go(id)} aria-current={tab === id ? 'page' : undefined} className={cx('inline-flex items-center gap-1.5 whitespace-nowrap px-2.5 py-2 text-xs font-medium transition-colors duration-200', tab === id ? 'text-blue-400' : 'text-mute hover:text-ink')}><Icon className="h-3.5 w-3.5" />{label}</button>)}
    </nav>
    <PurchaseDesk view={tab} />
  </div>;
};
