import React, { useMemo, useState } from 'react';
import { BedDouble, CheckCircle2, ChevronRight, CircleDashed, Clock3 } from 'lucide-react';
import { DashboardDialog, Segmented, StatTile } from './Dialog';
import { Legend } from './charts';

export type RoomReadinessPoint = {
  id: string;
  name: string;
  category: string;
  percent: number;
  ready: boolean;
  hasRequirements: boolean;
  readyItems: number;
  totalItems: number;
  preparedQuantity: number;
  neededQuantity: number;
  returnedItems: number;
};
type State = 'ready' | 'progress' | 'empty';
const stateOf = (r: RoomReadinessPoint): State => (r.ready ? 'ready' : r.hasRequirements ? 'progress' : 'empty');
const STATE: Record<
  State,
  { label: string; bar: string; text: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  ready: { label: 'Ready', bar: 'bg-chart-ok', text: 'text-emerald-300', Icon: CheckCircle2 },
  progress: { label: 'In progress', bar: 'bg-chart-1', text: 'text-blue-300', Icon: Clock3 },
  empty: { label: 'No necessities', bar: 'bg-line-strong', text: 'text-mute', Icon: CircleDashed },
};
const ORDER: State[] = ['ready', 'progress', 'empty'];
// What needs attention first: rooms being prepared, then rooms with nothing set up, then ready rooms.
const ATTENTION: Record<State, number> = { progress: 0, empty: 1, ready: 2 };
const summarize = (rooms: RoomReadinessPoint[]) => {
  const counts = { ready: 0, progress: 0, empty: 0 } as Record<State, number>;
  rooms.forEach(r => {
    counts[stateOf(r)] += 1;
  });
  const prepared = rooms.reduce((s, r) => s + r.preparedQuantity, 0);
  const needed = rooms.reduce((s, r) => s + r.neededQuantity, 0);
  return {
    counts,
    prepared,
    needed,
    returned: rooms.reduce((s, r) => s + r.returnedItems, 0),
    percent: rooms.length ? Math.round((counts.ready / rooms.length) * 100) : 0,
  };
};

// Part-to-whole of rooms by state, separated by 2px surface gaps.
const StatusBar: React.FC<{ counts: Record<State, number>; total: number; tall?: boolean }> = ({
  counts,
  total,
  tall,
}) => (
  <div
    className={`flex w-full gap-[2px] overflow-hidden rounded ${tall ? 'h-3' : 'h-2'}`}
    role="img"
    aria-label={ORDER.map(s => `${counts[s]} ${STATE[s].label.toLowerCase()}`).join(', ')}
  >
    {ORDER.filter(s => counts[s] > 0).map(s => (
      <div
        key={s}
        className={`meter-fill ${STATE[s].bar}`}
        style={{ flexGrow: counts[s] / Math.max(total, 1), flexBasis: 0 }}
        title={`${STATE[s].label}: ${counts[s]}`}
      />
    ))}
  </div>
);
const STATUS_LEGEND = ORDER.map(s => ({ label: STATE[s].label, cls: STATE[s].bar }));

// Meter: fill carries progress; the track is a light step of the same hue.
const Meter: React.FC<{ room: RoomReadinessPoint }> = ({ room }) => {
  const s = stateOf(room);
  return (
    <div
      className={`h-1.5 w-full overflow-hidden rounded-full ${s === 'ready' ? 'bg-chart-ok/15' : s === 'progress' ? 'bg-chart-1/15' : 'bg-raised'}`}
    >
      <div
        className={`meter-fill chart-grow-x h-full rounded-full ${STATE[s].bar}`}
        style={{ width: `${room.percent}%` }}
      />
    </div>
  );
};

export const RoomReadinessCard: React.FC<{
  rooms: RoomReadinessPoint[];
  loading: boolean;
  eventName?: string;
  onOpen: () => void;
}> = ({ rooms, loading, eventName, onOpen }) => {
  const sum = summarize(rooms);
  const preview = [...rooms]
    .sort(
      (a, b) => ATTENTION[stateOf(a)] - ATTENTION[stateOf(b)] || a.percent - b.percent || a.name.localeCompare(b.name),
    )
    .slice(0, 4);
  return (
    <section
      aria-labelledby="room-readiness-title"
      className="flex h-full min-h-0 flex-col rounded-xl border border-line bg-surface p-4"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 id="room-readiness-title" className="text-sm font-semibold text-ink">
            Room readiness
          </h2>
          <p className="mt-0.5 text-[11.5px] text-mute">Room preparation{eventName ? ` · ${eventName}` : ''}</p>
        </div>
        <button
          type="button"
          onClick={onOpen}
          className="inline-flex shrink-0 items-center gap-0.5 text-[11.5px] font-medium text-blue-300 hover:text-blue-200"
        >
          Room details
          <ChevronRight size={13} />
        </button>
      </div>
      {loading ? (
        <div className="mt-4 space-y-3" aria-label="Loading room readiness">
          <div className="animate-shimmer h-10 w-40 rounded" />
          <div className="animate-shimmer h-3 w-full rounded" />
          <div className="animate-shimmer h-24 w-full rounded" />
        </div>
      ) : !rooms.length ? (
        <div className="mt-4 flex flex-1 items-center justify-center rounded-lg border border-dashed border-line p-6 text-center text-xs text-mute">
          No rooms have been added for this workspace yet.
        </div>
      ) : (
        <div onClick={onOpen} className="mt-3 flex flex-1 cursor-pointer flex-col gap-3">
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="text-[2.25rem] font-semibold leading-none text-ink">
                {sum.counts.ready}
                <span className="text-lg font-normal text-mute"> / {rooms.length}</span>
              </div>
              <div className="mt-1 text-[11.5px] text-mute">rooms ready · {sum.percent}%</div>
            </div>
            {sum.needed > 0 && (
              <div className="text-right">
                <div className="text-sm font-semibold tabular-nums text-ink">
                  {sum.prepared}
                  <span className="font-normal text-mute"> / {sum.needed}</span>
                </div>
                <div className="text-[11.5px] text-mute">units prepared</div>
              </div>
            )}
          </div>
          <StatusBar counts={sum.counts} total={rooms.length} tall />
          <Legend items={STATUS_LEGEND} />
          <ul className="mt-1 divide-y divide-line border-t border-line">
            {preview.map(r => {
              const s = STATE[stateOf(r)];
              return (
                <li key={r.id} className="grid grid-cols-[minmax(0,1fr)_6rem_2.5rem] items-center gap-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium text-ink">{r.name}</span>
                    <span className={`inline-flex items-center gap-1 text-[10.5px] ${s.text}`}>
                      <s.Icon className="h-3 w-3" />
                      {s.label}
                    </span>
                  </span>
                  <Meter room={r} />
                  <span className="text-right text-[11.5px] tabular-nums text-mute">{r.percent}%</span>
                </li>
              );
            })}
          </ul>
          {rooms.length > preview.length && (
            <span className="text-[11.5px] text-blue-300">+{rooms.length - preview.length} more rooms</span>
          )}
        </div>
      )}
    </section>
  );
};

