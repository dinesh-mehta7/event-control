import React, { useEffect, useMemo, useRef, useState } from 'react';
import { memberMeta } from '../manpower/memberMeta';
import { BedDouble, Building2, Circle, CircleCheck, Edit3, ListTodo, Lock, Play, Plus, Search, Trash2, Upload, UserPlus, Users } from 'lucide-react';
import { useAccommodation } from './AccommodationContext';
import { DEPT_LABEL, DEPT_OPTIONS } from './types';
import type { Member, MemberImportRow, Room, RoomRequirement } from './types';
import { Modal, ConfirmModal, btnGhost, btnPrimary, card, cx, inputCls, labelCls } from './ui';
import { supabase } from '../walkie/lib/supabaseClient';
import { useWalkie } from '../walkie';
import { useEventScope } from '../../context/EventScopeContext';
import { useManpower } from '../manpower';

type Mode = 'rooms' | 'members';

const headerKey = (s: string) => s.replace(/^\uFEFF/, '').split(/[-–—]/)[0].trim().toLowerCase().replace(/[^a-z0-9]/g, '');
const dateISO = (s: string) => { const v = s.trim(); if (!v) return ''; if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v; const m = v.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/); return m ? `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}` : v; };
const parseCsv = (input: string): string[][] => {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false;
  const s = input.replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted && c === '"' && s[i + 1] === '"') { cell += '"'; i++; }
    else if (c === '"') quoted = !quoted;
    else if (!quoted && c === ',') { row.push(cell); cell = ''; }
    else if (!quoted && (c === '\n' || c === '\r')) { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
};

