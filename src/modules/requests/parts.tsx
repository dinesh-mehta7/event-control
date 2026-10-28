import React from 'react';
import { ArrowRight, Check } from 'lucide-react';
import { Pill } from '../../components/ui';
import { STATUS_LABEL, STATUS_TONE, fmtDateTime, lineStatus, purchaseAtStore } from './types';
import type { OrderInfo, Req, ReqStatus } from './types';

// `stage` (from requestStage) names where an approved request is: Ordering, Ordered, At store…
export const StatusBadge: React.FC<{ status: ReqStatus; closed?: boolean; stage?: string | null }> = ({
  status,
  closed,
  stage,
}) => (
  <Pill c={STATUS_TONE[status]}>
    {status === 'fulfilled' && closed ? 'Closed' : (status === 'approved' && stage) || STATUS_LABEL[status]}
  </Pill>
);
export const UrgentBadge: React.FC = () => <Pill c="bg-red-500/15 text-red-300">Urgent</Pill>;

// Both departments of a request, everywhere it is listed: the requester's (from) → the one it was made to.
export const DeptRoute: React.FC<{ r: Pick<Req, 'fromDepartmentName' | 'departmentName'>; className?: string }> = ({
  r,
  className = '',
}) => (
  <span className={`inline-flex flex-wrap items-center gap-x-1 ${className}`}>
    <span title="From">{r.fromDepartmentName || '—'}</span>
    <ArrowRight size={11} className="shrink-0 text-faint" aria-label="to" />
    <span title="To">{r.departmentName || '—'}</span>
  </span>
);

// Approved by the Super Admin: the request was escalated, not sent back after its last escalation, and is now
// approved (the approval text is the same whoever approves, so it cannot be used to tell them apart).
export const approvedBySuperAdmin = (r: Pick<Req, 'status'> & Partial<Pick<Req, 'events'>>) => {
  if (!['approved', 'fulfilled'].includes(r.status)) return false;
  const events = [...(r.events || [])].sort((a, b) => a.at.localeCompare(b.at));
  const lastEscalation = events.map(e => e.kind).lastIndexOf('escalated');
  return lastEscalation >= 0 && !events.slice(lastEscalation + 1).some(e => e.kind === 'sent_back');
};

// A send-back starts a second Department Head review cycle. Keep it visible in
// progress until that cycle is escalated again or reaches a final decision.
export const departmentHeadReviewAfterSendBack = (
  r: Pick<Req, 'status'> & Partial<Pick<Req, 'events'>>,
) => {
  const events = [...(r.events || [])].sort((a, b) => a.at.localeCompare(b.at));
  const lastEscalation = events.map(e => e.kind).lastIndexOf('escalated');
  const lastSendBack = events.map(e => e.kind).lastIndexOf('sent_back');
  if (lastSendBack < 0 || lastSendBack < lastEscalation) return { returned: false, reapproved: false };
  const reapproved = events.slice(lastSendBack + 1).some(e => e.kind === 'approved');
  return { returned: true, reapproved: reapproved && r.status !== 'pending_it' };
};

