import type { PO, POItem, Payment, PaymentRequest, PayReqStatus, PurchaseTracking, Receipt, Vendor } from './types';
export { collator } from '../../lib/ids';
export { uid } from '../../lib/ids';

export const mapVendor = (r: any): Vendor => ({
  id: r.id,
  name: r.name,
  vendorMode: r.vendor_mode || null,
  contact: r.contact_person || '',
  phone: r.phone || '',
  email: r.email || '',
  address: r.address || '',
  accountHolder: r.account_holder || '',
  bankName: r.bank_name || '',
  accountNumber: r.account_number || '',
  ifsc: r.ifsc_code || '',
  bankBranch: r.bank_branch || '',
  upiId: r.upi_id || '',
  notes: r.notes || '',
});

export const mapItem = (r: any): POItem => ({
  id: r.id,
  inventoryItemId: r.inventory_item_id || null,
  name: r.name,
  unit: r.unit || 'pcs',
  qtyOrdered: r.qty_ordered,
  qtyReceived: r.qty_received,
  requestId: r.request_id || null,
  requestNumber: r.request_number || '',
  rate: Number(r.rate) || 0,
});

export const mapPO = (r: any, items: POItem[]): PO => ({
  id: r.id,
  number: r.po_number || '',
  vendorId: r.vendor_id || null,
  vendorMode: r.vendor_mode || null,
  title: r.title,
  requestedBy: r.requested_by || '',
  deliverTo: r.deliver_to || '',
  expectedDate: r.expected_date || '',
  status: r.status,
  notes: r.notes || '',
  miscAmount: Number(r.misc_amount) || 0,
  paid: Number(r.paid_amount) || 0,
  createdBy: r.created_by || '',
  approvedBy: r.approved_by || '',
  approvedAt: r.approved_at || '',
  createdAt: r.created_at,
  decisionNote: r.decision_note || '',
  items,
});

export const mapPayReq = (r: any): PaymentRequest => ({
  id: r.id,
  poId: r.po_id,
  amount: Number(r.amount) || 0,
  note: r.note || '',
  status: r.status as PayReqStatus,
  requestedBy: r.requested_by || '',
  requestedById: r.requested_by_id || null,
  requestedAt: r.requested_at,
  decidedBy: r.decided_by || '',
  decidedAt: r.decided_at || '',
  decisionNote: r.decision_note || '',
  paymentId: r.payment_id || null,
  paidAt: r.paid_at || '',
});

export const mapReceipt = (r: any): Receipt => ({
  id: r.id,
  poId: r.po_id,
  itemId: r.item_id,
  qty: r.qty,
  location: r.location || '',
  givenBy: r.given_by || '',
  receivedBy: r.received_by || '',
  challan: r.challan || '',
  note: r.note || '',
  doneBy: r.done_by || '',
  doneAt: r.done_at,
});

export const mapPayment = (r: any): Payment => ({
  id: r.id,
  poId: r.po_id,
  amount: Number(r.amount) || 0,
  mode: r.mode || '',
  ref: r.ref || '',
  paidBy: r.paid_by || '',
  note: r.note || '',
  billPath: r.bill_path || '',
  proofPath: r.proof_path || '',
  doneBy: r.done_by || '',
  doneAt: r.done_at,
});

export const mapTracking = (r: any): PurchaseTracking => ({
  id: r.id,
  poId: r.po_id,
  purchaseItemId: r.purchase_item_id,
  marketplace: r.marketplace,
  marketplaceOrderNumber: r.marketplace_order_number || '',
  trackingNumber: r.tracking_number,
  courierSlug: r.courier_slug || '',
  status: r.status || 'Pending',
  subStatus: r.sub_status || '',
  trackingUrl: r.tracking_url || '',
  estimatedDelivery: r.estimated_delivery || '',
  checkpoints: Array.isArray(r.checkpoints) ? r.checkpoints : [],
  updatedAt: r.updated_at,
});

export const friendlyError = (error: any): string => {
  const msg: string = error?.message || 'Unknown error';
  if (/row-level security|permission denied/i.test(msg)) return "You don't have permission to do that.";
  if (error?.code === '23503' || /foreign key/i.test(msg))
    return "That is still used by purchase orders, so it can't be deleted.";
  if (error?.code === '23505' || /duplicate key/i.test(msg)) return 'That name already exists.';
  if (/vendor_mode.*purchase_orders|purchase_orders.*vendor_mode/i.test(msg))
    return `${msg} — run supabase/migration_v51_vendor_order_mode.sql after v50, then reload.`;
  if (/vendor_mode.*purchase_vendors|purchase_vendors.*vendor_mode/i.test(msg))
    return `${msg} — run supabase/migration_v52_vendor_categories.sql after the purchase schema is installed, then reload.`;
  if (/account_holder|account_number|ifsc_code|bank_branch|bill_path|proof_path|payment_request_pay/i.test(msg))
    return `${msg} — run supabase/migration_v81_accounts_vendor_payment_docs.sql, then reload the schema.`;
  if (/schema cache|does not exist|could not find/i.test(msg))
    return `${msg} — check that this project's required Supabase migrations are applied, then reload the schema.`;
  return msg;
};
