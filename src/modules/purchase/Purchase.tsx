import React, { useEffect, useMemo, useState } from 'react';
import { Check, Edit3, Plus, Search, ShoppingCart, Trash2, Truck, Wallet, X } from 'lucide-react';
import { ToastContainer } from '../walkie';
import { Modal, ConfirmModal, btnGhost, cx, inputCls, labelCls } from '../accommodation/ui';
import { todayStr } from '../accommodation/dates';
import { inr } from '../../pages/orgData';
import { useRequests } from '../requests/RequestsContext';
import { exportRequestsXlsx } from '../requests/exportXlsx';
import { usePurchase } from './PurchaseContext';
import type { VendorInput } from './PurchaseContext';
import { INCOMING, PAYABLE, PAYREQ, PAY_MODES, STATUS, payModeLabel, poDue, poTotal, poUnitsLeft } from './types';
import type { PO, POStatus, Payment, PaymentRequest, Receipt, Vendor } from './types';

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

export type DeskView = 'buy' | 'orders' | 'receiving' | 'vendors' | 'payments' | 'approve';

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
    const line = new Map<string, { name: string; unit: string }>();
    orders.forEach(o => o.items.forEach(i => line.set(i.id, { name: i.name, unit: i.unit })));
    return { po, line };
  }, [orders]);
};

