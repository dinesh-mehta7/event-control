import React, { useState } from 'react';
import { ArrowLeft, Printer, Ban, RotateCcw, CheckCircle2, Eye, FileSpreadsheet } from 'lucide-react';
import { Card, btnGhost, btnPrimary, printLight } from '../../components/ui';
import { DEPTS } from '../../pages/orgData';
import { useRequests } from './RequestsContext';
import { FulfilmentPanel, ItReviewPanel, OwnerReviewPanel, SubReviewPanel } from './panels';
import { ItemsTable, StatusBadge, Stepper, Timeline, UrgentBadge } from './parts';
import { usePurchase } from '../purchase';
import { STATUS as PO_STATUS, poDue, poTotal } from '../purchase/types';
import { exportRequestsXlsx } from './exportXlsx';
import { fmtDate, isOverdue } from './types';
import type { NewLine, Req } from './types';

const Info: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div><div className="text-xs text-mute">{label}</div><div className="text-sm text-ink mt-0.5">{children || '—'}</div></div>
);

// Orders that carry this ticket's items (owner and Purchase team only): number, status, vendor, money.
const OrdersCard: React.FC<{ r: Req }> = ({ r }) => {
  const { orders, vendorName, canManage } = usePurchase();
  const mine = orders.filter(o => o.items.some(i => i.requestId === r.id));
  if (!canManage || mine.length === 0) return null;
  return (
    <Card title="Orders for this ticket" className="print:hidden">
      <ul className="divide-y divide-line">
        {mine.map(o => (
          <li key={o.id} className="py-2.5 first:pt-0 last:pb-0 flex items-center justify-between gap-3 text-sm">
            <div className="min-w-0">
              <div className="text-ink"><span className="font-mono text-xs text-blue-400 font-bold">{o.number}</span> · {PO_STATUS[o.status].label}</div>
              <div className="text-xs text-mute">{o.vendorId ? vendorName(o.vendorId) : 'No vendor yet'} · {o.items.filter(i => i.requestId === r.id).map(i => `${i.qtyOrdered} ${i.name}`).join(', ')}{o.items.some(i => i.requestId !== r.id) ? ' · shared with other tickets' : ''}</div>
            </div>
            <div className="text-right shrink-0 tabular-nums"><div className="text-ink">{poTotal(o) ? '₹' + poTotal(o).toLocaleString('en-IN') : '—'}</div><div className="text-xs text-mute">{poTotal(o) ? `due ₹${poDue(o).toLocaleString('en-IN')}` : ''}</div></div>
          </li>))}
      </ul>
      <a href="#/requests/orders" className="inline-block mt-3 text-xs text-blue-400 hover:underline">Open all orders</a>
    </Card>
  );
};

// The owner decides, ticket by ticket, whether the requester may see the vendor's name and the rate.
const VisibilityPanel: React.FC<{ r: Req }> = ({ r }) => {
  const { setVisibility } = useRequests();
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const set = async (v: boolean, rt: boolean) => { setBusy(true); setErr(''); const e = await setVisibility(r.id, v, rt); setBusy(false); if (e) setErr(e); };
  return (
    <Card title="What the requester can see" icon={Eye} className="print:hidden">
      <p className="text-sm text-mute mb-3">The status of every item is always visible. These two are your choice for this ticket. The Purchase team and you always see both.</p>
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm text-ink-soft cursor-pointer"><input type="checkbox" className="accent-blue-600" disabled={busy} checked={r.showVendor} onChange={e => set(e.target.checked, r.showRate)} />Show the vendor name</label>
        <label className="flex items-center gap-2 text-sm text-ink-soft cursor-pointer"><input type="checkbox" className="accent-blue-600" disabled={busy} checked={r.showRate} onChange={e => set(r.showVendor, e.target.checked)} />Show the rate</label>
      </div>
      {err && <div role="alert" className="mt-2 text-sm text-red-300">{err}</div>}
    </Card>
  );
};

