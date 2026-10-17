import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, Download, MapPin, Monitor, Search, Users, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Modal, cx, inputCls, labelCls } from '../accommodation/ui';
import { useManpower } from './ManpowerContext';
import type { Sewadar } from './types';
import { useWalkie } from '../walkie';
import { supabase } from '../walkie/lib/supabaseClient';
import { useEventScope } from '../../context/EventScopeContext';
import { DEPTS } from '../../views/orgData';

const D = true;
// Same shift keys and times as CCTV Control Room, so both screens read one roster.
const SHIFTS = [
  { key: 'morning', label: 'Morning', start: '09:00', end: '12:00' },
  { key: 'noon', label: 'Noon', start: '12:00', end: '15:00' },
  { key: 'evening', label: 'Evening', start: '15:00', end: '18:00' },
  { key: 'night', label: 'Night', start: '18:00', end: '21:00' },
];
type Shift = { key: string; label: string; start: string; end: string };
// CCTV members are rostered into a CCTV control room; everyone else gets a general duty shift.
const CCTV_DEPTS = ['cctv'];
const DEPT_ORDER = Object.keys(DEPTS);

type Assignment = { id: string; source: 'cctv' | 'general'; memberId: string; shiftKey: string; label: string; start: string; end: string; place: string };
type Room = { id: string; name: string; eventId: string | null; scopeKey: string };

const localDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const shiftDate = (date: string, days: number) => { const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate() + days); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const t12 = (v: string) => { if (!v) return ''; const [h, m] = v.split(':').map(Number); return new Date(2000, 0, 1, h, m).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }); };
const timeRange = (s: { start: string; end: string }) => (s.start && s.end ? `${t12(s.start)} – ${t12(s.end)}` : '');
const deptLabel = (d: string) => DEPTS[d as keyof typeof DEPTS] || 'No sub-department';
const isCctv = (m: Sewadar) => CCTV_DEPTS.includes(m.department);
const btn = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs font-semibold text-ink-soft hover:bg-raised disabled:opacity-50';
const primary = 'inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50';
// Toolbar controls share one height, radius, border and text size so they sit on one baseline.
const ctl = 'h-8 rounded-md border border-line bg-field px-2.5 text-[11.5px] text-ink outline-none placeholder:text-faint focus:border-blue-500';

