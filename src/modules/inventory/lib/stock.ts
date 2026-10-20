import type { Holding, Item, MoveType, Movement } from '../types';

// ---- stock state -------------------------------------------------------------
export type Stage = 'all' | 'low' | 'out' | 'issued' | 'damaged';
export type Level = 'out' | 'low' | 'ok';

export const levelOf = (i: Item): Level =>
  i.inStock === 0 ? 'out' : i.minLevel > 0 && i.inStock <= i.minLevel ? 'low' : 'ok';

export const inStage = (i: Item, s: Stage) =>
  s === 'low'
    ? levelOf(i) === 'low'
    : s === 'out'
      ? i.inStock === 0
      : s === 'issued'
        ? i.issued > 0
        : s === 'damaged'
          ? i.damaged > 0
          : true;

// How a movement changes the three counters: in store (s), issued (i), damaged (d).
export const stockDelta = (type: MoveType, n: number) => {
  switch (type) {
    case 'receive':
      return { s: n, i: 0, d: 0 };
    case 'issue':
      return { s: -n, i: n, d: 0 };
    case 'return':
      return { s: n, i: -n, d: 0 };
    case 'return_damaged':
      return { s: 0, i: -n, d: n };
    case 'damage':
      return { s: -n, i: 0, d: n };
    case 'repair':
      return { s: n, i: 0, d: -n };
    case 'write_off':
      return { s: 0, i: 0, d: -n };
    default:
      return { s: n, i: 0, d: 0 };
  }
};

// ---- formatting ----------------------------------------------------------------
export const when = (s: string) =>
  new Date(s).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export const signedQty = (r: Movement) => (r.type === 'adjust' && r.qty > 0 ? `+${r.qty}` : `${r.qty}`);

// Who was involved in a movement, as one readable line.
export const peopleLine = (r: Movement) =>
  [
    r.givenBy && `${r.type === 'receive' ? 'From' : 'Given by'} ${r.givenBy}`,
    r.returnedBy && `Returned by ${r.returnedBy}`,
    r.receivedBy && `Received by ${r.receivedBy}`,
    r.ref && `Ref ${r.ref}`,
    r.note,
  ]
    .filter(Boolean)
    .join(' · ');

// Total units and distinct items held at each location, largest first.
export const totalsByLocation = (holdings: Holding[]) => {
  const m = new Map<string, { qty: number; kinds: number }>();
  holdings
    .filter(h => h.qty > 0)
    .forEach(h => {
      const c = m.get(h.location) || { qty: 0, kinds: 0 };
      c.qty += h.qty;
      c.kinds += 1;
      m.set(h.location, c);
    });
  return Array.from(m.entries()).sort((a, b) => b[1].qty - a[1].qty);
};

// ---- export ----------------------------------------------------------------------
export const exportItemsCsv = (
  rows: Item[],
  holdingsOf: (id: string) => Holding[],
  locationLabel: (id: string) => string,
) => {
  const head = [
    'Item',
    'Code',
    'Category',
    'Stored at',
    'Unit',
    'In store',
    'Min level',
    'Issued',
    'Damaged',
    'Issued at (location)',
  ];
  const body = rows.map(i => [
    i.name,
    i.code,
    i.category,
    i.location,
    i.unit,
    i.inStock,
    i.minLevel,
    i.issued,
    i.damaged,
    holdingsOf(i.id)
      .map(h => `${locationLabel(h.location)}: ${h.qty}`)
      .join('; '),
  ]);
  const csv = [head, ...body].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `inventory_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
};
