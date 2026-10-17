import type React from 'react';
import { ClipboardList, History, LayoutDashboard, MapPin, Package, RotateCcw, Send, Wrench, CalendarRange, Boxes, ArrowRightLeft, Inbox } from 'lucide-react';
import type { MoveType, Item } from './types';
import type { Stage } from './lib/stock';

// Leaf section ids are unchanged from the old flat tab bar, so saved `inv_tab` values still open the same view.
export type Tab = 'dashboard' | 'items' | 'locations' | 'allocations' | 'returns' | 'maintenance' | 'history' | 'requests' | 'event-requirements';
type Icon = React.ComponentType<{ className?: string }>;

export interface Group { id: string; label: string; icon: Icon; tabs: { id: Tab; label: string; icon: Icon }[] }
export const GROUPS: Group[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, tabs: [{ id: 'dashboard', label: 'Overview', icon: LayoutDashboard }] },
  { id: 'stock', label: 'Stock', icon: Boxes, tabs: [{ id: 'items', label: 'Items', icon: Package }, { id: 'locations', label: 'Locations', icon: MapPin }] },
  { id: 'movements', label: 'Movements', icon: ArrowRightLeft, tabs: [
    { id: 'allocations', label: 'Issued out', icon: Send }, { id: 'returns', label: 'Returns', icon: RotateCcw },
    { id: 'maintenance', label: 'Maintenance', icon: Wrench }, { id: 'history', label: 'History', icon: History },
  ] },
  { id: 'requests', label: 'Requests', icon: Inbox, tabs: [{ id: 'requests', label: 'Department', icon: ClipboardList }, { id: 'event-requirements', label: 'Event requirements', icon: CalendarRange }] },
];
export const ALL_TABS: Tab[] = GROUPS.flatMap(g => g.tabs.map(t => t.id));
export const groupOf = (t: Tab) => GROUPS.find(g => g.tabs.some(x => x.id === t)) || GROUPS[0];

// Everything a view can ask the shell to do.
export interface Actions {
  go: (t: Tab, s?: Stage) => void;
  openMove: (type: MoveType, itemId?: string) => void;
  onEdit: (i: Item | 'new') => void;
  onDetail: (i: Item) => void;
  onDelete: (i: Item) => void;
  onImport: () => void;
  onCategories: () => void;
}
