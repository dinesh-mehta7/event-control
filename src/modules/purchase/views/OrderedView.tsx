import React, { useState } from 'react';
import { btnGhost, cx } from '../../accommodation/ui';
import { usePurchase } from '../PurchaseContext';
import { OFFLINE_STEPS, poTotal } from '../types';
import type { OfflineStatus, PO } from '../types';
import { localDate } from '../../../lib/format';
import type { VendorMode } from '../types';
import { D, Empty, Section, StatusChip, day, money, when } from './shared';
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

// Orders that have been placed: online ones still need their marketplace/order reference details,
// offline ones get their progress updated here (same control as the Waiting tab).
export const OrderedView: React.FC<{ open: (id: string) => void }> = ({ open }) => {
  const { orders, vendors, trackings, loading, canManage, canReceive } = usePurchase();
  const [kind, setKind] = useState<'all' | VendorMode>('all');
  const rows = orders
    .filter(
      order =>
        ['ordered', 'partial'].includes(order.status) &&
        (kind === 'all' ||
          (vendors.find(vendor => vendor.id === order.vendorId)?.vendorMode || order.vendorMode) === kind),
    )
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return (
    <div className="space-y-3">
      <div className="flex gap-2" role="group" aria-label="Filter ordered tickets by vendor type">
        {(['all', 'online', 'offline'] as const).map(value => (
          <button
            key={value}
            type="button"
            aria-pressed={kind === value}
            onClick={() => setKind(value)}
            className={cx(
              'rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
              kind === value ? 'border-blue-500 bg-blue-600 text-white' : 'border-line text-mute hover:bg-raised',
            )}
          >
            {value === 'all' ? 'All' : value === 'online' ? 'Online' : 'Offline'}
          </button>
        ))}
      </div>
      <Section title={`Ordered tickets (${rows.length})`}>
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1150px] text-xs">
              <thead className="bg-raised/40 text-left text-[10.5px] uppercase tracking-wide text-mute">
                <tr>
                  {[
                    'PO ticket',
                    'Request',
                    'Vendor',
                    'Type',
                    'Items',
                    'Expected',
                    'Total',
                    'Status',
                    'Order ID',
                    'Shipment ID',
                    '',
                  ].map((heading, index) => (
                    <th key={index} className="px-3 py-2.5 font-semibold">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line/70">
                {rows.map(order => {
                  const mode = vendors.find(vendor => vendor.id === order.vendorId)?.vendorMode || order.vendorMode;
                  const trackingRows = trackings.filter(tracking => tracking.poId === order.id);
                  const requestNos = Array.from(new Set(order.items.map(item => item.requestNumber).filter(Boolean)));
                  return (
                    <tr key={order.id} className="hover:bg-raised/30">
                      <td className="px-3 py-2.5 whitespace-nowrap font-mono font-bold text-blue-300">
                        {order.number}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{requestNos.join(', ') || '—'}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {vendors.find(vendor => vendor.id === order.vendorId)?.name || '—'}
                      </td>
                      <td className="px-3 py-2.5">
                        {mode === 'online' ? 'Online' : mode === 'offline' ? 'Offline' : '—'}
                      </td>
                      <td className="px-3 py-2.5">
                        {order.items.map(item => `${item.name} × ${item.qtyOrdered}`).join(', ')}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {order.expectedDate ? day(order.expectedDate) : '—'}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">{money(poTotal(order))}</td>
                      <td className="px-3 py-2.5">
                        <StatusChip s={order.status} />
                      </td>
                      {mode === 'online' ? (
                        <>
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            {trackingRows
                              .map(row => row.marketplaceOrderNumber)
                              .filter(Boolean)
                              .join(', ') || '—'}
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            {trackingRows
                              .map(row => row.trackingNumber)
                              .filter(Boolean)
                              .join(', ') || '—'}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <button type="button" className={btnGhost(D)} onClick={() => open(order.id)}>
                              {trackingRows.some(row => row.marketplaceOrderNumber || row.trackingNumber)
                                ? 'Edit details'
                                : 'Add details'}
                            </button>
                          </td>
                        </>
                      ) : (
                        <>
                          {/* Local vendors have no marketplace order or courier shipment: track progress instead. */}
                          <td colSpan={2} className="px-3 py-2.5 whitespace-nowrap">
                            <OfflineProgress order={order} canUpdate={canManage || canReceive} />
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <button type="button" className={btnGhost(D)} onClick={() => open(order.id)}>
                              Open order
                            </button>
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>{loading ? 'Loading orders…' : 'No ordered tickets in this category.'}</Empty>
        )}
      </Section>
    </div>
  );
};

// Orders with details saved wait here until Procurement records receipt.
// Orders placed and waiting for their goods. Online orders show courier tracking; offline (local) vendors
// have none, so Purchase / the receiving team record the progress by hand. Click a row to open the order
// (and Receive the goods there).
export const WaitingView: React.FC<{ open: (id: string) => void }> = ({ open }) => {
  const { orders, vendors, trackings, loading, canManage, canReceive, setOfflineStatus } = usePurchase();
  const [busy, setBusy] = useState('');
  const today = localDate();
  const rows = orders
    .filter(order => ['ordered', 'partial'].includes(order.status))
    .sort((a, b) => (a.expectedDate || '9999').localeCompare(b.expectedDate || '9999'));
  const canUpdate = canManage || canReceive;
  const update = async (id: string, value: string) => {
    setBusy(id);
    await setOfflineStatus(id, (value || null) as OfflineStatus | null);
    setBusy('');
  };
  return (
    <Section title={`Waiting for receipt (${rows.length})`}>
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-xs">
            <thead className="bg-raised/40 text-left text-[10.5px] uppercase tracking-wide text-mute">
              <tr>
                {['Purchase order', 'Vendor', 'Expected', 'Order status', 'Shipment / progress'].map(heading => (
                  <th key={heading} className="px-3 py-2.5 font-semibold">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70">
              {rows.map(order => {
                const vendor = vendors.find(v => v.id === order.vendorId);
                const offline = (order.vendorMode || vendor?.vendorMode) !== 'online';
                const overdue = !!order.expectedDate && order.expectedDate < today;
                const latest = trackings
                  .filter(tracking => tracking.poId === order.id)
                  .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
                const step = OFFLINE_STEPS.find(x => x.id === order.offlineStatus);
                return (
                  <tr
                    key={order.id}
                    className="cursor-pointer hover:bg-raised/30"
                    onClick={() => open(order.id)}
                    title="Open the order (Receive the goods there)"
                  >
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span className="font-mono font-bold text-blue-300">{order.number}</span>
                      <span
                        className={cx(
                          'ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold',
                          offline ? 'bg-amber-500/15 text-amber-300' : 'bg-sky-500/15 text-sky-300',
                        )}
                      >
                        {offline ? 'Offline' : 'Online'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{vendor?.name || '—'}</td>
                    <td className={cx('px-3 py-2.5 whitespace-nowrap', overdue ? 'font-semibold text-rose-300' : '')}>
                      {order.expectedDate ? day(order.expectedDate) : '—'}
                      {overdue && (
                        <span className="ml-1.5 rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px]">Overdue</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusChip s={order.status} />
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap" onClick={e => offline && e.stopPropagation()}>
                      {!offline ? (
                        latest ? (
                          latest.subStatus || latest.status
                        ) : (
                          'Awaiting update'
                        )
                      ) : canUpdate ? (
                        <Select
                          aria-label={`Progress of ${order.number}`}
                          value={order.offlineStatus || ''}
                          disabled={busy === order.id}
                          onChange={e => void update(order.id, e.target.value)}
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
                      {offline && order.offlineStatusAt && (
                        <span className="block text-[10.5px] text-faint">
                          {order.offlineStatusBy ? `${order.offlineStatusBy} · ` : ''}
                          {when(order.offlineStatusAt)}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>{loading ? 'Loading orders…' : 'No orders are waiting for receipt.'}</Empty>
      )}
    </Section>
  );
};