export const RequestDetail: React.FC<{ id: string; onBack: () => void; onCopy: (c: { title: string; purpose: string; deliverTo: string; lines: NewLine[] }) => void }> = ({ id, onBack, onCopy }) => {
  const { requests, ready, me, orders, canReviewSub, canReviewIt, canOwnerReview, canCancel, canArrange, canOrder, canConfirm, cancel, confirmReceipt, loadAvailability } = useRequests();
  const [err, setErr] = useState('');
  const r = requests.find(x => x.id === id);
  if (!r) return (
    <div className="space-y-3"><button className={btnGhost} onClick={onBack}><ArrowLeft size={14} />Back</button>
      <p className="text-sm text-mute">{ready ? 'This request was not found, or you do not have access to it.' : 'Loading…'}</p></div>
  );

  const team = r.items.some(i => (i.approved ?? 0) > 0 && canArrange(i.kind)) || canOrder;
  const showFulfil = r.status === 'approved' && (team || me.isExec || r.requesterId === me.id || me.team === 'purchase' || me.team === 'inventory' || me.team === 'walkie') && r.items.some(i => (i.approved ?? 0) > 0);

  const doCancel = async () => { if (!window.confirm('Cancel this request?')) return; setErr(''); const e = await cancel(r.id); if (e) setErr(e); };
  const copy = () => onCopy({ title: r.title, purpose: r.purpose, deliverTo: r.deliverTo, lines: r.items.map(i => ({ kind: i.kind, name: i.name, unit: i.unit, qty: i.requested, reason: i.reason, note: i.note, inventoryItemId: i.inventoryItemId })) });
  const doConfirm = async () => { setErr(''); const e = await confirmReceipt(r.id); if (e) setErr(e); };
  const canExport = me.isExec || me.team === 'inventory' || me.team === 'purchase';
  const doExport = async () => { const a = canExport ? await loadAvailability() : {}; exportRequestsXlsx([r], orders, a, r.number); };

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <button className={btnGhost} onClick={onBack}><ArrowLeft size={14} />Back</button>
        <div className="flex gap-2 flex-wrap justify-end">
          {canCancel(r) && <button className={btnGhost} onClick={doCancel}><Ban size={14} />Cancel request</button>}
          {r.requesterId === me.id && (r.status === 'rejected' || r.status === 'cancelled') && <button className={btnGhost} onClick={copy}><RotateCcw size={14} />Request again</button>}
          {canExport && <button className={btnGhost} onClick={doExport}><FileSpreadsheet size={14} />Excel</button>}
          <button className={btnGhost} onClick={printLight}><Printer size={14} />Print / save as PDF</button>
        </div>
      </div>

      <section className="rounded-xl border border-line bg-surface p-5 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="text-xs font-medium text-mute tracking-wide">{r.number}</div>
            <h2 className="text-xl font-semibold text-ink">{r.title}</h2>
          </div>
          <div className="flex items-center gap-2">{r.priority === 'urgent' && <UrgentBadge />}{isOverdue(r) && <span className="text-xs font-medium text-red-300 bg-red-500/15 rounded-full px-2 py-0.5">Overdue</span>}<StatusBadge status={r.status} closed={!!r.confirmedAt} /></div>
        </div>
        <Stepper r={r} />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-1">
          <Info label="Requested by">{r.requesterName}{r.subDepartment ? ` · ${DEPTS[r.subDepartment]}` : ''}</Info>
          <Info label="Raised on">{fmtDate(r.createdAt)}</Info>
          <Info label="Deliver to">{r.deliverTo}</Info>
          <Info label="Needed by">{r.neededBy ? fmtDate(r.neededBy) : ''}</Info>
        </div>
        {r.purpose && <div><div className="text-xs text-mute mb-1">Why it is needed</div><p className="text-sm text-ink-soft whitespace-pre-line bg-raised/50 rounded-lg px-3 py-2">{r.purpose}</p></div>}
        {(r.subNote || r.itNote || r.ownerNote) && (
          <div className="grid sm:grid-cols-3 gap-3">
            {r.subNote && <div><div className="text-xs text-mute mb-1">Branch head's comment</div><p className="text-sm text-ink-soft bg-raised/50 rounded-lg px-3 py-2">{r.subNote}</p></div>}
            {r.itNote && <div><div className="text-xs text-mute mb-1">IT owner's comment</div><p className="text-sm text-ink-soft bg-raised/50 rounded-lg px-3 py-2">{r.itNote}</p></div>}
            {r.ownerNote && <div><div className="text-xs text-mute mb-1">Organization owner's comment</div><p className="text-sm text-ink-soft bg-raised/50 rounded-lg px-3 py-2">{r.ownerNote}</p></div>}
          </div>)}
        <ItemsTable r={r} orders={orders} />
        {r.status === 'fulfilled' && (r.confirmedAt
          ? <div className="flex items-center gap-2 text-sm text-emerald-300"><CheckCircle2 size={16} />Receipt confirmed{r.confirmedBy ? ` by ${r.confirmedBy}` : ''} on {fmtDate(r.confirmedAt)}. This ticket is closed.</div>
          : canConfirm(r) ? (
            <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-3 flex items-center justify-between gap-3 flex-wrap print:hidden">
              <div className="text-sm text-emerald-200">Everything approved has been delivered. Did you receive it all?</div>
              <button className={btnPrimary} onClick={doConfirm}><CheckCircle2 size={14} />Yes, I received it</button>
            </div>) : <p className="text-xs text-mute">Delivered. Waiting for {r.requesterName} to confirm receipt.</p>)}
        {err && <div role="alert" className="text-sm text-red-300">{err}</div>}
      </section>

      {canReviewSub(r) && !canOwnerReview(r) && <div className="print:hidden"><SubReviewPanel r={r} /></div>}
      {canReviewSub(r) && canOwnerReview(r) && <div className="print:hidden space-y-4"><SubReviewPanel r={r} /><OwnerReviewPanel r={r} /></div>}
      {!canReviewSub(r) && canOwnerReview(r) && <div className="print:hidden"><OwnerReviewPanel r={r} /></div>}
      {canReviewIt(r) && <div className="print:hidden"><ItReviewPanel r={r} /></div>}
      {showFulfil && <div className="print:hidden"><FulfilmentPanel r={r} /></div>}

      <Card title="Activity"><Timeline events={r.events} /></Card>
      <OrdersCard r={r} />
      {me.isOwner && r.status !== 'cancelled' && r.status !== 'rejected' && <VisibilityPanel r={r} />}
      {r.status === 'pending_it' && r.requesterId === me.id && <p className="text-xs text-mute print:hidden">The IT owner is reviewing this request. After that, it goes to the organization owner for final approval.</p>}
      {r.status === 'pending_owner' && me.isOwner === false && r.requesterId === me.id && <p className="text-xs text-mute print:hidden">The organization owner is reviewing this request for final approval.</p>}
    </div>
  );
};
