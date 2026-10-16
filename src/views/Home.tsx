import React, { useEffect, useMemo, useState } from 'react';
import { Zap, ListTodo, Video, Wifi, Radio, Monitor, Boxes, BedDouble, HeartHandshake, ChevronRight, X, TrendingUp } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Card, Empty, Pill, linkBtn } from '../components/ui';
import { DEPTS } from './orgData';
import { useWalkie } from '../modules/walkie';
import { useAccommodation } from '../modules/accommodation';
import { useManpower } from '../modules/manpower';
import { useEventScope } from '../context/EventScopeContext';
import { useInventory } from '../modules/inventory';
import { supabase } from '../modules/walkie/lib/supabaseClient';
import { pickLive } from '../modules/accommodation/live';
import { nowMinutes, todayStr } from '../modules/accommodation/dates';
import { STATUS_STEPS } from '../modules/accommodation/types';
import type { SubDepartmentId } from '../types';

type DashboardDepartment = Exclude<SubDepartmentId, 'purchase' | 'accounts'>;
const localDateKey = (value: string) => { const date = new Date(value); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; };
const staffingCategoryKey = (value: string) => {
  const normalized = value.toLocaleLowerCase().replace(/[^a-z0-9]/g, '');
  return Object.entries(DEPTS).find(([id, label]) => [id, label].some(name => name.toLocaleLowerCase().replace(/[^a-z0-9]/g, '') === normalized))?.[0] || value;
};
const ICONS: Record<DashboardDepartment, any> = { cctv: Video, wifi: Wifi, walkie: Radio, control: Monitor, inventory: Boxes, accommodation: BedDouble, sewadars: HeartHandshake };
// Control Rooms still uses sample data stored in the browser, so the dashboard says so.
const DEMO: SubDepartmentId[] = ['control'];
const DOT: Record<string, string> = { Critical: 'bg-red-500', High: 'bg-amber-400', Medium: 'bg-blue-500' };

interface Attention { id: string; title: string; detail: string; priority: 'Critical' | 'High' | 'Medium'; href: string }
type StaffingPoint = { date: string; expected: number; arrived: number };
type DepartmentPoint = { name: string; expected: number; arrived: number };

const chartCeiling = (values: number[]) => {
  const max = Math.max(1, ...values);
  const step = Math.max(1, Math.ceil(max / 4));
  return Math.ceil(max / step) * step;
};

const StaffingTrendChart: React.FC<{ rows: StaffingPoint[]; selectedDate?: string; onSelect: (date: string) => void; compact?: boolean }> = ({ rows, selectedDate, onSelect, compact = false }) => {
  const width = 900; const height = 380; const left = 32; const right = 20; const top = 38; const bottom = 324;
  const max = chartCeiling(rows.flatMap(row => [row.expected, row.arrived]));
  const step = (width - left - right) / Math.max(1, rows.length);
  const x = (index: number) => left + (index + 0.5) * step;
  const y = (value: number) => bottom - Math.sqrt(value / max) * (bottom - top);
  return <svg viewBox={`0 0 ${width} ${height}`} className={compact ? 'h-60 w-full' : 'h-auto min-w-[700px] w-full'} role="img" aria-label="Expected and arrived Sewadars by date on a compressed height scale; values show exact counts; select a date to open department details">
    {[1,2,3].map(index => { const gridY = top + index * (bottom-top) / 3; return <line key={index} x1={left} x2={width-right} y1={gridY} y2={gridY} stroke="currentColor" className="text-line" strokeOpacity=".55" strokeDasharray="2 7"/>; })}
    <line x1={left} x2={width-right} y1={bottom} y2={bottom} stroke="currentColor" className="text-line"/>
    {rows.map((row,index) => {
      const date = new Date(`${row.date}T12:00:00`).toLocaleDateString('en-IN',{day:'numeric',month:'short'});
      const barWidth = Math.min(28, step * 0.32); const gap = Math.min(7, step * 0.08);
      const expectedX = x(index) - barWidth - gap / 2; const arrivedX = x(index) + gap / 2;
      const hitX = left + index * step;
      const hitRight = hitX + step;
      return <g key={row.date} onClick={event => { event.stopPropagation(); onSelect(row.date); }} className="cursor-pointer">
        <rect x={hitX} y={top - 8} width={hitRight - hitX} height={height - top - 8} fill="transparent" aria-label={`Open ${date}: ${row.expected} expected, ${row.arrived} arrived`}><title>{date}: {row.expected} expected · {row.arrived} arrived</title></rect>
        {selectedDate === row.date && <rect x={hitX + 2} y={top - 4} width={Math.max(0, hitRight - hitX - 4)} height={bottom - top + 12} rx="8" fill="#60a5fa" fillOpacity=".09"/>}
        <rect x={expectedX} y={y(row.expected)} width={barWidth} height={Math.max(row.expected ? 2 : 0, bottom - y(row.expected))} rx="3" fill="#60a5fa"><title>{date}: {row.expected} expected</title></rect>
        <rect x={arrivedX} y={y(row.arrived)} width={barWidth} height={Math.max(row.arrived ? 2 : 0, bottom - y(row.arrived))} rx="3" fill="#34d399"><title>{date}: {row.arrived} arrived</title></rect>
        {row.expected > 0 && <text x={expectedX + barWidth / 2} y={Math.max(top + 16, y(row.expected) - 9)} textAnchor="middle" className="fill-current text-[14px] font-semibold text-blue-300">{row.expected}</text>}
        {row.arrived > 0 && <text x={arrivedX + barWidth / 2} y={Math.max(top + 16, y(row.arrived) - 9)} textAnchor="middle" className="fill-current text-[14px] font-semibold text-emerald-300">{row.arrived}</text>}
        <text x={x(index)} y={bottom+27} textAnchor="middle" className="fill-current text-[12px] text-mute">{date}</text>
      </g>;
    })}
  </svg>;
};

