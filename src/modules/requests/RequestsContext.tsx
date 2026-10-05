import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../walkie/lib/supabaseClient';
import { useApp as useWalkie } from '../walkie/context/AppContext';
import type { SubDepartmentId } from '../../types';
import type { CatalogueItem, NewRequest, OrderInfo, PlanPart, Req, ReqEvent, ReqItem, ReqPart, ReqStatus } from './types';

// Requests: requester -> (sub-department head) -> owner -> Inventory / Walkie team (stock + purchase) -> requester confirms.
// Everything is read through Row Level Security and changed only through database functions (migrations v16 + v17).

const mapItem = (r: any): ReqItem => ({
  id: r.id, requestId: r.request_id, position: r.position, kind: r.kind, name: r.name, unit: r.unit,
  requested: r.qty_requested, approved: r.qty_approved ?? null, note: r.note || '',
  reason: r.reason || '', cutReason: r.cut_reason || '', inventoryItemId: r.inventory_item_id || null,
});
const mapPart = (r: any): ReqPart => ({
  id: r.id, requestId: r.request_id, itemId: r.item_id, source: r.source, qty: r.qty, inventoryItemId: r.inventory_item_id || null,
  purchaseItemId: r.purchase_item_id || null, status: r.status, location: r.location_name || '', receivedBy: r.received_by || '',
  note: r.note || '', doneBy: r.done_by || '', doneAt: r.done_at || '',
});
const mapEvent = (r: any): ReqEvent => ({ id: r.id, requestId: r.request_id, at: r.at, by: r.actor_name || '', kind: r.kind, text: r.text || '' });

const dbMessage = (e: any): string => {
  const m: string = e?.message || 'Something went wrong.';
  if (/could not find the function|schema cache|does not exist/i.test(m)) return 'Requests are not fully set up yet. Run migrations v16 through v19, then supabase/migration_v28_request_it_owner_approval.sql in the Supabase SQL Editor.';
  if (/row-level security|permission denied/i.test(m)) return "You don't have permission to do that.";
  return m;
};

export interface Availability { inStock: number; reserved: number; available: number }

interface Ctx {
  requests: Req[]; loading: boolean; loadError: string; ready: boolean;
  me: { id: string; level: string; team: SubDepartmentId | null; isOwner: boolean; isExec: boolean };
  orders: Record<string, OrderInfo>;               // by purchase_items.id
  // what this person can do
  canReviewSub: (r: Req) => boolean; canReviewIt: (r: Req) => boolean; canOwnerReview: (r: Req) => boolean; canCancel: (r: Req) => boolean;
  canArrange: (kind: 'item' | 'radio') => boolean; canOrder: boolean; canConfirm: (r: Req) => boolean;
  // queues (drive the badges)
  waitingForMe: Req[]; toArrange: Req[]; actionCount: number;
  submit: (input: NewRequest) => Promise<{ id: string | null; error: string | null }>;
  subReview: (id: string, approve: boolean, note: string) => Promise<string | null>;
  itReview: (id: string, approve: boolean, note: string) => Promise<string | null>;
  ownerReview: (id: string, approve: boolean, note: string, lines: { id: string; qty: number; reason: string }[]) => Promise<string | null>;
  cancel: (id: string) => Promise<string | null>;
  planLine: (itemId: string, plan: PlanPart[]) => Promise<string | null>;
  createPO: (id: string) => Promise<{ poId: string | null; error: string | null }>;
  deliver: (partId: string, location: string, receivedBy: string, note: string) => Promise<string | null>;
  confirmReceipt: (id: string) => Promise<string | null>;
  setVisibility: (id: string, showVendor: boolean, showRate: boolean) => Promise<string | null>;
  catalogue: CatalogueItem[];
  loadAvailability: () => Promise<Record<string, Availability>>;
  refresh: () => Promise<void>;
}
const C = createContext<Ctx | null>(null);

