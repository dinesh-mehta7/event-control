import React, { useState } from 'react';
import { Wallet } from 'lucide-react';
import { btnGhost, cx } from '../../accommodation/ui';
import { usePurchase } from '../PurchaseContext';
import { PAYABLE, PAYREQ, poDue, poTotal } from '../types';
import type { Payment, PaymentRequest } from '../types';
import { D, Empty, PaymentList, Section, TONE, good, money, panel, useLedger, when } from './shared';
import { PayNowModal } from './PaymentModals';

// One payment request, with the buttons that fit who is looking at it.
export const PayReqRow: React.FC<{ r: PaymentRequest; showOrder?: boolean; open?: (poId: string) => void }> = ({
  r,
  showOrder,
  open,
}) => {
  const { orders, canManage, canPay, withdrawPayment } = usePurchase();
  const [paying, setPaying] = useState(false);
  const o = orders.find(x => x.id === r.poId);
  return (
    <li className="px-4 py-3 flex flex-col md:flex-row md:items-center justify-between gap-2 md:gap-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <b className="tabular-nums">{money(r.amount)}</b>
          <span
            className={cx(
              'text-xs font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap',
              TONE[PAYREQ[r.status].tone],
            )}
          >
            {PAYREQ[r.status].label}
          </span>
          {showOrder && o && (
            <button onClick={() => open?.(o.id)} className="font-mono text-xs text-blue-400 font-bold hover:underline">
              {o.number}
            </button>
          )}
        </div>
        <div className="text-xs text-mute mt-0.5">
          Asked by {r.requestedBy} · {when(r.requestedAt)}
          {r.note ? ` · ${r.note}` : ''}
        </div>
        {r.decisionNote && <div className="text-xs text-mute">Note: {r.decisionNote}</div>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {['pending', 'approved'].includes(r.status) && canPay && (
          <button className={good} onClick={() => setPaying(true)}>
            <Wallet className="w-4 h-4" />
            Pay now
          </button>
        )}
        {['pending', 'approved'].includes(r.status) && canManage && (
          <button className={btnGhost(D)} onClick={() => withdrawPayment(r.id)}>
            Cancel
          </button>
        )}
      </div>
      {paying && <PayNowModal id={r.id} onClose={() => setPaying(false)} />}
    </li>
  );
};

// ---- payments ----------------------------------------------------------------------------------------------
export const PaymentsView: React.FC<{ open: (id: string) => void; onAsk: (id: string) => void }> = ({
  open,
  onAsk,
}) => {
  const { orders, payRequests, vendorName, canManage, canPay, stats, withdrawPayment } = usePurchase();
  const [payingId, setPayingId] = useState<string | null>(null);
  const ready = payRequests.filter(r => r.status === 'pending' || r.status === 'approved');
  const closed = payRequests.filter(r => ['paid', 'rejected', 'cancelled'].includes(r.status)).slice(0, 30);
  const asked = (poId: string) =>
    payRequests
      .filter(r => r.poId === poId && (r.status === 'pending' || r.status === 'approved'))
      .reduce((a, r) => a + r.amount, 0);
  const due = orders.filter(o => PAYABLE.includes(o.status) && poDue(o) - asked(o.id) > 0.009);
  const rows = useLedger<Payment>('payments', 300);
  const requestTable = (list: PaymentRequest[], actions: boolean) =>
    list.length ? (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-xs">
          <thead className="bg-raised/40 text-left text-[10.5px] uppercase tracking-wide text-mute">
            <tr>
              {['Amount', 'PO ticket', 'Status', 'Requested by', 'Requested at', 'Note', ...(actions ? [''] : [])].map(
                (heading, index) => (
                  <th key={index} className="px-3 py-2.5 font-semibold">
                    {heading}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-line/70">
            {list.map(request => {
              const order = orders.find(row => row.id === request.poId);
              return (
                <tr key={request.id} className="hover:bg-raised/30">
                  <td className="px-3 py-2.5 whitespace-nowrap font-bold tabular-nums">{money(request.amount)}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    {order ? (
                      <button
                        type="button"
                        onClick={() => open(order.id)}
                        className="font-mono font-bold text-blue-300 hover:underline"
                      >
                        {order.number}
                      </button>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{PAYREQ[request.status].label}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{request.requestedBy || '—'}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{when(request.requestedAt)}</td>
                  <td className="px-3 py-2.5">{request.note || '—'}</td>
                  {actions && (
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      <div className="flex justify-end gap-1">
                        {canPay && (
                          <button type="button" className={good} onClick={() => setPayingId(request.id)}>
                            Pay now
                          </button>
                        )}
                        {canManage && (
                          <button type="button" className={btnGhost(D)} onClick={() => withdrawPayment(request.id)}>
                            Cancel
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    ) : (
      <Empty>{actions ? 'No payment requests are ready.' : 'No earlier payment requests.'}</Empty>
    );
  return (
    <div className="space-y-5">
      <div className={cx(panel, 'overflow-x-auto')}>
        <table className="w-full min-w-[600px] text-xs">
          <thead className="bg-raised/40 text-left text-[10.5px] uppercase tracking-wide text-mute">
            <tr>
              <th className="px-3 py-2 font-semibold">Still to pay</th>
              <th className="px-3 py-2 font-semibold">Ready to pay</th>
              <th className="px-3 py-2 font-semibold">Orders with money due</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="px-3 py-2.5 text-base font-bold tabular-nums text-amber-300">{money(stats.due)}</td>
              <td className="px-3 py-2.5 text-base font-bold tabular-nums text-blue-300">{ready.length}</td>
              <td className="px-3 py-2.5 text-base font-bold tabular-nums text-rose-300">
                {orders.filter(o => PAYABLE.includes(o.status) && poDue(o) > 0).length}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <Section title={`Ready to pay (${ready.length})`}>{requestTable(ready, true)}</Section>
      <Section title={`Orders where a payment can be asked for (${due.length})`}>
        {due.length === 0 ? (
          <Empty>Nothing more to ask for.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-xs">
              <thead className="bg-raised/40 text-left text-[10.5px] uppercase tracking-wide text-mute">
                <tr>
                  {['PO ticket', 'Vendor', 'Total', 'Paid', 'Due', ''].map((heading, index) => (
                    <th key={index} className="px-3 py-2.5 font-semibold">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line/70">
                {due.map(order => (
                  <tr key={order.id} className="hover:bg-raised/30">
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => open(order.id)}
                        className="font-mono font-bold text-blue-300 hover:underline"
                      >
                        {order.number}
                      </button>
                      <span className="ml-2 text-ink-soft">{order.title}</span>
                    </td>
                    <td className="px-3 py-2.5">{vendorName(order.vendorId)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">{money(poTotal(order))}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap tabular-nums text-emerald-300">{money(order.paid)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap tabular-nums text-amber-300">{money(poDue(order))}</td>
                    <td className="px-3 py-2.5 text-right">
                      {canManage && (
                        <button className={btnGhost(D)} onClick={() => onAsk(order.id)}>
                          Ask for a payment
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
      {closed.length > 0 && <Section title="Earlier payment requests">{requestTable(closed, false)}</Section>}
      <Section title="Payments made">
        <PaymentList rows={rows} empty="No payments recorded yet." />
      </Section>
      {payingId && <PayNowModal id={payingId} onClose={() => setPayingId(null)} />}
    </div>
  );
};
