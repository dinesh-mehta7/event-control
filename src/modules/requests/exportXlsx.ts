import * as XLSX from 'xlsx-js-style';
import { DEPTS } from '../../views/orgData';
import { STATUS_LABEL } from './types';
import type { Availability } from './RequestsContext';
import type { OrderInfo, Req } from './types';

const d = (iso?: string | null) => (iso ? iso.slice(0, 10) : '');
// Same wording as the status badge: a delivered ticket the requester confirmed is "Closed".
const statusOf = (r: Req) => (r.status === 'fulfilled' && r.confirmedAt ? 'Closed' : STATUS_LABEL[r.status]);
const dept = (r: Req) => r.departmentName || (r.subDepartment ? DEPTS[r.subDepartment] : 'Other department');

// Sheet 1: one row per requested line, across the given tickets.
const demandRows = (reqs: Req[]) =>
  reqs.flatMap(r =>
    r.items.map(i => ({
      Ticket: r.number,
      Status: statusOf(r),
      'Requesting department': r.fromDepartmentName || '—',
      'Requested by': r.requesterName,
      Item: i.name,
      Unit: i.unit,
      Requested: i.requested,
      Approved: r.status === 'approved' || r.status === 'fulfilled' ? (i.approved ?? 0) : '',
      'Requester choice': i.returnRequired ? 'Return after use' : 'Purchase / keep',
      'From inventory': r.parts
        .filter(p => p.itemId === i.id && p.source === 'inventory')
        .reduce((sum, p) => sum + p.qty, 0),
      'To purchase': r.parts
        .filter(p => p.itemId === i.id && p.source === 'purchase')
        .reduce((sum, p) => sum + p.qty, 0),
      'Item budget': i.budgetRate ?? '',
      'Line budget':
        i.budgetAmount != null && (r.status === 'approved' || r.status === 'fulfilled') ? i.budgetAmount : '',
      'Miscellaneous items': i.position === 1 ? r.miscItems : '',
      'Miscellaneous addition': i.position === 1 ? r.miscBudget : '',
      'Reason (requester)': i.reason,
      'Reason for cut (owner)': i.cutReason,
      'Deliver to': r.deliverTo,
      'Needed by': d(r.neededBy),
      Urgent: r.priority === 'urgent' ? 'Yes' : '',
      'Raised on': d(r.createdAt),
    })),
  );

