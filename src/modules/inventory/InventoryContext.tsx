import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../walkie/lib/supabaseClient';
import { useWalkie } from '../walkie';
import { CATEGORIES } from './types';
import type { Holding, Item, MoveType, Movement } from './types';

const mapItem = (r: any): Item => ({
  id: r.id, name: r.name, code: r.code || '', category: r.category || 'General', unit: r.unit || 'pcs', location: r.location || '',
  minLevel: r.min_level || 0, inStock: r.in_stock || 0, issued: r.issued || 0, damaged: r.damaged || 0,
});
const mapHolding = (r: any): Holding => ({ itemId: r.item_id, location: r.location, qty: r.qty });
const mapMove = (r: any): Movement => ({ id: r.id, itemId: r.item_id, type: r.type, qty: r.qty, location: r.location || '', givenBy: r.given_by || '', receivedBy: r.received_by || '', returnedBy: r.returned_by || '', ref: r.ref || '', note: r.note || '', doneBy: r.done_by || '', doneAt: r.done_at });

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const sortItems = (a: Item, b: Item) => collator.compare(a.name, b.name);
const uid = (p: string) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

const friendlyError = (error: any): string => {
  const msg: string = error?.message || 'Unknown error';
  if (/row-level security|permission denied/i.test(msg)) return "You don't have permission to do that.";
  if (error?.code === '23505' || /duplicate key/i.test(msg)) return 'An item with that code already exists.';
  if (/schema cache|does not exist|could not find/i.test(msg)) return `${msg} — run migration_v11, v12 and v13 (supabase/ folder, in order) in the Supabase SQL Editor, then reload.`;
  return msg;
};

export interface Loc { id: string; name: string }
export interface ItemInput { name: string; code: string; category: string; unit: string; location: string; minLevel: number }
export interface MoveInput { type: MoveType; qty: number; location: string; givenBy: string; receivedBy: string; returnedBy: string; ref: string; note: string }
export interface Stats { total: number; low: number; out: number; withIssued: number; withDamaged: number; needRestock: number }

interface Ctx {
  items: Item[]; holdings: Holding[]; loading: boolean; loadError: string; canManage: boolean; userName: string; stats: Stats;
  holdingsOf: (itemId: string) => Holding[];
  addItem: (i: ItemInput, opening: number) => Promise<boolean>;
  importItems: (rows: (ItemInput & { opening: number })[]) => Promise<{ added: number; skipped: number }>;
  updateItem: (id: string, i: ItemInput) => Promise<boolean>;
  deleteItem: (id: string) => Promise<boolean>;
  move: (itemId: string, m: MoveInput) => Promise<boolean>;
  fetchMovements: (itemId: string) => Promise<Movement[]>;
  fetchRecent: (types?: MoveType[], limit?: number) => Promise<Movement[]>;
  // categories + locations (full add / rename / delete)
  categories: string[]; locations: Loc[]; extrasReady: boolean;
  locationLabel: (id: string) => string;
  addCategory: (name: string) => Promise<boolean>;
  renameCategory: (oldName: string, newName: string) => Promise<boolean>;
  deleteCategory: (name: string) => Promise<boolean>;
  addLocation: (name: string) => Promise<boolean>;
  ensureLocation: (name: string) => Promise<string | null>; // id of the location with this name, creating it if new
  renameLocation: (id: string, name: string) => Promise<boolean>;
  deleteLocation: (id: string) => Promise<boolean>;
}
const C = createContext<Ctx | null>(null);
export const useInventory = (): Ctx => { const c = useContext(C); if (!c) throw new Error('useInventory must be used inside <InventoryProvider>'); return c; };

