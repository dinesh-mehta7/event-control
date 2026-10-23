import React, { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Edit3,
  Lock,
  Plus,
  Trash2,
  UtensilsCrossed,
} from 'lucide-react';
import { useAccommodation } from './AccommodationContext';
import { MEAL_PRESETS, STATUS_STEPS } from './types';
import type { MealRow } from './types';
import { fmtTime, minutesOf, nowMinutes, prettyDate, shiftDate, timeAgo, todayStr } from './dates';
import { pickLive, statusTone } from './live';
import { ConfirmModal, btnGhost, btnPrimary, card, cx, inputCls } from './ui';
import { dishes } from './menu/shared';
import { AllDays } from './menu/AllDays';
import { AddMealForm, MealForm } from './menu/MealForm';
import { PillTabs } from '../../components/PillTabs';

const StatusBadge: React.FC<{ s: MealRow['status']; dark: boolean }> = ({ s, dark }) => (
  <span className={cx('text-xs font-bold px-2 py-0.5 rounded-full border whitespace-nowrap', statusTone(s, dark))}>
    {STATUS_STEPS.find(x => x.key === s)?.label}
  </span>
);

// A ticking "now" so the live card re-evaluates which meal is current.
const useNow = () => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);
  return now;
};

export const MenuView: React.FC = () => {
  const {
    meals,
    mealsOn,
    canManageMenu,
    isDark: dark,
    loading,
    createDay,
    saveMeal,
    setMealStatus,
    deleteDay,
    addMeal,
    deleteMeal,
  } = useAccommodation();
  const now = useNow();
  const today = todayStr();
  const muted = 'text-mute';

  const [date, setDate] = useState(today);
  const [view, setView] = useState<'day' | 'all'>('day');
  const [editing, setEditing] = useState<MealRow | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [removing, setRemoving] = useState<MealRow | null>(null);
  const [addingMeal, setAddingMeal] = useState(false);
  const [pinned, setPinned] = useState<string | null>(null); // manually chosen meal on the live card
  const [creating, setCreating] = useState(false);

  const todays = mealsOn(today);
  const auto = pickLive(todays, nowMinutes(now));
  const focus = (pinned && todays.find(m => m.id === pinned)) || auto;

  const dayRows = useMemo(
    () => [...mealsOn(date)].sort((a, b) => minutesOf(a.start) - minutesOf(b.start)),
    [mealsOn, date, meals],
  );
  const previousDayWithMenu = useMemo(() => {
    const ds = Array.from(new Set(meals.map(m => m.date)))
      .filter(d => d < date)
      .sort();
    return ds.length ? ds[ds.length - 1] : '';
  }, [meals, date]);
  const createMenu = async (target: string, source?: string) => {
    if (creating) return;
    setCreating(true);
    try {
      await createDay(target, source);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Meal service</h1>
          <p className={cx('text-xs', muted)}>Today’s live service and meal planning.</p>
        </div>
        {!canManageMenu && (
          <p className={cx('flex items-center gap-1.5 text-xs', muted)}>
            <Lock className="w-3.5 h-3.5" />
            View only — the Accommodation head or owner updates this.
          </p>
        )}
      </div>

      <div className="grid items-stretch gap-3 lg:grid-cols-5">
        <section
          aria-label="Live meal status"
          className="flex h-full flex-col lg:col-span-3 rounded-lg border border-line bg-gradient-to-br from-raised to-surface p-3 shadow-sm"
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2 text-[11.5px] font-bold tracking-wider text-rose-400">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-500" />
              </span>
              LIVE · {prettyDate(today)}
            </span>
            {pinned && (
              <button onClick={() => setPinned(null)} className="text-[11.5px] text-blue-400 hover:underline">
                Back to automatic
              </button>
            )}
          </div>
          {!focus ? (
            <div className="py-3">
              <p className="text-xs font-medium">Today's menu hasn't been published yet.</p>
              {canManageMenu && !loading && (
                <button
                  disabled={creating}
                  className={cx(btnPrimary, 'mt-3 rounded-lg px-3 py-2 text-xs')}
                  onClick={() => {
                    setDate(today);
                    createMenu(today, previousDayWithMenu || undefined);
                  }}
                >
                  <Plus className="h-3.5 w-3.5" />
                  {creating ? 'Creating…' : "Create today's menu"}
                </button>
              )}
            </div>
          ) : (
            <div className="flex flex-1 flex-col">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-lg font-bold tracking-tight">{focus.label}</h2>
                  <p className={cx('mt-0.5 flex items-center gap-1 text-[11.5px]', muted)}>
                    <Clock className="h-3 w-3" />
                    {fmtTime(focus.start)}–{fmtTime(focus.end)}
                  </p>
                </div>
                <StatusBadge s={focus.status} dark={dark} />
              </div>
              <p className={cx('mt-2 truncate text-xs', muted)}>
                {dishes(focus.items).join(' · ') || 'Dishes not added yet.'}
              </p>
              <ol className="mt-auto grid grid-cols-2 sm:grid-cols-4 gap-1.5 pt-4" aria-label="Meal progress">
                {STATUS_STEPS.slice(1).map((step, i) => {
                  const cur = STATUS_STEPS.findIndex(s => s.key === focus.status);
                  const reached = cur >= i + 1;
                  const isCurrent = cur === i + 1;
                  const stepClass = cx(
                    'w-full rounded-lg border p-2 text-left transition-colors',
                    reached ? statusTone(step.key, dark) : 'border-line text-faint',
                    isCurrent && 'ring-1 ring-current',
                  );
                  const content = (
                    <>
                      <span className="block text-[10px] font-bold uppercase tracking-wider opacity-70">
                        Step {i + 1}
                      </span>
                      <span className="mt-0.5 block text-[11.5px] font-semibold">{step.label}</span>
                    </>
                  );
                  return (
                    <li key={step.key}>
                      {canManageMenu ? (
                        <button
                          type="button"
                          className={cx(stepClass, 'hover:opacity-90')}
                          aria-pressed={isCurrent}
                          onClick={() => setMealStatus(focus.id, step.key)}
                        >
                          {content}
                        </button>
                      ) : (
                        <div className={stepClass} aria-current={isCurrent ? 'step' : undefined}>
                          {content}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10.5px]">
                <span className={muted}>
                  {focus.changedAt
                    ? `Updated ${timeAgo(focus.changedAt)}${focus.changedBy ? ` by ${focus.changedBy}` : ''}`
                    : 'Not started yet'}
                </span>
                {canManageMenu && focus.status !== 'scheduled' && (
                  <button
                    className="text-blue-400 hover:underline"
                    onClick={() => setMealStatus(focus.id, 'scheduled')}
                  >
                    Reset
                  </button>
                )}
              </div>
            </div>
          )}
        </section>

        <section aria-label="Today's schedule" className={cx('h-full lg:col-span-2 rounded-lg border p-3', card(dark))}>
          <h2 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider">
            <Clock className="h-4 w-4 text-blue-500" />
            Today's schedule
          </h2>
          {!todays.length ? (
            <p className={cx('text-xs', muted)}>Nothing scheduled yet.</p>
          ) : (
            <ol className="relative space-y-2 border-l border-line-strong pl-4">
              {[...todays]
                .sort((a, b) => minutesOf(a.start) - minutesOf(b.start))
                .map(meal => {
                  const isFocus = meal.id === focus?.id;
                  const dot =
                    meal.status === 'distributed'
                      ? 'bg-emerald-500'
                      : meal.status === 'distributing'
                        ? 'bg-blue-500'
                        : meal.status === 'preparing'
                          ? 'bg-amber-500'
                          : 'bg-faint';
                  return (
                    <li key={meal.id} className="relative">
                      <span
                        className={cx('absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full ring-2 ring-surface', dot)}
                      />
                      <button
                        type="button"
                        onClick={() => setPinned(meal.id === auto?.id ? null : meal.id)}
                        className={cx(
                          'w-full rounded-md px-2 py-1 text-left transition-colors hover:bg-raised',
                          isFocus && 'bg-brand-soft',
                        )}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs font-semibold">{meal.label}</span>
                          <StatusBadge s={meal.status} dark={dark} />
                        </span>
                        <span className={cx('mt-0.5 block text-[10.5px]', muted)}>
                          {fmtTime(meal.start)}–{fmtTime(meal.end)}
                          {dishes(meal.items).length ? ` · ${dishes(meal.items).join(', ')}` : ''}
                        </span>
                      </button>
                    </li>
                  );
                })}
            </ol>
          )}
        </section>
      </div>

      {/* ---------------- MENU CHART ---------------- */}
      <section aria-label="Menu planner" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-bold flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-blue-500" />
            Menu chart
          </h2>
          <PillTabs
            label="Chart view"
            value={view}
            onChange={id => setView(id as typeof view)}
            className="inline-flex flex-nowrap rounded-lg bg-raised p-1"
            itemClassName="px-3 py-1.5 text-[11.5px] font-semibold"
            tabs={[
              { id: 'day', label: 'Day' },
              { id: 'all', label: 'All days' },
            ]}
          />
        </div>

        {view === 'day' && (
          <>
            <div className="flex items-center gap-2">
              <button
                aria-label="Previous day"
                className={cx(btnGhost(dark), 'rounded-lg px-2 py-1.5')}
                onClick={() => setDate(shiftDate(date, -1))}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <input
                type="date"
                aria-label="Menu date"
                value={date}
                onChange={e => e.target.value && setDate(e.target.value)}
                className={cx(inputCls(dark), 'w-auto rounded-lg py-1.5 text-xs')}
              />
              <button
                aria-label="Next day"
                className={cx(btnGhost(dark), 'rounded-lg px-2 py-1.5')}
                onClick={() => setDate(shiftDate(date, 1))}
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              {date !== today && (
                <button
                  className={cx(btnGhost(dark), 'rounded-lg px-2.5 py-1.5 text-xs')}
                  onClick={() => setDate(today)}
                >
                  Today
                </button>
              )}
              <span className={cx('hidden sm:inline text-xs ml-1', muted)}>{prettyDate(date, true)}</span>
            </div>

            {dayRows.length === 0 ? (
              <div className={cx('rounded-xl border p-8 text-center', card(dark))}>
                <UtensilsCrossed className="w-7 h-7 mx-auto mb-2 text-faint" />
                <p className="font-semibold">No menu for this day yet</p>
                {canManageMenu ? (
                  <div className="flex flex-wrap justify-center gap-2 mt-4">
                    <button disabled={creating} className={btnPrimary} onClick={() => createMenu(date)}>
                      <Plus className="w-4 h-4" />
                      {creating ? 'Creating…' : 'Create menu'}
                    </button>
                    {previousDayWithMenu && (
                      <button
                        disabled={creating}
                        className={btnGhost(dark)}
                        onClick={() => createMenu(date, previousDayWithMenu)}
                      >
                        <Copy className="w-3.5 h-3.5" />
                        Copy from {prettyDate(previousDayWithMenu)}
                      </button>
                    )}
                  </div>
                ) : (
                  <p className={cx('text-sm mt-1', muted)}>
                    It will appear here once the Accommodation head or owner publishes it.
                  </p>
                )}
              </div>
            ) : (
              <>
                <div className={cx('rounded-xl border divide-y divide-line', card(dark))}>
                  {dayRows.map(m => (
                    <div key={m.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start">
                      <div className="sm:w-44 shrink-0">
                        <div className="text-xs font-semibold">{m.label}</div>
                        <div className={cx('text-xs flex items-center gap-1 mt-0.5', muted)}>
                          <Clock className="w-3 h-3" />
                          {fmtTime(m.start)} – {fmtTime(m.end)}
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        {dishes(m.items).length ? (
                          <ul className="list-inside list-disc space-y-0.5 text-xs">
                            {dishes(m.items).map((d, i) => (
                              <li key={i}>{d}</li>
                            ))}
                          </ul>
                        ) : (
                          <span className={cx('text-xs italic', muted)}>Dishes not added yet</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 sm:flex-col sm:items-end">
                        {m.date === today && <StatusBadge s={m.status} dark={dark} />}
                        {canManageMenu && (
                          <div className="flex gap-1.5">
                            <button
                              className={btnGhost(dark)}
                              onClick={() => setEditing(m)}
                              aria-label={`Edit ${m.label}`}
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                              Edit
                            </button>
                            <button
                              className={cx(btnGhost(dark), 'text-rose-500')}
                              onClick={() => setRemoving(m)}
                              aria-label={`Remove ${m.label}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                {canManageMenu && (
                  <div className="flex flex-wrap gap-2">
                    {MEAL_PRESETS.filter(sl => !dayRows.some(r => r.meal === sl.key)).map(sl => (
                      <button key={sl.key} className={btnGhost(dark)} onClick={() => addMeal(date, sl.label)}>
                        <Plus className="w-3.5 h-3.5" />
                        {sl.label}
                      </button>
                    ))}
                    <button className={btnGhost(dark)} onClick={() => setAddingMeal(true)}>
                      <Plus className="w-3.5 h-3.5" />
                      Custom meal…
                    </button>
                    <button className={cx(btnGhost(dark), 'text-rose-500')} onClick={() => setConfirmDelete(true)}>
                      <Trash2 className="w-3.5 h-3.5" />
                      Delete this day
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {view === 'all' && (
          <AllDays
            dark={dark}
            onPick={d => {
              setDate(d);
              setView('day');
            }}
          />
        )}
      </section>

      {editing && (
        <MealForm dark={dark} meal={editing} onClose={() => setEditing(null)} onSave={v => saveMeal(editing.id, v)} />
      )}
      {addingMeal && <AddMealForm dark={dark} date={date} onClose={() => setAddingMeal(false)} onAdd={addMeal} />}
      {removing && (
        <ConfirmModal
          dark={dark}
          title={`Remove ${removing.label}?`}
          body={`${removing.label} on ${prettyDate(removing.date)} and its dishes will be deleted.`}
          confirmLabel="Remove"
          onConfirm={() => deleteMeal(removing.id)}
          onClose={() => setRemoving(null)}
        />
      )}
      {confirmDelete && (
        <ConfirmModal
          dark={dark}
          title={`Delete menu for ${prettyDate(date)}?`}
          body="Every meal for this day will be removed."
          confirmLabel="Delete"
          onConfirm={() => deleteDay(date)}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
};