const DEMAND_COLUMNS = [
  'Ticket',
  'Status',
  'Requesting department',
  'Requested by',
  'Item',
  'Unit',
  'Requested',
  'Approved',
  'Requester choice',
  'From inventory',
  'To purchase',
  'Item budget',
  'Line budget',
  'Miscellaneous items',
  'Miscellaneous addition',
  'Reason (requester)',
  'Reason for cut (owner)',
  'Deliver to',
  'Needed by',
  'Urgent',
  'Raised on',
  'Handed on',
  'Price',
];
const departmentRows = (
  reqs: Req[],
  orders: Record<string, OrderInfo>,
  isSuperAdmin: boolean,
  includeFulfilment = true,
) => {
  const columns = includeFulfilment ? DEMAND_COLUMNS : DEMAND_COLUMNS.slice(0, -2);
  const groups = new Map<string, Req[]>();
  reqs.forEach(r => {
    const label = isSuperAdmin ? dept(r) : r.fromDepartmentName || '—';
    groups.set(label, [...(groups.get(label) || []), r]);
  });
  const rows: (string | number)[][] = [];
  const merges: XLSX.Range[] = [];
  const columnHeadingRows: number[] = [];
  const departments = Array.from(groups.keys()).sort((a, b) => a.localeCompare(b));
  departments.forEach((name, groupIndex) => {
    const items = groups.get(name) || [];
    if (groupIndex) rows.push([]);
    const headingRow = rows.length;
    rows.push([
      isSuperAdmin
        ? `Request To: ${name} — ${items.length} request${items.length === 1 ? '' : 's'}`
        : `Requesting department: ${name} — ${items.length} request${items.length === 1 ? '' : 's'}`,
    ]);
    merges.push({ s: { r: headingRow, c: 0 }, e: { r: headingRow, c: columns.length - 1 } });
    columnHeadingRows.push(rows.length);
    rows.push(columns);
    items.forEach(r => {
      const lineRows = demandRows([r]);
      if (lineRows.length)
        lineRows.forEach((line, lineIndex) => {
          const item = r.items[lineIndex];
          const partRates = r.parts
            .filter(p => p.itemId === item?.id && p.purchaseItemId)
            .map(p => orders[p.purchaseItemId!]?.rate)
            .filter((rate): rate is number => rate != null);
          const values: Record<string, string | number> = {
            ...(line as Record<string, string | number>),
            Price: partRates.length ? partRates[0] : (item?.budgetRate ?? ''),
            'Handed on': Array.from(
              new Set(r.parts.filter(p => p.itemId === item?.id && p.status === 'done').map(p => d(p.doneAt))),
            )
              .filter(Boolean)
              .join(', '),
          };
          rows.push(columns.map(column => values[column] ?? ''));
        });
      else {
        const noItem: Record<string, string | number> = {
          Ticket: r.number,
          Status: statusOf(r),
          'Requesting department': r.fromDepartmentName || '—',
          'Requested by': r.requesterName,
          Item: '(no line items)',
          'Deliver to': r.deliverTo,
          'Needed by': d(r.neededBy),
          Urgent: r.priority === 'urgent' ? 'Yes' : '',
          'Raised on': d(r.createdAt),
          'Handed on': Array.from(new Set(r.parts.filter(p => p.status === 'done').map(p => d(p.doneAt))))
            .filter(Boolean)
            .join(', '),
        };
        rows.push(columns.map(column => noItem[column] ?? ''));
      }
    });
  });
  const ws = XLSX.utils.aoa_to_sheet(rows.length ? rows : [['No requests in this list.']]);
  // Match the supplied "By department" workbook: compact ID/status columns,
  // wider descriptive fields, and blue section/header bands.
  ws['!cols'] = [
    8.57, 9, 26.57, 16.29, 7.43, 5.43, 13, 11.71, 20.57, 18.29, 14.29, 14.57, 14, 24.43, 27.57, 22.86, 27, 11.86, 13,
    8.43, 11.57, 12.86, 6.29,
  ]
    .slice(0, columns.length)
    .map(w => ({ wch: w }));
  ws['!merges'] = merges;
  ws['!rows'] = rows.map((_, index) => {
    if (merges.some(({ s }) => s.r === index)) return { hpt: 21 };
    if (columnHeadingRows.includes(index)) return { hpt: 18.75 };
    return undefined;
  });
  merges.forEach(({ s }) => {
    const heading = ws[XLSX.utils.encode_cell(s)];
    if (heading) {
      heading.s = {
        fill: { patternType: 'solid', fgColor: { rgb: 'FF558ED5' } },
        font: { bold: true, color: { rgb: 'FF191919' }, sz: 12 },
        alignment: { horizontal: 'center', vertical: 'center' },
      };
    }
  });
  columnHeadingRows.forEach(row => {
    columns.forEach((_, column) => {
      const cell = ws[XLSX.utils.encode_cell({ r: row, c: column })];
      if (cell)
        cell.s = {
          ...(cell.s || {}),
          fill: { patternType: 'solid', fgColor: { rgb: 'FF8EB4E3' } },
          font: { ...(cell.s?.font || {}), bold: true },
        };
    });
  });
  return ws;
};