const DepartmentComparisonChart: React.FC<{ rows: DepartmentPoint[] }> = ({ rows }) => {
  return <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-label="Sewadar coverage by sub-department">
    {rows.map(row => {
      const percent = row.expected ? Math.min(100, Math.round(row.arrived / row.expected * 100)) : 0;
      const radius = 20; const circumference = 2 * Math.PI * radius;
      const color = percent >= 100 ? '#34d399' : '#60a5fa';
      return <article key={row.name} className="flex min-w-0 items-center gap-3 rounded-lg border border-line/70 bg-surface px-3 py-2.5">
        <span className="relative grid h-12 w-12 shrink-0 place-items-center" role="img" aria-label={row.expected ? `${row.name}: ${percent}% coverage` : `${row.name}: no staffing target`}>
          <svg viewBox="0 0 48 48" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden="true">
            <circle cx="24" cy="24" r={radius} fill="none" stroke="currentColor" strokeWidth="5" className="text-line"/>
            {row.expected > 0 && <circle cx="24" cy="24" r={radius} fill="none" stroke={color} strokeWidth="5" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - percent / 100)}/>}
          </svg>
          <span className="text-[10px] font-semibold tabular-nums text-ink">{row.expected ? `${percent}%` : '—'}</span>
        </span>
        <div className="min-w-0 flex-1">
          <h4 className="truncate text-[11px] font-semibold text-ink" title={row.name}>{row.name}</h4>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-mute"><span>Expected <b className="font-semibold tabular-nums text-blue-300">{row.expected}</b></span><span>Arrived <b className="font-semibold tabular-nums text-emerald-300">{row.arrived}</b></span></div>
          {row.expected === 0 && row.arrived > 0 && <p className="mt-0.5 text-[9px] text-amber-300">No target set</p>}
          {row.arrived > row.expected && row.expected > 0 && <p className="mt-0.5 text-[9px] text-emerald-300">{row.arrived - row.expected} above target</p>}
        </div>
      </article>;
    })}
  </div>;
};

const ReadinessDonut: React.FC<{ value: number; size?: number; label: string }> = ({ value, size = 48, label }) => {
  const radius = size * 0.39; const circumference = 2 * Math.PI * radius; const clamped = Math.min(100, Math.max(0, value));
  return <span className="relative inline-grid shrink-0 place-items-center" style={{ width: size, height: size }} role="img" aria-label={`${label}: ${clamped}% ready`}>
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="-rotate-90">
      <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke="currentColor" strokeWidth={size * 0.1} className="text-line" />
      <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke="currentColor" strokeWidth={size * 0.1} strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - clamped / 100)} className={clamped >= 100 ? 'text-emerald-400' : 'text-blue-400'} />
    </svg>
    <span aria-hidden="true" className="absolute font-semibold tabular-nums text-ink" style={{ fontSize: Math.max(10, Math.round(size * 0.16)) }}>{clamped}%</span>
  </span>;
};

