export type POStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'ordered' | 'partial' | 'received' | 'cancelled';

export interface Vendor { id: string; name: string; contact: string; phone: string; email: string; address: string; notes: string }
export interface POItem { id: string; inventoryItemId: string | null; name: string; unit: string; qtyOrdered: number; qtyReceived: number; rate: number; requestId: string | null; requestNumber: string }
export interface PO {
  id: string; number: string; vendorId: string | null; title: string; requestedBy: string; deliverTo: string; expectedDate: string;
  status: POStatus; notes: string; paid: number; createdBy: string; approvedBy: string; approvedAt: string; createdAt: string; decisionNote: string; items: POItem[];
}
// A delivery against an order line (goods received note).
export interface Receipt { id: string; poId: string; itemId: string; qty: number; givenBy: string; receivedBy: string; challan: string; note: string; doneBy: string; doneAt: string }
export interface Payment { id: string; poId: string; amount: number; mode: string; ref: string; paidBy: string; note: string; doneBy: string; doneAt: string }

export const STATUS: Record<POStatus, { label: string; tone: 'ok' | 'warn' | 'bad' | 'info' | 'mute' }> = {
  draft: { label: 'Draft', tone: 'mute' },
  pending: { label: 'Awaiting approval', tone: 'warn' },
  approved: { label: 'Approved', tone: 'info' },
  rejected: { label: 'Rejected', tone: 'bad' },
  ordered: { label: 'Ordered', tone: 'info' },
  partial: { label: 'Partly received', tone: 'warn' },
  received: { label: 'Received', tone: 'ok' },
  cancelled: { label: 'Cancelled', tone: 'mute' },
};

// Purchase asks, the owner approves, Purchase pays.
export type PayReqStatus = 'pending' | 'approved' | 'rejected' | 'paid' | 'cancelled';
export interface PaymentRequest {
  id: string; poId: string; amount: number; note: string; status: PayReqStatus; requestedBy: string; requestedById: string | null; requestedAt: string;
  decidedBy: string; decidedAt: string; decisionNote: string; paymentId: string | null; paidAt: string;
}
export const PAYREQ: Record<PayReqStatus, { label: string; tone: 'ok' | 'warn' | 'bad' | 'info' | 'mute' }> = {
  pending: { label: 'Waiting for the owner', tone: 'warn' }, approved: { label: 'Approved, ready to pay', tone: 'info' },
  rejected: { label: 'Rejected', tone: 'bad' }, paid: { label: 'Paid', tone: 'ok' }, cancelled: { label: 'Withdrawn', tone: 'mute' },
};

export const PAY_MODES: [string, string][] = [['bank', 'Bank transfer'], ['upi', 'UPI'], ['cash', 'Cash'], ['cheque', 'Cheque'], ['card', 'Card']];
export const payModeLabel = (k: string) => PAY_MODES.find(m => m[0] === k)?.[1] || k;

export const poTotal = (p: PO) => p.items.reduce((a, i) => a + i.qtyOrdered * i.rate, 0);
export const poDue = (p: PO) => Math.max(0, Math.round((poTotal(p) - p.paid) * 100) / 100);
export const poUnitsLeft = (p: PO) => p.items.reduce((a, i) => a + Math.max(0, i.qtyOrdered - i.qtyReceived), 0);
// Statuses in which money is owed to the vendor.
export const PAYABLE: POStatus[] = ['approved', 'ordered', 'partial', 'received'];
// Statuses in which goods are expected to arrive.
export const INCOMING: POStatus[] = ['ordered', 'partial'];
