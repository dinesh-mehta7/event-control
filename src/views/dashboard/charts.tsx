import React, { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, MinusCircle, TrendingUp } from 'lucide-react';

export type StaffingPoint = { date: string; expected: number; arrived: number };
export type DepartmentPoint = { name: string; expected: number; arrived: number };

export const fmtDay = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
export const fmtDate = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
export const coverage = (expected: number, arrived: number) => (expected > 0 ? Math.round((arrived / expected) * 100) : null);

// Measure the rendered width so the SVG is drawn in real pixels (text never stretches).
export const useWidth = <T extends HTMLElement>() => {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
};

// Clean axis for whole-number counts: a "nice" ceiling with up to 4 evenly spaced integer ticks.
export const niceTicks = (max: number, count = 4) => {
  const raw = Math.max(1, max) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, [1, 2, 5, 10].map(m => m * mag).find(s => s >= raw) || raw);
  const top = Math.ceil(Math.max(1, max) / step) * step;
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => Math.round(i * step));
};

// Column with a 4px rounded data-end and a square baseline.
export const colPath =(x: number, y: number, w: number, h: number) => {
  if (h <= 0) return '';
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
};

export const Legend: React.FC<{ items: { label: string; cls: string }[] }> = ({ items }) => (
  <div className="flex flex-wrap items-center gap-3 text-[11.5px] text-mute">
    {items.map(i => <span key={i.label} className="inline-flex items-center gap-1.5"><i className={`h-2.5 w-2.5 rounded-[3px] ${i.cls}`} />{i.label}</span>)}
  </div>
);
export const STAFFING_LEGEND = [{ label: 'Expected', cls: 'bg-chart-1' }, { label: 'Arrived', cls: 'bg-chart-2' }];

// ---- Expected vs arrived by date (grouped columns) ---------------------------------
export const StaffingTrendChart: React.FC<{ rows: StaffingPoint[]; selectedDate?: string; onSelect: (date: string) => void; height?: number }> = ({ rows, selectedDate, onSelect, height = 240 }) => {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const m = { l: 34, r: 8, t: 22, b: 26 };
  const ticks = useMemo(() => niceTicks(Math.max(...rows.flatMap(r => [r.expected, r.arrived]), 1)), [rows]);
  const max = ticks[ticks.length - 1];
  const plotW = Math.max(0, width - m.l - m.r); const plotH = height - m.t - m.b;
  const band = rows.length ? plotW / rows.length : 0;
  const barW = Math.max(3, Math.min(24, (band * 0.72 - 2) / 2));
  const y = (v: number) => m.t + plotH - (v / max) * plotH;
  const labelEvery = Math.max(1, Math.ceil(46 / Math.max(band, 1)));
  const active = hover ?? (selectedDate ? rows.findIndex(r => r.date === selectedDate) : -1);
  const tip = hover !== null ? rows[hover] : null;
  const tipLeft = hover !== null ? Math.min(Math.max(m.l + band * (hover + 0.5), 80), Math.max(80, width - 80)) : 0;

  return (
    <div ref={ref} className="relative w-full select-none" style={{ height }}>
      {width > 0 && <svg width={width} height={height} role="img" aria-label="Expected and arrived Sewadars by date. Select a date to see department coverage.">
        {ticks.map(t => <g key={t}>
          <line x1={m.l} x2={width - m.r} y1={y(t)} y2={y(t)} className="stroke-line" strokeWidth={1} />
          <text x={m.l - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-faint tabular-nums" style={{ fontSize: 11 }}>{t}</text>
        </g>)}
        {rows.map((r, i) => {
          const cx = m.l + band * (i + 0.5);
          const ex = cx - barW - 1; const ax = cx + 1;
          const on = i === active; const sel = r.date === selectedDate;
          return <g key={r.date}>
            {(on || sel) && <rect x={m.l + band * i + 1} y={m.t - 14} width={Math.max(0, band - 2)} height={plotH + 14} rx={6} className={sel ? 'fill-chart-1/10' : 'fill-ink/[0.04]'} />}
            <path d={colPath(ex, y(r.expected), barW, m.t + plotH - y(r.expected))} className="chart-grow-y fill-chart-1" style={{ ['--i' as any]: i }} />
            <path d={colPath(ax, y(r.arrived), barW, m.t + plotH - y(r.arrived))} className="chart-grow-y fill-chart-2" style={{ ['--i' as any]: i + 0.5 }} />
            {/* Values only on the date being looked at; the axis and tooltip carry the rest. */}
            {on && <>
              <text x={ex + barW / 2} y={y(r.expected) - 5} textAnchor="middle" className="animate-fade-in fill-ink font-semibold tabular-nums" style={{ fontSize: 11, animationDelay: '250ms' }}>{r.expected}</text>
              <text x={ax + barW / 2} y={y(r.arrived) - 5} textAnchor="middle" className="animate-fade-in fill-ink-soft font-semibold tabular-nums" style={{ fontSize: 11, animationDelay: '250ms' }}>{r.arrived}</text>
            </>}
            {(i % labelEvery === 0 || sel) && <text x={cx} y={height - 8} textAnchor="middle" className={sel ? 'fill-ink font-semibold' : 'fill-mute'} style={{ fontSize: 11 }}>{fmtDay(r.date)}</text>}
            <rect x={m.l + band * i} y={0} width={band} height={height} fill="transparent" className="cursor-pointer outline-none" tabIndex={0} role="button"
              aria-label={`${fmtDay(r.date)}: ${r.expected} expected, ${r.arrived} arrived`} aria-pressed={sel}
              onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
              onClick={e => { e.stopPropagation(); onSelect(r.date); }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(r.date); } }} />
          </g>;
        })}
        <line x1={m.l} x2={width - m.r} y1={m.t + plotH} y2={m.t + plotH} className="stroke-line-strong" strokeWidth={1} />
      </svg>}
      {tip && <div role="status" className="pointer-events-none absolute top-0 z-10 w-40 -translate-x-1/2 rounded-lg border border-line bg-surface px-3 py-2 text-[11.5px] shadow-lg" style={{ left: tipLeft }}>
        <div className="mb-1 font-medium text-mute">{fmtDate(tip.date)}</div>
        <div className="flex items-center justify-between gap-2"><span className="inline-flex items-center gap-1.5 text-mute"><i className="h-0.5 w-3 rounded bg-chart-1" />Expected</span><b className="tabular-nums text-ink">{tip.expected}</b></div>
        <div className="flex items-center justify-between gap-2"><span className="inline-flex items-center gap-1.5 text-mute"><i className="h-0.5 w-3 rounded bg-chart-2" />Arrived</span><b className="tabular-nums text-ink">{tip.arrived}</b></div>
        {coverage(tip.expected, tip.arrived) !== null && <div className="mt-1 border-t border-line pt-1 text-mute">Coverage <b className="tabular-nums text-ink">{coverage(tip.expected, tip.arrived)}%</b></div>}
      </div>}
    </div>
  );
};

