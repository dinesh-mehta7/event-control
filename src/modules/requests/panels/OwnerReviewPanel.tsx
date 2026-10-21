import React, { useState } from 'react';
import { Check, X, ArrowUpRight } from 'lucide-react';
import { Card, btnDanger, btnGhost, btnPrimary } from '../../../components/ui';
import { useRequests } from '../RequestsContext';
import { SOURCE_LABEL } from '../types';
import type { Req } from '../types';
import { Err } from './shared';

// ── Super Admin: approve, send back, or reject the saved IT Head plan ───────────────────────────
export const OwnerReviewPanel: React.FC<{ r: Req }> = ({ r }) => {
  const { ownerReview } = useRequests();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const budget = r.items.reduce((sum, item) => sum + (item.budgetAmount || 0), 0) + r.miscBudget;
  const go = async (action: 'approve' | 'send_back' | 'reject') => {
    setBusy(true);
    setErr('');
    const e = await ownerReview(r.id, action);
    setBusy(false);
    if (e) setErr(e);
  };
  return (
    <Card title="Super Admin review" tone="text-amber-300">
      <p className="text-sm text-mute mb-3">
        Review the Department Head’s saved arrangement. Approve it, send it back for changes, or reject it.
      </p>
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead className="bg-raised/50 text-mute">
            <tr>
              <th className="px-3 py-2">Item</th>
              <th className="px-3 py-2">Approved</th>
              <th className="px-3 py-2">Arrangement</th>
              <th className="px-3 py-2 text-right">Budget</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {r.items.map(i => (
              <tr key={i.id}>
                <td className="px-3 py-2.5 whitespace-nowrap text-ink">{i.name}</td>
                <td className="px-3 py-2.5 whitespace-nowrap text-ink">
                  {i.approved ?? 0} {i.unit}
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap text-ink-soft">
                  {i.reviewPlan.length
                    ? i.reviewPlan.map(p => `${SOURCE_LABEL[p.source]} ${p.qty}`).join(' · ')
                    : 'No allocation'}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-ink">
                  ₹
                  {(i.budgetAmount || 0).toLocaleString('en-IN', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </td>
              </tr>
            ))}
            {(r.miscItems || r.miscBudget > 0) && (
              <tr>
                <td className="px-3 py-2.5 text-ink" colSpan={3}>
                  <div>Miscellaneous items</div>
                  {r.miscItems && <div className="mt-0.5 whitespace-normal text-mute">{r.miscItems}</div>}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-ink">
                  ₹{r.miscBudget.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between rounded-lg bg-raised/60 px-3 py-2.5 text-sm">
        <span className="text-xs font-medium text-mute">Estimated approved budget</span>
        <strong className="tabular-nums text-ink">
          ₹{budget.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </strong>
      </div>
      <div className="mt-3">
        <Err msg={err} />
      </div>
      <div className="flex gap-2 justify-end mt-3">
        <button className={btnGhost} disabled={busy} onClick={() => go('send_back')}>
          <ArrowUpRight size={14} />
          Send back
        </button>
        <button className={btnDanger} disabled={busy} onClick={() => go('reject')}>
          <X size={14} />
          Reject
        </button>
        <button className={btnPrimary} disabled={busy} onClick={() => go('approve')}>
          <Check size={14} />
          Approve
        </button>
      </div>
    </Card>
  );
};
