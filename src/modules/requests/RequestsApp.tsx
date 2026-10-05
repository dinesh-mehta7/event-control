import React, { useMemo, useState } from 'react';
import { ChevronRight, FileSpreadsheet, Inbox } from 'lucide-react';
import { Empty, PageIntro, Tabs, btnGhost, inputCls } from '../../components/ui';
import { DEPTS } from '../../pages/orgData';
import { useRequests } from './RequestsContext';
import { NewRequest } from './NewRequest';
import { RequestDetail } from './RequestDetail';
import { StatusBadge, UrgentBadge } from './parts';
import { exportRequestsXlsx } from './exportXlsx';
import { fmtDate, isOverdue } from './types';
import type { NewLine, Req } from './types';

const go = (path: string) => { location.hash = '#/requests' + (path ? '/' + path : ''); };

const Row: React.FC<{ r: Req; showWho?: boolean; hint?: string }> = ({ r, showWho, hint }) => {
  const approvedLines = r.items.filter(i => (i.approved ?? 0) > 0).length;
  return (
    <li>
      <button onClick={() => go(r.id)} className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-raised/60 transition-colors">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-mute tabular-nums">{r.number}</span>
            <span className="text-sm font-medium text-ink truncate">{r.title}</span>
            {r.priority === 'urgent' && <UrgentBadge />}
            {isOverdue(r) && <span className="text-xs font-medium text-red-300 bg-red-500/15 rounded-full px-2 py-0.5">Overdue</span>}
          </div>
          <div className="text-xs text-mute mt-0.5">
            {showWho && <>{r.requesterName}{r.subDepartment ? ` · ${DEPTS[r.subDepartment]}` : ''} · </>}
            {r.items.length} item{r.items.length === 1 ? '' : 's'}{r.status === 'approved' || r.status === 'fulfilled' ? ` (${approvedLines} approved)` : ''} · {fmtDate(r.createdAt)}
            {r.neededBy ? ` · needed by ${fmtDate(r.neededBy)}` : ''}
          </div>
          {hint && <div className="text-xs text-amber-300 mt-0.5">{hint}</div>}
        </div>
        <StatusBadge status={r.status} closed={!!r.confirmedAt} />
        <ChevronRight size={16} className="text-faint shrink-0" />
      </button>
    </li>
  );
};

const List: React.FC<{ rows: Req[]; showWho?: boolean; empty: string; hint?: (r: Req) => string | undefined }> = ({ rows, showWho, empty, hint }) => (
  <div className="rounded-xl border border-line bg-surface overflow-hidden">
    {rows.length ? <ul className="divide-y divide-line">{rows.map(r => <Row key={r.id} r={r} showWho={showWho} hint={hint?.(r)} />)}</ul> : <Empty>{empty}</Empty>}
  </div>
);

const FILTERS = [['all', 'All'], ['open', 'Waiting for approval'], ['approved', 'Being arranged'], ['fulfilled', 'Delivered'], ['rejected', 'Declined'], ['cancelled', 'Cancelled']] as const;
const matches = (r: Req, f: string) => f === 'all' || (f === 'open' ? ['pending_sub', 'pending_it', 'pending_owner'].includes(r.status) : r.status === f);

// ── Overview: where every request stands, and what needs this person ───────────────────────────────
const Stat: React.FC<{ label: string; n: number; tone: string; onClick: () => void }> = ({ label, n, tone, onClick }) => (
  <button onClick={onClick} className="text-left rounded-xl border border-line bg-surface p-4 hover:bg-raised/60 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">
    <div className={`text-2xl font-semibold tabular-nums ${tone}`}>{n}</div>
    <div className="text-xs text-mute mt-1">{label}</div>
  </button>
);