// The Department Head's review includes the arrangement, so there is no separate Arranged step.
export const Stepper: React.FC<{
  r: Pick<Req, 'status' | 'items' | 'parts'> & Partial<Req>;
  orders: Record<string, OrderInfo>;
}> = ({ r, orders }) => {
  const dead = r.status === 'rejected' || r.status === 'cancelled';
  const hasEscalation = r.status === 'pending_owner' || !!r.events?.some(e => e.kind === 'escalated');
  const superApproved = approvedBySuperAdmin(r);
  const afterSendBack = departmentHeadReviewAfterSendBack(r);
  const purchaseParts = r.parts.filter(part => part.source === 'purchase');
  const hasPurchase = purchaseParts.length > 0;
  const ordered =
    hasPurchase &&
    purchaseParts.every(
      part =>
        part.purchaseItemId && ['ordered', 'partial', 'received'].includes(orders[part.purchaseItemId]?.poStatus || ''),
    );
  const approved = ['pending_owner', 'approved', 'fulfilled'].includes(r.status);
  // Every purchased part is either handed over or fully at the store.
  const atStore =
    hasPurchase &&
    purchaseParts.every(part => part.status === 'done' || purchaseAtStore(r as Req, part, orders) >= part.qty);
  const steps: { label: string; state: 'done' | 'current' | 'idle' | 'returned' }[] = [
    { label: 'Requested', state: !dead && r.status !== 'pending_sub' ? 'done' : 'idle' },
    {
      label: 'Department Head',
      state: afterSendBack.returned ? 'done' : r.status === 'pending_it' ? 'current' : approved ? 'done' : 'idle',
    },
    ...(hasEscalation
      ? [
          {
            label: afterSendBack.returned ? 'Super Admin · sent back' : 'Super Admin',
            state:
              r.status === 'pending_owner'
                ? ('current' as const)
                : afterSendBack.returned
                  ? ('returned' as const)
                : superApproved
                  ? ('done' as const)
                  : ('idle' as const),
          },
        ]
      : []),
    ...(afterSendBack.returned
      ? [
          {
            label: 'Department Head · re-review',
            state:
              r.status === 'pending_it'
                ? ('current' as const)
                : afterSendBack.reapproved
                  ? ('done' as const)
                  : ('idle' as const),
          },
        ]
      : []),
    ...(hasPurchase
      ? [
          {
            label: 'Ordered',
            state:
              ordered || r.status === 'fulfilled'
                ? ('done' as const)
                : r.status === 'approved'
                  ? ('current' as const)
                  : ('idle' as const),
          },
          {
            label: 'At store',
            state:
              atStore || r.status === 'fulfilled'
                ? ('done' as const)
                : r.status === 'approved' && ordered
                  ? ('current' as const)
                  : ('idle' as const),
          },
        ]
      : []),
    {
      label: 'Handed over',
      state:
        r.status === 'fulfilled' ? 'done' : r.status === 'approved' && (!hasPurchase || atStore) ? 'current' : 'idle',
    },
    { label: 'Closed', state: r.confirmedAt ? 'done' : r.status === 'fulfilled' ? 'current' : 'idle' },
  ];
  return (
    <ol
      className="grid w-full items-start"
      style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
      aria-label="Request progress"
    >
      {steps.map((s, i) => {
        const done = !dead && s.state === 'done';
        const cur = !dead && s.state === 'current';
        const returned = !dead && s.state === 'returned';
        return (
          <li key={s.label} className="min-w-0 text-center">
            <div className="relative flex h-7 items-center justify-center">
              {i < steps.length - 1 && (
                <span
                  aria-hidden="true"
                  className={`absolute left-1/2 right-[-50%] top-1/2 h-[2px] -translate-y-1/2 rounded-full transition-colors duration-500 ease-out ${done ? 'bg-gradient-to-r from-blue-500 to-sky-400' : 'bg-line-strong'}`}
                />
              )}
              <span
                className={`relative z-10 grid h-6 w-6 place-items-center rounded-full border text-[11.5px] font-semibold transition-[background-color,border-color,color,box-shadow,transform] duration-300 ease-out ${done ? 'scale-100 border-blue-500 bg-blue-600 text-white shadow-none' : cur ? 'scale-105 border-blue-400 bg-blue-500/15 text-blue-300 ring-4 ring-blue-500/10' : returned ? 'border-amber-500 bg-amber-500/15 text-amber-300' : 'border-line-strong bg-surface text-faint'}`}
              >
                {done ? <Check size={13} strokeWidth={2.5} /> : returned ? '↩' : i + 1}
              </span>
            </div>
            <span
              className={`mt-1.5 block px-1 text-[11.5px] leading-tight transition-colors duration-300 ${done ? 'font-medium text-blue-300' : cur ? 'font-semibold text-ink' : returned ? 'font-medium text-amber-300' : 'text-faint'}`}
            >
              {s.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
};

const TONE = {
  ok: 'bg-emerald-500/15 text-emerald-300',
  warn: 'bg-amber-500/15 text-amber-300',
  mute: 'bg-raised text-ink-soft',
  bad: 'bg-red-500/15 text-red-300',
} as const;

// Keep one fact in each cell so the request summary stays easy to scan.
// Vendor and rate are included for everyone who can see this request.
export const ItemsTable: React.FC<{ r: Req; orders: Record<string, OrderInfo> }> = ({ r, orders }) => {
  const decided = r.status === 'approved' || r.status === 'fulfilled';
  return (
    <div className="overflow-x-auto border border-line rounded-lg">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="bg-canvas text-xs font-medium text-mute">
            <th className="px-3 py-2 text-left">Item</th>
            <th className="px-3 py-2 text-left whitespace-nowrap">Asked</th>
            <th className="px-3 py-2 text-left whitespace-nowrap">Request type</th>
            <th className="px-3 py-2 text-left whitespace-nowrap">Line budget</th>
            <th className="px-3 py-2 text-left">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {r.items.map(i => {
            const st = lineStatus(r, i, orders);
            return (
              <tr key={i.id} className="align-middle">
                <td className="px-3 py-2.5 whitespace-nowrap text-ink font-medium">{i.name}</td>
                <td className="px-3 py-2.5 text-left tabular-nums text-ink-soft whitespace-nowrap">
                  {i.requested} {i.unit}
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap text-ink-soft">
                  {i.returnRequired ? 'Return after use' : 'Purchase / keep'}
                </td>
                <td className="px-3 py-2.5 text-left whitespace-nowrap tabular-nums text-ink-soft">
                  {decided && i.approved !== null
                    ? `₹${(i.budgetAmount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
                    : '—'}
                </td>
                <td className="px-3 py-2.5">
                  <span className="whitespace-nowrap">
                    <Pill c={TONE[st.tone]}>{st.text}</Pill>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export const Timeline: React.FC<{ events: { at: string; by: string; text: string }[] }> = ({ events }) => (
  <ol className="space-y-3">
    {events.map((e, i) => (
      <li key={i} className="flex gap-3">
        <span className="mt-1.5 w-2 h-2 rounded-full bg-blue-500 shrink-0" />
        <div className="min-w-0">
          <div className="text-sm text-ink-soft">{e.text}</div>
          <div className="text-xs text-faint">
            {e.by ? `${e.by} · ` : ''}
            {fmtDateTime(e.at)}
          </div>
        </div>
      </li>
    ))}
    {!events.length && <li className="text-sm text-mute">No activity yet.</li>}
  </ol>
);
