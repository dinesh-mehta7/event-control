import React, { useEffect, useState } from 'react';
import { Zap, ListTodo, Video, Wifi, Radio, Monitor, Boxes, ShoppingCart, BedDouble, HeartHandshake, ChevronRight } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Card, Empty, Pill, linkBtn } from '../components/ui';
import { inr, DEPTS } from './orgData';
import { useWalkie } from '../modules/walkie';
import { useAccommodation } from '../modules/accommodation';
import { useManpower } from '../modules/manpower';
import { useInventory } from '../modules/inventory';
import { usePurchase } from '../modules/purchase';
import { supabase } from '../modules/walkie/lib/supabaseClient';
import { PAYABLE, poDue, poTotal } from '../modules/purchase/types';
import { pickLive } from '../modules/accommodation/live';
import { nowMinutes, todayStr } from '../modules/accommodation/dates';
import { STATUS_STEPS } from '../modules/accommodation/types';
import type { SubDepartmentId } from '../types';

const ICONS: Record<SubDepartmentId, any> = { cctv: Video, wifi: Wifi, walkie: Radio, control: Monitor, inventory: Boxes, purchase: ShoppingCart, accommodation: BedDouble, sewadars: HeartHandshake };
// These three still use sample data stored in the browser, so the dashboard says so.
const DEMO: SubDepartmentId[] = ['control'];
const DOT: Record<string, string> = { Critical: 'bg-red-500', High: 'bg-amber-400', Medium: 'bg-blue-500' };

interface Attention { id: string; title: string; detail: string; priority: 'Critical' | 'High' | 'Medium'; href: string }

export const Home: React.FC = () => {
  const { cameras, wifiAPs, controlRooms, currentUser, canAccessApp, assetsLoading } = useApp();
  const w: any = useWalkie();
  const acc = useAccommodation();
  const mp = useManpower().stats;
  const invCtx = useInventory(); const inv = invCtx.stats;
  const pur = usePurchase();
  const [ongoingTasks, setOngoingTasks] = useState<any[]>([]);
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
  const liveMeal = pickLive(acc.mealsOn(todayStr()), nowMinutes());

  const cards: Record<SubDepartmentId, [string, string, number]> = {
    cctv: [`${n(cameras, c => c.status === 'online')}/${cameras.length}`, 'cameras online', n(cameras, c => c.status !== 'online')],
    wifi: [`${n(wifiAPs, a => a.status === 'online')}/${wifiAPs.length}`, 'access points online', n(wifiAPs, a => a.status !== 'online')],
    walkie: [`${radiosOut}/${radios.length}`, `radios out · ${radiosFix} in repair`, radiosFix],
    control: [`${n(controlRooms, r => r.status === 'operational')}/${controlRooms.length}`, 'rooms operational', n(controlRooms, r => r.status === 'alert')],
    inventory: [`${inv.needRestock}`, `need restock · ${inv.total} items${inv.withDamaged ? ` · ${inv.withDamaged} with damage` : ''}`, inv.needRestock],
    purchase: [`${pur.stats.open}`, `open orders · ${pur.stats.awaiting} await approval${pur.stats.overdue ? ` · ${pur.stats.overdue} overdue` : ''}`, pur.stats.awaiting + pur.stats.overdue],
    accommodation: [`${placed}/${beds}`, `beds filled${liveMeal ? ` · ${liveMeal.label}: ${STATUS_STEPS.find(x => x.key === liveMeal.status)?.label}` : ''}${unhoused ? ` · ${unhoused} need a room` : ''}`, unhoused],
    sewadars: [`${mp.arrived}/${mp.total}`, `arrived · ${mp.toCall} to call · ${mp.badgePending} badge pending`, mp.badgePending],
  };
  const keys = (Object.keys(cards) as SubDepartmentId[]).filter(k => exec || k === 'accommodation' || canAccessApp(k));

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

  const live = pur.orders.filter(o => PAYABLE.includes(o.status));
  const committed = live.reduce((t, o) => t + poTotal(o), 0); const paid = live.reduce((t, o) => t + o.paid, 0); const due = live.reduce((t, o) => t + poDue(o), 0);
  return (
    <div className="space-y-4">
      <section aria-label="Department status" className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        {keys.map(k => {
          const [main, sub, bad] = cards[k]; const I = ICONS[k];
          return (
            <a key={k} href={k === 'purchase' ? '#/purchase' : '#/' + k} className={`group flex items-center gap-3 rounded-lg border bg-surface px-3 py-3 transition hover:border-blue-500/50 ${bad ? 'border-amber-500/40' : 'border-line'}`}>
              <span className="grid place-items-center w-9 h-9 rounded-md bg-raised text-blue-500 shrink-0"><I size={17} /></span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2"><span className="text-xs font-semibold text-mute truncate">{DEPTS[k]}</span>
                  {DEMO.includes(k) && <Pill c="bg-raised text-mute">Demo</Pill>}</span>
                {k === 'purchase' ? <span className="mt-1 grid grid-cols-3 gap-1.5">
                  {[['Committed', committed], ['Paid', paid], ['Still due', due]].map(([label, amount]) => <span key={label as string} className="min-w-0 rounded bg-raised/70 px-1.5 py-1"><span className="block truncate text-[9px] leading-tight text-mute">{label}</span><span className="block truncate text-[11px] font-semibold text-ink tabular-nums">{inr(amount as number)}</span></span>)}
                </span> : <>
                  <span className="block text-xl font-semibold text-ink leading-tight tabular-nums">{assetsLoading && (k === 'cctv' || k === 'wifi') ? '…' : main}</span>
                  <span className="block text-[11px] text-mute truncate">{sub}</span>
                </>}
              </span>
              <span className={`w-2 h-2 rounded-full shrink-0 ${bad ? 'bg-amber-400' : 'bg-emerald-400'}`} title={bad ? 'Needs a look' : 'All good'} />
            </a>
          );
        })}
      </section>

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
