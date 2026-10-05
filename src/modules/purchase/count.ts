import { useMemo } from 'react';
import { useRequests } from '../requests/RequestsContext';
import { usePurchase } from './PurchaseContext';

// How much buying work is waiting for THIS person. The owner: orders and payments to approve.
// The Purchase team: lines to order, orders to send / place, approved payments to pay.
export const useProcurementCount = () => {
  const { orders, payRequests, canApprove, canManage } = usePurchase();
  const { requests } = useRequests();
  return useMemo(() => {
    const buy = canManage ? requests.filter(r => r.status === 'approved').reduce((n, r) => n + r.parts.filter(p => p.source === 'purchase' && p.status === 'planned' && !p.purchaseItemId).length, 0) : 0;
    const approveOrders = canApprove ? orders.filter(o => o.status === 'pending').length : 0;
    const approvePays = canApprove ? payRequests.filter(r => r.status === 'pending').length : 0;
    const toSend = canManage ? orders.filter(o => o.status === 'draft' || o.status === 'rejected').length : 0;
    const toPlace = canManage ? orders.filter(o => o.status === 'approved').length : 0;
    const toPay = canManage ? payRequests.filter(r => r.status === 'approved').length : 0;
    const toReceive = orders.filter(o => o.status === 'ordered' || o.status === 'partial').length;
    return { buy, approveOrders, approvePays, approve: approveOrders + approvePays, toSend, toPlace, toPay, toReceive, work: buy + toSend + toPlace + toPay, total: approveOrders + approvePays + buy + toSend + toPlace + toPay };
  }, [orders, payRequests, requests, canApprove, canManage]);
};