export const InventoryProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const w: any = useWalkie();
  const user = w.currentUser;
  const orgId: string | null = user?.organizationId || null;
  const ready = !!user && user.approved !== false && user.isActive !== false && !!orgId;
  const canManage = ready && (user.level === 'owner' || user.level === 'dept_head' || user.subDepartment === 'inventory');

  const [items, setItems] = useState<Item[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [catRows, setCatRows] = useState<{ id: string; name: string }[]>([]);
  const [locations, setLocations] = useState<Loc[]>([]);
  const [extrasReady, setExtrasReady] = useState(true); // false until migration_v12 has been run
  const itemsRef = useRef(items); itemsRef.current = items;

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
    const [a, b] = await Promise.all([fetchAll('inventory_items', 'created_at'), fetchAll('inventory_holdings', 'item_id')]);
    const err = a.error || b.error;
    if (err) setLoadError(friendlyError(err));
    else { setLoadError(''); setItems(a.data.map(mapItem).sort(sortItems)); setHoldings(b.data.map(mapHolding)); }
    const [c, d] = await Promise.all([fetchAll('inventory_categories', 'created_at'), fetchAll('inventory_locations', 'created_at')]);
    if (c.error || d.error) setExtrasReady(false);
    else { setExtrasReady(true); setCatRows(c.data.map((r: any) => ({ id: r.id, name: r.name }))); setLocations(d.data.map((r: any) => ({ id: r.id, name: r.name })).sort((a: Loc, b: Loc) => collator.compare(a.name, b.name))); }
    setLoading(false);
  }, [ready]);

  useEffect(() => { if (!ready) { setItems([]); setHoldings([]); setCatRows([]); setLocations([]); setLoadError(''); return; } load(); }, [ready, orgId]); // eslint-disable-line

  const upsertItem = (list: Item[], it: Item) => [...list.filter(x => x.id !== it.id), it].sort(sortItems);
  const upsertHolding = (list: Holding[], h: Holding) => [...list.filter(x => !(x.itemId === h.itemId && x.location === h.location)), h];

  useEffect(() => {
    if (!ready) return;
    const filter = `organization_id=eq.${orgId}`;
    const ch = supabase.channel(`inventory-${orgId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_items', filter }, (p: any) => {
        if (p.eventType === 'DELETE') { setItems(prev => prev.filter(x => x.id !== p.old.id)); setHoldings(prev => prev.filter(h => h.itemId !== p.old.id)); }
        else setItems(prev => upsertItem(prev, mapItem(p.new)));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_holdings', filter }, (p: any) => {
        if (p.eventType === 'DELETE') setHoldings(prev => prev.filter(h => !(h.itemId === p.old.item_id && h.location === p.old.location)));
        else setHoldings(prev => upsertHolding(prev, mapHolding(p.new)));
      }).subscribe();
    const t = setInterval(load, 120000);
    return () => { supabase.removeChannel(ch); clearInterval(t); };
  }, [ready, orgId]); // eslint-disable-line

  const deny = () => { toast('You can view the inventory but not change it.', 'error'); return false; };
  const body = (i: ItemInput) => ({ name: i.name.trim(), code: i.code.trim(), category: i.category.trim() || 'General', unit: i.unit.trim() || 'pcs', location: i.location.trim(), min_level: Math.max(0, Math.floor(i.minLevel || 0)) });

  // After a ledger entry the database has updated counts + holdings: pull the fresh rows.
  const refreshItem = async (id: string) => {
    const [a, b] = await Promise.all([
      supabase.from('inventory_items').select('*').eq('id', id).single(),
      supabase.from('inventory_holdings').select('*').eq('item_id', id),
    ]);
    if (a.data) setItems(p => upsertItem(p, mapItem(a.data)));
    if (b.data) setHoldings(p => [...p.filter(h => h.itemId !== id), ...b.data.map(mapHolding)]);
  };

  const insertMove = async (itemId: string, m: MoveInput) => supabase.from('inventory_movements').insert({
    id: uid('mv'), organization_id: orgId, item_id: itemId, type: m.type, qty: m.qty,
    location: m.location || null, person: '', given_by: m.givenBy.trim(), received_by: m.receivedBy.trim(), returned_by: m.returnedBy.trim(),
    ref: m.ref.trim(), note: m.note.trim(), done_by: user.name,
  });

  const addItem: Ctx['addItem'] = async (i, opening) => {
    if (!canManage) return deny();
    if (!i.name.trim()) { toast('Item name is required.', 'error'); return false; }
    const { data, error } = await supabase.from('inventory_items').insert({ id: uid('item'), organization_id: orgId, ...body(i) }).select().single();
    if (error) { toast(`Could not add item: ${friendlyError(error)}`, 'error'); return false; }
    setItems(p => upsertItem(p, mapItem(data)));
    if (opening > 0) {
      const r = await insertMove(data.id, { type: 'receive', qty: opening, location: '', givenBy: '', receivedBy: '', returnedBy: '', ref: '', note: 'Opening stock' });
      if (r.error) toast(`Item added, but opening stock failed: ${friendlyError(r.error)}`, 'warning');
      else await refreshItem(data.id);
    }
    log('Inventory Item Added', `${user.name} added ${i.name.trim()}`, 'success');
    toast(`${i.name.trim()} added.`);
    return true;
  };

  const importItems: Ctx['importItems'] = async (rows) => {
    if (!canManage) { deny(); return { added: 0, skipped: rows.length }; }
    const taken = new Set(itemsRef.current.map(x => x.name.trim().toLowerCase()));
    let added = 0;
    for (const r of rows) {
      const key = r.name.trim().toLowerCase();
      if (!key || taken.has(key)) continue;
      const { data, error } = await supabase.from('inventory_items').insert({ id: uid('item'), organization_id: orgId, ...body(r) }).select().single();
      if (error) { toast(`Import stopped at "${r.name}": ${friendlyError(error)}`, 'error'); break; }
      taken.add(key); added++;
      if (r.opening > 0) await insertMove(data.id, { type: 'receive', qty: r.opening, location: '', givenBy: '', receivedBy: '', returnedBy: '', ref: '', note: 'Opening stock' });
    }
    if (added) { await load(); log('Inventory Imported', `${user.name} imported ${added} items`, 'success'); toast(`${added} item(s) added.`); }
    return { added, skipped: rows.length - added };
  };

  const updateItem: Ctx['updateItem'] = async (id, i) => {
    if (!canManage) return deny();
    if (!i.name.trim()) { toast('Item name is required.', 'error'); return false; }
    const { data, error } = await supabase.from('inventory_items').update(body(i)).eq('id', id).select().single();
    if (error) { toast(`Could not save: ${friendlyError(error)}`, 'error'); return false; }
    setItems(p => upsertItem(p, mapItem(data)));
    toast('Saved.');
    return true;
  };

  const deleteItem: Ctx['deleteItem'] = async (id) => {
    if (!canManage) return deny();
    const it = itemsRef.current.find(x => x.id === id);
    const { error } = await supabase.from('inventory_items').delete().eq('id', id);
    if (error) { toast(`Could not delete: ${friendlyError(error)}`, 'error'); return false; }
    setItems(p => p.filter(x => x.id !== id)); setHoldings(p => p.filter(h => h.itemId !== id));
    log('Inventory Item Deleted', `${user.name} deleted ${it?.name || id}`, 'warning');
    toast(`${it?.name || 'Item'} deleted.`);
    return true;
  };

  const move: Ctx['move'] = async (itemId, m) => {
    if (!canManage) return deny();
    const it = itemsRef.current.find(x => x.id === itemId);
    if (!it) return false;
    if (!Number.isInteger(m.qty) || m.qty === 0 || (m.type !== 'adjust' && m.qty < 0)) { toast('Enter a whole-number quantity.', 'error'); return false; }
    const { error } = await insertMove(itemId, m);
    if (error) { toast(friendlyError(error), 'error'); return false; }
    await refreshItem(itemId);
    log('Inventory', `${user.name}: ${m.type} ${m.qty} × ${it.name}${m.location ? ` → ${locations.find(l => l.id === m.location)?.name || 'location'}` : ''}${m.receivedBy ? ` · to ${m.receivedBy}` : ''}${m.returnedBy ? ` · by ${m.returnedBy}` : ''}`, 'info');
    toast('Recorded.');
    return true;
  };

  const fetchMovements: Ctx['fetchMovements'] = async (itemId) => {
    const { data, error } = await supabase.from('inventory_movements').select('*').eq('item_id', itemId).order('done_at', { ascending: false }).limit(200);
    if (error) { toast(friendlyError(error), 'error'); return []; }
    return (data || []).map(mapMove);
  };

  const fetchRecent: Ctx['fetchRecent'] = async (types, limit = 300) => {
    let q = supabase.from('inventory_movements').select('*').order('done_at', { ascending: false }).limit(limit);
    if (types && types.length) q = q.in('type', types);
    const { data, error } = await q;
    if (error) { toast(friendlyError(error), 'error'); return []; }
    return (data || []).map(mapMove);
  };

  // ---- categories -----------------------------------------------------------
  const categories = useMemo(() => {
    const names = [...catRows.map(c => c.name), ...items.map(i => i.category), ...(extrasReady ? [] : CATEGORIES)].filter(Boolean);
    return Array.from(new Map(names.map(n => [n.toLowerCase(), n] as [string, string])).values()).sort(collator.compare);
  }, [catRows, items, extrasReady]);
  const needMigration = () => { toast('Run supabase/migration_v12 and migration_v13 (inventory) in the Supabase SQL Editor, then reload.', 'error'); return false; };
  const dupCat = (n: string, except?: string) => categories.some(c => c.toLowerCase() === n.toLowerCase() && c.toLowerCase() !== (except || '').toLowerCase());

  const addCategory: Ctx['addCategory'] = async (name) => {
    if (!canManage) return deny();
    if (!extrasReady) return needMigration();
    const n = name.trim();
    if (!n) { toast('Enter a category name.', 'error'); return false; }
    if (dupCat(n)) { toast('That category already exists.', 'error'); return false; }
    const { data, error } = await supabase.from('inventory_categories').insert({ id: uid('cat'), organization_id: orgId, name: n }).select().single();
    if (error) { toast(friendlyError(error), 'error'); return false; }
    setCatRows(p => [...p, { id: data.id, name: data.name }]);
    toast(`${n} added.`);
    return true;
  };

  const renameCategory: Ctx['renameCategory'] = async (oldName, newName) => {
    if (!canManage) return deny();
    const n = newName.trim();
    if (!n) { toast('Enter a category name.', 'error'); return false; }
    if (n === oldName) return true;
    if (dupCat(n, oldName)) { toast('That category already exists.', 'error'); return false; }
    if (extrasReady) {
      const row = catRows.find(c => c.name === oldName);
      const r = row
        ? await supabase.from('inventory_categories').update({ name: n }).eq('id', row.id)
        : await supabase.from('inventory_categories').insert({ id: uid('cat'), organization_id: orgId, name: n });
      if (r.error) { toast(friendlyError(r.error), 'error'); return false; }
    }
    const u = await supabase.from('inventory_items').update({ category: n }).eq('category', oldName);
    if (u.error) { toast(friendlyError(u.error), 'error'); return false; }
    await load();
    toast(`Renamed to ${n}.`);
    return true;
  };

  const deleteCategory: Ctx['deleteCategory'] = async (name) => {
    if (!canManage) return deny();
    if (name.toLowerCase() === 'general') { toast('"General" is the fallback category and cannot be deleted.', 'error'); return false; }
    const u = await supabase.from('inventory_items').update({ category: 'General' }).eq('category', name);
    if (u.error) { toast(friendlyError(u.error), 'error'); return false; }
    if (extrasReady) {
      const row = catRows.find(c => c.name === name);
      if (row) { const r = await supabase.from('inventory_categories').delete().eq('id', row.id); if (r.error) { toast(friendlyError(r.error), 'error'); return false; } }
    }
    await load();
    toast(`${name} deleted. Its items moved to General.`);
    return true;
  };

  // ---- locations (where stock is issued to) --------------------------------
  const locationLabel = useCallback((k: string) => locations.find(l => l.id === k)?.name || (k.startsWith('loc-') || k.startsWith('dept-') ? 'Removed location' : k), [locations]);
  const dupLoc = (n: string, exceptId?: string) => locations.some(l => l.id !== exceptId && l.name.toLowerCase() === n.toLowerCase());
  const byName = (a: Loc, b: Loc) => collator.compare(a.name, b.name);

  const addLocation: Ctx['addLocation'] = async (name) => {
    if (!canManage) return deny();
    if (!extrasReady) return needMigration();
    const n = name.trim();
    if (!n) { toast('Enter a location name.', 'error'); return false; }
    if (dupLoc(n)) { toast('A location with that name already exists.', 'error'); return false; }
    const { data, error } = await supabase.from('inventory_locations').insert({ id: uid('loc'), organization_id: orgId, name: n }).select().single();
    if (error) { toast(friendlyError(error), 'error'); return false; }
    setLocations(p => [...p, { id: data.id, name: data.name }].sort(byName));
    log('Inventory Location Added', `${user.name} added location ${n}`, 'success');
    toast(`${n} added.`);
    return true;
  };

  // Used by Issue: type any place name; reuse it if it exists, create it if it is new.
  const ensureLocation: Ctx['ensureLocation'] = async (name) => {
    if (!canManage) { deny(); return null; }
    if (!extrasReady) { needMigration(); return null; }
    const n = name.trim();
    if (!n) { toast('Choose or type a location.', 'error'); return null; }
    const hit = locations.find(l => l.name.toLowerCase() === n.toLowerCase());
    if (hit) return hit.id;
    const { data, error } = await supabase.from('inventory_locations').insert({ id: uid('loc'), organization_id: orgId, name: n }).select().single();
    if (error) { toast(friendlyError(error), 'error'); return null; }
    setLocations(p => [...p, { id: data.id, name: data.name }].sort(byName));
    return data.id as string;
  };

  const renameLocation: Ctx['renameLocation'] = async (id, name) => {
    if (!canManage) return deny();
    const n = name.trim();
    if (!n) { toast('Enter a location name.', 'error'); return false; }
    if (dupLoc(n, id)) { toast('A location with that name already exists.', 'error'); return false; }
    const { error } = await supabase.from('inventory_locations').update({ name: n }).eq('id', id);
    if (error) { toast(friendlyError(error), 'error'); return false; }
    setLocations(p => p.map(l => (l.id === id ? { ...l, name: n } : l)).sort(byName));
    toast('Saved.');
    return true;
  };

  const deleteLocation: Ctx['deleteLocation'] = async (id) => {
    if (!canManage) return deny();
    const held = holdings.filter(h => h.location === id && h.qty > 0).reduce((a, h) => a + h.qty, 0);
    if (held > 0) { toast(`${held} unit(s) are still at this location. Return them first, then delete it.`, 'error'); return false; }
    const { error } = await supabase.from('inventory_locations').delete().eq('id', id);
    if (error) { toast(friendlyError(error), 'error'); return false; }
    setLocations(p => p.filter(l => l.id !== id));
    toast('Location deleted.');
    return true;
  };

  const holdingsOf = useCallback((id: string) => holdings.filter(h => h.itemId === id && h.qty > 0), [holdings]);

  const stats = useMemo<Stats>(() => {
    const s: Stats = { total: items.length, low: 0, out: 0, withIssued: 0, withDamaged: 0, needRestock: 0 };
    for (const x of items) {
      if (x.inStock === 0) s.out++; else if (x.minLevel > 0 && x.inStock <= x.minLevel) s.low++;
      if (x.issued > 0) s.withIssued++;
      if (x.damaged > 0) s.withDamaged++;
    }
    s.needRestock = s.low + s.out;
    return s;
  }, [items]);

  const value: Ctx = { items, holdings, loading, loadError, canManage, userName: user?.name || '', stats, holdingsOf, addItem, importItems, updateItem, deleteItem, move, fetchMovements, fetchRecent, categories, locations, extrasReady, locationLabel, addCategory, renameCategory, deleteCategory, addLocation, ensureLocation, renameLocation, deleteLocation };
  return <C.Provider value={value}>{children}</C.Provider>;
};
