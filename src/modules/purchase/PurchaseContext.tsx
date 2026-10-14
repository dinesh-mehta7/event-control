import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../walkie/lib/supabaseClient';
import { useWalkie } from '../walkie';
import { todayStr } from '../accommodation/dates';
import { INCOMING, PAYABLE, poDue } from './types';
import type { PO, POItem, POStatus, Payment, PaymentRequest, PayReqStatus, PurchaseTracking, Receipt, Vendor, VendorMode } from './types';

const mapVendor = (r: any): Vendor => ({ id: r.id, name: r.name, vendorMode: r.vendor_mode || null, contact: r.contact_person || '', phone: r.phone || '', email: r.email || '', address: r.address || '', notes: r.notes || '' });
const mapItem = (r: any): POItem => ({ id: r.id, inventoryItemId: r.inventory_item_id || null, name: r.name, unit: r.unit || 'pcs', qtyOrdered: r.qty_ordered, qtyReceived: r.qty_received, requestId: r.request_id || null, requestNumber: r.request_number || '', rate: Number(r.rate) || 0 });
const mapPO = (r: any, items: POItem[]): PO => ({
  id: r.id, number: r.po_number || '', vendorId: r.vendor_id || null, vendorMode: r.vendor_mode || null, title: r.title, requestedBy: r.requested_by || '', deliverTo: r.deliver_to || '',
  expectedDate: r.expected_date || '', status: r.status, notes: r.notes || '', miscAmount: Number(r.misc_amount) || 0, paid: Number(r.paid_amount) || 0, createdBy: r.created_by || '',
  approvedBy: r.approved_by || '', approvedAt: r.approved_at || '', createdAt: r.created_at, decisionNote: r.decision_note || '', items,
});
const mapPayReq = (r: any): PaymentRequest => ({
  id: r.id, poId: r.po_id, amount: Number(r.amount) || 0, note: r.note || '', status: r.status as PayReqStatus, requestedBy: r.requested_by || '', requestedById: r.requested_by_id || null,
  requestedAt: r.requested_at, decidedBy: r.decided_by || '', decidedAt: r.decided_at || '', decisionNote: r.decision_note || '', paymentId: r.payment_id || null, paidAt: r.paid_at || '',
});
const mapReceipt = (r: any): Receipt => ({ id: r.id, poId: r.po_id, itemId: r.item_id, qty: r.qty, location: r.location || '', givenBy: r.given_by || '', receivedBy: r.received_by || '', challan: r.challan || '', note: r.note || '', doneBy: r.done_by || '', doneAt: r.done_at });
const mapPayment = (r: any): Payment => ({ id: r.id, poId: r.po_id, amount: Number(r.amount) || 0, mode: r.mode || '', ref: r.ref || '', paidBy: r.paid_by || '', note: r.note || '', doneBy: r.done_by || '', doneAt: r.done_at });
const mapTracking = (r: any): PurchaseTracking => ({ id: r.id, poId: r.po_id, purchaseItemId: r.purchase_item_id, marketplace: r.marketplace, marketplaceOrderNumber: r.marketplace_order_number || '', trackingNumber: r.tracking_number, courierSlug: r.courier_slug || '', status: r.status || 'Pending', subStatus: r.sub_status || '', trackingUrl: r.tracking_url || '', estimatedDelivery: r.estimated_delivery || '', checkpoints: Array.isArray(r.checkpoints) ? r.checkpoints : [], updatedAt: r.updated_at });

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const uid = (p: string) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

