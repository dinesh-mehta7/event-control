import React, { useMemo } from 'react';
import { PackageCheck } from 'lucide-react';
import { cx } from '../../accommodation/ui';
import { useRequests } from '../../requests/RequestsContext';
import { purchaseAtStore } from '../../requests/types';
import { usePurchase } from '../PurchaseContext';
import { localDate } from '../../../lib/format';
import { Empty, Section, day, good } from './shared';

const SOURCE: Record<string, [string, string]> = {
  purchase: ['Bought', 'bg-sky-500/15 text-sky-300'],
  inventory: ['From stock', 'bg-emerald-500/15 text-emerald-300'],
  walkie: ['Radio pool', 'bg-violet-500/15 text-violet-300'],
};

// The hand-over queue: everything approved that is ready to give to the requester now — bought goods
// that have arrived (even partly), stock parts and radio-pool parts. "Hand over" opens the request.
export const AtStoreView: React.FC = () => {
  const { requests, orders, loading } = useRequests();
  const { inMyDepartment } = usePurchase();
  const today = localDate();
  const rows = useMemo(
    () =>
      requests
        .filter(r => r.status === 'approved' && inMyDepartment(r.departmentId))
        .flatMap(r =>
          r.parts
            .filter(p => p.status === 'planned')
            .map(p => ({
              r,
              p,
              item: r.items.find(i => i.id === p.itemId),
              ready: p.source === 'purchase' ? purchaseAtStore(r, p, orders) : p.qty,
            }))
            .filter(x => x.ready > 0 && x.item),
        )
        .sort((a, b) => (a.r.neededBy || '9999').localeCompare(b.r.neededBy || '9999')),
    [requests, orders, inMyDepartment],
  );
  return (
    <Section title={`Ready to hand over (${rows.length})`}>
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-xs">
            <thead className="bg-raised/40 text-left text-[10.5px] uppercase tracking-wide text-mute">
              <tr>
                {['Request', 'Item', 'Ready', 'From', 'Deliver to', 'Requested by', 'Needed by', ''].map((h, i) => (
                  <th key={i} className="px-3 py-2.5 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70">
              {rows.map(({ r, p, item, ready }) => {
                const late = !!r.neededBy && r.neededBy < today;
                const [label, tone] = SOURCE[p.source] || [p.source, 'bg-raised text-mute'];
                return (
                  <tr key={p.id} className="hover:bg-raised/30">
                    <td className="px-3 py-2.5">
                      <span className="font-mono font-bold text-blue-300">{r.number}</span>
                      <span className="block max-w-[14rem] truncate text-mute">{r.title}</span>
                    </td>
                    <td className="px-3 py-2.5 font-medium text-ink">{item!.name}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">
                      <b className="text-ink">{ready}</b>
                      {ready < p.qty && <span className="text-mute"> of {p.qty}</span>} {item!.unit}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={cx('rounded px-1.5 py-0.5 text-[10px] font-semibold', tone)}>{label}</span>
                    </td>
                    <td className="px-3 py-2.5">{r.deliverTo || '—'}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{r.requesterName}</td>
                    <td className={cx('px-3 py-2.5 whitespace-nowrap', late && 'font-semibold text-rose-300')}>
                      {r.neededBy ? day(r.neededBy) : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <button
                        type="button"
                        className={good}
                        onClick={() => {
                          location.hash = '#/requests/' + r.id;
                        }}
                      >
                        <PackageCheck className="h-3.5 w-3.5" />
                        Hand over
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>{loading ? 'Loading…' : 'Nothing is waiting to be handed over.'}</Empty>
      )}
    </Section>
  );
};