// ---- Table view of the same data (accessibility + exact values) ----------------------
export const StaffingTable: React.FC<{ rows: StaffingPoint[]; selectedDate?: string; onSelect: (date: string) => void }> = ({ rows, selectedDate, onSelect }) => (
  <div className="max-h-72 overflow-auto rounded-lg border border-line">
    <table className="w-full text-left text-xs">
      <thead className="sticky top-0 bg-raised text-[10.5px] uppercase tracking-wide text-mute"><tr><th className="px-3 py-2 font-semibold">Date</th><th className="px-3 py-2 text-right font-semibold">Expected</th><th className="px-3 py-2 text-right font-semibold">Arrived</th><th className="px-3 py-2 text-right font-semibold">Coverage</th></tr></thead>
      <tbody className="divide-y divide-line">
        {rows.map(r => { const c = coverage(r.expected, r.arrived); return (
          <tr key={r.date} onClick={() => onSelect(r.date)} className={`cursor-pointer hover:bg-raised/50 ${r.date === selectedDate ? 'bg-brand/10' : ''}`}>
            <td className="px-3 py-2 text-ink-soft">{fmtDate(r.date)}</td><td className="px-3 py-2 text-right tabular-nums text-ink">{r.expected}</td><td className="px-3 py-2 text-right tabular-nums text-ink">{r.arrived}</td><td className="px-3 py-2 text-right tabular-nums text-mute">{c === null ? '—' : `${c}%`}</td>
          </tr>); })}
      </tbody>
    </table>
  </div>
);

// ---- Department coverage (bullet bars on one shared scale) ----------------------------
const statusOf = (r: DepartmentPoint) =>
  r.expected === 0 ? { label: 'No target', Icon: MinusCircle, cls: 'text-mute' }
  : r.arrived >= r.expected ? { label: r.arrived > r.expected ? `${r.arrived - r.expected} above` : 'Target met', Icon: r.arrived > r.expected ? TrendingUp : CheckCircle2, cls: 'text-emerald-300' }
  : { label: `${r.expected - r.arrived} short`, Icon: AlertTriangle, cls: 'text-amber-300' };

