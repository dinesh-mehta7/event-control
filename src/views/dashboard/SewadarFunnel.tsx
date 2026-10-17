import React, { useMemo, useState } from 'react';
import { ChevronRight, HeartHandshake } from 'lucide-react';
import { useManpower } from '../../modules/manpower';
import type { Sewadar } from '../../modules/manpower/types';
import { DEPTS } from '../orgData';
import { DashboardDialog, Segmented, StatTile } from './Dialog';

// Calling list → contacted → arrived → badge issued. Each step is a subset of the one before,
// so the gap between bars is the drop-off. One hue, deepening as people get further along.
const STEPS = [
  { key: 'list', label: 'In calling list', cls: 'bg-chart-2/40' },
  { key: 'contacted', label: 'Contacted', cls: 'bg-chart-2/60' },
  { key: 'arrived', label: 'Arrived', cls: 'bg-chart-2/80' },
  { key: 'badge', label: 'Badge issued', cls: 'bg-chart-2' },
] as const;
type Counts = { list: number; contacted: number; arrived: number; badge: number; notComing: number; awaiting: number };

const countOf = (people: Sewadar[]): Counts => {
  const list = people.filter(p => p.memberType !== 'salary_based');
  const arrived = list.filter(p => p.arrival === 'arrived');
  return {
    list: list.length,
    contacted: list.filter(p => p.callCount > 0 || p.arrival !== 'pending').length,
    arrived: arrived.length,
    badge: arrived.filter(p => p.badgeIssued).length,
    notComing: list.filter(p => p.arrival === 'not_coming').length,
    // Called at least once but no answer yet (still pending).
    awaiting: list.filter(p => p.arrival === 'pending' && p.callCount > 0).length,
  };
};
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

// `fill` stretches the steps to the height of the card, with taller bars.
const Funnel: React.FC<{ c: Counts; fill?: boolean }> = ({ c, fill }) => (
  <ul className={fill ? 'flex h-full flex-col justify-between gap-3' : 'space-y-2.5'}>
    {STEPS.map((s, i) => {
      const n = c[s.key]; const prev = i ? c[STEPS[i - 1].key] : n;
      return (
        <li key={s.key} className="grid grid-cols-[7.5rem_minmax(0,1fr)_5.5rem] items-center gap-3" title={`${s.label}: ${n}${i ? ` · ${pct(n, prev)}% of ${STEPS[i - 1].label.toLowerCase()}` : ''}`}>
          <span className="truncate text-xs text-ink-soft">{s.label}</span>
          <div className={`relative overflow-hidden rounded-md bg-raised/60 ${fill ? 'h-8' : 'h-6'}`} role="img" aria-label={`${s.label}: ${n} of ${c.list}`}>
            {/* faint remainder = people lost since the previous step */}
            {i > 0 && <div className="meter-fill absolute inset-y-0 left-0 rounded-md bg-chart-2/10" style={{ width: `${pct(prev, c.list)}%` }} />}
            <div className={`meter-fill chart-grow-x absolute inset-y-0 left-0 rounded-md ${s.cls}`} style={{ width: `${pct(n, c.list)}%`, ['--i' as any]: i }} />
          </div>
          <span className="text-right text-xs tabular-nums"><b className="text-ink">{n}</b>{i > 0 && <span className="ml-1.5 text-mute">{pct(n, prev)}%</span>}</span>
        </li>
      );
    })}
  </ul>
);