const Overview: React.FC<{ onOpen: (filter: string) => void; onDownloadAll: () => void; downloadingAll: boolean; ready: boolean; scope: string }> = ({ onOpen, onDownloadAll, downloadingAll, ready, scope }) => {
  const { requests, me, waitingForMe, toArrange } = useRequests();
  const n = (f: string) => requests.filter(r => matches(r, f)).length;
  const total = requests.length;
  // What needs THIS person, most urgent first, each request listed once.
  const seen = new Set<string>(); const attention: { r: Req; hint: string }[] = [];
  const add = (r: Req, hint: string) => { if (!seen.has(r.id)) { seen.add(r.id); attention.push({ r, hint }); } };
  waitingForMe.forEach(r => add(r, 'Waiting for your decision'));
  toArrange.forEach(r => add(r, 'Needs your team: arrange it or order the items'));
  requests.filter(r => r.status === 'fulfilled' && !r.confirmedAt && r.requesterId === me.id).forEach(r => add(r, 'Delivered. Please confirm you received it'));
  requests.filter(r => isOverdue(r)).forEach(r => add(r, `Overdue. Needed by ${fmtDate(r.neededBy)}`));
  const recent = requests.slice(0, 5);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-sm font-medium text-ink">{scope}</h2>
          <p className="text-xs text-mute mt-0.5">Select a number to filter requests.</p></div>
        {me.isExec && <button type="button" className={btnGhost} disabled={!ready || downloadingAll} onClick={onDownloadAll}><FileSpreadsheet size={14} />{downloadingAll ? 'Preparing Excel…' : 'Download all requests'}</button>}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Stat label="All requests" n={total} tone="text-ink" onClick={() => onOpen('all')} />
        <Stat label="Waiting for approval" n={n('open')} tone="text-amber-300" onClick={() => onOpen('open')} />
        <Stat label="Approved, being arranged" n={n('approved')} tone="text-blue-300" onClick={() => onOpen('approved')} />
        <Stat label="Delivered" n={n('fulfilled')} tone="text-emerald-300" onClick={() => onOpen('fulfilled')} />
        <Stat label="Declined" n={n('rejected')} tone="text-red-300" onClick={() => onOpen('rejected')} />
        <Stat label="Cancelled" n={n('cancelled')} tone="text-mute" onClick={() => onOpen('cancelled')} />
      </div>

      {attention.length > 0 && (
        <section className="space-y-2" aria-label="Needs your attention">
          <h3 className="text-sm font-medium text-ink">Needs your attention</h3>
          <List rows={attention.slice(0, 6).map(a => a.r)} showWho empty="" hint={r => attention.find(a => a.r.id === r.id)?.hint} />
        </section>)}

      {recent.length > 0 && (
        <section className="space-y-2" aria-label="Recent requests">
          <h3 className="text-sm font-medium text-ink">Recent requests</h3>
          <List rows={recent} showWho={me.isExec || me.level === 'sub_dept_head'} empty="" />
        </section>)}
    </div>
  );
};

