import React, { useState } from 'react';
import { btnGhost, cx } from '../../accommodation/ui';
import { usePurchase } from '../PurchaseContext';
import { poTotal } from '../types';
import type { VendorMode } from '../types';
import { D, Empty, Section, StatusChip, day, money } from './shared';

// Orders that have been placed but still need their marketplace/order reference details.
export const OrderedView: React.FC<{ open: (id: string) => void }> = ({ open }) => {
  const { orders, vendors, trackings, loading } = usePurchase();
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
                        {mode === 'online' && (
                          <button type="button" className={btnGhost(D)} onClick={() => open(order.id)}>
                            {trackingRows.some(row => row.marketplaceOrderNumber || row.trackingNumber)
                              ? 'Edit details'
                              : 'Add details'}
                          </button>
                        )}
                      </td>
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
export const WaitingView: React.FC = () => {
  const { orders, vendors, trackings, loading } = usePurchase();
  const rows = orders
    .filter(order => ['ordered', 'partial'].includes(order.status))
    .sort((a, b) => (a.expectedDate || '9999').localeCompare(b.expectedDate || '9999'));
  return (
    <Section title={`Waiting for receipt (${rows.length})`}>
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[650px] text-xs">
            <thead className="bg-raised/40 text-left text-[10.5px] uppercase tracking-wide text-mute">
              <tr>
                {['Purchase order', 'Vendor', 'Order status', 'Shipment status'].map((heading, index) => (
                  <th key={index} className="px-3 py-2.5 font-semibold">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70">
              {rows.map(order => {
                const latest = trackings
                  .filter(tracking => tracking.poId === order.id)
                  .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
                return (
                  <tr key={order.id} className="hover:bg-raised/30">
                    <td className="px-3 py-2.5 whitespace-nowrap font-mono font-bold text-blue-300">{order.number}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {vendors.find(vendor => vendor.id === order.vendorId)?.name || '—'}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusChip s={order.status} />
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {latest ? latest.subStatus || latest.status : 'Awaiting update'}
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