type RoomReadinessPoint = { id: string; name: string; category: string; percent: number; ready: boolean; hasRequirements: boolean; readyItems: number; totalItems: number; preparedQuantity: number; neededQuantity: number; returnedItems: number };

const RoomReadinessCard: React.FC<{ rooms: RoomReadinessPoint[]; loading: boolean; eventName?: string; onOpen: () => void }> = ({ rooms, loading, eventName, onOpen }) => {
  const ready = rooms.filter(room => room.ready).length;
  const percent = rooms.length ? Math.round(ready / rooms.length * 100) : 0;
  return <section aria-labelledby="room-readiness-title" className="flex h-full min-h-0 flex-col rounded-xl border border-line bg-surface p-3 sm:p-4">
    <div className="flex items-start justify-between gap-2"><div><h2 id="room-readiness-title" className="text-sm font-semibold text-ink">Room readiness</h2><p className="mt-0.5 text-[10px] text-mute">Room preparation{eventName ? ` · ${eventName}` : ''}</p></div><button type="button" onClick={onOpen} className="shrink-0 text-[10px] font-medium text-blue-300 hover:text-blue-200">Room details <ChevronRight size={12} className="inline"/></button></div>
    {loading ? <div aria-label="Loading room readiness" className="mt-3 flex flex-1 items-center justify-center"><div className="animate-shimmer h-36 w-36 rounded-full bg-raised/50"/></div> : rooms.length ? <button type="button" onClick={onOpen} aria-label={`Open room readiness details: ${ready} of ${rooms.length} rooms ready, ${percent}% overall`} className="mt-3 flex min-h-52 flex-1 items-center justify-center gap-5 rounded-lg border border-line/80 bg-raised/20 p-4 text-left transition hover:border-blue-400/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">
      <ReadinessDonut value={percent} size={160} label="Overall room readiness"/>
      <span className="min-w-0"><span className="block text-2xl font-semibold tabular-nums text-ink">{ready}<span className="text-base font-normal text-mute"> / {rooms.length}</span></span><span className="block text-sm text-mute">rooms ready</span><span className="mt-2 block text-xs text-mute">{ready} ready · {rooms.length - ready} in progress</span><span className="mt-3 block text-[10px] font-medium text-blue-300">Click to view room details</span></span>
    </button> : <div className="mt-3 flex flex-1 items-center justify-center rounded-lg border border-dashed border-line px-3 text-center text-xs text-mute">No rooms have been added for this workspace yet.</div>}
  </section>;
};

