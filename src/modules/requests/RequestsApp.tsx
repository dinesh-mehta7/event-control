import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronRight, FileSpreadsheet, Inbox, Plus, X } from 'lucide-react';
import { Empty, Tabs, btnGhost, inputCls, btnPrimary } from '../../components/ui';
import { Swap } from '../../components/Swap';
import { DEPTS } from '../../views/orgData';
import { useRequests } from './RequestsContext';
import { NewRequest } from './NewRequest';
import { RequestDetail } from './RequestDetail';
import { StatusBadge, UrgentBadge } from './parts';
import { exportRequestsXlsx } from './exportXlsx';
import { fmtDate, isOverdue } from './types';
import type { NewLine, Req } from './types';

const go = (path: string) => {
  location.hash = '#/requests' + (path ? '/' + path : '');
};

const Row: React.FC<{ r: Req }> = ({ r }) => {
  const totalBudget = r.items.filter(i => (i.approved ?? i.requested) > 0).every(i => i.budgetAmount !== null)
    ? r.items.reduce((sum, i) => sum + (i.budgetAmount || 0), 0) + r.miscBudget
    : null;
  const escalated = r.events.some(e => e.kind === 'escalated');
  const superApproved = r.events.some(e => e.kind === 'approved' && e.text.toLowerCase().includes('super admin'));
  const chain = [
    {
      label: 'IT Head',
      state:
        r.status === 'pending_it'
          ? 'current'
          : ['pending_owner', 'approved', 'fulfilled'].includes(r.status)
            ? 'done'
            : 'idle',
    },
    ...(escalated || r.status === 'pending_owner' || superApproved
      ? [{ label: 'Super Admin', state: r.status === 'pending_owner' ? 'current' : superApproved ? 'done' : 'idle' }]
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
      <td className="max-w-[160px] truncate whitespace-nowrap px-3 py-2.5 align-middle text-xs text-ink-soft">
        {r.departmentName || (r.subDepartment ? DEPTS[r.subDepartment] : '—')}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 align-middle text-xs font-medium tabular-nums text-ink-soft">
        {totalBudget === null ? '—' : `₹${totalBudget.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 align-middle">
        <div className="flex items-center gap-1">
          {chain.map(step => (
            <span
              key={step.label}
              className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${step.state === 'done' ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300' : step.state === 'current' ? 'border-blue-500 bg-blue-500/15 text-blue-300' : 'border-line text-faint'}`}
            >
              {step.label}
            </span>
          ))}
        </div>
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 align-middle">
        <div className="flex items-center gap-1.5">
          <StatusBadge status={r.status} closed={!!r.confirmedAt} />
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
              <th className="px-3 py-2">Dept</th>
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
  ['fulfilled', 'Delivered'],
  ['rejected', 'Declined'],
  ['cancelled', 'Cancelled'],
] as const;
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
  const { requests, me, waitingForMe, toArrange } = useRequests();
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
    .filter(r => r.status === 'fulfilled' && !r.confirmedAt && r.requesterId === me.id)
    .forEach(r => add(r, 'Delivered. Please confirm you received it'));
  requests.filter(r => isOverdue(r)).forEach(r => add(r, `Overdue. Needed by ${fmtDate(r.neededBy)}`));
  const recent = requests.slice(0, 5);
  const overviewRows = attention.length ? attention.slice(0, 6).map(a => a.r) : recent;
  const overviewHeading = attention.length ? 'Needs your attention' : 'Recent requests';

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <Stat label="All requests" n={total} tone="text-ink" onClick={() => onOpen('all')} />
        <Stat label="Waiting for approval" n={n('open')} tone="text-amber-300" onClick={() => onOpen('open')} />
        <Stat
          label="Approved / in progress"
          n={n('approved')}
          tone="text-blue-300"
          onClick={() => onOpen('approved')}
        />
        <Stat label="Delivered" n={n('fulfilled')} tone="text-emerald-300" onClick={() => onOpen('fulfilled')} />
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
  const [q, setQ] = useState('');
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [downloadingCurrent, setDownloadingCurrent] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const [copy, setCopy] = useState<{ title: string; purpose: string; deliverTo: string; lines: NewLine[] } | null>(
    null,
  );
  const closeNewRequest = useCallback(() => go(''), []);

  useEffect(() => {
    if (!exportMenuOpen) return;
    const closeOnOutside = (event: MouseEvent) => {
      if (!exportMenuRef.current?.contains(event.target as Node)) setExportMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExportMenuOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [exportMenuOpen]);

  const showReview = me.isExec;
  const tabs = useMemo(
    () => [
      { id: 'overview', label: 'Overview' },
      ...(showReview ? [{ id: 'review', label: 'To approve', count: waitingForMe.length, alert: true }] : []),
      { id: 'mine', label: 'My requests' },
      ...(me.isExec ? [{ id: 'all', label: 'All requests' }] : []),
    ],
    [showReview, waitingForMe.length, me.isExec, me.level],
  );

  const cur = tab === 'new' ? 'new' : tab === 'fulfil' || tabs.some(t => t.id === tab) ? (tab as string) : 'overview';
  useEffect(() => {
    setExportMenuOpen(false);
  }, [cur]);
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

  const mine = requests.filter(r => r.requesterId === me.id && matches(r, filter));
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
  const all = requests.filter(
    r =>
      matches(r, filter) &&
      (!needle ||
        r.title.toLowerCase().includes(needle) ||
        r.number.toLowerCase().includes(needle) ||
        r.requesterName.toLowerCase().includes(needle) ||
        (r.subDepartment ? DEPTS[r.subDepartment] : 'other department').toLowerCase().includes(needle)),
  );
  const downloadCurrent = async () => {
    setDownloadingCurrent(true);
    try {
      await exportList(all, 'requests');
    } finally {
      setDownloadingCurrent(false);
    }
  };

  const statusFilter = (id: string) => (
    <div className="relative">
      <label className="sr-only" htmlFor={id}>
        Filter requests
      </label>
      <select
        id={id}
        value={filter}
        onChange={event => setFilter(event.target.value)}
        className="h-9 appearance-none rounded-lg border border-line-strong bg-raised pl-3 pr-9 text-xs font-medium text-ink outline-none transition-colors hover:bg-raised/80 focus:border-blue-500"
      >
        {FILTERS.map(([option, label]) => (
          <option key={option} value={option}>
            {label}
          </option>
        ))}
      </select>
      <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-mute" />
    </div>
  );

  const exportControl = () =>
    canExport || me.isExec ? (
      <div className="relative" ref={exportMenuRef}>
        <button
          type="button"
          className={btnGhost}
          aria-haspopup="menu"
          aria-expanded={exportMenuOpen}
          onClick={() => setExportMenuOpen(open => !open)}
        >
          <FileSpreadsheet size={14} />
          Download{' '}
          <ChevronDown
            size={14}
            className={`transition-transform duration-200 ${exportMenuOpen ? 'rotate-180' : ''}`}
          />
        </button>
        {exportMenuOpen && (
          <div
            role="menu"
            className="absolute right-0 top-full z-30 mt-2 w-56 origin-top-right rounded-xl border border-line bg-surface p-1.5 shadow-2xl animate-pop-in"
          >
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
        )}
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
            <div
              className={`grid overflow-hidden transition-[grid-template-columns,opacity] duration-300 ease-in-out ${cur === 'mine' || cur === 'all' ? 'grid-cols-[1fr] opacity-100' : 'grid-cols-[0fr] opacity-0'}`}
            >
              <div className="min-w-0 overflow-hidden">{statusFilter('request-status-filter')}</div>
            </div>
            <div
              className={`grid overflow-hidden transition-[grid-template-columns,opacity] duration-300 ease-in-out ${cur === 'all' && (canExport || me.isExec) ? 'grid-cols-[1fr] opacity-100' : 'grid-cols-[0fr] opacity-0'}`}
            >
              <div className="min-w-0 overflow-hidden">{exportControl()}</div>
            </div>
            <div
              className={`grid overflow-hidden transition-[grid-template-columns,opacity] duration-300 ease-in-out ${me.isExec && cur === 'overview' ? 'grid-cols-[1fr] opacity-100' : 'grid-cols-[0fr] opacity-0'}`}
            >
              <div className="min-w-0 overflow-hidden whitespace-nowrap">
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
              go(me.isExec || me.level === 'sub_dept_head' ? 'all' : 'mine');
            }}
          />
        )}
        {cur === 'mine' && (
          <List
            rows={mine}
            empty={
              filter === 'all'
                ? 'You have not raised any request yet. Use “New request” to start.'
                : 'No requests with this status.'
            }
          />
        )}
        {cur === 'new' && (
          <NewRequestDialog onClose={closeNewRequest}>
            <NewRequest
              key={copy ? 'copy' : 'blank'}
              copyFrom={copy}
              onDone={id => {
                setCopy(null);
                if (id === 'event-radio') {
                  location.hash = '#/walkie/requests';
                  return;
                }
                go(id);
              }}
            />
          </NewRequestDialog>
        )}
        {cur === 'review' && (
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-ink">Requests ({waitingForMe.length})</h3>
            <List rows={waitingForMe} empty="No request is waiting for your decision." />
          </div>
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
        {cur === 'all' && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <input
                className={inputCls + ' min-w-[220px] flex-1 sm:max-w-md'}
                placeholder="Search number, title, person"
                aria-label="Search requests"
                value={q}
                onChange={e => setQ(e.target.value)}
              />
            </div>
            <List rows={all} empty="No requests match." />
          </div>
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