// Sheet 2: what has to be BOUGHT, added up per item across tickets. Purchase fills the empty columns.
const purchaseRows = (reqs: Req[], orders: Record<string, OrderInfo>, avail: Record<string, Availability>) => {
  const map = new Map<
    string,
    {
      item: string;
      unit: string;
      qty: number;
      tickets: Set<string>;
      inv: string | null;
      pos: Set<string>;
      vendors: Set<string>;
      status: Set<string>;
      expected: Set<string>;
      rate: number | null;
    }
  >();
  reqs
    .filter(r => r.status === 'approved')
    .forEach(r =>
      r.parts
        .filter(p => p.source === 'purchase' && p.status === 'planned')
        .forEach(p => {
          const it = r.items.find(i => i.id === p.itemId);
          if (!it) return;
          const key = p.inventoryItemId || it.inventoryItemId || it.name.trim().toLowerCase();
          const row = map.get(key) || {
            item: it.name,
            unit: it.unit,
            qty: 0,
            tickets: new Set<string>(),
            inv: p.inventoryItemId || it.inventoryItemId,
            pos: new Set<string>(),
            vendors: new Set<string>(),
            status: new Set<string>(),
            expected: new Set<string>(),
            rate: null,
          };
          row.qty += p.qty;
          row.tickets.add(r.number);
          const o = p.purchaseItemId ? orders[p.purchaseItemId] : undefined;
          if (o) {
            if (o.poNumber) row.pos.add(o.poNumber);
            if (o.vendor) row.vendors.add(o.vendor);
            row.status.add(
              o.received >= o.ordered ? 'Received' : o.received > 0 ? 'Partly received' : o.poStatus || 'Ordered',
            );
            if (o.expectedDate) row.expected.add(d(o.expectedDate));
            if (o.rate) row.rate = o.rate;
          } else row.status.add('To order');
          map.set(key, row);
        }),
    );
  return Array.from(map.values())
    .sort((a, b) => a.item.localeCompare(b.item))
    .map(x => {
      const stock = x.inv && avail[x.inv] ? avail[x.inv] : null;
      return {
        Item: x.item,
        Unit: x.unit,
        'To buy': x.qty,
        'In stock now': stock ? stock.inStock : '',
        Tickets: Array.from(x.tickets).join(', '),
        Vendor: Array.from(x.vendors).join(', '),
        'PO no.': Array.from(x.pos).join(', '),
        'Rate (each)': x.rate ?? '',
        'Order status': Array.from(x.status).join(', '),
        'Expected date': Array.from(x.expected).join(', '),
      };
    });
};

const sheet = (rows: object[], widths: number[], empty: string) => {
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Note: empty }]);
  ws['!cols'] = widths.map(w => ({ wch: w }));
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  for (let column = range.s.c; column <= range.e.c; column += 1) {
    const cell = ws[XLSX.utils.encode_cell({ r: range.s.r, c: column })];
    if (cell) cell.s = { ...(cell.s || {}), font: { ...(cell.s?.font || {}), bold: true } };
  }
  return ws;
};

export const exportRequestsXlsx = (
  reqs: Req[],
  orders: Record<string, OrderInfo>,
  avail: Record<string, Availability>,
  fileName: string,
  view: 'department' | 'demands' | 'purchase' | 'all' = 'department',
  isSuperAdmin = false,
) => {
  const wb = XLSX.utils.book_new();
  if (view === 'department' || view === 'all')
    XLSX.utils.book_append_sheet(wb, departmentRows(reqs, orders, isSuperAdmin), 'By department');
  if (view === 'demands' || view === 'all')
    XLSX.utils.book_append_sheet(wb, departmentRows(reqs, orders, isSuperAdmin, false), 'Demands');
  if (view === 'purchase' || view === 'all')
    XLSX.utils.book_append_sheet(
      wb,
      sheet(
        purchaseRows(reqs, orders, avail),
        [30, 8, 8, 12, 28, 22, 16, 12, 18, 14],
        'Nothing to purchase right now.',
      ),
      'To purchase',
    );
  XLSX.writeFile(wb, `${fileName}-${new Date().toISOString().slice(0, 10)}.xlsx`);
};
