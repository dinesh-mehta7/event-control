import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, ChevronRight, FileSpreadsheet, Inbox, Package, Plus, Radio, X } from 'lucide-react';
import { PillTabs } from '../../components/PillTabs';
import { Empty, Tabs, btnGhost, inputCls, btnPrimary } from '../../components/ui';
import { Swap } from '../../components/Swap';
import { HoverSelect } from '../../components/HoverSelect';
import { hoverMenuList, hoverMenuPanel, useHoverMenu } from '../../hooks/useHoverMenu';
import { DEPTS } from '../../views/orgData';
import { useRequests } from './RequestsContext';
import { NewRequest } from './NewRequest';
import { RequestDetail } from './RequestDetail';
import { EventWalkieTickets, useEventWalkies } from './EventWalkieTickets';
import type { WalkieMode } from './EventWalkieTickets';
import {
  DeptRoute,
  StatusBadge,
  UrgentBadge,
  approvedBySuperAdmin,
  departmentHeadReviewAfterSendBack,
} from './parts';
import { exportRequestsXlsx } from './exportXlsx';
import { fmtDate, isOverdue, requestStage } from './types';
import type { NewLine, Req } from './types';

const go = (path: string) => {
  location.hash = '#/requests' + (path ? '/' + path : '');
};

const Row: React.FC<{ r: Req }> = ({ r }) => {
  const { orders } = useRequests();
  const totalBudget = r.items.filter(i => (i.approved ?? i.requested) > 0).every(i => i.budgetAmount !== null)
    ? r.items.reduce((sum, i) => sum + (i.budgetAmount || 0), 0) + r.miscBudget
    : null;
  const escalated = r.events.some(e => e.kind === 'escalated');
  const superApproved = approvedBySuperAdmin(r);
  const afterSendBack = departmentHeadReviewAfterSendBack(r);
  const chain = [
    {
      label: 'Dept Head',
      state:
        afterSendBack.returned
          ? 'done'
          : r.status === 'pending_it'
            ? 'current'
            : ['pending_owner', 'approved', 'fulfilled'].includes(r.status)
            ? 'done'
            : 'idle',
    },
    ...(escalated || r.status === 'pending_owner' || superApproved
      ? [
          {
            label: afterSendBack.returned ? 'Sent back' : 'Super Admin',
            state: r.status === 'pending_owner' ? 'current' : afterSendBack.returned ? 'returned' : superApproved ? 'done' : 'idle',
          },
        ]
      : []),
    ...(afterSendBack.returned
      ? [
          {
            label: 'Dept Head again',
            state: r.status === 'pending_it' ? 'current' : afterSendBack.reapproved ? 'done' : 'idle',
          },
        ]
      : []),
  ];
  const open = () => go(r.id);
  const onKeyDown = (event: React.KeyboardEvent<HTMLTableRowElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open();
    }
  };
  return (
    <tr
      role="link"
      tabIndex={0}
      onClick={open}
      onKeyDown={onKeyDown}
      className="cursor-pointer border-t border-line/80 transition-colors hover:bg-raised/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-blue-500"
    >
      <td className="whitespace-nowrap px-3 py-2.5 align-middle font-mono text-xs text-mute">{r.number}</td>
      <td className="min-w-[240px] px-3 py-2.5 align-middle">
        <span className="block truncate text-xs font-semibold text-ink">{r.title}</span>
      </td>
      <td className="max-w-[260px] px-3 py-2.5 align-middle text-xs text-ink-soft">
        <DeptRoute r={r} />
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 align-middle text-xs font-medium tabular-nums text-ink-soft">
        {totalBudget === null ? '—' : `₹${totalBudget.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 align-middle">
        <div className="flex items-center gap-1">
          {chain.map(step => (
            <span
              key={step.label}
              className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${step.state === 'done' ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300' : step.state === 'current' ? 'border-blue-500 bg-blue-500/15 text-blue-300' : step.state === 'returned' ? 'border-amber-500/50 bg-amber-500/10 text-amber-300' : 'border-line text-faint'}`}
            >
              {step.label}
            </span>
          ))}
        </div>
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 align-middle">
        <div className="flex items-center gap-1.5">
          <StatusBadge status={r.status} closed={!!r.confirmedAt} stage={requestStage(r, orders)} />
          {r.priority === 'urgent' && <UrgentBadge />}
          {isOverdue(r) && (
            <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10.5px] font-medium text-red-300">
              Overdue
            </span>
          )}
        </div>
      </td>
      <td className="w-7 px-2 py-2.5 align-middle text-faint">
        <ChevronRight size={14} />
      </td>
    </tr>
  );
};

