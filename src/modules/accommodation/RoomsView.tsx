import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BedDouble, Building2, CircleCheck, Edit3, ListTodo, Lock, Play, Plus, Search, Trash2, Upload, UserPlus, Users } from 'lucide-react';
import { useAccommodation } from './AccommodationContext';
import { DEPT_LABEL, DEPT_OPTIONS } from './types';
import type { Member, MemberImportRow, Room } from './types';
import { Modal, ConfirmModal, btnGhost, btnPrimary, card, cx, inputCls, labelCls } from './ui';
import { supabase } from '../walkie/lib/supabaseClient';
import { useWalkie } from '../walkie';

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

export const RoomsView: React.FC = () => {
  const { rooms, members, canManageRooms, isDark: dark, loading, membersInRoom,
    addRoom, updateRoom, deleteRoom, addMembers, importMembers, updateMember, deleteMember, logMemberCall } = useAccommodation();
  const auth: any = useWalkie();
  const orgId = auth.currentUser?.organizationId;
  const canManageTasks = canManageRooms;
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

  const [mode, setMode] = useState<Mode>('rooms');
  const [search, setSearch] = useState('');
  const [roomFilter, setRoomFilter] = useState<string>('all'); // all | none | roomId
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [roomModal, setRoomModal] = useState<null | 'new' | Room>(null);
  const [memberModal, setMemberModal] = useState<null | { room?: string } | Member>(null);
  const [confirm, setConfirm] = useState<null | { title: string; body: string; label: string; run: () => void }>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [importMessage, setImportMessage] = useState('');
  const [importBusy, setImportBusy] = useState(false);

  const totalBeds = rooms.reduce((t, r) => t + r.capacity, 0);
  const placed = members.filter(m => m.roomId && rooms.some(r => r.id === m.roomId)).length;
  const unassigned = members.length - placed;
  const roomById = useMemo(() => new Map(rooms.map(r => [r.id, r])), [rooms]);

  const stats = [
    { label: 'Total rooms', value: rooms.length, icon: Building2, tone: 'text-blue-500' },
    { label: 'Total beds', value: totalBeds, icon: BedDouble, tone: 'text-blue-500' },
    { label: 'Total members', value: members.length, icon: Users, tone: 'text-emerald-500' },
    { label: 'Beds free', value: Math.max(0, totalBeds - placed), icon: BedDouble, tone: 'text-amber-500' },
    { label: 'Not in a room', value: unassigned, icon: Users, tone: unassigned ? 'text-rose-500' : 'text-slate-400' },
  ];

  // rooms grouped by block
  const grouped = useMemo(() => {
    const g = new Map<string, Room[]>();
    rooms.forEach(r => { const k = r.block || 'Rooms'; g.set(k, [...(g.get(k) || []), r]); });
    return Array.from(g.entries());
  }, [rooms]);

  const q = search.trim().toLowerCase();
  const visibleMembers = members.filter(m => {
    if (typeFilter !== 'all' && m.memberType !== typeFilter) return false;
    if (roomFilter === 'none' && m.roomId) return false;
    if (roomFilter !== 'all' && roomFilter !== 'none' && m.roomId !== roomFilter) return false;
    if (!q) return true;
    const room = m.roomId ? roomById.get(m.roomId) : null;
    return m.name.toLowerCase().includes(q) || (room?.name || '').toLowerCase().includes(q) || (DEPT_LABEL[m.department] || '').toLowerCase().includes(q);
  });

  const muted = dark ? 'text-slate-400' : 'text-slate-500';
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
          serialNo: val(r, 'srno', 'serialno', 'serialnumber'), batchNo: val(r, 'bno', 'batchno', 'batchnumber'),
          relation: val(r, 'rel', 'relation'), relationName: val(r, 'relationname', 'fathername', 'guardianname'),
          mobile: val(r, 'mobile', 'phone', 'mobilenumber'), villageCity: val(r, 'villagecity', 'village', 'city'),
          branch: val(r, 'branch'), occupation: val(r, 'occupation'), remarks: val(r, 'remarks'),
          joiningDate: dateISO(val(r, 'sewajoiningdate', 'joiningdate', 'promiseddate')), employeeCode: val(r, 'empcode', 'employeecode'),
          employeeId: val(r, 'employeeid', 'empid'), address: val(r, 'address', 'address1'), address2: val(r, 'address2', 'addressline2'),
          expectedArrival: dateISO(val(r, 'expectedarrival', 'promisedarrival', 'sewajoiningdate', 'joiningdate', 'promiseddate')),
          teamName: val(r, 'teamname', 'team'), teamLead: val(r, 'teamlead', 'lead'),
          department, roomId: rooms.find(room => room.name.toLowerCase() === roomName.toLowerCase())?.id || null,
        };
      }).filter(r => r.name);
      const ok = await importMembers(imported);
      setImportMessage(ok ? `${imported.length} member rows imported.` : 'Import did not complete. Check the roster schema migration and your room capacities.');
    } catch (e: any) { setImportMessage(e?.message || 'Could not read that CSV file.'); }
    setImportBusy(false); if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Rooms &amp; Members</h1>
          <p className={cx('text-sm', muted)}>Every room, and who is staying in which one.</p>
        </div>
        {canManageRooms ? (
          <div className="flex gap-2">
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" aria-label="Import members from CSV" onChange={e => importCsv(e.target.files?.[0])} />
            <button className={btnGhost(dark)} disabled={importBusy} onClick={() => fileRef.current?.click()}><Upload className="w-4 h-4" />{importBusy ? 'Importing…' : 'Import CSV'}</button>
            <button className={btnGhost(dark)} onClick={() => setMemberModal({})}><UserPlus className="w-4 h-4" />Add members</button>
            <button className={btnPrimary} onClick={() => setRoomModal('new')}><Plus className="w-4 h-4" />Add room</button>
          </div>
        ) : (
          <p className={cx('flex items-center gap-1.5 text-xs', muted)}><Lock className="w-3.5 h-3.5" />View only — room and member edits are limited to accommodation leads and IT owners.</p>
        )}
      </div>
      {importMessage && <div role="status" className={cx('rounded-lg border px-3 py-2 text-xs', importMessage.includes('imported.') ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : 'border-amber-500/30 bg-amber-500/10 text-amber-300')}>{importMessage} CSV headers can match Sr. No., B. No., Name, Rel, Relation Name, Mobile, Village/City, Branch, Occupation, Remarks, SEWA JOINING DATE, EMP CODE, Employee ID, Address, Address 2, Department, Member Type, and Room.</div>}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {stats.map(s => (
          <div key={s.label} className={cx('rounded-xl border p-4', card(dark))}>
            <div className={cx('flex items-center gap-1.5 text-xs font-semibold', muted)}><s.icon className={cx('w-3.5 h-3.5', s.tone)} />{s.label}</div>
            <div className="text-2xl font-bold mt-1 tabular-nums">{s.value}</div>
          </div>
        ))}
      </div>

      <div role="tablist" aria-label="Rooms or members" className={cx('inline-flex p-1 rounded-xl', dark ? 'bg-slate-900' : 'bg-slate-100')}>
        {(['rooms', 'members'] as Mode[]).map(m => (
          <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
            className={cx('px-4 py-2 rounded-lg text-xs font-bold capitalize transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400',
              mode === m ? 'bg-blue-600 text-white shadow' : muted)}>
            {m === 'rooms' ? `Rooms (${rooms.length})` : `Members (${members.length})`}
          </button>
        ))}
      </div>

      {loading && !rooms.length && !members.length && <p className={cx('text-sm', muted)}>Loading…</p>}

      {mode === 'rooms' && (
        <>
          {!loading && !rooms.length && (
            <div className={cx('rounded-xl border p-10 text-center', card(dark))}>
              <Building2 className="w-8 h-8 mx-auto mb-3 text-slate-400" />
              <p className="font-semibold">No rooms yet</p>
              <p className={cx('text-sm mt-1', muted)}>{canManageRooms ? 'Add your first room to start placing members.' : 'The department owner has not added any rooms yet.'}</p>
            </div>
          )}
          {grouped.map(([block, list]) => (
            <section key={block} aria-label={block}>
              <h2 className={cx('text-xs font-bold uppercase tracking-wider mb-2', muted)}>{block} · {list.length} room{list.length === 1 ? '' : 's'}</h2>
              <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
                {list.map(r => {
                  const inside = membersInRoom(r.id);
                  const pct = Math.min(100, Math.round((inside.length / r.capacity) * 100));
                  const full = inside.length >= r.capacity;
                  return (
                    <article key={r.id} className={cx('rounded-xl border p-4 flex flex-col', card(dark))}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h3 className="font-bold text-base truncate" title={r.name}>{r.name}</h3>
                          {r.notes && <p className={cx('text-xs truncate', muted)} title={r.notes}>{r.notes}</p>}
                        </div>
                        <span className={cx('shrink-0 text-xs font-bold px-2 py-1 rounded-lg tabular-nums',
                          full ? 'bg-rose-500/15 text-rose-500' : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400')}>
                          {inside.length}/{r.capacity}{full ? ' · Full' : ''}
                        </span>
                      </div>
                      <div className={cx('h-1.5 rounded-full mt-3 overflow-hidden', dark ? 'bg-slate-800' : 'bg-slate-100')} aria-hidden>
                        <div className={cx('h-full rounded-full', full ? 'bg-rose-500' : pct >= 75 ? 'bg-amber-500' : 'bg-emerald-500')} style={{ width: `${pct}%` }} />
                      </div>
                      <ul className="mt-3 space-y-1 text-sm flex-1 max-h-40 overflow-y-auto">
                        {inside.map(m => (
                          <li key={m.id} className="flex items-center justify-between gap-2">
                            <span className="truncate">{m.name}</span>
                            {m.department && <span className={cx('text-xs shrink-0', muted)}>{DEPT_LABEL[m.department]}</span>}
                          </li>
                        ))}
                        {!inside.length && <li className={cx('text-xs italic', muted)}>Empty</li>}
                      </ul>
                      {canManageRooms && (
                        <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-slate-500/20">
                          <button className={btnGhost(dark)} disabled={full} onClick={() => setMemberModal({ room: r.id })}><UserPlus className="w-3.5 h-3.5" />Add people</button>
                          <button className={btnGhost(dark)} onClick={() => setRoomModal(r)} aria-label={`Edit room ${r.name}`}><Edit3 className="w-3.5 h-3.5" /></button>
                          <button className={cx(btnGhost(dark), 'text-rose-500')} aria-label={`Delete room ${r.name}`}
                            onClick={() => setConfirm({
                              title: `Delete room ${r.name}?`,
                              body: inside.length ? `${inside.length} member(s) will be left without a room. They are not deleted.` : 'This room is empty.',
                              label: 'Delete room', run: () => deleteRoom(r.id),
                            })}><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      )}
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
          <div className="p-3 flex flex-col sm:flex-row gap-2 border-b border-slate-500/20">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
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
              {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <section className="border-b border-slate-500/20 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-sm font-semibold flex items-center gap-2"><ListTodo className="w-4 h-4 text-blue-400"/>Member work</h2><p className={cx('text-xs mt-0.5', muted)}>Assign work, then track to do, in progress and complete.</p></div><div className="flex gap-3 text-xs text-mute"><span>{tasks.filter(t => t.status === 'todo').length} to do</span><span>{tasks.filter(t => t.status === 'in_progress').length} ongoing</span><span>{tasks.filter(t => t.status === 'complete').length} done</span></div></div>
            <form onSubmit={saveTask} className="grid grid-cols-1 md:grid-cols-4 gap-2">
              <input required value={taskTitle} onChange={e => setTaskTitle(e.target.value)} placeholder="Task to do" className={cx(inputCls(dark), 'md:col-span-2')}/>
              <select value={taskMember} onChange={e => setTaskMember(e.target.value)} className={inputCls(dark)} aria-label="Assign member"><option value="">{canManageTasks ? 'Assign to a member' : 'Assign to myself'}</option>{canManageTasks && members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
              <button disabled={taskBusy} className={btnPrimary}><Plus className="w-4 h-4"/>{taskBusy ? 'Saving…' : 'Add task'}</button>
              <input value={taskDetails} onChange={e => setTaskDetails(e.target.value)} placeholder="Task details (optional)" className={cx(inputCls(dark), 'md:col-span-4')}/>
            </form>
            <div className="divide-y divide-slate-500/20 max-h-64 overflow-y-auto">{tasks.map(task => <div key={task.id} className="py-2.5 flex flex-wrap items-center gap-2"><span className={cx('w-2 h-2 rounded-full', task.status === 'complete' ? 'bg-emerald-400' : task.status === 'in_progress' ? 'bg-blue-400' : 'bg-amber-400')}/><div className="flex-1 min-w-0"><div className="text-sm font-medium">{task.title}</div><div className={cx('text-xs', muted)}>{[members.find(m => m.id === task.member_id)?.name || task.assigned_to, task.details].filter(Boolean).join(' · ')}</div></div><span className={cx('text-xs capitalize', muted)}>{task.status.replace('_', ' ')}</span>{task.status === 'todo' && <button type="button" onClick={() => updateTaskStatus(task, 'in_progress')} className={btnGhost(dark)}><Play className="w-3.5 h-3.5"/>Start</button>}{task.status === 'in_progress' && <button type="button" onClick={() => updateTaskStatus(task, 'complete')} className={btnGhost(dark)}><CircleCheck className="w-3.5 h-3.5"/>Complete</button>}</div>)}{!tasks.length && <p className={cx('py-4 text-center text-xs', muted)}>No member tasks yet.</p>}</div>
          </section>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={cx('text-left text-xs uppercase tracking-wider', muted)}>
                  <th className="px-4 py-3 font-semibold">Member</th>
                  <th className="px-4 py-3 font-semibold">Type / batch</th>
                  <th className="px-4 py-3 font-semibold">Department</th>
                  <th className="px-4 py-3 font-semibold">Mobile / branch</th>
                  <th className="px-4 py-3 font-semibold">Calls / expected arrival</th>
                  <th className="px-4 py-3 font-semibold">Arrival / team</th>
                  <th className="px-4 py-3 font-semibold">Room</th>
                  {canManageRooms && <th className="px-4 py-3 font-semibold text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className={dark ? 'divide-y divide-slate-800' : 'divide-y divide-slate-100'}>
                {visibleMembers.map(m => {
                  const room = m.roomId ? roomById.get(m.roomId) : null;
                  return (
                    <tr key={m.id}>
                      <td className="px-4 py-2.5"><div className="font-semibold">{m.name}</div><div className={cx('text-xs', muted)}>{m.serialNo || m.employeeCode || m.employeeId || '—'}</div></td>
                      <td className="px-4 py-2.5"><div>{m.memberType === 'salary_based' ? 'Salary based' : m.memberType === 'annual' ? 'Annual' : 'Monthly'}</div><div className={cx('text-xs', muted)}>{m.batchNo || '—'}</div></td>
                      <td className={cx('px-4 py-2.5', muted)}>{DEPT_LABEL[m.department] || '—'}</td>
                      <td className="px-4 py-2.5"><div>{m.mobile || '—'}</div><div className={cx('text-xs', muted)}>{[m.branch, m.villageCity].filter(Boolean).join(' · ')}</div></td>
                      <td className="px-4 py-2.5"><div>{m.callCount} calls · {m.lastCallOutcome ? m.lastCallOutcome.replace('_', ' ') : 'not called'}</div><div className={cx('text-xs', muted)}>Last call: {m.lastCallAt ? new Date(m.lastCallAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—'} · Expected: {m.expectedArrival || m.joiningDate || '—'}</div>{canManageRooms && <div className="flex gap-1 mt-1">{(['answered','busy','wrong_number','no_answer'] as const).map(outcome => <button key={outcome} title={`Log ${outcome.replace('_',' ')}`} onClick={() => logMemberCall(m.id, outcome)} className="px-1.5 py-0.5 rounded border border-slate-500/30 text-[10px] capitalize">{outcome.replace('_',' ')}</button>)}</div>}</td>
                      <td className="px-4 py-2.5">{canManageRooms ? <><select aria-label={`Arrival for ${m.name}`} value={m.arrivalStatus} onChange={e => updateMember(m.id, { arrivalStatus: e.target.value as Member['arrivalStatus'], arrivedAt: e.target.value === 'arrived' ? new Date().toISOString() : '' })} className={cx(inputCls(dark), 'py-1.5 text-xs')}><option value="pending">Expected</option><option value="arrived">Arrived</option><option value="not_coming">Not coming</option></select><div className={cx('text-xs mt-1', muted)}>{[m.teamName, m.teamLead && `Lead: ${m.teamLead}`].filter(Boolean).join(' · ') || 'No team'}</div></> : <div>{m.arrivalStatus}{m.teamName ? ` · ${m.teamName}` : ''}</div>}</td>
                      <td className="px-4 py-2.5">
                        {canManageRooms ? (
                          <select aria-label={`Room for ${m.name}`} value={m.roomId || ''} onChange={e => updateMember(m.id, { roomId: e.target.value || null })} className={cx(inputCls(dark), 'py-1.5 text-xs min-w-[10rem]')}>
                            <option value="">— Not in a room —</option>
                            {rooms.map(r => {
                              const free = r.capacity - membersInRoom(r.id).length;
                              return <option key={r.id} value={r.id} disabled={free <= 0 && r.id !== m.roomId}>{r.name} ({Math.max(0, free)} free)</option>;
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

      {roomModal && <RoomForm dark={dark} room={roomModal === 'new' ? null : roomModal} onClose={() => setRoomModal(null)}
        onSave={(v) => (roomModal === 'new' ? addRoom(v) : updateRoom(roomModal.id, v))} />}
      {memberModal && <MemberForm dark={dark} rooms={rooms} members={members}
        edit={'id' in memberModal ? memberModal : null} presetRoom={'id' in memberModal ? undefined : memberModal.room}
        onClose={() => setMemberModal(null)} onAdd={addMembers} onEdit={updateMember} />}
      {confirm && <ConfirmModal dark={dark} title={confirm.title} body={confirm.body} confirmLabel={confirm.label} onConfirm={confirm.run} onClose={() => setConfirm(null)} />}
    </div>
  );
};

// ---------------------------------------------------------------------------
const RoomForm: React.FC<{ dark: boolean; room: Room | null; onClose: () => void; onSave: (v: { name: string; block: string; capacity: number; notes: string }) => Promise<boolean> }> = ({ dark, room, onClose, onSave }) => {
  const [name, setName] = useState(room?.name || '');
  const [block, setBlock] = useState(room?.block || '');
  const [capacity, setCapacity] = useState(String(room?.capacity ?? 4));
  const [notes, setNotes] = useState(room?.notes || '');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const ok = await onSave({ name, block, capacity: Number(capacity), notes });
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
        <div><label className={labelCls(dark)} htmlFor="rc">Beds (capacity)</label><input id="rc" type="number" min={1} max={500} required value={capacity} onChange={e => setCapacity(e.target.value)} className={inputCls(dark)} /></div>
        <div><label className={labelCls(dark)} htmlFor="rno">Notes (optional)</label><input id="rno" value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. Ground floor, AC" className={inputCls(dark)} /></div>
        <div className="flex justify-end gap-2 pt-1"><button type="button" onClick={onClose} className={btnGhost(dark)}>Cancel</button><button type="submit" disabled={busy} className={btnPrimary}>{busy ? 'Saving…' : 'Save room'}</button></div>
      </form>
    </Modal>
  );
};

const MemberForm: React.FC<{
  dark: boolean; rooms: Room[]; members: Member[]; edit: Member | null; presetRoom?: string; onClose: () => void;
  onAdd: (names: string[], department: string, roomId: string | null, details?: Partial<Member>) => Promise<boolean>;
  onEdit: (id: string, patch: Partial<Omit<Member, 'id'>>) => Promise<boolean>;
}> = ({ dark, rooms, members, edit, presetRoom, onClose, onAdd, onEdit }) => {
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
      ? await onEdit(edit.id, { name: names, department: dept, roomId: roomId || null, ...detail })
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
            <select id="mr" value={roomId} onChange={e => setRoomId(e.target.value)} className={inputCls(dark)}>
              <option value="">— Not in a room —</option>
              {rooms.map(r => <option key={r.id} value={r.id} disabled={freeIn(r) <= 0}>{r.name} ({Math.max(0, freeIn(r))} free)</option>)}
            </select>
          </div>
        </div>
        {!edit && <div className="grid grid-cols-2 gap-3 border-t border-slate-500/20 pt-3"><div><label className={labelCls(dark)}>Member type</label><select value={detail.memberType} onChange={e => setDetail(p => ({ ...p, memberType: e.target.value as Member['memberType'] }))} className={inputCls(dark)}><option value="salary_based">Salary based (hired)</option><option value="monthly">Monthly</option><option value="annual">Annual (main event)</option></select></div><div><label className={labelCls(dark)}>Sewa joining / promised date</label><input type="date" value={detail.joiningDate} onChange={e => setDetail(p => ({ ...p, joiningDate: e.target.value, expectedArrival: e.target.value }))} className={inputCls(dark)} /></div></div>}
        {edit && <div className="space-y-3 border-t border-slate-500/20 pt-3"><div className={cx('text-xs font-semibold', dark ? 'text-slate-400' : 'text-slate-500')}>Member record</div>
          <div className="grid grid-cols-2 gap-3"><div><label className={labelCls(dark)}>Member type</label><select value={detail.memberType} onChange={e => setDetail(p => ({ ...p, memberType: e.target.value as Member['memberType'] }))} className={inputCls(dark)}><option value="salary_based">Salary based (hired)</option><option value="monthly">Monthly</option><option value="annual">Annual (main event)</option></select></div>
            <div><label className={labelCls(dark)}>Sewa joining / promised date</label><input type="date" value={detail.joiningDate} onChange={e => setDetail(p => ({ ...p, joiningDate: e.target.value }))} className={inputCls(dark)} /></div></div>
          <div className="grid grid-cols-2 gap-3">{([['serialNo','Sr. No.'],['batchNo','B. No. / Batch'],['relation','Relation'],['relationName','Relation name'],['mobile','Mobile'],['villageCity','Village / city'],['branch','Branch'],['occupation','Occupation'],['employeeCode','Employee code'],['employeeId','Employee ID'],['address','Address'],['address2','Address 2'],['remarks','Remarks'],['expectedArrival','Expected arrival date'],['teamName','Team'],['teamLead','Team lead']] as [keyof typeof detail,string][]).map(([key,label]) => <div key={key}><label className={labelCls(dark)}>{label}</label><input type={key === 'expectedArrival' ? 'date' : 'text'} value={detail[key] as string} onChange={e => setDetail(p => ({ ...p, [key]: e.target.value }))} className={inputCls(dark)} /></div>)}</div>
        </div>}
        <div className="flex justify-end gap-2 pt-1"><button type="button" onClick={onClose} className={btnGhost(dark)}>Cancel</button><button type="submit" disabled={busy} className={btnPrimary}>{busy ? 'Saving…' : edit ? 'Save' : `Add ${count > 1 ? count + ' members' : 'member'}`}</button></div>
      </form>
    </Modal>
  );
};
