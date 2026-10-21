import React, { useEffect, useMemo, useRef } from 'react';
import { btnGhost, cx } from '../../accommodation/ui';
import { useRequests } from '../../requests/RequestsContext';
import { unlinkedPurchaseParts } from '../../requests/types';
import { usePurchase } from '../PurchaseContext';
import { D, Empty, StatusChip, day, money, panel } from './shared';

// ---- the buy list: everything approved that the store team said must be bought -------------------------
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
  const approvedRequests = useMemo(
    () =>
      myRequests.filter(request => {
        if (
          request.status !== 'approved' ||
          !request.parts.some(part => part.source === 'purchase' && part.status === 'planned')
        )
          return false;
        const tickets = orders.filter(order =>
          order.items.some(item => item.requestId === request.id || item.requestNumber === request.number),
        );
        return (
          tickets.some(order => ['draft', 'pending', 'rejected'].includes(order.status)) ||
          (!tickets.length && unlinkedPurchaseParts(request).length > 0)
        );
      }),
    [myRequests, orders],
  );

  return (
    <div className="space-y-5">
      <section className={cx(panel, 'overflow-x-auto')}>
        {approvedRequests.length ? (
          <table className="w-full min-w-[1050px] table-fixed border-x border-line text-[10.5px] xl:min-w-0 xl:text-[11.5px]">
            <colgroup>
              <col className="w-[9%]" />
              <col className="w-[9%]" />
              <col className="w-[10%]" />
              <col className="w-[9%]" />
              <col className="w-[7%]" />
              <col className="w-[8%]" />
              <col className="w-[7%]" />
              <col className="w-[8%]" />
              <col className="w-[8%]" />
              <col className="w-[8%]" />
              <col className="w-[7%]" />
              <col className="w-[10%]" />
            </colgroup>
            <thead className="bg-raised/40 text-left text-[10px] uppercase tracking-wide text-mute xl:text-[10px]">
              <tr>
                {[
                  'Request',
                  'Requester',
                  'Department',
                  'Item',
                  'Qty to order',
                  'Needed by',
                  'PO ticket',
                  'Vendor',
                  'Expected',
                  'Budget',
                  'Status',
                  '',
                ].map((heading, index) => (
                  <th key={index} className="border-r border-line px-1.5 py-1.5 font-bold last:border-r-0">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70">
              {approvedRequests.flatMap(request =>
                request.parts
                  .filter(part => part.source === 'purchase' && part.status === 'planned')
                  .map(part => {
                    const item = request.items.find(row => row.id === part.itemId);
                    const order = orders.find(candidate =>
                      candidate.items.some(line => line.id === part.purchaseItemId && !!part.purchaseItemId),
                    );
                    const canOpen = order && ['draft', 'pending', 'rejected'].includes(order.status);
                    return (
                      <tr key={part.id} className="hover:bg-raised/30">
                        <td className="border-r border-line/70 px-1.5 py-1.5 align-top">
                          <span className="font-mono font-bold text-blue-300">{request.number}</span>
                          <div className="mt-0.5 break-words text-mute">{request.title}</div>
                        </td>
                        <td className="border-r border-line/70 px-1.5 py-1.5 align-top break-words">
                          {request.requesterName}
                        </td>
                        <td className="border-r border-line/70 px-1.5 py-1.5 align-top break-words">
                          {request.departmentName || '—'}
                        </td>
                        <td className="border-r border-line/70 px-1.5 py-1.5 align-top break-words font-medium text-ink">
                          {item?.name || 'Request item'}
                        </td>
                        <td className="border-r border-line/70 px-1.5 py-1.5 align-top tabular-nums">
                          {part.qty} {item?.unit || ''}
                        </td>
                        <td className="border-r border-line/70 px-1.5 py-1.5 align-top">
                          {request.neededBy ? day(request.neededBy) : '—'}
                        </td>
                        <td className="border-r border-line/70 px-1.5 py-1.5 align-top break-words font-mono text-blue-300">
                          {order?.number || (part.purchaseItemId ? '—' : 'Preparing…')}
                        </td>
                        <td className="border-r border-line/70 px-1.5 py-1.5 align-top break-words">
                          {order ? vendorName(order.vendorId) : '—'}
                        </td>
                        <td className="border-r border-line/70 px-1.5 py-1.5 align-top">
                          {order?.expectedDate ? day(order.expectedDate) : '—'}
                        </td>
                        <td className="border-r border-line/70 px-1.5 py-1.5 align-top tabular-nums break-words">
                          {item?.budgetAmount != null ? money(item.budgetAmount) : '—'}
                        </td>
                        <td className="border-r border-line/70 px-1.5 py-1.5 align-top">
                          {order ? <StatusChip s={order.status} /> : <span className="text-mute">Approved</span>}
                        </td>
                        <td className="px-1 py-1.5 text-center align-top">
                          {canOpen && (
                            <button
                              type="button"
                              className={`${btnGhost(D)} !px-1.5 !py-0.5 text-[10px]`}
                              onClick={() => editOrder(order.id)}
                            >
                              Open
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  }),
              )}
            </tbody>
          </table>
        ) : (
          <Empty>No approved requests waiting to be ordered.</Empty>
        )}
      </section>
    </div>
  );
};