const friendlyError = (error: any): string => {
  const msg: string = error?.message || 'Unknown error';
  if (/row-level security|permission denied/i.test(msg)) return "You don't have permission to do that.";
  if (error?.code === '23503' || /foreign key/i.test(msg)) return "That is still used by purchase orders, so it can't be deleted.";
  if (error?.code === '23505' || /duplicate key/i.test(msg)) return 'That name already exists.';
  if (/vendor_mode.*purchase_orders|purchase_orders.*vendor_mode/i.test(msg)) return `${msg} — run supabase/migration_v51_vendor_order_mode.sql after v50, then reload.`;
  if (/vendor_mode.*purchase_vendors|purchase_vendors.*vendor_mode/i.test(msg)) return `${msg} — run supabase/migration_v52_vendor_categories.sql after the purchase schema is installed, then reload.`;
  if (/schema cache|does not exist|could not find/i.test(msg)) return `${msg} — check that this project's required Supabase migrations are applied, then reload the schema.`;
  return msg;
};

export interface VendorInput { name: string; vendorMode: VendorMode | ''; contact: string; phone: string; email: string; address: string; notes: string }
// What can still be edited on an order: the vendor, the date, a note and the rate of every line. Lines come from requests.
export interface DraftInput { vendorId: string; vendorMode: VendorMode | ''; expectedDate: string; notes: string; miscAmount: number; rates: Record<string, number> }
export interface ReceiveMeta { location: string; givenBy: string; receivedBy: string; challan: string; note: string }
export interface PayInput { mode: string; ref: string; paidBy: string; note: string }
export interface PStats { awaiting: number; open: number; toReceive: number; overdue: number; due: number; orders: number }

interface Ctx {
  vendors: Vendor[]; orders: PO[]; payRequests: PaymentRequest[]; trackings: PurchaseTracking[]; loading: boolean; loadError: string; stats: PStats; userName: string;
  canManage: boolean; canReceive: boolean;
  vendorName: (id: string | null) => string;
  addVendor: (v: VendorInput) => Promise<boolean>;
  updateVendor: (id: string, v: VendorInput) => Promise<boolean>;
  deleteVendor: (id: string) => Promise<boolean>;
  createOrder: (partIds: string[]) => Promise<string | null>;
  saveDraft: (id: string, input: DraftInput, submit: boolean) => Promise<boolean>;
  setStatus: (id: string, status: POStatus, doneMsg: string, note?: string) => Promise<boolean>;
  deleteOrder: (id: string) => Promise<boolean>;
  receive: (poId: string, lines: { itemId: string; qty: number }[], meta: ReceiveMeta) => Promise<boolean>;
  registerTracking: (input: { poId: string; purchaseItemId: string; vendorId: string; marketplaceOrderNumber: string; trackingNumber: string; courierSlug: string }) => Promise<boolean>;
  askPayment: (poId: string, amount: number, note: string) => Promise<boolean>;
  payNow: (id: string, p: PayInput) => Promise<boolean>;
  withdrawPayment: (id: string) => Promise<boolean>;
  fetchReceipts: (poId?: string, limit?: number) => Promise<Receipt[]>;
  fetchPayments: (poId?: string, limit?: number) => Promise<Payment[]>;
  refresh: () => Promise<void>;
}
const C = createContext<Ctx | null>(null);
export const usePurchase = (): Ctx => { const c = useContext(C); if (!c) throw new Error('usePurchase must be used inside <PurchaseProvider>'); return c; };

