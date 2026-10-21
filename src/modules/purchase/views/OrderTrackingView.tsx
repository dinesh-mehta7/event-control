import React, { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { cx, inputCls } from '../../accommodation/ui';
import { usePurchase } from '../PurchaseContext';
import { STATUS, poTotal } from '../types';
import { D, Empty, TRACKING_STAGES, TrackingStage, day, money, panel, when } from './shared';

const TRACKING_STAGE_HELP: Record<TrackingStage, string> = {
  place: 'Approved online purchase tickets that still need an order to be placed.',
  waiting: 'Orders are placed; marketplace confirmation or shipment details have not been recorded yet.',
  confirmed: 'Marketplace order ID is saved. Add the courier AWB once the seller dispatches the package.',
  automatic: 'Courier tracking is connected. New scans and delivery status sync here automatically.',
  delivered: 'The courier marked the package delivered or Procurement recorded the goods received.',
};

const OrderTrackingView: React.FC<{ open: (id: string) => void }> = ({ open }) => {
  const { orders, vendors, trackings, loading } = usePurchase();
  const [stage, setStage] = useState<TrackingStage>('place');
  const [q, setQ] = useState('');
  const onlineOrders = useMemo(
    () =>
      orders.filter(order => {
        const vendor = vendors.find(row => row.id === order.vendorId);
        return (
          (order.vendorMode || vendor?.vendorMode) === 'online' && !['cancelled', 'rejected'].includes(order.status)
        );
      }),
    [orders, vendors],
  );
  const rows = useMemo(
    () =>
      onlineOrders.map(order => {
        const trackingRows = trackings
          .filter(row => row.poId === order.id)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        const isDelivered =
          order.status === 'received' ||
          trackingRows.some(row => /deliver/i.test(row.status) || /deliver/i.test(row.subStatus));
        const hasAutomatic = trackingRows.some(row => !!row.trackingNumber);
        const hasMarketplaceConfirmation = trackingRows.some(row => !!row.marketplaceOrderNumber);
        const orderPlaced = ['ordered', 'partial', 'received'].includes(order.status);
        const currentStage: TrackingStage = isDelivered
          ? 'delivered'
          : hasAutomatic
            ? 'automatic'
            : hasMarketplaceConfirmation
              ? 'confirmed'
              : orderPlaced
                ? 'waiting'
                : 'place';
        const vendor = vendors.find(row => row.id === order.vendorId);
        const ticketNumbers = Array.from(new Set(order.items.map(item => item.requestNumber).filter(Boolean)));
        const latestTracking = trackingRows[0];
        const searchText = [
          order.number,
          order.title,
          vendor?.name || '',
          ...ticketNumbers,
          ...order.items.map(item => item.name),
          ...trackingRows.flatMap(row => [row.marketplaceOrderNumber, row.trackingNumber]),
        ]
          .join(' ')
          .toLowerCase();
        return {
          order,
          trackingRows,
          currentStage,
          vendorName: vendor?.name || 'Online marketplace',
          ticketNumbers,
          latestTracking,
          searchText,
        };
      }),
    [onlineOrders, trackings, vendors],
  );
  const visible = rows.filter(
    row => row.currentStage === stage && (!q.trim() || row.searchText.includes(q.trim().toLowerCase())),
  );
  const counts = TRACKING_STAGES.reduce(
    (result, item) => {
      result[item.id] = rows.filter(row => row.currentStage === item.id).length;
      return result;
    },
    {} as Record<TrackingStage, number>,
  );
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-ink">Order tracking</h2>
        <p className="mt-1 text-xs text-mute">
          Follow each online purchase ticket from order placement through courier delivery. Marketplace order IDs stay
          as references; AWB updates appear automatically after dispatch.
        </p>
      </div>
      <nav className="flex gap-1 overflow-x-auto border-b border-line" aria-label="Order tracking stages">
        {TRACKING_STAGES.map(item => (
          <button
            key={item.id}
            type="button"
            onClick={() => setStage(item.id)}
            aria-current={stage === item.id ? 'page' : undefined}
            className={cx(
              'relative shrink-0 px-3 py-2.5 text-xs font-semibold transition-colors',
              stage === item.id ? 'text-blue-300' : 'text-mute hover:text-ink',
            )}
          >
            {item.label}
            <span
              className={cx(
                'ml-2 rounded-full px-1.5 py-0.5 text-[10.5px] tabular-nums',
                stage === item.id ? 'bg-blue-500/15 text-blue-200' : 'bg-raised text-faint',
              )}
            >
              {counts[item.id]}
            </span>
            {stage === item.id && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-blue-500" />}
          </button>
        ))}
      </nav>
      <p className="text-xs text-mute">{TRACKING_STAGE_HELP[stage]}</p>
      <label className="relative block w-full sm:max-w-sm">
        <Search className="absolute left-3 top-3 h-4 w-4 text-faint" />
        <input
          value={q}
          onChange={event => setQ(event.target.value)}
          placeholder="Search ticket, PO, vendor or item…"
          aria-label="Search order tracking"
          className={cx(inputCls(D), 'pl-9')}
        />
      </label>
      <section className={cx(panel, 'overflow-hidden')}>
        {visible.length === 0 ? (
          <Empty>
            {loading
              ? 'Loading orders…'
              : onlineOrders.length === 0
                ? 'No online purchase orders yet.'
                : 'No orders in this stage.'}
          </Empty>
        ) : (
          <ul className="divide-y divide-line/70">
            {visible.map(({ order, trackingRows, vendorName, ticketNumbers, latestTracking }) => {
              const latestEvent =
                latestTracking &&
                [...latestTracking.checkpoints].sort((a, b) =>
                  String(b.checkpoint_time || '').localeCompare(String(a.checkpoint_time || '')),
                )[0];
              const title =
                stage === 'place'
                  ? STATUS[order.status]?.label || 'Ready to place'
                  : stage === 'waiting'
                    ? 'Waiting for shipment details'
                    : stage === 'confirmed'
                      ? 'Order ID saved · awaiting dispatch'
                      : stage === 'delivered'
                        ? order.status === 'received'
                          ? 'Goods received'
                          : 'Delivered by carrier'
                        : latestTracking?.subStatus || latestTracking?.status || 'Courier tracking active';
              return (
                <li key={order.id}>
                  <button
                    type="button"
                    onClick={() => open(order.id)}
                    className="w-full px-4 py-3.5 text-left transition-colors hover:bg-raised/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs font-bold text-blue-300">{order.number}</span>
                          <span className="font-semibold text-sm text-ink">{order.title}</span>
                          <span
                            className={cx(
                              'rounded-full px-2 py-0.5 text-[10.5px] font-semibold',
                              stage === 'delivered'
                                ? 'bg-emerald-500/10 text-emerald-300'
                                : stage === 'automatic'
                                  ? 'bg-blue-500/10 text-blue-300'
                                  : stage === 'place'
                                    ? 'bg-amber-500/10 text-amber-300'
                                    : 'bg-slate-500/10 text-slate-300',
                            )}
                          >
                            {title}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-mute">
                          {vendorName} ·{' '}
                          {ticketNumbers.length ? 'For ' + ticketNumbers.join(', ') : order.items.length + ' line(s)'} ·{' '}
                          {order.items.map(item => item.name + ' × ' + item.qtyOrdered + ' ' + item.unit).join(', ')}
                        </div>
                        {trackingRows.map(row => (
                          <div key={row.id} className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-ink-soft">
                            {row.marketplaceOrderNumber && <span>Order ID {row.marketplaceOrderNumber}</span>}
                            {row.trackingNumber && (
                              <span>
                                {row.courierSlug || 'Courier'} · AWB {row.trackingNumber}
                              </span>
                            )}
                            {row.estimatedDelivery && <span>Expected {day(row.estimatedDelivery)}</span>}
                            {row.trackingUrl && (
                              <a
                                href={row.trackingUrl}
                                target="_blank"
                                rel="noreferrer"
                                onClick={event => event.stopPropagation()}
                                className="text-blue-300 hover:underline"
                              >
                                Track shipment
                              </a>
                            )}
                          </div>
                        ))}
                        {latestEvent && (latestEvent.message || latestEvent.tag) && (
                          <div className="mt-1 text-[11.5px] text-mute">
                            Latest update: {latestEvent.message || latestEvent.tag}
                            {latestEvent.location ? ' · ' + latestEvent.location : ''}
                            {latestEvent.checkpoint_time ? ' · ' + when(latestEvent.checkpoint_time) : ''}
                          </div>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-[10.5px] text-faint">Expected</div>
                        <div className="text-xs text-ink-soft">{day(order.expectedDate)}</div>
                        <div className="mt-1 text-sm font-bold tabular-nums text-ink">{money(poTotal(order))}</div>
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
};