const List: React.FC<{ rows: Req[]; empty: string }> = ({ rows, empty }) => (
  <div className="rounded-xl border border-line bg-surface overflow-hidden">
    {rows.length ? (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[850px] border-collapse text-left">
          <thead>
            <tr className="bg-raised/40 text-[10.5px] font-medium uppercase tracking-wide text-mute">
              <th className="px-3 py-2">ID</th>
              <th className="px-3 py-2">Request</th>
              <th className="px-3 py-2">From → To</th>
              <th className="px-3 py-2">Amount</th>
              <th className="px-3 py-2">Approval chain</th>
              <th className="px-3 py-2">Status</th>
              <th className="w-7 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <Row key={r.id} r={r} />
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <Empty>{empty}</Empty>
    )}
  </div>
);

const FILTERS = [
  ['all', 'All'],
  ['open', 'Waiting for approval'],
  ['approved', 'Being arranged'],
  ['fulfilled', 'Handed over'],
  ['rejected', 'Declined'],
  ['cancelled', 'Cancelled'],
] as const;
// Header control that slides in/out. Clip only while hidden, so an open dropdown (Download menu) is not cut off.
const slot = (shown: boolean) =>
  `grid transition-[grid-template-columns,opacity] duration-300 ease-in-out ${
    shown
      ? 'grid-cols-[1fr] opacity-100'
      : 'grid-cols-[0fr] opacity-0 overflow-hidden pointer-events-none [&>*]:overflow-hidden'
  }`;
// One look for both header menu buttons (status filter and Download).
const menuBtn = btnGhost + ' h-9 text-xs';
// Status filter drawn like the Download menu (a native <select> list looks different in every browser).
const StatusMenu: React.FC<{ value: string; onChange: (v: string) => void }> = ({ value, onChange }) => (
  <HoverSelect
    value={value}
    options={FILTERS}
    onChange={onChange}
    label="Filter requests by status"
    className={menuBtn + ' min-w-[9.5rem] justify-between'}
  />
);
const matches = (r: Req, f: string) =>
  f === 'all' || (f === 'open' ? ['pending_sub', 'pending_it', 'pending_owner'].includes(r.status) : r.status === f);

const NewRequestDialog: React.FC<{ children: React.ReactNode; onClose: () => void }> = ({ children, onClose }) => {
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    dialogRef.current
      ?.querySelector<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
      )
      ?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]',
        ),
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  // Portal to <body>: the page-switch animation (Swap) uses transforms, which would trap a fixed overlay inside the page panel.
  return createPortal(
    <div className="fixed inset-0 z-[100] grid place-items-center p-3 sm:p-6" role="presentation">
      <button
        type="button"
        aria-label="Close new request"
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-md animate-fade-in"
      />
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-request-title"
        className="dark relative flex max-h-[min(92dvh,900px)] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-white/[0.08] bg-surface text-white shadow-[0_28px_100px_rgba(0,0,0,.6)] animate-pop-in"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-white/[0.07] px-5 py-4 sm:px-7">
          <div>
            <p id="new-request-title" className="text-lg font-semibold tracking-tight">
              New request
            </p>
            <p className="mt-0.5 text-xs text-white/55">Add the details and follow its progress from your requests.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/[0.08] text-white/70 transition hover:bg-white/[0.14] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400"
          >
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto overscroll-contain px-5 py-5 sm:px-7">{children}</div>
      </section>
    </div>,
    document.body,
  );
};