export const SewadarFunnelCard: React.FC<{ onOpen: () => void }> = ({ onOpen }) => {
  const { sewadars, loading } = useManpower();
  const c = useMemo(() => countOf(sewadars), [sewadars]);
  return (
    <section className="flex min-w-0 flex-col rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h2 className="text-sm font-semibold text-ink">Sewadar funnel</h2>
          <p className="mt-0.5 text-[11.5px] text-mute">From the calling list to a badge on site · % is of the step before</p></div>
        <span className="text-[11.5px] text-mute"><b className="tabular-nums text-ink">{pct(c.badge, c.list)}%</b> fully on duty</span>
      </div>
      {c.list ? <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
          aria-label="Open the Sewadar funnel by sub-department" title="Click for details by sub-department"
          className="mt-4 -mx-2 flex min-h-[11rem] flex-1 cursor-pointer flex-col rounded-lg px-2 py-1 outline-none transition-colors hover:bg-raised/30 focus-visible:ring-2 focus-visible:ring-blue-500/40"><Funnel c={c} fill /></div>
        : <div className="mt-3 flex min-h-28 flex-1 items-center justify-center rounded-lg border border-dashed border-line px-3 text-center text-[11.5px] text-mute">{loading ? 'Loading Sewadars…' : 'No one is on the calling list yet.'}</div>}
      {/* Where people are stuck right now. */}
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[['To call', c.list - c.contacted, 'not called yet', '#/sewadars/calling'], ['Awaiting reply', c.awaiting, 'called, no answer', '#/sewadars/calling'], ['Not coming', c.notComing, 'said no', '#/sewadars/roster'], ['Badge pending', c.arrived - c.badge, 'arrived, no badge', '#/sewadars/attendance']].map(([label, n, hint, href]) => (
          <a key={label as string} href={href as string} className="rounded-lg border border-line bg-raised/30 px-3 py-2 transition-colors hover:border-blue-400/50">
            <div className="text-[11px] text-mute">{label}</div><div className="text-lg font-semibold tabular-nums text-ink">{n}</div><div className="truncate text-[10.5px] text-faint">{hint}</div>
          </a>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-2 text-[11.5px] text-mute">
        <span>Bars share one scale · faint part = lost since the step before</span>
        <button type="button" onClick={onOpen} className="inline-flex shrink-0 items-center gap-0.5 font-medium text-blue-300 hover:text-blue-200">By sub-department<ChevronRight size={13} /></button>
      </div>
    </section>
  );
};

export const SewadarFunnelDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { sewadars } = useManpower();
  const [sort, setSort] = useState<'drop' | 'size'>('drop');
  const all = useMemo(() => countOf(sewadars), [sewadars]);
  const rows = useMemo(() => {
    const ids = [...Object.keys(DEPTS), ''];
    return ids.map(id => ({ id, name: id ? DEPTS[id as keyof typeof DEPTS] : 'No sub-department', c: countOf(sewadars.filter(p => (p.department || '') === id)) }))
      .filter(r => r.c.list > 0)
      .sort((a, b) => (sort === 'drop' ? (b.c.list - b.c.badge) - (a.c.list - a.c.badge) : b.c.list - a.c.list) || a.name.localeCompare(b.name));
  }, [sewadars, sort]);
  const max = Math.max(1, ...rows.map(r => r.c.list));
  return (
    <DashboardDialog title="Sewadar funnel" subtitle="Calling list → contacted → arrived → badge issued, by sub-department" icon={HeartHandshake} onClose={onClose}
      actions={<div className="flex gap-1.5"><a href="#/sewadars/calling" onClick={onClose} className="rounded-md border border-line px-2.5 py-1.5 text-[11.5px] font-medium text-ink-soft hover:bg-raised">Calling</a><a href="#/sewadars/attendance" onClick={onClose} className="rounded-md border border-line px-2.5 py-1.5 text-[11.5px] font-medium text-ink-soft hover:bg-raised">Attendance</a></div>}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <StatTile label="In calling list" value={all.list} />
        <StatTile label="Contacted" value={all.contacted} hint={`${pct(all.contacted, all.list)}% of list`} />
        <StatTile label="Arrived" value={all.arrived} hint={`${pct(all.arrived, all.contacted)}% of contacted`} />
        <StatTile label="Badge issued" value={all.badge} hint={`${pct(all.badge, all.arrived)}% of arrived`} />
        <StatTile label="Not coming" value={all.notComing} />
      </div>
      {all.list > 0 && <div className="mt-5"><Funnel c={all} /></div>}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-ink">By sub-department</h3>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-mute">{STEPS.map(s => <span key={s.key} className="inline-flex items-center gap-1.5"><i className={`h-2.5 w-2.5 rounded-[3px] ${s.cls}`} />{s.label}</span>)}</div>
          <Segmented<'drop' | 'size'> label="Sort" value={sort} onChange={setSort} options={[{ id: 'drop', label: 'Biggest drop-off' }, { id: 'size', label: 'Largest list' }]} />
        </div>
      </div>
      <div className="mt-2 overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead className="bg-raised text-[10.5px] uppercase tracking-wide text-mute"><tr><th className="px-3 py-2 font-semibold">Sub-department</th><th className="px-3 py-2 font-semibold">Funnel</th>{STEPS.map(s => <th key={s.key} className="px-3 py-2 text-right font-semibold">{s.label}</th>)}<th className="px-3 py-2 text-right font-semibold">Not coming</th></tr></thead>
          <tbody className="divide-y divide-line">
            {rows.map(r => <tr key={r.id || 'none'}>
              <td className="px-3 py-2 font-medium text-ink">{r.name}</td>
              <td className="w-48 px-3 py-2"><div className="relative h-3.5" role="img" aria-label={`${r.name}: ${r.c.badge} with badge of ${r.c.list}`}>
                {STEPS.map((s, i) => <div key={s.key} className={`meter-fill absolute inset-y-0 left-0 rounded-sm ${s.cls}`} style={{ width: `${(r.c[s.key] / max) * 100}%`, zIndex: i }} />)}
              </div></td>
              {STEPS.map((s, i) => <td key={s.key} className="px-3 py-2 text-right tabular-nums text-ink">{r.c[s.key]}{i > 0 && <span className="ml-1 text-mute">{pct(r.c[s.key], r.c[STEPS[i - 1].key])}%</span>}</td>)}
              <td className="px-3 py-2 text-right tabular-nums text-mute">{r.c.notComing}</td>
            </tr>)}
            {!rows.length && <tr><td colSpan={7} className="px-3 py-6 text-center text-mute">No one is on the calling list yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </DashboardDialog>
  );
};