export const RoomsView: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const { rooms, members, canManageRooms, canDefineRoomRequirements, isDark: dark, loading, membersInRoom,
    addRoom, updateRoom, updateRoomSetup, deleteRoom, addMembers, importMembers, updateMember, deleteMember } = useAccommodation();
  const eventScope = useEventScope();
  const roomEventId = eventScope.scopeFor('accommodation');
  const roomEvent = eventScope.events.find(event => event.id === roomEventId);
  const roomEventName = roomEvent?.name || 'Normal';
  const auth: any = useWalkie();
  const canAdminAssignRoomMembers = ['owner', 'dept_head'].includes(auth.currentUser?.level);
  const canEditRoomDefinitions = canManageRooms && !roomEventId;
  const manpower = useManpower();
  const orgId = auth.currentUser?.organizationId;
  const [eventHeadcount, setEventHeadcount] = useState<{ hereNow: number; returned: number; memberStatuses: Record<string, string> }>({ hereNow: 0, returned: 0, memberStatuses: {} });
  const [linkedControlRooms, setLinkedControlRooms] = useState<Record<string, { name: string; location: string; pc_count: number }>>({});
  useEffect(() => {
    if (!orgId) { setLinkedControlRooms({}); return; }
    let live = true;
    const refresh = async () => {
      const { data, error } = await supabase.from('cctv_control_rooms').select('accommodation_room_id,name,location,pc_count').eq('organization_id', orgId).eq('event_scope_key', roomEventId || 'normal').not('accommodation_room_id', 'is', null);
      if (!live) return;
      if (!error) setLinkedControlRooms(Object.fromEntries((data || []).filter(row => row.accommodation_room_id).map(row => [row.accommodation_room_id, row])));
    };
    void refresh();
    const channel = supabase.channel(`accommodation-control-room-links-${orgId}-${roomEventId || 'normal'}`).on('postgres_changes', { event: '*', schema: 'public', table: 'cctv_control_rooms', filter: `organization_id=eq.${orgId}` }, () => void refresh()).subscribe();
    return () => { live = false; void supabase.removeChannel(channel); };
  }, [orgId, roomEventId]);
  useEffect(() => {
    if (!orgId || !roomEventId) { setEventHeadcount({ hereNow: 0, returned: 0, memberStatuses: {} }); return; }
    let live = true;
    const refreshHeadcount = async () => {
      const { data, error } = await supabase.from('event_attendance').select('member_id,status').eq('organization_id', orgId).eq('event_id', roomEventId);
      if (!live || error) return;
      const rows = data || [];
      setEventHeadcount({ hereNow: rows.filter(row => row.status === 'present').length, returned: rows.filter(row => row.status === 'checked_out').length, memberStatuses: Object.fromEntries(rows.filter(row => row.member_id).map(row => [row.member_id, row.status])) });
    };
    void refreshHeadcount();
    const channel = supabase.channel(`accommodation-attendance-${orgId}-${roomEventId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_attendance', filter: `organization_id=eq.${orgId}` }, () => void refreshHeadcount())
      .subscribe();
    return () => { live = false; void supabase.removeChannel(channel); };
  }, [orgId, roomEventId]);
  const canManageTasks = canManageRooms || (['owner', 'dept_head'].includes(auth.currentUser?.level) && !!roomEventId);
  const [tasks, setTasks] = useState<any[]>([]);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskMember, setTaskMember] = useState('');
  const [taskDetails, setTaskDetails] = useState('');
  const [taskBusy, setTaskBusy] = useState(false);

  const loadTasks = async () => {
    if (!orgId) return;
    const { data, error } = await supabase.from('accommodation_member_tasks').select('*').order('created_at', { ascending: false });
    if (!error) setTasks(data || []);
  };
  useEffect(() => { loadTasks(); }, [orgId]); // eslint-disable-line
  const saveTask = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!orgId || !taskTitle.trim()) return;
    const selected = members.find(m => m.id === taskMember);
    const assignedTo = selected?.name || (auth.currentUser?.name || '');
    setTaskBusy(true);
    const { error } = await supabase.from('accommodation_member_tasks').insert({
      id: `amt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, organization_id: orgId,
      member_id: selected?.id || members[0]?.id, title: taskTitle.trim(), details: taskDetails.trim(),
      assigned_to: assignedTo, created_by: auth.currentUser?.id,
    });
    setTaskBusy(false);
    if (error) { auth.addToast?.(`Could not save task: ${error.message}`, 'error'); return; }
    setTaskTitle(''); setTaskDetails(''); setTaskMember(''); await loadTasks();
  };
  const updateTaskStatus = async (task: any, status: string) => {
    const { error } = await supabase.from('accommodation_member_tasks').update({ status, updated_at: new Date().toISOString() }).eq('id', task.id);
    if (error) auth.addToast?.(`Could not update task: ${error.message}`, 'error'); else await loadTasks();
  };
  const assignRoomSetupTask = async (room: Room) => {
    if (!orgId || !canManageTasks) return;
    const title = window.prompt(`Setup task for ${room.name}`, `Prepare ${room.name}`)?.trim();
    if (!title) return;
    const team = manpower.teams.find(item => item.name === room.responsibleTeam);
    const { error } = await supabase.from('accommodation_member_tasks').insert({
      id: `room-task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, organization_id: orgId,
      member_id: null, room_id: room.id, event_id: roomEventId || null, title, details: `Prepare event room: ${room.name}`,
      assigned_to: team?.lead || auth.currentUser?.name || '', created_by: auth.currentUser?.id,
    });
    if (error) auth.addToast?.(`Could not assign room task: ${error.message}. Run migration_v79_event_room_requirements.sql.`, 'error'); else await loadTasks();
  };

  const [mode] = useState<Mode>('rooms');
  const [search, setSearch] = useState('');
  const [roomFilter, setRoomFilter] = useState<string>('all'); // all | none | roomId
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [roomModal, setRoomModal] = useState<null | 'new' | Room>(null);
  const [roomAssignmentModal, setRoomAssignmentModal] = useState<Room | null>(null);
  const [requirementsRoom, setRequirementsRoom] = useState<Room | null>(null);
  const [memberModal, setMemberModal] = useState<null | { room?: string } | Member>(null);
  const [confirm, setConfirm] = useState<null | { title: string; body: string; label: string; run: () => void }>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [importMessage, setImportMessage] = useState('');
  const [importBusy, setImportBusy] = useState(false);

  const restRooms = rooms.filter(room => room.category === 'rest_room');
  const totalBeds = restRooms.reduce((t, r) => t + r.capacity, 0);
  const placed = members.filter(m => m.roomId && restRooms.some(r => r.id === m.roomId)).length;
  const placedInRestRooms = members.filter(m => m.roomId && restRooms.some(r => r.id === m.roomId)).length;
  const unassigned = members.length - placed;
  const roomById = useMemo(() => new Map(restRooms.map(r => [r.id, r])), [restRooms]);
  const roomsReady = restRooms.filter(room => room.requirements.length > 0 && room.requirements.every(item => item.quantity > 0 && item.readyQuantity >= item.quantity)).length;
  const roomsReadyPercent = restRooms.length ? Math.round((roomsReady / restRooms.length) * 100) : 0;
  const bedsFree = Math.max(0, totalBeds - placedInRestRooms);
  const bedsFreePercent = totalBeds ? Math.round((bedsFree / totalBeds) * 100) : null;
  const membersPlacedPercent = members.length ? Math.round((placed / members.length) * 100) : null;

  // rooms grouped by block
  const grouped = useMemo(() => {
    const g = new Map<string, Room[]>();
    restRooms.forEach(r => { const k = r.block || 'Rooms'; g.set(k, [...(g.get(k) || []), r]); });
    return Array.from(g.entries());
  }, [restRooms]);

  const q = search.trim().toLowerCase();
  const canFulfillRoomRequirements = (room: Room) => {
    if (canManageRooms) return true;
    const currentName = String(auth.currentUser?.name || '').trim().toLocaleLowerCase();
    if (!currentName) return false;
    if (room.category === 'rest_room') return auth.currentUser?.subDepartment === 'accommodation';
    const leadsTeam = manpower.teams.some(team => team.name === room.responsibleTeam && team.lead.trim().toLocaleLowerCase() === currentName);
    const belongsToTeam = manpower.sewadars.some(person => person.name.trim().toLocaleLowerCase() === currentName && person.teams.includes(room.responsibleTeam));
    return leadsTeam || belongsToTeam;
  };
  const presentRoomCandidates = manpower.sewadars
    .filter(sewadar => eventHeadcount.memberStatuses[sewadar.id] === 'present')
    .map(sewadar => members.find(member => member.id === sewadar.id))
    .filter((member): member is Member => !!member);
  const saveRoomAssignment = async (room: Room, selectedIds: string[]) => {
    const selected = new Set(selectedIds);
    const presentIds = new Set(presentRoomCandidates.map(member => member.id));
    const currentlyPresentInRoom = members.filter(member => member.roomId === room.id && presentIds.has(member.id));
    const stayingInRoom = members.filter(member => member.roomId === room.id && !presentIds.has(member.id)).length;
    if (stayingInRoom + selected.size > room.capacity) {
      auth.addToast?.(`Only ${Math.max(0, room.capacity - stayingInRoom)} bed(s) are available for present Sewadars.`, 'error');
      return false;
    }
    const toUnassign = currentlyPresentInRoom.filter(member => !selected.has(member.id));
    const toAssign = presentRoomCandidates.filter(member => selected.has(member.id) && member.roomId !== room.id);
    for (const member of [...toUnassign, ...toAssign]) {
      const ok = await updateMember(member.id, { roomId: selected.has(member.id) ? room.id : null });
      if (!ok) return false;
    }
    return true;
  };
  const visibleMembers = members.filter(m => {
    if (typeFilter !== 'all' && m.memberType !== typeFilter) return false;
    if (roomFilter === 'none' && m.roomId) return false;
    if (roomFilter !== 'all' && roomFilter !== 'none' && m.roomId !== roomFilter) return false;
    if (!q) return true;
    const room = m.roomId ? roomById.get(m.roomId) : null;
    return m.name.toLowerCase().includes(q) || (room?.name || '').toLowerCase().includes(q) || (DEPT_LABEL[m.department] || '').toLowerCase().includes(q);
  });

  const muted = 'text-mute';
  const importCsv = async (file?: File) => {
    if (!file) return;
    setImportBusy(true); setImportMessage('');
    try {
      const rows = parseCsv(await file.text());
      if (rows.length < 2) throw new Error('CSV needs a header row and at least one member row.');
      const headers = rows[0].map(headerKey);
      const val = (r: string[], ...keys: string[]) => { const i = headers.findIndex(h => keys.includes(h) || keys.some(k => h.startsWith(k))); return i >= 0 ? (r[i] || '').trim() : ''; };
      const imported: MemberImportRow[] = rows.slice(1).filter(r => r.some(x => x.trim())).map(r => {
        const roomName = val(r, 'room', 'roomnumber', 'roomname');
        const rawDept = val(r, 'department', 'dept').toLowerCase();
        const department = DEPT_OPTIONS.find(([id, label]) => id === rawDept || label.toLowerCase() === rawDept)?.[0] || '';
        const kind = val(r, 'membertype', 'type', 'category').toLowerCase();
        const employeeName = val(r, 'employeename', 'employee');
        return {
          name: val(r, 'name', 'fullname') || employeeName,
          memberType: (kind.includes('annual') || kind.includes('annually') ? 'annual' : kind.includes('month') ? 'monthly' : 'salary_based') as MemberImportRow['memberType'],
          serialNo: val(r, 'srno', 'serialno', 'serialnumber'), batchNo: val(r, 'badgeno', 'badgenumber', 'badge', 'bno', 'batchno', 'batchnumber'),
          relation: val(r, 'rel', 'relation'), relationName: val(r, 'relationname', 'fathername', 'guardianname'),
          mobile: val(r, 'mobile', 'phone', 'mobilenumber'), villageCity: val(r, 'villagecity', 'village', 'city'),
          branch: val(r, 'branch'), occupation: val(r, 'occupation'), remarks: val(r, 'remarks'),
          joiningDate: dateISO(val(r, 'sewajoiningdate', 'joiningdate', 'promiseddate')), employeeCode: val(r, 'empcode', 'employeecode'),
          employeeId: val(r, 'employeeid', 'empid'), address: val(r, 'address', 'address1'), address2: val(r, 'address2', 'addressline2'),
          expectedArrival: dateISO(val(r, 'expectedarrival', 'promisedarrival', 'sewajoiningdate', 'joiningdate', 'promiseddate')),
          teamName: val(r, 'teamname', 'team'), teamLead: val(r, 'teamlead', 'lead'),
          department, roomId: restRooms.find(room => room.name.toLowerCase() === roomName.toLowerCase())?.id || null,
        };
      }).filter(r => r.name);
      const ok = await importMembers(imported);
      setImportMessage(ok ? `${imported.length} member rows imported.` : 'Import did not complete. Check the roster schema migration and your room capacities.');
    } catch (e: any) { setImportMessage(e?.message || 'Could not read that CSV file.'); }
    setImportBusy(false); if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className={cx(embedded ? 'space-y-3 text-[13.5px]' : 'space-y-5', embedded && 'text-ink')}>
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
        {!embedded && <><h1 className="text-2xl font-bold tracking-tight">Rest rooms</h1><p className={cx('text-sm', muted)}>Rest room capacity and readiness for this event.</p></>}
        </div>
        {roomEventId && <p className={cx('flex items-center gap-1.5 text-xs', muted)}><Lock className="w-3.5 h-3.5" />Event rooms are managed in Requirement Management. View and return necessities here.</p>}
        {!canManageRooms && !roomEventId && <p className={cx('flex items-center gap-1.5 text-xs', muted)}><Lock className="w-3.5 h-3.5" />View only — room and member edits are limited to accommodation leads and IT owners.</p>}
      </div>
      {importMessage && <div role="status" className={cx('rounded-lg border px-3 py-2 text-xs', importMessage.includes('imported.') ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : 'border-amber-500/30 bg-amber-500/10 text-amber-300')}>{importMessage} CSV headers can match Sr. No., B. No., Name, Rel, Relation Name, Mobile, Village/City, Branch, Occupation, Remarks, SEWA JOINING DATE, EMP CODE, Employee ID, Address, Address 2, Department, Member Type, and Room.</div>}
      <p className={cx('text-[11.5px]', muted)}>{roomEventId ? `Here now and returned-back totals stay synced with ${roomEventName} attendance.` : 'Select an event in the header to see live here-now and returned-back totals.'}</p>

      <div className="grid gap-3 md:grid-cols-3">
        <SummaryCard dark={dark} icon={Building2} title="Rest rooms" value={restRooms.length} metricLabel="Ready rooms" metricValue={roomsReady} detail={`${roomsReady} of ${restRooms.length} fully ready`} percent={restRooms.length ? roomsReadyPercent : null} color="rgb(var(--c-chart-ok))" />
        <SummaryCard dark={dark} icon={BedDouble} title="Beds" value={totalBeds} metricLabel="Beds free" metricValue={bedsFree} detail={`${bedsFree} of ${totalBeds} available`} percent={bedsFreePercent} color="rgb(var(--c-chart-3))" />
        <SummaryCard dark={dark} icon={Users} title="Members" value={members.length} metricLabel="In rooms" metricValue={placed} detail={`${placed} assigned · ${unassigned} not in a room`} percent={membersPlacedPercent} color="rgb(var(--c-chart-1))" />
      </div>

      {canEditRoomDefinitions && <div className="flex flex-wrap items-center justify-end gap-2">
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" aria-label="Import members from CSV" onChange={e => importCsv(e.target.files?.[0])} />
        {canAdminAssignRoomMembers && <>
          <button className={cx(btnGhost(dark), 'rounded-lg px-2.5 py-2')} disabled={importBusy} onClick={() => fileRef.current?.click()}><Upload className="w-4 h-4" />{importBusy ? 'Importing…' : 'Import CSV'}</button>
          <button className={cx(btnGhost(dark), 'rounded-lg px-2.5 py-2')} onClick={() => setMemberModal({})}><UserPlus className="w-4 h-4" />Add members</button>
        </>}
        <button className={cx(btnPrimary, 'rounded-lg px-3 py-2 text-xs')} onClick={() => setRoomModal('new')}><Plus className="w-4 h-4" />Add room</button>
      </div>}

      {loading && !rooms.length && !members.length && <p className={cx('text-sm', muted)}>Loading…</p>}

      {mode === 'rooms' && (
        <>
          {!loading && !restRooms.length && (
            <div className={cx('rounded-xl border p-10 text-center', card(dark))}>
              <Building2 className="w-8 h-8 mx-auto mb-3 text-faint" />
              <p className="font-semibold">No rooms yet</p>
              <p className={cx('text-sm mt-1', muted)}>{roomEventId ? 'Create a rest room in Event Planning to see it here.' : canManageRooms ? 'Add your first rest room to start placing members.' : 'The department owner has not added any rooms yet.'}</p>
            </div>
          )}
          {grouped.map(([block, list]) => (
            <section key={block} aria-label={block}>
              <h2 className={cx('text-[11.5px] font-bold uppercase tracking-wider mb-2', muted)}>{block} · {list.length} room{list.length === 1 ? '' : 's'}</h2>
              <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
                {list.map(r => {
                  const inside = membersInRoom(r.id);
                  const membersHereNow = roomEventId ? inside.filter(member => eventHeadcount.memberStatuses[member.id] === 'present').length : inside.length;
                  const pct = Math.min(100, Math.round((inside.length / r.capacity) * 100));
                  const full = inside.length >= r.capacity;
                  const roomReady = r.requirements.length > 0 && r.requirements.every(x => x.quantity > 0 && x.readyQuantity >= x.quantity);
                  const roomReturned = r.requirements.length > 0 && r.requirements.every(x => x.returned);
                  const neededTotal = r.requirements.reduce((sum, item) => sum + Math.max(0, item.quantity), 0);
                  const readyTotal = r.requirements.reduce((sum, item) => sum + Math.min(Math.max(0, item.readyQuantity), Math.max(0, item.quantity)), 0);
                  const readinessPercent = neededTotal ? Math.round((readyTotal / neededTotal) * 100) : 0;
                  return (
                    <article key={r.id} className={cx('flex flex-col rounded-lg border p-3', card(dark))}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h3 className="font-bold text-sm truncate" title={r.name}>{r.name}</h3>
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5"><span className={cx('inline-flex rounded-md px-2 py-0.5 text-[10.5px] font-semibold', r.category === 'control_room' ? 'bg-blue-500/10 text-blue-300' : 'bg-emerald-500/10 text-emerald-300')}>{r.category === 'control_room' ? 'Control room' : 'Rest room'}</span><span className="inline-flex items-center rounded-md bg-emerald-500/10 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-300">Here now · {membersHereNow}</span></div>
                          {r.notes && <p className={cx('text-[11.5px] truncate', muted)} title={r.notes}>{r.notes}</p>}
                        </div>
                        <span className={cx('shrink-0 text-xs font-bold px-2 py-1 rounded-lg tabular-nums',
                          full ? 'bg-rose-500/15 text-rose-500' : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400')}>
                          {inside.length}/{r.capacity}{full ? ' · Full' : ''}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full mt-2.5 overflow-hidden bg-raised" aria-hidden>
                        <div className={cx('h-full rounded-full', full ? 'bg-rose-500' : pct >= 75 ? 'bg-amber-500' : 'bg-emerald-500')} style={{ width: `${pct}%` }} />
                      </div>
                      <div className="mt-2.5 flex items-center justify-between gap-2">
                        <span className={cx('rounded-md px-2 py-1 text-[10.5px] font-semibold', r.requirements.length === 0 ? 'bg-raised text-mute' : roomReady ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-300')}>{r.requirements.length === 0 ? 'Not set up' : roomReady ? 'Ready' : 'In progress'}</span>
                        {roomReturned && <span className="rounded-md bg-blue-500/15 px-2 py-1 text-[10.5px] font-semibold text-blue-300">Returned</span>}
                        <div className="ml-auto flex items-center gap-2">
                          <span className={cx('text-right text-[10.5px]', muted)}>Necessities ready</span>
                          <div className="h-9 w-9 shrink-0 rounded-full p-[3px]" role="progressbar" aria-label={`${r.name} necessities readiness`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={readinessPercent} style={{ background: `conic-gradient(rgb(var(--c-chart-ok)) ${readinessPercent}%, rgb(var(--c-line)) 0)` }}>
                            <div className="flex h-full w-full items-center justify-center rounded-full bg-surface text-[10px] font-bold tabular-nums">{readinessPercent}%</div>
                          </div>
                        </div>
                      </div>
                      {r.category === 'control_room' && <div className={cx('mt-2 rounded-md bg-raised px-2 py-1.5 text-[10.5px]', muted)}>Requirements team: <span className="font-semibold text-ink">{r.responsibleTeam || 'No team assigned'}</span></div>}
                      {r.category === 'control_room' && <div className={cx('mt-2 rounded-md border border-blue-500/20 bg-blue-500/5 px-2.5 py-2 text-[10.5px]', muted)}>{linkedControlRooms[r.id] ? <><span className="font-semibold text-blue-300">Control Rooms · {roomEventName}:</span> {linkedControlRooms[r.id].name} · {linkedControlRooms[r.id].location} · {linkedControlRooms[r.id].pc_count} PCs</> : <>No CCTV Control Room linked for {roomEventName}. Link it from Control Rooms → Edit room.</>}</div>}
                      {tasks.filter(task => task.room_id === r.id).length > 0 && <div className="mt-2 space-y-1 rounded-md bg-raised/50 p-2">{tasks.filter(task => task.room_id === r.id).map(task => <div key={task.id} className="flex items-center gap-2 text-[10.5px]"><span className="min-w-0 flex-1 truncate text-ink-soft">{task.title} · {task.assigned_to || 'Unassigned'}</span><select aria-label={`Status for ${task.title}`} disabled={!canManageTasks && task.assigned_to !== auth.currentUser?.name} className="rounded border border-line bg-field px-1.5 py-1 text-[10.5px] text-ink disabled:opacity-60" value={task.status} onChange={e => void updateTaskStatus(task, e.target.value)}><option value="todo">To do</option><option value="in_progress">In progress</option><option value="complete">Ready</option></select></div>)}</div>}
                      {roomReady && r.readyAt && <p className={cx('mt-1 text-[10.5px]', muted)}>Ready at {new Date(r.readyAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</p>}
                      {roomReturned && r.returnedAt && <p className={cx('mt-1 text-[10.5px]', muted)}>Returned at {new Date(r.returnedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</p>}
                      <div className="flex flex-wrap items-center gap-1.5 mt-3 pt-3 border-t border-line">
                        <button className={cx(btnGhost(dark), 'rounded-lg px-2.5 py-1.5')} onClick={() => setRequirementsRoom(r)}><ListTodo className="w-3.5 h-3.5" />Necessities</button>
                        {roomEventId && canManageTasks && <button className={cx(btnGhost(dark), 'rounded-lg px-2.5 py-1.5')} onClick={() => void assignRoomSetupTask(r)}><Plus className="w-3.5 h-3.5" />Assign room task</button>}
                        {canEditRoomDefinitions && <>
                          {canAdminAssignRoomMembers && <button className={cx(btnGhost(dark), 'rounded-lg px-2.5 py-1.5')} disabled={full} onClick={() => setRoomAssignmentModal(r)}><UserPlus className="w-3.5 h-3.5" />Add people</button>}
                          <button className={cx(btnGhost(dark), 'rounded-lg px-2.5 py-1.5')} onClick={() => setRoomModal(r)} aria-label={`Edit room ${r.name}`}><Edit3 className="w-3.5 h-3.5" /></button>
                          <button className={cx(btnGhost(dark), 'rounded-lg px-2.5 py-1.5 text-rose-500')} aria-label={`Delete room ${r.name}`}
                            onClick={() => setConfirm({
                              title: `Delete room ${r.name}?`,
                              body: inside.length ? `${inside.length} member(s) will be left without a room. They are not deleted.` : 'This room is empty.',
                              label: 'Delete room', run: () => deleteRoom(r.id),
                            })}><Trash2 className="w-3.5 h-3.5" /></button>
                        </>}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </>
      )}

      {mode === 'members' && (
        <div className={cx('rounded-xl border', card(dark))}>
          <div className="p-3 flex flex-col sm:flex-row gap-2 border-b border-line">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-faint" aria-hidden />
              <input aria-label="Search members" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, room or department…" className={cx(inputCls(dark), 'pl-9')} />
            </div>
            <select aria-label="Filter by member type" value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className={cx(inputCls(dark), 'sm:w-48')}>
              <option value="all">All member types</option>
              <option value="salary_based">Salary based ({members.filter(m => m.memberType === 'salary_based').length})</option>
              <option value="monthly">Monthly ({members.filter(m => m.memberType === 'monthly').length})</option>
              <option value="annual">Annual ({members.filter(m => m.memberType === 'annual').length})</option>
            </select>
            <select aria-label="Filter by room" value={roomFilter} onChange={e => setRoomFilter(e.target.value)} className={cx(inputCls(dark), 'sm:w-56')}>
              <option value="all">All members</option>
              <option value="none">Not in a room</option>
              {restRooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <section className="border-b border-line p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-[13.5px] font-semibold flex items-center gap-2"><ListTodo className="w-4 h-4 text-blue-400"/>Member work</h2><p className={cx('text-[11.5px] mt-0.5', muted)}>Assign work, then track to do, in progress and complete.</p></div><div className="flex gap-3 text-[11.5px] text-mute"><span>{tasks.filter(t => t.status === 'todo').length} to do</span><span>{tasks.filter(t => t.status === 'in_progress').length} ongoing</span><span>{tasks.filter(t => t.status === 'complete').length} done</span></div></div>
            <form onSubmit={saveTask} className="grid grid-cols-1 md:grid-cols-4 gap-2">
              <input required value={taskTitle} onChange={e => setTaskTitle(e.target.value)} placeholder="Task to do" className={cx(inputCls(dark), 'md:col-span-2')}/>
              <select value={taskMember} onChange={e => setTaskMember(e.target.value)} className={inputCls(dark)} aria-label="Assign member"><option value="">{canManageTasks ? 'Assign to a member' : 'Assign to myself'}</option>{canManageTasks && members.map(m => <option key={m.id} value={m.id}>{m.name}{memberMeta(m) ? ` · ${memberMeta(m)}` : ''}</option>)}</select>
              <button disabled={taskBusy} className={btnPrimary}><Plus className="w-4 h-4"/>{taskBusy ? 'Saving…' : 'Add task'}</button>
              <input value={taskDetails} onChange={e => setTaskDetails(e.target.value)} placeholder="Task details (optional)" className={cx(inputCls(dark), 'md:col-span-4')}/>
            </form>
            <div className="divide-y divide-line max-h-64 overflow-y-auto">{tasks.map(task => <div key={task.id} className="py-2.5 flex flex-wrap items-center gap-2"><span className={cx('w-2 h-2 rounded-full', task.status === 'complete' ? 'bg-emerald-400' : task.status === 'in_progress' ? 'bg-blue-400' : 'bg-amber-400')}/><div className="flex-1 min-w-0"><div className="text-sm font-medium">{task.title}</div><div className={cx('text-xs', muted)}>{[members.find(m => m.id === task.member_id)?.name || task.assigned_to, task.details].filter(Boolean).join(' · ')}</div></div><span className={cx('text-xs capitalize', muted)}>{task.status.replace('_', ' ')}</span>{task.status === 'todo' && <button type="button" onClick={() => updateTaskStatus(task, 'in_progress')} className={btnGhost(dark)}><Play className="w-3.5 h-3.5"/>Start</button>}{task.status === 'in_progress' && <button type="button" onClick={() => updateTaskStatus(task, 'complete')} className={btnGhost(dark)}><CircleCheck className="w-3.5 h-3.5"/>Complete</button>}</div>)}{!tasks.length && <p className={cx('py-4 text-center text-xs', muted)}>No member tasks yet.</p>}</div>
          </section>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className={cx('text-left text-xs uppercase tracking-wider', muted)}>
                  <th className="px-4 py-3 font-semibold">Member</th>
                  <th className="px-4 py-3 font-semibold">Type / badge no.</th>
                  <th className="px-4 py-3 font-semibold">Department</th>
                  <th className="px-4 py-3 font-semibold">Mobile / branch</th>
                  <th className="px-4 py-3 font-semibold">Arrival / team</th>
                  <th className="px-4 py-3 font-semibold">Arrived at</th>
                  <th className="px-4 py-3 font-semibold">Room</th>
                  {canManageRooms && <th className="px-4 py-3 font-semibold text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {visibleMembers.map(m => {
                  const room = m.roomId ? roomById.get(m.roomId) : null;
                  return (
                    <tr key={m.id}>
                      <td className="px-4 py-2.5"><div className="font-semibold">{m.name}</div><div className={cx('text-xs', muted)}>{[memberMeta(m), m.serialNo || m.employeeCode || m.employeeId].filter(Boolean).join(' · ') || '—'}</div></td>
                      <td className="px-4 py-2.5"><div>{m.memberType === 'salary_based' ? 'Salary based' : m.memberType === 'annual' ? 'Annual' : 'Monthly'}</div><div className={cx('text-xs', muted)}>{m.batchNo || '—'}</div></td>
                      <td className={cx('px-4 py-2.5', muted)}>{DEPT_LABEL[m.department] || '—'}</td>
                      <td className="px-4 py-2.5"><div>{m.mobile || '—'}</div><div className={cx('text-xs', muted)}>{[m.branch, m.villageCity].filter(Boolean).join(' · ')}</div></td>
                      <td className="px-4 py-2.5">{canManageRooms ? <><select aria-label={`Arrival for ${m.name}`} value={m.arrivalStatus} onChange={e => updateMember(m.id, { arrivalStatus: e.target.value as Member['arrivalStatus'], arrivedAt: e.target.value === 'arrived' ? new Date().toISOString() : '' })} className={cx(inputCls(dark), 'py-1.5 text-xs')}><option value="pending">Expected</option><option value="arrived">Arrived</option><option value="not_coming">Not coming</option></select><div className={cx('text-xs mt-1', muted)}>{[m.teamName, m.teamLead && `Lead: ${m.teamLead}`].filter(Boolean).join(' · ') || 'No team'}</div></> : <div>{m.arrivalStatus}{m.teamName ? ` · ${m.teamName}` : ''}</div>}</td>
                      <td className={cx('px-4 py-2.5 text-xs tabular-nums', muted)}>{m.arrivalStatus === 'arrived' && m.arrivedAt ? new Date(m.arrivedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'}</td>
                      <td className="px-4 py-2.5">
                        {canAdminAssignRoomMembers ? (
                          <select aria-label={`Room for ${m.name}`} value={m.roomId || ''} onChange={e => updateMember(m.id, { roomId: e.target.value || null })} className={cx(inputCls(dark), 'py-1.5 text-xs min-w-[10rem]')}>
                            <option value="">— Not in a room —</option>
                            {restRooms.map(r => {
                              const free = r.capacity - membersInRoom(r.id).length;
                              return <option key={r.id} value={r.id} disabled={free <= 0 && r.id !== m.roomId}>{r.name} · {r.category === 'control_room' ? 'Control room' : 'Rest room'} ({Math.max(0, free)} free)</option>;
                            })}
                          </select>
                        ) : room ? <span className="font-medium">{room.name}</span> : <span className={cx('text-xs italic', muted)}>Not in a room</span>}
                      </td>
                      {canManageRooms && (
                        <td className="px-4 py-2.5 text-right whitespace-nowrap">
                          <button className={cx(btnGhost(dark), 'mr-1.5')} aria-label={`Edit ${m.name}`} onClick={() => setMemberModal(m)}><Edit3 className="w-3.5 h-3.5" /></button>
                          <button className={cx(btnGhost(dark), 'text-rose-500')} aria-label={`Remove ${m.name}`}
                            onClick={() => setConfirm({ title: `Remove ${m.name}?`, body: 'They will be taken off the list entirely.', label: 'Remove', run: () => deleteMember(m.id) })}><Trash2 className="w-3.5 h-3.5" /></button>
                        </td>
                      )}
                    </tr>
                  );
                })}
                {!visibleMembers.length && (
                  <tr><td colSpan={canManageRooms ? 8 : 7} className={cx('px-4 py-10 text-center text-sm', muted)}>{members.length ? 'No members match.' : 'No members added yet.'}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {roomModal && <RoomForm dark={dark} room={roomModal === 'new' ? null : roomModal} teams={manpower.teams} onClose={() => setRoomModal(null)}
        onSave={(v) => (roomModal === 'new' ? addRoom(v) : updateRoom(roomModal.id, v))} />}
      {roomAssignmentModal && <RoomAssignmentModal dark={dark} room={roomAssignmentModal} members={members} presentMembers={presentRoomCandidates} eventSelected={!!roomEventId} onClose={() => setRoomAssignmentModal(null)} onSave={ids => saveRoomAssignment(roomAssignmentModal, ids)} />}
      {requirementsRoom && <RoomRequirementsModal dark={dark} room={requirementsRoom} canDefine={canDefineRoomRequirements} canFulfill={canFulfillRoomRequirements(requirementsRoom)} isPostEvent={roomEvent?.status === 'complete'} onClose={() => setRequirementsRoom(null)} onSave={next => updateRoomSetup(requirementsRoom.id, next)} />}
      {memberModal && <MemberForm dark={dark} rooms={restRooms} members={members}
        edit={'id' in memberModal ? memberModal : null} presetRoom={'id' in memberModal ? undefined : memberModal.room}
        canAssignRoomMembers={canAdminAssignRoomMembers} onClose={() => setMemberModal(null)} onAdd={addMembers} onEdit={updateMember} />}
      {confirm && <ConfirmModal dark={dark} title={confirm.title} body={confirm.body} confirmLabel={confirm.label} onConfirm={confirm.run} onClose={() => setConfirm(null)} />}
    </div>
  );
};

// ---------------------------------------------------------------------------
const SummaryCard: React.FC<{
  dark: boolean; icon: React.ComponentType<{ className?: string }>; title: string; value: number; metricLabel: string;
  metricValue: number; detail: string; percent: number | null; color: string;
}> = ({ dark, icon: Icon, title, value, metricLabel, metricValue, detail, percent, color }) => (
  <section className={cx('flex min-h-28 items-center justify-between gap-4 rounded-xl border p-4', card(dark))} aria-label={`${title} summary`}>
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-blue-400" />
        <h2 className="text-xs font-semibold text-mute">Total {title.toLowerCase()}</h2>
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
      <div className="mt-2 flex items-center gap-1.5 text-xs">
        <span className="text-mute">{metricLabel}</span>
        <span className="font-semibold tabular-nums">{metricValue}</span>
      </div>
      <p className="mt-0.5 truncate text-[10.5px] text-mute" title={detail}>{detail}</p>
    </div>
    <div className="h-16 w-16 shrink-0 rounded-full p-[5px]" role="img" aria-label={`${title}: ${percent === null ? 'no data' : `${percent}% ${metricLabel.toLowerCase()}`}`} style={{ background: `conic-gradient(${color} ${percent ?? 0}%, rgb(var(--c-line)) 0)` }}>
      <div className="flex h-full w-full items-center justify-center rounded-full bg-surface text-xs font-bold tabular-nums">{percent === null ? '—' : `${percent}%`}</div>
    </div>
  </section>
);

const RoomForm: React.FC<{ dark: boolean; room: Room | null; teams: { id: string; name: string; lead: string }[]; onClose: () => void; onSave: (v: { name: string; category: Room['category']; block: string; capacity: number; notes: string; responsibleTeam: string; requirements: RoomRequirement[] }) => Promise<boolean> }> = ({ dark, room, teams, onClose, onSave }) => {
  const [name, setName] = useState(room?.name || '');
  const [category, setCategory] = useState<Room['category']>(room?.category || 'rest_room');
  const [responsibleTeam, setResponsibleTeam] = useState(room?.responsibleTeam || '');
  const [block, setBlock] = useState(room?.block || '');
  const [capacity, setCapacity] = useState(String(room?.capacity ?? 4));
  const [notes, setNotes] = useState(room?.notes || '');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const ok = await onSave({ name, category, block, capacity: Number(capacity), notes, responsibleTeam, requirements: room?.requirements || [] });
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <Modal title={room ? `Edit room ${room.name}` : 'Add room'} dark={dark} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div><label className={labelCls(dark)} htmlFor="rn">Room name / number</label><input id="rn" autoFocus required value={name} onChange={e => setName(e.target.value)} placeholder="e.g. A-101" className={inputCls(dark)} /></div>
          <div><label className={labelCls(dark)} htmlFor="rb">Block / camp (optional)</label><input id="rb" value={block} onChange={e => setBlock(e.target.value)} placeholder="e.g. Block A" className={inputCls(dark)} /></div>
        </div>
        <div><label className={labelCls(dark)} htmlFor="rc">Room capacity (beds)</label><input id="rc" type="number" min={1} max={500} required value={capacity} onChange={e => setCapacity(e.target.value)} className={inputCls(dark)} /><p className={cx('mt-1 text-[11.5px]', dark ? 'text-gray-500' : 'text-gray-500')}>Capacity is used for member placement; beds are not room setup requirements.</p></div>
        <div><label className={labelCls(dark)} htmlFor="rno">Notes (optional)</label><input id="rno" value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. Ground floor, AC" className={inputCls(dark)} /></div>
        <div className="flex justify-end gap-2 pt-1"><button type="button" onClick={onClose} className={btnGhost(dark)}>Cancel</button><button type="submit" disabled={busy} className={btnPrimary}>{busy ? 'Saving…' : 'Save room'}</button></div>
      </form>
    </Modal>
  );
};

const RoomRequirementsModal: React.FC<{
  dark: boolean; room: Room; canDefine: boolean; canFulfill: boolean; isPostEvent: boolean; onClose: () => void;
  onSave: (requirements: RoomRequirement[]) => Promise<boolean>;
}> = ({ dark, room, canDefine, canFulfill, isPostEvent, onClose, onSave }) => {
  const [items, setItems] = useState<RoomRequirement[]>(room.requirements.map(item => ({ ...item })));
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<'prepare' | 'return'>(isPostEvent ? 'return' : 'prepare');
  useEffect(() => { if (isPostEvent) setPhase('return'); }, [isPostEvent]);
  const changeItem = (index: number, patch: Partial<RoomRequirement>) => setItems(current => current.map((item, i) => i === index ? { ...item, ...patch } : item));
  const isPrepared = (item: RoomRequirement) => item.quantity > 0 && item.readyQuantity >= item.quantity;
  const completeCount = items.filter(item => phase === 'prepare' ? isPrepared(item) : item.returned).length;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const cleaned = items.map(item => ({
      ...item,
      name: item.name.trim(),
      quantity: Math.max(0, Number(item.quantity) || 0),
      readyQuantity: Math.min(Math.max(0, Number(item.readyQuantity) || 0), Math.max(0, Number(item.quantity) || 0)),
      collectFrom: String(item.collectFrom || '').trim(),
      returned: !!item.returned,
    })).filter(item => item.name);
    const ok = await onSave(cleaned);
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <Modal title={`Room checklist · ${room.name}`} dark={dark} xxl stickyHeader onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className={cx('text-xs', dark ? 'text-gray-400' : 'text-gray-600')}>{room.category === 'rest_room' ? 'Assign and prepare necessities before the event. After it ends, collect them and mark each one returned.' : `The ${room.responsibleTeam || 'assigned'} team prepares this room before the event and returns its necessities afterward.`}</p></div>
          <span className={cx('shrink-0 rounded-md px-2.5 py-1.5 text-[11.5px] font-medium tabular-nums', dark ? 'bg-gray-800 text-gray-300' : 'bg-gray-100 text-gray-600')}>{completeCount} / {items.length} {phase === 'prepare' ? 'prepared' : 'returned'}</span>
        </div>

        <div className={cx('grid grid-cols-2 gap-1 rounded-lg border p-1', dark ? 'border-gray-700 bg-gray-900/60' : 'border-gray-200 bg-gray-50')} role="group" aria-label="Room work phase">
          <button type="button" aria-pressed={phase === 'prepare'} onClick={() => setPhase('prepare')} className={cx('rounded-md px-3 py-2 text-xs font-semibold transition-colors', phase === 'prepare' ? 'bg-blue-600 text-white' : dark ? 'text-gray-400 hover:bg-gray-800' : 'text-gray-600 hover:bg-white')}><span className="mr-1.5">1</span>Before event · Prepare & accommodate</button>
          <button type="button" aria-pressed={phase === 'return'} onClick={() => setPhase('return')} className={cx('rounded-md px-3 py-2 text-xs font-semibold transition-colors', phase === 'return' ? 'bg-blue-600 text-white' : dark ? 'text-gray-400 hover:bg-gray-800' : 'text-gray-600 hover:bg-white')}><span className="mr-1.5">2</span>After event · Collect & return</button>
        </div>
        <p className={cx('text-[11.5px]', dark ? 'text-gray-500' : 'text-gray-500')}>{phase === 'prepare' ? 'Complete each item as it is placed in the room. Room assignments are managed with Add people.' : isPostEvent ? 'Event is marked complete. Collect each prepared item from the room and mark it returned.' : 'After the event, collect each prepared item from the room. A return task can only be completed after preparation.'}</p>

        {items.length === 0 && <p className={cx('rounded-lg border border-dashed border-line px-3 py-8 text-center text-xs', dark ? 'text-gray-500' : 'text-gray-500')}>No necessities added yet. Add the items needed for this room before the event.</p>}
        {/* One row per necessity: details first, status next, the Done action last. */}
        {items.length > 0 && <div className="overflow-hidden rounded-lg border border-line">
          <div className="hidden grid-cols-[2rem_minmax(0,2fr)_5.5rem_minmax(0,1.5fr)_2.25rem_minmax(9rem,1fr)_10.5rem] items-center gap-2 border-b border-line bg-raised px-3 py-2 text-[10.5px] font-semibold uppercase tracking-wide text-mute sm:grid">
            <span className="text-right">#</span><span>Necessity</span><span>Needed</span><span>Collect from</span><span /><span>Status</span><span className="text-right">Done</span>
          </div>
          <div className="max-h-[58vh] divide-y divide-line overflow-y-auto">
            {items.map((item, index) => {
              const done = phase === 'prepare' ? isPrepared(item) : item.returned;
              const editable = canDefine && phase === 'prepare';
              const cellInput = cx(inputCls(dark), 'h-9 !py-1 text-sm');
              return <div key={index} className={cx('grid grid-cols-1 items-center gap-2 px-3 py-2.5 sm:grid-cols-[2rem_minmax(0,2fr)_5.5rem_minmax(0,1.5fr)_2.25rem_minmax(9rem,1fr)_10.5rem]', done && (dark ? 'bg-emerald-500/[0.05]' : 'bg-emerald-50/60'))}>
                <span className="hidden text-right text-xs tabular-nums text-faint sm:block">{index + 1}</span>
                <label className="block"><span className="mb-1 block text-[11px] text-mute sm:sr-only">Necessity</span><input disabled={!editable} value={item.name} onChange={e => changeItem(index, { name: e.target.value })} placeholder="Fan, mattress, blanket…" aria-label={`Necessity ${index + 1}`} className={cellInput} /></label>
                <label className="block"><span className="mb-1 block text-[11px] text-mute sm:sr-only">Needed</span><input disabled={!editable} type="number" min={0} value={item.quantity} onChange={e => changeItem(index, { quantity: Number(e.target.value), readyQuantity: Math.min(item.readyQuantity, Number(e.target.value) || 0), returned: Number(e.target.value) > 0 && item.readyQuantity >= Number(e.target.value) ? item.returned : false })} aria-label={`Needed for necessity ${index + 1}`} className={cx(cellInput, 'text-right tabular-nums')} /></label>
                <label className="block"><span className="mb-1 block text-[11px] text-mute sm:sr-only">Collect from</span><input disabled={!editable} value={item.collectFrom || ''} onChange={e => changeItem(index, { collectFrom: e.target.value })} placeholder="Store / block / contact" aria-label={`Collect from for necessity ${index + 1}`} className={cellInput} /></label>
                <span className="flex sm:justify-center">{editable && <button type="button" aria-label={`Remove ${item.name || 'necessity'}`} title="Remove" className="grid h-8 w-8 place-items-center rounded-md text-rose-400 hover:bg-rose-500/10" onClick={() => setItems(current => current.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" /></button>}</span>
                <div className="flex min-w-0 items-center gap-2 text-[11.5px]">
                  {done ? <CircleCheck className="h-4 w-4 shrink-0 text-emerald-400"/> : <Circle className="h-4 w-4 shrink-0 text-amber-400"/>}
                  <span className="min-w-0">
                    <span className={cx('block font-semibold', done ? 'text-emerald-400' : 'text-amber-300')}>{done ? (phase === 'prepare' ? 'Prepared' : 'Returned') : (phase === 'prepare' ? 'To prepare' : 'To return')}</span>
                    {phase === 'prepare' && <span className="block tabular-nums text-faint">{Math.min(item.readyQuantity, item.quantity)} / {item.quantity} ready</span>}
                  </span>
                </div>
                <div className="flex sm:justify-end">
                  {canFulfill ? <button type="button" disabled={phase === 'prepare' ? item.quantity <= 0 : !isPrepared(item)} onClick={() => changeItem(index, phase === 'prepare' ? { readyQuantity: done ? 0 : item.quantity, returned: done ? false : item.returned } : { returned: !item.returned })}
                    className={cx('inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto', done ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/20' : 'border-blue-500/40 bg-blue-600 text-white hover:bg-blue-500')}>
                    {done ? <><CircleCheck className="h-3.5 w-3.5"/>Done · undo</> : <><Circle className="h-3.5 w-3.5"/>Mark {phase === 'prepare' ? 'prepared' : 'returned'}</>}
                  </button> : <span className="text-[11.5px] text-faint">—</span>}
                </div>
              </div>;
            })}
          </div>
        </div>}
        {canDefine && phase === 'prepare' && <button type="button" className={btnGhost(dark)} onClick={() => setItems(current => [...current, { name: '', quantity: 1, readyQuantity: 0, collectFrom: '', returned: false }])}><Plus className="h-3.5 w-3.5" />Add necessity</button>}
        {!canDefine && <p className={cx('text-[11.5px]', dark ? 'text-gray-500' : 'text-gray-500')}>{canFulfill ? 'Room necessities are managed by Accommodation or the responsible control-room team. Update task status here.' : 'View only. Task updates are limited to Accommodation or the responsible team.'}</p>}
        <div className="flex justify-end gap-2 border-t border-line pt-3">
          <button type="button" onClick={onClose} className={btnGhost(dark)}>Close</button>
          {(canDefine || canFulfill) && <button type="submit" disabled={busy} className={btnPrimary}>{busy ? 'Saving…' : 'Save checklist'}</button>}
        </div>
      </form>
    </Modal>
  );
};

const RoomAssignmentModal: React.FC<{
  dark: boolean; room: Room; members: Member[]; presentMembers: Member[]; eventSelected: boolean; onClose: () => void;
  onSave: (memberIds: string[]) => Promise<boolean>;
}> = ({ dark, room, members, presentMembers, eventSelected, onClose, onSave }) => {
  const [selectedIds, setSelectedIds] = useState<string[]>(() => presentMembers.filter(member => member.roomId === room.id).map(member => member.id));
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const query = search.trim().toLocaleLowerCase();
  const filteredPresentMembers = presentMembers.filter(member => !query || [member.name, member.department, DEPT_LABEL[member.department], member.mobile].some(value => String(value || '').toLocaleLowerCase().includes(query)));
  const assignedElsewhere = (member: Member) => member.roomId && member.roomId !== room.id;
  const stayingNonPresent = members.filter(member => member.roomId === room.id && !presentMembers.some(present => present.id === member.id)).length;
  const maxSelectable = Math.max(0, room.capacity - stayingNonPresent);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const ok = await onSave(selectedIds);
    setBusy(false);
    if (ok) onClose();
  };
  const toggle = (id: string, checked: boolean) => setSelectedIds(current => checked ? [...current, id] : current.filter(value => value !== id));
  return (
    <Modal title={`Add present Sewadars · ${room.name}`} dark={dark} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <p className={cx('text-xs', dark ? 'text-gray-400' : 'text-gray-600')}>
          Select members marked Present for the event. Only members already in the Sewadar roster are listed.
        </p>
        {!eventSelected ? (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">Select an event in the header to see present Sewadars.</p>
        ) : !presentMembers.length ? (
          <p className={cx('rounded-lg border border-dashed border-line p-5 text-center text-xs', dark ? 'text-gray-500' : 'text-gray-500')}>No Sewadars are currently marked Present for this event.</p>
        ) : (
          <>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" aria-hidden />
            <input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search present Sewadars…" aria-label="Search present Sewadars" className={cx(inputCls(dark), 'pl-9')} />
          </div>
          <div className="max-h-[45vh] divide-y divide-line overflow-y-auto rounded-lg border border-line">
            {filteredPresentMembers.map(member => {
              const elsewhere = assignedElsewhere(member);
              const checked = selectedIds.includes(member.id);
              return (
                <label key={member.id} className={cx('flex items-center gap-3 px-3 py-2.5 text-sm', elsewhere ? 'cursor-not-allowed opacity-50' : 'cursor-pointer')}>
                  <input type="checkbox" checked={checked} disabled={!!elsewhere || (!checked && selectedIds.length >= maxSelectable)} onChange={event => toggle(member.id, event.target.checked)} />
                  <span className="min-w-0 flex-1 truncate font-medium">{member.name}{memberMeta(member) && <span className="ml-1.5 text-xs font-normal opacity-70">{memberMeta(member)}</span>}</span>
                  {member.department && <span className={cx('text-xs', dark ? 'text-gray-400' : 'text-gray-600')}>{DEPT_LABEL[member.department] || member.department}</span>}
                  {elsewhere && <span className="text-[10.5px] text-amber-300">Already assigned</span>}
                </label>
              );
            })}
            {!filteredPresentMembers.length && <p className={cx('p-4 text-center text-xs', dark ? 'text-gray-500' : 'text-gray-500')}>No present Sewadars match “{search}”.</p>}
          </div>
          </>
        )}
        <p className={cx('text-[11.5px]', dark ? 'text-gray-500' : 'text-gray-500')}>{selectedIds.length} selected · {maxSelectable} bed(s) available</p>
        <div className="flex justify-end gap-2 border-t border-line pt-3">
          <button type="button" onClick={onClose} className={btnGhost(dark)}>Cancel</button>
          <button type="submit" disabled={busy || !eventSelected} className={btnPrimary}>{busy ? 'Saving…' : 'Save room members'}</button>
        </div>
      </form>
    </Modal>
  );
};

const MemberForm: React.FC<{
  dark: boolean; rooms: Room[]; members: Member[]; edit: Member | null; presetRoom?: string; canAssignRoomMembers: boolean; onClose: () => void;
  onAdd: (names: string[], department: string, roomId: string | null, details?: Partial<Member>) => Promise<boolean>;
  onEdit: (id: string, patch: Partial<Omit<Member, 'id'>>) => Promise<boolean>;
}> = ({ dark, rooms, members, edit, presetRoom, canAssignRoomMembers, onClose, onAdd, onEdit }) => {
  const [names, setNames] = useState(edit?.name || '');
  const [dept, setDept] = useState(edit?.department || '');
  const [roomId, setRoomId] = useState(edit?.roomId || presetRoom || '');
  const [detail, setDetail] = useState({ memberType: edit?.memberType || 'salary_based' as Member['memberType'], serialNo: edit?.serialNo || '', batchNo: edit?.batchNo || '', relation: edit?.relation || '', relationName: edit?.relationName || '', mobile: edit?.mobile || '', villageCity: edit?.villageCity || '', branch: edit?.branch || '', occupation: edit?.occupation || '', remarks: edit?.remarks || '', joiningDate: edit?.joiningDate || '', employeeCode: edit?.employeeCode || '', employeeId: edit?.employeeId || '', address: edit?.address || '', address2: edit?.address2 || '', expectedArrival: edit?.expectedArrival || '', teamName: edit?.teamName || '', teamLead: edit?.teamLead || '' });
  const [busy, setBusy] = useState(false);
  const freeIn = (r: Room) => r.capacity - members.filter(m => m.roomId === r.id && m.id !== edit?.id).length;
  const count = names.split('\n').map(n => n.trim()).filter(Boolean).length;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const ok = edit
      ? await onEdit(edit.id, { name: names, department: dept, ...(canAssignRoomMembers ? { roomId: roomId || null } : {}), ...detail })
      : await onAdd(names.split('\n'), dept, roomId || null, detail);
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <Modal title={edit ? `Edit ${edit.name}` : 'Add members'} dark={dark} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {edit ? (
          <div><label className={labelCls(dark)} htmlFor="mn">Name</label><input id="mn" autoFocus required value={names} onChange={e => setNames(e.target.value)} className={inputCls(dark)} /></div>
        ) : (
          <div>
            <label className={labelCls(dark)} htmlFor="mns">Names — one per line{count > 1 ? ` (${count})` : ''}</label>
            <textarea id="mns" autoFocus required rows={5} value={names} onChange={e => setNames(e.target.value)} placeholder={'Jaspreet Kaur\nGurdeep Singh\n…'} className={inputCls(dark)} />
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls(dark)} htmlFor="md">Department (optional)</label>
            <select id="md" value={dept} onChange={e => setDept(e.target.value)} className={inputCls(dark)}>
              <option value="">—</option>
              {DEPT_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls(dark)} htmlFor="mr">Room</label>
            <select id="mr" value={roomId} disabled={!canAssignRoomMembers} onChange={e => setRoomId(e.target.value)} className={inputCls(dark)}>
              <option value="">— Not in a room —</option>
              {rooms.map(r => <option key={r.id} value={r.id} disabled={freeIn(r) <= 0}>{r.name} ({Math.max(0, freeIn(r))} free)</option>)}
            </select>
          </div>
        </div>
        {!edit && <div className="grid grid-cols-2 gap-3 border-t border-line pt-3"><div><label className={labelCls(dark)}>Member type</label><select value={detail.memberType} onChange={e => setDetail(p => ({ ...p, memberType: e.target.value as Member['memberType'] }))} className={inputCls(dark)}><option value="salary_based">Salary based (hired)</option><option value="monthly">Monthly</option><option value="annual">Annual (main event)</option></select></div><div><label className={labelCls(dark)}>Sewa joining / promised date</label><input type="date" value={detail.joiningDate} onChange={e => setDetail(p => ({ ...p, joiningDate: e.target.value, expectedArrival: e.target.value }))} className={inputCls(dark)} /></div></div>}
        {edit && <div className="space-y-3 border-t border-line pt-3"><div className="text-xs font-semibold text-mute">Member record</div>
          <div className="grid grid-cols-2 gap-3"><div><label className={labelCls(dark)}>Member type</label><select value={detail.memberType} onChange={e => setDetail(p => ({ ...p, memberType: e.target.value as Member['memberType'] }))} className={inputCls(dark)}><option value="salary_based">Salary based (hired)</option><option value="monthly">Monthly</option><option value="annual">Annual (main event)</option></select></div>
            <div><label className={labelCls(dark)}>Sewa joining / promised date</label><input type="date" value={detail.joiningDate} onChange={e => setDetail(p => ({ ...p, joiningDate: e.target.value }))} className={inputCls(dark)} /></div></div>
          <div className="grid grid-cols-2 gap-3">{([['serialNo','Sr. No.'],['batchNo','Badge no.'],['relation','Relation'],['relationName','Relation name'],['mobile','Mobile'],['villageCity','Village / city'],['branch','Branch'],['occupation','Occupation'],['employeeCode','Employee code'],['employeeId','Employee ID'],['address','Address'],['address2','Address 2'],['remarks','Remarks'],['expectedArrival','Expected arrival date'],['teamName','Team'],['teamLead','Team lead']] as [keyof typeof detail,string][]).map(([key,label]) => <div key={key}><label className={labelCls(dark)}>{label}</label><input type={key === 'expectedArrival' ? 'date' : 'text'} value={detail[key] as string} onChange={e => setDetail(p => ({ ...p, [key]: e.target.value }))} className={inputCls(dark)} /></div>)}</div>
        </div>}
        <div className="flex justify-end gap-2 pt-1"><button type="button" onClick={onClose} className={btnGhost(dark)}>Cancel</button><button type="submit" disabled={busy} className={btnPrimary}>{busy ? 'Saving…' : edit ? 'Save' : `Add ${count > 1 ? count + ' members' : 'member'}`}</button></div>
      </form>
    </Modal>
  );
};
