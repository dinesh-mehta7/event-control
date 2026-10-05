import type { SubDepartmentId } from '../../types';

export type ReqStatus = 'pending_sub' | 'pending_it' | 'pending_owner' | 'approved' | 'fulfilled' | 'rejected' | 'cancelled';
export type LineKind = 'item' | 'radio';
export type PartSource = 'inventory' | 'purchase' | 'walkie';

export interface ReqItem {
  id: string; requestId: string; position: number; kind: LineKind; name: string; unit: string;
  requested: number; approved: number | null; note: string;
  reason: string;               // why the requester needs this line
  cutReason: string;            // why the owner approved less (or none)
  inventoryItemId: string | null; // the catalogue item it was picked from
}
export interface ReqPart {
  id: string; requestId: string; itemId: string; source: PartSource; qty: number;
  inventoryItemId: string | null; purchaseItemId: string | null; status: 'planned' | 'done';
  location: string; receivedBy: string; note: string; doneBy: string; doneAt: string;
}
export interface ReqEvent { id: string; requestId: string; at: string; by: string; kind: string; text: string }
export interface Req {
  id: string; number: string; requesterId: string; requesterName: string; subDepartment: SubDepartmentId | null;
  title: string; purpose: string; deliverTo: string; neededBy: string; priority: 'normal' | 'urgent';
  status: ReqStatus; subNote: string; itNote: string; ownerNote: string; createdAt: string; updatedAt: string;
  showVendor: boolean; showRate: boolean;            // the owner decides whether the requester sees these
  confirmedAt: string | null; confirmedBy: string;   // the requester confirmed receipt: the ticket is closed
  items: ReqItem[]; parts: ReqPart[]; events: ReqEvent[];
}
// Progress of a part that is being bought. vendor / rate / poNumber are null when this person may not see them.
export interface OrderInfo {
  purchaseItemId: string; requestId: string; itemId: string; received: number; ordered: number;
  poNumber: string | null; poStatus: string; expectedDate: string | null; vendor: string | null; rate: number | null;
}

export interface NewLine { kind: LineKind; name: string; unit: string; qty: number; reason: string; note: string; inventoryItemId: string | null }
export interface CatalogueItem { id: string; name: string; unit: string; category: string }
export interface NewRequest { title: string; purpose: string; deliverTo: string; neededBy: string; priority: 'normal' | 'urgent'; lines: NewLine[] }
export interface PlanPart { source: PartSource; qty: number; inventoryItemId: string | null }

export const STATUS_LABEL: Record<ReqStatus, string> = {
  pending_sub: 'With branch head', pending_it: 'With IT owner', pending_owner: 'With organization owner', approved: 'Approved · being arranged',
  fulfilled: 'Delivered', rejected: 'Rejected', cancelled: 'Cancelled',
};
export const STATUS_TONE: Record<ReqStatus, string> = {
  pending_sub: 'bg-amber-500/15 text-amber-300', pending_it: 'bg-amber-500/15 text-amber-300', pending_owner: 'bg-amber-500/15 text-amber-300',
  approved: 'bg-blue-500/15 text-blue-300', fulfilled: 'bg-emerald-500/15 text-emerald-300',
  rejected: 'bg-red-500/15 text-red-300', cancelled: 'bg-raised text-mute',
};
export const SOURCE_LABEL: Record<PartSource, string> = { inventory: 'From stock', purchase: 'To be purchased', walkie: 'Radio pool' };

// Steps shown in the stepper at the top of a request.
export const STEPS = ['Requested', 'Branch head', 'IT owner', 'Org owner', 'Arranged', 'Delivered', 'Received'];
export const stepOf = (r: Req): number => {
  if (r.status === 'pending_sub') return 1;
  if (r.status === 'pending_it') return 2;
  if (r.status === 'pending_owner') return 3;
  if (r.status === 'approved') {
    const approvedLines = r.items.filter(i => (i.approved ?? 0) > 0);
    const planned = approvedLines.every(i => r.parts.filter(p => p.itemId === i.id).reduce((t, p) => t + p.qty, 0) >= (i.approved ?? 0));
    return planned ? 5 : 4;
  }
  if (r.status === 'fulfilled') return r.confirmedAt ? 6 : 5;
  return 0;
};

