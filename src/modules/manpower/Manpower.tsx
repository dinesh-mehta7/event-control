import React, { useEffect, useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, CircleCheck, ClipboardList, Download, Edit3, ExternalLink, FileSpreadsheet, History, Laptop, ListTodo, LoaderCircle, Package, Phone, PhoneCall, Play, Plus, Radio, Search, Smartphone, Tablet, Trash2, Upload, Users } from 'lucide-react';
import { useWalkie } from '../walkie';
import { supabase } from '../walkie/lib/supabaseClient';
import { DEPT_LABEL, DEPT_OPTIONS } from '../accommodation/types';
import { Modal, ConfirmModal, btnGhost, btnPrimary, cx, inputCls, labelCls } from '../accommodation/ui';
import { useManpower } from './ManpowerContext';
import type { SewadarInput } from './ManpowerContext';
import { DEVICES, DEVICE_LABEL, OUTCOMES, OUTCOME_LABEL, OUTCOME_TONE } from './types';
import type { Arrival, CallLog, DeviceType, Sewadar, SewadarMemberType } from './types';

// The command-center shell is always dark, so this module is dark-only.
const D = true;
const panel = 'rounded-lg border border-line bg-surface/50';
const rosterSelect = 'h-9 w-full rounded-md border border-line bg-field px-2.5 text-xs text-ink outline-none focus:border-blue-500 md:w-auto md:shrink-0';
const TONE: Record<string, string> = {
  ok: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  warn: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  bad: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  mute: 'bg-raised text-mute border-line-strong',
};
const DEVICE_ICON: Record<DeviceType, any> = { none: null, walkie: Radio, phone: Smartphone, laptop: Laptop, tablet: Tablet, other: Package };
const clock = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '');

type Stage = 'all' | 'toCall' | 'awaiting' | 'arrived' | 'badge' | 'notComing';
type TaskFilter = 'all' | 'active' | 'completed';
const inStage = (s: Sewadar, st: Stage) => {
  switch (st) {
    case 'toCall': return s.arrival === 'pending' && s.callCount === 0;
    case 'awaiting': return s.arrival === 'pending' && s.callCount > 0;
    case 'arrived': return s.arrival === 'arrived';
    case 'badge': return s.arrival === 'arrived' && !s.badgeIssued;
    case 'notComing': return s.arrival === 'not_coming';
    default: return true;
  }
};

