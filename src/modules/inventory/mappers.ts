import type { Holding, Item, Movement } from './types';
export { collator } from '../../lib/ids';
import { collator } from '../../lib/ids';
export { uid } from '../../lib/ids';

export const mapItem = (r: any): Item => ({
  id: r.id,
  name: r.name,
  code: r.code || '',
  category: r.category || 'General',
  unit: r.unit || 'pcs',
  location: r.location || '',
  minLevel: r.min_level || 0,
  inStock: r.in_stock || 0,
  issued: r.issued || 0,
  damaged: r.damaged || 0,
});

export const mapHolding = (r: any): Holding => ({ itemId: r.item_id, location: r.location, qty: r.qty });

export const mapMove = (r: any): Movement => ({
  id: r.id,
  itemId: r.item_id,
  type: r.type,
  qty: r.qty,
  location: r.location || '',
  givenBy: r.given_by || '',
  receivedBy: r.received_by || '',
  returnedBy: r.returned_by || '',
  ref: r.ref || '',
  note: r.note || '',
  doneBy: r.done_by || '',
  doneAt: r.done_at,
});

export const sortItems = (a: Item, b: Item) => collator.compare(a.name, b.name);

export const friendlyError = (error: any): string => {
  const msg: string = error?.message || 'Unknown error';
  if (/row-level security|permission denied/i.test(msg)) return "You don't have permission to do that.";
  if (error?.code === '23505' || /duplicate key/i.test(msg)) return 'An item with that code already exists.';
  if (/schema cache|does not exist|could not find/i.test(msg))
    return `${msg} — run migration_v11, v12 and v13 (supabase/ folder, in order) in the Supabase SQL Editor, then reload.`;
  return msg;
};
