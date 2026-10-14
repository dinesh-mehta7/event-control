import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../walkie/lib/supabaseClient';
import { useApp as useWalkie } from '../walkie/context/AppContext';
import type { SubDepartmentId } from '../../types';
import { lineRemainingToAllocate } from './types';
import type { CatalogueItem, NewRequest, OrderInfo, PlanPart, Req, ReqEvent, ReqItem, ReqPart, ReqStatus } from './types';

// Requests: requester -> IT Department Head (approve with budget or escalate) -> fulfilment -> requester confirms.
// Everything is read through Row Level Security and changed only through database functions (migrations v16–v44).

const mapItem = (r: any): ReqItem => ({
  id: r.id, requestId: r.request_id, position: r.position, kind: r.kind, name: r.name, unit: r.unit,
  requested: r.qty_requested, approved: r.qty_approved ?? null, budgetRate: r.budget_rate == null ? null : Number(r.budget_rate), budgetAmount: r.approved_budget == null ? null : Number(r.approved_budget), reviewPlan: Array.isArray(r.review_plan) ? r.review_plan.map((p: any) => ({ source: p.source, qty: Number(p.qty), inventoryItemId: p.inventory_item_id || null })) : [], returnRequired: !!r.return_required, note: r.note || '',
  reason: r.reason || '', cutReason: r.cut_reason || '', inventoryItemId: r.inventory_item_id || null,
});
const mapPart = (r: any): ReqPart => ({
  id: r.id, requestId: r.request_id, itemId: r.item_id, source: r.source, qty: r.qty, returnedQty: r.returned_qty || 0, inventoryItemId: r.inventory_item_id || null,
  purchaseItemId: r.purchase_item_id || null, status: r.status, location: r.location_name || '', receivedBy: r.received_by || '',
  note: r.note || '', doneBy: r.done_by || '', doneAt: r.done_at || '',
});
const mapEvent = (r: any): ReqEvent => ({
  id: r.id, requestId: r.request_id, at: r.at, by: r.actor_name || '', kind: r.kind,
  // Render historical activity using the current role names without rewriting audit records.
  text: (r.text || '').replace(/organization owner/gi, 'Super Admin').replace(/IT owner/gi, 'Department Admin').replace(/branch head/gi, 'Sub Admin'),
});

const fetchAll = async (table: string, sortColumn: string, ascending: boolean) => {
  const rows: any[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await (supabase as any).from(table).select('*').order(sortColumn, { ascending }).range(offset, offset + pageSize - 1);
    if (error) return { data: null, error };
    const page = data || [];
    rows.push(...page);
    if (page.length < pageSize) return { data: rows, error: null };
  }
};

const dbMessage = (e: any): string => {
  const m: string = e?.message || 'Something went wrong.';
  if (/could not find the function|schema cache|does not exist/i.test(m)) return 'Requests are not fully set up yet. Run the pending Supabase migrations through v49 in order.';
  if (/row-level security|permission denied/i.test(m)) return "You don't have permission to do that.";
  return m;
};

export interface Availability { inStock: number; reserved: number; available: number }