export const DutiesShiftsPage: React.FC = () => {
  const manpower = useManpower();
  const auth: any = useWalkie();
  const scope = useEventScope();
  const orgId: string | undefined = auth.currentUser?.organizationId;
  const eventId = scope.scopeFor('sewadars') || null;
  const event = scope.events.find(e => e.id === eventId);
  const scopeKey = eventId || 'normal';
  const canManage = manpower.canManage;

  const [date, setDate] = useState(localDate);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomId, setRoomId] = useState('');
  const [location, setLocation] = useState('');
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('all');
  const [view, setView] = useState<'all' | 'unassigned' | 'assigned'>('all');
  // Clicking a shift card shows only the people on that shift ('' = no shift filter, 'special' = any special time).
  const [shiftFilter, setShiftFilter] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [special, setSpecial] = useState<{ ids: string[]; start: string; end: string } | null>(null);

  // On site now: marked arrived and not yet returned (Attendance → Returned).
  const arrived = useMemo(() => manpower.sewadars.filter(m => m.arrival === 'arrived' && !m.returnedBack), [manpower.sewadars]);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    const [general, cctv, roomRows] = await Promise.all([
      supabase.from('sewa_duty_shifts').select('*').eq('organization_id', orgId).eq('event_scope_key', scopeKey).eq('shift_date', date),
      // CCTV duties are read by room (whatever event the room belongs to), so CCTV Control Room and this page always agree.
      supabase.from('cctv_control_room_duties').select('*').eq('organization_id', orgId).eq('shift_date', date),
      supabase.from('cctv_control_rooms').select('id,name,event_id,event_scope_key').eq('organization_id', orgId).order('name'),
    ]);
    const err = general.error || cctv.error || roomRows.error;
    setLoadError(err ? `${err.message}${/sewa_duty_shifts|schema cache|does not exist/i.test(err.message) ? ' — run supabase/migration_v86_duties_and_shifts.sql in the Supabase SQL Editor, then reload.' : ''}` : '');
    // Rooms for the event being worked on first, then the organisation's other rooms.
    const roomList: Room[] = (roomRows.data || []).map((r: any) => ({ id: r.id, name: r.name, eventId: r.event_id, scopeKey: r.event_scope_key || 'normal' }))
      .sort((a, b) => Number(b.scopeKey === scopeKey) - Number(a.scopeKey === scopeKey) || a.name.localeCompare(b.name));
    setRooms(roomList);
    setRoomId(current => (roomList.some(r => r.id === current) ? current : roomList[0]?.id || ''));
    const roomName = (id: string) => roomList.find(r => r.id === id)?.name || 'Control room';
    setAssignments([
      ...(general.data || []).map((r: any): Assignment => ({ id: r.id, source: 'general', memberId: r.member_id, shiftKey: r.shift_key, label: r.shift_label || 'Special', start: (r.shift_start || '').slice(0, 5), end: (r.shift_end || '').slice(0, 5), place: r.location || '' })),
      ...(cctv.data || []).filter((r: any) => r.member_id && roomList.some(x => x.id === r.room_id)).map((r: any): Assignment => ({ id: r.id, source: 'cctv', memberId: r.member_id, shiftKey: r.shift_key, label: r.shift_label || SHIFTS.find(s => s.key === r.shift_key)?.label || 'Special', start: (r.shift_start || '').slice(0, 5), end: (r.shift_end || '').slice(0, 5), place: roomName(r.room_id) })),
    ]);
    setLoading(false);
  }, [orgId, scopeKey, date]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!orgId) return;
    const ch = supabase.channel(`duties-shifts-${orgId}-${scopeKey}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sewa_duty_shifts', filter: `organization_id=eq.${orgId}` }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cctv_control_room_duties', filter: `organization_id=eq.${orgId}` }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cctv_control_rooms', filter: `organization_id=eq.${orgId}` }, () => void load())
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [orgId, scopeKey, load]);
  useEffect(() => { setSelected(new Set()); }, [date, scopeKey]);

  const byMember = useMemo(() => {
    const m = new Map<string, Assignment[]>();
    assignments.forEach(a => m.set(a.memberId, [...(m.get(a.memberId) || []), a]));
    m.forEach(list => list.sort((a, b) => (a.start || '99').localeCompare(b.start || '99')));
    return m;
  }, [assignments]);

  const t = q.trim().toLowerCase();
  // Spreadsheet order: department (fixed order), then name.
  const rows = useMemo(() => arrived
    .filter(m => (dept === 'all' || (m.department || '') === dept)
      && (view === 'all' || (view === 'assigned' ? byMember.has(m.id) : !byMember.has(m.id)))
      && (!shiftFilter || (byMember.get(m.id) || []).some(a => (shiftFilter === 'special' ? a.shiftKey.startsWith('special-') : a.shiftKey === shiftFilter)))
      && (!t || [m.name, m.batchNo, m.branch, m.phone].some(v => (v || '').toLowerCase().includes(t))))
    .sort((a, b) => ((a.department ? DEPT_ORDER.indexOf(a.department) : 99) - (b.department ? DEPT_ORDER.indexOf(b.department) : 99)) || a.name.localeCompare(b.name)),
  [arrived, dept, view, t, byMember, shiftFilter]);
  const deptCounts = useMemo(() => { const c = new Map<string, number>(); arrived.forEach(m => c.set(m.department || '', (c.get(m.department || '') || 0) + 1)); return c; }, [arrived]);
  const shiftCounts = SHIFTS.map(s => ({ ...s, n: assignments.filter(a => a.shiftKey === s.key && arrived.some(m => m.id === a.memberId)).length }));
  const specialCount = assignments.filter(a => a.shiftKey.startsWith('special-')).length;
  const assignedCount = arrived.filter(m => byMember.has(m.id)).length;

  // ---- writes ------------------------------------------------------------------------------
  const assign = async (ids: string[], shift: Shift) => {
    if (!orgId || !canManage || !ids.length) return;
    const members = ids.map(id => arrived.find(m => m.id === id)).filter(Boolean) as Sewadar[];
    const fresh = members.filter(m => !(byMember.get(m.id) || []).some(a => a.shiftKey === shift.key));
    const cctvMembers = fresh.filter(isCctv); const others = fresh.filter(m => !isCctv(m));
    const room = rooms.find(r => r.id === roomId);
    if (cctvMembers.length && !room) { auth.addToast?.('Choose a CCTV control room for CCTV members (add one in CCTV Control Room first).', 'error'); return; }
    if (!fresh.length) { auth.addToast?.(`Already on the ${shift.label} shift.`, 'warning'); return; }
    setBusy(true);
    const base = { organization_id: orgId, shift_date: date, shift_key: shift.key, shift_label: shift.label, shift_start: shift.start || null, shift_end: shift.end || null, assigned_by: auth.currentUser?.name || '' };
    const results = await Promise.all([
      others.length ? supabase.from('sewa_duty_shifts').insert(others.map(m => ({ ...base, id: uid('duty'), event_id: eventId, event_scope_key: scopeKey, member_id: m.id, member_name: m.name, department: m.department || '', location: location.trim() }))) : Promise.resolve({ error: null }),
      // A CCTV duty is saved under its room's own event, so CCTV Control Room lists it under that room.
      cctvMembers.length && room ? supabase.from('cctv_control_room_duties').insert(cctvMembers.map(m => ({ ...base, id: uid('crd'), event_id: room.eventId, event_scope_key: room.scopeKey, room_id: room.id, member_id: m.id, member_name: m.name, mobile: m.phone || '', attendance_status: 'scheduled' }))) : Promise.resolve({ error: null }),
    ]);
    setBusy(false);
    const err = results.find(r => r.error)?.error as any;
    if (err) { auth.addToast?.(`Could not assign shift: ${err.message}${/row-level security|permission/i.test(err.message) ? ' — run supabase/migration_v86_duties_and_shifts.sql.' : ''}`, 'error'); void load(); return; }
    if (fresh.length > 1) auth.addToast?.(`${fresh.length} sewadars on the ${shift.label} shift${cctvMembers.length && room ? ` · ${cctvMembers.length} in ${room.name}` : ''}.`);
    setSelected(new Set()); void load();
  };
  const unassign = async (a: Assignment) => {
    if (!canManage) return;
    setAssignments(list => list.filter(x => x.id !== a.id));
    const { error } = await supabase.from(a.source === 'cctv' ? 'cctv_control_room_duties' : 'sewa_duty_shifts').delete().eq('id', a.id);
    if (error) { auth.addToast?.(`Could not remove shift: ${error.message}`, 'error'); void load(); }
  };
  const pick = (ids: string[], key: string) => {
    if (key === 'special') { setSpecial({ ids, start: '', end: '' }); return; }
    const s = SHIFTS.find(x => x.key === key); if (s) void assign(ids, s);
  };

  const exportExcel = () => {
    const sheet = XLSX.utils.json_to_sheet(rows.map((m, i) => {
      const mine = byMember.get(m.id) || [];
      const has = (k: string) => (mine.some(a => a.shiftKey === k) ? 'Yes' : '');
      return { '#': i + 1, Sewadar: m.name, 'Badge no.': m.batchNo, Branch: m.branch, 'Sub-department': deptLabel(m.department || ''), Mobile: m.phone,
        ...Object.fromEntries(SHIFTS.map(sh => [`${sh.label} (${timeRange(sh)})`, has(sh.key)])),
        Special: mine.filter(a => a.shiftKey.startsWith('special-')).map(timeRange).join('; '),
        'Location / CCTV room': Array.from(new Set(mine.map(a => a.place).filter(Boolean))).join(', ') };
    }));
    sheet['!cols'] = [{ wch: 5 }, { wch: 26 }, { wch: 12 }, { wch: 20 }, { wch: 16 }, { wch: 14 }, ...SHIFTS.map(() => ({ wch: 20 })), { wch: 22 }, { wch: 26 }];
    const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, 'Duties & Shifts');
    XLSX.writeFile(book, `duties_shifts_${date}.xlsx`);
  };

  const toggle = (id: string) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelected(s => (rows.every(m => s.has(m.id)) ? new Set() : new Set(rows.map(m => m.id))));
  const selectedIds = rows.filter(m => selected.has(m.id)).map(m => m.id);
  const selectedHasCctv = selectedIds.some(id => isCctv(arrived.find(m => m.id === id)!));
  const roomLabel = (r: Room) => `${r.name}${r.scopeKey === scopeKey ? '' : ` · ${scope.events.find(e => e.id === r.eventId)?.name || 'Normal'}`}`;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="flex items-center gap-2 text-lg font-bold text-ink"><Clock3 className="h-5 w-5 text-blue-400" />Duties &amp; Shifts</h2>
          <p className="mt-1 text-xs text-mute">Arrived members by sub-department{event ? ` · ${event.name}` : ''}. CCTV shifts appear in CCTV Control Room automatically.</p></div>
        <div className="flex items-center gap-1">
          <button className={btn} aria-label="Previous day" onClick={() => setDate(d => shiftDate(d, -1))}><ChevronLeft className="h-4 w-4" /></button>
          <label className="flex items-center gap-2 rounded-lg border border-line bg-field px-2 text-xs text-mute"><CalendarDays className="h-4 w-4" /><input type="date" value={date} onChange={e => e.target.value && setDate(e.target.value)} className="h-9 bg-transparent text-ink outline-none" aria-label="Duty date" /></label>
          <button className={btn} aria-label="Next day" onClick={() => setDate(d => shiftDate(d, 1))}><ChevronRight className="h-4 w-4" /></button>
          {date !== localDate() && <button className={btn} onClick={() => setDate(localDate())}>Today</button>}
        </div>
      </header>

      {loadError && <div role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-300">{loadError}</div>}

      <section className="stagger grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {/* Each card filters the sheet below; click it again (or "Arrived") to show everyone. */}
        {[
          { label: 'Arrived', n: arrived.length, hint: 'members on site', on: view === 'all' && !shiftFilter, act: () => { setView('all'); setShiftFilter(''); } },
          { label: 'Assigned', n: assignedCount, hint: 'have a shift today', on: view === 'assigned' && !shiftFilter, act: () => { setShiftFilter(''); setView(v => (v === 'assigned' ? 'all' : 'assigned')); } },
          { label: 'Unassigned', n: arrived.length - assignedCount, hint: 'need a shift', on: view === 'unassigned', act: () => { setShiftFilter(''); setView(v => (v === 'unassigned' ? 'all' : 'unassigned')); } },
          ...shiftCounts.map(s => ({ label: s.label, n: s.n, hint: timeRange(s), on: shiftFilter === s.key, act: () => { setView('all'); setShiftFilter(f => (f === s.key ? '' : s.key)); } })),
          ...(specialCount ? [{ label: 'Special', n: specialCount, hint: 'custom times', on: shiftFilter === 'special', act: () => { setView('all'); setShiftFilter(f => (f === 'special' ? '' : 'special')); } }] : []),
        ].slice(0, 8).map(c => (
          <button key={c.label} type="button" aria-pressed={c.on} onClick={c.act} title={`Show ${c.label.toLowerCase()} in the sheet`}
            className={cx('rounded-lg border bg-surface px-3 py-2.5 text-left transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-blue-400/50', c.on ? 'border-blue-500 ring-1 ring-blue-500/40' : 'border-line')}>
            <div className="text-[11.5px] text-mute">{c.label}</div><div className="text-xl font-semibold tabular-nums text-ink">{c.n}</div><div className="truncate text-[10.5px] text-faint">{c.hint}</div>
          </button>
        ))}
      </section>

      {/* Toolbar: filters on the left; where new shifts go (CCTV room / duty location) on the right. */}
      <section className="rounded-xl border border-line bg-surface">
        <div className="flex flex-col gap-2 p-2.5 xl:flex-row xl:items-center">
          <div className="grid min-w-0 flex-1 grid-cols-1 items-center gap-2 sm:grid-cols-[minmax(12rem,20rem)_13rem_auto]">
            <label className="relative block min-w-0">
              <span className="sr-only">Search members</span>
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, badge no., branch, phone…" className={cx(ctl, 'w-full pl-8')} />
            </label>
            <select value={dept} onChange={e => setDept(e.target.value)} aria-label="Sub-department" className={cx(ctl, 'w-full min-w-0')}>
              <option value="all">All sub-departments · {arrived.length}</option>
              {[...DEPT_ORDER, ''].filter(d => deptCounts.has(d)).map(d => <option key={d || 'none'} value={d}>{deptLabel(d)} · {deptCounts.get(d)}</option>)}
            </select>
            <div role="group" aria-label="Assignment filter" className="inline-flex h-8 w-max items-stretch rounded-md border border-line bg-raised/40 p-0.5">
              {(['all', 'unassigned', 'assigned'] as const).map(v => <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={cx('flex items-center rounded px-3 text-[11.5px] font-medium capitalize', view === v ? 'bg-surface text-ink shadow-sm' : 'text-mute hover:text-ink')}>{v}</button>)}
            </div>
          </div>
          {canManage && <div className="flex flex-col gap-2 border-t border-line pt-2 sm:flex-row sm:items-center xl:border-l xl:border-t-0 xl:pl-3 xl:pt-0">
            <label className="flex items-center gap-2 text-[11.5px] text-mute">
              <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap"><Monitor className="h-3.5 w-3.5 text-blue-300" />CCTV room</span>
              <select value={roomId} onChange={e => setRoomId(e.target.value)} aria-label="CCTV control room for CCTV members" className={cx(ctl, 'w-full sm:w-48')}>{rooms.length ? rooms.map(r => <option key={r.id} value={r.id}>{roomLabel(r)}</option>) : <option value="">No control rooms yet</option>}</select>
            </label>
            <label className="flex items-center gap-2 text-[11.5px] text-mute">
              <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap"><MapPin className="h-3.5 w-3.5 text-faint" />Location</span>
              <input value={location} onChange={e => setLocation(e.target.value)} placeholder="Others · optional" aria-label="Duty location for non-CCTV members" className={cx(ctl, 'w-full sm:w-44')} />
            </label>
          </div>}
        </div>
        {canManage && selectedIds.length > 0 && <div className="animate-calm-enter flex flex-wrap items-center gap-2 border-t border-blue-500/30 bg-blue-500/10 px-3 py-2 text-xs">
          <span className="font-semibold text-ink">{selectedIds.length} selected</span>
          <span className="text-mute">Assign to</span>
          {SHIFTS.map(s => <button key={s.key} disabled={busy} className={cx(btn, 'h-8 py-0')} onClick={() => pick(selectedIds, s.key)}>{s.label}<span className="text-faint">{timeRange(s)}</span></button>)}
          <button disabled={busy} className={cx(btn, 'h-8 py-0')} onClick={() => pick(selectedIds, 'special')}>Special…</button>
          {selectedHasCctv && <span className="text-[11.5px] text-blue-200">CCTV members go to {rooms.find(r => r.id === roomId)?.name || '— choose a room'}</span>}
          <button className="ml-auto text-mute hover:text-ink" onClick={() => setSelected(new Set())}>Clear</button>
        </div>}
      </section>

      {loading && !assignments.length && <p className="text-xs text-mute">Loading shifts…</p>}
      {!arrived.length ? <div className="rounded-xl border border-dashed border-line p-10 text-center text-sm text-mute"><Users className="mx-auto mb-2 h-6 w-6 text-faint" />No members have arrived yet. Mark arrivals in Sewadar Master or Attendance.</div> : (
        <section className="overflow-hidden rounded-xl border border-line bg-surface">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-2.5 py-2 text-[11.5px] text-mute">
            <Clock3 className="h-3.5 w-3.5 text-blue-300" /><span className="font-semibold text-ink">Shift roster · {new Date(`${date}T12:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span>
            <span className="rounded bg-raised px-1.5 py-0.5 tabular-nums">{rows.length}</span>
            {canManage && <span className="ml-auto hidden text-faint xl:inline">Click a shift cell to assign or remove · CCTV rows go to the selected CCTV room</span>}
            <button type="button" onClick={exportExcel} disabled={!rows.length} className={cx(btn, 'h-8 py-0', !canManage && 'ml-auto')}><Download className="h-3.5 w-3.5" />Export Excel</button>
          </div>
          <div className="max-h-[calc(100vh-20rem)] min-h-[180px] overflow-auto">
            <table className="w-full min-w-[1100px] border-collapse text-[11.5px] leading-4">
              <thead className="sticky top-0 z-10 bg-raised text-left text-[10.5px] font-semibold uppercase tracking-wide text-mute shadow-sm">
                <tr>
                  {canManage && <th className="w-8 border border-line/70 px-2 py-2"><input type="checkbox" aria-label="Select all shown" checked={rows.length > 0 && rows.every(m => selected.has(m.id))} onChange={toggleAll} className="h-3.5 w-3.5 accent-blue-600" /></th>}
                  <th className="w-10 border border-line/70 px-2 py-2 text-right">#</th>
                  {['Sewadar', 'Badge no.', 'Branch', 'Sub-department', 'Mobile'].map(h => <th key={h} className="whitespace-nowrap border border-line/70 px-2.5 py-2">{h}</th>)}
                  {SHIFTS.map(sh => <th key={sh.key} className="whitespace-nowrap border border-line/70 px-2 py-2 text-center">{sh.label}<span className="block text-[10px] font-normal normal-case tracking-normal text-faint">{timeRange(sh)}</span></th>)}
                  <th className="whitespace-nowrap border border-line/70 px-2.5 py-2">Special</th>
                  <th className="whitespace-nowrap border border-line/70 px-2.5 py-2">Location / CCTV room</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m, i) => {
                  const mine = byMember.get(m.id) || [];
                  const specials = mine.filter(a => a.shiftKey.startsWith('special-'));
                  const places = Array.from(new Set(mine.map(a => a.place).filter(Boolean)));
                  const cctv = isCctv(m);
                  return (
                    <tr key={m.id} className={cx('hover:bg-raised/50', selected.has(m.id) && 'bg-blue-500/5', !mine.length && 'bg-amber-500/[0.03]')}>
                      {canManage && <td className="border border-line/70 px-2 py-1.5"><input type="checkbox" aria-label={`Select ${m.name}`} checked={selected.has(m.id)} onChange={() => toggle(m.id)} className="h-3.5 w-3.5 accent-blue-600" /></td>}
                      <td className="border border-line/70 px-2 py-1.5 text-right tabular-nums text-faint">{i + 1}</td>
                      <td className="max-w-[200px] truncate whitespace-nowrap border border-line/70 px-2.5 py-1.5 font-semibold text-ink" title={m.name}>{m.name}</td>
                      <td className="whitespace-nowrap border border-line/70 px-2.5 py-1.5 tabular-nums text-ink-soft">{m.batchNo || '—'}</td>
                      <td className="max-w-[160px] truncate whitespace-nowrap border border-line/70 px-2.5 py-1.5 text-ink-soft" title={m.branch}>{m.branch || '—'}</td>
                      <td className="whitespace-nowrap border border-line/70 px-2.5 py-1.5 text-ink-soft">{deptLabel(m.department || '')}{cctv && <Monitor className="ml-1 inline h-3 w-3 text-blue-300" aria-label="Synced with CCTV Control Room" />}</td>
                      <td className="whitespace-nowrap border border-line/70 px-2.5 py-1.5 text-ink-soft">{m.phone ? <a href={`tel:${m.phone}`} className="hover:text-blue-300">{m.phone}</a> : '—'}</td>
                      {SHIFTS.map(sh => {
                        const a = mine.find(x => x.shiftKey === sh.key);
                        return (
                          <td key={sh.key} className="border border-line/70 p-0 text-center">
                            <button type="button" disabled={!canManage || busy} onClick={() => (a ? void unassign(a) : void assign([m.id], sh))}
                              aria-pressed={!!a} aria-label={`${a ? 'Remove' : 'Assign'} ${sh.label} shift for ${m.name}`} title={a ? `${sh.label} · ${a.place || 'assigned'} — click to remove` : canManage ? `Assign ${sh.label}` : ''}
                              className={cx('flex h-8 w-full items-center justify-center text-[11.5px] font-semibold disabled:cursor-default', a ? (a.source === 'cctv' ? 'bg-blue-500/15 text-blue-200' : 'bg-emerald-500/15 text-emerald-300') : 'text-faint enabled:hover:bg-raised enabled:hover:text-ink')}>
                              {a ? '✓' : canManage ? '+' : ''}
                            </button>
                          </td>
                        );
                      })}
                      <td className="border border-line/70 px-2 py-1">
                        <div className="flex flex-wrap items-center gap-1">
                          {specials.map(a => <span key={a.id} className="inline-flex items-center gap-1 rounded bg-raised px-1.5 py-0.5 text-[10.5px] text-ink-soft">{timeRange(a)}{canManage && <button type="button" onClick={() => void unassign(a)} aria-label={`Remove special shift ${timeRange(a)} for ${m.name}`} className="text-mute hover:text-rose-300"><X className="h-3 w-3" /></button>}</span>)}
                          {canManage && <button type="button" disabled={busy} onClick={() => pick([m.id], 'special')} className="whitespace-nowrap rounded px-1.5 py-0.5 text-[10.5px] text-mute hover:bg-raised hover:text-ink">+ Custom</button>}
                        </div>
                      </td>
                      <td className="max-w-[200px] truncate whitespace-nowrap border border-line/70 px-2.5 py-1.5 text-ink-soft" title={places.join(', ')}>{places.join(', ') || <span className="text-faint">{mine.length ? '—' : 'No shift'}</span>}</td>
                    </tr>
                  );
                })}
                {!rows.length && <tr><td colSpan={14} className="px-4 py-10 text-center text-mute">No arrived members match these filters.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-line px-2.5 py-2 text-[10.5px] text-mute">
            <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500/40" />Assigned</span>
            <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-blue-500/40" />CCTV Control Room duty</span>
            <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-500/20" />No shift on this date</span>
          </div>
        </section>
      )}

      {special && <Modal title="Special shift" dark={D} onClose={() => setSpecial(null)}>
        <p className="mb-4 text-xs text-mute">Custom start and end time for {special.ids.length} member{special.ids.length === 1 ? '' : 's'} on {new Date(`${date}T12:00:00`).toLocaleDateString('en-IN', { dateStyle: 'medium' })}.</p>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={labelCls(D)} htmlFor="sp-start">Start</label><input id="sp-start" type="time" value={special.start} onChange={e => setSpecial(s => s && { ...s, start: e.target.value })} className={inputCls(D)} /></div>
          <div><label className={labelCls(D)} htmlFor="sp-end">End</label><input id="sp-end" type="time" value={special.end} onChange={e => setSpecial(s => s && { ...s, end: e.target.value })} className={inputCls(D)} /></div>
        </div>
        {special.start && special.end && special.start >= special.end && <p role="alert" className="mt-2 text-xs text-rose-400">End time must be after the start time.</p>}
        <div className="mt-5 flex justify-end gap-2"><button className={btn} onClick={() => setSpecial(null)}>Cancel</button>
          <button className={primary} disabled={busy || !special.start || !special.end || special.start >= special.end} onClick={() => { const s = special; setSpecial(null); void assign(s.ids, { key: `special-${s.start.replace(':', '')}-${s.end.replace(':', '')}`, label: 'Special', start: s.start, end: s.end }); }}>Assign special shift</button></div>
      </Modal>}
    </div>
  );
};