const ReceiptList: React.FC<{ rows: Receipt[] | null; empty: string; showPo?: boolean }> = ({ rows, empty, showPo = true }) => {
  const { po, line } = useLookups();
  if (rows === null) return <Empty>Loading…</Empty>;
  if (!rows.length) return <Empty>{empty}</Empty>;
  return (
    <ul className="divide-y divide-line/70">
      {rows.map(r => {
        const l = line.get(r.itemId); const o = po.get(r.poId);
        const who = [r.givenBy && `Delivered by ${r.givenBy}`, r.receivedBy && `Received by ${r.receivedBy}`, r.challan && `Challan ${r.challan}`, r.note].filter(Boolean).join(' · ');
        return (
          <li key={r.id} className="px-4 py-3 flex items-start justify-between gap-3 text-sm">
            <div className="min-w-0">
              <div className="font-semibold truncate">{l?.name || 'Removed item'}</div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="font-bold tabular-nums text-emerald-400">+{r.qty}<span className="text-xs text-faint font-normal"> {l?.unit}</span></span>
                {showPo && o && <span className="text-xs text-mute">{o.number} · {o.title}</span>}
              </div>
              {who && <div className="text-xs text-mute mt-1">{who}</div>}
            </div>
            <div className="text-xs text-faint text-right shrink-0">{when(r.doneAt)}<br />{r.doneBy}</div>
          </li>
        );
      })}
    </ul>
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
  { key: 'all', label: 'All' }, { key: 'draft', label: 'Draft' }, { key: 'pending', label: 'Awaiting approval' }, { key: 'approved', label: 'Approved' },
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
                    <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs text-blue-400 font-bold">{o.number}</span><span className="font-semibold text-sm">{o.title}</span><StatusChip s={o.status} /><PayChip po={o} /></div>
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
                    <div className="font-semibold text-sm">{v.name}</div>
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
  const [f, setF] = useState<VendorInput>({ name: initial?.name || '', contact: initial?.contact || '', phone: initial?.phone || '', email: initial?.email || '', address: initial?.address || '', notes: initial?.notes || '' });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof VendorInput, v: string) => setF(p => ({ ...p, [k]: v }));
  const submit = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); const ok = await onSave(f); setBusy(false); if (ok) onClose(); };
  const field = (id: string, label: string, k: keyof VendorInput, type = 'text') => <div><label className={labelCls(D)} htmlFor={id}>{label}</label><input id={id} type={type} value={f[k]} onChange={e => set(k, e.target.value)} className={inputCls(D)} /></div>;
  return (
    <Modal title={initial ? 'Edit vendor' : 'Add vendor'} dark={D} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <div><label className={labelCls(D)} htmlFor="vn-n">Vendor name</label><input id="vn-n" autoFocus required value={f.name} onChange={e => set('name', e.target.value)} className={inputCls(D)} /></div>
        <div className="grid grid-cols-2 gap-3">{field('vn-c', 'Contact person', 'contact')}{field('vn-p', 'Phone', 'phone', 'tel')}</div>
        {field('vn-e', 'Email', 'email', 'email')}
        {field('vn-a', 'Address', 'address')}
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
  const o = orders.find(x => x.id === id);
  const open = (o?.items || []).filter(i => i.qtyOrdered > i.qtyReceived);
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(open.map(i => [i.id, String(i.qtyOrdered - i.qtyReceived)])));
  const [givenBy, setGivenBy] = useState('');
  const [receivedBy, setReceivedBy] = useState(userName);
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
    setBusy(true); const ok = await receive(o.id, lines.map(l => ({ itemId: l.itemId, qty: l.qty })), { givenBy, receivedBy, challan, note }); setBusy(false);
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
                    <td className="pl-3 py-2.5"><div className="font-medium">{i.name}</div>{i.inventoryItemId && <div className="text-xs text-emerald-400">adds to inventory stock</div>}</td>
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
        <p className="text-xs text-mute">The owner approves it first. After that you can pay it and enter the UTR or cheque number.</p>
        {problem && <p role="alert" className="text-xs text-rose-400">{problem}</p>}
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className={btnGhost(D)}>Cancel</button><button type="submit" disabled={!(amt > 0) || !!problem || busy} className={primary}>{busy ? 'Sending…' : 'Send to the owner'}</button></div>
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
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">The owner approved <b className="tabular-nums">{money(r.amount)}</b>{r.note ? ` (${r.note})` : ''}. Pay exactly this amount.</div>
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
  const { orders, canApprove, canManage, reviewPayment, withdrawPayment } = usePurchase();
  const [rejecting, setRejecting] = useState(false); const [paying, setPaying] = useState(false); const [busy, setBusy] = useState(false);
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
        {r.decisionNote && <div className="text-xs text-mute">{r.status === 'rejected' ? 'Reason' : 'Owner’s note'}: {r.decisionNote}</div>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {r.status === 'pending' && canApprove && <>
          <button className={cx(btnGhost(D), 'text-rose-400')} onClick={() => setRejecting(true)}><X className="w-3.5 h-3.5" />Reject</button>
          <button className={good} disabled={busy} onClick={async () => { setBusy(true); await reviewPayment(r.id, true, ''); setBusy(false); }}><Check className="w-4 h-4" />Approve</button>
        </>}
        {r.status === 'pending' && !canApprove && canManage && <button className={btnGhost(D)} onClick={() => withdrawPayment(r.id)}>Withdraw</button>}
        {r.status === 'approved' && canManage && <button className={good} onClick={() => setPaying(true)}><Wallet className="w-4 h-4" />Pay now</button>}
      </div>
      {rejecting && <ReasonModal title="Reject this payment?" body="Purchase will see your reason." confirm="Reject payment" onSubmit={n => reviewPayment(r.id, false, n)} onClose={() => setRejecting(false)} />}
      {paying && <PayNowModal id={r.id} onClose={() => setPaying(false)} />}
    </li>
  );
};

