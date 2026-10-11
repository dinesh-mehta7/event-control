import React from 'react';
import { Check } from 'lucide-react';
import { Pill } from '../../components/ui';
import { STATUS_LABEL, STATUS_TONE, STEPS, fmtDateTime, lineStatus, stepOf } from './types';
import type { OrderInfo, Req, ReqStatus } from './types';

export const StatusBadge: React.FC<{ status: ReqStatus; closed?: boolean }> = ({ status, closed }) => <Pill c={STATUS_TONE[status]}>{status === 'fulfilled' && closed ? 'Closed' : STATUS_LABEL[status]}</Pill>;
export const UrgentBadge: React.FC = () => <Pill c="bg-red-500/15 text-red-300">Urgent</Pill>;

// The IT Department Head's review includes the arrangement, so there is no separate Arranged step.
export const Stepper: React.FC<{ r: Pick<Req, 'status' | 'items' | 'parts'> & Partial<Req> }> = ({ r }) => {
  const dead = r.status === 'rejected' || r.status === 'cancelled';
  const hasEscalation = r.status === 'pending_owner' || !!r.events?.some(e => e.kind === 'escalated');
  const steps = hasEscalation ? STEPS : STEPS.filter((_, i) => i !== 2);
  const rawAt = dead ? 0 : stepOf(r as Req);
  const at = !hasEscalation && rawAt >= 2 ? rawAt - 1 : rawAt;
  return (
    <ol className="grid w-full items-start" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }} aria-label="Request progress">
      {steps.map((s, i) => {
        const done = !dead && i < at; const cur = !dead && i === at;
        return (
          <li key={s} className="min-w-0 text-center">
            <div className="relative flex h-7 items-center justify-center">
              {i < steps.length - 1 && <span aria-hidden="true" className={`absolute left-1/2 right-[-50%] top-1/2 h-[2px] -translate-y-1/2 rounded-full transition-colors duration-500 ease-out ${done ? 'bg-gradient-to-r from-blue-500 to-sky-400' : 'bg-line-strong'}`} />}
              <span className={`relative z-10 grid h-6 w-6 place-items-center rounded-full border text-[11px] font-semibold transition-[background-color,border-color,color,box-shadow,transform] duration-300 ease-out ${done ? 'scale-100 border-blue-500 bg-blue-600 text-white shadow-[0_0_12px_rgba(37,99,235,0.28)]' : cur ? 'scale-105 border-blue-400 bg-blue-500/15 text-blue-300 ring-4 ring-blue-500/10' : 'border-line-strong bg-surface text-faint'}`}>
                {done ? <Check size={13} strokeWidth={2.5} /> : i + 1}
              </span>
            </div>
            <span className={`mt-1.5 block px-1 text-[11px] leading-tight transition-colors duration-300 ${done ? 'font-medium text-blue-300' : cur ? 'font-semibold text-ink' : 'text-faint'}`}>{s}</span>
          </li>
        );
      })}
    </ol>
  );
};

const TONE = { ok: 'bg-emerald-500/15 text-emerald-300', warn: 'bg-amber-500/15 text-amber-300', mute: 'bg-raised text-ink-soft', bad: 'bg-red-500/15 text-red-300' } as const;

// Keep one fact in each cell so the request summary stays easy to scan.
// Vendor and rate appear only when the database let this person see them (the Super Admin decides per ticket).
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
                <td className="px-3 py-2.5 text-left tabular-nums text-ink-soft whitespace-nowrap">{i.requested} {i.unit}</td>
                <td className="px-3 py-2.5 whitespace-nowrap text-ink-soft">{i.returnRequired ? 'Return after use' : 'Purchase / keep'}</td>
                <td className="px-3 py-2.5 text-left whitespace-nowrap tabular-nums text-ink-soft">{decided && i.approved !== null ? `₹${(i.budgetAmount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—'}</td>
                <td className="px-3 py-2.5">
                  <span className="whitespace-nowrap"><Pill c={TONE[st.tone]}>{st.text}</Pill></span>
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
          <div className="text-xs text-faint">{e.by ? `${e.by} · ` : ''}{fmtDateTime(e.at)}</div>
        </div>
      </li>
    ))}
    {!events.length && <li className="text-sm text-mute">No activity yet.</li>}
  </ol>
);
