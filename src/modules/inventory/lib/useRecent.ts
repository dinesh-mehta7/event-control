import { useEffect, useState } from 'react';
import { useInventory } from '../InventoryContext';
import type { MoveType, Movement } from '../types';

// Latest movements (all items), refreshed whenever any stock number changes.
export const useRecent = (types: MoveType[] | undefined, limit = 300) => {
  const { fetchRecent, items } = useInventory();
  const [rows, setRows] = useState<Movement[] | null>(null);
  const sig = items.reduce((a, i) => a + i.inStock + i.issued * 7 + i.damaged * 13, 0);
  const key = types ? types.join(',') : '';
  useEffect(() => { let on = true; fetchRecent(types, limit).then(r => { if (on) setRows(r); }); return () => { on = false; }; }, [key, limit, sig]); // eslint-disable-line
  return rows;
};