export const DepartmentCoverage: React.FC<{ rows: DepartmentPoint[] }> = ({ rows }) => {
  const active = rows.filter(r => r.expected > 0 || r.arrived > 0)
    .sort((a, b) => (b.expected - b.arrived) - (a.expected - a.arrived) || b.expected - a.expected);
  const idle = rows.filter(r => r.expected === 0 && r.arrived === 0);
  const max = Math.max(1, ...active.flatMap(r => [r.expected, r.arrived]));
  if (!active.length) return <p className="rounded-lg border border-dashed border-line p-6 text-center text-xs text-mute">No department has a target or arrivals on this date.</p>;
  return (
    <div>
      <ul className="stagger divide-y divide-line">
        {active.map(r => {
          const s = statusOf(r); const c = coverage(r.expected, r.arrived);
          return (
            <li key={r.name} className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 py-2.5 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_7rem_7.5rem]">
              <span className="truncate text-xs font-medium text-ink" title={r.name}>{r.name}</span>
              <div className="relative h-5" role="img" aria-label={`${r.name}: ${r.arrived} arrived of ${r.expected} expected`}>
                <div className="meter-fill absolute inset-y-[7px] left-0 rounded-sm bg-chart-1/25" style={{ width: `${(r.expected / max) * 100}%` }} />
                <div className="meter-fill chart-grow-x absolute inset-y-[5px] left-0 rounded-r-[4px] bg-chart-2" style={{ width: `${(r.arrived / max) * 100}%` }} />
                {r.expected > 0 && <div className="absolute inset-y-0 w-0.5 rounded bg-chart-1" style={{ left: `calc(${(r.expected / max) * 100}% - 1px)` }} title={`Target ${r.expected}`} />}
              </div>
              <span className="text-right text-xs tabular-nums text-ink"><b>{r.arrived}</b><span className="text-mute"> / {r.expected}</span>{c !== null && <span className="ml-2 text-mute">{c}%</span>}</span>
              <span className={`col-span-3 inline-flex items-center gap-1 text-[11.5px] sm:col-span-1 sm:justify-end ${s.cls}`}><s.Icon className="h-3.5 w-3.5" />{s.label}</span>
            </li>
          );
        })}
      </ul>
      {idle.length > 0 && <p className="mt-3 text-[11.5px] text-faint">No target or arrivals: {idle.map(r => r.name).join(' · ')}</p>}
    </div>
  );
};
// ---- Per-day columns: one series, or a second series overlaid on it (chart-1 under, chart-2 on top) ----
// The overlay is drawn a little narrower and centred, so both stay readable even when it is taller.
export type DayPoint = { date: string; value: number; value2?: number };
export const MiniColumns: React.FC<{ rows: DayPoint[]; height?: number; label: string; unit: string; unit2?: string; highlight?: string; onSelect?: (date: string) => void }> = ({ rows, height = 140, label, unit, unit2, highlight, onSelect }) => {
  const two = !!unit2;
  const gid = useId().replace(/:/g, '');
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const m = { l: 28, r: 6, t: 18, b: 22 };
  const ticks = useMemo(() => niceTicks(Math.max(...rows.flatMap(r => [r.value, r.value2 || 0]), 1), 3), [rows]);
  const max = ticks[ticks.length - 1];
  const plotW = Math.max(0, width - m.l - m.r); const plotH = height - m.t - m.b;
  const band = rows.length ? plotW / rows.length : 0;
  const barW = Math.max(4, Math.min(22, band * 0.62));
  const innerW = Math.max(2, Math.round(barW * 0.55));
  const y = (v: number) => m.t + plotH - (v / max) * plotH;
  const base = m.t + plotH;
  const labelEvery = Math.max(1, Math.ceil(44 / Math.max(band, 1)));
  const tip = hover !== null ? rows[hover] : null;
  const tipLeft = hover !== null ? Math.min(Math.max(m.l + band * (hover + 0.5), 72), Math.max(72, width - 72)) : 0;
  const tipOnLeft = hover !== null && hover > rows.length / 2;
  return (
    <div ref={ref} className={`relative w-full select-none ${onSelect ? 'cursor-pointer' : ''}`} style={{ height }}>
      {width > 0 && <svg width={width} height={height} role="img" aria-label={label} onPointerLeave={() => setHover(null)}>
        <defs>
          {/* Soft vertical gradients: full colour at the data end, fading slightly toward the baseline. */}
          <linearGradient id={`${gid}-a`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" style={{ stopColor: 'rgb(var(--c-chart-1))' }} /><stop offset="1" style={{ stopColor: 'rgb(var(--c-chart-1) / 0.55)' }} /></linearGradient>
          <linearGradient id={`${gid}-b`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" style={{ stopColor: 'rgb(var(--c-chart-2))' }} /><stop offset="1" style={{ stopColor: 'rgb(var(--c-chart-2) / 0.7)' }} /></linearGradient>
        </defs>
        {ticks.map(t => <g key={t}>
          {t > 0 && <line x1={m.l} x2={width - m.r} y1={y(t)} y2={y(t)} className="stroke-line" strokeWidth={1} strokeDasharray="2 4" />}
          <text x={m.l - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-faint tabular-nums" style={{ fontSize: 10.5 }}>{t}</text>
        </g>)}
        {rows.map((r, i) => {
          const cx = m.l + band * (i + 0.5); const on = hover === i; const today = r.date === highlight;
          const top = Math.min(y(r.value), two ? y(r.value2 || 0) : y(r.value));
          return <g key={r.date}>
            {(on || today) && <rect x={m.l + band * i + 1} y={m.t - 12} width={Math.max(0, band - 2)} height={plotH + 12} rx={6} className={on ? 'fill-ink/[0.05]' : 'fill-ink/[0.025]'} />}
            <path d={colPath(cx - barW / 2, y(r.value), barW, base - y(r.value))} fill={`url(#${gid}-a)`} className="chart-grow-y" style={{ ['--i' as any]: i }} />
            {two && <path d={colPath(cx - innerW / 2, y(r.value2 || 0), innerW, base - y(r.value2 || 0))} fill={`url(#${gid}-b)`} className="chart-grow-y stroke-surface" strokeWidth={1.5} paintOrder="stroke" style={{ ['--i' as any]: i + 0.4 }} />}
            {on && (r.value > 0 || (r.value2 || 0) > 0) && <text x={cx} y={top - 6} textAnchor="middle" className="animate-fade-in fill-ink font-semibold tabular-nums" style={{ fontSize: 11 }}>{two ? `${r.value} · ${r.value2 || 0}` : r.value}</text>}
            {(i % labelEvery === 0 || today) && <text x={cx} y={height - 6} textAnchor="middle" className={today ? 'fill-ink font-semibold' : on ? 'fill-ink' : 'fill-mute'} style={{ fontSize: 10.5 }}>{today ? 'Today' : fmtDay(r.date)}</text>}
            <rect x={m.l + band * i} y={0} width={band} height={height} fill="transparent" tabIndex={0} className="outline-none" role={onSelect ? 'button' : undefined}
              aria-label={`${fmtDay(r.date)}: ${r.value} ${unit}${two ? `, ${r.value2 || 0} ${unit2}` : ''}${onSelect ? '. Open details' : ''}`}
              onPointerEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
              onClick={onSelect ? () => onSelect(r.date) : undefined}
              onKeyDown={onSelect ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(r.date); } } : undefined} />
          </g>;
        })}
        <line x1={m.l} x2={width - m.r} y1={base} y2={base} className="stroke-line-strong" strokeWidth={1} />
      </svg>}
      {tip && <div role="status" className={`pointer-events-none absolute top-0 z-10 w-40 rounded-lg border border-line bg-surface/95 px-2.5 py-1.5 text-[11.5px] shadow-lg backdrop-blur ${tipOnLeft ? '-translate-x-[110%]' : 'translate-x-[10%]'}`} style={{ left: tipLeft }}>
        <div className="mb-0.5 font-medium text-mute">{fmtDate(tip.date)}</div>
        {two ? <>
          <div className="flex items-center justify-between gap-2"><span className="inline-flex items-center gap-1.5 capitalize text-mute"><i className="h-2 w-2 rounded-[2px] bg-chart-1" />{unit}</span><b className="tabular-nums text-ink">{tip.value}</b></div>
          <div className="flex items-center justify-between gap-2"><span className="inline-flex items-center gap-1.5 capitalize text-mute"><i className="h-2 w-2 rounded-[2px] bg-chart-2" />{unit2}</span><b className="tabular-nums text-ink">{tip.value2 || 0}</b></div>
        </> : <div><b className="tabular-nums text-ink">{tip.value}</b> <span className="text-mute">{unit}</span></div>}
        {onSelect && <div className="mt-1 border-t border-line pt-1 text-[10.5px] text-faint">Click for details</div>}
      </div>}
    </div>
  );
};
export const lastDays = (n: number) => Array.from({ length: n }, (_, i) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - (n - 1 - i)); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
export const dayKey = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export const COVERAGE_LEGEND =[{ label: 'Target (expected)', cls: 'bg-chart-1' }, { label: 'Arrived', cls: 'bg-chart-2' }];
