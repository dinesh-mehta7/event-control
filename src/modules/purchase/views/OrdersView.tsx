import React, { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { cx, inputCls } from '../../accommodation/ui';
import { usePurchase } from '../PurchaseContext';
import { poTotal } from '../types';
import type { POStatus } from '../types';
import { D, Empty, PayChip, StatusChip, day, money, overdue, panel, vendorModeLabel } from './shared';

// ---- views -----------------------------------------------------------------
const FILTERS: { key: POStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'pending', label: 'Ready to place' },
  { key: 'approved', label: 'Approved' },
  { key: 'ordered', label: 'Ordered' },
  { key: 'partial', label: 'Partly received' },
  { key: 'received', label: 'Received' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'cancelled', label: 'Cancelled' },
];

const OrdersView: React.FC<{
  filter: POStatus | 'all';
  setFilter: (f: POStatus | 'all') => void;
  open: (id: string) => void;
}> = ({ filter, setFilter, open }) => {
  const { orders, vendorName, canManage, loading, showDepartments, departmentFilter, departmentName } = usePurchase();
  const showDept = showDepartments && departmentFilter === 'all';
  const [q, setQ] = useState('');
  const count = (k: POStatus | 'all') => (k === 'all' ? orders.length : orders.filter(o => o.status === k).length);
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return orders.filter(
      o =>
        (filter === 'all' || o.status === filter) &&
        (!t ||
          o.number.toLowerCase().includes(t) ||
          o.title.toLowerCase().includes(t) ||
          vendorName(o.vendorId).toLowerCase().includes(t) ||
          o.requestedBy.toLowerCase().includes(t)),
    );
  }, [orders, filter, q, vendorName]);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search className="absolute left-3 top-3 h-4 w-4 text-faint" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search PO no., title, vendor…"
            aria-label="Search orders"
            className={cx(inputCls(D), 'pl-9')}
          />
        </div>
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-1" role="group" aria-label="Filter by status">
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            aria-pressed={filter === f.key}
            className={cx(
              'px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap border transition-colors',
              filter === f.key
                ? 'bg-blue-600 border-blue-500 text-white'
                : 'border-line-strong text-mute hover:bg-raised',
            )}
          >
            {f.label} <span className="opacity-70 tabular-nums">{count(f.key)}</span>
          </button>
        ))}
      </div>
      <section className={cx(panel, 'overflow-hidden')}>
        {rows.length === 0 ? (
          <Empty>
            {loading
              ? 'Loading…'
              : orders.length === 0
                ? canManage
                  ? 'No orders yet. Build one from the Buy list.'
                  : 'No orders yet.'
                : 'No orders match.'}
          </Empty>
        ) : (
          <ul className="divide-y divide-line/70">
            {rows.map(o => (
              <li key={o.id}>
                <button
                  onClick={() => open(o.id)}
                  className="w-full text-left px-4 py-3.5 hover:bg-raised/40 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-2 md:gap-4"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-blue-400 font-bold">{o.number}</span>
                      {showDept && o.departmentId && (
                        <span className="block text-[10.5px] text-faint">{departmentName(o.departmentId)}</span>
                      )}
                      <span className="font-semibold text-sm">{o.title}</span>
                      <StatusChip s={o.status} />
                      {o.vendorMode && (
                        <span className="text-[10.5px] font-semibold text-mute">{vendorModeLabel(o.vendorMode)}</span>
                      )}
                      <PayChip po={o} />
                    </div>
                    <div className="text-xs text-mute mt-1">
                      {o.vendorId ? vendorName(o.vendorId) : 'No vendor yet'} · {o.items.length} line
                      {o.items.length === 1 ? '' : 's'}
                      {o.deliverTo ? ` · ${o.deliverTo}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-5 shrink-0 text-right">
                    <div className="text-xs">
                      <div className="text-faint">Expected</div>
                      <div className={overdue(o) ? 'text-rose-400 font-semibold' : 'text-ink-soft'}>
                        {day(o.expectedDate)}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs uppercase text-faint">Total</div>
                      <div className="font-bold tabular-nums">{money(poTotal(o))}</div>
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};
