import React, { useState } from 'react';
import { useAccommodation } from './AccommodationContext';
import { MenuView } from './MenuView';
import { RoomsView } from './RoomsView';
import { Swap } from '../../components/Swap';
import { SlideNav } from '../../components/SlideNav';

const SECTIONS = ['food', 'rooms'];

export const Accommodation: React.FC = () => {
  const { loadError } = useAccommodation();
  const [section, setSection] = useState<'food' | 'rooms'>('food');

  return (
    <div className="space-y-3">
      {loadError && (
        <div
          role="alert"
          className="animate-calm-enter rounded-md border border-rose-500/40 bg-rose-500/10 text-rose-500 text-sm p-3"
        >
          Could not load Accommodation data: {loadError}
        </div>
      )}
      <SlideNav variant="underline" aria-label="Accommodation sections" className="flex gap-6 border-b border-line">
        {(
          [
            ['food', 'Langar distribution'],
            ['rooms', 'Rest rooms'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={section === key}
            onClick={() => setSection(key)}
            className={`border-b-2 px-2 py-2.5 text-xs font-semibold transition-[color,border-color,background-color] duration-200 ease-out ${section === key ? 'border-transparent text-brand' : 'border-transparent text-mute hover:text-ink'}`}
          >
            {label}
          </button>
        ))}
      </SlideNav>
      <Swap k={section} indexOf={k => SECTIONS.indexOf(k)}>
        {section === 'food' ? <MenuView /> : <RoomsView embedded />}
      </Swap>
    </div>
  );
};