// ── Overview: where every request stands, and what needs this person ───────────────────────────────
const Stat: React.FC<{ label: string; n: number; tone: string; onClick: () => void }> = ({
  label,
  n,
  tone,
  onClick,
}) => (
  <button
    onClick={onClick}
    className="text-left rounded-xl border border-line bg-surface p-3 sm:p-3.5 hover:bg-raised/60 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
  >
    <div className={`text-xl font-semibold tabular-nums ${tone}`}>{n}</div>
    <div className="text-xs text-mute mt-0.5">{label}</div>
  </button>
);

const Overview: React.FC<{ onOpen: (filter: string) => void }> = ({ onOpen }) => {
  const { requests: visible, me, waitingForMe, toArrange } = useRequests();
  // Only my department's requests: what it sent and what it received (everything for the Super Admin).
  // Requests raised while in another department stay with that department.
  const requests = visible.filter(r =>
    me.isOwner
      ? true
      : me.departmentId
        ? r.fromDepartmentId === me.departmentId || r.departmentId === me.departmentId
        : r.requesterId === me.id,
  );
  const n = (f: string) => requests.filter(r => matches(r, f)).length;
  const total = requests.length;
  // What needs THIS person, most urgent first, each request listed once.
  const seen = new Set<string>();
  const attention: { r: Req; hint: string }[] = [];
  const add = (r: Req, hint: string) => {
    if (!seen.has(r.id)) {
      seen.add(r.id);
      attention.push({ r, hint });
    }
  };
  waitingForMe.forEach(r => add(r, 'Waiting for your decision'));
  toArrange.forEach(r => add(r, 'Choose stock, purchase, or Walkie pool'));
  requests
    .filter(
      r =>
        r.status === 'fulfilled' &&
        !r.confirmedAt &&
        (r.requesterId === me.id || (me.level === 'dept_head' && r.fromDepartmentId === me.departmentId)),
    )
    .forEach(r => add(r, 'Handed over. Please confirm you received it'));
  // Overdue is on the department that has to deliver: requests made TO mine (all of them for the Super Admin).
  requests
    .filter(r => isOverdue(r) && (me.isOwner || r.departmentId === me.departmentId))
    .forEach(r => add(r, `Overdue. Needed by ${fmtDate(r.neededBy)}`));
  const recent = requests.slice(0, 5);
  const overviewRows = attention.length ? attention.slice(0, 6).map(a => a.r) : recent;
  const overviewHeading = attention.length ? 'Needs your attention' : 'Recent requests';

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <Stat
          label={me.isOwner ? 'All requests' : 'Your department · sent & received'}
          n={total}
          tone="text-ink"
          onClick={() => onOpen('all')}
        />
        <Stat label="Waiting for approval" n={n('open')} tone="text-amber-300" onClick={() => onOpen('open')} />
        <Stat
          label="Approved / in progress"
          n={n('approved')}
          tone="text-blue-300"
          onClick={() => onOpen('approved')}
        />
        <Stat label="Handed over" n={n('fulfilled')} tone="text-emerald-300" onClick={() => onOpen('fulfilled')} />
      </div>

      {overviewRows.length > 0 && (
        <section className="space-y-2" aria-label={overviewHeading}>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink">{overviewHeading}</h3>
            {attention.length > 6 && (
              <button className="text-xs text-blue-400 hover:underline" onClick={() => onOpen('open')}>
                View all {attention.length}
              </button>
            )}
          </div>
          <List rows={overviewRows} empty="" />
        </section>
      )}
    </div>
  );
};

