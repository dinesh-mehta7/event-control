import React, { useEffect, useState } from 'react';
import { useAccommodation } from './AccommodationContext';
import { pickLive, statusTone } from './live';
import { fmtTime, nowMinutes, todayStr } from './dates';
import { STATUS_STEPS } from './types';

// Small live meal status for any header. Everyone signed in sees it; click opens Accommodation.
export const LiveMealChip: React.FC<{ dark?: boolean }> = ({ dark = true }) => {
  const { mealsOn } = useAccommodation();
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick(n => n + 1), 30000); return () => clearInterval(t); }, []);
  const m = pickLive(mealsOn(todayStr()), nowMinutes());
  const cls = 'inline-flex items-center gap-1.5 max-w-[11rem] sm:max-w-[16rem] text-xs font-semibold px-2.5 py-1 rounded-full border whitespace-nowrap overflow-hidden';
  if (!m) return <a href="#/accommodation" title="Live meal status" className={`${cls} ${statusTone('scheduled', dark)}`}><span className="truncate">No meal today</span></a>;
  return (
    <a href="#/accommodation" title="Live meal status" className={`${cls} ${statusTone(m.status, dark)}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse shrink-0" />
      <span className="truncate">{m.label}<span className="hidden sm:inline"> · {STATUS_STEPS.find(x => x.key === m.status)?.label}</span></span>
      <span className="hidden xl:inline font-normal opacity-70 shrink-0">· {fmtTime(m.start)}</span>
    </a>
  );
};