export const PurchaseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const w: any = useWalkie();
  const user = w.currentUser;
  const orgId: string | null = user?.organizationId || null;
  const ready = !!user && user.approved !== false && user.isActive !== false && !!orgId;
  const exec = ready && (user.level === 'owner' || user.level === 'dept_head');
  const canManage = exec || (ready && user.subDepartment === 'purchase');
  const canReceive = canManage || (ready && user.subDepartment === 'inventory');

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [orders, setOrders] = useState<PO[]>([]);
  const [payRequests, setPayRequests] = useState<PaymentRequest[]>([]);
  const [trackings, setTrackings] = useState<PurchaseTracking[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const ordersRef = useRef(orders); ordersRef.current = orders;
  const vendorsRef = useRef(vendors); vendorsRef.current = vendors;

  const toast = useCallback((m: string, t: 'success' | 'error' | 'warning' = 'success') => w.addToast?.(m, t), [w.addToast]);
  const log = useCallback((a: string, d: string, t = 'info') => { try { w.logAction?.(a, d, t); } catch { /* best effort */ } }, [w.logAction]);

  const fetchAll = async (table: string, order: string) => {
    const out: any[] = [];
    for (let from = 0; ; from += 1000) {
      const r = await supabase.from(table).select('*').order(order, { ascending: true }).range(from, from + 999);
      if (r.error) return { data: [] as any[], error: r.error };
      out.push(...(r.data || []));
      if (!r.data || r.data.length < 1000) break;
    }
    return { data: out, error: null };
  };

  const load = useCallback(async () => {
    if (!ready) return;
    setLoading(true);
    const [v, o, i, tr] = await Promise.all([fetchAll('purchase_vendors', 'created_at'), fetchAll('purchase_orders', 'created_at'), fetchAll('purchase_items', 'position'), fetchAll('purchase_trackings', 'updated_at')]);
    const pr = canManage ? await fetchAll('purchase_payment_requests', 'requested_at') : { data: [] as any[], error: null };
    const err = v.error || o.error || i.error;
    if (err) setLoadError(friendlyError(err));
    else {
      setLoadError('');
      const byPo = new Map<string, POItem[]>();
      i.data.forEach((r: any) => { const l = byPo.get(r.po_id) || []; l.push(mapItem(r)); byPo.set(r.po_id, l); });
      setVendors(v.data.map(mapVendor).sort((a: Vendor, b: Vendor) => collator.compare(a.name, b.name)));
      setOrders(o.data.map((r: any) => mapPO(r, byPo.get(r.id) || [])).sort((a: PO, b: PO) => (a.createdAt < b.createdAt ? 1 : -1)));
      setTrackings(tr.error ? [] : tr.data.map(mapTracking).sort((a: PurchaseTracking, b: PurchaseTracking) => (a.updatedAt < b.updatedAt ? 1 : -1)));
      setPayRequests(pr.error ? [] : pr.data.map(mapPayReq).sort((a: PaymentRequest, b: PaymentRequest) => (a.requestedAt < b.requestedAt ? 1 : -1)));
    }
    setLoading(false);
  }, [ready, canManage]);

  useEffect(() => { if (!ready) { setVendors([]); setOrders([]); setPayRequests([]); setTrackings([]); setLoadError(''); return; } load(); }, [ready, orgId, canManage]); // eslint-disable-line

  // Live sync: any change to orders / items / vendors reloads (debounced).
  useEffect(() => {
    if (!ready) return;
    let timer: any;
    const schedule = () => { clearTimeout(timer); timer = setTimeout(load, 500); };
    const filter = `organization_id=eq.${orgId}`;
    const ch = supabase.channel(`purchase-${orgId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'purchase_orders', filter }, schedule)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'purchase_items', filter }, schedule)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'purchase_vendors', filter }, schedule)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'purchase_payment_requests', filter }, schedule)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'purchase_trackings', filter }, schedule)
      .subscribe();
    const poll = setInterval(load, 120000);
    return () => { clearTimeout(timer); supabase.removeChannel(ch); clearInterval(poll); };
  }, [ready, orgId]); // eslint-disable-line

  const deny = () => { toast('You can view purchases but not change them.', 'error'); return false; };
  const vendorName = useCallback((id: string | null) => (id ? vendors.find(v => v.id === id)?.name || 'Removed vendor' : '—'), [vendors]);

  // ---- vendors --------------------------------------------------------------
  const vbody = (v: VendorInput) => ({ name: v.name.trim(), vendor_mode: v.vendorMode || null, contact_person: v.contact.trim(), phone: v.phone.trim(), email: v.email.trim(), address: v.address.trim(), notes: v.notes.trim() });
  const addVendor: Ctx['addVendor'] = async (v) => {
    if (!canManage) return deny();
    if (!v.name.trim()) { toast('Vendor name is required.', 'error'); return false; }
    if (!v.vendorMode) { toast('Choose whether this vendor is Online or Offline.', 'error'); return false; }
    const { error } = await supabase.from('purchase_vendors').insert({ id: uid('ven'), organization_id: orgId, ...vbody(v) });
    if (error) { toast(error.code === '23505' ? 'A vendor with that name already exists.' : friendlyError(error), 'error'); return false; }
    await load(); toast(`${v.name.trim()} added.`);
    return true;
  };
  const updateVendor: Ctx['updateVendor'] = async (id, v) => {
    if (!canManage) return deny();
    if (!v.name.trim()) { toast('Vendor name is required.', 'error'); return false; }
    if (!v.vendorMode) { toast('Choose whether this vendor is Online or Offline.', 'error'); return false; }
    const { error } = await supabase.from('purchase_vendors').update(vbody(v)).eq('id', id);
    if (error) { toast(error.code === '23505' ? 'A vendor with that name already exists.' : friendlyError(error), 'error'); return false; }
    await load(); toast('Saved.');
    return true;
  };
  const deleteVendor: Ctx['deleteVendor'] = async (id) => {
    if (!canManage) return deny();
    const { error } = await supabase.from('purchase_vendors').delete().eq('id', id);
    if (error) { toast(friendlyError(error), 'error'); return false; }
    setVendors(p => p.filter(v => v.id !== id)); toast('Vendor deleted.');
    return true;
  };

  // ---- orders ---------------------------------------------------------------
  // One order out of the lines on the buy list (lines of several tickets are fine).
  const createOrder: Ctx['createOrder'] = async (partIds) => {
    if (!canManage) { deny(); return null; }
    if (!partIds.length) { toast('Choose at least one item from the buy list.', 'error'); return null; }
    const { data, error } = await supabase.rpc('purchase_create_po', { p_parts: partIds });
    if (error) { toast(friendlyError(error), 'error'); return null; }
    await load();
    log('Purchase Order', `${user.name} created an order from ${partIds.length} line(s) of the buy list`, 'info');
    toast('Order created. Add the vendor and rates, then place the order.');
    return String(data);
  };

  // Save vendor, date, note, and rates; optionally record that Purchase has placed the order.
  const saveDraft: Ctx['saveDraft'] = async (id, input, submit) => {
    if (!canManage) return deny();
    const po = ordersRef.current.find(o => o.id === id);
    if (!po) { toast('That order no longer exists.', 'error'); return false; }
    if (submit && !input.vendorMode) { toast('Choose Online or Offline before marking this order.', 'error'); return false; }
    if (submit && !input.vendorId) { toast('Choose a vendor before marking it ordered.', 'error'); return false; }
    const selectedVendor = vendors.find(v => v.id === input.vendorId);
    if (submit && (!selectedVendor?.vendorMode || selectedVendor.vendorMode !== input.vendorMode)) { toast('Choose a vendor with a matching Online or Offline category.', 'error'); return false; }
    if (submit && po.items.some(i => !(+input.rates[i.id] > 0))) { toast('Enter the rate for every item before marking it ordered.', 'error'); return false; }
    const head = { vendor_id: input.vendorId || null, vendor_mode: input.vendorMode || null, expected_date: input.expectedDate || null, notes: input.notes.trim(), misc_amount: Math.max(0, Math.round((input.miscAmount || 0) * 100) / 100) };
    let miscColumnMissing = false;
    let r = await supabase.from('purchase_orders').update(head).eq('id', id);
    if (r.error && /misc_amount/i.test(r.error.message) && /column|schema cache|does not exist|could not find/i.test(r.error.message)) {
      miscColumnMissing = true;
      if (submit) {
        toast('Cannot place this order yet: apply supabase/migration_v56_purchase_misc_amount.sql and reload the Supabase schema first.', 'error');
        return false;
      }
      const { misc_amount: _unsupported, ...compatibleHead } = head;
      r = await supabase.from('purchase_orders').update(compatibleHead).eq('id', id);
    }
    if (r.error) { toast(`Could not save: ${friendlyError(r.error)}`, 'error'); return false; }
    for (const i of po.items) {
      const rate = Math.max(0, Math.round((+input.rates[i.id] || 0) * 100) / 100);
      if (rate === i.rate) continue;
      const u = await supabase.from('purchase_items').update({ rate }).eq('id', i.id);
      if (u.error) { toast(`Could not save the rates: ${friendlyError(u.error)}`, 'error'); await load(); return false; }
    }
    if (submit) {
      const s2 = await supabase.from('purchase_orders').update({ status: 'ordered' }).eq('id', id);
      if (s2.error) { toast(`Saved, but could not mark as ordered: ${friendlyError(s2.error)}`, 'warning'); await load(); return true; }
    }
    await load();
    log('Purchase Order', `${user.name} ${submit ? 'marked as ordered' : 'updated'} ${po.number}`, 'info');
    if (miscColumnMissing) toast('Draft saved, but miscellaneous costs need supabase/migration_v56_purchase_misc_amount.sql before they can be saved or the order placed.', 'warning');
    else if (submit) toast(input.vendorMode === 'online' ? 'Online order marked as placed. Add tracking details when available.' : 'Offline order marked as placed.');
    return true;
  };

  const setStatus: Ctx['setStatus'] = async (id, status, doneMsg, _note = '') => {
    const needsApprover = status === 'approved' || status === 'rejected';
    if (needsApprover) { toast('Purchase orders no longer need a second approval.', 'error'); return false; }
    if (!canManage) return deny();
    const { error } = await supabase.from('purchase_orders').update({ status }).eq('id', id);
    if (error) { toast(friendlyError(error), 'error'); return false; }
    const po = ordersRef.current.find(o => o.id === id);
    await load();
    // Rejected orders are blocked above, so only cancellation reaches this log as a warning.
    log('Purchase Order', `${user.name}: ${po?.number || id} → ${status}`, status === 'cancelled' ? 'warning' : 'info');
    toast(doneMsg);
    return true;
  };

  const deleteOrder: Ctx['deleteOrder'] = async (id) => {
    if (!canManage) return deny();
    const { error } = await supabase.from('purchase_orders').delete().eq('id', id);
    if (error) { toast(friendlyError(error), 'error'); return false; }
    setOrders(p => p.filter(o => o.id !== id)); toast('Order deleted.');
    return true;
  };

  // ---- goods received + payments -----------------------------------------------
  const receive: Ctx['receive'] = async (poId, lines, meta) => {
    if (!canReceive) { toast("You don't have permission to receive goods.", 'error'); return false; }
    const po = ordersRef.current.find(o => o.id === poId);
    let done = 0;
    for (const l of lines.filter(x => x.qty > 0)) {
      const { error } = await supabase.from('purchase_receipts').insert({
        id: uid('rc'), organization_id: orgId, po_id: poId, item_id: l.itemId, qty: l.qty,
        location: meta.location || null, given_by: meta.givenBy.trim(), received_by: meta.receivedBy.trim(), challan: meta.challan.trim(), note: meta.note.trim(), done_by: user.name,
      });
      if (error) { toast(`${done ? `${done} line(s) saved, then stopped: ` : ''}${friendlyError(error)}`, 'error'); await load(); return false; }
      done++;
    }
    await load();
    log('Purchase Received', `${user.name} received goods on ${po?.number || poId}`, 'success');
    toast('Goods received and synced to inventory stock.');
    return true;
  };

  const registerTracking: Ctx['registerTracking'] = async (input) => {
    if (!canManage) return deny();
    const { data, error } = await supabase.functions.invoke('aftership-register-tracking', { body: {
      po_id: input.poId, purchase_item_id: input.purchaseItemId, vendor_id: input.vendorId,
      marketplace_order_number: input.marketplaceOrderNumber.trim(), tracking_number: input.trackingNumber.trim(), courier_slug: input.courierSlug.trim(),
    } });
    if (error) {
      let message = error.message || 'Could not start shipment tracking.';
      try { const body = await error.context?.json(); if (body?.error) message = body.error; } catch { /* response body is optional */ }
      toast(message, 'error'); return false;
    }
    await load(); toast(data?.awaitingDispatch ? 'Marketplace order ID saved. Add the courier AWB after dispatch to start live updates.' : 'Live courier tracking connected. Updates will appear here automatically.'); return true;
  };

  // Purchase records the payment request and can pay it without another Super Admin approval.
  const askPayment: Ctx['askPayment'] = async (poId, amount, note) => {
    if (!canManage) return deny();
    const { error } = await supabase.rpc('payment_request_create', { p_po: poId, p_amount: amount, p_note: note });
    if (error) { toast(friendlyError(error), 'error'); return false; }
    await load(); toast('Payment saved and ready to record.');
    return true;
  };
  const payNow: Ctx['payNow'] = async (id, p) => {
    if (!canManage) return deny();
    const { error } = await supabase.rpc('payment_request_pay', { p_id: id, p_mode: p.mode, p_ref: p.ref.trim(), p_paid_by: p.paidBy.trim(), p_note: p.note.trim() });
    if (error) { toast(friendlyError(error), 'error'); return false; }
    await load(); log('Purchase Payment', `${user.name} recorded a payment`, 'info'); toast('Payment recorded.');
    return true;
  };
  const withdrawPayment: Ctx['withdrawPayment'] = async (id) => {
    const { error } = await supabase.rpc('payment_request_cancel', { p_id: id });
    if (error) { toast(friendlyError(error), 'error'); return false; }
    await load(); toast('Payment request cancelled.');
    return true;
  };

  const fetchReceipts: Ctx['fetchReceipts'] = async (poId, limit = 300) => {
    let q = supabase.from('purchase_receipts').select('*').order('done_at', { ascending: false }).limit(limit);
    if (poId) q = q.eq('po_id', poId);
    const { data, error } = await q;
    if (error) { toast(friendlyError(error), 'error'); return []; }
    return (data || []).map(mapReceipt);
  };
  const fetchPayments: Ctx['fetchPayments'] = async (poId, limit = 300) => {
    let q = supabase.from('purchase_payments').select('*').order('done_at', { ascending: false }).limit(limit);
    if (poId) q = q.eq('po_id', poId);
    const { data, error } = await q;
    if (error) { toast(friendlyError(error), 'error'); return []; }
    return (data || []).map(mapPayment);
  };

  const stats = useMemo<PStats>(() => {
    const s: PStats = { awaiting: 0, open: 0, toReceive: 0, overdue: 0, due: 0, orders: orders.length };
    const today = todayStr();
    for (const o of orders) {
      if (o.status === 'pending') s.awaiting++;
      if (['approved', 'ordered', 'partial'].includes(o.status)) s.open++;
      if (INCOMING.includes(o.status)) { s.toReceive++; if (o.expectedDate && o.expectedDate < today) s.overdue++; }
      if (PAYABLE.includes(o.status)) s.due += poDue(o);
    }
    s.due = Math.round(s.due * 100) / 100;
    return s;
  }, [orders]);

  const value: Ctx = { vendors, orders, payRequests, trackings, loading, loadError, stats, userName: user?.name || '', canManage, canReceive, vendorName, addVendor, updateVendor, deleteVendor, createOrder, saveDraft, setStatus, deleteOrder, receive, registerTracking, askPayment, payNow, withdrawPayment, fetchReceipts, fetchPayments, refresh: load };
  return <C.Provider value={value}>{children}</C.Provider>;
};
