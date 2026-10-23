import React, { useState } from 'react';
import { Truck } from 'lucide-react';
import { btnGhost, cx } from '../../accommodation/ui';
import { usePurchase } from '../PurchaseContext';
import { OFFLINE_STEPS, poTotal } from '../types';
import type { OfflineStatus, PO } from '../types';
import { localDate } from '../../../lib/format';
import { D, Empty, Section, StatusChip, day, good, money, when } from './shared';
import { Select } from '../../../components/Select';

// Progress of an order from a local (offline) vendor, recorded by hand: offline vendors have no
// marketplace order ID or courier tracking. Read-only text for people who cannot update it.
const OfflineProgress: React.FC<{ order: PO; canUpdate: boolean }> = ({ order, canUpdate }) => {
  const { setOfflineStatus } = usePurchase();
  const [busy, setBusy] = useState(false);
  const step = OFFLINE_STEPS.find(x => x.id === order.offlineStatus);
  return (
    <>
      {canUpdate ? (
        <Select
          aria-label={`Progress of ${order.number}`}
          value={order.offlineStatus || ''}
          disabled={busy}
          onChange={async e => {
            setBusy(true);
            await setOfflineStatus(order.id, (e.target.value || null) as OfflineStatus | null);
            setBusy(false);
          }}
          className="h-7 rounded-md border border-line bg-field px-2 text-xs text-ink outline-none focus:border-blue-500 disabled:opacity-50"
        >
          <option value="">Ordered · not confirmed yet</option>
          {OFFLINE_STEPS.map(x => (
            <option key={x.id} value={x.id}>
              {x.label}
            </option>
          ))}
        </Select>
      ) : (
        step?.label || 'Ordered · not confirmed yet'
      )}
      {order.offlineStatusAt && (
        <span className="block text-[10.5px] text-faint">
          {order.offlineStatusBy ? `${order.offlineStatusBy} · ` : ''}
          {when(order.offlineStatusAt)}
        </span>
      )}
    </>
  );
};

type Filter = 'all' | 'online' | 'offline' | 'overdue' | 'details';
const FILTERS: [Filter, string][] = [
  ['all', 'All'],
  ['online', 'Online'],
  ['offline', 'Offline'],
  ['overdue', 'Overdue'],
  ['details', 'Needs order ID'],
];

// Placed orders until everything has arrived: one list for online and offline vendors.
// Online rows take the marketplace order ID / courier AWB; offline rows take the vendor's progress.
// "Arrived" records goods at the store (partly is fine); the order stays here until all of it is in.
export const OnTheWayView: React.FC<{ open: (id: string) => void; receive: (id: string) => void }> = ({
  open,
  receive,
}) => {
  const { orders, vendors, trackings, loading, canManage, canReceive } = usePurchase();
  const [filter, setFilter] = useState<Filter>('all');
  const today = localDate();
  const modeOf = (o: PO) => vendors.find(v => v.id === o.vendorId)?.vendorMode || o.vendorMode;
  const lines = (o: PO) => trackings.filter(t => t.poId === o.id);
  const needsDetails = (o: PO) =>
    modeOf(o) === 'online' && !lines(o).some(t => t.marketplaceOrderNumber || t.trackingNumber);
  const isOverdue = (o: PO) => !!o.expectedDate && o.expectedDate < today;
  const waiting = orders.filter(o => ['ordered', 'partial'].includes(o.status));
  const count = (f: Filter) =>
    waiting.filter(o =>
      f === 'all' ? true : f === 'overdue' ? isOverdue(o) : f === 'details' ? needsDetails(o) : modeOf(o) === f,
    ).length;
  const rows = waiting
    .filter(o =>
      filter === 'all'
        ? true
        : filter === 'overdue'
          ? isOverdue(o)
          : filter === 'details'
            ? needsDetails(o)
            : modeOf(o) === filter,
    )
    .sort((a, b) => (a.expectedDate || '9999').localeCompare(b.expectedDate || '9999'));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter orders on the way">
        {FILTERS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
            className={cx(
              'rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
              filter === value ? 'border-blue-500 bg-blue-600 text-white' : 'border-line text-mute hover:bg-raised',
            )}
          >
            {label}
            <span className="ml-1.5 opacity-70">{count(value)}</span>
          </button>
        ))}
      </div>
      <Section title={`On the way (${rows.length})`}>
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-xs">
              <thead className="bg-raised/40 text-left text-[10.5px] uppercase tracking-wide text-mute">
                <tr>
                  {['Order', 'Request', 'Vendor', 'Items', 'Expected', 'Total', 'Progress', ''].map(
                    (heading, index) => (
                      <th key={index} className="px-3 py-2.5 font-semibold">
                        {heading}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-line/70">
                {rows.map(order => {
                  const mode = modeOf(order);
                  const tracked = lines(order);
                  const latest = [...tracked].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
                  const requestNos = Array.from(new Set(order.items.map(item => item.requestNumber).filter(Boolean)));
                  const late = isOverdue(order);
                  return (
                    <tr key={order.id} className="hover:bg-raised/30">
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <button
                          type="button"
                          className="font-mono font-bold text-blue-300 hover:underline"
                          onClick={() => open(order.id)}
                        >
                          {order.number}
                        </button>
                        <span
                          className={cx(
                            'ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold',
                            mode === 'online' ? 'bg-sky-500/15 text-sky-300' : 'bg-amber-500/15 text-amber-300',
                          )}
                        >
                          {mode === 'online' ? 'Online' : 'Offline'}
                        </span>
                        {order.status === 'partial' && (
                          <span className="ml-1.5">
                            <StatusChip s={order.status} />
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{requestNos.join(', ') || '—'}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {vendors.find(vendor => vendor.id === order.vendorId)?.name || '—'}
                      </td>
                      <td className="px-3 py-2.5">
                        {order.items
                          .map(
                            item =>
                              `${item.name} × ${item.qtyOrdered}${item.qtyReceived ? ` (${item.qtyReceived} in)` : ''}`,
                          )
                          .join(', ')}
                      </td>
                      <td className={cx('px-3 py-2.5 whitespace-nowrap', late && 'font-semibold text-rose-300')}>
                        {order.expectedDate ? day(order.expectedDate) : '—'}
                        {late && (
                          <span className="ml-1.5 rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px]">Overdue</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">{money(poTotal(order))}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {mode === 'online' ? (
                          tracked.length ? (
                            <>
                              {latest ? latest.subStatus || latest.status : 'Awaiting update'}
                              <span className="block text-[10.5px] text-faint">
                                {tracked
                                  .map(t => t.marketplaceOrderNumber && `Order ${t.marketplaceOrderNumber}`)
                                  .filter(Boolean)
                                  .join(', ') || 'No order ID'}
                              </span>
                            </>
                          ) : (
                            <span className="text-amber-300">Order ID not added</span>
                          )
                        ) : (
                          <OfflineProgress order={order} canUpdate={canManage || canReceive} />
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap">
                        <div className="flex justify-end gap-1.5">
                          {mode === 'online' && canManage && (
                            <button type="button" className={btnGhost(D)} onClick={() => open(order.id)}>
                              {needsDetails(order) ? 'Add order ID' : 'Tracking'}
                            </button>
                          )}
                          {canReceive && (
                            <button type="button" className={good} onClick={() => receive(order.id)}>
                              <Truck className="h-3.5 w-3.5" />
                              Arrived
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>{loading ? 'Loading orders…' : 'Nothing on the way in this view.'}</Empty>
        )}
      </Section>
    </div>
  );
};
