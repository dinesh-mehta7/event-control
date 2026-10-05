import React from 'react';
import { Check } from 'lucide-react';
import { Pill } from '../../components/ui';
import { STATUS_LABEL, STATUS_TONE, STEPS, fmtDateTime, lineStatus, stepOf } from './types';
import type { OrderInfo, Req, ReqStatus } from './types';

export const StatusBadge: React.FC<{ status: ReqStatus; closed?: boolean }> = ({ status, closed }) => <Pill c={STATUS_TONE[status]}>{status === 'fulfilled' && closed ? 'Closed' : STATUS_LABEL[status]}</Pill>;
export const UrgentBadge: React.FC = () => <Pill c="bg-red-500/15 text-red-300">Urgent</Pill>;

// Requested → Department head → Owner → Arranged → Delivered → Received
export const Stepper: React.FC<{ r: Pick<Req, 'status' | 'items' | 'parts'> & Partial<Req> }> = ({ r }) => {
  const dead = r.status === 'rejected' || r.status === 'cancelled';
  const hasBranchStep = r.status === 'pending_sub' || !!r.events?.some(e => e.kind === 'sub_approved' || (e.kind === 'rejected' && e.text.toLowerCase().includes('branch head')));
  const steps = hasBranchStep ? STEPS : STEPS.filter((_, i) => i !== 1);
  const rawAt = dead ? 0 : stepOf(r as Req);
  const at = hasBranchStep || rawAt <= 1 ? rawAt : rawAt - 1;
  return (
    <ol className="flex items-center w-full" aria-label="Progress">
      {steps.map((s, i) => {
        const done = !dead && i < at; const cur = !dead && i === at;
        return (
          <li key={s} className="flex-1 flex items-center last:flex-none">
            <div className="flex flex-col items-center gap-1 min-w-[56px]">
              <span className={`grid place-items-center w-6 h-6 rounded-full text-xs font-semibold border ${done ? 'bg-blue-600 border-blue-600 text-white' : cur ? 'border-blue-500 text-blue-400 bg-blue-500/10' : 'border-line-strong text-faint'}`}>
                {done ? <Check size={13} /> : i + 1}
              </span>
              <span className={`text-xs text-center leading-tight ${done || cur ? 'text-ink-soft' : 'text-faint'}`}>{s}</span>
            </div>
            {i < steps.length - 1 && <span className={`flex-1 h-px mx-1 mb-5 ${done ? 'bg-blue-600' : 'bg-line-strong'}`} />}
          </li>
        );
      })}
    </ol>
  );
};

const TONE = { ok: 'bg-emerald-500/15 text-emerald-300', warn: 'bg-amber-500/15 text-amber-300', mute: 'bg-raised text-ink-soft', bad: 'bg-red-500/15 text-red-300' } as const;
const rupee = (n: number) => '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });

// One row per line: what was asked and why, what was approved (and why less), and where it stands in plain words.
// Vendor and rate appear only when the database let this person see them (the owner decides that per ticket).
export const ItemsTable: React.FC<{ r: Req; orders: Record<string, OrderInfo> }> = ({ r, orders }) => {
  const decided = r.status === 'approved' || r.status === 'fulfilled';
  return (
    <div className="overflow-x-auto border border-line rounded-lg">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-canvas text-xs font-medium text-mute">
            <th className="px-3 py-2 text-left">Item</th>
            <th className="px-3 py-2 text-right whitespace-nowrap">Asked</th>
            <th className="px-3 py-2 text-right whitespace-nowrap">Approved</th>
            <th className="px-3 py-2 text-left">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {r.items.map(i => {
            const cut = decided && i.approved !== null && i.approved < i.requested;
            const st = lineStatus(r, i, orders);
            const buys = r.parts.filter(p => p.itemId === i.id && p.source === 'purchase' && p.purchaseItemId).map(p => orders[p.purchaseItemId as string]).filter(Boolean);
            return (
              <tr key={i.id} className="align-top">
                <td className="px-3 py-2.5">
                  <div className="text-ink font-medium">{i.name}{i.kind === 'radio' && <span className="ml-2 text-xs text-blue-400">Walkie-talkie</span>}</div>
                  {i.reason && <div className="text-xs text-ink-soft">Why: {i.reason}</div>}
                  {i.note && <div className="text-xs text-mute">{i.note}</div>}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-ink-soft whitespace-nowrap">{i.requested} {i.unit}</td>
                <td className={`px-3 py-2.5 text-right tabular-nums ${!decided ? 'text-faint' : cut ? 'text-amber-300 font-medium' : 'text-ink'}`}>
                  <div className="whitespace-nowrap">{decided && i.approved !== null ? `${i.approved} ${i.unit}` : '—'}</div>
                  {cut && i.cutReason && <div className="text-xs font-normal text-amber-200/80 text-right max-w-[180px] ml-auto">{i.cutReason}</div>}
                </td>
                <td className="px-3 py-2.5">
                  <Pill c={TONE[st.tone]}>{st.text}</Pill>
                  {buys.map(o => (o.vendor !== null || o.rate !== null || o.poNumber) && (
                    <div key={o.purchaseItemId} className="text-xs text-mute mt-1">
                      {o.poNumber ? `${o.poNumber} · ` : ''}{o.vendor !== null ? `from ${o.vendor || 'vendor not chosen yet'}` : ''}{o.rate !== null && o.rate > 0 ? ` · ${rupee(o.rate)} each` : ''}
                      {` · ${o.received} of ${o.ordered} arrived`}
                    </div>))}
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