const RoomReadinessDialog: React.FC<{ rooms: RoomReadinessPoint[]; eventName?: string; onClose: () => void }> = ({ rooms, eventName, onClose }) => {
  const ready = rooms.filter(room => room.ready).length;
  const percent = rooms.length ? Math.round(ready / rooms.length * 100) : 0;
  useEffect(() => {
    const previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener('keydown', onKeyDown); };
  }, [onClose]);
  return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-2 backdrop-blur-sm sm:p-4" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="room-readiness-dialog-title" className="animate-calm-enter flex h-[min(92dvh,52rem)] max-h-[94dvh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-2xl">
      <header className="flex items-center gap-3 border-b border-line px-4 py-3"><div className="min-w-0 flex-1"><h2 id="room-readiness-dialog-title" className="text-sm font-semibold text-ink">Room readiness details</h2><p className="mt-0.5 text-[10px] text-mute">Prepared necessities{eventName ? ` · ${eventName}` : ''}</p></div><a href="#/accommodation" className={linkBtn}>Open rooms <ChevronRight size={13}/></a><button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-md border border-line text-mute hover:bg-raised hover:text-ink" aria-label="Close room readiness details"><X size={15}/></button></header>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 sm:p-5">
        {rooms.length ? <>
          <div className="mb-4 flex items-center gap-4 rounded-lg border border-line bg-raised/20 px-4 py-3"><ReadinessDonut value={percent} size={68} label="Overall room readiness"/><div className="min-w-0 flex-1"><div className="text-sm font-semibold text-ink">{ready} of {rooms.length} rooms ready</div><div className="text-xs text-mute">{rooms.length - ready} still need preparation or necessities</div></div><span className="text-xl font-semibold tabular-nums text-ink">{percent}<span className="text-sm text-mute">%</span></span></div>
          <div className="mb-2 flex items-center justify-between"><h3 className="text-xs font-semibold text-ink">Readiness by room</h3><span className="text-[10px] text-mute">{rooms.length} rooms</span></div>
          <div className="grid min-h-0 flex-1 auto-rows-fr items-stretch gap-3 sm:grid-cols-3">{rooms.map(room => <article key={room.id} className="flex min-h-48 min-w-0 flex-col items-center gap-2 rounded-lg border border-line bg-surface p-4 text-center">
            <ReadinessDonut value={room.percent} size={72} label={`${room.name} readiness`}/><div className="min-w-0"><div className="truncate text-sm font-semibold text-ink" title={room.name}>{room.name}</div><div className="mt-0.5 truncate text-[10px] text-mute">{room.category === 'control_room' ? 'Control room' : 'Rest room'} · {room.hasRequirements ? room.ready ? 'Ready' : 'In progress' : 'Add necessities'}</div></div>
            <div className="mt-auto w-full text-left"><div className="h-1.5 overflow-hidden rounded-full bg-raised"><div className={`h-full rounded-full ${room.ready ? 'bg-emerald-400' : 'bg-blue-400'}`} style={{ width: `${room.percent}%` }}/></div><div className="mt-1 flex justify-between gap-1 text-[9px] text-mute"><span>{room.hasRequirements ? `${room.readyItems}/${room.totalItems} items ready` : 'No necessities added'}</span>{room.hasRequirements && <span className="shrink-0">{room.preparedQuantity}/{room.neededQuantity} units</span>}</div>{room.hasRequirements && <div className="mt-0.5 text-[9px] text-mute">{room.returnedItems} returned</div>}</div>
          </article>)}</div>
        </> : <div className="py-10 text-center text-xs text-mute">No rooms to display.</div>}
      </div>
    </section>
  </div>;
};

