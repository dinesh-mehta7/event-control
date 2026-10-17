import React, { useEffect, useMemo, useState } from 'react';
import { Download, MessageSquare, Printer } from 'lucide-react';
import { printLight } from '../../components/ui';
import { supabase } from '../walkie/lib/supabaseClient';
import { DEPTS } from '../../views/orgData';
import { Badge, Empty, Section, StatCard, cx, ghost } from '../inventory/ui/kit';
import type { Helpdesk } from './useHelpdesk';
import type { SavedView } from './Tickets';
import { PRIORITIES, PRIORITY, STATUSES, dueToday, hours, isOverdue, minutesLabel, relative, ticketNo } from './types';
import type { Ticket } from './types';

// A labelled horizontal bar list (one series, so one colour; counts beside each bar).
const Bars: React.FC<{ rows: { label: string; n: number }[]; empty: string }> = ({ rows, empty }) => {
  const max = Math.max(1, ...rows.map(r => r.n));
  if (!rows.some(r => r.n)) return <Empty>{empty}</Empty>;
  return (
    <ul className="space-y-2 p-4">
      {rows.map(r => (
        <li key={r.label} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_2.5rem] items-center gap-3 text-xs">
          <span className="truncate text-ink-soft" title={r.label}>{r.label}</span>
          <div className="h-2.5 overflow-hidden rounded-full bg-raised"><div className="meter-fill chart-grow-x h-full rounded-r-[4px] bg-chart-1" style={{ width: `${(r.n / max) * 100}%` }} /></div>
          <span className="text-right font-semibold tabular-nums text-ink">{r.n}</span>
        </li>
      ))}
    </ul>
  );
};

export const OverviewView: React.FC<{ hd: Helpdesk; go: (v: SavedView) => void; open: (id: string) => void }> = ({ hd, go, open }) => {
  const t = hd.tickets; const week = Date.now() - 7 * 8.64e7;
  const openT = t.filter(x => x.status !== 'closed');
  const byTech = [...hd.technicians.map(p => ({ label: p.name, n: openT.filter(x => x.assigneeId === p.id).length })), { label: 'Unassigned', n: openT.filter(x => !x.assigneeId).length }];
  const byPri = PRIORITIES.map(p => ({ label: p.label, n: openT.filter(x => x.priority === p.key).length }));
  const attention = [...openT].filter(x => isOverdue(x) || x.priority === 'critical' || !x.assigneeId).slice(0, 6);
  const [replies, setReplies] = useState<{ id: string; ticketId: string; body: string; author: string; at: string }[] | null>(null);
  const latest = t[0]?.updatedAt;
  useEffect(() => {
    if (!hd.orgId) return;
    supabase.from('helpdesk_ticket_events').select('id,ticket_id,body,author_name,created_at').eq('organization_id', hd.orgId).eq('kind', 'reply').order('created_at', { ascending: false }).limit(8)
      .then(({ data }) => setReplies((data || []).map((r: any) => ({ id: r.id, ticketId: r.ticket_id, body: r.body, author: r.author_name, at: r.created_at }))));
  }, [hd.orgId, latest]);
  return (
    <div className="space-y-4">
      <div className="stagger grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Open" value={openT.length} tone="info" onClick={() => go('open')} />
        <StatCard label="Unassigned" value={openT.filter(x => !x.assigneeId).length} tone="warn" onClick={() => go('unassigned')} />
        <StatCard label="Past due" value={t.filter(x => isOverdue(x)).length} tone="bad" onClick={() => go('overdue')} />
        <StatCard label="Due today" value={t.filter(dueToday).length} tone="orange" onClick={() => go('open')} />
        <StatCard label="Waiting" value={t.filter(x => x.status === 'waiting').length} tone="mute" onClick={() => go('waiting')} />
        <StatCard label="Closed this week" value={t.filter(x => x.closedAt && new Date(x.closedAt).getTime() >= week).length} tone="ok" onClick={() => go('closed')} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Open tickets by technician"><Bars rows={byTech} empty="No open tickets." /></Section>
        <Section title="Open tickets by priority"><Bars rows={byPri} empty="No open tickets." /></Section>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Needs attention" hint="Past due, critical or unassigned">
          {!attention.length ? <Empty>Nothing urgent right now.</Empty> : <ul className="divide-y divide-line/70">{attention.map(x => <TicketRow key={x.id} t={x} onClick={() => open(x.id)} />)}</ul>}
        </Section>
        <Section title="Recent replies">
          {replies === null ? <Empty>Loading…</Empty> : !replies.length ? <Empty icon={MessageSquare}>No replies yet.</Empty> : <ul className="divide-y divide-line/70">{replies.map(r => { const tk = t.find(x => x.id === r.ticketId); return (
            <li key={r.id}><button type="button" onClick={() => open(r.ticketId)} className="w-full px-4 py-2.5 text-left hover:bg-raised/40">
              <div className="flex items-center justify-between gap-2 text-[11.5px] text-mute"><span className="truncate"><b className="text-ink">{r.author}</b>{tk ? ` on ${ticketNo(tk)} ${tk.subject}` : ''}</span><span className="shrink-0">{relative(r.at)}</span></div>
              <p className="mt-0.5 line-clamp-2 text-xs text-ink-soft">{r.body}</p>
            </button></li>); })}</ul>}
        </Section>
      </div>
    </div>
  );
};