interface Ctx {
  requests: Req[]; loading: boolean; loadError: string; ready: boolean;
  me: { id: string; level: string; team: SubDepartmentId | null; departmentId: string | null; isOwner: boolean; isExec: boolean };
  orders: Record<string, OrderInfo>;               // by purchase_items.id
  // what this person can do
  canReviewSub: (r: Req) => boolean; canReviewIt: (r: Req) => boolean; canOwnerReview: (r: Req) => boolean; canCancel: (r: Req) => boolean;
  canArrange: (kind: 'item' | 'radio') => boolean; canDecideArrangement: boolean; canOrder: boolean; canConfirm: (r: Req) => boolean;
  // queues (drive the badges)
  waitingForMe: Req[]; toArrange: Req[]; actionCount: number;
  submit: (input: NewRequest) => Promise<{ id: string | null; error: string | null }>;
  subReview: (id: string, approve: boolean, note: string) => Promise<string | null>;
  itDecide: (id: string, action: 'approve' | 'escalate' | 'reject', note: string, miscItems: string, miscBudget: number, lines: { id: string; approvedQty: number; cutReason: string; budgetRate: number | null; arrangementConfirmed: boolean; plan: PlanPart[] }[]) => Promise<string | null>;
  assignDelivery: (id: string, delivery: { team: string; memberId: string }) => Promise<string | null>;
  ownerReview: (id: string, action: 'approve' | 'send_back' | 'reject') => Promise<string | null>;
  cancel: (id: string) => Promise<string | null>;
  planLine: (itemId: string, plan: PlanPart[]) => Promise<string | null>;
  createPO: (id: string) => Promise<{ poId: string | null; error: string | null }>;
  deliver: (partId: string, location: string, receivedBy: string, note: string) => Promise<string | null>;
  returnPart: (partId: string, qty: number, note: string) => Promise<string | null>;
  confirmReceipt: (id: string) => Promise<string | null>;
  catalogue: CatalogueItem[];
  loadAvailability: () => Promise<Record<string, Availability>>;
  refresh: () => Promise<void>;
}
const C = createContext<Ctx | null>(null);

