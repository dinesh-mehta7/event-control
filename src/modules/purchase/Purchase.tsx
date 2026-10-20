import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, ClipboardList, Search, ShoppingCart, Truck, Wallet } from 'lucide-react';
import { cx } from '../accommodation/ui';
import { usePurchase } from './PurchaseContext';
import { PAYABLE, poDue, poTotal } from './types';
import type { POStatus } from './types';
import { money, panel } from './views/shared';
import { BuyListView } from './views/BuyListView';
import { OrderedView, WaitingView } from './views/OrderedView';
import { VendorsView } from './views/VendorsView';
import { ReceiveModal, ReceivingView } from './views/ReceivingView';
import { PaymentsView } from './views/PaymentsView';
import { OrderModal } from './views/OrderModal';
import { OrderEditModal } from './views/OrderEditModal';
import { AskPayModal } from './views/PaymentModals';

export type DeskView = 'buy' | 'tracking' | 'orders' | 'receiving' | 'vendors' | 'payments';

const Stat: React.FC<{ label: string; value: React.ReactNode; dot?: string; onClick?: () => void }> = ({
  label,
  value,
  dot,
  onClick,
}) => (
  <button onClick={onClick} className={cx(panel, 'px-4 py-3.5 text-left hover:bg-raised/40 transition-colors')}>
    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-mute">
      {dot && <span className={cx('w-2 h-2 rounded-full', dot)} />}
      {label}
    </div>
    <div className="text-2xl font-bold mt-1 tabular-nums">{value}</div>
  </button>
);

// ---- the procurement desk -----------------------------------------------------------------------------
export const PurchaseDesk: React.FC<{ view: DeskView }> = ({ view }) => {
  const { loadError, canManage, canReceive, canPay } = usePurchase();
  const [filter, setFilter] = useState<POStatus | 'all'>('all');
  const [viewing, setViewing] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [receiving, setReceiving] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  return (
    <div className="space-y-5">
      {!canManage && (
        <div className="p-3 bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded-xl text-xs">
          🔒{' '}
          {canPay
            ? 'Accounts access: review payment requests and record payments. Purchase manages orders.'
            : canReceive
              ? 'You can view orders and record goods received, but not change orders.'
              : 'You can view orders but not change them.'}
        </div>
      )}
      {loadError && (
        <div role="alert" className="rounded-xl border border-rose-500/40 bg-rose-500/10 text-rose-400 text-sm p-3">
          Could not load purchases: {loadError}
        </div>
      )}
      {view === 'buy' && <BuyListView editOrder={setViewing} />}
      {view === 'tracking' && <WaitingView />}
      {view === 'orders' && <OrderedView open={setViewing} />}
      {view === 'vendors' && <VendorsView />}
      {view === 'receiving' && <ReceivingView />}
      {view === 'payments' && <PaymentsView open={setViewing} onAsk={setAsking} />}

      {viewing && !editing && !receiving && !asking && (
        <OrderModal
          id={viewing}
          onClose={() => setViewing(null)}
          onEdit={setEditing}
          onReceive={setReceiving}
          onAsk={setAsking}
        />
      )}
      {editing && <OrderEditModal id={editing} onClose={() => setEditing(null)} />}
      {receiving && <ReceiveModal id={receiving} onClose={() => setReceiving(null)} />}
      {asking && <AskPayModal id={asking} onClose={() => setAsking(null)} />}
    </div>
  );
};

const PURCHASE_TABS: { id: DeskView; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'buy', label: 'To Order', icon: ShoppingCart },
  { id: 'orders', label: 'Ordered', icon: Check },
  { id: 'tracking', label: 'Waiting', icon: ClipboardList },
  { id: 'receiving', label: 'Received', icon: Truck },
  { id: 'payments', label: 'Payments', icon: Wallet },
  { id: 'vendors', label: 'Vendors', icon: Search },
];

// Standalone Procurement workspace for approved request lines.
export const PurchaseApp: React.FC<{ initialTab?: DeskView }> = ({ initialTab = 'orders' }) => {
  const { orders } = usePurchase();
  const navRef = useRef<HTMLElement>(null);
  const tabRefs = useRef<Partial<Record<DeskView, HTMLButtonElement | null>>>({});
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });
  const [indicatorReady, setIndicatorReady] = useState(false);
  const [tab, setTab] = useState<DeskView>(() => {
    const part = location.hash.split('/')[2] as DeskView;
    return PURCHASE_TABS.some(x => x.id === part) ? part : initialTab;
  });
  const payable = orders.filter(o => PAYABLE.includes(o.status));
  const totals = [
    ['Committed', payable.reduce((sum, o) => sum + poTotal(o), 0)],
    ['Paid', payable.reduce((sum, o) => sum + o.paid, 0)],
    ['Still due', payable.reduce((sum, o) => sum + poDue(o), 0)],
  ] as const;
  useEffect(() => {
    const sync = () => {
      const part = location.hash.split('/')[2] as DeskView;
      setTab(PURCHASE_TABS.some(x => x.id === part) ? part : initialTab);
    };
    addEventListener('hashchange', sync);
    return () => removeEventListener('hashchange', sync);
  }, [initialTab]);
  useLayoutEffect(() => {
    const active = tabRefs.current[tab];
    if (!active || !navRef.current) return;
    const update = () => setIndicator({ left: active.offsetLeft, width: active.offsetWidth });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(navRef.current);
    observer.observe(active);
    const frame = requestAnimationFrame(() => setIndicatorReady(true));
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [tab]);
  const go = (next: DeskView) => {
    setTab(next);
    location.hash = `#/purchase/${next}`;
  };
  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-ink">Procurement</h2>
          <p className="text-xs text-mute">Order, receive, and pay for approved department requests.</p>
        </div>
      </header>
      <section aria-label="Purchase totals" className={cx(panel, 'overflow-x-auto')}>
        <table className="w-full min-w-[520px] text-xs">
          <thead className="bg-raised/40 text-left text-[10.5px] uppercase tracking-wide text-mute">
            <tr>
              {totals.map(([label]) => (
                <th key={label} className="px-3 py-2 font-semibold">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {totals.map(([label, amount]) => (
                <td key={label} className="px-3 py-2.5 text-sm font-semibold tabular-nums text-ink">
                  {money(amount)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </section>
      <nav
        ref={navRef}
        className="relative flex gap-1 overflow-x-auto border-b border-line"
        aria-label="Purchase sections"
      >
        <span
          aria-hidden="true"
          className={cx(
            'pointer-events-none absolute bottom-0 left-0 h-0.5 rounded-full bg-blue-500',
            indicatorReady
              ? 'transition-[transform,width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]'
              : 'transition-none',
          )}
          style={{ width: indicator.width, transform: `translateX(${indicator.left}px)` }}
        />
        {PURCHASE_TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            ref={node => {
              tabRefs.current[id] = node;
            }}
            onClick={() => go(id)}
            aria-current={tab === id ? 'page' : undefined}
            className={cx(
              'inline-flex items-center gap-1.5 whitespace-nowrap px-2.5 py-2 text-xs font-medium transition-colors duration-200',
              tab === id ? 'text-blue-400' : 'text-mute hover:text-ink',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </nav>
      <PurchaseDesk view={tab} />
    </div>
  );
};
