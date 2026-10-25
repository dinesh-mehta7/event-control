import React, { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { supabase } from '../lib/supabaseClient';
import { useEventScope } from '../../../context/EventScopeContext';
import { Radio, BatteryCharging, Headphones, Wrench, Pencil, ArrowRight } from 'lucide-react';
import * as XLSX from 'xlsx';

// Event walkie requests for the event in "Working on", stage by stage; each tile opens Event radio requests.
const PIPELINE = [
  ['To approve', ['pending_approval'], 'text-amber-300'],
  ['To allocate', ['approved'], 'text-blue-300'],
  ['Ready to hand over', ['ready'], 'text-violet-300'],
  ['With departments', ['delivered', 'partial_return'], 'text-cyan-300'],
  ['Returned', ['returned'], 'text-emerald-300'],
];
function EventPipeline() {
  const { currentUser, setCurrentTab } = useApp();
  const eventScope = useEventScope();
  const eventId = eventScope.scopeFor('walkie');
  const eventName = eventScope.events.find(e => e.id === eventId)?.name;
  const [rows, setRows] = useState([]);
  const orgId = currentUser?.organizationId;
  useEffect(() => {
    if (!orgId) return;
    let on = true;
    const load = () => {
      let q = supabase
        .from('event_radio_requests')
        .select('status,walkie_count,delivered_walkies,returned_walkies')
        .eq('organization_id', orgId);
      if (eventId) q = q.eq('event_id', eventId);
      q.then(({ data }) => on && setRows(data || []));
    };
    load();
    const ch = supabase
      .channel(`walkie-overview-${orgId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'event_radio_requests', filter: `organization_id=eq.${orgId}` },
        load,
      )
      .subscribe();
    return () => {
      on = false;
      supabase.removeChannel(ch);
    };
  }, [orgId, eventId]);
  if (!rows.length) return null;
  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">
          Event walkie requests{eventName ? ` · ${eventName}` : ' · all events'}
        </h2>
        <button
          type="button"
          onClick={() => setCurrentTab('requests')}
          className="inline-flex items-center gap-1 text-xs font-medium text-blue-300 hover:underline"
        >
          Open requests <ArrowRight className="h-3 w-3" />
        </button>
      </div>
      <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-5">
        {PIPELINE.map(([label, statuses, tone]) => {
          const list = rows.filter(r => statuses.includes(r.status));
          const radios = list.reduce(
            (t, r) => t + (statuses[0] === 'delivered' ? r.delivered_walkies - r.returned_walkies : r.walkie_count),
            0,
          );
          return (
            <button
              key={label}
              type="button"
              onClick={() => setCurrentTab('requests')}
              className="rounded-lg border border-line bg-raised/30 px-3 py-2.5 text-left transition-colors hover:bg-raised/60"
            >
              <div className="text-[10.5px] font-semibold uppercase tracking-wider text-faint">{label}</div>
              <div className={`mt-0.5 text-xl font-semibold tabular-nums ${tone}`}>{list.length}</div>
              <div className="text-[11px] text-mute">
                request{list.length === 1 ? '' : 's'} · {radios} walkie{radios === 1 ? '' : 's'}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function StockBreakdownChart({ title, total, out, free, fix, dark }) {
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const segments = [
    { label: 'Allocated', value: out, color: 'rgb(var(--c-chart-1))' },
    { label: 'Available', value: free, color: 'rgb(var(--c-chart-ok))' },
    { label: 'Maintenance', value: fix, color: 'rgb(var(--c-chart-3))' },
  ];
  let offset = 0;

  return (
    <div
      className="my-3 flex min-h-[104px] items-center justify-center gap-4"
      role="group"
      aria-label={`${title} stock breakdown`}
    >
      <div className="relative h-24 w-24 shrink-0">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden="true">
          <circle cx="50" cy="50" r={radius} fill="none" style={{ stroke: 'rgb(var(--c-line))' }} strokeWidth="10" />
          {segments.map(segment => {
            const length = total > 0 ? (Math.min(segment.value, total) / total) * circumference : 0;
            const segmentOffset = offset;
            offset += length;
            return (
              <circle
                key={segment.label}
                cx="50"
                cy="50"
                r={radius}
                fill="none"
                style={{ stroke: segment.color }}
                strokeWidth="10"
                strokeDasharray={`${length} ${circumference - length}`}
                strokeDashoffset={-segmentOffset}
              />
            );
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center" aria-hidden="true">
          <strong className="text-xl font-bold leading-none">{total}</strong>
          <span className="mt-1 text-[10px] text-slate-400">total</span>
        </div>
      </div>
      <dl className="min-w-[112px] space-y-2 text-xs">
        {segments.map(segment => (
          <div key={segment.label} className="flex items-center justify-between gap-3">
            <dt className="flex items-center gap-1.5 text-slate-400">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: segment.color }} />
              {segment.label}
            </dt>
            <dd className="font-semibold tabular-nums">{segment.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default function DashboardView() {
  const {
    walkies,
    departments,
    allocations,
    history,
    settings,
    currentUser,
    inventorySettings: inv,
    allocatedChargers,
    allocatedEarphones,
    availableChargers,
    availableEarphones,
    updateStock,
  } = useApp();
  const dark = settings.theme === 'dark';
  const box = `rounded-xl border ${dark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`;
  const sub = dark ? 'text-slate-400' : 'text-slate-500';
  const [edit, setEdit] = useState(null);
  const [form, setForm] = useState({ total: 0, fix: 0 });
  const n = st => walkies.filter(w => w.status === st).length;

  const cards = [
    {
      key: 'walkie',
      title: 'Walkie Talkies',
      icon: Radio,
      tone: 'text-blue-500 bg-blue-500/10',
      total: walkies.length,
      out: n('Allocated'),
      free: n('Available'),
      fix: n('Under Maintenance'),
    },
    {
      key: 'charger',
      title: 'Chargers',
      icon: BatteryCharging,
      tone: 'text-emerald-500 bg-emerald-500/10',
      total: inv.totalChargers || 0,
      out: allocatedChargers,
      free: availableChargers,
      fix: inv.chargersMaintenance || 0,
    },
    {
      key: 'earphone',
      title: 'Earphones',
      icon: Headphones,
      tone: 'text-blue-500 bg-blue-500/10',
      total: inv.totalEarphones || 0,
      out: allocatedEarphones,
      free: availableEarphones,
      fix: inv.earphonesMaintenance || 0,
    },
  ];
  const save = async key => {
    const ok = await updateStock(
      key === 'charger'
        ? { totalChargers: +form.total || 0, chargersMaintenance: +form.fix || 0 }
        : { totalEarphones: +form.total || 0, earphonesMaintenance: +form.fix || 0 },
    );
    if (ok) setEdit(null);
  };

  const active = allocations.filter(a => a.status === 'Active');
  const rows = departments.map(d => {
    const mine = active.filter(a => a.departmentId === d.id);
    return {
      id: d.id,
      name: d.name,
      w: walkies.filter(x => x.departmentId === d.id && x.status === 'Allocated').length,
      c: mine.reduce((t, a) => t + (a.chargerCount || 0), 0),
      e: mine.reduce((t, a) => t + (a.earphoneCount || 0), 0),
    };
  });
  const downloadDepartmentAllocations = () => {
    const sheet = XLSX.utils.json_to_sheet(
      rows.map(({ name, w, c, e }) => ({ Department: name, Walkies: w, Chargers: c, Earphones: e })),
    );
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Department allocations');
    XLSX.writeFile(book, 'department-allocations.xlsx');
  };
  const inp = `w-20 px-2 py-1 rounded-lg border text-sm ${dark ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-300'}`;

  return (
    <div className="space-y-6">
      <EventPipeline />
      <div className="grid md:grid-cols-3 gap-4">
        {cards.map(({ key, title, icon: Icon, tone, total, out, free, fix }) => (
          <div key={key} className={`${box} p-5`}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 font-semibold text-sm">
                <span className={`p-2 rounded-lg ${tone}`}>
                  <Icon className="w-4 h-4" />
                </span>
                {title}
              </div>
              {key !== 'walkie' && currentUser?.role === 'Admin' && (
                <button
                  title="Edit stock"
                  onClick={() => {
                    setEdit(edit === key ? null : key);
                    setForm({ total, fix });
                  }}
                  className="p-1 text-slate-400 hover:text-blue-500"
                >
                  <Pencil className="w-4 h-4" />
                </button>
              )}
            </div>
            <StockBreakdownChart title={title} total={total} out={out} free={free} fix={fix} dark={dark} />
            <div
              className={`mt-4 pt-3 border-t flex items-center gap-2 text-xs ${dark ? 'border-slate-800' : 'border-slate-100'} ${fix ? 'text-amber-500' : sub}`}
            >
              <Wrench className="w-3.5 h-3.5" />
              {fix} under maintenance
            </div>
            {edit === key && (
              <div className="mt-3 flex items-center gap-2 text-xs flex-wrap">
                Total{' '}
                <input
                  type="number"
                  min="0"
                  className={inp}
                  value={form.total}
                  onChange={e => setForm({ ...form, total: e.target.value })}
                />
                Repair{' '}
                <input
                  type="number"
                  min="0"
                  className={inp}
                  value={form.fix}
                  onChange={e => setForm({ ...form, fix: e.target.value })}
                />
                <button onClick={() => save(key)} className="px-3 py-1 rounded-lg bg-blue-600 text-white font-semibold">
                  Save
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <section className={`${box} p-5 flex flex-col h-96`}>
          <div className="flex items-center justify-between gap-3 mb-3">
            <h2 className="font-semibold text-sm">Department allocations</h2>
            <button
              type="button"
              onClick={downloadDepartmentAllocations}
              title="Download Excel workbook"
              aria-label="Download department allocations as Excel"
              className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-soft transition-[background-color,transform,opacity] duration-200 ease-out hover:bg-raised hover:-translate-y-px active:scale-[0.98]"
            >
              <span aria-hidden="true">📥</span>
              <span>Excel</span>
            </button>
          </div>
          <div
            className={`grid grid-cols-4 text-xs pb-2 border-b ${sub} ${dark ? 'border-slate-800' : 'border-slate-100'}`}
          >
            <span>Department</span>
            <span className="text-center">Walkies</span>
            <span className="text-center">Chargers</span>
            <span className="text-center">Earphones</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {rows.map(r => (
              <div
                key={r.id}
                className={`grid grid-cols-4 items-center py-2.5 text-sm border-b ${dark ? 'border-slate-800' : 'border-slate-100'}`}
              >
                <span className="truncate pr-2">{r.name}</span>
                <b className="text-center">{r.w}</b>
                <span className="text-center">{r.c}</span>
                <span className="text-center">{r.e}</span>
              </div>
            ))}
            {!rows.length && <p className={`text-sm py-6 text-center ${sub}`}>No departments yet.</p>}
          </div>
        </section>

        <section className={`${box} p-5 flex flex-col h-96`}>
          <h2 className="font-semibold text-sm mb-3">Recent logs</h2>
          <ul className="flex-1 overflow-y-auto space-y-3">
            {history.slice(0, 20).map(h => (
              <li key={h.id} className="text-sm">
                <div className="font-medium">{h.action}</div>
                <div className={`text-xs ${sub}`}>{h.details}</div>
                <div className="text-xs text-slate-400">{h.timestamp}</div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