export const RequestsApp: React.FC<{ tab?: string }> = ({ tab }) => {
  const { requests, ready, loadError, me, orders, waitingForMe, toArrange, loadAvailability } = useRequests();
  const [filter, setFilter] = useState('all');
  // Items & supplies vs event walkie-talkies: the same switch on every list of requests.
  const [category, setCategory] = useState<'items' | 'walkies'>('items');
  // Inside Incoming / All requests: just what waits for my decision, or everything.
  const [stage, setStage] = useState<'approve' | 'everything'>('approve');
  const [q, setQ] = useState('');
  const {
    open: exportMenuOpen,
    setOpen: setExportMenuOpen,
    ref: exportMenuRef,
    hover: exportMenuHover,
    trigger: exportMenuTrigger,
  } = useHoverMenu();
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [downloadingCurrent, setDownloadingCurrent] = useState(false);
  const [copy, setCopy] = useState<{ title: string; purpose: string; deliverTo: string; lines: NewLine[] } | null>(
    null,
  );
  const closeNewRequest = useCallback(() => go(''), []);

  const walkies = useEventWalkies();
  const approvalCount = waitingForMe.length + walkies.forMode('review').length;
  // "All requests" only makes sense for the Super Admin. A Department Head sees what came TO their
  // department (Incoming); everyone sees what went out FROM theirs (My requests). What waits for a
  // decision is the "To approve" part of Incoming / All requests, so it has no tab of its own.
  const isDeptHead = me.level === 'dept_head';
  const tabs = useMemo(
    () => [
      { id: 'overview', label: 'Overview' },
      { id: 'mine', label: 'My requests' },
      ...(isDeptHead ? [{ id: 'incoming', label: 'Incoming', count: approvalCount, alert: true }] : []),
      ...(me.isOwner ? [{ id: 'all', label: 'All requests', count: approvalCount, alert: true }] : []),
    ],
    [approvalCount, isDeptHead, me.isOwner],
  );

  // Old links: "To approve" (notifications) opens the To approve part; "All requests" opens Incoming for a head.
  const wanted =
    tab === 'review'
      ? me.isOwner
        ? 'all'
        : isDeptHead
          ? 'incoming'
          : 'mine'
      : tab === 'all' && !me.isOwner && isDeptHead
        ? 'incoming'
        : tab;
  const cur =
    wanted === 'new' ? 'new' : wanted === 'fulfil' || tabs.some(t => t.id === wanted) ? (wanted as string) : 'overview';
  const hasStages = cur === 'incoming' || cur === 'all';
  useEffect(() => {
    setExportMenuOpen(false);
    // Opening Incoming / All requests starts on what waits for a decision, if anything does.
    if (cur === 'incoming' || cur === 'all') setStage(tab === 'review' || approvalCount > 0 ? 'approve' : 'everything');
  }, [cur]); // eslint-disable-line react-hooks/exhaustive-deps
  if (tab && tab.startsWith('rq-'))
    return (
      <RequestDetail
        id={tab}
        onBack={() => (history.length > 1 ? history.back() : go(''))}
        onCopy={c => {
          setCopy(c);
          go('new');
        }}
      />
    );

  // My requests = what went out FROM my current department: all of it for its head, my own for everyone
  // else. Requests raised while in another department stay with that department. No department
  // (Super Admin): the ones I raised.
  const fromMyDepartment = (r: Req) =>
    me.departmentId
      ? r.fromDepartmentId === me.departmentId && (me.level === 'dept_head' || r.requesterId === me.id)
      : r.requesterId === me.id;
  const mine = requests.filter(r => fromMyDepartment(r) && matches(r, filter));
  const canExport = me.isExec || me.team === 'inventory' || me.team === 'purchase';
  const exportList = async (rows: Req[], name: string) =>
    exportRequestsXlsx(rows, orders, await loadAvailability(), name);
  const downloadAll = async () => {
    setDownloadingAll(true);
    try {
      await exportList(requests, 'all-requests-by-department');
    } finally {
      setDownloadingAll(false);
    }
  };
  const needle = q.trim().toLowerCase();
  const searched = (r: Req) =>
    !needle ||
    r.title.toLowerCase().includes(needle) ||
    r.number.toLowerCase().includes(needle) ||
    r.requesterName.toLowerCase().includes(needle) ||
    `${r.fromDepartmentName} ${r.departmentName}`.toLowerCase().includes(needle);
  const all = requests.filter(r => matches(r, filter) && searched(r));
  // Incoming: requests made TO my department (whoever raised them).
  const incoming = requests.filter(
    r => !!me.departmentId && r.departmentId === me.departmentId && matches(r, filter) && searched(r),
  );
  const listRows = cur === 'incoming' ? incoming : all;
  const approving = hasStages && stage === 'approve';
  // Which views have walkie requests: mine always; approvals and incoming only for IT; all for the Super Admin.
  const walkieMode: WalkieMode | null =
    cur === 'mine'
      ? 'mine'
      : approving
        ? walkies.approver
          ? 'review'
          : null
        : cur === 'incoming'
          ? walkies.isItHead
            ? 'incoming'
            : null
          : cur === 'all'
            ? 'all'
            : null;
  const itemsCount = cur === 'mine' ? mine.length : approving ? waitingForMe.length : listRows.length;
  const categoryView = walkieMode ? category : 'items';
  const stageSwitch = hasStages && (
    <PillTabs
      label="Show"
      value={stage}
      onChange={id => setStage(id as 'approve' | 'everything')}
      className="inline-flex flex-nowrap gap-1 rounded-lg border border-line bg-surface p-0.5"
      itemClassName="px-3 py-1.5 text-xs"
      tabs={[
        { id: 'approve', label: `To approve · ${approvalCount}` },
        { id: 'everything', label: cur === 'incoming' ? 'All incoming' : 'All' },
      ]}
    />
  );
  const categorySwitch = walkieMode && (
    <PillTabs
      variant="segmented"
      label="Request category"
      value={category}
      onChange={id => setCategory(id as 'items' | 'walkies')}
      className="inline-flex flex-nowrap rounded-lg border border-line bg-raised/40 p-0.5"
      itemClassName="px-3 py-1.5 text-xs"
      tabs={[
        { id: 'items', label: `Items & supplies · ${itemsCount}`, icon: Package },
        { id: 'walkies', label: `Walkie-talkies · ${walkies.forMode(walkieMode).length}`, icon: Radio },
      ]}
    />
  );
  const searchBox = (
    <input
      className={inputCls + ' min-w-[220px] flex-1 sm:max-w-md'}
      placeholder="Search number, title, person, department"
      aria-label="Search requests"
      value={q}
      onChange={e => setQ(e.target.value)}
    />
  );
  // One list view: the category switch, then items or walkies, sliding between them.
  // Incoming / All requests also have the To approve | All switch in front of the category switch.
  const categorised = (items: React.ReactNode) =>
    walkieMode || stageSwitch ? (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {stageSwitch}
          {categorySwitch}
        </div>
        <Swap k={`${stage}:${categoryView}`} indexOf={k => (k.endsWith('items') ? 0 : 1)}>
          {categoryView === 'items' || !walkieMode ? (
            items
          ) : (
            <EventWalkieTickets mode={walkieMode} data={walkies} standalone />
          )}
        </Swap>
      </div>
    ) : (
      items
    );
  const downloadCurrent = async () => {
    setDownloadingCurrent(true);
    try {
      await exportList(all, 'requests');
    } finally {
      setDownloadingCurrent(false);
    }
  };

  const exportControl = () =>
    canExport || me.isExec ? (
      <div className="relative" ref={exportMenuRef} {...exportMenuHover}>
        <button
          type="button"
          className={menuBtn}
          aria-haspopup="menu"
          aria-expanded={exportMenuOpen}
          {...exportMenuTrigger}
        >
          <FileSpreadsheet size={14} />
          Download{' '}
          <ChevronDown
            size={14}
            className={`transition-transform duration-200 ${exportMenuOpen ? 'rotate-180' : ''}`}
          />
        </button>
        <div className={hoverMenuPanel(exportMenuOpen)}>
          <div role="menu" className={hoverMenuList}>
            {canExport && (
              <button
                type="button"
                role="menuitem"
                disabled={downloadingCurrent}
                onClick={() => {
                  setExportMenuOpen(false);
                  void downloadCurrent();
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-ink-soft transition-colors hover:bg-raised hover:text-ink disabled:opacity-50"
              >
                {downloadingCurrent ? 'Preparing…' : 'Excel: current results'}
              </button>
            )}
            {me.isExec && (
              <button
                type="button"
                role="menuitem"
                disabled={!ready || downloadingAll}
                onClick={() => {
                  setExportMenuOpen(false);
                  void downloadAll();
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-ink-soft transition-colors hover:bg-raised hover:text-ink disabled:opacity-50"
              >
                {downloadingAll ? 'Preparing…' : 'Download all by department'}
              </button>
            )}
          </div>
        </div>
      </div>
    ) : null;

  return (
    <div className="space-y-2">
      {cur === 'new' ? (
        <header className="flex justify-end">
          <button className={btnGhost} onClick={() => go('')}>
            Back to requests
          </button>
        </header>
      ) : (
        <div className="flex min-w-0 items-end gap-3">
          <div className="min-w-0 flex-1">
            <Tabs
              compact
              bordered={false}
              label="Request views"
              value={cur}
              onChange={id => go(id === 'overview' ? '' : id)}
              tabs={tabs}
            />
          </div>
          <div className="flex shrink-0 items-center gap-2 pb-1.5">
            {/* The status filter is for item requests; walkie requests show their own progress. */}
            <div className={slot(['mine', 'incoming', 'all'].includes(cur) && categoryView === 'items' && !approving)}>
              <div className="min-w-0">
                <StatusMenu value={filter} onChange={setFilter} />
              </div>
            </div>
            <div className={slot(cur === 'all' && categoryView === 'items' && (canExport || me.isExec))}>
              <div className="min-w-0">{exportControl()}</div>
            </div>
            <div className={slot(me.isExec && cur === 'overview')}>
              <div className="min-w-0 whitespace-nowrap">
                <button type="button" className={btnGhost} disabled={!ready || downloadingAll} onClick={downloadAll}>
                  <FileSpreadsheet size={14} />
                  {downloadingAll ? 'Preparing Excel…' : 'Download all requests'}
                </button>
              </div>
            </div>
            <button className={btnPrimary} onClick={() => go('new')}>
              <Plus size={14} />
              New request
            </button>
          </div>
        </div>
      )}
      {loadError && (
        <div role="alert" className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
          {loadError}
        </div>
      )}
      {!ready && !loadError && <p className="text-sm text-mute">Loading…</p>}

      <Swap k={cur} indexOf={k => tabs.findIndex((t: any) => t.id === k)}>
        {cur === 'overview' && (
          <Overview
            onOpen={f => {
              setFilter(f);
              go(me.isOwner ? 'all' : isDeptHead ? 'incoming' : 'mine');
            }}
          />
        )}
        {cur === 'mine' &&
          categorised(
            <List
              rows={mine}
              empty={
                filter === 'all'
                  ? 'Your department has not raised any request yet. Use “New request” to start.'
                  : 'No requests with this status.'
              }
            />,
          )}
        {cur === 'new' && (
          <NewRequestDialog onClose={closeNewRequest}>
            <NewRequest
              key={copy ? 'copy' : 'blank'}
              copyFrom={copy}
              onDone={id => {
                setCopy(null);
                // Event walkie requests are followed under My requests (most people cannot open the Walkie module).
                if (id === 'event-radio') {
                  location.replace('#/requests/mine');
                  return;
                }
                // Replace the "new" entry so Back from the ticket does not reopen the empty form.
                location.replace('#/requests/' + id);
              }}
            />
          </NewRequestDialog>
        )}
        {cur === 'fulfil' && (
          <div className="space-y-4">
            <List rows={toArrange} empty="Nothing is waiting for your decision." />
            {canExport && (
              <div className="flex justify-end">
                <button
                  className={btnGhost}
                  onClick={() =>
                    exportList(
                      requests.filter(r => r.status === 'approved'),
                      'approved-requests',
                    )
                  }
                >
                  <FileSpreadsheet size={14} />
                  Excel: demands and what to purchase
                </button>
              </div>
            )}
          </div>
        )}
        {(cur === 'all' || cur === 'incoming') &&
          categorised(
            approving ? (
              <List rows={waitingForMe} empty="Nothing is waiting for your decision." />
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">{searchBox}</div>
                <List
                  rows={listRows}
                  empty={
                    needle || filter !== 'all'
                      ? 'No requests match.'
                      : cur === 'incoming'
                        ? 'No department has made a request to yours yet.'
                        : 'No requests yet.'
                  }
                />
              </div>
            ),
          )}
      </Swap>
      {cur !== 'new' && ready && !requests.length && !loadError && (
        <div className="flex items-center gap-2 text-xs text-faint">
          <Inbox size={14} />
          Requests you raise or need to act on will appear here.
        </div>
      )}
    </div>
  );
};
