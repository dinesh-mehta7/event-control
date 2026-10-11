import React from 'react';
import { useAccommodation } from './AccommodationContext';
import { MenuView } from './MenuView';

export const Accommodation: React.FC = () => {
  const { loadError } = useAccommodation();

  return (
    <div className="space-y-3">
      {loadError && <div role="alert" className="rounded-md border border-rose-500/40 bg-rose-500/10 text-rose-500 text-sm p-3">Could not load Accommodation data: {loadError}</div>}
      <MenuView />
    </div>
  );
};
