import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Printer,
  Ban,
  RotateCcw,
  FileSpreadsheet,
  ChevronDown,
  CalendarPlus,
  CalendarClock,
  MapPin,
  UserRound,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Card, btnGhost, printLight } from '../../components/ui';
import { DEPTS } from '../../views/orgData';
import { useRequests } from './RequestsContext';
import { DeliveryAssignmentPanel, FulfilmentPanel, ItReviewPanel, OwnerReviewPanel } from './panels';
import { ItemsTable, StatusBadge, Stepper, Timeline, UrgentBadge } from './parts';
import { exportRequestsXlsx } from './exportXlsx';
import { fmtDate, isOverdue } from './types';
import type { NewLine } from './types';

const Info: React.FC<{ label: string; icon: LucideIcon; children: React.ReactNode }> = ({
  label,
  icon: Icon,
  children,
}) => (
  <div className="flex min-w-0 items-start gap-3">
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-raised/50 text-mute">
      <Icon size={15} />
    </span>
    <div className="min-w-0">
      <div className="text-[10.5px] font-semibold uppercase tracking-wider text-faint">{label}</div>
      <div className="mt-0.5 text-sm font-medium text-ink">{children || '—'}</div>
    </div>
  </div>
);

// "in 12 days" / "today" / "3 days late" for a request that is still open.
// Both dates are local midnights, so the count is right at any hour (toISOString would use UTC).
const deadlineNote = (neededBy: string) => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const days = Math.round((new Date(`${neededBy}T00:00:00`).getTime() - today) / 86_400_000);
  if (days === 0) return 'Due today';
  return days > 0 ? `${days} day${days === 1 ? '' : 's'} left` : `${-days} day${days === -1 ? '' : 's'} late`;
};