export const RequestsApp: React.FC<{ tab?: string }> = ({ tab }) => {
  const { requests, ready, loadError, me, orders, waitingForMe, toArrange, canArrange, canOrder, loadAvailability } = useRequests();
  const [filter, setFilter] = useState('all'); const [q, setQ] = useState('');
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [copy, setCopy] = useState<{ title: string; purpose: string; deliverTo: string; lines: NewLine[] } | null>(null);

  const isTeam = me.team === 'inventory' || me.team === 'walkie' || me.team === 'purchase';
  const showReview = me.isExec || me.level === 'sub_dept_head';
  const showFulfil = me.isExec || isTeam;
  const tabs = useMemo(() => [
    { id: 'overview', label: 'Overview' },
    ...(showReview ? [{ id: 'review', label: 'To approve', count: waitingForMe.length, alert: true }] : []),
    { id: 'new', label: 'New request' },
    { id: 'mine', label: 'My requests' },
    ...(showFulfil ? [{ id: 'fulfil', label: 'To arrange', count: toArrange.length, alert: true }] : []),
    ...(me.isExec || me.level === 'sub_dept_head' ? [{ id: 'all', label: me.isExec ? 'All requests' : 'My department' }] : []),
  ], [showReview, showFulfil, waitingForMe.length, toArrange.length, me.isExec, me.level]);

  if (tab && tab.startsWith('rq-')) return <RequestDetail id={tab} onBack={() => history.length > 1 ? history.back() : go('')} onCopy={c => { setCopy(c); go('new'); }} />;
  const cur = tabs.some(t => t.id === tab) ? (tab as string) : 'overview';

  const mine = requests.filter(r => r.requesterId === me.id && matches(r, filter));
  const canExport = me.isExec || me.team === 'inventory' || me.team === 'purchase';
  const exportList = async (rows: Req[], name: string) => exportRequestsXlsx(rows, orders, await loadAvailability(), name);
  const downloadAll = async () => {
    setDownloadingAll(true);
    try { await exportList(requests, 'all-requests-by-department'); }
    finally { setDownloadingAll(false); }
  };
  const needle = q.trim().toLowerCase();
  const all = requests.filter(r => matches(r, filter) && (!needle || r.title.toLowerCase().includes(needle) || r.number.toLowerCase().includes(needle) || r.requesterName.toLowerCase().includes(needle) || (r.subDepartment ? DEPTS[r.subDepartment] : 'other department').toLowerCase().includes(needle)));
  const inProgress = requests.filter(r => r.status === 'approved' && !toArrange.some(t => t.id === r.id));

  const filterBar = (
    <div className="flex flex-wrap items-center gap-2">
      {FILTERS.map(([id, label]) => (
        <button key={id} onClick={() => setFilter(id)} className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${filter === id ? 'bg-blue-600 border-blue-600 text-white' : 'border-line-strong text-mute hover:text-ink hover:bg-raised'}`}>{label}</button>))}
    </div>
  );

  return (
    <div className="space-y-4">
      <PageIntro>Raise material or walkie-talkie requests, follow each approval, and track delivery here.</PageIntro>
      <Tabs label="Requests" value={cur} onChange={id => go(id === 'overview' ? '' : id)} tabs={tabs} />
      {loadError && <div role="alert" className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{loadError}</div>}
      {!ready && !loadError && <p className="text-sm text-mute">Loading…</p>}

      {cur === 'overview' && <Overview onDownloadAll={downloadAll} downloadingAll={downloadingAll} ready={ready} scope={me.isExec ? 'All requests in the organization' : me.level === 'sub_dept_head' ? 'Requests from your department' : 'Your requests'}
        onOpen={f => { setFilter(f); go(me.isExec || me.level === 'sub_dept_head' ? 'all' : 'mine'); }} />}
      {cur === 'mine' && <>{filterBar}<List rows={mine} empty={filter === 'all' ? 'You have not raised any request yet. Use “New request” to start.' : 'No requests with this status.'} /></>}
      {cur === 'new' && <NewRequest key={copy ? 'copy' : 'blank'} copyFrom={copy} onDone={id => { setCopy(null); go(id); }} />}
      {cur === 'review' && (
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-ink">Requests ({waitingForMe.length})</h3>
          <List rows={waitingForMe} showWho empty="No request is waiting for your decision." hint={r => r.status === 'pending_sub' ? 'Branch head review' : r.status === 'pending_it' ? 'IT owner review' : 'Organization owner review'} />
        </div>)}
      {cur === 'fulfil' && (
        <div className="space-y-4">
          <List rows={toArrange} showWho empty="Nothing is waiting for your team." hint={r => canOrder && r.parts.some(p => p.source === 'purchase' && !p.purchaseItemId) ? 'Items to order' : r.items.some(i => canArrange(i.kind) && (i.approved ?? 0) > 0 && r.parts.filter(p => p.itemId === i.id).length === 0) ? 'Needs arranging' : undefined} />
          {canExport && <div className="flex justify-end"><button className={btnGhost} onClick={() => exportList(requests.filter(r => r.status === 'approved'), 'approved-requests')}><FileSpreadsheet size={14} />Excel: demands and what to purchase</button></div>}
          {inProgress.length > 0 && <><h3 className="text-xs font-medium text-mute">Other approved requests in progress</h3><List rows={inProgress} showWho empty="" /></>}
        </div>)}
      {cur === 'all' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 justify-between">{filterBar}
            <div className="flex items-center gap-2">
              {canExport && <button className={btnGhost} onClick={() => exportList(all, 'requests')}><FileSpreadsheet size={14} />Excel: current results</button>}
              {me.isExec && <button className={btnGhost} disabled={!ready || downloadingAll} onClick={downloadAll}><FileSpreadsheet size={14} />{downloadingAll ? 'Preparing…' : 'Download all by department'}</button>}
              <input className={inputCls + ' !w-56'} placeholder="Search number, title, person" aria-label="Search requests" value={q} onChange={e => setQ(e.target.value)} /></div></div>
          <List rows={all} showWho empty="No requests match." />
        </div>)}
      {cur !== 'new' && ready && !requests.length && !loadError && <div className="flex items-center gap-2 text-xs text-faint"><Inbox size={14} />Requests you raise or need to act on will appear here.</div>}
    </div>
  );
};
