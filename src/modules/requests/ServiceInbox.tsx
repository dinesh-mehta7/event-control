import React, { useMemo, useState } from 'react';
import { ChevronRight, ClipboardList, Search } from 'lucide-react';
import { DEPTS } from '../../pages/orgData';
import { RequestDetail } from './RequestDetail';
import { useRequests } from './RequestsContext';
import { StatusBadge, UrgentBadge } from './parts';
import type { LineKind, Req } from './types';

type Filter = 'all' | 'approval' | 'active' | 'complete';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All requests' }, { id: 'approval', label: 'Awaiting approval' },
  { id: 'active', label: 'Being arranged' }, { id: 'complete', label: 'Closed' },
];

export const ServiceInbox: React.FC<{ kind: LineKind; title: string }> = ({ kind, title }) => {
  const { requests, ready, loading, loadError } = useRequests();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const matching = useMemo(() => requests.filter(r => r.items.some(i => i.kind === kind)), [requests, kind]);
  const counts = useMemo(() => ({
    all: matching.length,
    approval: matching.filter(r => ['pending_sub', 'pending_it', 'pending_owner'].includes(r.status)).length,
    active: matching.filter(r => r.status === 'approved').length,
    complete: matching.filter(r => r.status === 'fulfilled' || r.status === 'rejected' || r.status === 'cancelled').length,
  }), [matching]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return matching.filter(r => {
      const stage = filter === 'approval' ? ['pending_sub', 'pending_it', 'pending_owner'].includes(r.status)
        : filter === 'active' ? r.status === 'approved'
          : filter === 'complete' ? r.status === 'fulfilled' || r.status === 'rejected' || r.status === 'cancelled' : true;
      return stage && (!q || [r.number, r.title, r.requesterName, r.subDepartment ? DEPTS[r.subDepartment] : ''].join(' ').toLowerCase().includes(q));
    });
  }, [matching, filter, query]);

  if (selected) return <RequestDetail id={selected} onBack={() => setSelected(null)} onCopy={() => setSelected(null)} />;
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2"><ClipboardList className="h-4 w-4 text-blue-400" /><h2 className="text-sm font-semibold">Department requests</h2><span className="rounded-full bg-raised px-2 py-0.5 text-[11px] text-mute">{matching.length}</span></div>
        <label className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-faint" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search request or department" className="h-8 w-full rounded-md border border-line bg-field pl-8 pr-2 text-xs text-ink outline-none focus:border-blue-500" />
        </label>
      </div>
      {loadError && <p role="alert" className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{loadError}</p>}
      <div className="flex flex-wrap gap-1 border-b border-line" role="tablist" aria-label={`${title} request filters`}>
        {FILTERS.map(f => <button key={f.id} role="tab" aria-selected={filter === f.id} onClick={() => setFilter(f.id)} className={`px-3 py-2 text-xs border-b-2 ${filter === f.id ? 'border-blue-500 text-blue-400' : 'border-transparent text-mute hover:text-ink'}`}>{f.label}<span className="ml-1.5 text-[10px] opacity-70">{counts[f.id]}</span></button>)}
      </div>
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full min-w-[620px] text-xs">
          <thead><tr className="border-b border-line bg-raised/50 text-left text-[10px] uppercase tracking-wide text-faint"><th className="px-3 py-2">Request</th><th className="px-3 py-2">Department / requester</th><th className="px-3 py-2">Requested {kind === 'radio' ? 'walkies' : 'items'}</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Needed by</th><th className="px-3 py-2" /></tr></thead>
          <tbody className="divide-y divide-line">
            {rows.map(r => <InboxRow key={r.id} request={r} kind={kind} onOpen={() => setSelected(r.id)} />)}
          </tbody>
        </table>
        {!rows.length && <div className="px-4 py-10 text-center text-xs text-mute">{!ready || loading ? 'Loading requests…' : query ? 'No matching requests.' : 'No department requests here yet.'}</div>}
      </div>
    </section>
  );
};

const InboxRow: React.FC<{ request: Req; kind: LineKind; onOpen: () => void }> = ({ request: r, kind, onOpen }) => {
  const lines = r.items.filter(i => i.kind === kind);
  const date = r.neededBy ? new Date(`${r.neededBy}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—';
  return <tr className="hover:bg-raised/40">
    <td className="px-3 py-2"><button onClick={onOpen} className="text-left"><span className="font-mono text-[10px] text-mute">{r.number}</span><span className="ml-2 font-medium text-ink">{r.title}</span>{r.priority === 'urgent' && <span className="ml-2"><UrgentBadge /></span>}</button></td>
    <td className="px-3 py-2 text-ink-soft">{r.subDepartment ? DEPTS[r.subDepartment] : 'Department'}<span className="block text-[10px] text-faint">{r.requesterName || 'Requester'}</span></td>
    <td className="px-3 py-2 text-ink-soft">{lines.map(i => `${i.requested} ${i.unit} ${i.name}`).join(', ')}</td>
    <td className="px-3 py-2"><StatusBadge status={r.status} closed={!!r.confirmedAt} /></td>
    <td className="px-3 py-2 text-ink-soft">{date}</td>
    <td className="px-3 py-2 text-right"><button onClick={onOpen} title="Open request" className="rounded p-1 text-mute hover:bg-raised hover:text-ink"><ChevronRight className="h-4 w-4" /></button></td>
  </tr>;
};

export default ServiceInbox;
