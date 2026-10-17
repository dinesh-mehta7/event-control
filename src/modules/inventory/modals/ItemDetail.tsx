import React, { useEffect, useState } from 'react';
import { Edit3, History, MapPin, Plus, Send } from 'lucide-react';
import { useInventory } from '../InventoryContext';
import type { Item, MoveType, Movement } from '../types';
import { Badge, Drawer, LevelBadge, MoveList, StockBar, cx, ghost, primary } from '../ui/kit';

// Side panel with an item's counts, where its stock is, and its full movement history.
export const ItemDetail: React.FC<{ item: Item; onClose: () => void; onMove: (t: MoveType, id: string) => void; onEdit: (i: Item) => void }> = ({ item, onClose, onMove, onEdit }) => {
  const { fetchMovements, holdingsOf, locationLabel, canManage } = useInventory();
  const [rows, setRows] = useState<Movement[] | null>(null);
  useEffect(() => { let on = true; fetchMovements(item.id).then(r => on && setRows(r)); return () => { on = false; }; }, [item.id, item.inStock, item.issued, item.damaged]); // eslint-disable-line
  const hold = holdingsOf(item.id);
  return (
    <Drawer title={item.name} onClose={onClose}
      subtitle={<div className="flex flex-wrap items-center gap-1.5">{item.code && <span className="font-mono text-xs text-mute">{item.code}</span>}<Badge tone="mute">{item.category}</Badge><LevelBadge item={item} /></div>}
      footer={canManage ? <>
        <button className={ghost} onClick={() => onEdit(item)}><Edit3 className="h-3.5 w-3.5" />Edit</button>
        <button className={ghost} onClick={() => onMove('receive', item.id)}><Plus className="h-3.5 w-3.5" />Receive</button>
        <button className={primary} onClick={() => onMove('issue', item.id)}><Send className="h-3.5 w-3.5" />Issue</button>
      </> : undefined}>
      <div className="grid grid-cols-3 gap-2 text-center">
        {([['In store', item.inStock, 'text-emerald-400'], ['Issued', item.issued, 'text-blue-300'], ['Damaged', item.damaged, 'text-orange-400']] as const).map(([l, v, c]) => (
          <div key={l} className="rounded-xl border border-line bg-canvas/60 py-3"><div className="text-xs uppercase tracking-wider text-faint">{l}</div><div className={cx('text-2xl font-bold tabular-nums', c)}>{v}<span className="text-xs font-normal text-faint"> {item.unit}</span></div></div>
        ))}
      </div>
      <div className="mt-3">
        <StockBar item={item} />
        <div className="mt-1 flex justify-between text-xs text-faint"><span>{item.location ? `Stored at ${item.location}` : 'No shelf set'}</span>{item.minLevel > 0 && <span>Low-stock level {item.minLevel}</span>}</div>
      </div>
      {hold.length > 0 && (
        <div className="mt-5">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-faint">At locations</div>
          <ul className="divide-y divide-line/70 rounded-lg border border-line">
            {hold.map(h => <li key={h.location} className="flex items-center justify-between px-3 py-2 text-sm"><span className="inline-flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-faint" />{locationLabel(h.location)}</span><b className="tabular-nums">{h.qty}</b></li>)}
          </ul>
        </div>
      )}
      <div className="mt-5">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-faint"><History className="h-3.5 w-3.5" />Movement history</div>
        <div className="-mx-4 rounded-lg"><MoveList rows={rows} empty="No movements yet." showItem={false} /></div>
      </div>
    </Drawer>
  );
};
