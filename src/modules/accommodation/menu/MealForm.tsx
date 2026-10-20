import React, { useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { MealRow } from '../types';
import { prettyDate } from '../dates';
import { Modal, btnGhost, btnPrimary, inputCls, labelCls } from '../ui';
import { ClockTimePicker } from '../../../components/ClockTimePicker';
import { dishes } from './shared';

export const MealForm: React.FC<{
  dark: boolean;
  meal: MealRow;
  onClose: () => void;
  onSave: (v: { start: string; end: string; items: string }) => Promise<boolean>;
}> = ({ dark, meal, onClose, onSave }) => {
  const [start, setStart] = useState(meal.start);
  const [end, setEnd] = useState(meal.end);
  const [list, setList] = useState<string[]>(dishes(meal.items));
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const addDish = () => {
    const parts = draft
      .split(/[\n,]/)
      .map(x => x.trim())
      .filter(Boolean);
    if (parts.length) setList(l => [...l, ...parts.filter(p => !l.includes(p))]);
    setDraft('');
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const pending = draft
      .split(/[\n,]/)
      .map(x => x.trim())
      .filter(Boolean);
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
          <div>
            <label className={labelCls(dark)}>Starts</label>
            <ClockTimePicker label="Meal start time" value={start} onChange={setStart} className="mt-1" />
          </div>
          <div>
            <label className={labelCls(dark)}>Ends</label>
            <ClockTimePicker label="Meal end time" value={end} onChange={setEnd} className="mt-1" />
          </div>
        </div>
        <div>
          <label className={labelCls(dark)} htmlFor="mi">
            Dishes
          </label>
          <div className="flex gap-2">
            <input
              id="mi"
              autoFocus
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addDish();
                }
              }}
              placeholder="Type a dish, press Enter"
              className={inputCls(dark)}
            />
            <button type="button" onClick={addDish} className={btnGhost(dark)}>
              <Plus className="w-4 h-4" />
              Add
            </button>
          </div>
          <ul className="flex flex-wrap gap-2 mt-3">
            {list.map((d, i) => (
              <li
                key={d + i}
                className="inline-flex items-center gap-1.5 text-sm pl-3 pr-1.5 py-1 rounded-full border border-line bg-raised"
              >
                {d}
                <button
                  type="button"
                  aria-label={`Remove ${d}`}
                  onClick={() => setList(l => l.filter((_, j) => j !== i))}
                  className="p-0.5 rounded-full hover:bg-rose-500/20 text-rose-500"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
            {!list.length && <li className="text-xs italic text-faint">No dishes yet.</li>}
          </ul>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnGhost(dark)}>
            Cancel
          </button>
          <button type="submit" disabled={busy} className={btnPrimary}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
};

export const AddMealForm: React.FC<{
  dark: boolean;
  date: string;
  onClose: () => void;
  onAdd: (date: string, label: string, start?: string, end?: string) => Promise<boolean>;
}> = ({ dark, date, onClose, onAdd }) => {
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
        <div>
          <label className={labelCls(dark)} htmlFor="cm-n">
            Meal name
          </label>
          <input
            id="cm-n"
            autoFocus
            required
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Late-night snack"
            className={inputCls(dark)}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls(dark)}>Starts</label>
            <ClockTimePicker label="Meal start time" value={start} onChange={setStart} className="mt-1" />
          </div>
          <div>
            <label className={labelCls(dark)}>Ends</label>
            <ClockTimePicker label="Meal end time" value={end} onChange={setEnd} className="mt-1" />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnGhost(dark)}>
            Cancel
          </button>
          <button type="submit" disabled={busy} className={btnPrimary}>
            {busy ? 'Adding…' : 'Add meal'}
          </button>
        </div>
      </form>
    </Modal>
  );
};
