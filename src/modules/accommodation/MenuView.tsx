import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Clock, Copy, Edit3, Lock, Plus, Trash2, UtensilsCrossed, X } from 'lucide-react';
import { useAccommodation } from './AccommodationContext';
import { MEAL_PRESETS, STATUS_STEPS } from './types';
import type { MealRow } from './types';
import { fmtTime, minutesOf, nowMinutes, prettyDate, shiftDate, timeAgo, todayStr } from './dates';
import { pickLive, statusTone } from './live';
import { Modal, ConfirmModal, btnGhost, btnPrimary, card, cx, inputCls, labelCls } from './ui';

const dishes = (items: string) => items.split('\n').map(s => s.trim()).filter(Boolean);

const StatusBadge: React.FC<{ s: MealRow['status']; dark: boolean }> = ({ s, dark }) => (
  <span className={cx('text-xs font-bold px-2 py-0.5 rounded-full border whitespace-nowrap', statusTone(s, dark))}>
    {STATUS_STEPS.find(x => x.key === s)?.label}
  </span>
);

// A ticking "now" so the live card re-evaluates which meal is current.
const useNow = () => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(t); }, []);
  return now;
};

export const MenuView: React.FC = () => {
  const { meals, mealsOn, canManageMenu, isDark: dark, loading, createDay, saveMeal, setMealStatus, deleteDay, addMeal, deleteMeal } = useAccommodation();
  const now = useNow();
  const today = todayStr();
  const muted = dark ? 'text-slate-400' : 'text-slate-500';

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

  const dayRows = useMemo(() => [...mealsOn(date)].sort((a, b) => minutesOf(a.start) - minutesOf(b.start)), [mealsOn, date, meals]);
  const previousDayWithMenu = useMemo(() => {
    const ds = Array.from(new Set(meals.map(m => m.date))).filter(d => d < date).sort();
    return ds.length ? ds[ds.length - 1] : '';
  }, [meals, date]);
  const createMenu = async (target: string, source?: string) => {
    if (creating) return;
    setCreating(true);
    try { await createDay(target, source); }
    finally { setCreating(false); }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Menu &amp; Live Status</h1>
          <p className={cx('text-sm', muted)}>What is served when, and where each meal is right now.</p>
        </div>
        {!canManageMenu && <p className={cx('flex items-center gap-1.5 text-xs', muted)}><Lock className="w-3.5 h-3.5" />View only — the Accommodation head or owner updates this.</p>}
      </div>

      <div className="grid gap-5 lg:grid-cols-5 items-start">
      {/* ---------------- LIVE CARD ---------------- */}
      <section aria-label="Live meal status" className={cx('lg:col-span-3 rounded-xl border p-5 sm:p-6', dark ? 'bg-gradient-to-br from-slate-900 to-slate-900/60 border-slate-700' : 'bg-gradient-to-br from-blue-50 to-white border-blue-200 shadow-sm')}>
        <div className="flex items-center justify-between gap-2 mb-4">
          <span className="inline-flex items-center gap-2 text-xs font-bold tracking-wider text-rose-500">
            <span className="relative flex h-2.5 w-2.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" /><span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500" /></span>
            LIVE · {prettyDate(today)}
          </span>
          {pinned && <button onClick={() => setPinned(null)} className="text-xs text-blue-500 hover:underline">Back to auto</button>}
        </div>

        {!focus ? (
          <div className="py-4">
            <UtensilsCrossed className="w-7 h-7 text-slate-400 mb-2" />
            <p className="font-semibold">Today's menu hasn't been published yet.</p>
            {canManageMenu && !loading && (
              <button disabled={creating} className={cx(btnPrimary, 'mt-3')} onClick={() => { setDate(today); createMenu(today, previousDayWithMenu || undefined); }}><Plus className="w-4 h-4" />{creating ? 'Creating…' : "Create today's menu"}</button>
            )}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-3xl font-extrabold tracking-tight">{focus.label}</h2>
                <p className={cx('flex items-center gap-1.5 text-sm mt-0.5', muted)}><Clock className="w-3.5 h-3.5" />{fmtTime(focus.start)} – {fmtTime(focus.end)}</p>
              </div>
              <StatusBadge s={focus.status} dark={dark} />
            </div>

            {dishes(focus.items).length > 0 ? (
              <ul className="flex flex-wrap gap-2 mt-4">
                {dishes(focus.items).map((d, i) => <li key={i} className={cx('text-sm px-3 py-1.5 rounded-full border', dark ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200')}>{d}</li>)}
              </ul>
            ) : <p className={cx('text-sm mt-4 italic', muted)}>Dishes not added yet.</p>}

            {/* Stage tracker: Preparation → Distribution → Distributed */}
            <ol className="grid grid-cols-3 gap-2 mt-6" aria-label="Meal progress">
              {STATUS_STEPS.slice(1).map((step, i) => {
                const cur = STATUS_STEPS.findIndex(s => s.key === focus.status);
                const reached = cur >= i + 1;
                const isCurrent = cur === i + 1;
                const base = cx('w-full text-left rounded-xl border p-3 transition-colors', reached ? statusTone(step.key, dark) : (dark ? 'border-slate-700 text-slate-500' : 'border-slate-200 text-slate-400'), isCurrent && 'ring-2 ring-current');
                const inner = (<><div className="text-xs font-bold uppercase tracking-wider opacity-70">Step {i + 1}</div><div className="text-sm font-bold mt-0.5">{step.label}</div></>);
                return (
                  <li key={step.key}>
                    {canManageMenu ? (
                      <button className={cx(base, 'hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400')} aria-pressed={isCurrent} onClick={() => setMealStatus(focus.id, step.key)}>{inner}</button>
                    ) : <div className={base} aria-current={isCurrent ? 'step' : undefined}>{inner}</div>}
                  </li>
                );
              })}
            </ol>

            <div className="flex flex-wrap items-center justify-between gap-2 mt-3 text-xs">
              <span className={muted}>{focus.changedAt ? `Updated ${timeAgo(focus.changedAt)}${focus.changedBy ? ` by ${focus.changedBy}` : ''}` : 'Not started yet'}</span>
              {canManageMenu && focus.status !== 'scheduled' && <button className="text-blue-500 hover:underline" onClick={() => setMealStatus(focus.id, 'scheduled')}>Reset to "Not started"</button>}
            </div>

          </>
        )}
      </section>

      {/* ---------------- TODAY'S SCHEDULE ---------------- */}
      <section aria-label="Today's schedule" className={cx('lg:col-span-2 rounded-xl border p-5', card(dark))}>
        <h2 className="text-sm font-bold uppercase tracking-wider mb-4 flex items-center gap-2"><Clock className="w-4 h-4 text-blue-500" />Today's schedule</h2>
        {todays.length === 0 ? <p className={cx('text-sm', muted)}>Nothing scheduled yet.</p> : (
          <ol className="relative space-y-4 pl-6 before:absolute before:left-[7px] before:top-1.5 before:bottom-1.5 before:w-px before:bg-slate-500/30">
            {[...todays].sort((a, b) => minutesOf(a.start) - minutesOf(b.start)).map(m => {
              const isFocus = m.id === focus?.id;
              const dot = m.status === 'distributed' ? 'bg-emerald-500' : m.status === 'distributing' ? 'bg-blue-500' : m.status === 'preparing' ? 'bg-amber-500' : 'bg-slate-400';
              return (
                <li key={m.id} className="relative">
                  <span className={cx('absolute -left-6 top-1 w-3.5 h-3.5 rounded-full ring-4', dot, dark ? 'ring-slate-900' : 'ring-white', m.status !== 'scheduled' && m.status !== 'distributed' && 'animate-pulse')} />
                  <button onClick={() => setPinned(m.id === auto?.id ? null : m.id)} className={cx('w-full text-left rounded-xl p-2 -m-2 transition-colors', isFocus && (dark ? 'bg-slate-800' : 'bg-blue-50'))}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-sm">{m.label}</span>
                      <StatusBadge s={m.status} dark={dark} />
                    </div>
                    <div className={cx('text-xs mt-0.5', muted)}>{fmtTime(m.start)} – {fmtTime(m.end)}</div>
                    {dishes(m.items).length > 0 && <div className={cx('text-xs mt-1 truncate', muted)}>{dishes(m.items).join(' · ')}</div>}
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </section>
      </div>

      {/* ---------------- MENU CHART ---------------- */}
      <section aria-label="Menu chart" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold flex items-center gap-2"><CalendarDays className="w-5 h-5 text-blue-500" />Menu chart</h2>
          <div role="tablist" aria-label="Chart view" className={cx('inline-flex p-1 rounded-xl', dark ? 'bg-slate-900' : 'bg-slate-100')}>
            {([['day', 'Day'], ['all', 'All days']] as const).map(([k, l]) => (
              <button key={k} role="tab" aria-selected={view === k} onClick={() => setView(k)} className={cx('px-4 py-1.5 rounded-lg text-xs font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400', view === k ? 'bg-blue-600 text-white shadow' : muted)}>{l}</button>
            ))}
          </div>
        </div>

        {view === 'day' && (
          <>
            <div className="flex items-center gap-2">
              <button aria-label="Previous day" className={btnGhost(dark)} onClick={() => setDate(shiftDate(date, -1))}><ChevronLeft className="w-4 h-4" /></button>
              <input type="date" aria-label="Menu date" value={date} onChange={e => e.target.value && setDate(e.target.value)} className={cx(inputCls(dark), 'w-auto')} />
              <button aria-label="Next day" className={btnGhost(dark)} onClick={() => setDate(shiftDate(date, 1))}><ChevronRight className="w-4 h-4" /></button>
              {date !== today && <button className={btnGhost(dark)} onClick={() => setDate(today)}>Today</button>}
              <span className={cx('hidden sm:inline text-sm ml-1', muted)}>{prettyDate(date, true)}</span>
            </div>

            {dayRows.length === 0 ? (
              <div className={cx('rounded-xl border p-8 text-center', card(dark))}>
                <UtensilsCrossed className="w-7 h-7 mx-auto mb-2 text-slate-400" />
                <p className="font-semibold">No menu for this day yet</p>
                {canManageMenu ? (
                  <div className="flex flex-wrap justify-center gap-2 mt-4">
                    <button disabled={creating} className={btnPrimary} onClick={() => createMenu(date)}><Plus className="w-4 h-4" />{creating ? 'Creating…' : 'Create menu'}</button>
                    {previousDayWithMenu && <button disabled={creating} className={btnGhost(dark)} onClick={() => createMenu(date, previousDayWithMenu)}><Copy className="w-3.5 h-3.5" />Copy from {prettyDate(previousDayWithMenu)}</button>}
                  </div>
                ) : <p className={cx('text-sm mt-1', muted)}>It will appear here once the Accommodation head or owner publishes it.</p>}
              </div>
            ) : (
              <>
                <div className={cx('rounded-xl border divide-y', card(dark), dark ? 'divide-slate-800' : 'divide-slate-100')}>
                  {dayRows.map(m => (
                    <div key={m.id} className="p-4 flex flex-col sm:flex-row sm:items-start gap-3">
                      <div className="sm:w-44 shrink-0">
                        <div className="font-bold">{m.label}</div>
                        <div className={cx('text-xs flex items-center gap-1 mt-0.5', muted)}><Clock className="w-3 h-3" />{fmtTime(m.start)} – {fmtTime(m.end)}</div>
                      </div>
                      <div className="flex-1 min-w-0">
                        {dishes(m.items).length ? <ul className="text-sm space-y-0.5 list-disc list-inside">{dishes(m.items).map((d, i) => <li key={i}>{d}</li>)}</ul> : <span className={cx('text-sm italic', muted)}>Dishes not added yet</span>}
                      </div>
                      <div className="flex items-center gap-2 sm:flex-col sm:items-end">
                        {m.date === today && <StatusBadge s={m.status} dark={dark} />}
                        {canManageMenu && (
                          <div className="flex gap-1.5">
                            <button className={btnGhost(dark)} onClick={() => setEditing(m)} aria-label={`Edit ${m.label}`}><Edit3 className="w-3.5 h-3.5" />Edit</button>
                            <button className={cx(btnGhost(dark), 'text-rose-500')} onClick={() => setRemoving(m)} aria-label={`Remove ${m.label}`}><Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                {canManageMenu && (
                  <div className="flex flex-wrap gap-2">
                    {MEAL_PRESETS.filter(sl => !dayRows.some(r => r.meal === sl.key)).map(sl => <button key={sl.key} className={btnGhost(dark)} onClick={() => addMeal(date, sl.label)}><Plus className="w-3.5 h-3.5" />{sl.label}</button>)}
                    <button className={btnGhost(dark)} onClick={() => setAddingMeal(true)}><Plus className="w-3.5 h-3.5" />Custom meal…</button>
                    <button className={cx(btnGhost(dark), 'text-rose-500')} onClick={() => setConfirmDelete(true)}><Trash2 className="w-3.5 h-3.5" />Delete this day</button>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {view === 'all' && <AllDays dark={dark} onPick={(d) => { setDate(d); setView('day'); }} />}
      </section>

      {editing && <MealForm dark={dark} meal={editing} onClose={() => setEditing(null)} onSave={(v) => saveMeal(editing.id, v)} />}
      {addingMeal && <AddMealForm dark={dark} date={date} onClose={() => setAddingMeal(false)} onAdd={addMeal} />}
      {removing && <ConfirmModal dark={dark} title={`Remove ${removing.label}?`} body={`${removing.label} on ${prettyDate(removing.date)} and its dishes will be deleted.`} confirmLabel="Remove" onConfirm={() => deleteMeal(removing.id)} onClose={() => setRemoving(null)} />}
      {confirmDelete && <ConfirmModal dark={dark} title={`Delete menu for ${prettyDate(date)}?`} body="Every meal for this day will be removed." confirmLabel="Delete" onConfirm={() => deleteDay(date)} onClose={() => setConfirmDelete(false)} />}
    </div>
  );
};

// ---------------------------------------------------------------------------
const AllDays: React.FC<{ dark: boolean; onPick: (d: string) => void }> = ({ dark, onPick }) => {
  const { meals } = useAccommodation();
  const muted = dark ? 'text-slate-400' : 'text-slate-500';
  const dates = Array.from(new Set(meals.map(m => m.date))).sort();
  const cols = Array.from(new Map(meals.map(m => [m.meal, m.label])).entries())
    .map(([key, label]) => ({ key, label, at: Math.min(...meals.filter(x => x.meal === key).map(x => minutesOf(x.start))) }))
    .sort((a, b) => a.at - b.at);
  if (!dates.length) return <div className={cx('rounded-xl border p-8 text-center text-sm', card(dark), muted)}>No menus published yet.</div>;
  return (
    <div className={cx('rounded-xl border overflow-x-auto', card(dark))}>
      <table className="w-full text-sm min-w-[40rem]">
        <thead>
          <tr className={cx('text-left text-xs uppercase tracking-wider', muted)}>
            <th className="px-4 py-3 font-semibold">Date</th>
            {cols.map(c => <th key={c.key} className="px-4 py-3 font-semibold">{c.label}</th>)}
          </tr>
        </thead>
        <tbody className={dark ? 'divide-y divide-slate-800' : 'divide-y divide-slate-100'}>
          {dates.map(d => (
            <tr key={d}>
              <td className="px-4 py-3 whitespace-nowrap"><button onClick={() => onPick(d)} className="font-semibold text-blue-500 hover:underline">{prettyDate(d)}</button></td>
              {cols.map(slot => {
                const m = meals.find(x => x.date === d && x.meal === slot.key);
                const list = m ? dishes(m.items) : [];
                return (
                  <td key={slot.key} className="px-4 py-3 align-top">
                    {m ? (<>
                      <div className={cx('text-xs mb-0.5', muted)}>{fmtTime(m.start)}</div>
                      <div>{list.slice(0, 3).join(', ') || <span className={cx('italic', muted)}>—</span>}{list.length > 3 && <span className={muted}> +{list.length - 3}</span>}</div>
                    </>) : <span className={muted}>—</span>}
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

const MealForm: React.FC<{ dark: boolean; meal: MealRow; onClose: () => void; onSave: (v: { start: string; end: string; items: string }) => Promise<boolean> }> = ({ dark, meal, onClose, onSave }) => {
  const [start, setStart] = useState(meal.start);
  const [end, setEnd] = useState(meal.end);
  const [list, setList] = useState<string[]>(dishes(meal.items));
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const addDish = () => {
    const parts = draft.split(/[\n,]/).map(x => x.trim()).filter(Boolean);
    if (parts.length) setList(l => [...l, ...parts.filter(p => !l.includes(p))]);
    setDraft('');
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const pending = draft.split(/[\n,]/).map(x => x.trim()).filter(Boolean);
    const all = [...list, ...pending.filter(p => !list.includes(p))];
    setBusy(true);
    const ok = await onSave({ start, end, items: all.join('\n') });
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <Modal title={`${meal.label} · ${prettyDate(meal.date)}`} dark={dark} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div><label className={labelCls(dark)} htmlFor="ms">Starts</label><input id="ms" type="time" required value={start} onChange={e => setStart(e.target.value)} className={inputCls(dark)} /></div>
          <div><label className={labelCls(dark)} htmlFor="me">Ends</label><input id="me" type="time" required value={end} onChange={e => setEnd(e.target.value)} className={inputCls(dark)} /></div>
        </div>
        <div>
          <label className={labelCls(dark)} htmlFor="mi">Dishes</label>
          <div className="flex gap-2">
            <input id="mi" autoFocus value={draft} onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addDish(); } }}
              placeholder="Type a dish, press Enter" className={inputCls(dark)} />
            <button type="button" onClick={addDish} className={btnGhost(dark)}><Plus className="w-4 h-4" />Add</button>
          </div>
          <ul className="flex flex-wrap gap-2 mt-3">
            {list.map((d, i) => (
              <li key={d + i} className={cx('inline-flex items-center gap-1.5 text-sm pl-3 pr-1.5 py-1 rounded-full border', dark ? 'bg-slate-800 border-slate-700' : 'bg-slate-50 border-slate-200')}>
                {d}
                <button type="button" aria-label={`Remove ${d}`} onClick={() => setList(l => l.filter((_, j) => j !== i))} className="p-0.5 rounded-full hover:bg-rose-500/20 text-rose-500"><X className="w-3.5 h-3.5" /></button>
              </li>
            ))}
            {!list.length && <li className="text-xs italic text-slate-400">No dishes yet.</li>}
          </ul>
        </div>
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className={btnGhost(dark)}>Cancel</button><button type="submit" disabled={busy} className={btnPrimary}>{busy ? 'Saving…' : 'Save'}</button></div>
      </form>
    </Modal>
  );
};

const AddMealForm: React.FC<{ dark: boolean; date: string; onClose: () => void; onAdd: (date: string, label: string, start?: string, end?: string) => Promise<boolean> }> = ({ dark, date, onClose, onAdd }) => {
  const [name, setName] = useState('');
  const [start, setStart] = useState('12:00');
  const [end, setEnd] = useState('13:00');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const ok = await onAdd(date, name, start, end);
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <Modal title={`Add a meal · ${prettyDate(date)}`} dark={dark} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div><label className={labelCls(dark)} htmlFor="cm-n">Meal name</label><input id="cm-n" autoFocus required value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Late-night snack" className={inputCls(dark)} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={labelCls(dark)} htmlFor="cm-s">Starts</label><input id="cm-s" type="time" required value={start} onChange={e => setStart(e.target.value)} className={inputCls(dark)} /></div>
          <div><label className={labelCls(dark)} htmlFor="cm-e">Ends</label><input id="cm-e" type="time" required value={end} onChange={e => setEnd(e.target.value)} className={inputCls(dark)} /></div>
        </div>
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className={btnGhost(dark)}>Cancel</button><button type="submit" disabled={busy} className={btnPrimary}>{busy ? 'Adding…' : 'Add meal'}</button></div>
      </form>
    </Modal>
  );
};