// ---- the buy list: everything approved that the store team said must be bought -------------------------
const BuyListView: React.FC<{ openOrder: (id: string) => void }> = ({ openOrder }) => {
  const { requests, orders: reqOrders, loadAvailability } = useRequests();
  const { createOrder, canManage } = usePurchase();
  const [sel, setSel] = useState<Set<string>>(new Set()); const [busy, setBusy] = useState(false); const [q, setQ] = useState('');
  const lines = useMemo(() => requests.filter(r => r.status === 'approved').flatMap(r => r.parts
    .filter(p => p.source === 'purchase' && p.status === 'planned' && !p.purchaseItemId)
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
  // Parts that left the list (ordered by someone else) disappear from the selection.
  useEffect(() => { setSel(s => { const ids = new Set(lines.map(l => l.part.id)); const n = new Set(Array.from(s).filter(x => ids.has(x))); return n.size === s.size ? s : n; }); }, [lines]);
  const toggle = (id: string) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleGroup = (ids: string[]) => setSel(s => { const n = new Set(s); const all = ids.every(i => n.has(i)); ids.forEach(i => (all ? n.delete(i) : n.add(i))); return n; });
  const chosen = lines.filter(l => sel.has(l.part.id));
  const tickets = new Set(chosen.map(l => l.req.number)).size;
  const make = async () => { setBusy(true); const id = await createOrder(chosen.map(l => l.part.id)); setBusy(false); if (id) { setSel(new Set()); openOrder(id); } };
  const dl = async () => exportRequestsXlsx(requests.filter(r => r.status === 'approved'), reqOrders, await loadAvailability(), 'buy-list');

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div className="relative w-full sm:max-w-sm"><Search className="absolute left-3 top-3 h-4 w-4 text-faint" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search item or ticket…" aria-label="Search the buy list" className={cx(inputCls(D), 'pl-9')} /></div>
        <button className={btnGhost(D)} onClick={dl}>Excel</button>
      </div>
      <p className="text-xs text-mute">These items were approved by the owner and the store team found them not in stock. Tick the lines you want to buy together (from one vendor), then create one order. Lines of different tickets can go into the same order.</p>
      {groups.length === 0 ? <section className={panel}><Empty>Nothing to buy right now.</Empty></section> : groups.map(g => {
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

// ---- vendor + rates (the lines themselves come from the tickets) ------------------------------------------
const OrderEditModal: React.FC<{ id: string; onClose: () => void }> = ({ id, onClose }) => {
  const { orders, vendors, saveDraft } = usePurchase();
  const o = orders.find(x => x.id === id);
  const [vendorId, setVendorId] = useState(o?.vendorId || ''); const [expected, setExpected] = useState(o?.expectedDate || ''); const [notes, setNotes] = useState(o?.notes || '');
  const [rates, setRates] = useState<Record<string, string>>(() => Object.fromEntries((o?.items || []).map(i => [i.id, i.rate ? String(i.rate) : ''])));
  const [busy, setBusy] = useState(false);
  if (!o) return null;
  const num = (id2: string) => parseFloat(rates[id2]) || 0;
  const total = o.items.reduce((a, i) => a + i.qtyOrdered * num(i.id), 0);
  const save = async (submit: boolean) => {
    setBusy(true);
    const ok = await saveDraft(o.id, { vendorId, expectedDate: expected, notes, rates: Object.fromEntries(o.items.map(i => [i.id, num(i.id)])) }, submit);
    setBusy(false); if (ok) onClose();
  };
  return (
    <Modal title={`${o.number} · vendor and rates`} dark={D} onClose={onClose} xl>
      <div className="space-y-4">
        {o.status === 'rejected' && o.decisionNote && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">The owner rejected this order: {o.decisionNote}</div>}
        <div className="grid sm:grid-cols-3 gap-3">
          <div><label className={labelCls(D)} htmlFor="oe-v">Vendor</label>
            <select id="oe-v" value={vendorId} onChange={e => setVendorId(e.target.value)} className={inputCls(D)}><option value="">Choose a vendor…</option>{vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></div>
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
          <div className="flex gap-2"><button className={btnGhost(D)} onClick={onClose}>Cancel</button><button className={btnGhost(D)} disabled={busy} onClick={() => save(false)}>Save</button><button className={primary} disabled={busy} onClick={() => save(true)}>{busy ? 'Saving…' : 'Save and send to the owner'}</button></div>
        </div>
        <p className="text-xs text-mute">The owner approves every order after seeing the rates. You cannot add or remove lines here: they come from the tickets.</p>
      </div>
    </Modal>
  );
};

// ---- order detail ------------------------------------------------------------------------------------------
const OrderModal: React.FC<{ id: string; onClose: () => void; onEdit: (id: string) => void; onReceive: (id: string) => void; onAsk: (id: string) => void }> = ({ id, onClose, onEdit, onReceive, onAsk }) => {
  const { orders, vendors, payRequests, canManage, canApprove, canReceive, setStatus, deleteOrder, fetchReceipts, fetchPayments } = usePurchase();
  const o = orders.find(x => x.id === id);
  const [rc, setRc] = useState<Receipt[] | null>(null);
  const [pm, setPm] = useState<Payment[] | null>(null);
  const [ask, setAsk] = useState<'cancel' | 'delete' | 'reject' | null>(null);
  const sig = o ? o.paid * 3 + o.items.reduce((a, i) => a + i.qtyReceived, 0) : 0;
  useEffect(() => { if (!o) return; let on = true; fetchReceipts(id).then(r => on && setRc(r)); if (canManage) fetchPayments(id).then(r => on && setPm(r)); return () => { on = false; }; }, [id, sig]); // eslint-disable-line
  if (!o) return <Modal title="Order" dark={D} onClose={onClose}><p className="text-sm text-mute">This order no longer exists.</p></Modal>;
  const vendor = vendors.find(v => v.id === o.vendorId);
  const total = poTotal(o); const due = poDue(o);
  const mine = payRequests.filter(r => r.poId === o.id);
  const asked = mine.filter(r => r.status === 'pending' || r.status === 'approved').reduce((a, r) => a + r.amount, 0);
  const tickets = Array.from(new Set(o.items.map(i => i.requestNumber).filter(Boolean)));
  const act = (s: POStatus, msg: string, note?: string) => setStatus(o.id, s, msg, note);
  return (
    <Modal title={`${o.number} · ${o.title}`} dark={D} onClose={onClose} xl>
      <div className="flex flex-wrap items-center gap-2 mb-4"><StatusChip s={o.status} /><PayChip po={o} />{overdue(o) && <span className={cx('text-xs font-semibold px-2 py-0.5 rounded-full border', TONE.bad)}>Overdue</span>}</div>
      {o.status === 'rejected' && <div className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">Rejected by {o.approvedBy}: {o.decisionNote || 'no reason given'}</div>}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-5">
        <Info label="Vendor">{vendor ? <>{vendor.name}{vendor.phone && <div className="text-xs text-mute">{vendor.phone}</div>}</> : null}</Info>
        <Info label="For tickets">{tickets.join(', ')}</Info>
        <Info label="Deliver to">{o.deliverTo}</Info>
        <Info label="Expected">{o.expectedDate ? day(o.expectedDate) : ''}</Info>
        <Info label="Created by">{o.createdBy}</Info>
        <Info label="Approved by">{o.status !== 'draft' && o.status !== 'pending' && o.status !== 'rejected' && o.approvedBy ? `${o.approvedBy} · ${day(o.approvedAt.slice(0, 10))}` : ''}</Info>
      </div>
      {o.notes && <p className="text-xs text-mute mb-4">Note: {o.notes}</p>}

      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full text-sm min-w-[32rem]">
          <thead><tr className="text-left text-xs uppercase tracking-wider text-faint border-b border-line"><th className="pl-3 py-2.5 font-semibold">Item</th><th className="px-3 py-2.5 font-semibold text-right">Ordered</th><th className="px-3 py-2.5 font-semibold text-right">Received</th><th className="px-3 py-2.5 font-semibold text-right">Rate</th><th className="px-3 py-2.5 pr-3 font-semibold text-right">Amount</th></tr></thead>
          <tbody className="divide-y divide-line/70">
            {o.items.map(i => (
              <tr key={i.id}>
                <td className="pl-3 py-2.5"><div className="font-medium">{i.name}</div><div className="text-xs text-mute">{i.requestNumber ? `for ${i.requestNumber}` : ''}{i.inventoryItemId ? `${i.requestNumber ? ' · ' : ''}adds to inventory stock` : ''}</div></td>
                <td className="px-3 py-2.5 text-right tabular-nums">{i.qtyOrdered} <span className="text-xs text-faint">{i.unit}</span></td>
                <td className={cx('px-3 py-2.5 text-right tabular-nums', i.qtyReceived >= i.qtyOrdered ? 'text-emerald-400' : i.qtyReceived > 0 ? 'text-amber-300' : 'text-faint')}>{i.qtyReceived}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{i.rate ? money(i.rate) : <span className="text-faint">—</span>}</td>
                <td className="px-3 py-2.5 pr-3 text-right tabular-nums font-semibold">{i.rate ? money(i.qtyOrdered * i.rate) : <span className="text-faint">—</span>}</td>
              </tr>))}
          </tbody>
        </table>
      </div>
      <div className="flex justify-end gap-6 mt-3 text-sm">
        <span className="text-mute">Total <b className="text-ink tabular-nums">{money(total)}</b></span>
        {PAYABLE.includes(o.status) && <><span className="text-mute">Paid <b className="text-emerald-400 tabular-nums">{money(o.paid)}</b></span><span className="text-mute">Due <b className="text-amber-300 tabular-nums">{money(due)}</b></span></>}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 mt-5">
        {o.status === 'pending' && canApprove && <>
          <button className={cx(btnGhost(D), 'text-rose-400')} onClick={() => setAsk('reject')}><X className="w-3.5 h-3.5" />Reject</button>
          <button className={good} onClick={async () => { if (await act('approved', 'Order approved.')) onClose(); }}><Check className="w-4 h-4" />Approve this order</button>
        </>}
        {o.status === 'pending' && !canApprove && <span className="text-xs text-mute mr-auto">With the owner for approval.</span>}
        {canManage && ['draft', 'rejected'].includes(o.status) && <button className={btnGhost(D)} onClick={() => onEdit(o.id)}><Edit3 className="w-3.5 h-3.5" />Vendor and rates</button>}
        {canManage && ['draft', 'rejected'].includes(o.status) && <button className={primary} onClick={async () => { if (await act('pending', 'Sent to the owner for approval.')) onClose(); }}>Send to the owner</button>}
        {canManage && o.status === 'approved' && <button className={primary} onClick={() => act('ordered', 'Marked as ordered.')}>I have placed the order</button>}
        {canReceive && INCOMING.includes(o.status) && <button className={good} onClick={() => onReceive(o.id)}><Truck className="w-4 h-4" />Receive goods</button>}
        {canManage && PAYABLE.includes(o.status) && due - asked > 0.009 && <button className={btnGhost(D)} onClick={() => onAsk(o.id)}>Ask for a payment</button>}
        {canManage && ['draft', 'pending', 'approved', 'rejected', 'ordered'].includes(o.status) && !o.items.some(i => i.qtyReceived > 0) && <button className={cx(btnGhost(D), 'text-rose-400')} onClick={() => setAsk('cancel')}>Cancel order</button>}
        {canManage && ['draft', 'rejected', 'cancelled'].includes(o.status) && <button className={cx(btnGhost(D), 'text-rose-400')} onClick={() => setAsk('delete')} aria-label="Delete order"><Trash2 className="w-3.5 h-3.5" /></button>}
      </div>

      {canManage && mine.length > 0 && <div className="mt-6"><div className="text-xs font-semibold text-mute mb-1">Payment requests</div><ul className={cx(panel, 'overflow-hidden divide-y divide-line/70')}>{mine.map(r => <PayReqRow key={r.id} r={r} />)}</ul></div>}
      {(rc === null || rc.length > 0) && <div className="mt-6"><div className="text-xs font-semibold text-mute mb-1">Goods received</div><div className={cx(panel, 'overflow-hidden')}><ReceiptList rows={rc} empty="" showPo={false} /></div></div>}
      {canManage && (pm === null || pm.length > 0) && <div className="mt-5"><div className="text-xs font-semibold text-mute mb-1">Payments made</div><div className={cx(panel, 'overflow-hidden')}><PaymentList rows={pm} empty="" showPo={false} /></div></div>}

      {ask === 'reject' && <ReasonModal title="Reject this order?" body="Purchase sees your reason, fixes the rates or the vendor, and sends it again." confirm="Reject order" onSubmit={n => act('rejected', 'Order rejected.', n).then(ok => { if (ok) onClose(); return ok; })} onClose={() => setAsk(null)} />}
      {ask === 'cancel' && <ConfirmModal dark={D} title="Cancel this order?" body="The order is closed. Its items go back to the buy list so they can be ordered again, and the requesters are told." confirmLabel="Cancel order" onConfirm={() => { act('cancelled', 'Order cancelled.'); setAsk(null); }} onClose={() => setAsk(null)} />}
      {ask === 'delete' && <ConfirmModal dark={D} title={`Delete ${o.number}?`} body="The order is removed. Its items go back to the buy list." confirmLabel="Delete" onConfirm={() => { deleteOrder(o.id).then(ok => ok && onClose()); }} onClose={() => setAsk(null)} />}
    </Modal>
  );
};

// ---- payments ----------------------------------------------------------------------------------------------
const PaymentsView: React.FC<{ open: (id: string) => void; onAsk: (id: string) => void }> = ({ open, onAsk }) => {
  const { orders, payRequests, vendorName, canManage, canApprove, stats } = usePurchase();
  const waiting = payRequests.filter(r => r.status === 'pending'); const ready = payRequests.filter(r => r.status === 'approved');
  const closed = payRequests.filter(r => ['paid', 'rejected', 'cancelled'].includes(r.status)).slice(0, 30);
  const asked = (poId: string) => payRequests.filter(r => r.poId === poId && (r.status === 'pending' || r.status === 'approved')).reduce((a, r) => a + r.amount, 0);
  const due = orders.filter(o => PAYABLE.includes(o.status) && poDue(o) - asked(o.id) > 0.009);
  const rows = useLedger<Payment>('payments', 300);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Still to pay" value={money(stats.due)} dot="bg-amber-400" />
        <Stat label="Waiting for the owner" value={waiting.length} dot="bg-amber-400" />
        <Stat label="Approved, to be paid" value={ready.length} dot="bg-blue-400" />
        <Stat label="Orders with money due" value={orders.filter(o => PAYABLE.includes(o.status) && poDue(o) > 0).length} dot="bg-rose-400" />
      </div>
      {ready.length > 0 && <Section title={`Approved. Pay these (${ready.length})`}><ul className="divide-y divide-line/70">{ready.map(r => <PayReqRow key={r.id} r={r} showOrder open={open} />)}</ul></Section>}
      {waiting.length > 0 && <Section title={canApprove ? `Waiting for you (${waiting.length})` : `Waiting for the owner (${waiting.length})`}><ul className="divide-y divide-line/70">{waiting.map(r => <PayReqRow key={r.id} r={r} showOrder open={open} />)}</ul></Section>}
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

// ---- the owner's queue: orders and payments waiting for his decision -------------------------------------------
const ApproveQueue: React.FC<{ open: (id: string) => void }> = ({ open }) => {
  const { orders, payRequests, vendorName, canApprove } = usePurchase();
  const pend = orders.filter(o => o.status === 'pending');
  const pays = payRequests.filter(r => r.status === 'pending');
  return (
    <div className="space-y-5">
      <Section title={`Orders to approve (${pend.length})`}>
        {pend.length === 0 ? <Empty>No order is waiting.</Empty> : (
          <ul className="divide-y divide-line/70">
            {pend.map(o => (
              <li key={o.id} className="px-4 py-3 flex items-center justify-between gap-3">
                <button className="min-w-0 text-left" onClick={() => open(o.id)}>
                  <div className="font-semibold text-sm truncate"><span className="font-mono text-xs text-blue-400 font-bold">{o.number}</span> {o.title}</div>
                  <div className="text-xs text-faint">{vendorName(o.vendorId)} · {o.items.length} line{o.items.length === 1 ? '' : 's'} · by {o.createdBy}</div>
                </button>
                <div className="flex items-center gap-3 shrink-0"><b className="tabular-nums">{money(poTotal(o))}</b><button className={primary} onClick={() => open(o.id)}>{canApprove ? 'Review' : 'Open'}</button></div>
              </li>))}
          </ul>)}
      </Section>
      <Section title={`Payments to approve (${pays.length})`}>
        {pays.length === 0 ? <Empty>No payment is waiting.</Empty> : <ul className="divide-y divide-line/70">{pays.map(r => <PayReqRow key={r.id} r={r} showOrder open={open} />)}</ul>}
      </Section>
    </div>
  );
};

// ---- the desk: one component, the Requests screen shows it as tabs -----------------------------------------------
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
      {view === 'buy' && <BuyListView openOrder={setViewing} />}
      {view === 'orders' && <OrdersView filter={filter} setFilter={setFilter} open={setViewing} />}
      {view === 'vendors' && <VendorsView />}
      {view === 'receiving' && <ReceivingView open={setViewing} onReceive={setReceiving} />}
      {view === 'payments' && <PaymentsView open={setViewing} onAsk={setAsking} />}
      {view === 'approve' && <ApproveQueue open={setViewing} />}

      {viewing && !editing && !receiving && !asking && <OrderModal id={viewing} onClose={() => setViewing(null)} onEdit={setEditing} onReceive={setReceiving} onAsk={setAsking} />}
      {editing && <OrderEditModal id={editing} onClose={() => setEditing(null)} />}
      {receiving && <ReceiveModal id={receiving} onClose={() => setReceiving(null)} />}
      {asking && <AskPayModal id={asking} onClose={() => setAsking(null)} />}
      <ToastContainer />
    </div>
  );
};

const PURCHASE_TABS: { id: DeskView; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'buy', label: 'Buy list', icon: ShoppingCart }, { id: 'orders', label: 'Orders', icon: Check },
  { id: 'receiving', label: 'Receiving', icon: Truck }, { id: 'payments', label: 'Payments', icon: Wallet },
  { id: 'vendors', label: 'Vendors', icon: Search }, { id: 'approve', label: 'Approvals', icon: Check },
];

// Independent purchasing workspace. Requests remain in the Requests module;
// purchase orders, receiving and payments are managed here against those requests.
export const PurchaseApp: React.FC<{ initialTab?: DeskView }> = ({ initialTab = 'orders' }) => {
  const { orders, canApprove } = usePurchase();
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
  const visibleTabs = PURCHASE_TABS.filter(x => x.id !== 'approve' || canApprove);
  useEffect(() => {
    const sync = () => {
      const part = location.hash.split('/')[2] as DeskView;
      setTab(PURCHASE_TABS.some(x => x.id === part) && (part !== 'approve' || canApprove) ? part : initialTab);
    };
    addEventListener('hashchange', sync);
    return () => removeEventListener('hashchange', sync);
  }, [initialTab, canApprove]);
  const go = (next: DeskView) => { setTab(next); location.hash = `#/purchase/${next}`; };
  return <div className="space-y-3">
    <header className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-lg font-semibold text-ink">Purchase</h2><p className="text-xs text-mute">Orders and payments linked to approved department requests.</p></div></header>
    <section aria-label="Purchase totals" className="grid grid-cols-3 gap-2">
      {totals.map(([label, amount]) => <div key={label} className="rounded-lg border border-line bg-surface px-3 py-2"><div className="text-[10px] font-medium text-mute">{label}</div><div className="mt-0.5 truncate text-sm font-semibold tabular-nums text-ink">{money(amount)}</div></div>)}
    </section>
    <nav className="flex gap-1 overflow-x-auto border-b border-line" aria-label="Purchase sections">
      {visibleTabs.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => go(id)} aria-current={tab === id ? 'page' : undefined} className={cx('inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-2.5 py-2 text-xs font-medium', tab === id ? 'border-blue-500 text-blue-400' : 'border-transparent text-mute hover:text-ink')}><Icon className="h-3.5 w-3.5" />{label}</button>)}
    </nav>
    <PurchaseDesk view={tab} />
  </div>;
};