export const RoomReadinessDialog: React.FC<{
  rooms: RoomReadinessPoint[];
  eventName?: string;
  onClose: () => void;
}> = ({ rooms, eventName, onClose }) => {
  const [filter, setFilter] = useState<'all' | State>('all');
  const sum = summarize(rooms);
  const shown = useMemo(
    () =>
      rooms
        .filter(r => filter === 'all' || stateOf(r) === filter)
        .sort((a, b) => a.percent - b.percent || a.name.localeCompare(b.name)),
    [rooms, filter],
  );
  return (
    <DashboardDialog
      title="Room readiness"
      icon={BedDouble}
      onClose={onClose}
      subtitle={`Prepared necessities${eventName ? ` · ${eventName}` : ''}`}
      actions={
        <a
          href="#/accommodation"
          className="inline-flex items-center gap-0.5 text-xs font-medium text-blue-300 hover:underline"
        >
          Open rooms
          <ChevronRight size={13} />
        </a>
      }
    >
      {!rooms.length ? (
        <p className="py-10 text-center text-xs text-mute">No rooms to display.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatTile
              label="Rooms ready"
              value={
                <>
                  {sum.counts.ready}
                  <span className="text-sm font-normal text-mute"> / {rooms.length}</span>
                </>
              }
              hint={`${sum.percent}% of rooms`}
            />
            <StatTile label="In progress" value={sum.counts.progress} hint="Necessities being prepared" />
            <StatTile
              label="Units prepared"
              value={
                <>
                  {sum.prepared}
                  <span className="text-sm font-normal text-mute"> / {sum.needed}</span>
                </>
              }
              hint={
                sum.needed
                  ? `${Math.round((sum.prepared / sum.needed) * 100)}% of all necessities`
                  : 'No necessities added'
              }
            />
            <StatTile label="Items returned" value={sum.returned} hint="After the event" />
          </div>
          <div className="mt-4 space-y-2">
            <StatusBar counts={sum.counts} total={rooms.length} tall />
            <Legend items={STATUS_LEGEND} />
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-semibold text-ink">
              Readiness by room <span className="font-normal text-mute">· least ready first</span>
            </h3>
            <Segmented<'all' | State>
              label="Filter rooms"
              value={filter}
              onChange={setFilter}
              options={[
                { id: 'all', label: `All ${rooms.length}` },
                { id: 'progress', label: `In progress ${sum.counts.progress}` },
                { id: 'ready', label: `Ready ${sum.counts.ready}` },
                { id: 'empty', label: `No necessities ${sum.counts.empty}` },
              ]}
            />
          </div>
          <div className="mt-2 overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[40rem] text-left text-xs">
              <thead className="bg-raised text-[10.5px] uppercase tracking-wide text-mute">
                <tr>
                  <th className="px-3 py-2 font-semibold">Room</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="w-48 px-3 py-2 font-semibold">Progress</th>
                  <th className="px-3 py-2 text-right font-semibold">Items ready</th>
                  <th className="px-3 py-2 text-right font-semibold">Units</th>
                  <th className="px-3 py-2 text-right font-semibold">Returned</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {shown.map(r => {
                  const s = STATE[stateOf(r)];
                  return (
                    <tr key={r.id} className="hover:bg-raised/40">
                      <td className="px-3 py-2.5">
                        <div className="font-medium text-ink">{r.name}</div>
                        <div className="text-[10.5px] text-mute">
                          {r.category === 'control_room' ? 'Control room' : 'Rest room'}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-flex items-center gap-1 ${s.text}`}>
                          <s.Icon className="h-3.5 w-3.5" />
                          {s.label}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <Meter room={r} />
                          <span className="w-9 text-right tabular-nums text-mute">{r.percent}%</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink">
                        {r.hasRequirements ? `${r.readyItems} / ${r.totalItems}` : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink">
                        {r.hasRequirements ? `${r.preparedQuantity} / ${r.neededQuantity}` : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-mute">
                        {r.hasRequirements ? r.returnedItems : '—'}
                      </td>
                    </tr>
                  );
                })}
                {!shown.length && (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-mute">
                      No rooms in this group.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </DashboardDialog>
  );
};