export const Home: React.FC = () => {
  const { cameras, wifiAPs, controlRooms, currentUser, canAccessApp, assetsLoading } = useApp();
  const w: any = useWalkie();
  const acc = useAccommodation();
  const manpower = useManpower(); const mp = manpower.stats;
  const eventScope = useEventScope(); const eventId = eventScope.scopeFor('event-reports'); const staffingEvent = eventScope.events.find(event => event.id === eventId);
  const accommodationEvent = eventScope.events.find(event => event.id === eventScope.scopeFor('accommodation'));
  const [staffingRows, setStaffingRows] = useState<any[]>([]); const [attendanceRows, setAttendanceRows] = useState<any[]>([]); const [staffingDate, setStaffingDate] = useState('');
  const [roomReadinessOpen, setRoomReadinessOpen] = useState(false);
  const invCtx = useInventory(); const inv = invCtx.stats;
  const [ongoingTasks, setOngoingTasks] = useState<any[]>([]);
  useEffect(() => {
    let live = true;
    if (!w.currentUser?.organizationId || !eventId) { setStaffingRows([]); setAttendanceRows([]); setStaffingDate(''); return; }
    void Promise.all([
      supabase.from('event_staffing_requirements').select('requirement_date,category,required_count').eq('organization_id', w.currentUser.organizationId).eq('event_id', eventId).order('requirement_date'),
      supabase.from('event_attendance').select('member_id,status,checked_in_at,checked_out_at').eq('organization_id', w.currentUser.organizationId).eq('event_id', eventId),
    ]).then(([requirements, attendance]) => { if (!live) return; if (!requirements.error) setStaffingRows(requirements.data || []); if (!attendance.error) setAttendanceRows(attendance.data || []); });
    return () => { live = false; };
  }, [w.currentUser?.organizationId, eventId]);
  const staffingChart = useMemo(() => {
    const dates = staffingEvent ? Array.from({ length: (staffingEvent.staffing_days_before ?? 7) + (staffingEvent.staffing_days_after ?? 7) + 1 }, (_, index) => {
      const start = new Date(staffingEvent.starts_at); start.setHours(12, 0, 0, 0); start.setDate(start.getDate() + index - (staffingEvent.staffing_days_before ?? 7));
      return `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
    }) : Array.from(new Set(staffingRows.map(row => row.requirement_date))).sort();
    return dates.map(date => ({ date, expected: staffingRows.filter(row => row.requirement_date === date).reduce((n, row) => n + Number(row.required_count || 0), 0), arrived: attendanceRows.filter(row => row.checked_in_at && row.status !== 'absent' && localDateKey(row.checked_in_at) <= date && (!row.checked_out_at || localDateKey(row.checked_out_at) >= date)).length }));
  }, [staffingRows, attendanceRows, staffingEvent]);
  const departmentChart = useMemo(() => {
    if (!staffingDate) return [];
    const needs = staffingRows.filter(row => row.requirement_date === staffingDate);
    return Object.entries(DEPTS).map(([id, name]) => {
      const req = needs.filter(row => staffingCategoryKey(row.category).toLowerCase() === id.toLowerCase()).reduce((n, row) => n + Number(row.required_count || 0), 0);
      const actual = attendanceRows.filter(row => row.checked_in_at && row.status !== 'absent' && localDateKey(row.checked_in_at) <= staffingDate && (!row.checked_out_at || localDateKey(row.checked_out_at) >= staffingDate)).filter(row => { const p = manpower.sewadars.find(person => person.id === row.member_id); return p && staffingCategoryKey(p.department || '').toLowerCase() === id.toLowerCase(); }).length;
      return { name, expected: req, arrived: actual };
    });
  }, [staffingDate, staffingRows, attendanceRows, manpower.sewadars]);
  useEffect(() => {
    if (!staffingDate) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setStaffingDate(''); };
    window.addEventListener('keydown', onKeyDown);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener('keydown', onKeyDown); };
  }, [staffingDate]);
  useEffect(() => {
    const orgId = w.currentUser?.organizationId;
    if (!orgId || (currentUser.role !== 'owner' && currentUser.role !== 'dept_head')) return;
    const load = async () => {
      const [{ data: manpower, error: manpowerError }, { data: accommodation, error: accommodationError }] = await Promise.all([
        supabase.from('manpower_tasks').select('id,title,team,assigned_to,due_date,updated_at').eq('status', 'in_progress').order('updated_at', { ascending: false }).limit(8),
        supabase.from('accommodation_member_tasks').select('id,title,assigned_to,due_date,updated_at,accommodation_members(name)').eq('status', 'in_progress').order('updated_at', { ascending: false }).limit(8),
      ]);
      if (!manpowerError || !accommodationError) setOngoingTasks([
        ...(manpower || []),
        ...(accommodation || []).map((t: any) => ({ ...t, team: 'Accommodation', assigned_to: t.accommodation_members?.name || t.assigned_to })),
      ].sort((a: any, b: any) => String(b.updated_at).localeCompare(String(a.updated_at))).slice(0, 8));
    };
    load();
    const channel = supabase.channel(`home-tasks-${orgId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'manpower_tasks', filter: `organization_id=eq.${orgId}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'accommodation_member_tasks', filter: `organization_id=eq.${orgId}` }, load).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [w.currentUser?.organizationId, currentUser.role]); // eslint-disable-line

  const exec = currentUser.role === 'owner' || currentUser.role === 'dept_head';
  const n = (a: any[], f: (x: any) => boolean) => a.filter(f).length;
  const radios: any[] = w.walkies || [];
  const radiosOut = n(radios, r => r.status === 'Allocated'); const radiosFix = n(radios, r => r.status === 'Under Maintenance');
  const beds = acc.rooms.reduce((t, r) => t + r.capacity, 0);
  const placed = acc.members.filter(m => m.roomId).length;
  const unhoused = acc.members.length - placed;
  const roomReadiness = useMemo(() => acc.rooms.map(room => {
    const requirements = room.requirements || [];
    const total = requirements.reduce((sum, item) => sum + Math.max(0, Number(item.quantity) || 0), 0);
    const prepared = requirements.reduce((sum, item) => sum + Math.min(Math.max(0, Number(item.readyQuantity) || 0), Math.max(0, Number(item.quantity) || 0)), 0);
    const percent = total ? Math.round(prepared / total * 100) : 0;
    const ready = requirements.length > 0 && requirements.every(item => item.quantity > 0 && item.readyQuantity >= item.quantity);
    return { id: room.id, name: room.name, category: room.category, percent, ready, hasRequirements: requirements.length > 0, readyItems: requirements.filter(item => item.quantity > 0 && item.readyQuantity >= item.quantity).length, totalItems: requirements.length, preparedQuantity: prepared, neededQuantity: total, returnedItems: requirements.filter(item => item.returned).length };
  }).sort((a, b) => Number(b.ready) - Number(a.ready) || a.name.localeCompare(b.name)), [acc.rooms]);
  const liveMeal = pickLive(acc.mealsOn(todayStr()), nowMinutes());

  const cards: Record<DashboardDepartment, [string, string, number]> = {
    cctv: [`${n(cameras, c => c.status === 'online')}/${cameras.length}`, 'cameras online', n(cameras, c => c.status !== 'online')],
    wifi: [`${n(wifiAPs, a => a.status === 'online')}/${wifiAPs.length}`, 'access points online', n(wifiAPs, a => a.status !== 'online')],
    walkie: [`${radiosOut}/${radios.length}`, `radios out · ${radiosFix} in repair`, radiosFix],
    control: [`${n(controlRooms, r => r.status === 'operational')}/${controlRooms.length}`, 'rooms operational', n(controlRooms, r => r.status === 'alert')],
    inventory: [`${inv.needRestock}`, `need restock · ${inv.total} items${inv.withDamaged ? ` · ${inv.withDamaged} with damage` : ''}`, inv.needRestock],
    accommodation: [`${placed}/${beds}`, `beds filled${liveMeal ? ` · ${liveMeal.label}: ${STATUS_STEPS.find(x => x.key === liveMeal.status)?.label}` : ''}${unhoused ? ` · ${unhoused} need a room` : ''}`, unhoused],
    sewadars: [`${mp.arrived}/${mp.total}`, `arrived · ${mp.toCall} to call · ${mp.badgePending} badge pending`, mp.badgePending],
  };
  const keys = (Object.keys(cards) as DashboardDepartment[]).filter(k => exec || k === 'accommodation' || canAccessApp(k));
  const canAccessCctvControlRoom = exec || ['cctv', 'control'].includes(currentUser.subDepartmentId || '');

  // Keep this panel intentionally narrow: control-room alerts and inactive CCTV only.
  const items: Attention[] = [];
  const alertedRooms = controlRooms.filter(room => room.status === 'alert');
  const inactiveCameras = cameras.filter(camera => camera.status !== 'online');
  if (alertedRooms.length && (exec || canAccessApp('control'))) items.push({
    id: 'control-alerts', title: `${alertedRooms.length} control room${alertedRooms.length === 1 ? '' : 's'} on alert`,
    detail: alertedRooms.slice(0, 3).map(room => room.name).join(' · '), priority: 'Critical', href: '#/control',
  });
  if (inactiveCameras.length && (exec || canAccessApp('cctv'))) items.push({
    id: 'cctv-inactive', title: `${inactiveCameras.length} camera${inactiveCameras.length === 1 ? '' : 's'} not active`,
    detail: `${inactiveCameras.filter(camera => camera.status === 'maintenance').length} need orientation · ${inactiveCameras.filter(camera => camera.status === 'offline').length} not working`,
    priority: 'High', href: '#/cctv',
  });

  return (
    <div className="space-y-4">
      <section aria-label="Department status" className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        {keys.map(k => {
          const [main, sub, bad] = cards[k]; const I = ICONS[k];
          return (
            <a key={k} href={'#/' + k} className={`group flex items-center gap-3 rounded-lg border bg-surface px-3 py-3 transition hover:border-blue-500/50 ${['control', 'inventory', 'accommodation', 'sewadars'].includes(k) ? 'border-line' : bad ? 'border-amber-500/40' : 'border-line'}`}>
              <span className="grid place-items-center w-9 h-9 rounded-md bg-raised text-blue-500 shrink-0"><I size={17} /></span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2"><span className="text-xs font-semibold text-mute truncate">{DEPTS[k]}</span>
                  {DEMO.includes(k) && <Pill c="bg-raised text-mute">Demo</Pill>}</span>
                <>
                  <span className="block text-xl font-semibold text-ink leading-tight tabular-nums">{assetsLoading && (k === 'cctv' || k === 'wifi') ? '…' : main}</span>
                  <span className="block text-[11px] text-mute truncate">{sub}</span>
                </>
              </span>
              <span className={`w-2 h-2 rounded-full shrink-0 ${bad ? 'bg-amber-400' : 'bg-emerald-400'}`} title={bad ? 'Needs a look' : 'All good'} />
            </a>
          );
        })}
        {canAccessCctvControlRoom && <a href="#/cctv-control-room" className="group flex items-center gap-3 rounded-lg border border-line bg-surface px-3 py-3 transition hover:border-blue-500/50">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-raised text-blue-500"><Monitor size={17} /></span>
          <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-mute">CCTV Control Room</span><span className="mt-1 block truncate text-[11px] text-mute">Locations · PCs · Sewa shifts · attendance</span></span>
          <ChevronRight size={15} className="shrink-0 text-faint transition group-hover:translate-x-0.5 group-hover:text-blue-400" />
        </a>}
      </section>

      {exec ? <div className="grid items-stretch gap-3 lg:grid-cols-2">
        {keys.includes('accommodation') && <RoomReadinessCard rooms={roomReadiness} loading={acc.loading} eventName={accommodationEvent?.name} onOpen={() => setRoomReadinessOpen(true)}/>}
        <section className="min-w-0 rounded-xl border border-line bg-surface p-3 sm:p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div><h2 className="text-sm font-semibold text-ink">Expected vs arrived Sewadars</h2><p className="mt-0.5 text-[10px] text-mute">{staffingEvent ? staffingEvent.name : 'Select an event to view staffing.'}</p></div>
            <div className="flex items-center gap-2 text-[9px] text-mute"><span className="flex items-center gap-1"><i className="h-1.5 w-1.5 rounded-full bg-blue-400"/>Expected</span><span className="flex items-center gap-1"><i className="h-1.5 w-1.5 rounded-full bg-emerald-400"/>Arrived</span></div>
          </div>
          {staffingChart.length ? <button type="button" aria-label="Open detailed staffing charts" onClick={() => setStaffingDate(staffingEvent ? localDateKey(staffingEvent.starts_at) : staffingChart[Math.floor(staffingChart.length / 2)]?.date || '')} className="mt-2 block w-full rounded-lg border border-line/70 bg-raised/20 px-2 pt-2 text-left transition hover:border-blue-400/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">
            <StaffingTrendChart rows={staffingChart} onSelect={setStaffingDate} compact/>
            <span className="mb-2 block text-center text-[9px] text-blue-300">Select a date for sub-department details <span className="text-mute">· compressed height scale, exact counts shown</span></span>
          </button> : <div className="mt-2 flex min-h-28 items-center justify-center rounded-lg border border-dashed border-line px-3 text-center text-[10px] text-mute">{staffingEvent ? 'No daily Sewadar requirements have been entered yet.' : 'Choose an event in the header to load staffing.'}</div>}
        </section>
      </div> : keys.includes('accommodation') && <RoomReadinessCard rooms={roomReadiness} loading={acc.loading} eventName={accommodationEvent?.name} onOpen={() => setRoomReadinessOpen(true)}/>}
      {roomReadinessOpen && <RoomReadinessDialog rooms={roomReadiness} eventName={accommodationEvent?.name} onClose={() => setRoomReadinessOpen(false)}/>}

      {exec && <>
      {staffingDate && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm sm:p-6" onMouseDown={event => { if (event.target === event.currentTarget) setStaffingDate(''); }}>
        <section role="dialog" aria-modal="true" aria-labelledby="staffing-analysis-title" className="animate-calm-enter flex max-h-[92dvh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
          <header className="flex flex-wrap items-center gap-3 border-b border-line bg-gradient-to-r from-blue-500/[0.10] via-transparent to-cyan-400/[0.05] px-4 py-3 sm:px-5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-blue-400/20 bg-blue-500/10 text-blue-300"><TrendingUp size={17}/></span>
            <div className="min-w-0 flex-1"><h2 id="staffing-analysis-title" className="text-sm font-semibold text-ink">Staffing analysis</h2><p className="mt-0.5 text-xs text-mute">{staffingEvent?.name || 'Selected event'} · Compare the daily trend with department-level coverage.</p></div>
            <label className="flex items-center gap-2 text-[10px] font-medium text-mute">Selected date<select autoFocus className="rounded-lg border border-line bg-field px-2.5 py-2 text-xs text-ink" value={staffingDate} onChange={event => setStaffingDate(event.target.value)}>{staffingChart.map(row => <option key={row.date} value={row.date}>{new Date(row.date + 'T12:00:00').toLocaleDateString('en-IN',{dateStyle:'medium'})}</option>)}</select></label>
            <button type="button" onClick={()=>setStaffingDate('')} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line text-mute hover:bg-raised hover:text-ink" aria-label="Close staffing analysis"><X size={16}/></button>
          </header>
          <div className="overflow-y-auto p-3 sm:p-5">
            {(() => { const selected = staffingChart.find(row => row.date === staffingDate); return selected && <div className="mb-4 grid grid-cols-3 gap-2 sm:gap-3">
              {[['Expected',selected.expected,'text-blue-300','bg-blue-500/10'],['Arrived',selected.arrived,'text-emerald-300','bg-emerald-500/10'],['Remaining',Math.max(0,selected.expected-selected.arrived),'text-amber-300','bg-amber-500/10']].map(([label,value,color,bg])=><div key={String(label)} className={'rounded-xl border border-line px-3 py-2.5 ' + bg}><div className="text-[10px] text-mute">{label}</div><div className={'mt-0.5 text-lg font-semibold tabular-nums ' + color}>{value}</div></div>)}
            </div>; })()}
            <div className="space-y-4">
              <article className="rounded-xl border border-line bg-raised/20 p-3 sm:p-4"><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-xs font-semibold text-ink">Staffing by date</h3><p className="mt-0.5 text-[10px] text-mute">Select any date to compare coverage by department. Bar heights are compressed; labels show exact counts.</p></div><div className="flex gap-3 text-[10px] text-mute"><span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-blue-400"/>Expected</span><span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-emerald-400"/>Arrived</span></div></div><div className="overflow-x-auto"><StaffingTrendChart rows={staffingChart} selectedDate={staffingDate} onSelect={setStaffingDate}/></div></article>
              <article className="rounded-xl border border-line bg-raised/20 p-3 sm:p-4"><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-xs font-semibold text-ink">Department comparison · {new Date(staffingDate + 'T12:00:00').toLocaleDateString('en-IN',{dateStyle:'medium'})}</h3><p className="mt-0.5 text-[10px] text-mute">Circular coverage shows arrived against expected for every sub-department.</p></div><span className="flex items-center gap-1.5 text-[10px] text-mute"><i className="h-2.5 w-2.5 rounded-full border-2 border-blue-400"/>Coverage</span></div>{departmentChart.length ? <DepartmentComparisonChart rows={departmentChart}/> : <p className="rounded-lg border border-dashed border-line p-6 text-center text-xs text-mute">No department-level staffing is recorded for this date.</p>}</article>
            </div>
          </div>
        </section>
      </div>}
      </>}

      {exec && <div className="grid gap-3 lg:h-[calc(100dvh-14.5rem)] lg:min-h-[20rem] lg:grid-cols-2">
          <Card className="min-h-0 h-full overflow-hidden" icon={ListTodo} title="Ongoing work" tone="text-blue-500" action={<a href="#/sewadars" className={linkBtn}>Team board</a>}>
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              {ongoingTasks.length ? <ul className="divide-y divide-line">{ongoingTasks.map(t => <li key={t.id} className="py-2 flex items-start gap-3"><span className="mt-1.5 w-2 h-2 rounded-full bg-blue-500 shrink-0" /><span className="min-w-0 flex-1"><span className="block text-sm font-medium text-ink truncate">{t.title}</span><span className="block text-xs text-mute">{[t.team, t.assigned_to, t.due_date && `Due ${t.due_date}`].filter(Boolean).join(' · ') || 'Team task'}</span></span></li>)}</ul> : <div className="py-4 text-xs text-mute">No work is currently marked in progress.</div>}
            </div>
          </Card>
          <Card className="min-h-0 h-full overflow-hidden" icon={Zap} title="Needs attention" tone="text-amber-500" action={<span className="text-xs text-mute">{items.length} categories</span>}>
          <ul className="min-h-0 flex-1 overflow-y-auto divide-y divide-line pr-1">
            {items.slice(0, 8).map(a => (
              <li key={a.id}>
                <a href={a.href} className="py-2.5 flex items-center gap-3 text-sm hover:bg-raised/60 -mx-2 px-2 rounded-md">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${DOT[a.priority]}`} />
                  <span className="min-w-0 flex-1"><span className="block text-ink truncate">{a.title}</span><span className="block text-xs text-mute">{a.detail} · {a.priority}</span></span>
                  <ChevronRight size={15} className="text-faint" />
                </a>
              </li>))}
            {!items.length && <li><Empty>All clear. Nothing needs attention.</Empty></li>}
          </ul>
        </Card>
      </div>}
    </div>
  );
};
