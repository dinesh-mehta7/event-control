import React from 'react';
import { card, cx } from '../ui';

// ---------------------------------------------------------------------------
export const SummaryCard: React.FC<{
  dark: boolean;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  value: number;
  metricLabel: string;
  metricValue: number;
  detail: string;
  percent: number | null;
  color: string;
}> = ({ dark, icon: Icon, title, value, metricLabel, metricValue, detail, percent, color }) => (
  <section
    className={cx('flex min-h-28 items-center justify-between gap-4 rounded-xl border p-4', card(dark))}
    aria-label={`${title} summary`}
  >
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-blue-400" />
        <h2 className="text-xs font-semibold text-mute">Total {title.toLowerCase()}</h2>
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
      <div className="mt-2 flex items-center gap-1.5 text-xs">
        <span className="text-mute">{metricLabel}</span>
        <span className="font-semibold tabular-nums">{metricValue}</span>
      </div>
      <p className="mt-0.5 truncate text-[10.5px] text-mute" title={detail}>
        {detail}
      </p>
    </div>
    <div
      className="h-16 w-16 shrink-0 rounded-full p-[5px]"
      role="img"
      aria-label={`${title}: ${percent === null ? 'no data' : `${percent}% ${metricLabel.toLowerCase()}`}`}
      style={{ background: `conic-gradient(${color} ${percent ?? 0}%, rgb(var(--c-line)) 0)` }}
    >
      <div className="flex h-full w-full items-center justify-center rounded-full bg-surface text-xs font-bold tabular-nums">
        {percent === null ? '—' : `${percent}%`}
      </div>
    </div>
  </section>
);