export const RequestsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const w: any = useWalkie();
  const u = w.currentUser;
  const uid: string | undefined = u?.approved && u?.isActive !== false ? u.id : undefined;
  const level: string = u?.level || 'other';
  const team: SubDepartmentId | null = u?.subDepartment || null;
  const isOwner = level === 'owner' && u?.role === 'Admin';
  const isExec = level === 'owner' || level === 'dept_head';

  const [requests, setRequests] = useState<Req[]>([]);
  const [orders, setOrders] = useState<Record<string, OrderInfo>>({});
  const [catalogue, setCatalogue] = useState<CatalogueItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [ready, setReady] = useState(false);
  const timer = useRef<any>(null);

  const load = useCallback(async () => {
    if (!uid) return;
    setLoading(true);
    const [rq, it, pt, ev, oi, cat] = await Promise.all([
      supabase.from('requests').select('*').order('created_at', { ascending: false }).limit(300),
      supabase.from('request_items').select('*').order('position', { ascending: true }),
      supabase.from('request_fulfilments').select('*').order('created_at', { ascending: true }),
      supabase.from('request_events').select('*').order('at', { ascending: true }),
      supabase.rpc('request_order_info'),
      supabase.rpc('catalogue_list'),
    ]);
    const err = rq.error || it.error || pt.error || ev.error;
    if (err) { setLoadError(dbMessage(err)); setLoading(false); setReady(true); return; }
    setLoadError('');
    const items = (it.data || []).map(mapItem); const parts = (pt.data || []).map(mapPart); const events = (ev.data || []).map(mapEvent);
    setRequests((rq.data || []).map((r: any): Req => ({
      id: r.id, number: r.number, requesterId: r.requester_id, requesterName: r.requester_name || '', subDepartment: r.sub_department || null,
      title: r.title, purpose: r.purpose || '', deliverTo: r.deliver_to || '', neededBy: r.needed_by || '', priority: r.priority,
      status: r.status as ReqStatus, subNote: r.sub_note || '', itNote: r.it_note || '', ownerNote: r.owner_note || '',
      createdAt: r.created_at, updatedAt: r.updated_at,
      showVendor: !!r.show_vendor, showRate: !!r.show_rate, confirmedAt: r.confirmed_at || null, confirmedBy: r.confirmed_by || '',
      items: items.filter(i => i.requestId === r.id), parts: parts.filter(p => p.requestId === r.id), events: events.filter(e => e.requestId === r.id),
    })));
    // Order progress per purchased line. The database decides what this person may see (PO number, vendor, rate).
    if (oi.error) setOrders({});
    else {
      const out: Record<string, OrderInfo> = {};
      (oi.data || []).forEach((x: any) => { out[x.purchase_item_id] = {
        purchaseItemId: x.purchase_item_id, requestId: x.request_id, itemId: x.item_id, ordered: x.ordered, received: x.received,
        poNumber: x.po_number ?? null, poStatus: x.po_status || '', expectedDate: x.expected_date || null, vendor: x.vendor ?? null, rate: x.rate == null ? null : Number(x.rate),
      }; });
      setOrders(out);
    }
    if (!cat.error) setCatalogue((cat.data || []).map((c: any) => ({ id: c.id, name: c.name, unit: c.unit, category: c.category })));
    setLoading(false); setReady(true);
  }, [uid]);

  // Reload at most once a moment, however many live events arrive.
  const soon = useCallback(() => { clearTimeout(timer.current); timer.current = setTimeout(load, 400); }, [load]);

  useEffect(() => {
    if (!uid) { setRequests([]); setOrders({}); setCatalogue([]); setReady(false); return; }
    load();
    const ch = supabase.channel(`requests-${uid}`);
    ['requests', 'request_items', 'request_fulfilments', 'request_events', 'purchase_items', 'purchase_orders'].forEach(t =>
      ch.on('postgres_changes', { event: '*', schema: 'public', table: t }, soon));
    ch.subscribe();
    const onFocus = () => soon();
    window.addEventListener('focus', onFocus);
    const poll = setInterval(load, 300000); // safety net if live updates are not enabled
    return () => { clearTimeout(timer.current); supabase.removeChannel(ch); window.removeEventListener('focus', onFocus); clearInterval(poll); };
  }, [uid, load, soon]);

  const run = useCallback(async (fn: () => PromiseLike<{ error: any }>): Promise<string | null> => {
    const { error } = await fn();
    if (error) return dbMessage(error);
    await load();
    return null;
  }, [load]);

  const me = useMemo(() => ({ id: uid || '', level, team, isOwner, isExec }), [uid, level, team, isOwner, isExec]);

  const canReviewSub = useCallback((r: Req) => r.status === 'pending_sub' && (isOwner || (level === 'sub_dept_head' && team === r.subDepartment)), [isOwner, level, team]);
  const canReviewIt = useCallback((r: Req) => r.status === 'pending_it' && (isOwner || level === 'dept_head'), [isOwner, level]);
  const canOwnerReview = useCallback((r: Req) => isOwner && r.status === 'pending_owner', [isOwner]);
  const canCancel = useCallback((r: Req) => r.requesterId === uid && ['pending_sub', 'pending_it', 'pending_owner'].includes(r.status), [uid]);
  const canArrange = useCallback((kind: 'item' | 'radio') => isExec || (kind === 'item' ? team === 'inventory' : team === 'walkie'), [isExec, team]);
  const canOrder = isExec || team === 'purchase';
  const canConfirm = useCallback((r: Req) => r.status === 'fulfilled' && !r.confirmedAt && (r.requesterId === uid || isExec), [uid, isExec]);

  // Requests that are waiting for THIS person's decision.
  const waitingForMe = useMemo(() => requests.filter(r =>
    (isOwner && ['pending_sub', 'pending_it', 'pending_owner'].includes(r.status)) ||
    (level === 'dept_head' && r.status === 'pending_it') ||
    (level === 'sub_dept_head' && r.status === 'pending_sub' && team === r.subDepartment)), [requests, isOwner, level, team]);
  // Approved requests that still have something this person's team has to do.
  const toArrange = useMemo(() => requests.filter(r => r.status === 'approved' && r.items.some(i => (i.approved ?? 0) > 0 && canArrange(i.kind) &&
    (r.parts.filter(p => p.itemId === i.id).reduce((t, p) => t + p.qty, 0) < (i.approved ?? 0) || r.parts.some(p => p.itemId === i.id && p.status === 'planned')))
    || (r.status === 'approved' && canOrder && r.parts.some(p => p.source === 'purchase' && !p.purchaseItemId))), [requests, canArrange, canOrder]);
  const actionCount = waitingForMe.length + toArrange.length;

  const submit = useCallback(async (i: NewRequest) => {
    const { data, error } = await supabase.rpc('request_submit', {
      p_title: i.title, p_purpose: i.purpose, p_needed_by: i.neededBy || null, p_priority: i.priority, p_deliver_to: i.deliverTo,
      p_items: i.lines.map(l => ({ name: l.name, unit: l.unit, qty: l.qty, kind: l.kind, note: l.note, reason: l.reason, inventory_item_id: l.inventoryItemId })),
    });
    if (error) return { id: null, error: dbMessage(error) };
    await load();
    return { id: data as string, error: null };
  }, [load]);
  const subReview = useCallback((id: string, approve: boolean, note: string) => run(() => supabase.rpc('request_sub_review', { p_id: id, p_approve: approve, p_note: note })), [run]);
  const itReview = useCallback((id: string, approve: boolean, note: string) => run(() => supabase.rpc('request_it_review', { p_id: id, p_approve: approve, p_note: note })), [run]);
  const ownerReview = useCallback((id: string, approve: boolean, note: string, lines: { id: string; qty: number; reason: string }[]) =>
    run(() => supabase.rpc('request_owner_review', { p_id: id, p_approve: approve, p_note: note, p_lines: lines })), [run]);
  const cancel = useCallback((id: string) => run(() => supabase.rpc('request_cancel', { p_id: id })), [run]);
  const planLine = useCallback((itemId: string, plan: PlanPart[]) =>
    run(() => supabase.rpc('request_plan_line', { p_item: itemId, p_plan: plan.map(p => ({ source: p.source, qty: p.qty, inventory_item_id: p.inventoryItemId })) })), [run]);
  const createPO = useCallback(async (id: string) => {
    const { data, error } = await supabase.rpc('request_create_po', { p_request: id });
    if (error) return { poId: null, error: dbMessage(error) };
    await load();
    return { poId: data as string, error: null };
  }, [load]);
  const deliver = useCallback((partId: string, location: string, receivedBy: string, note: string) =>
    run(() => supabase.rpc('request_deliver', { p_fulfilment: partId, p_location: location, p_received_by: receivedBy, p_note: note })), [run]);
  const confirmReceipt = useCallback((id: string) => run(() => supabase.rpc('request_confirm_receipt', { p_id: id })), [run]);
  const setVisibility = useCallback((id: string, showVendor: boolean, showRate: boolean) =>
    run(() => supabase.rpc('request_set_visibility', { p_id: id, p_vendor: showVendor, p_rate: showRate })), [run]);
  const loadAvailability = useCallback(async () => {
    const { data } = await supabase.rpc('inventory_available');
    const out: Record<string, Availability> = {};
    (data || []).forEach((x: any) => { out[x.item_id] = { inStock: x.in_stock, reserved: x.reserved, available: x.available }; });
    return out;
  }, []);

  const value = useMemo<Ctx>(() => ({
    requests, loading, loadError, ready, me, orders, catalogue, canReviewSub, canReviewIt, canOwnerReview, canCancel, canArrange, canOrder, canConfirm,
    waitingForMe, toArrange, actionCount, submit, subReview, itReview, ownerReview, cancel, planLine, createPO, deliver, confirmReceipt, setVisibility, loadAvailability, refresh: load,
  }), [requests, loading, loadError, ready, me, orders, catalogue, canReviewSub, canReviewIt, canOwnerReview, canCancel, canArrange, canOrder, canConfirm, waitingForMe, toArrange, actionCount,
    submit, subReview, itReview, ownerReview, cancel, planLine, createPO, deliver, confirmReceipt, setVisibility, loadAvailability, load]);
  return <C.Provider value={value}>{children}</C.Provider>;
};

export const useRequests = (): Ctx => {
  const v = useContext(C);
  if (!v) throw new Error('useRequests must be used inside RequestsProvider');
  return v;
};
