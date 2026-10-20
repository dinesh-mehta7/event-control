import React from 'react';
import { useAccommodation } from '../AccommodationContext';
import { fmtTime, minutesOf, prettyDate } from '../dates';
import { card, cx } from '../ui';
import { dishes } from './shared';

// ---------------------------------------------------------------------------
export const AllDays: React.FC<{ dark: boolean; onPick: (d: string) => void }> = ({ dark, onPick }) => {
  const { meals } = useAccommodation();
  const muted = 'text-mute';
  const dates = Array.from(new Set(meals.map(m => m.date))).sort();
  const cols = Array.from(new Map(meals.map(m => [m.meal, m.label])).entries())
    .map(([key, label]) => ({
      key,
      label,
      at: Math.min(...meals.filter(x => x.meal === key).map(x => minutesOf(x.start))),
    }))
    .sort((a, b) => a.at - b.at);
  if (!dates.length)
    return (
      <div className={cx('rounded-xl border p-8 text-center text-sm', card(dark), muted)}>No menus published yet.</div>
    );
  return (
    <div className={cx('rounded-xl border overflow-x-auto', card(dark))}>
      <table className="w-full min-w-[40rem] text-xs">
        <thead>
          <tr className={cx('text-left text-xs uppercase tracking-wider', muted)}>
            <th className="px-3 py-2.5 font-semibold">Date</th>
            {cols.map(c => (
              <th key={c.key} className="px-3 py-2.5 font-semibold">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {dates.map(d => (
            <tr key={d}>
              <td className="px-3 py-2.5 whitespace-nowrap">
                <button onClick={() => onPick(d)} className="font-semibold text-blue-500 hover:underline">
                  {prettyDate(d)}
                </button>
              </td>
              {cols.map(slot => {
                const m = meals.find(x => x.date === d && x.meal === slot.key);
                const list = m ? dishes(m.items) : [];
                return (
                  <td key={slot.key} className="px-3 py-2.5 align-top">
                    {m ? (
                      <>
                        <div className={cx('text-xs mb-0.5', muted)}>{fmtTime(m.start)}</div>
                        <div>
                          {list.slice(0, 3).join(', ') || <span className={cx('italic', muted)}>—</span>}
                          {list.length > 3 && <span className={muted}> +{list.length - 3}</span>}
                        </div>
                      </>
                    ) : (
                      <span className={muted}>—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
