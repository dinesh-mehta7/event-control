import React, { useEffect, useMemo, useRef } from 'react';
import { ArrowRight } from 'lucide-react';
import { cx } from '../../accommodation/ui';
import { useRequests } from '../../requests/RequestsContext';
import { unlinkedPurchaseParts } from '../../requests/types';
import type { Req, ReqItem, ReqPart } from '../../requests/types';
import { DeptRoute } from '../../requests/parts';
import { usePurchase } from '../PurchaseContext';
import type { PO } from '../types';
import { Empty, StatusChip, day, money, panel, primary } from './shared';

type Line = { request: Req; part: ReqPart; item: ReqItem };

// ---- the buy list: everything approved that the store team said must be bought -------------------------
// One row per draft order (approval creates it), so Purchase sees what each order still needs before placing.
export const BuyListView: React.FC<{ editOrder: (id: string) => void }> = ({ editOrder }) => {
  const { requests } = useRequests();
  const { orders, createOrder, canManage, vendorName, inMyDepartment } = usePurchase();
  // Each department buys for the requests made to it (the Super Admin sees every department's).
  const myRequests = useMemo(() => requests.filter(r => inMyDepartment(r.departmentId)), [requests, inMyDepartment]);
  const lines = useMemo(
    () =>
      myRequests.flatMap(r =>
        unlinkedPurchaseParts(r)
          .map(p => ({ part: p, req: r, item: r.items.find(i => i.id === p.itemId) }))
          .filter(x => !!x.item),
      ) as { part: any; req: any; item: any }[],
    [myRequests],
  );
  // Approval creates the draft order in the database (migration_v111). This stays as a fallback for
  // lines approved before that, or if the automatic draft could not be created.
  const seenParts = useRef(new Set<string>());
  const createOrderRef = useRef(createOrder);
  createOrderRef.current = createOrder;
  useEffect(() => {
    if (!canManage || !lines.length) return;
    const byRequest = new Map<string, string[]>();
    lines.forEach(line => {
      if (!seenParts.current.has(line.part.id)) {
        const ids = byRequest.get(line.req.id) || [];
        ids.push(line.part.id);
        byRequest.set(line.req.id, ids);
      }
    });
    byRequest.forEach(ids => ids.forEach(id => seenParts.current.add(id)));
    const requestBatches: string[][] = [];
    byRequest.forEach(ids => requestBatches.push(ids));
    void (async () => {
      for (let index = 0; index < requestBatches.length; index++) await createOrderRef.current(requestBatches[index]);
    })();
  }, [lines, canManage]);

  // Group the approved purchase lines by their draft order; lines without one yet are "preparing".
  const groups = useMemo(() => {
    const byOrder = new Map<string, { order?: PO; lines: Line[] }>();
    myRequests
      .filter(r => r.status === 'approved')
      .forEach(request =>
        request.parts
          .filter(part => part.source === 'purchase' && part.status === 'planned')
          .forEach(part => {
            const item = request.items.find(row => row.id === part.itemId);
            if (!item) return;
            const order = part.purchaseItemId
              ? orders.find(o => o.items.some(line => line.id === part.purchaseItemId))
              : undefined;
            if (order && !['draft', 'pending', 'rejected'].includes(order.status)) return; // already placed
            const key = order ? order.id : `new:${request.id}`;
            const group = byOrder.get(key) || { order, lines: [] };
            group.lines.push({ request, part, item });
            byOrder.set(key, group);
          }),
      );
    return Array.from(byOrder.values()).sort((a, b) =>
      (minNeeded(a.lines) || '9999').localeCompare(minNeeded(b.lines) || '9999'),
    );
  }, [myRequests, orders]);

  return (
    <div className="space-y-3">
      <p className="text-xs text-mute">
        Approved purchases arrive here as draft orders, with the last vendor and rate of each item filled in. Check them
        and place the order.
      </p>
      <section className={cx(panel, 'overflow-x-auto')}>
        {groups.length ? (
          <table className="w-full min-w-[860px] text-xs">
            <thead className="bg-raised/40 text-left text-[10.5px] uppercase tracking-wide text-mute">
              <tr>
                {['Order', 'For', 'Items', 'Needed by', 'Budget', 'Vendor & rates', ''].map((heading, index) => (
                  <th key={index} className="px-3 py-2.5 font-semibold">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70">
              {groups.map(({ order, lines: rows }) => {
                const requestsOf = Array.from(new Map(rows.map(x => [x.request.id, x.request])).values());
                const budget = rows.reduce((sum, x) => sum + (x.item.budgetAmount || 0), 0);
                const hasBudget = rows.some(x => x.item.budgetAmount != null);
                const missingRates = order ? order.items.filter(i => i.rate <= 0).length : rows.length;
                const suggested = !!order && /suggested from/i.test(order.notes);
                const needed = minNeeded(rows);
                const ready = !!order?.vendorId && missingRates === 0;
                return (
                  <tr key={order?.id || rows[0].request.id} className="align-top hover:bg-raised/30">
                    <td className="px-3 py-3 whitespace-nowrap">
                      {order ? (
                        <>
                          <span className="font-mono font-bold text-blue-300">{order.number}</span>
                          {order.status !== 'draft' && (
                            <span className="ml-1.5">
                              <StatusChip s={order.status} />
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-mute">Preparing…</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {requestsOf.map(r => (
                        <div key={r.id} className="min-w-0">
                          <span className="font-mono font-semibold text-ink-soft">{r.number}</span>
                          <span className="ml-1.5 text-ink">{r.title}</span>
                          <div className="text-[10.5px] text-mute">
                            {r.requesterName} · <DeptRoute r={r} />
                          </div>
                        </div>
                      ))}
                    </td>
                    <td className="px-3 py-3">
                      {rows.map(x => (
                        <div key={x.part.id} className="whitespace-nowrap">
                          <span className="font-medium text-ink">{x.item.name}</span>
                          <span className="text-mute">
                            {' '}
                            · {x.part.qty} {x.item.unit}
                          </span>
                        </div>
                      ))}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">{needed ? day(needed) : '—'}</td>
                    <td className="px-3 py-3 whitespace-nowrap tabular-nums">{hasBudget ? money(budget) : '—'}</td>
                    <td className="px-3 py-3">
                      {order?.vendorId ? (
                        <span className="text-ink">{vendorName(order.vendorId)}</span>
                      ) : (
                        <span className="text-amber-300">Choose vendor</span>
                      )}
                      <div
                        className={cx(
                          'text-[10.5px]',
                          missingRates ? 'text-amber-300' : suggested ? 'text-sky-300' : 'text-mute',
                        )}
                      >
                        {missingRates
                          ? `${missingRates} rate${missingRates === 1 ? '' : 's'} missing`
                          : suggested
                            ? 'Suggested from last order'
                            : 'Rates set'}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right">
                      {order && (
                        <button
                          type="button"
                          className={cx(primary, '!px-3 !py-1.5 text-xs')}
                          onClick={() => editOrder(order.id)}
                        >
                          {ready ? 'Review & place' : 'Complete'}
                          <ArrowRight className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <Empty>Nothing to order. Approved purchases appear here as draft orders.</Empty>
        )}
      </section>
    </div>
  );
};

const minNeeded = (rows: Line[]) =>
  rows
    .map(x => x.request.neededBy)
    .filter(Boolean)
    .sort()[0] || '';
