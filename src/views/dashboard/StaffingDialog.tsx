import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, TrendingUp } from 'lucide-react';
import { DashboardDialog, Segmented, StatTile } from './Dialog';
import {
  COVERAGE_LEGEND,
  DepartmentCoverage,
  Legend,
  STAFFING_LEGEND,
  StaffingTable,
  StaffingTrendChart,
  coverage,
  fmtDate,
} from './charts';
import type { DepartmentPoint, StaffingPoint } from './charts';

export const StaffingDialog: React.FC<{
  eventName?: string;
  rows: StaffingPoint[];
  departments: DepartmentPoint[];
  date: string;
  onDate: (d: string) => void;
  onClose: () => void;
}> = ({ eventName, rows, departments, date, onDate, onClose }) => {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const index = rows.findIndex(r => r.date === date);
  const sel = rows[index];
  const c = sel ? coverage(sel.expected, sel.arrived) : null;
  const gap = sel ? sel.arrived - sel.expected : 0;
  const step = (d: number) => {
    const next = rows[index + d];
    if (next) onDate(next.date);
  };
  const navBtn =
    'grid h-8 w-8 place-items-center rounded-md border border-line text-mute hover:bg-raised hover:text-ink disabled:opacity-40';

  return (
    <DashboardDialog
      title="Staffing analysis"
      icon={TrendingUp}
      onClose={onClose}
      subtitle={`${eventName || 'Selected event'} · daily trend and department coverage`}
      actions={
        <div className="flex items-center gap-1">
          <button
            type="button"
            className={navBtn}
            disabled={index <= 0}
            onClick={() => step(-1)}
            aria-label="Previous date"
          >
            <ChevronLeft size={15} />
          </button>
          <select
            aria-label="Selected date"
            className="h-8 rounded-md border border-line bg-field px-2 text-xs text-ink"
            value={date}
            onChange={e => onDate(e.target.value)}
          >
            {rows.map(r => (
              <option key={r.date} value={r.date}>
                {fmtDate(r.date)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={navBtn}
            disabled={index < 0 || index >= rows.length - 1}
            onClick={() => step(1)}
            aria-label="Next date"
          >
            <ChevronRight size={15} />
          </button>
        </div>
      }
    >
      {sel && (
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatTile label="Expected" value={sel.expected} hint={fmtDate(sel.date)} />
          <StatTile label="Arrived" value={sel.arrived} hint="Checked in on this date" />
          <StatTile
            label={gap >= 0 ? 'Above target' : 'Short of target'}
            value={Math.abs(gap)}
            hint={gap >= 0 ? 'Target met' : 'Still to arrive'}
          />
          <StatTile
            label="Coverage"
            value={c === null ? '—' : `${c}%`}
            hint={c === null ? 'No target set' : 'Arrived ÷ expected'}
          />
        </div>
      )}

      <section className="rounded-lg border border-line p-3 sm:p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-semibold text-ink">Staffing by date</h3>
            <p className="mt-0.5 text-[11.5px] text-mute">Select a date to compare sub-departments below.</p>
          </div>
          <div className="flex items-center gap-3">
            <Legend items={STAFFING_LEGEND} />
            <Segmented<'chart' | 'table'>
              label="Staffing view"
              value={view}
              onChange={setView}
              options={[
                { id: 'chart', label: 'Chart' },
                { id: 'table', label: 'Table' },
              ]}
            />
          </div>
        </div>
        {view === 'chart' ? (
          <StaffingTrendChart rows={rows} selectedDate={date} onSelect={onDate} height={260} />
        ) : (
          <StaffingTable rows={rows} selectedDate={date} onSelect={onDate} />
        )}
      </section>

      <section className="mt-4 rounded-lg border border-line p-3 sm:p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-semibold text-ink">Sub-department coverage · {sel ? fmtDate(sel.date) : ''}</h3>
            <p className="mt-0.5 text-[11.5px] text-mute">
              Arrived against each sub-department's target, biggest shortfall first.
            </p>
          </div>
          <Legend items={COVERAGE_LEGEND} />
        </div>
        <DepartmentCoverage rows={departments} />
      </section>
    </DashboardDialog>
  );
};
