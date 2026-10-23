import React, { useMemo, useState } from 'react';
import { ChevronRight, ClipboardList } from 'lucide-react';
import { useRequests } from '../../modules/requests';
import type { ReqStatus } from '../../modules/requests/types';
import { DashboardDialog, Segmented, StatTile } from './Dialog';
import { Legend, MiniColumns, dayKey, lastDays } from './charts';

const DAY_LEGEND = [
  { label: 'Raised', cls: 'bg-chart-1' },
  { label: 'Approved so far', cls: 'bg-chart-2' },
];

// Pipeline order. One hue, light → full as a request moves toward delivery; finished-without-delivery is muted.
const STAGES: { key: ReqStatus | 'closed'; label: string; cls: string }[] = [
  { key: 'pending_sub', label: 'With Sub Admin', cls: 'bg-chart-1/30' },
  { key: 'pending_it', label: 'With IT Dept Head', cls: 'bg-chart-1/45' },
  { key: 'pending_owner', label: 'With Super Admin', cls: 'bg-chart-1/60' },
  { key: 'approved', label: 'Being arranged', cls: 'bg-chart-1/80' },
  { key: 'fulfilled', label: 'Handed over', cls: 'bg-chart-1' },
  { key: 'closed', label: 'Rejected / cancelled', cls: 'bg-faint/40' },
];
const WAITING: ReqStatus[] = ['pending_sub', 'pending_it', 'pending_owner'];

const usePipeline = () => {
  const { requests, loading } = useRequests();
  return useMemo(() => {
    const count = (k: string) =>
      requests.filter(r => (k === 'closed' ? r.status === 'rejected' || r.status === 'cancelled' : r.status === k))
        .length;
    const stages = STAGES.map(s => ({ ...s, n: count(s.key) }));
    const delivered = requests.filter(r => r.status === 'fulfilled');
    const avgDays = delivered.length
      ? delivered.reduce(
          (t, r) => t + Math.max(0, (new Date(r.updatedAt).getTime() - new Date(r.createdAt).getTime()) / 864e5),
          0,
        ) / delivered.length
      : null;
    // Both series are grouped by the day a request was RAISED: how many were raised that day, and how many of
    // those same requests have been approved so far. So "approved" can never exceed "raised" for a day.
    const perDay = (n: number) => {
      const days = lastDays(n);
      const raised = new Map<string, number>();
      const approved = new Map<string, number>();
      requests.forEach(r => {
        const k = dayKey(r.createdAt);
        raised.set(k, (raised.get(k) || 0) + 1);
        const wasApproved =
          r.status === 'approved' || r.status === 'fulfilled' || r.events.some(e => e.kind === 'approved');
        if (wasApproved) approved.set(k, (approved.get(k) || 0) + 1);
      });
      return days.map(date => ({ date, value: raised.get(date) || 0, value2: approved.get(date) || 0 }));
    };
    return {
      loading,
      total: requests.length,
      stages,
      waiting: requests.filter(r => WAITING.includes(r.status)).length,
      arranging: count('approved'),
      delivered: delivered.length,
      avgDays,
      perDay,
    };
  }, [requests, loading]);
};

// One stacked bar: every request, split by where it is in the pipeline.
const StageBar: React.FC<{ stages: ReturnType<typeof usePipeline>['stages']; total: number; tall?: boolean }> = ({
  stages,
  total,
  tall,
}) => {
  const [hover, setHover] = useState<string | null>(null);
  const shown = stages.filter(s => s.n > 0);
  const h = stages.find(s => s.key === hover);
  return (
    <div>
      <div
        className={`flex w-full gap-[2px] overflow-hidden rounded-md ${tall ? 'h-11' : 'h-9'}`}
        role="img"
        aria-label={`Requests by stage: ${stages.map(s => `${s.label} ${s.n}`).join(', ')}`}
      >
        {shown.map((s, i) => {
          const pct = (s.n / total) * 100;
          return (
            <a
              key={s.key}
              href="#/requests/all"
              onPointerEnter={() => setHover(s.key)}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(s.key)}
              onBlur={() => setHover(null)}
              aria-label={`${s.label}: ${s.n}`}
              className={`chart-grow-x block min-w-[6px] transition-[filter] hover:brightness-110 ${s.cls}`}
              style={{ width: `${pct}%`, ['--i' as any]: i }}
            />
          );
        })}
      </div>
      <div className="mt-1.5 h-4 text-[11.5px] text-mute">
        {h ? (
          <>
            <b className="text-ink">{h.label}</b> · <span className="tabular-nums">{h.n}</span> (
            {Math.round((h.n / total) * 100)}%)
          </>
        ) : (
          'Hover a segment for its count · click to open Requests'
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1.5 text-[11.5px] text-mute">
        {stages.map(s => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <i className={`h-2.5 w-2.5 rounded-[3px] ${s.cls}`} />
            {s.label} <b className="tabular-nums text-ink">{s.n}</b>
          </span>
        ))}
      </div>
    </div>
  );
};