// Plain-language status of one approved line, for the ticket. No vendor, no price, no stock.
export const lineStatus = (r: Req, i: ReqItem, orders: Record<string, OrderInfo>): { text: string; tone: 'ok' | 'warn' | 'mute' | 'bad' } => {
  if (r.status === 'rejected' || (r.status === 'cancelled')) return { text: r.status === 'rejected' ? 'Rejected' : 'Cancelled', tone: 'bad' };
  if (r.status === 'pending_sub' || r.status === 'pending_it' || r.status === 'pending_owner') return { text: ({ pending_sub: 'With branch head', pending_it: 'With IT owner', pending_owner: 'With organization owner' } as const)[r.status], tone: 'warn' };
  const ap = i.approved ?? 0;
  if (ap === 0) return { text: 'Not approved', tone: 'bad' };
  const parts = r.parts.filter(p => p.itemId === i.id);
  const done = parts.filter(p => p.status === 'done').reduce((t, p) => t + p.qty, 0);
  if (done >= ap) { const last = parts.filter(p => p.status === 'done').sort((a, b) => a.doneAt.localeCompare(b.doneAt)).pop(); return { text: `Delivered${last ? ` to ${last.receivedBy || last.location}` : ''}`, tone: 'ok' }; }
  const planned = parts.reduce((t, p) => t + p.qty, 0);
  if (planned < ap) return { text: 'Being arranged', tone: 'mute' };
  const buying = parts.filter(p => p.source === 'purchase' && p.status === 'planned');
  const waiting = buying.filter(p => { const o = p.purchaseItemId ? orders[p.purchaseItemId] : undefined; return !o || o.received < p.qty; });
  const bits: string[] = [];
  if (done > 0) bits.push(`${done} delivered`);
  if (waiting.length) {
    // Show the earliest stage among the parts that are still on their way.
    const stage = (p: typeof waiting[number]) => {
      const o = p.purchaseItemId ? orders[p.purchaseItemId] : undefined;
      if (!o) return 0;
      return ({ draft: 1, rejected: 1, pending: 2, approved: 3, ordered: 4, partial: 4 } as Record<string, number>)[o.poStatus] ?? 1;
    };
    const first = waiting.reduce((m, p) => (stage(p) < stage(m) ? p : m), waiting[0]);
    const o = first.purchaseItemId ? orders[first.purchaseItemId] : undefined;
    const exp = waiting.map(p => (p.purchaseItemId ? orders[p.purchaseItemId]?.expectedDate : null)).filter(Boolean).sort()[0];
    bits.push(['To be purchased', 'Order being prepared', 'Order waiting for approval', 'Order approved', `Ordered${exp ? `, expected ${fmtDate(exp)}` : ''}`][stage(first)] + (o && o.poStatus === 'partial' ? ` (${o.received} of ${o.ordered} arrived)` : ''));
  }
  const ready = parts.filter(p => p.status === 'planned' && !waiting.includes(p)).reduce((t, p) => t + p.qty, 0);
  if (ready > 0) bits.push(`${ready} ready in store`);
  return { text: bits.join(' · ') || 'Being arranged', tone: waiting.length ? 'warn' : 'mute' };
};
export const isOverdue = (r: Req) => !!r.neededBy && r.status === 'approved' && r.neededBy < new Date().toISOString().slice(0, 10);
export const lineDone = (r: Req, i: ReqItem) => r.parts.filter(p => p.itemId === i.id && p.status === 'done').reduce((t, p) => t + p.qty, 0);
export const linePlanned = (r: Req, i: ReqItem) => r.parts.filter(p => p.itemId === i.id).reduce((t, p) => t + p.qty, 0);
export const fmtDate = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
export const fmtDateTime = (iso?: string | null) => iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