export const RequestDetail: React.FC<{
  id: string;
  onBack: () => void;
  onCopy: (c: { title: string; purpose: string; deliverTo: string; lines: NewLine[] }) => void;
}> = ({ id, onBack, onCopy }) => {
  const {
    requests,
    ready,
    me,
    orders,
    canReviewIt,
    canAssignDelivery,
    canOwnerReview,
    canCancel,
    canArrange,
    canOrder,
    cancel,
    loadAvailability,
  } = useRequests();
  const r = requests.find(x => x.id === id);
  const [err, setErr] = useState('');
  const [savingAction, setSavingAction] = useState<'cancel' | null>(null);
  const [itemsExpanded, setItemsExpanded] = useState(() => !['approved', 'fulfilled'].includes(r?.status || 'pending'));
  useEffect(() => {
    setItemsExpanded(!['approved', 'fulfilled'].includes(r?.status || 'pending'));
  }, [r?.id, r?.status]);
  if (!r)
    return (
      <div className="mx-auto space-y-3">
        <button className={btnGhost} onClick={onBack}>
          <ArrowLeft size={14} />
          Back
        </button>
        <p className="text-sm text-mute">
          {ready ? 'This request was not found, or you do not have access to it.' : 'Loading…'}
        </p>
      </div>
    );

  const team = r.items.some(i => (i.approved ?? 0) > 0 && canArrange(i.kind)) || canOrder;
  const showFulfil =
    (r.status === 'approved' || r.status === 'fulfilled') &&
    (team ||
      me.isExec ||
      r.requesterId === me.id ||
      me.team === 'purchase' ||
      me.team === 'inventory' ||
      me.team === 'walkie') &&
    r.items.some(i => (i.approved ?? 0) > 0);

  const doCancel = async () => {
    if (!window.confirm('Cancel this request?')) return;
    setErr('');
    setSavingAction('cancel');
    const e = await cancel(r.id);
    setSavingAction(null);
    if (e) setErr(e);
  };
  const copy = () =>
    onCopy({
      title: r.title,
      purpose: r.purpose,
      deliverTo: r.deliverTo,
      lines: r.items.map(i => ({
        kind: i.kind,
        name: i.name,
        unit: i.unit,
        qty: i.requested,
        reason: i.reason,
        note: i.note,
        inventoryItemId: i.inventoryItemId,
        returnRequired: i.returnRequired,
      })),
    });
  const canExport = me.isExec || me.team === 'inventory' || me.team === 'purchase';
  const doExport = async () => {
    const a = canExport ? await loadAvailability() : {};
    exportRequestsXlsx([r], orders, a, r.number);
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <button className={btnGhost} onClick={onBack}>
          <ArrowLeft size={14} />
          Back
        </button>
        <div className="flex gap-2 flex-wrap justify-end">
          {canCancel(r) && (
            <button className={btnGhost} disabled={!!savingAction} onClick={doCancel}>
              <Ban size={14} />
              {savingAction === 'cancel' ? 'Cancelling…' : 'Cancel request'}
            </button>
          )}
          {r.requesterId === me.id && (r.status === 'rejected' || r.status === 'cancelled') && (
            <button className={btnGhost} onClick={copy}>
              <RotateCcw size={14} />
              Request again
            </button>
          )}
          {canExport && (
            <button className={btnGhost} onClick={doExport}>
              <FileSpreadsheet size={14} />
              Excel
            </button>
          )}
          <button className={btnGhost} onClick={printLight}>
            <Printer size={14} />
            Print / save as PDF
          </button>
        </div>
      </div>

      <section className="rounded-xl border border-line bg-surface p-5 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="text-xs font-medium text-mute tracking-wide">{r.number}</div>
            <h2 className="text-xl font-semibold text-ink">{r.title}</h2>
          </div>
          <div className="flex items-center gap-2">
            {r.priority === 'urgent' && <UrgentBadge />}
            {isOverdue(r) && (
              <span className="text-xs font-medium text-red-300 bg-red-500/15 rounded-full px-2 py-0.5">Overdue</span>
            )}
            <StatusBadge status={r.status} closed={!!r.confirmedAt} />
          </div>
        </div>
        <Stepper r={r} orders={orders} />
      </section>

      <section className="rounded-xl border border-line bg-surface p-5 space-y-4">
        <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.5fr)_repeat(3,minmax(0,1fr))]">
          {/* Who asked, and which department the request goes from and to. */}
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-raised/50 text-mute">
              <UserRound size={15} />
            </span>
            <div className="min-w-0">
              <div className="text-[10.5px] font-semibold uppercase tracking-wider text-faint">Requested by</div>
              <div className="mt-0.5 text-sm font-semibold text-ink">
                {r.requesterName || '—'}
                {r.subDepartment && <span className="font-normal text-mute"> · {DEPTS[r.subDepartment]}</span>}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-mute">
                {r.fromDepartmentName && r.fromDepartmentName !== r.departmentName && (
                  <>
                    {r.fromDepartmentName}
                    <ArrowRight size={12} className="text-faint" aria-label="to" />
                  </>
                )}
                {r.departmentName}
              </div>
            </div>
          </div>
          <Info label="Raised on" icon={CalendarPlus}>
            {fmtDate(r.createdAt)}
          </Info>
          <Info label="Needed by" icon={CalendarClock}>
            {r.neededBy ? (
              <>
                {fmtDate(r.neededBy)}
                {['pending_sub', 'pending_it', 'pending_owner', 'approved'].includes(r.status) && (
                  <span
                    className={`mt-1 block w-fit rounded-full px-2 py-0.5 text-[10.5px] font-medium ${isOverdue(r) ? 'bg-red-500/15 text-red-300' : 'bg-raised text-mute'}`}
                  >
                    {deadlineNote(r.neededBy)}
                  </span>
                )}
              </>
            ) : (
              ''
            )}
          </Info>
          <Info label="Deliver to" icon={MapPin}>
            {r.deliverTo}
          </Info>
        </div>
        {r.purpose && (
          <div className="border-t border-line pt-4">
            <div className="text-[10.5px] font-semibold uppercase tracking-wider text-faint">Why it is needed</div>
            <p className="mt-2 whitespace-pre-line border-l-2 border-brand/60 pl-3 text-sm leading-relaxed text-ink-soft">
              {r.purpose}
            </p>
          </div>
        )}
        {(r.subNote || r.itNote || r.ownerNote) && (
          <div className="grid sm:grid-cols-3 gap-3">
            {r.subNote && (
              <div>
                <div className="text-xs text-mute mb-1">Sub Admin's comment</div>
                <p className="text-sm text-ink-soft bg-raised/50 rounded-lg px-3 py-2">{r.subNote}</p>
              </div>
            )}
            {r.itNote && (
              <div>
                <div className="text-xs text-mute mb-1">Department Head's comment</div>
                <p className="text-sm text-ink-soft bg-raised/50 rounded-lg px-3 py-2">{r.itNote}</p>
              </div>
            )}
            {r.ownerNote && (
              <div>
                <div className="text-xs text-mute mb-1">Super Admin's comment</div>
                <p className="text-sm text-ink-soft bg-raised/50 rounded-lg px-3 py-2">{r.ownerNote}</p>
              </div>
            )}
          </div>
        )}
        <div className="space-y-4 border-t border-line pt-4">
          {showFulfil ? (
            <>
              <div className="print:hidden">
                <FulfilmentPanel r={r} />
              </div>
              <div className="hidden print:block">
                <ItemsTable r={r} orders={orders} />
              </div>
            </>
          ) : (
            <div className="space-y-2 print:hidden">
              <button
                type="button"
                aria-expanded={itemsExpanded}
                aria-controls={`request-items-${r.id}`}
                onClick={() => setItemsExpanded(value => !value)}
                className="flex w-full items-center justify-between rounded-lg border border-line bg-raised/20 px-3 py-2 text-left text-sm font-semibold text-ink hover:bg-raised/40"
              >
                <span>
                  Requested items <span className="ml-1 text-xs font-normal text-mute">· {r.items.length}</span>
                </span>
                <ChevronDown
                  size={16}
                  className={`transition-transform duration-300 ease-out ${itemsExpanded ? 'rotate-180' : ''}`}
                />
              </button>
              <div id={`request-items-${r.id}`}>
                {itemsExpanded && (
                  <div className="animate-fade-in">
                    <ItemsTable r={r} orders={orders} />
                  </div>
                )}
              </div>
            </div>
          )}
          {(r.miscItems || r.miscBudget > 0) && (
            <div className="flex items-center justify-between gap-4 rounded-lg border border-line bg-raised/30 px-3 py-2 text-xs">
              <div className="min-w-0">
                <div className="font-medium text-ink-soft">Miscellaneous items</div>
                {r.miscItems && <div className="mt-0.5 whitespace-pre-wrap text-mute">{r.miscItems}</div>}
              </div>
              <div className="shrink-0 text-right">
                <div className="text-mute">Miscellaneous addition</div>
                <div className="font-medium tabular-nums text-ink">
                  ₹{r.miscBudget.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </div>
              </div>
            </div>
          )}
          {err && (
            <div role="alert" className="text-sm text-red-300">
              {err}
            </div>
          )}
        </div>
      </section>

      {canOwnerReview(r) && (
        <div className="print:hidden">
          <OwnerReviewPanel r={r} />
        </div>
      )}
      {canReviewIt(r) && (
        <div className="print:hidden">
          <ItReviewPanel r={r} />
        </div>
      )}
      {canAssignDelivery(r) && r.items.some(i => (i.approved ?? 0) > 0) && (
        <div className="print:hidden">
          <DeliveryAssignmentPanel r={r} />
        </div>
      )}
      <Card title="Activity">
        <Timeline events={r.events} />
      </Card>
      {r.status === 'pending_it' && r.requesterId === me.id && (
        <p className="text-xs text-mute print:hidden">
          The Department Head is reviewing this request. They can approve the plan or escalate it to the Super Admin.
        </p>
      )}
      {r.status === 'pending_owner' && me.isOwner === false && r.requesterId === me.id && (
        <p className="text-xs text-mute print:hidden">The Super Admin is reviewing this request for final approval.</p>
      )}
    </div>
  );
};
