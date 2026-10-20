import { supabase } from '../walkie/lib/supabaseClient';
import type { ReqEvent, ReqItem, ReqPart } from './types';

// Requests: requester -> IT Department Head (approve with budget or escalate) -> fulfilment -> requester confirms.
// Everything is read through Row Level Security and changed only through database functions (migrations v16–v44).

export const mapItem = (r: any): ReqItem => ({
  id: r.id,
  requestId: r.request_id,
  position: r.position,
  kind: r.kind,
  name: r.name,
  unit: r.unit,
  requested: r.qty_requested,
  approved: r.qty_approved ?? null,
  budgetRate: r.budget_rate == null ? null : Number(r.budget_rate),
  budgetAmount: r.approved_budget == null ? null : Number(r.approved_budget),
  reviewPlan: Array.isArray(r.review_plan)
    ? r.review_plan.map((p: any) => ({
        source: p.source,
        qty: Number(p.qty),
        inventoryItemId: p.inventory_item_id || null,
      }))
    : [],
  returnRequired: !!r.return_required,
  note: r.note || '',
  reason: r.reason || '',
  cutReason: r.cut_reason || '',
  inventoryItemId: r.inventory_item_id || null,
});

export const mapPart = (r: any): ReqPart => ({
  id: r.id,
  requestId: r.request_id,
  itemId: r.item_id,
  source: r.source,
  qty: r.qty,
  returnedQty: r.returned_qty || 0,
  inventoryItemId: r.inventory_item_id || null,
  purchaseItemId: r.purchase_item_id || null,
  status: r.status,
  location: r.location_name || '',
  receivedBy: r.received_by || '',
  note: r.note || '',
  doneBy: r.done_by || '',
  doneAt: r.done_at || '',
});

export const mapEvent = (r: any): ReqEvent => ({
  id: r.id,
  requestId: r.request_id,
  at: r.at,
  by: r.actor_name || '',
  kind: r.kind,
  // Render historical activity using the current role names without rewriting audit records.
  text: (r.text || '')
    .replace(/organization owner/gi, 'Super Admin')
    .replace(/IT owner/gi, 'Department Admin')
    .replace(/branch head/gi, 'Sub Admin'),
});

export const fetchAll = async (table: string, sortColumn: string, ascending: boolean) => {
  const rows: any[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await (supabase as any)
      .from(table)
      .select('*')
      .order(sortColumn, { ascending })
      .range(offset, offset + pageSize - 1);
    if (error) return { data: null, error };
    const page = data || [];
    rows.push(...page);
    if (page.length < pageSize) return { data: rows, error: null };
  }
};

export const dbMessage = (e: any): string => {
  const m: string = e?.message || 'Something went wrong.';
  if (/could not find the function|schema cache|does not exist/i.test(m))
    return 'Requests are not fully set up yet. Run the pending Supabase migrations through v49 in order.';
  if (/row-level security|permission denied/i.test(m)) return "You don't have permission to do that.";
  return m;
};