export const RequestsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const w: any = useWalkie();
  const u = w.currentUser;
  const walkieDepartments: any[] = w.departments || [];
  const uid: string | undefined = u?.approved && u?.isActive !== false ? u.id : undefined;
  const level: string = u?.level || 'other';
  const team: SubDepartmentId | null = u?.subDepartment || null;
  const departmentId: string | null = u?.departmentId || null;
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
    const [rq, it, pt, ev, oi, cat, trackingRows] = await Promise.all([
      fetchAll('requests', 'created_at', false),
      fetchAll('request_items', 'position', true),
      fetchAll('request_fulfilments', 'created_at', true),
      fetchAll('request_events', 'at', true),
      supabase.rpc('request_order_info'),
      supabase.rpc('catalogue_list'),
      fetchAll('purchase_trackings', 'updated_at', false),
    ]);
    const err = rq.error || it.error || pt.error || ev.error;
    if (err) { setLoadError(dbMessage(err)); setLoading(false); setReady(true); return; }
    setLoadError('');
    const items = (it.data || []).map(mapItem); const parts = (pt.data || []).map(mapPart); const events = (ev.data || []).map(mapEvent);
    setRequests((rq.data || []).map((r: any): Req => ({
      id: r.id, number: r.number, requesterId: r.requester_id, requesterName: r.requester_name || '', subDepartment: r.sub_department || null,
      departmentId: r.department_id || null,
      departmentName: walkieDepartments.find(d => d.id === r.department_id)?.name || '',
      deliveryTeam: r.delivery_team || '', deliveryMemberId: r.delivery_member_id || null,
      title: r.title, purpose: r.purpose || '', deliverTo: r.deliver_to || '', neededBy: r.needed_by || '', priority: r.priority, miscItems: r.review_misc_items || '', miscBudget: Number(r.review_misc_budget || 0),
      status: r.status as ReqStatus, subNote: r.sub_note || '', itNote: r.it_note || '', ownerNote: r.owner_note || '',
      createdAt: r.created_at, updatedAt: r.updated_at,
      confirmedAt: r.confirmed_at || null, confirmedBy: r.confirmed_by || '',
      items: items.filter(i => i.requestId === r.id), parts: parts.filter(p => p.requestId === r.id), events: events.filter(e => e.requestId === r.id),
    })));
    // Order progress per purchased line. The database limits PO numbers by role and only returns requests this user can see.
    if (oi.error) setOrders({});
    else {
      const out: Record<string, OrderInfo> = {};
      const trackByItem = new Map<string, any>();
      (trackingRows.data || []).forEach((t: any) => {
        const previous = trackByItem.get(t.purchase_item_id);
        if (!previous || String(t.updated_at) > String(previous.updated_at)) trackByItem.set(t.purchase_item_id, t);
      });
      (oi.data || []).forEach((x: any) => { const tracking = trackByItem.get(x.purchase_item_id); const checkpoints = Array.isArray(tracking?.checkpoints) ? tracking.checkpoints : []; const latest = [...checkpoints].sort((a: any,b: any) => String(b.checkpoint_time || '').localeCompare(String(a.checkpoint_time || '')))[0]; out[x.purchase_item_id] = {
        purchaseItemId: x.purchase_item_id, requestId: x.request_id, itemId: x.item_id, ordered: x.ordered, received: x.received,
        poNumber: x.po_number ?? null, poStatus: x.po_status || '', expectedDate: x.expected_date || null, vendor: x.vendor ?? null, rate: x.rate == null ? null : Number(x.rate),
        marketplace: tracking?.marketplace || null, marketplaceOrderNumber: tracking?.marketplace_order_number || null, trackingStatus: tracking?.status || null, trackingSubStatus: tracking?.sub_status || null,
        trackingLocation: latest?.location || '', trackingAt: latest?.checkpoint_time || tracking?.last_event_at || null, trackingUrl: tracking?.tracking_url || null,
      }; });
      setOrders(out);
    }
    if (!cat.error) setCatalogue((cat.data || []).map((c: any) => ({ id: c.id, name: c.name, unit: c.unit, category: c.category })));
    setLoading(false); setReady(true);
  }, [uid, walkieDepartments]);

  // Reload at most once a moment, however many live events arrive.
  const soon = useCallback(() => { clearTimeout(timer.current); timer.current = setTimeout(load, 400); }, [load]);

  useEffect(() => {
    if (!uid) { setRequests([]); setOrders({}); setCatalogue([]); setReady(false); return; }
    load();
    const ch = supabase.channel(`requests-${uid}`);
      ['requests', 'request_items', 'request_fulfilments', 'request_events', 'purchase_items', 'purchase_orders', 'purchase_trackings'].forEach(t =>
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

  const me = useMemo(() => ({ id: uid || '', level, team, departmentId, isOwner, isExec }), [uid, level, team, departmentId, isOwner, isExec]);

  const canReviewSub = useCallback((r: Req) => r.status === 'pending_sub' && (isOwner || (level === 'sub_dept_head' && team === r.subDepartment)), [isOwner, level, team]);
  const canReviewIt = useCallback((r: Req) => r.status === 'pending_it' && level === 'dept_head', [level]);
  const canOwnerReview = useCallback((r: Req) => isOwner && r.status === 'pending_owner', [isOwner]);
  const canCancel = useCallback((r: Req) => r.requesterId === uid && ['pending_sub', 'pending_it', 'pending_owner'].includes(r.status), [uid]);
  const canArrange = useCallback((kind: 'item' | 'radio') => isExec || (kind === 'item' ? team === 'inventory' : team === 'walkie'), [isExec, team]);
  const canDecideArrangement = isExec;
  const canOrder = isExec || team === 'purchase';
  const canConfirm = useCallback((r: Req) => r.status === 'fulfilled' && !r.confirmedAt && (r.requesterId === uid || isExec), [uid, isExec]);

  // Requests that are waiting for THIS person's decision.
  const waitingForMe = useMemo(() => requests.filter(r =>
    (isOwner && r.status === 'pending_owner') ||
    (level === 'dept_head' && r.status === 'pending_it') ||
    (level === 'sub_dept_head' && r.status === 'pending_sub' && team === r.subDepartment)), [requests, isOwner, level, team, departmentId]);
  // Department Admin decides the source for every approved quantity. Purchase allocations
  // leave this queue and appear in the shared Procurement buy list instead.
  const toArrange = useMemo(() => canDecideArrangement ? requests.filter(r => r.status === 'approved' && r.items.some(i => (i.approved ?? 0) > 0 &&
    lineRemainingToAllocate(r, i) > 0)) : [], [requests, canDecideArrangement]);
  const actionCount = waitingForMe.length + toArrange.length;

  const submit = useCallback(async (i: NewRequest) => {
    const { data, error } = await supabase.rpc('request_submit', {
      p_title: i.title, p_purpose: i.purpose, p_needed_by: i.neededBy || null, p_priority: i.priority, p_deliver_to: i.deliverTo, p_department_id: i.departmentId || null,
      p_items: i.lines.map(l => ({ name: l.name, unit: l.unit, qty: l.qty, kind: l.kind, note: l.note, reason: l.reason, inventory_item_id: l.inventoryItemId, return_required: l.returnRequired })),
    });
    if (error) return { id: null, error: dbMessage(error) };
    await load();
    return { id: data as string, error: null };
  }, [load]);
  const subReview = useCallback((id: string, approve: boolean, note: string) => run(() => supabase.rpc('request_sub_review', { p_id: id, p_approve: approve, p_note: note })), [run]);
  const itDecide = useCallback(async (id: string, action: 'approve' | 'escalate' | 'reject', note: string, miscItems: string, miscBudget: number, lines: { id: string; approvedQty: number; cutReason: string; budgetRate: number | null; arrangementConfirmed: boolean; plan: PlanPart[] }[]) => {
    const decisionError = await run(() => supabase.rpc('request_it_decide', { p_id: id, p_action: action, p_note: note, p_lines: lines.map((l, index) => ({ id: l.id, approved_qty: l.approvedQty, cut_reason: l.cutReason, budget_rate: l.budgetRate, arrangement_confirmed: l.arrangementConfirmed, misc_items: index === 0 ? miscItems : undefined, misc_budget: index === 0 ? miscBudget : undefined, plan: l.plan.map(p => ({ source: p.source, qty: p.qty, inventory_item_id: p.inventoryItemId })) })) }));
    if (decisionError || action !== 'escalate') return decisionError;
    const { data, error } = await supabase.functions.invoke('workflow-email', { body: { kind: 'request_escalated', request_id: id } });
    if (error || data?.warning) return `Request escalated in the app, but its email could not be sent. ${error?.message || data?.warning || 'Check the email setup.'}`;
    if (data?.warning) return `Request escalated in the app, but its email could not be sent. ${data.warning}`;
    return null;
  }, [run]);
  const assignDelivery = useCallback(async (id: string, delivery: { team: string; memberId: string }) => {
    return run(() => supabase.rpc('request_set_delivery_assignment', { p_id: id, p_team: delivery.team || null, p_member: delivery.memberId || null }));
  }, [run]);
  const ownerReview = useCallback((id: string, action: 'approve' | 'send_back' | 'reject') =>
    run(() => supabase.rpc('request_owner_decide', { p_id: id, p_action: action })), [run]);
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
  const returnPart = useCallback((partId: string, qty: number, note: string) =>
    run(() => supabase.rpc('request_return_part', { p_fulfilment: partId, p_qty: qty, p_note: note })), [run]);
  const confirmReceipt = useCallback((id: string) => run(() => supabase.rpc('request_confirm_receipt', { p_id: id })), [run]);
  const loadAvailability = useCallback(async () => {
    const { data } = await supabase.rpc('inventory_available');
    const out: Record<string, Availability> = {};
    (data || []).forEach((x: any) => { out[x.item_id] = { inStock: x.in_stock, reserved: x.reserved, available: x.available }; });
    return out;
  }, []);

  const value = useMemo<Ctx>(() => ({
    requests, loading, loadError, ready, me, orders, catalogue, canReviewSub, canReviewIt, canOwnerReview, canCancel, canArrange, canDecideArrangement, canOrder, canConfirm,
    waitingForMe, toArrange, actionCount, submit, subReview, itDecide, ownerReview, assignDelivery, cancel, planLine, createPO, deliver, returnPart, confirmReceipt, loadAvailability, refresh: load,
  }), [requests, loading, loadError, ready, me, orders, catalogue, canReviewSub, canReviewIt, canOwnerReview, canCancel, canArrange, canDecideArrangement, canOrder, canConfirm, waitingForMe, toArrange, actionCount,
    submit, subReview, itDecide, ownerReview, assignDelivery, cancel, planLine, createPO, deliver, returnPart, confirmReceipt, loadAvailability, load]);
  return <C.Provider value={value}>{children}</C.Provider>;
};

export const useRequests = (): Ctx => {
  const v = useContext(C);
  if (!v) throw new Error('useRequests must be used inside RequestsProvider');
  return v;
};
