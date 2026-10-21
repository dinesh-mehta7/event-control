import React, { useEffect, useMemo, useState } from 'react';
import {
  Zap,
  ListTodo,
  Video,
  Wifi,
  Radio,
  Monitor,
  Boxes,
  BedDouble,
  HeartHandshake,
  ChevronRight,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Card, Empty, Pill, linkBtn } from '../components/ui';
import { DEPTS, itDepartmentOf, subDepartmentsFor } from './orgData';
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
import { Legend, STAFFING_LEGEND, StaffingTrendChart } from './dashboard/charts';
import { StaffingDialog } from './dashboard/StaffingDialog';
import { RoomReadinessCard, RoomReadinessDialog } from './dashboard/RoomReadiness';
import { RequestsPipelineCard, RequestsPipelineDialog } from './dashboard/RequestsPipeline';
import { SewadarFunnelCard, SewadarFunnelDialog } from './dashboard/SewadarFunnel';
import { staffingCategoryKey } from './orgData';

type DashboardDepartment = Exclude<SubDepartmentId, 'purchase' | 'accounts'>;
const localDateKey = (value: string) => {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const ICONS: Record<DashboardDepartment, any> = {
  cctv: Video,
  wifi: Wifi,
  walkie: Radio,
  control: Monitor,
  inventory: Boxes,
  accommodation: BedDouble,
  sewadars: HeartHandshake,
};
// Control Rooms still uses sample data stored in the browser, so the dashboard says so.
const DEMO: SubDepartmentId[] = ['control'];
const DOT: Record<string, string> = { Critical: 'bg-red-500', High: 'bg-amber-400', Medium: 'bg-blue-500' };

interface Attention {
  id: string;
  title: string;
  detail: string;
  priority: 'Critical' | 'High' | 'Medium';
  href: string;
}
export const Home: React.FC = () => {
  const { cameras, wifiAPs, controlRooms, currentUser, canAccessApp, assetsLoading } = useApp();
  const w: any = useWalkie();
  const acc = useAccommodation();
  const manpower = useManpower();
  const mp = manpower.stats;
  const eventScope = useEventScope();
  const eventId = eventScope.scopeFor('event-reports');
  const staffingEvent = eventScope.events.find(event => event.id === eventId);
  const accommodationEvent = eventScope.events.find(event => event.id === eventScope.scopeFor('accommodation'));
  const [staffingRows, setStaffingRows] = useState<any[]>([]);
  const [attendanceRows, setAttendanceRows] = useState<any[]>([]);
  const [staffingDate, setStaffingDate] = useState('');
  const [roomReadinessOpen, setRoomReadinessOpen] = useState(false);
  const [graphOpen, setGraphOpen] = useState<'' | 'requests' | 'funnel'>('');
  const invCtx = useInventory();
  const inv = invCtx.stats;
  const [ongoingTasks, setOngoingTasks] = useState<any[]>([]);
  useEffect(() => {
    let live = true;
    if (!w.currentUser?.organizationId || !eventId) {
      setStaffingRows([]);
      setAttendanceRows([]);
      setStaffingDate('');
      return;
    }
    void Promise.all([
      supabase
        .from('event_staffing_requirements')
        .select('requirement_date,category,required_count,owner_department_id')
        .eq('organization_id', w.currentUser.organizationId)
        .eq('event_id', eventId)
        .order('requirement_date'),
      supabase
        .from('event_attendance')
        .select('member_id,status,checked_in_at,checked_out_at')
        .eq('organization_id', w.currentUser.organizationId)
        .eq('event_id', eventId),
    ]).then(([requirements, attendance]) => {
      if (!live) return;
      // A department sees the headcount it set for its own sub-departments; the Super Admin sees all.
      const depts: any[] = w.departments || [];
      const itDept = itDepartmentOf(depts)?.id || '';
      const mine = (row: any) =>
        w.currentUser?.level === 'owner' || (row.owner_department_id || itDept) === w.currentUser?.departmentId;
      if (!requirements.error) setStaffingRows((requirements.data || []).filter(mine));
      if (!attendance.error) setAttendanceRows(attendance.data || []);
    });
    return () => {
      live = false;
    };
  }, [w.currentUser?.organizationId, eventId]);
  const staffingChart = useMemo(() => {
    const dates = staffingEvent
      ? Array.from(
          { length: (staffingEvent.staffing_days_before ?? 7) + (staffingEvent.staffing_days_after ?? 7) + 1 },
          (_, index) => {
            const start = new Date(staffingEvent.starts_at);
            start.setHours(12, 0, 0, 0);
            start.setDate(start.getDate() + index - (staffingEvent.staffing_days_before ?? 7));
            return `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
          },
        )
      : Array.from(new Set(staffingRows.map(row => row.requirement_date))).sort();
    return dates.map(date => ({
      date,
      expected: staffingRows
        .filter(row => row.requirement_date === date)
        .reduce((n, row) => n + Number(row.required_count || 0), 0),
      arrived: attendanceRows.filter(
        row =>
          row.checked_in_at &&
          row.status !== 'absent' &&
          localDateKey(row.checked_in_at) <= date &&
          (!row.checked_out_at || localDateKey(row.checked_out_at) >= date),
      ).length,
    }));
  }, [staffingRows, attendanceRows, staffingEvent]);
  const departmentChart = useMemo(() => {
    if (!staffingDate) return [];
    const needs = staffingRows.filter(row => row.requirement_date === staffingDate);
    const ownDept = (w.departments || []).find((d: any) => d.id === w.currentUser?.departmentId);
    const categories: [string, string][] =
      w.currentUser?.level === 'owner'
        ? Object.entries(DEPTS)
        : subDepartmentsFor(ownDept).map(id => [id, (DEPTS as Record<string, string>)[id] || id]);
    return categories.map(([id, name]) => {
      const req = needs
        .filter(row => staffingCategoryKey(row.category).toLowerCase() === id.toLowerCase())
        .reduce((n, row) => n + Number(row.required_count || 0), 0);
      const actual = attendanceRows
        .filter(
          row =>
            row.checked_in_at &&
            row.status !== 'absent' &&
            localDateKey(row.checked_in_at) <= staffingDate &&
            (!row.checked_out_at || localDateKey(row.checked_out_at) >= staffingDate),
        )
        .filter(row => {
          const p = manpower.sewadars.find(person => person.id === row.member_id);
          return p && staffingCategoryKey(p.department || '').toLowerCase() === id.toLowerCase();
        }).length;
      return { name, expected: req, arrived: actual };
    });
  }, [staffingDate, staffingRows, attendanceRows, manpower.sewadars]);
  useEffect(() => {
    const orgId = w.currentUser?.organizationId;
    if (!orgId || (currentUser.role !== 'owner' && currentUser.role !== 'dept_head')) return;
    const load = async () => {
      const [{ data: manpower, error: manpowerError }, { data: accommodation, error: accommodationError }] =
        await Promise.all([
          supabase
            .from('manpower_tasks')
            .select('id,title,team,assigned_to,due_date,updated_at')
            .eq('status', 'in_progress')
            .order('updated_at', { ascending: false })
            .limit(8),
          supabase
            .from('accommodation_member_tasks')
            .select('id,title,assigned_to,due_date,updated_at,accommodation_members(name)')
            .eq('status', 'in_progress')
            .order('updated_at', { ascending: false })
            .limit(8),
        ]);
      if (!manpowerError || !accommodationError)
        setOngoingTasks(
          [
            ...(manpower || []),
            ...(accommodation || []).map((t: any) => ({
              ...t,
              team: 'Accommodation',
              assigned_to: t.accommodation_members?.name || t.assigned_to,
            })),
          ]
            .sort((a: any, b: any) => String(b.updated_at).localeCompare(String(a.updated_at)))
            .slice(0, 8),
        );
    };
    load();
    const channel = supabase
      .channel(`home-tasks-${orgId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'manpower_tasks', filter: `organization_id=eq.${orgId}` },
        load,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'accommodation_member_tasks', filter: `organization_id=eq.${orgId}` },
        load,
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [w.currentUser?.organizationId, currentUser.role]); // eslint-disable-line

  const exec = currentUser.role === 'owner' || currentUser.role === 'dept_head';
  const n = (a: any[], f: (x: any) => boolean) => a.filter(f).length;
  const radios: any[] = w.walkies || [];
  const radiosOut = n(radios, r => r.status === 'Allocated');
  const radiosFix = n(radios, r => r.status === 'Under Maintenance');
  const beds = acc.rooms.reduce((t, r) => t + r.capacity, 0);
  const placed = acc.members.filter(m => m.roomId).length;
  const unhoused = acc.members.length - placed;
  const roomReadiness = useMemo(
    () =>
      acc.rooms
        .map(room => {
          const requirements = room.requirements || [];
          const total = requirements.reduce((sum, item) => sum + Math.max(0, Number(item.quantity) || 0), 0);
          const prepared = requirements.reduce(
            (sum, item) =>
              sum + Math.min(Math.max(0, Number(item.readyQuantity) || 0), Math.max(0, Number(item.quantity) || 0)),
            0,
          );
          const percent = total ? Math.round((prepared / total) * 100) : 0;
          const ready =
            requirements.length > 0 &&
            requirements.every(item => item.quantity > 0 && item.readyQuantity >= item.quantity);
          return {
            id: room.id,
            name: room.name,
            category: room.category,
            percent,
            ready,
            hasRequirements: requirements.length > 0,
            readyItems: requirements.filter(item => item.quantity > 0 && item.readyQuantity >= item.quantity).length,
            totalItems: requirements.length,
            preparedQuantity: prepared,
            neededQuantity: total,
            returnedItems: requirements.filter(item => item.returned).length,
          };
        })
        .sort((a, b) => Number(b.ready) - Number(a.ready) || a.name.localeCompare(b.name)),
    [acc.rooms],
  );
  const liveMeal = pickLive(acc.mealsOn(todayStr()), nowMinutes());

  const cards: Record<DashboardDepartment, [string, string, number]> = {
    cctv: [
      `${n(cameras, c => c.status === 'online')}/${cameras.length}`,
      'cameras online',
      n(cameras, c => c.status !== 'online'),
    ],
    wifi: [
      `${n(wifiAPs, a => a.status === 'online')}/${wifiAPs.length}`,
      'access points online',
      n(wifiAPs, a => a.status !== 'online'),
    ],
    walkie: [`${radiosOut}/${radios.length}`, `radios out · ${radiosFix} in repair`, radiosFix],
    control: [
      `${n(controlRooms, r => r.status === 'operational')}/${controlRooms.length}`,
      'rooms operational',
      n(controlRooms, r => r.status === 'alert'),
    ],
    inventory: [
      `${inv.needRestock}`,
      `need restock · ${inv.total} items${inv.withDamaged ? ` · ${inv.withDamaged} with damage` : ''}`,
      inv.needRestock,
    ],
    accommodation: [
      `${placed}/${beds}`,
      `beds filled${liveMeal ? ` · ${liveMeal.label}: ${STATUS_STEPS.find(x => x.key === liveMeal.status)?.label}` : ''}${unhoused ? ` · ${unhoused} need a room` : ''}`,
      unhoused,
    ],
    sewadars: [
      `${mp.arrived}/${mp.total}`,
      `arrived · ${mp.toCall} to call · ${mp.badgePending} badge pending`,
      mp.badgePending,
    ],
  };
  const keys = (Object.keys(cards) as DashboardDepartment[]).filter(k => k === 'accommodation' || canAccessApp(k));
  // IT services: the IT department, its CCTV / Control Rooms people, and the Super Admin.
  const canAccessCctvControlRoom = canAccessApp('cctv') || canAccessApp('control');

  // Keep this panel intentionally narrow: control-room alerts and inactive CCTV only.
  const items: Attention[] = [];
  const alertedRooms = controlRooms.filter(room => room.status === 'alert');
  const inactiveCameras = cameras.filter(camera => camera.status !== 'online');
  if (alertedRooms.length && canAccessApp('control'))
    items.push({
      id: 'control-alerts',
      title: `${alertedRooms.length} control room${alertedRooms.length === 1 ? '' : 's'} on alert`,
      detail: alertedRooms
        .slice(0, 3)
        .map(room => room.name)
        .join(' · '),
      priority: 'Critical',
      href: '#/control',
    });
  if (inactiveCameras.length && canAccessApp('cctv'))
    items.push({
      id: 'cctv-inactive',
      title: `${inactiveCameras.length} camera${inactiveCameras.length === 1 ? '' : 's'} not active`,
      detail: `${inactiveCameras.filter(camera => camera.status === 'maintenance').length} need orientation · ${inactiveCameras.filter(camera => camera.status === 'offline').length} not working`,
      priority: 'High',
      href: '#/cctv',
    });

  return (
    <div className="space-y-4">
      <section aria-label="Department status" className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        {keys.map(k => {
          const [main, sub, bad] = cards[k];
          const I = ICONS[k];
          return (
            <a
              key={k}
              href={'#/' + k}
              className={`lift group flex items-center gap-3 rounded-lg border bg-surface px-3 py-3 hover:border-blue-500/50 ${['control', 'inventory', 'accommodation', 'sewadars'].includes(k) ? 'border-line' : bad ? 'border-amber-500/40' : 'border-line'}`}
            >
              <span className="grid place-items-center w-9 h-9 rounded-md bg-raised text-blue-500 shrink-0">
                <I size={17} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-mute truncate">{DEPTS[k]}</span>
                  {DEMO.includes(k) && <Pill c="bg-raised text-mute">Demo</Pill>}
                </span>
                <>
                  <span className="block text-xl font-semibold text-ink leading-tight tabular-nums">
                    {assetsLoading && (k === 'cctv' || k === 'wifi') ? '…' : main}
                  </span>
                  <span className="block text-[11.5px] text-mute truncate">{sub}</span>
                </>
              </span>
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${bad ? 'bg-amber-400' : 'bg-emerald-400'}`}
                title={bad ? 'Needs a look' : 'All good'}
              />
            </a>
          );
        })}
        {canAccessCctvControlRoom && (
          <a
            href="#/cctv-control-room"
            className="lift group flex items-center gap-3 rounded-lg border border-line bg-surface px-3 py-3 hover:border-blue-500/50"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-raised text-blue-500">
              <Monitor size={17} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-semibold text-mute">CCTV Control Room</span>
              <span className="mt-1 block truncate text-[11.5px] text-mute">
                Locations · PCs · Sewa shifts · attendance
              </span>
            </span>
            <ChevronRight
              size={15}
              className="shrink-0 text-faint transition group-hover:translate-x-0.5 group-hover:text-blue-400"
            />
          </a>
        )}
      </section>

      {exec ? (
        <div className="grid items-stretch gap-3 lg:grid-cols-2">
          {keys.includes('accommodation') && (
            <RoomReadinessCard
              rooms={roomReadiness}
              loading={acc.loading}
              eventName={accommodationEvent?.name}
              onOpen={() => setRoomReadinessOpen(true)}
            />
          )}
          <section className="flex min-w-0 flex-col rounded-xl border border-line bg-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-ink">Expected vs arrived Sewadars</h2>
                <p className="mt-0.5 text-[11.5px] text-mute">
                  {staffingEvent ? staffingEvent.name : 'Select an event to view staffing.'}
                </p>
              </div>
              <Legend items={STAFFING_LEGEND} />
            </div>
            {staffingChart.length ? (
              <div className="mt-3 flex flex-1 flex-col">
                <StaffingTrendChart rows={staffingChart} onSelect={setStaffingDate} height={220} />
                <div className="mt-2 flex items-center justify-between gap-2 border-t border-line pt-2 text-[11.5px] text-mute">
                  <span>Hover a date for exact counts · select it for department coverage</span>
                  <button
                    type="button"
                    className="inline-flex shrink-0 items-center gap-0.5 font-medium text-blue-300 hover:text-blue-200"
                    onClick={() =>
                      setStaffingDate(
                        staffingEvent && staffingChart.some(row => row.date === localDateKey(staffingEvent.starts_at))
                          ? localDateKey(staffingEvent.starts_at)
                          : staffingChart[Math.floor(staffingChart.length / 2)].date,
                      )
                    }
                  >
                    Staffing analysis
                    <ChevronRight size={13} />
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-3 flex min-h-28 flex-1 items-center justify-center rounded-lg border border-dashed border-line px-3 text-center text-[11.5px] text-mute">
                {staffingEvent
                  ? 'No daily Sewadar requirements have been entered yet.'
                  : 'Choose an event in the header to load staffing.'}
              </div>
            )}
          </section>
        </div>
      ) : (
        keys.includes('accommodation') && (
          <RoomReadinessCard
            rooms={roomReadiness}
            loading={acc.loading}
            eventName={accommodationEvent?.name}
            onOpen={() => setRoomReadinessOpen(true)}
          />
        )
      )}
      {exec && (
        <div className="grid items-stretch gap-3 lg:grid-cols-2">
          <RequestsPipelineCard onOpen={() => setGraphOpen('requests')} />
          <SewadarFunnelCard onOpen={() => setGraphOpen('funnel')} />
        </div>
      )}
      {graphOpen === 'requests' && <RequestsPipelineDialog onClose={() => setGraphOpen('')} />}
      {graphOpen === 'funnel' && <SewadarFunnelDialog onClose={() => setGraphOpen('')} />}
      {roomReadinessOpen && (
        <RoomReadinessDialog
          rooms={roomReadiness}
          eventName={accommodationEvent?.name}
          onClose={() => setRoomReadinessOpen(false)}
        />
      )}

      {exec && staffingDate && (
        <StaffingDialog
          eventName={staffingEvent?.name}
          rows={staffingChart}
          departments={departmentChart}
          date={staffingDate}
          onDate={setStaffingDate}
          onClose={() => setStaffingDate('')}
        />
      )}

      {exec && (
        <div className="grid gap-3 lg:h-[calc(100dvh-14.5rem)] lg:min-h-[20rem] lg:grid-cols-2">
          <Card
            className="min-h-0 h-full overflow-hidden"
            icon={ListTodo}
            title="Ongoing work"
            tone="text-blue-500"
            action={
              <a href="#/sewadars" className={linkBtn}>
                Team board
              </a>
            }
          >
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              {ongoingTasks.length ? (
                <ul className="divide-y divide-line">
                  {ongoingTasks.map(t => (
                    <li key={t.id} className="py-2 flex items-start gap-3">
                      <span className="mt-1.5 w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-ink truncate">{t.title}</span>
                        <span className="block text-xs text-mute">
                          {[t.team, t.assigned_to, t.due_date && `Due ${t.due_date}`].filter(Boolean).join(' · ') ||
                            'Team task'}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="py-4 text-xs text-mute">No work is currently marked in progress.</div>
              )}
            </div>
          </Card>
          <Card
            className="min-h-0 h-full overflow-hidden"
            icon={Zap}
            title="Needs attention"
            tone="text-amber-500"
            action={<span className="text-xs text-mute">{items.length} categories</span>}
          >
            <ul className="min-h-0 flex-1 overflow-y-auto divide-y divide-line pr-1">
              {items.slice(0, 8).map(a => (
                <li key={a.id}>
                  <a
                    href={a.href}
                    className="py-2.5 flex items-center gap-3 text-sm hover:bg-raised/60 -mx-2 px-2 rounded-md"
                  >
                    <span className={`w-2 h-2 rounded-full shrink-0 ${DOT[a.priority]}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-ink truncate">{a.title}</span>
                      <span className="block text-xs text-mute">
                        {a.detail} · {a.priority}
                      </span>
                    </span>
                    <ChevronRight size={15} className="text-faint" />
                  </a>
                </li>
              ))}
              {!items.length && (
                <li>
                  <Empty>All clear. Nothing needs attention.</Empty>
                </li>
              )}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
};
