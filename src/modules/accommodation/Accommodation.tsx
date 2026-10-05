import React, { useEffect, useState } from 'react';
import { BedDouble, UtensilsCrossed } from 'lucide-react';
import { useAccommodation } from './AccommodationContext';
import { RoomsView } from './RoomsView';
import { MenuView } from './MenuView';
import { STATUS_STEPS } from './types';
import { nowMinutes, todayStr } from './dates';
import { pickLive, statusTone } from './live';

type Page = 'rooms' | 'menu';

export const Accommodation: React.FC = () => {
  const { isDark: dark, canManageRooms, canManageMenu, loadError, mealsOn } = useAccommodation();
  const [page, setPage] = useState<Page>('menu');

  // tick so the top-bar live chip follows the clock
  const [, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick(n => n + 1), 30000); return () => clearInterval(t); }, []);
  const live = pickLive(mealsOn(todayStr()), nowMinutes());

  const nav: { id: Page; label: string; icon: any }[] = [
    { id: 'menu', label: 'Menu & Live', icon: UtensilsCrossed },
    { id: 'rooms', label: 'Rooms & Members', icon: BedDouble },
  ];
  const role = canManageRooms ? 'Owner · can edit rooms & menu' : canManageMenu ? 'Accommodation head · controls menu & live status' : 'View only';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-mute">
        <span>{role}</span>
        {live && <button onClick={() => setPage('menu')} className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border ${statusTone(live.status, dark)}`}><span className="w-1.5 h-1.5 rounded-full bg-current" />{live.label}: {STATUS_STEPS.find(s => s.key === live.status)?.label}</button>}
      </div>
      <nav className="flex gap-1 border-b border-line" aria-label="Accommodation sections">
        {nav.map(n => <button key={n.id} onClick={() => setPage(n.id)} aria-current={page === n.id ? 'page' : undefined}
          className={`inline-flex items-center gap-2 px-3 py-2.5 border-b-2 text-sm font-medium ${page === n.id ? 'border-blue-600 text-blue-500' : 'border-transparent text-mute hover:text-ink'}`}>
          <n.icon className="w-4 h-4" />{n.label}
        </button>)}
      </nav>
      {loadError && <div role="alert" className="rounded-md border border-rose-500/40 bg-rose-500/10 text-rose-500 text-sm p-3">Could not load Accommodation data: {loadError}</div>}
      {page === 'menu' ? <MenuView /> : <RoomsView />}
    </div>
  );
};
