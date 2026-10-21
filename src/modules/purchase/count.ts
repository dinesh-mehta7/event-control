import { useMemo } from 'react';
import { useRequests } from '../requests/RequestsContext';
import { usePurchase } from './PurchaseContext';

// How much procurement work is waiting for THIS person. Approval ends with the request; payments are managed directly by Purchase.
export const useProcurementCount = () => {
  const { orders, payRequests, canManage } = usePurchase();
  const { requests } = useRequests();
  return useMemo(() => {
    const buy = canManage
      ? requests
          .filter(r => r.status === 'approved')
          .reduce(
            (n, r) =>
              n + r.parts.filter(p => p.source === 'purchase' && p.status === 'planned' && !p.purchaseItemId).length,
            0,
          )
      : 0;
    const approvePays = 0;
    const toSend = canManage ? orders.filter(o => o.status === 'draft' || o.status === 'rejected').length : 0;
    const toPlace = canManage ? orders.filter(o => ['pending', 'approved'].includes(o.status)).length : 0;
    const toPay = canManage ? payRequests.filter(r => r.status === 'pending' || r.status === 'approved').length : 0;
    const toReceive = orders.filter(o => o.status === 'ordered' || o.status === 'partial').length;
    return {
      buy,
      approveOrders: 0,
      approvePays,
      approve: approvePays,
      toSend,
      toPlace,
      toPay,
      toReceive,
      work: buy + toSend + toPlace + toPay,
      total: approvePays + buy + toSend + toPlace + toPay,
    };
  }, [orders, payRequests, requests, canManage]);
};