export const ManpowerApp: React.FC = () => {
  const m = useManpower();
  const auth: any = useWalkie();
  const orgId = auth.currentUser?.organizationId;
  const { sewadars, stats, canManage, loading, loadError } = m;
  const [tasks, setTasks] = useState<any[]>([]);
  const [workspace, setWorkspace] = useState<'members' | 'teams' | 'tasks'>('members');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDetails, setTaskDetails] = useState('');
  const [taskTeam, setTaskTeam] = useState('');
  const [taskAssignee, setTaskAssignee] = useState('');
  const [taskMember, setTaskMember] = useState('');
  const [taskDue, setTaskDue] = useState('');
  const [taskBusy, setTaskBusy] = useState(false);
  const [taskFilter, setTaskFilter] = useState<TaskFilter>('all');
  const [stage, setStage] = useState<Stage>('all');
  const [memberType, setMemberType] = useState<'all' | SewadarMemberType>('all');
  const [dept, setDept] = useState('all');
  const [q, setQ] = useState('');
  const [size, setSize] = useState(50);
  const [page, setPage] = useState(0);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Sewadar | 'new' | null>(null);
  const [calling, setCalling] = useState<Sewadar | null>(null);
  const [importing, setImporting] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return sewadars.filter(s => inStage(s, stage)
      && (memberType === 'all' || s.memberType === memberType)
      && (dept === 'all' || (dept === 'none' ? !s.department : s.department === dept))
      && (!t || [s.name, s.phone, s.deviceRef, s.serialNo, s.batchNo, s.teamName, s.teamLead, s.villageCity].some(v => v.toLowerCase().includes(t))));
  }, [sewadars, stage, memberType, dept, q]);
  const teamGroups = useMemo(() => {
    const byName = new Map<string, { name: string; lead: string; members: Sewadar[] }>();
    sewadars.filter(s => s.teamName.trim()).forEach(s => {
      const key = s.teamName.trim().toLocaleLowerCase();
      const group = byName.get(key) || { name: s.teamName.trim(), lead: '', members: [] };
      group.members.push(s);
      if (!group.lead && s.teamLead.trim()) group.lead = s.teamLead.trim();
      byName.set(key, group);
    });
    return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [sewadars]);
  const unassignedSewadars = useMemo(() => sewadars.filter(s => !s.teamName.trim()), [sewadars]);
  const activeTaskCount = tasks.filter(t => t.status !== 'complete').length;
  const completedTaskCount = tasks.filter(t => t.status === 'complete').length;
  const visibleTasks = tasks.filter(t => taskFilter === 'all' || (taskFilter === 'active' ? t.status !== 'complete' : t.status === 'complete'));

  const loadTasks = async () => {
    if (!orgId) return;
    const [{ data: manpowerRows, error: manpowerError }, { data: memberRows, error: memberError }] = await Promise.all([
      supabase.from('manpower_tasks').select('*, accommodation_members(name)').order('created_at', { ascending: false }),
      supabase.from('accommodation_member_tasks').select('*, accommodation_members(name)').order('created_at', { ascending: false }),
    ]);
    if (!manpowerError || !memberError) setTasks([
      ...(manpowerRows || []).map((t: any) => ({ ...t, source: 'manpower', assigned_to: t.accommodation_members?.name || t.assigned_to })),
      ...(memberRows || []).map((t: any) => ({ ...t, source: 'accommodation', team: 'Accommodation', assigned_to: t.accommodation_members?.name || t.assigned_to })),
    ].sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at))));
  };
  useEffect(() => {
    loadTasks();
    if (!orgId) return;
    const channel = supabase.channel(`manpower-tasks-${orgId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'manpower_tasks', filter: `organization_id=eq.${orgId}` }, loadTasks)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'accommodation_member_tasks', filter: `organization_id=eq.${orgId}` }, loadTasks).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [orgId]); // eslint-disable-line
  const saveTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskTitle.trim() || !orgId) return;
    setTaskBusy(true);
    const assignee = canManage ? taskAssignee.trim() : (auth.currentUser?.name || '');
    const { error } = await supabase.from('manpower_tasks').insert({
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, organization_id: orgId,
      title: taskTitle.trim(), details: taskDetails.trim(), team: taskTeam.trim(), assigned_to: assignee,
      member_id: taskMember || null, sewadar_id: null, due_date: taskDue || null, created_by: auth.currentUser?.id,
    });
    setTaskBusy(false);
    if (error) { auth.addToast?.(`Could not create task: ${error.message}`, 'error'); return; }
    setTaskTitle(''); setTaskDetails(''); setTaskTeam(''); setTaskAssignee(''); setTaskMember(''); setTaskDue('');
    await loadTasks();
  };
  const setTaskStatus = async (t: any, status: string) => {
    const table = t.source === 'accommodation' ? 'accommodation_member_tasks' : 'manpower_tasks';
    const { error } = await supabase.from(table).update({ status, updated_at: new Date().toISOString() }).eq('id', t.id);
    if (error) auth.addToast?.(`Could not update task: ${error.message}`, 'error'); else await loadTasks();
  };

  useEffect(() => { setPage(0); }, [stage, memberType, dept, q, size]);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const view = rows.slice(page * size, page * size + size);
  const allOnPage = view.length > 0 && view.every(s => sel.has(s.id));
  const toggle = (id: string) => setSel(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const togglePage = () => setSel(p => { const n = new Set(p); view.forEach(s => (allOnPage ? n.delete(s.id) : n.add(s.id))); return n; });
  const ids = Array.from(sel);

  const exportCSV = () => {
    const head = ['Name', 'Member type', 'Serial no.', 'Batch no.', 'Relation', 'Relation name', 'Mobile', 'Village / city', 'Branch', 'Occupation', 'Department', 'Remarks', 'Sewa joining date', 'Employee code', 'Employee ID', 'Address', 'Address 2', 'Expected arrival', 'Team', 'Team lead', 'Device', 'Device ID', 'Calls', 'Last call outcome', 'Last call at', 'Arrival', 'Arrived at', 'Badge'];
    const body = rows.map(s => [s.name, s.memberType, s.serialNo, s.batchNo, s.relation, s.relationName, s.phone, s.villageCity, s.branch, s.occupation, DEPT_LABEL[s.department] || s.department, s.remarks, s.joiningDate, s.employeeCode, s.employeeId, s.address, s.address2, s.expectedArrival, s.teamName, s.teamLead, DEVICE_LABEL[s.deviceType], s.deviceRef, s.callCount,
      s.lastCallOutcome ? OUTCOME_LABEL[s.lastCallOutcome] : '', s.lastCallAt || '', s.arrival, s.arrivedAt || '', s.badgeIssued ? 'Issued' : 'Pending']);
    const csv = [head, ...body].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `sewadars_${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };

  const statusCounts: Record<Stage, number> = {
    all: stats.total, toCall: stats.toCall, awaiting: stats.awaiting, arrived: stats.arrived,
    badge: stats.badgePending, notComing: stats.notComing,
  };

  const editedMember = editing && editing !== 'new' ? sewadars.find(s => s.id === editing.id) || editing : null;
  if (editedMember) return <>
    <SewadarForm key={editedMember.id} initial={editedMember} teams={teamGroups} fullPage onClose={() => setEditing(null)}
      onSave={i => m.update(editedMember.id, i)} onDelete={() => m.remove([editedMember.id])}
      onSetArrival={arrival => m.setArrival([editedMember.id], arrival)} onSetBadge={issued => m.setBadge([editedMember.id], issued)}
      onCallHistory={() => setCalling(editedMember)} />
    {calling && <CallModal s={calling} onClose={() => setCalling(null)} />}
  </>;

  return (
    <div className="space-y-3">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold tracking-tight flex items-center gap-2"><Users className="w-4 h-4 text-blue-400" />Sewadar roster</h1>
          <p className="text-xs text-mute">Shared member list · contact, type, arrival, teams and devices</p>
        </div>
        {workspace === 'members' && <div className="flex flex-wrap gap-2">
          <button className={cx(btnGhost(D), 'px-2.5 py-1.5 text-xs')} onClick={exportCSV}><Download className="w-3.5 h-3.5" />Export</button>
          {canManage && <button className={cx(btnGhost(D), 'px-2.5 py-1.5 text-xs')} onClick={() => setImporting(true)}><Upload className="w-3.5 h-3.5" />Import</button>}
          {canManage && <button className={cx(btnPrimary, 'px-2.5 py-1.5 text-xs')} onClick={() => setEditing('new')}><Plus className="w-3.5 h-3.5" />Add member</button>}
        </div>}
      </div>

      {loadError && <div role="alert" className="rounded-xl border border-rose-500/40 bg-rose-500/10 text-rose-400 text-sm p-3">Could not load Sewadars: {loadError}</div>}

      <nav aria-label="Sewadars workspace" className="flex gap-1 rounded-lg border border-line bg-surface/50 p-1">
        <button onClick={() => setWorkspace('members')} aria-pressed={workspace === 'members'} className={cx('flex flex-1 items-center justify-center gap-1.5 rounded-md px-2.5 py-2 text-xs font-semibold', workspace === 'members' ? 'bg-blue-600 text-white' : 'text-mute hover:bg-raised hover:text-ink')}><Users className="h-3.5 w-3.5" />Members</button>
        <button onClick={() => setWorkspace('teams')} aria-pressed={workspace === 'teams'} className={cx('flex flex-1 items-center justify-center gap-1.5 rounded-md px-2.5 py-2 text-xs font-semibold', workspace === 'teams' ? 'bg-blue-600 text-white' : 'text-mute hover:bg-raised hover:text-ink')}><Users className="h-3.5 w-3.5" />Teams <span className="rounded bg-raised px-1.5 py-0.5 tabular-nums">{teamGroups.length}</span></button>
        <button onClick={() => setWorkspace('tasks')} aria-pressed={workspace === 'tasks'} className={cx('flex flex-1 items-center justify-center gap-1.5 rounded-md px-2.5 py-2 text-xs font-semibold', workspace === 'tasks' ? 'bg-blue-600 text-white' : 'text-mute hover:bg-raised hover:text-ink')}><ClipboardList className="h-3.5 w-3.5" />Team tasks <span className="rounded bg-raised px-1.5 py-0.5 tabular-nums">{tasks.filter(t => t.status !== 'complete').length}</span></button>
      </nav>

      {workspace === 'teams' && <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2"><div><h2 className="text-lg font-semibold text-ink">Teams</h2><p className="text-sm text-mute">All roster members appear here. Assign ungrouped sewadars to a team when ready.</p></div><span className="text-xs text-mute">{teamGroups.length} teams · {sewadars.length} sewadars · {unassignedSewadars.length} unassigned</span></div>
        {sewadars.length ? <div className="grid gap-3 xl:grid-cols-2">{teamGroups.map(team => <section key={team.name.toLowerCase()} className={cx(panel, 'overflow-hidden')}>
          <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3"><div><h3 className="font-semibold text-ink">{team.name}</h3><p className="mt-0.5 text-xs text-mute">{team.lead ? `Team lead · ${team.lead}` : 'Team lead not set'}</p></div><span className="rounded-full bg-blue-500/10 px-2.5 py-1 text-xs font-semibold text-blue-300">{team.members.length} {team.members.length === 1 ? 'member' : 'members'}</span></header>
          <ul className="divide-y divide-line">{team.members.map(person => <li key={person.id} className="flex items-center gap-3 px-4 py-2.5"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-raised text-xs font-semibold text-ink-soft">{person.name.trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase()}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-ink">{person.name}</span><span className="block truncate text-xs text-mute">{[person.phone, DEPT_LABEL[person.department] || person.department, person.batchNo && `Batch ${person.batchNo}`].filter(Boolean).join(' · ')}</span></span><span className={cx('rounded-full px-2 py-1 text-[11px]', person.arrival === 'arrived' ? 'bg-emerald-500/10 text-emerald-300' : person.arrival === 'not_coming' ? 'bg-rose-500/10 text-rose-300' : 'bg-raised text-mute')}>{person.arrival === 'arrived' ? 'Arrived' : person.arrival === 'not_coming' ? 'Not coming' : 'Expected'}</span><div className="flex gap-1"><button className={btnGhost(D)} onClick={() => setCalling(person)} aria-label={`Call ${person.name}`}><PhoneCall className="h-3.5 w-3.5" /></button>{canManage && <button className={btnGhost(D)} onClick={() => setEditing(person)} aria-label={`Edit ${person.name}`}><Edit3 className="h-3.5 w-3.5" /></button>}</div></li>)}</ul>
        </section>)}
          {unassignedSewadars.length > 0 && <section className={cx(panel, 'overflow-hidden')}>
            <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3"><div><h3 className="font-semibold text-ink">Unassigned sewadars</h3><p className="mt-0.5 text-xs text-mute">These are already in the shared roster; assign them to a team or leave them unassigned.</p></div><span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-300">{unassignedSewadars.length}</span></header>
            <ul className="divide-y divide-line">{unassignedSewadars.map(person => <li key={person.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-raised text-xs font-semibold text-ink-soft">{person.name.trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase()}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-ink">{person.name}</span><span className="block truncate text-xs text-mute">{[person.phone, DEPT_LABEL[person.department] || person.department, person.batchNo && `Batch ${person.batchNo}`].filter(Boolean).join(' · ') || 'No contact details'}</span></span>
              {canManage && teamGroups.length > 0 && <select aria-label={`Assign ${person.name} to a team`} defaultValue="" onChange={e => { const selected = teamGroups.find(t => t.name === e.target.value); if (selected) void m.setTeam([person.id], selected.name, selected.lead); e.currentTarget.value = ''; }} className={rosterSelect}><option value="">Assign to team…</option>{teamGroups.map(team => <option key={team.name} value={team.name}>{team.name} · {team.members.length} members</option>)}</select>}
              <div className="flex gap-1"><button className={btnGhost(D)} onClick={() => setCalling(person)} aria-label={`Call ${person.name}`}><PhoneCall className="h-3.5 w-3.5" /></button>{canManage && <button className={btnGhost(D)} onClick={() => setEditing(person)} aria-label={`Edit ${person.name}`}><Edit3 className="h-3.5 w-3.5" /></button>}</div>
            </li>)}</ul>
          </section>}
        </div> : <div className={cx(panel, 'p-10 text-center')}><Users className="mx-auto mb-3 h-7 w-7 text-faint" /><h3 className="font-semibold text-ink">No sewadars in the shared roster yet</h3><p className="mt-1 text-sm text-mute">Add members in the Members tab first. They will appear here automatically.</p><button onClick={() => setWorkspace('members')} className={cx(btnPrimary, 'mt-4')}><Users className="h-4 w-4" />Open members</button></div>}
      </section>}

      {workspace === 'tasks' && <section className={cx(panel, 'overflow-hidden')}>
        <div className="px-4 py-3 border-b border-line flex items-center justify-between gap-3">
          <div><h2 className="text-sm font-semibold flex items-center gap-2"><ListTodo className="w-4 h-4 text-blue-400" />Team tasks</h2><p className="text-xs text-mute mt-0.5">Assign work to a member and follow it from to-do through completion.</p></div>
          <div role="group" aria-label="Filter team tasks" className="flex shrink-0 gap-1 rounded-md border border-line bg-field p-1">
            {([['all', 'All tasks', tasks.length], ['active', 'Active', activeTaskCount], ['completed', 'Completed', completedTaskCount]] as [TaskFilter, string, number][]).map(([key, label, count]) => <button key={key} type="button" aria-pressed={taskFilter === key} onClick={() => setTaskFilter(key)} className={cx('rounded px-2.5 py-1.5 text-[11px] font-medium', taskFilter === key ? 'bg-blue-600 text-white' : 'text-mute hover:bg-raised hover:text-ink')}>{label} <span className="ml-1 tabular-nums opacity-80">{count}</span></button>)}
          </div>
        </div>
        <form onSubmit={saveTask} className="p-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-2 border-b border-line">
          <input required value={taskTitle} onChange={e => setTaskTitle(e.target.value)} placeholder="Task name" className={cx(inputCls(D), 'xl:col-span-2')} />
          <label className="text-xs text-mute"><span className="sr-only">Assigned team</span><input list="sewadar-teams" value={taskTeam} onChange={e => setTaskTeam(e.target.value)} placeholder="Select or enter team" className={inputCls(D)} /><datalist id="sewadar-teams">{teamGroups.map(team => <option key={team.name} value={team.name}>{team.members.length} members · {team.lead || 'lead not set'}</option>)}</datalist></label>
          {canManage ? <input value={taskAssignee} onChange={e => setTaskAssignee(e.target.value)} placeholder="Assign to member" className={inputCls(D)} /> : <div className="px-3 py-2 text-xs text-mute">Creating for {auth.currentUser?.name}</div>}
          <select value={taskMember} onChange={e => setTaskMember(e.target.value)} className={inputCls(D)} aria-label="Link member"><option value="">Link sewadar (optional)</option>{sewadars.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <div className="flex gap-2"><input type="date" value={taskDue} onChange={e => setTaskDue(e.target.value)} className={cx(inputCls(D), 'min-w-0')} aria-label="Due date" /><button disabled={taskBusy} className={btnPrimary}><Plus className="w-4 h-4" />{taskBusy ? 'Saving' : 'Add'}</button></div>
          <textarea value={taskDetails} onChange={e => setTaskDetails(e.target.value)} placeholder="Task details (optional)" rows={1} className={cx(inputCls(D), 'md:col-span-2 xl:col-span-6')} />
        </form>
        <div className="divide-y divide-line max-h-80 overflow-y-auto">
          {visibleTasks.map(t => <div key={t.id} className="px-4 py-3 flex flex-wrap items-center gap-3">
            <span className={cx('w-2 h-2 rounded-full', t.status === 'complete' ? 'bg-emerald-400' : t.status === 'in_progress' ? 'bg-blue-400' : 'bg-amber-400')} />
            <div className="min-w-0 flex-1"><div className="text-sm font-medium">{t.title}</div><div className="text-xs text-mute">{[t.team, t.assigned_to, t.due_date && `Due ${t.due_date}`].filter(Boolean).join(' · ') || 'Unassigned'}{t.details ? ` · ${t.details}` : ''}</div></div>
            <span className="text-xs text-mute capitalize">{t.status.replace('_', ' ')}</span>
            {t.status === 'todo' && <button onClick={() => setTaskStatus(t, 'in_progress')} className={btnGhost(D)}><Play className="w-3.5 h-3.5" />Start</button>}
            {t.status === 'in_progress' && <button onClick={() => setTaskStatus(t, 'complete')} className={btnGhost(D)}><CircleCheck className="w-3.5 h-3.5" />Complete</button>}
          </div>)}
          {!visibleTasks.length && <div className="p-6 text-center text-xs text-mute">{tasks.length ? `No ${taskFilter} tasks.` : 'No tasks yet. Add work above to get the team started.'}</div>}
        </div>
      </section>}

      {/* Compact member search and single-row filters */}
      {workspace === 'members' && <>
      <section className={cx(panel, 'flex flex-col gap-2 p-2 md:flex-row md:items-center')}>
        <label className="relative min-w-0 md:flex-1"><Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-faint" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, mobile, ID, batch, team or city…" className="h-9 w-full rounded-md border border-line bg-field pl-8 pr-2.5 text-xs text-ink outline-none placeholder:text-faint focus:border-blue-500" /></label>
        <select value={memberType} onChange={e => setMemberType(e.target.value as 'all' | SewadarMemberType)} aria-label="Member type" className={cx(rosterSelect, 'md:min-w-[155px]')}>
          <option value="all">All member types</option><option value="salary_based">Salary based ({sewadars.filter(s => s.memberType === 'salary_based').length})</option><option value="monthly">Monthly ({sewadars.filter(s => s.memberType === 'monthly').length})</option><option value="annual">Annual ({sewadars.filter(s => s.memberType === 'annual').length})</option>
        </select>
        <select value={dept} onChange={e => setDept(e.target.value)} aria-label="Department" className={cx(rosterSelect, 'md:min-w-[170px]')}>
          <option value="all">All departments</option>{DEPT_OPTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}<option value="none">No department</option>
        </select>
        <select value={stage} onChange={e => setStage(e.target.value as Stage)} aria-label="Member status" className={cx(rosterSelect, 'md:min-w-[150px]')}>
          <option value="all">All statuses ({statusCounts.all})</option><option value="toCall">Need call ({statusCounts.toCall})</option><option value="awaiting">Called · awaiting ({statusCounts.awaiting})</option><option value="arrived">Arrived ({statusCounts.arrived})</option><option value="badge">Badge pending ({statusCounts.badge})</option><option value="notComing">Not coming ({statusCounts.notComing})</option>
        </select>
      </section>

      {sel.size > 0 && canManage && (
        <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-2.5 flex flex-wrap items-center gap-2 text-sm">
          <b>{sel.size} selected</b>
          <button className={btnGhost(D)} onClick={() => m.setArrival(ids, 'arrived')}><Check className="w-3.5 h-3.5" />Mark arrived</button>
          <button className={btnGhost(D)} onClick={() => m.setBadge(ids, true)}>Issue badge</button>
          <select aria-label="Assign selected members to a team" value="" onChange={e => { const team = teamGroups.find(t => t.name === e.target.value); if (team) m.setTeam(ids, team.name, team.lead); }} className={cx(inputCls(D), 'w-auto py-1.5 text-xs')}>
            <option value="">Assign to team…</option>{teamGroups.map(team => <option key={team.name} value={team.name}>{team.name} · {team.members.length} members</option>)}
          </select>
          <select aria-label="Move to department" value="" onChange={e => { if (e.target.value) m.setDepartment(ids, e.target.value === '__none' ? '' : e.target.value); }} className={cx(inputCls(D), 'w-auto py-1.5 text-xs')}>
            <option value="">Move to department…</option>
            {DEPT_OPTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            <option value="__none">No department</option>
          </select>
          <button className={cx(btnGhost(D), 'text-rose-400')} onClick={() => setConfirmDel(true)}><Trash2 className="w-3.5 h-3.5" />Delete</button>
          <button className="ml-auto text-xs text-mute hover:text-ink" onClick={() => setSel(new Set())}>Clear</button>
        </div>
      )}

      <section className={cx(panel, 'overflow-hidden')}>
        <div className="flex items-center gap-2 border-b border-line px-2.5 py-2 text-[11px] text-mute"><span className="font-semibold text-ink">Members</span><span className="rounded bg-raised px-1.5 py-0.5 tabular-nums">{rows.length} shown · {stats.total} total</span>{canManage && <label className="ml-auto inline-flex items-center gap-2"><input type="checkbox" aria-label="Select page" checked={allOnPage} onChange={togglePage} className="rounded" />Select page</label>}</div>
        <div className="max-h-[calc(100vh-18rem)] min-h-[180px] overflow-auto">
        <table className="w-full min-w-[1250px] border-collapse text-[11px] leading-4">
          <thead className="sticky top-0 z-10 bg-raised text-left text-[10px] font-semibold uppercase tracking-wide text-mute shadow-sm">
            <tr>
              {canManage && <th className="border-b border-r border-line px-2 py-2"><span className="sr-only">Select</span></th>}
              {['B. No. / Batch','Name','Type','Mobile','Branch','Address','Department','Team','Expected arrival','Arrival / arrived at','Badge','Calls','Actions'].map(label => <th key={label} className="whitespace-nowrap border-b border-r border-line px-2 py-2">{label}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-line/70">
          {view.map(s => {
            const arrivalLabel = s.arrival === 'arrived' ? `Arrived${clock(s.arrivedAt) ? ` · ${clock(s.arrivedAt)}` : ''}` : s.arrival === 'not_coming' ? 'Not coming' : 'Expected';
            const address = [s.address, s.address2].filter(Boolean).join(', ');
            const cells = [s.batchNo,s.name,s.memberType === 'salary_based' ? 'Salary based' : s.memberType,s.phone,s.branch,address,DEPT_LABEL[s.department] || s.department,s.teamName,s.expectedArrival,arrivalLabel,s.badgeIssued ? 'Issued' : 'Pending',`${s.callCount} call${s.callCount === 1 ? '' : 's'}`];
            return <tr key={s.id} className={cx('hover:bg-raised/50', sel.has(s.id) && 'bg-blue-500/5')}>
              {canManage && <td className="border-r border-line px-2 py-1.5"><input type="checkbox" aria-label={`Select ${s.name}`} checked={sel.has(s.id)} onChange={() => toggle(s.id)} className="rounded" /></td>}
              {cells.map((value, i) => <td key={i} title={value || ''} className={cx('max-w-[200px] truncate whitespace-nowrap border-r border-line/70 px-2 py-1.5', i === 1 ? 'font-semibold text-ink' : 'text-ink-soft', i === 9 && s.arrival === 'arrived' && 'text-emerald-300', i === 9 && s.arrival === 'not_coming' && 'text-rose-300', i === 10 && (s.badgeIssued ? 'text-emerald-300' : 'text-amber-300'))}>{i === 3 && s.phone ? <a href={`tel:${s.phone}`} className="hover:text-blue-300">{value}</a> : value || '—'}</td>)}
              <td className="sticky right-0 border-b border-line bg-surface px-2 py-1"><div className="flex items-center gap-1"><button className="rounded px-2 py-1 text-[10px] font-medium text-blue-300 hover:bg-blue-500/10" onClick={() => setCalling(s)}>Call</button>{canManage && <button className="rounded px-2 py-1 text-[10px] font-medium text-ink-soft hover:bg-raised" onClick={() => setEditing(s)}>Edit</button>}</div></td>
            </tr>;
          })}
          </tbody>
        </table>
        </div>
        {view.length === 0 && (
          <div className="py-14 text-center text-sm text-faint">
            {loading ? 'Loading…' : sewadars.length === 0 ? (canManage ? 'No sewadars yet — use "Import list" to paste names and numbers.' : 'No sewadars added yet.') : 'No one matches these filters.'}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 px-2.5 py-2 border-t border-line text-[11px] text-mute">
          <span>{rows.length ? `${page * size + 1}–${Math.min(rows.length, page * size + size)} of ${rows.length}` : '0 results'}</span>
          <div className="flex items-center gap-2">
            <select aria-label="Rows per page" value={size} onChange={e => setSize(+e.target.value)} className={cx(inputCls(D), 'w-auto py-1 text-xs')}>{[25, 50, 100, 200].map(n => <option key={n} value={n}>{n} / page</option>)}</select>
            <button className={btnGhost(D)} disabled={page === 0} onClick={() => setPage(p => p - 1)} aria-label="Previous page"><ChevronLeft className="w-4 h-4" /></button>
            <span>{page + 1} / {pages}</span>
            <button className={btnGhost(D)} disabled={page >= pages - 1} onClick={() => setPage(p => p + 1)} aria-label="Next page"><ChevronRight className="w-4 h-4" /></button>
          </div>
        </div>
      </section>

      {editing && <SewadarForm initial={editing === 'new' ? null : editing} teams={teamGroups} onClose={() => setEditing(null)}
        onSave={(i) => (editing === 'new' ? m.add(i) : m.update(editing.id, i))}
        onDelete={editing !== 'new' ? () => m.remove([editing.id]) : undefined} />}
      {calling && <CallModal s={calling} onClose={() => setCalling(null)} />}
      {importing && <ImportModal onClose={() => setImporting(false)} />}
      {confirmDel && <ConfirmModal dark={D} title={`Delete ${sel.size} sewadar(s)?`} body="They and their call history will be permanently removed." confirmLabel="Delete" onConfirm={async () => { if (await m.remove(ids)) setSel(new Set()); }} onClose={() => setConfirmDel(false)} />}
      </>}
    </div>
  );
};

// ---------------------------------------------------------------------------
const emptySewadar = (): SewadarInput => ({
  name: '', memberType: 'salary_based', serialNo: '', batchNo: '', phone: '', department: '', relation: '', relationName: '',
  villageCity: '', branch: '', occupation: '', remarks: '', joiningDate: '', employeeCode: '', employeeId: '', address: '', address2: '',
  expectedArrival: '', teamName: '', teamLead: '', deviceType: 'none', deviceRef: '',
});

const SewadarForm: React.FC<{
  initial: Sewadar | null;
  teams: { name: string; lead: string; members: Sewadar[] }[];
  onClose: () => void;
  onSave: (i: SewadarInput) => Promise<boolean>;
  onDelete?: () => Promise<boolean>;
  fullPage?: boolean;
  onSetArrival?: (arrival: Arrival) => Promise<boolean>;
  onSetBadge?: (issued: boolean) => Promise<boolean>;
  onCallHistory?: () => void;
}> = ({ initial, teams, onClose, onSave, onDelete, fullPage = false, onSetArrival, onSetBadge, onCallHistory }) => {
  const [f, setF] = useState<SewadarInput>(() => initial ? ({
    name: initial.name, memberType: initial.memberType, serialNo: initial.serialNo, batchNo: initial.batchNo, phone: initial.phone,
    department: initial.department, relation: initial.relation, relationName: initial.relationName, villageCity: initial.villageCity,
    branch: initial.branch, occupation: initial.occupation, remarks: initial.remarks, joiningDate: initial.joiningDate,
    employeeCode: initial.employeeCode, employeeId: initial.employeeId, address: initial.address, address2: initial.address2,
    expectedArrival: initial.expectedArrival, teamName: initial.teamName, teamLead: initial.teamLead,
    deviceType: initial.deviceType, deviceRef: initial.deviceRef,
  }) : emptySewadar());
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState(false);
  const set = <K extends keyof SewadarInput,>(k: K, v: SewadarInput[K]) => setF(p => ({ ...p, [k]: v }));
  const field = (k: Exclude<keyof SewadarInput, 'memberType' | 'deviceType'>, label: string, type = 'text') => <label key={k} className="text-xs text-mute">{label}<input required={k === 'name' || (k === 'joiningDate' && f.memberType !== 'salary_based')} autoFocus={k === 'name' && !initial} type={type} value={f[k]} onChange={e => set(k, e.target.value)} className={cx(inputCls(D), 'mt-1')} /></label>;
  const submit = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); const ok = await onSave(f); setBusy(false); if (ok) onClose(); };
  const downloadRecord = () => {
    if (!initial) return;
    const record: Record<string, string> = {
      ...Object.fromEntries(Object.entries(f).map(([key, value]) => [key, String(value ?? '')])),
      arrival: initial.arrival, arrived_at: initial.arrivedAt || '', badge: initial.badgeIssued ? 'Issued' : 'Pending', badge_at: initial.badgeAt || '',
      call_count: String(initial.callCount), last_call_outcome: initial.lastCallOutcome ? OUTCOME_LABEL[initial.lastCallOutcome] : '', last_call_at: initial.lastCallAt || '',
    };
    const csv = [['Field', 'Value'], ...Object.entries(record)].map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${initial.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_') || 'member'}_record.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  const formContent = (
      <form onSubmit={submit} className="space-y-4">
        <section className="space-y-3"><h3 className="text-xs font-semibold uppercase tracking-wider text-mute">Member record</h3><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {field('name', 'Full name')}
          <label className="text-xs text-mute">Member type<select value={f.memberType} onChange={e => set('memberType', e.target.value as SewadarMemberType)} className={cx(inputCls(D), 'mt-1')}><option value="salary_based">Salary based (hired)</option><option value="monthly">Monthly</option><option value="annual">Annual (main event)</option></select></label>
          {field('serialNo', 'Sr. No.')}{field('batchNo', 'B. No. / Batch')}{field('relation', 'Relation')}{field('relationName', 'Relation name')}
          {field('phone', 'Mobile', 'tel')}{field('villageCity', 'Village / city')}{field('branch', 'Branch')}{field('occupation', 'Occupation')}
          {field('employeeCode', 'Employee code')}{field('employeeId', 'Employee ID')}{field('address', 'Address')}{field('address2', 'Address 2')}
          {field('remarks', 'Remarks')}
        </div></section>
        <section className="space-y-3 border-t border-line pt-4"><h3 className="text-xs font-semibold uppercase tracking-wider text-mute">Sewa and team assignment</h3><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-xs text-mute">Department<select value={f.department} onChange={e => set('department', e.target.value)} className={cx(inputCls(D), 'mt-1')}><option value="">Not assigned</option>{DEPT_OPTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          {field('joiningDate', 'Sewa joining / promised date', 'date')}{field('expectedArrival', 'Expected arrival', 'date')}
          <label className="text-xs text-mute">Team<input list="sewadar-member-teams" value={f.teamName} onChange={e => { const value = e.target.value; const existing = teams.find(team => team.name.toLocaleLowerCase() === value.trim().toLocaleLowerCase()); setF(p => ({ ...p, teamName: value, teamLead: existing?.lead || p.teamLead })); }} placeholder="Select an existing team or type a new name" className={cx(inputCls(D), 'mt-1')} /><datalist id="sewadar-member-teams">{teams.map(team => <option key={team.name} value={team.name}>{team.members.length} members · {team.lead || 'lead not set'}</option>)}</datalist></label>
          {field('teamLead', 'Team lead')}
          <label className="text-xs text-mute">Issued device<select value={f.deviceType} onChange={e => set('deviceType', e.target.value as DeviceType)} className={cx(inputCls(D), 'mt-1')}>{DEVICES.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}</select></label>
          {field('deviceRef', 'Device ID / serial')}
        </div></section>
        <div className="flex items-center justify-between gap-2 pt-1">
          {onDelete ? <button type="button" className={cx(btnGhost(D), 'text-rose-400')} onClick={() => setDel(true)}><Trash2 className="w-3.5 h-3.5" />Delete</button> : <span />}
          <div className="flex gap-2"><button type="button" onClick={onClose} className={btnGhost(D)}>Cancel</button><button type="submit" disabled={busy} className={btnPrimary}>{busy ? 'Saving…' : 'Save'}</button></div>
        </div>
      </form>
  );
  const deleteDialog = del && onDelete && <ConfirmModal dark={D} title={`Delete ${initial?.name}?`} body="Their call history is removed too." confirmLabel="Delete" onConfirm={async () => { if (await onDelete()) onClose(); }} onClose={() => setDel(false)} />;
  if (fullPage && initial) return (
    <section className="mx-auto w-full max-w-6xl space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <button type="button" onClick={onClose} className="mb-1 inline-flex items-center gap-1 text-xs font-medium text-blue-300 hover:text-blue-200"><ChevronLeft className="h-3.5 w-3.5" />Back to Sewadars</button>
          <h1 className="truncate text-lg font-bold text-ink">{f.name || initial.name}</h1>
          <p className="text-xs text-mute">Member record · edit full details and download this member’s record</p>
        </div>
        <button type="button" onClick={downloadRecord} className={cx(btnGhost(D), 'px-2.5 py-1.5 text-xs')}><Download className="h-3.5 w-3.5" />Download record</button>
      </header>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <label className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface/50 px-3 py-2 text-xs"><span className="text-mute">Arrival</span><select value={initial.arrival} onChange={e => onSetArrival?.(e.target.value as Arrival)} className="max-w-[150px] rounded border border-line bg-field px-2 py-1 text-xs text-ink"><option value="pending">Expected</option><option value="arrived">Arrived</option><option value="not_coming">Not coming</option></select></label>
        <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface/50 px-3 py-2 text-xs"><span className="text-mute">Arrived at</span><span className="font-medium text-ink">{clock(initial.arrivedAt) || '—'}</span></div>
        <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface/50 px-3 py-2 text-xs"><span className="text-mute">Badge</span><button type="button" onClick={() => onSetBadge?.(!initial.badgeIssued)} className={cx('rounded-md px-2 py-1 text-xs font-semibold', initial.badgeIssued ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300')}>{initial.badgeIssued ? 'Issued · mark pending' : 'Pending · issue badge'}</button></div>
        <button type="button" onClick={onCallHistory} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface/50 px-3 py-2 text-left text-xs hover:bg-raised"><span className="text-mute">Call history</span><span className="font-medium text-blue-300">{initial.callCount} call{initial.callCount === 1 ? '' : 's'} · View</span></button>
      </div>
      <div className={cx(panel, 'p-3 sm:p-4')}>
        {formContent}
      </div>
      {deleteDialog}
    </section>
  );
  return <Modal title={initial ? `Edit ${initial.name}` : 'Add sewadar'} dark={D} onClose={onClose} xl>{formContent}{deleteDialog}</Modal>;
};

const CallModal: React.FC<{ s: Sewadar; onClose: () => void }> = ({ s, onClose }) => {
  const { logCall, fetchCalls, canManage, sewadars } = useManpower();
  const live = sewadars.find(x => x.id === s.id) || s;
  const [outcome, setOutcome] = useState<string>('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [hist, setHist] = useState<CallLog[] | null>(null);
  useEffect(() => { let on = true; fetchCalls(s.id).then(h => on && setHist(h)); return () => { on = false; }; }, [s.id, live.callCount]); // eslint-disable-line
  const save = async () => {
    if (!outcome) return;
    setBusy(true);
    const ok = await logCall(s.id, outcome as any, note);
    setBusy(false);
    if (ok) { setOutcome(''); setNote(''); }
  };
  return (
    <Modal title={live.name} dark={D} onClose={onClose} wide>
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="text-sm text-mute">{live.callCount} call{live.callCount === 1 ? '' : 's'} so far</div>
        {live.phone && <a href={`tel:${live.phone}`} className={cx(btnPrimary, 'bg-emerald-600 hover:bg-emerald-500')}><Phone className="w-4 h-4" />Call {live.phone}</a>}
      </div>
      {canManage && (
        <div className="space-y-3 mb-5">
          <div className="text-xs font-semibold text-mute">What happened on the call?</div>
          <div className="flex flex-wrap gap-2">
            {OUTCOMES.map(o => (
              <button key={o.key} type="button" aria-pressed={outcome === o.key} onClick={() => setOutcome(o.key)}
                className={cx('text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors', outcome === o.key ? 'bg-blue-600 border-blue-500 text-white' : TONE[o.tone])}>{o.label}</button>
            ))}
          </div>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional) — e.g. reaching by 6 PM" className={inputCls(D)} />
          <div className="flex justify-end"><button className={btnPrimary} disabled={!outcome || busy} onClick={save}>{busy ? 'Saving…' : 'Log call'}</button></div>
        </div>
      )}
      <div className="flex items-center gap-2 text-xs font-semibold text-mute mb-2"><History className="w-3.5 h-3.5" />Call history</div>
      {hist === null ? <p className="text-sm text-faint">Loading…</p> : hist.length === 0 ? <p className="text-sm text-faint">No calls logged yet.</p> : (
        <ul className="divide-y divide-line max-h-56 overflow-y-auto">
          {hist.map(h => (
            <li key={h.id} className="py-2 flex items-start justify-between gap-3 text-sm">
              <div><span className={cx('text-xs font-semibold px-2 py-0.5 rounded-full border', TONE[OUTCOME_TONE[h.outcome]])}>{OUTCOME_LABEL[h.outcome]}</span>{h.note && <div className="text-xs text-mute mt-1">{h.note}</div>}</div>
              <div className="text-xs text-faint text-right shrink-0">{new Date(h.calledAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}<br />{h.calledBy}</div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
};

const readDelimitedRows = (source: string) => {
  const firstLine = source.split(/\r?\n/, 1)[0] || '';
  const delimiter = (firstLine.match(/\t/g) || []).length > (firstLine.match(/,/g) || []).length ? '\t' : ',';
  const rows: string[][] = [];
  let row: string[] = []; let cell = ''; let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '"' && source[i + 1] === '"' && quoted) { cell += '"'; i++; }
    else if (ch === '"') quoted = !quoted;
    else if (ch === delimiter && !quoted) { row.push(cell.trim()); cell = ''; }
    else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && source[i + 1] === '\n') i++;
      row.push(cell.trim());
      if (row.some(value => value)) rows.push(row);
      row = []; cell = '';
    } else cell += ch;
  }
  row.push(cell.trim());
  if (row.some(value => value)) rows.push(row);
  return rows;
};

const headerKey = (value: string) => value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
const headerMatches = (value: string, alias: string) => value === headerKey(alias) || (alias.length >= 6 && value.startsWith(`${headerKey(alias)} `));
const headerAliases: Record<string, string[]> = {
  name: ['name', 'full name', 'sewadar name', 'member name', 'employee name'],
  phone: ['mobile', 'mobile number', 'phone', 'phone number', 'contact', 'contact number'],
  department: ['department', 'dept'], memberType: ['member type', 'sewadar type', 'type', 'member category'],
  joiningDate: ['sewa joining date', 'joining date', 'sewa date', 'promised date', 'date promised'],
  serialNo: ['sr no', 'sr number', 'serial no', 'serial number'], batchNo: ['b no', 'batch no', 'batch number', 'b number'],
  relation: ['rel', 'relation'], relationName: ['relation name', 'father name', 'husband name', 'guardian name'],
  villageCity: ['village city', 'village', 'city'], branch: ['branch'], occupation: ['occupation'], remarks: ['remarks', 'remark'],
  employeeCode: ['emp code', 'employee code', 'employee number'], employeeId: ['employee id', 'emp id', 'employee identifier'],
  address: ['address', 'address 1'], address2: ['address 2', 'address line 2'], expectedArrival: ['expected arrival', 'arrival date'],
  teamName: ['team', 'team name'], teamLead: ['team lead', 'team leader'], deviceType: ['device', 'device type'], deviceRef: ['device id', 'device serial', 'device reference'],
};
const memberKind = (value: string, fallback: SewadarMemberType): SewadarMemberType => {
  const kind = value.toLowerCase();
  if (kind.includes('annual')) return 'annual';
  if (kind.includes('month')) return 'monthly';
  if (kind.includes('salary') || kind.includes('permanent') || kind.includes('hired')) return 'salary_based';
  return fallback;
};
const importDate = (value: string) => {
  const raw = value.trim();
  if (!raw) return '';
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const local = raw.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/);
  if (local) return `${local[3]}-${local[2].padStart(2, '0')}-${local[1].padStart(2, '0')}`;
  return '';
};
const parseSewadarImport = (text: string, defaultType: SewadarMemberType): SewadarInput[] => {
  const rows = readDelimitedRows(text);
  if (!rows.length) return [];
  const keys = Object.keys(headerAliases);
  const headerIndex = rows.findIndex(row => {
    const values = row.map(headerKey);
    const hasName = headerAliases.name.some(alias => values.some(value => headerMatches(value, alias)));
    const recognized = keys.filter(key => headerAliases[key].some(alias => values.some(value => headerMatches(value, alias))));
    return hasName && recognized.length >= 2;
  });
  const hasHeader = headerIndex >= 0;
  const headers = hasHeader ? rows[headerIndex].map(headerKey) : [];
  const dataRows = hasHeader ? rows.slice(headerIndex + 1) : rows;
  const indexFor = (key: string) => headers.findIndex(value => headerAliases[key].some(alias => headerMatches(value, alias)));
  const cell = (values: string[], key: string, fallbackIndex: number) => {
    const index = hasHeader ? indexFor(key) : fallbackIndex;
    return index < 0 ? '' : (values[index] || '').trim();
  };
  return dataRows.map(values => {
    const departmentRaw = cell(values, 'department', 2).toLowerCase();
    const department = DEPT_OPTIONS.find(([key, label]) => key.toLowerCase() === departmentRaw || label.toLowerCase() === departmentRaw);
    const typeRaw = cell(values, 'memberType', 3);
    const type = memberKind(typeRaw, defaultType);
    const joiningDate = importDate(cell(values, 'joiningDate', 4));
    const expectedArrival = importDate(cell(values, 'expectedArrival', 4));
    const deviceCandidate = cell(values, 'deviceType', 19).toLowerCase();
    const deviceType = DEVICES.find(device => device.key === deviceCandidate || device.label.toLowerCase() === deviceCandidate)?.key || 'none';
    return {
      ...emptySewadar(), name: cell(values, 'name', 0), phone: cell(values, 'phone', 1), department: department?.[0] || '', memberType: type,
      joiningDate, expectedArrival, batchNo: cell(values, 'batchNo', 5), teamName: cell(values, 'teamName', 6), teamLead: cell(values, 'teamLead', 7),
      villageCity: cell(values, 'villageCity', 8), branch: cell(values, 'branch', 9), occupation: cell(values, 'occupation', 10), remarks: cell(values, 'remarks', 11),
      serialNo: cell(values, 'serialNo', 12), relation: cell(values, 'relation', 13), relationName: cell(values, 'relationName', 14),
      employeeCode: cell(values, 'employeeCode', 15), employeeId: cell(values, 'employeeId', 16), address: cell(values, 'address', 17), address2: cell(values, 'address2', 18),
      deviceType, deviceRef: cell(values, 'deviceRef', 20),
    };
  }).filter(member => member.name);
};

const googleCsvUrl = (value: string) => {
  const url = new URL(value.trim());
  if (url.protocol !== 'https:' || !/^(docs|www)\.google\.com$/.test(url.hostname)) throw new Error('Paste a Google Sheets link or a published CSV URL.');
  const match = url.pathname.match(/\/spreadsheets\/d\/(e\/)?([^/]+)/);
  if (!match) throw new Error('That link does not look like a Google Sheets spreadsheet link.');
  const isPublished = Boolean(match[1]) || /\/pub(html)?\/?$/.test(url.pathname);
  const id = match[2];
  const gid = url.searchParams.get('gid') || url.hash.match(/(?:^#|&)gid=(\d+)/)?.[1];
  if (isPublished) {
    url.pathname = `/spreadsheets/d/e/${id}/pub`;
    url.search = '';
    url.searchParams.set('output', 'csv');
    if (gid) url.searchParams.set('gid', gid);
    return url.toString();
  }
  url.pathname = `/spreadsheets/d/${id}/export`;
  url.search = '';
  url.searchParams.set('format', 'csv');
  if (gid) url.searchParams.set('gid', gid);
  return url.toString();
};

const ImportModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { addMany } = useManpower();
  const [text, setText] = useState('');
  const [sheetUrl, setSheetUrl] = useState('');
  const [sheetError, setSheetError] = useState('');
  const [sheetBusy, setSheetBusy] = useState(false);
  const [defaultType, setDefaultType] = useState<SewadarMemberType>('salary_based');
  const [busy, setBusy] = useState(false);
  const parsed = useMemo(() => parseSewadarImport(text, defaultType), [text, defaultType]);
  const missingPromisedDate = parsed.filter(row => row.memberType !== 'salary_based' && !row.joiningDate).length;
  const loadGoogleSheet = async () => {
    setSheetError('');
    let csvUrl = '';
    try { csvUrl = googleCsvUrl(sheetUrl); } catch (error: any) { setSheetError(error.message || 'Check the Google Sheets link.'); return; }
    setSheetBusy(true);
    try {
      const response = await fetch(csvUrl);
      if (!response.ok) throw new Error(`Google Sheets returned ${response.status}.`);
      const csv = await response.text();
      if (!csv.trim() || /<html[\s>]/i.test(csv.slice(0, 500))) throw new Error('No CSV data returned. Check the link and sheet access.');
      setText(csv);
    } catch (error: any) {
      setSheetError(`${error.message || 'Could not read this sheet.'} Share it as viewer or publish the selected tab as CSV, then try again. If your browser blocks the request, download the tab as CSV and upload it below.`);
    } finally { setSheetBusy(false); }
  };
  const go = async () => { setBusy(true); const r = await addMany(parsed); setBusy(false); if (r.added) onClose(); };
  return (
    <Modal title="Import sewadars" dark={D} onClose={onClose} wide>
      <p className="mb-3 text-xs text-mute">Import the Sewadar register or employee list from CSV, Google Sheets, or pasted rows. Header names are matched automatically; existing phone numbers are skipped.</p>
      <section className="mb-3 rounded-lg border border-line bg-surface/60 p-3">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-ink"><FileSpreadsheet className="h-4 w-4 text-emerald-400" />Google Sheets</div>
        <div className="flex flex-col gap-2 sm:flex-row"><input value={sheetUrl} onChange={e => setSheetUrl(e.target.value)} placeholder="Paste a Google Sheets link" className={cx(inputCls(D), 'min-w-0 flex-1')} /><button type="button" onClick={loadGoogleSheet} disabled={!sheetUrl.trim() || sheetBusy} className={cx(btnGhost(D), 'shrink-0')}>{sheetBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}{sheetBusy ? 'Loading…' : 'Load sheet'}</button></div>
        <p className="mt-2 text-[11px] text-faint">The spreadsheet must be available to viewers or published as CSV. Only the selected sheet tab is imported.</p>
        {sheetError && <p role="alert" className="mt-2 text-xs text-rose-300">{sheetError}</p>}
      </section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-xs text-mute">If the sheet has no member type<select value={defaultType} onChange={e => setDefaultType(e.target.value as SewadarMemberType)} className="h-8 rounded-md border border-line bg-field px-2 text-xs text-ink"><option value="salary_based">Salary based</option><option value="monthly">Monthly</option><option value="annual">Annual</option></select></label>
        <label className="flex flex-wrap items-center gap-2 text-xs text-mute">Upload CSV<input type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" onChange={async e => { const file = e.currentTarget.files?.[0]; if (file) setText(await file.text()); }} className="text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-raised file:px-3 file:py-2 file:font-semibold file:text-ink" /></label>
      </div>
      <textarea rows={7} autoFocus value={text} onChange={e => setText(e.target.value)} placeholder={'Paste CSV rows with a header row, for example:\nSr. No.,B. No.,Name,Rel.,Relation Name,Mobile,Village/City,Branch,Occupation,Remarks,Sewa Joining Date,Department\n1,101,Amit Sharma,S/o,Raj Sharma,9876543210,Delhi,Main,Service,,2026-10-12,WiFi'} className={cx(inputCls(D), 'font-mono text-xs')} />
      {parsed.length > 0 && <div className="mt-2 rounded-md bg-raised/60 px-2.5 py-2 text-[11px] text-mute">Preview: <span className="font-medium text-ink">{parsed.slice(0, 4).map(row => `${row.name} · ${row.memberType.replace('_', ' ')}`).join('  |  ')}</span>{parsed.length > 4 && `  |  +${parsed.length - 4} more`}</div>}
      <div className="flex items-center justify-between mt-4">
        <span className="text-xs text-mute">{parsed.length} ready to import{missingPromisedDate > 0 && <span className="ml-2 text-rose-300">· {missingPromisedDate} monthly/annual row(s) need a promised date</span>}</span>
        <div className="flex gap-2"><button className={btnGhost(D)} onClick={onClose}>Cancel</button><button className={btnPrimary} disabled={!parsed.length || !!missingPromisedDate || busy} onClick={go}>{busy ? 'Importing…' : `Import ${parsed.length}`}</button></div>
      </div>
    </Modal>
  );
};
