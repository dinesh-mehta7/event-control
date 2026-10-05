import * as XLSX from 'xlsx';
import { DEPTS } from '../../pages/orgData';
import { STATUS_LABEL } from './types';
import type { Availability } from './RequestsContext';
import type { OrderInfo, Req } from './types';

const d = (iso?: string | null) => (iso ? iso.slice(0, 10) : '');
const dept = (r: Req) => (r.subDepartment ? DEPTS[r.subDepartment] : 'Other department');

// Sheet 1: one row per requested line, across the given tickets.
const demandRows = (reqs: Req[]) => reqs.flatMap(r => r.items.map(i => ({
  Ticket: r.number, Status: STATUS_LABEL[r.status], Department: dept(r), 'Requested by': r.requesterName,
  Item: i.name, Unit: i.unit, Requested: i.requested, Approved: r.status === 'approved' || r.status === 'fulfilled' ? (i.approved ?? 0) : '',
  'Reason (requester)': i.reason, 'Reason for cut (owner)': i.cutReason, 'Deliver to': r.deliverTo, 'Needed by': d(r.neededBy),
  Urgent: r.priority === 'urgent' ? 'Yes' : '', 'Raised on': d(r.createdAt),
})));

const DEMAND_COLUMNS = ['Ticket', 'Status', 'Department', 'Requested by', 'Item', 'Unit', 'Requested', 'Approved', 'Reason (requester)', 'Reason for cut (owner)', 'Deliver to', 'Needed by', 'Urgent', 'Raised on'];
const departmentRows = (reqs: Req[]) => {
  const groups = new Map<string, Req[]>();
  reqs.forEach(r => { const label = dept(r); groups.set(label, [...(groups.get(label) || []), r]); });
  const rows: (string | number)[][] = [];
  const merges: XLSX.Range[] = [];
  const departments = Array.from(groups.keys()).sort((a, b) => a.localeCompare(b));
  departments.forEach((name, groupIndex) => {
    const items = groups.get(name) || [];
    if (groupIndex) rows.push([]);
    const headingRow = rows.length;
    rows.push([`${name} — ${items.length} request${items.length === 1 ? '' : 's'}`]);
    merges.push({ s: { r: headingRow, c: 0 }, e: { r: headingRow, c: DEMAND_COLUMNS.length - 1 } });
    rows.push(DEMAND_COLUMNS);
    items.forEach(r => {
      const lineRows = demandRows([r]);
      if (lineRows.length) lineRows.forEach(line => rows.push(DEMAND_COLUMNS.map(column => (line as Record<string, string | number>)[column] ?? '')));
      else rows.push([r.number, STATUS_LABEL[r.status], name, r.requesterName, '(no line items)', '', '', '', '', '', r.deliverTo, d(r.neededBy), r.priority === 'urgent' ? 'Yes' : '', d(r.createdAt)]);
    });
  });
  const ws = XLSX.utils.aoa_to_sheet(rows.length ? rows : [['No requests in this list.']]);
  ws['!cols'] = [11, 26, 20, 22, 30, 8, 10, 10, 36, 30, 20, 12, 7, 12].map(w => ({ wch: w }));
  ws['!merges'] = merges;
  return ws;
};

// Sheet 2: what has to be BOUGHT, added up per item across tickets. Purchase fills the empty columns.
const purchaseRows = (reqs: Req[], orders: Record<string, OrderInfo>, avail: Record<string, Availability>) => {
  const map = new Map<string, { item: string; unit: string; qty: number; tickets: Set<string>; inv: string | null; pos: Set<string>; vendors: Set<string>; status: Set<string>; expected: Set<string>; rate: number | null }>();
  reqs.filter(r => r.status === 'approved').forEach(r => r.parts.filter(p => p.source === 'purchase' && p.status === 'planned').forEach(p => {
    const it = r.items.find(i => i.id === p.itemId); if (!it) return;
    const key = p.inventoryItemId || it.inventoryItemId || it.name.trim().toLowerCase();
    const row = map.get(key) || { item: it.name, unit: it.unit, qty: 0, tickets: new Set<string>(), inv: p.inventoryItemId || it.inventoryItemId, pos: new Set<string>(), vendors: new Set<string>(), status: new Set<string>(), expected: new Set<string>(), rate: null };
    row.qty += p.qty; row.tickets.add(r.number);
    const o = p.purchaseItemId ? orders[p.purchaseItemId] : undefined;
    if (o) { if (o.poNumber) row.pos.add(o.poNumber); if (o.vendor) row.vendors.add(o.vendor); row.status.add(o.received >= o.ordered ? 'Received' : o.received > 0 ? 'Partly received' : (o.poStatus || 'Ordered')); if (o.expectedDate) row.expected.add(d(o.expectedDate)); if (o.rate) row.rate = o.rate; }
    else row.status.add('To order');
    map.set(key, row);
  }));
  return Array.from(map.values()).sort((a, b) => a.item.localeCompare(b.item)).map(x => {
    const stock = x.inv && avail[x.inv] ? avail[x.inv] : null;
    return {
      Item: x.item, Unit: x.unit, 'To buy': x.qty, 'In stock now': stock ? stock.inStock : '', 'Tickets': Array.from(x.tickets).join(', '),
      Vendor: Array.from(x.vendors).join(', '), 'PO no.': Array.from(x.pos).join(', '), 'Rate (each)': x.rate ?? '',
      'Order status': Array.from(x.status).join(', '), 'Expected date': Array.from(x.expected).join(', '),
    };
  });
};

const sheet = (rows: object[], widths: number[], empty: string) => {
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Note: empty }]);
  ws['!cols'] = widths.map(w => ({ wch: w })); return ws;
};

export const exportRequestsXlsx = (reqs: Req[], orders: Record<string, OrderInfo>, avail: Record<string, Availability>, fileName: string) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, departmentRows(reqs), 'By department');
  XLSX.utils.book_append_sheet(wb, sheet(demandRows(reqs), [11, 14, 20, 20, 30, 8, 10, 10, 36, 30, 20, 12, 7, 12], 'No requests in this list.'), 'Demands');
  XLSX.utils.book_append_sheet(wb, sheet(purchaseRows(reqs, orders, avail), [30, 8, 8, 12, 28, 22, 16, 12, 18, 14], 'Nothing to purchase right now.'), 'To purchase');
  XLSX.writeFile(wb, `${fileName}-${new Date().toISOString().slice(0, 10)}.xlsx`);
};