const TicketRow: React.FC<{ t: Ticket; onClick: () => void }> = ({ t, onClick }) => (
  <li><button type="button" onClick={onClick} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-raised/40">
    <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium text-ink"><span className="mr-1.5 text-mute">{ticketNo(t)}</span>{t.subject}</div><div className="text-[11.5px] text-mute">{t.requesterName} · {t.assigneeName || 'Unassigned'} · due {relative(t.dueAt)}</div></div>
    <Badge tone={PRIORITY[t.priority].tone}>{PRIORITY[t.priority].label}</Badge>{isOverdue(t) && <Badge tone="bad">Past due</Badge>}
  </button></li>
);

export const ReportsView: React.FC<{ hd: Helpdesk }> = ({ hd }) => {
  const [period, setPeriod] = useState<'7' | '30' | 'all'>('30');
  const since = period === 'all' ? 0 : Date.now() - Number(period) * 8.64e7;
  const rows = useMemo(() => hd.tickets.filter(t => new Date(t.createdAt).getTime() >= since), [hd.tickets, since]);
  const closed = rows.filter(t => t.closedAt);
  const avgResolve = closed.length ? closed.reduce((s, t) => s + (new Date(t.closedAt!).getTime() - new Date(t.createdAt).getTime()), 0) / closed.length : 0;
  const responded = rows.filter(t => t.firstResponseAt);
  const avgFirst = responded.length ? responded.reduce((s, t) => s + (new Date(t.firstResponseAt!).getTime() - new Date(t.createdAt).getTime()), 0) / responded.length : 0;
  const inSla = closed.filter(t => t.dueAt && new Date(t.closedAt!) <= new Date(t.dueAt)).length;
  const cats = Array.from(new Set([...hd.settings.categories, ...rows.map(t => t.category)]));
  const [time, setTime] = useState<{ author: string; minutes: number; ticketId: string }[]>([]);
  useEffect(() => {
    if (!hd.orgId) return;
    let q = supabase.from('helpdesk_ticket_events').select('author_name,minutes,ticket_id,created_at').eq('organization_id', hd.orgId).gt('minutes', 0);
    if (since) q = q.gte('created_at', new Date(since).toISOString());
    q.then(({ data }) => setTime((data || []).map((r: any) => ({ author: r.author_name, minutes: r.minutes, ticketId: r.ticket_id }))));
  }, [hd.orgId, since]);
  const totalTime = time.reduce((s, r) => s + r.minutes, 0);
  const timeBy = Array.from(time.reduce((m, r) => m.set(r.author, (m.get(r.author) || 0) + r.minutes), new Map<string, number>()).entries()).map(([label, n]) => ({ label, n: Math.round(n / 6) / 10 })).sort((a, b) => b.n - a.n);
  const exportCsv = () => {
    const head = ['Ticket', 'Subject', 'Status', 'Priority', 'Category', 'Sub-department', 'Location', 'Requester', 'Requester email', 'Technician', 'Created', 'Due', 'First response', 'Closed', 'Within SLA', 'Resolution'];
    const body = rows.map(t => [ticketNo(t), t.subject, t.status, t.priority, t.category, DEPTS[t.department as keyof typeof DEPTS] || t.department, t.location, t.requesterName, t.requesterEmail, t.assigneeName, t.createdAt, t.dueAt || '', t.firstResponseAt || '', t.closedAt || '', t.closedAt && t.dueAt ? (new Date(t.closedAt) <= new Date(t.dueAt) ? 'yes' : 'no') : '', t.resolution]);
    const csv = [head, ...body].map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `helpdesk_${period}_${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div role="group" aria-label="Report period" className="inline-flex rounded-md border border-line bg-raised/40 p-0.5">
          {([['7', 'Last 7 days'], ['30', 'Last 30 days'], ['all', 'All time']] as const).map(([k, l]) => <button key={k} type="button" aria-pressed={period === k} onClick={() => setPeriod(k)} className={cx('rounded px-2.5 py-1 text-[11.5px] font-medium', period === k ? 'bg-surface text-ink shadow-sm' : 'text-mute hover:text-ink')}>{l}</button>)}
        </div>
        <div className="flex gap-1.5"><button className={ghost} onClick={exportCsv} disabled={!rows.length}><Download className="h-3.5 w-3.5" />CSV</button><button className={ghost} onClick={printLight}><Printer className="h-3.5 w-3.5" />Print</button></div>
      </div>
      <div className="stagger grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Tickets created" value={rows.length} />
        <StatCard label="Closed" value={closed.length} tone="ok" />
        <StatCard label="Closed within SLA %" value={closed.length ? Math.round((inSla / closed.length) * 100) : 0} hint={`${inSla} of ${closed.length}`} tone="info" />
        <div className="rounded-xl border border-line bg-surface/60 px-4 py-3"><div className="text-xs font-semibold uppercase tracking-wider text-mute">Avg. time to resolve</div><div className="mt-1.5 text-2xl font-semibold text-ink">{closed.length ? hours(avgResolve) : '—'}</div></div>
        <div className="rounded-xl border border-line bg-surface/60 px-4 py-3"><div className="text-xs font-semibold uppercase tracking-wider text-mute">Time spent</div><div className="mt-1.5 text-2xl font-semibold text-ink">{totalTime ? minutesLabel(totalTime) : '—'}</div></div>
        <div className="rounded-xl border border-line bg-surface/60 px-4 py-3"><div className="text-xs font-semibold uppercase tracking-wider text-mute">Avg. first response</div><div className="mt-1.5 text-2xl font-semibold text-ink">{responded.length ? hours(avgFirst) : '—'}</div></div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="By status"><Bars rows={STATUSES.map(s => ({ label: s.label, n: rows.filter(t => t.status === s.key).length }))} empty="No tickets in this period." /></Section>
        <Section title="By priority"><Bars rows={PRIORITIES.map(p => ({ label: p.label, n: rows.filter(t => t.priority === p.key).length }))} empty="No tickets in this period." /></Section>
        <Section title="By category"><Bars rows={cats.map(c => ({ label: c, n: rows.filter(t => t.category === c).length })).sort((a, b) => b.n - a.n)} empty="No tickets in this period." /></Section>
        <Section title="Time spent by technician (hours)"><Bars rows={timeBy} empty="No time logged in this period." /></Section>
        <Section title="Closed by technician"><Bars rows={[...hd.technicians.map(p => ({ label: p.name, n: closed.filter(t => t.assigneeId === p.id).length })), { label: 'Unassigned', n: closed.filter(t => !t.assigneeId).length }].sort((a, b) => b.n - a.n)} empty="Nothing closed in this period." /></Section>
      </div>
    </div>
  );
};