export const RequestsPipelineCard: React.FC<{ onOpen: () => void }> = ({ onOpen }) => {
  const p = usePipeline();
  const today = lastDays(1)[0];
  return (
    <section className="flex min-w-0 flex-col rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-ink">Requests pipeline</h2>
          <p className="mt-0.5 text-[11.5px] text-mute">
            <b className="tabular-nums text-ink">{p.waiting}</b> waiting for a decision ·{' '}
            <b className="tabular-nums text-ink">{p.arranging}</b> being arranged
          </p>
        </div>
        <span className="text-[11.5px] text-mute">
          <b className="tabular-nums text-ink">{p.total}</b> total
        </span>
      </div>
      {p.total ? (
        <>
          <div className="mt-3">
            <StageBar stages={p.stages} total={p.total} />
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11.5px] font-medium text-mute">
              Requests raised per day · last 14 days, and how many of them are approved
            </span>
            <Legend items={DAY_LEGEND} />
          </div>
          <MiniColumns
            rows={p.perDay(14)}
            height={130}
            label="Requests raised per day over the last 14 days, and how many of them have been approved"
            unit="raised"
            unit2="approved"
            highlight={today}
            onSelect={onOpen}
          />
        </>
      ) : (
        <div className="mt-3 flex min-h-28 flex-1 items-center justify-center rounded-lg border border-dashed border-line px-3 text-center text-[11.5px] text-mute">
          {p.loading ? 'Loading requests…' : 'No requests have been raised yet.'}
        </div>
      )}
      <div className="mt-2 flex items-center justify-between gap-2 border-t border-line pt-2 text-[11.5px] text-mute">
        <span>
          {p.avgDays !== null ? (
            <>
              Delivered in <b className="tabular-nums text-ink">{p.avgDays.toFixed(1)}</b> days on average
            </>
          ) : (
            'No deliveries yet'
          )}
        </span>
        <button
          type="button"
          onClick={onOpen}
          className="inline-flex shrink-0 items-center gap-0.5 font-medium text-blue-300 hover:text-blue-200"
        >
          Requests analysis
          <ChevronRight size={13} />
        </button>
      </div>
    </section>
  );
};

export const RequestsPipelineDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const p = usePipeline();
  const [range, setRange] = useState<'14' | '30'>('14');
  const today = lastDays(1)[0];
  return (
    <DashboardDialog
      title="Requests analysis"
      subtitle="Every request by stage, and how many are raised each day"
      icon={ClipboardList}
      onClose={onClose}
      actions={
        <a
          href="#/requests/all"
          onClick={onClose}
          className="rounded-md border border-line px-2.5 py-1.5 text-[11.5px] font-medium text-ink-soft hover:bg-raised"
        >
          Open Requests
        </a>
      }
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <StatTile label="Raised" value={p.total} />
        <StatTile label="Waiting for a decision" value={p.waiting} />
        <StatTile label="Being arranged" value={p.arranging} />
        <StatTile label="Handed over" value={p.delivered} />
        <StatTile
          label="Avg. days to deliver"
          value={p.avgDays !== null ? p.avgDays.toFixed(1) : '—'}
          hint="raised → delivered"
        />
      </div>
      {p.total > 0 && (
        <div className="mt-5">
          <StageBar stages={p.stages} total={p.total} tall />
        </div>
      )}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold text-ink">Requests raised per day</h3>
          <p className="mt-0.5 text-[11.5px] text-mute">
            Each bar is the requests raised that day; the inner bar is how many of them are approved so far.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Legend items={DAY_LEGEND} />
          <Segmented<'14' | '30'>
            label="Range"
            value={range}
            onChange={setRange}
            options={[
              { id: '14', label: '14 days' },
              { id: '30', label: '30 days' },
            ]}
          />
        </div>
      </div>
      <MiniColumns
        key={range}
        rows={p.perDay(Number(range))}
        height={190}
        label={`Requests raised per day over the last ${range} days, and how many of them have been approved`}
        unit="raised"
        unit2="approved"
        highlight={today}
      />
      <h3 className="mt-6 text-xs font-semibold text-ink">By stage</h3>
      <div className="mt-2 overflow-hidden rounded-lg border border-line">
        <table className="w-full text-left text-xs">
          <thead className="bg-raised text-[10.5px] uppercase tracking-wide text-mute">
            <tr>
              <th className="px-3 py-2 font-semibold">Stage</th>
              <th className="px-3 py-2 text-right font-semibold">Requests</th>
              <th className="px-3 py-2 text-right font-semibold">Share</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {p.stages.map(s => (
              <tr key={s.key}>
                <td className="px-3 py-2 text-ink-soft">
                  <span className="inline-flex items-center gap-2">
                    <i className={`h-2.5 w-2.5 rounded-[3px] ${s.cls}`} />
                    {s.label}
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-ink">{s.n}</td>
                <td className="px-3 py-2 text-right tabular-nums text-mute">
                  {p.total ? `${Math.round((s.n / p.total) * 100)}%` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DashboardDialog>
  );
};
