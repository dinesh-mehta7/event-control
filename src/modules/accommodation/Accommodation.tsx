import React, { useState } from 'react';
import { useAccommodation } from './AccommodationContext';
import { MenuView } from './MenuView';
import { RoomsView } from './RoomsView';

export const Accommodation: React.FC = () => {
  const { loadError } = useAccommodation();
  const [section, setSection] = useState<'food' | 'rooms'>('food');

  return (
    <div className="space-y-3">
      {loadError && <div role="alert" className="rounded-md border border-rose-500/40 bg-rose-500/10 text-rose-500 text-sm p-3">Could not load Accommodation data: {loadError}</div>}
      <nav aria-label="Accommodation sections" className="flex gap-6 border-b border-line">
        {([['food', 'Food'], ['rooms', 'Rooms']] as const).map(([key, label]) => <button key={key} type="button" aria-pressed={section === key} onClick={() => setSection(key)} className={`border-b-2 px-2 py-2.5 text-xs font-semibold transition-colors ${section === key ? 'border-blue-500 text-blue-400' : 'border-transparent text-mute hover:text-ink'}`}>{label}</button>)}
      </nav>
      {section === 'food' ? <MenuView /> : <RoomsView embedded />}
    </div>
  );
};
