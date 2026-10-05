import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Clock3 } from 'lucide-react';

const WEEK = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const pad = (n: number) => String(n).padStart(2, '0');
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const monthName = (d: Date) => d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

export const MeetingDatePicker: React.FC<{ value: string; onChange: (value: string) => void }> = ({ value, onChange }) => {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => { const d = value ? new Date(`${value}T00:00:00`) : new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const days = useMemo(() => {
    const start = new Date(month.getFullYear(), month.getMonth(), 1);
    start.setDate(1 - start.getDay());
    return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  }, [month]);
  useEffect(() => { if (value) { const d = new Date(`${value}T00:00:00`); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); } }, [value]);
  return <div className="relative">
    <button type="button" onClick={() => setOpen(v => !v)} className="flex h-10 w-full items-center gap-2 rounded-lg border border-line bg-field px-3 text-left text-sm text-ink hover:border-blue-500/60">
      <CalendarDays size={16} className="text-blue-400" />{value ? new Date(`${value}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }) : <span className="text-mute">Choose meeting date</span>}
    </button>
    {open && <div className="absolute left-0 top-full z-30 mt-2 w-[19rem] rounded-xl border border-line bg-surface p-3 shadow-2xl">
      <div className="mb-3 flex items-center justify-between"><button type="button" aria-label="Previous month" onClick={() => setMonth(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-raised"><ChevronLeft size={16} /></button><div className="text-sm font-semibold text-ink">{monthName(month)}</div><button type="button" aria-label="Next month" onClick={() => setMonth(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-raised"><ChevronRight size={16} /></button></div>
      <div className="grid grid-cols-7 text-center text-[10px] font-semibold uppercase text-faint">{WEEK.map(d => <span key={d} className="py-1">{d}</span>)}</div>
      <div className="grid grid-cols-7 gap-y-1">{days.map((d, i) => { const selected = value === localDate(d); const sameMonth = d.getMonth() === month.getMonth(); return <button key={i} type="button" onClick={() => { onChange(localDate(d)); setOpen(false); }} className={`mx-auto grid h-9 w-9 place-items-center rounded-lg text-xs transition-colors ${selected ? 'bg-blue-600 font-semibold text-white shadow-md shadow-blue-600/20' : sameMonth ? 'text-ink hover:bg-raised' : 'text-faint/60 hover:bg-raised'}`}>{d.getDate()}</button>; })}</div>
      <div className="mt-3 flex justify-between border-t border-line pt-2"><button type="button" onClick={() => { onChange(''); setOpen(false); }} className="text-xs text-mute hover:text-ink">Clear</button><button type="button" onClick={() => { onChange(localDate(new Date())); setOpen(false); }} className="text-xs font-medium text-blue-400 hover:text-blue-300">Today</button></div>
    </div>}
  </div>;
};

export const MeetingTimePicker: React.FC<{ value: string; onChange: (value: string) => void }> = ({ value, onChange }) => {
  const [open, setOpen] = useState(false);
  const [part, setPart] = useState<'hour' | 'minute'>('hour');
  const [hour, setHour] = useState(() => value ? Number(value.slice(0, 2)) % 12 || 12 : 9);
  const [period, setPeriod] = useState<'AM' | 'PM'>(() => Number(value.slice(0, 2) || 9) >= 12 ? 'PM' : 'AM');
  const [minute, setMinute] = useState(() => value ? Math.floor(Number(value.slice(3, 5)) / 5) * 5 : 0);
  useEffect(() => { if (value) { const h = Number(value.slice(0, 2)); setHour(h % 12 || 12); setPeriod(h >= 12 ? 'PM' : 'AM'); setMinute(Math.floor(Number(value.slice(3, 5)) / 5) * 5); } }, [value]);
  const dial = Array.from({ length: 12 }, (_, i) => part === 'hour' ? (i === 0 ? 12 : i) : i * 5);
  const commit = (h: number, m: number) => { let h24 = h % 12; if (period === 'PM') h24 += 12; onChange(`${pad(h24)}:${pad(m)}`); setOpen(false); setPart('hour'); };
  return <div className="relative">
    <button type="button" onClick={() => { setPart('hour'); setOpen(v => !v); }} className="flex h-10 w-full items-center gap-2 rounded-lg border border-line bg-field px-3 text-left text-sm text-ink hover:border-blue-500/60"><Clock3 size={16} className="text-blue-400" />{value ? new Date(`2000-01-01T${value}`).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : <span className="text-mute">Choose time</span>}</button>
    {open && <div className="absolute left-0 top-full z-30 mt-2 w-[18rem] rounded-xl border border-line bg-surface p-4 shadow-2xl">
      <div className="mb-3 flex items-center justify-between"><div className="text-[10px] font-semibold uppercase tracking-wider text-faint">Select {part}</div><div className="flex items-center gap-1 rounded-lg bg-raised p-1"><button type="button" onClick={() => setPeriod('AM')} className={`rounded-md px-2 py-1 text-[10px] ${period === 'AM' ? 'bg-blue-600 text-white' : 'text-mute'}`}>AM</button><button type="button" onClick={() => setPeriod('PM')} className={`rounded-md px-2 py-1 text-[10px] ${period === 'PM' ? 'bg-blue-600 text-white' : 'text-mute'}`}>PM</button></div></div>
      <div className="relative mx-auto h-52 w-52 rounded-full border border-line bg-raised/70">
        <div className="absolute left-1/2 top-1/2 z-10 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500" />
        {dial.map((n, i) => { const angle = (i * 30 - 90) * Math.PI / 180; const x = 50 + Math.cos(angle) * 39; const y = 50 + Math.sin(angle) * 39; const selected = part === 'hour' ? hour === n : minute === n; return <button key={n} type="button" onClick={() => { if (part === 'hour') { setHour(n); setPart('minute'); } else { setMinute(n); commit(hour, n); } }} className={`absolute z-20 grid h-8 w-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full text-xs ${selected ? 'bg-blue-600 font-semibold text-white' : 'text-ink hover:bg-blue-500/15 hover:text-blue-300'}`} style={{ left: `${x}%`, top: `${y}%` }}>{part === 'hour' ? pad(n) : pad(n)}</button>; })}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[10px] text-faint">{part === 'hour' ? 'hour' : `${pad(hour)} ${period}`}</div>
      </div>
      <div className="mt-3 flex items-center justify-between"><button type="button" onClick={() => setPart(part === 'hour' ? 'minute' : 'hour')} className="text-xs text-blue-400">{part === 'hour' ? 'Choose minutes' : 'Back to hours'}</button><button type="button" onClick={() => { commit(hour, minute); }} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white">Use {pad(hour)}:{pad(minute)} {period}</button></div>
    </div>}
  </div>;
};
