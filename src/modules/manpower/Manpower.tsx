import React, { useEffect, useMemo, useState } from 'react';
import { memberMeta } from './memberMeta';
import * as XLSX from 'xlsx';
import { Check, ChevronDown, ChevronLeft, ChevronRight, CircleCheck, ClipboardList, Download, Edit3, ExternalLink, FileSpreadsheet, History, Laptop, ListTodo, LoaderCircle, Package, Phone, PhoneCall, Play, Plus, Radio, Search, Smartphone, Tablet, Trash2, Upload, Users, UserPlus, UserMinus, CalendarDays } from 'lucide-react';
import { useWalkie } from '../walkie';
import { supabase } from '../walkie/lib/supabaseClient';
import { DEPT_LABEL, DEPT_OPTIONS } from '../accommodation/types';
import { Modal, ConfirmModal, btnGhost, btnPrimary, cx, inputCls, labelCls } from '../accommodation/ui';
import { useInventory } from '../inventory';
import { useManpower } from './ManpowerContext';
import type { SewadarInput } from './ManpowerContext';
import { DEVICES, DEVICE_LABEL, OUTCOMES, OUTCOME_LABEL, OUTCOME_TONE } from './types';
import type { Arrival, ArrivalTimeOfDay, CallLog, DeviceType, Sewadar, SewadarMemberType } from './types';
import { useEventScope } from '../../context/EventScopeContext';
import { digitsOnly, phoneInputProps } from '../../lib/phone';

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
const taskDateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const excelDate = (value: unknown): Date | '' => {
  if (!value) return '';
  const raw = String(value);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(Number(raw.slice(0, 4)), Number(raw.slice(5, 7)) - 1, Number(raw.slice(8, 10)))
    : new Date(raw);
  return Number.isNaN(date.getTime()) ? '' : date;
};
const displayTaskDate = (value: unknown) => {
  const date = excelDate(value);
  return date ? date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Not scheduled';
};

type Stage = 'all' | 'toCall' | 'awaiting' | 'arrived' | 'badge' | 'notComing' | 'overdue';
type MemberSection = 'general' | 'calling';
type TaskFilter = 'all' | 'pending' | 'today' | 'upcoming' | 'overdue' | 'completed';
const inStage = (s: Sewadar, st: Stage) => {
  switch (st) {
    case 'toCall': return s.arrival === 'pending' && s.callCount === 0;
    case 'awaiting': return s.arrival === 'pending' && s.callCount > 0;
    case 'arrived': return s.arrival === 'arrived';
    case 'badge': return s.arrival === 'arrived' && !s.badgeIssued;
    case 'notComing': return s.arrival === 'not_coming';
    case 'overdue': return isArrivalOverdue(s, new Date());
    default: return true;
  }
};

const ARRIVAL_PERIOD_HOUR: Record<Exclude<ArrivalTimeOfDay, ''>, number> = { morning: 6, noon: 12, evening: 18, night: 21 };
const isArrivalOverdue = (s: Sewadar, now: Date) => {
  if (s.arrival !== 'pending' || !s.expectedArrival || !s.expectedArrivalPeriod) return false;
  const [year, month, day] = s.expectedArrival.split('-').map(Number);
  const due = new Date(year, month - 1, day, ARRIVAL_PERIOD_HOUR[s.expectedArrivalPeriod as Exclude<ArrivalTimeOfDay, ''>] ?? 0);
  return !Number.isNaN(due.getTime()) && due.getTime() < now.getTime();
};

export const ManpowerApp: React.FC<{ initialSection?: 'roster' | 'calling' | 'permanent' | 'teams' | 'tasks' }> = ({ initialSection }) => {
  const m = useManpower();
  const inventory = useInventory();
  const auth: any = useWalkie();
  const eventScope = useEventScope();
  const scopedEventId = eventScope.scopeFor('sewadars');
  const callingEvent = eventScope.events.find(event => event.id === scopedEventId);
  const orgId = auth.currentUser?.organizationId;
  const { sewadars, stats, canManage, loading, loadError } = m;
  const [tasks, setTasks] = useState<any[]>([]);
  const [workspace, setWorkspace] = useState<'members' | 'permanent' | 'teams' | 'tasks'>('members');
  const [memberSection, setMemberSection] = useState<MemberSection>('general');
  useEffect(() => {
    if (initialSection === 'calling') { setWorkspace('members'); setMemberSection('calling'); }
    else if (initialSection === 'tasks') setWorkspace('tasks');
    else if (initialSection === 'permanent') setWorkspace('permanent');
    else if (initialSection === 'teams') setWorkspace('teams');
    else if (initialSection === 'roster') { setWorkspace('members'); setMemberSection('general'); }
  }, [initialSection]);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDetails, setTaskDetails] = useState('');
  const [taskChecklist, setTaskChecklist] = useState('');
  const [taskTeam, setTaskTeam] = useState('');
  const [taskAssignee, setTaskAssignee] = useState('');
  const [taskMembers, setTaskMembers] = useState<string[]>([]);
  const [taskPriority, setTaskPriority] = useState<'immediately' | 'till_time' | 'as_you_have_time'>('as_you_have_time');
  const [taskPriorityUntil, setTaskPriorityUntil] = useState('');
  const [taskMemberQuery, setTaskMemberQuery] = useState('');
  const [taskPickerOpen, setTaskPickerOpen] = useState(false);
  const [taskMemberDraft, setTaskMemberDraft] = useState<string[]>([]);
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamLead, setNewTeamLead] = useState('');
  const [teamBusy, setTeamBusy] = useState(false);
  const [activeTeamId, setActiveTeamId] = useState('');
  const [expandedTeamIds, setExpandedTeamIds] = useState<Set<string>>(new Set());
  const [teamMemberSelection, setTeamMemberSelection] = useState<string[]>([]);
  const [teamMemberQuery, setTeamMemberQuery] = useState('');
  const [taskDue, setTaskDue] = useState('');
  const [taskDepartment, setTaskDepartment] = useState('');
  const [taskEventId, setTaskEventId] = useState('');
  const [taskEventFilter, setTaskEventFilter] = useState('all');
  const [taskDepartmentFilter, setTaskDepartmentFilter] = useState('all');
  const [calendarMonth, setCalendarMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [taskSelectedDate, setTaskSelectedDate] = useState(() => taskDateKey(new Date()));
  const [taskBusy, setTaskBusy] = useState(false);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [taskToDelete, setTaskToDelete] = useState<any | null>(null);
  const [deliveryTask, setDeliveryTask] = useState<any | null>(null);
  const [deliveryLocation, setDeliveryLocation] = useState('');
  const [deliveryReceivedBy, setDeliveryReceivedBy] = useState('');
  const [deliveryNote, setDeliveryNote] = useState('');
  const [taskResourceRows, setTaskResourceRows] = useState<any[]>([]);
  const [resourceModalTask, setResourceModalTask] = useState<any | null>(null);
  const [resourceItemId, setResourceItemId] = useState('');
  const [resourceLocationId, setResourceLocationId] = useState('');
  const [resourceQty, setResourceQty] = useState('1');
  const [resourceBusy, setResourceBusy] = useState(false);
  const [resourceReturnDrafts, setResourceReturnDrafts] = useState<Record<string, { good: string; damaged: string }>>({});
  // item id → what can be allocated (in store minus request and task reservations); null until loaded / migration_v85 missing.
  const [resourceAvailability, setResourceAvailability] = useState<Record<string, { inStock: number; reservedRequests: number; reservedTasks: number; available: number }> | null>(null);
  const [busyTaskIds, setBusyTaskIds] = useState<Set<string>>(new Set());
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
  const [arrivalDrafts, setArrivalDrafts] = useState<Record<string, { date: string; period: ArrivalTimeOfDay }>>({});
  const [importing, setImporting] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  useEffect(() => { setArrivalDrafts({}); if (scopedEventId) setTaskEventId(scopedEventId); }, [scopedEventId]);
  const [arrivalClock, setArrivalClock] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setArrivalClock(value => value + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const rosterBase = workspace === 'permanent' ? sewadars.filter(s => s.memberType === 'salary_based') : sewadars.filter(s => s.memberType !== 'salary_based' && (workspace !== 'members' || memberSection !== 'calling' || !callingEvent || callingEvent.event_type === 'annual' || !callingEvent.event_type || (callingEvent.event_type === 'monthly' && s.memberType === 'monthly') || (callingEvent.event_type === 'special' && (callingEvent.special_member_ids || []).includes(s.id))));
  const isRosterWorkspace = workspace === 'members' || workspace === 'permanent';
  const showExpectedArrival = workspace === 'members' && memberSection === 'calling';
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return rosterBase.filter(s => inStage(s, stage)
      && (workspace === 'permanent' || memberType === 'all' || s.memberType === memberType)
      && (dept === 'all' || (dept === 'none' ? !s.department : s.department === dept))
      && (!t || [s.name, s.phone, s.deviceRef, s.serialNo, s.batchNo, s.teamName, ...(s.teams || []), s.teamLead, s.villageCity, ...(s.skills || [])].some(v => v.toLowerCase().includes(t))));
  }, [rosterBase, stage, memberType, dept, q, workspace, arrivalClock]);
  const isTeamEligible = (person: Sewadar) => person.arrival === 'arrived' || (person.memberType === 'salary_based' && !!person.wentHomeAt && !person.returnedFromHomeAt);
  const normalizeName = (name: string) => name.trim().toLocaleLowerCase();
  const activeManpowerTasks = tasks.filter(task => task.source === 'manpower' && task.status !== 'complete');
  const busyMemberIds = new Set<string>(activeManpowerTasks.flatMap(task => task.member_ids || []));
  const busyMemberNames = new Set<string>(tasks.filter(task => task.status !== 'complete').flatMap(task => [task.assigned_to, ...(task.sewadar_names || [])].filter(Boolean).map((name: string) => normalizeName(name))));
  const isFreeForAssignment = (person: Sewadar) => isTeamEligible(person) && !busyMemberIds.has(person.id) && !busyMemberNames.has(normalizeName(person.name));
  const teamGroups = useMemo(() => m.teams.map(t => ({ ...t, members: sewadars.filter(s => (s.teams || []).some(name => name.toLocaleLowerCase() === t.name.toLocaleLowerCase())) })), [m.teams, sewadars]);
  const teamLeaderNames = new Set(teamGroups.map(team => normalizeName(team.lead)).filter(Boolean));
  const availableTaskMembers = sewadars.filter(person => isFreeForAssignment(person) && (!teamLeaderNames.has(normalizeName(person.name)) || (taskTeam && teamGroups.some(team => team.name === taskTeam && normalizeName(team.lead) === normalizeName(person.name)))));
  const availableLeaders = sewadars.filter(person => isFreeForAssignment(person) && !teamLeaderNames.has(normalizeName(person.name)));
  const arrivedTeamLeaders = sewadars.filter(person => person.arrival === 'arrived' && !teamLeaderNames.has(normalizeName(person.name)));
  const busyTeamNames = new Set(activeManpowerTasks.map(task => normalizeName(task.team || '')).filter(Boolean));
  const availableTeams = teamGroups.filter(team => !busyTeamNames.has(normalizeName(team.name)) && (!team.lead || !busyMemberNames.has(normalizeName(team.lead))) && (team.members.some(person => isFreeForAssignment(person)) || availableLeaders.some(person => normalizeName(person.name) === normalizeName(team.lead))));
  const activeTeam = teamGroups.find(team => team.id === activeTeamId);
  const eligibleTeamMembers = activeTeam ? sewadars.filter(person => person.arrival === 'arrived' && isFreeForAssignment(person) && (!teamLeaderNames.has(normalizeName(person.name)) || normalizeName(activeTeam.lead) === normalizeName(person.name)) && !(person.teams || []).some(name => name.toLowerCase() === activeTeam.name.toLowerCase())) : [];
  const visibleTeamMembers = eligibleTeamMembers.filter(person => person.name.toLowerCase().includes(teamMemberQuery.trim().toLowerCase()));
  const unassignedSewadars = sewadars.filter(s => s.arrival === 'arrived' && !teamLeaderNames.has(normalizeName(s.name)) && !(s.teams || []).length);
  const priorityRank: Record<string, number> = { immediately: 0, till_time: 1, as_you_have_time: 2 };
  // Sub-department Heads and Staff (outside Sewadars / Accommodation) see only their own sub-department's tasks.
  const lockedTaskDept: string | null = ['sub_dept_head', 'staff'].includes(auth.currentUser?.level) && auth.currentUser?.subDepartment && !['sewadars', 'accommodation'].includes(auth.currentUser.subDepartment) ? auth.currentUser.subDepartment : null;
  const scopedTasks = tasks.filter(task => (taskEventFilter === 'all' || task.event_id === taskEventFilter) && (lockedTaskDept ? task.department_id === lockedTaskDept : (taskDepartmentFilter === 'all' || (taskDepartmentFilter === 'none' ? !task.department_id : task.department_id === taskDepartmentFilter))));
  const todayTaskKey = taskDateKey(new Date());
  const pendingTaskCount = scopedTasks.filter(t => t.status !== 'complete').length;
  const todayTaskCount = scopedTasks.filter(t => t.status !== 'complete' && String(t.due_date || '').slice(0, 10) === todayTaskKey).length;
  const upcomingTaskCount = scopedTasks.filter(t => t.status !== 'complete' && String(t.due_date || '').slice(0, 10) > todayTaskKey).length;
  const overdueTaskCount = scopedTasks.filter(t => t.status !== 'complete' && !!t.due_date && String(t.due_date).slice(0, 10) < todayTaskKey).length;
  const completedTaskCount = scopedTasks.filter(t => t.status === 'complete').length;
  const visibleTasks = scopedTasks.filter(t => {
    const due = String(t.due_date || '').slice(0, 10);
    if (taskFilter === 'pending') return t.status !== 'complete';
    if (taskFilter === 'today') return t.status !== 'complete' && due === todayTaskKey;
    if (taskFilter === 'upcoming') return t.status !== 'complete' && due > todayTaskKey;
    if (taskFilter === 'overdue') return t.status !== 'complete' && !!due && due < todayTaskKey;
    if (taskFilter === 'completed') return t.status === 'complete';
    return true;
  }).sort((a, b) => Number(a.status === 'complete') - Number(b.status === 'complete') || (priorityRank[a.priority_level] ?? 2) - (priorityRank[b.priority_level] ?? 2) || String(a.priority_until || '').localeCompare(String(b.priority_until || '')) || String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')) || String(b.created_at).localeCompare(String(a.created_at)));
  const calendarDates = useMemo(() => {
    const first = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
    const mondayOffset = (first.getDay() + 6) % 7;
    const cellCount = Math.ceil((mondayOffset + new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0).getDate()) / 7) * 7;
    return Array.from({ length: cellCount }, (_, index) => new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), index - mondayOffset + 1));
  }, [calendarMonth]);
  const calendarTasks = useMemo(() => scopedTasks.filter(task => task.due_date), [scopedTasks]);
  const selectedDayTasks = scopedTasks.filter(task => String(task.due_date || '').slice(0, 10) === taskSelectedDate);
  const startTaskCreation = (date = '') => {
    setTaskTitle(''); setTaskDetails(''); setTaskChecklist(''); setTaskTeam(''); setTaskAssignee(''); setTaskMembers([]);
    setTaskDue(date); setTaskPriority('as_you_have_time'); setTaskPriorityUntil('');
    setTaskEventId(taskEventFilter !== 'all' ? taskEventFilter : scopedEventId || '');
    setTaskDepartment(taskDepartmentFilter !== 'all' && taskDepartmentFilter !== 'none' ? taskDepartmentFilter : '');
    setTaskMemberQuery(''); setTaskPickerOpen(false); setTaskDialogOpen(true);
  };
  const exportTasksToExcel = () => {
    const workbook = XLSX.utils.book_new();
    const taskRows = visibleTasks.map(task => ({
      'Task ID': task.id,
      Task: task.title,
      'Task type': task.parent_task_id ? 'Checklist step' : 'Task',
      'Parent task': scopedTasks.find(parent => parent.id === task.parent_task_id)?.title || '',
      Event: eventScope.events.find(event => event.id === task.event_id)?.name || 'General',
      Department: DEPT_LABEL[task.department_id] || task.department_id || '',
      Team: task.team || '',
      'Team ID': task.team_id || '',
      'Team lead': teamGroups.find(team => normalizeName(team.name) === normalizeName(task.team || ''))?.lead || '',
      'Assigned Sewadars': (task.sewadar_names || []).join(', '),
      Owner: task.assigned_to || '',
      Status: String(task.status || '').replace('_', ' '),
      Priority: task.priority_level === 'immediately' ? 'Immediate' : task.priority_level === 'till_time' ? 'Due by time' : 'As time allows',
      'Priority deadline': excelDate(task.priority_until),
      'Due date': excelDate(task.due_date),
      Details: task.details || '',
      Resources: resourcesForTask(task.id).map(resource => `${resource.inventory_items?.name || 'Item'} × ${resource.qty}`).join('; '),
      Created: excelDate(task.created_at),
    }));
    const resourceRows = visibleTasks.flatMap(task => resourcesForTask(task.id).map(resource => ({
      Task: task.title,
      Team: task.team || '',
      'Team lead': resource.team_leader || '',
      Resource: resource.inventory_items?.name || resource.item_id,
      Quantity: resource.qty,
      Location: inventory.locationLabel(resource.location),
      'Received by': resource.received_by || '',
      'Received at': resource.received_at || '',
      'Returned good': resource.returned_good_qty || 0,
      'Returned damaged': resource.returned_damaged_qty || 0,
      'Still with team': resourceWithTeam(resource),
      'Return status': resource.returned_at ? 'Returned' : resource.received_at ? 'Return pending' : 'Awaiting receipt',
    })));
    const taskSheet = XLSX.utils.json_to_sheet(taskRows.length ? taskRows : [{ Note: 'No tasks match the current filters.' }]);
    taskSheet['!cols'] = [{ wch: 25 }, { wch: 34 }, { wch: 16 }, { wch: 28 }, { wch: 24 }, { wch: 20 }, { wch: 24 }, { wch: 32 }, { wch: 28 }, { wch: 32 }, { wch: 24 }, { wch: 16 }, { wch: 18 }, { wch: 22 }, { wch: 16 }, { wch: 48 }, { wch: 42 }, { wch: 20 }];
    taskSheet['!autofilter'] = { ref: taskSheet['!ref'] || 'A1' };
    const taskHeader = taskRows.length ? Object.keys(taskRows[0]) : [];
    ['Priority deadline', 'Due date', 'Created'].forEach(name => {
      const col = taskHeader.indexOf(name);
      const range = XLSX.utils.decode_range(taskSheet['!ref'] || 'A1');
      for (let row = 1; row <= range.e.r; row += 1) {
        const cell = taskSheet[XLSX.utils.encode_cell({ r: row, c: col })];
        if (cell && cell.v !== '') cell.z = name === 'Due date' ? 'dd-mmm-yyyy' : 'dd-mmm-yyyy hh:mm';
      }
    });
    const resourceSheet = XLSX.utils.json_to_sheet(resourceRows.length ? resourceRows : [{ Note: 'No resources allocated to matching tasks.' }]);
    resourceSheet['!cols'] = [{ wch: 32 }, { wch: 24 }, { wch: 24 }, { wch: 28 }, { wch: 12 }, { wch: 24 }, { wch: 24 }, { wch: 22 }, { wch: 16 }, { wch: 18 }, { wch: 16 }, { wch: 20 }];
    resourceSheet['!autofilter'] = { ref: resourceSheet['!ref'] || 'A1' };
    XLSX.utils.book_append_sheet(workbook, taskSheet, 'Tasks');
    XLSX.utils.book_append_sheet(workbook, resourceSheet, 'Task resources');
    XLSX.writeFile(workbook, `task-register-${taskDateKey(new Date())}.xlsx`);
  };
  const resourcesForTask = (taskId: string) => taskResourceRows.filter(resource => resource.task_id === taskId);
  // Units the team still holds: received, minus everything returned (good or damaged).
  const resourceWithTeam = (resource: any) => resource.received_at ? Math.max(0, resource.qty - resource.returned_good_qty - resource.returned_damaged_qty) : 0;
  const resourceLeftover = (taskId: string) => resourcesForTask(taskId).filter(resource => resourceWithTeam(resource) > 0)
    .map(resource => `${resourceWithTeam(resource)} ${resource.inventory_items?.unit || 'units'} ${resource.inventory_items?.name || 'item'}`);
  const reloadResourceAvailability = async () => {
    const { data, error } = await supabase.rpc('inventory_availability');
    if (error) { setResourceAvailability(null); return; }
    setResourceAvailability(Object.fromEntries((data || []).map((row: any) => [row.item_id, { inStock: row.in_stock, reservedRequests: row.reserved_requests, reservedTasks: row.reserved_tasks, available: row.available }])));
  };
  const availableFor = (item: { id: string; inStock: number }) => resourceAvailability?.[item.id]?.available ?? item.inStock;
  const canHandleTaskResources = (task: any) => canManage || !!teamGroups.find(team => normalizeName(team.name) === normalizeName(task.team || '') && normalizeName(team.lead) === normalizeName(auth.currentUser?.name || ''));
  const reloadTaskResources = async () => {
    const { data, error } = await supabase.from('manpower_task_resources').select('*, inventory_items(name,unit)').order('created_at', { ascending: true });
    if (!error) setTaskResourceRows(data || []);
    return { data, error };
  };

  const loadTasks = async () => {
    if (!orgId) return;
    const [{ data: manpowerRows, error: manpowerError }, { data: memberRows, error: memberError }, { data: taskMemberRows }, { data: resourceRows, error: resourceError }] = await Promise.all([
      supabase.from('manpower_tasks').select('*, accommodation_members(name)').order('created_at', { ascending: false }),
      supabase.from('accommodation_member_tasks').select('*, accommodation_members(name)').order('created_at', { ascending: false }),
      supabase.from('manpower_task_members').select('task_id,member_id,accommodation_members(name)'),
      supabase.from('manpower_task_resources').select('*, inventory_items(name,unit)').order('created_at', { ascending: true }),
    ]);
    if (!resourceError) setTaskResourceRows(resourceRows || []);
    if (!manpowerError || !memberError) {
      const linkedNames = new Map<string, string[]>();
      const linkedIds = new Map<string, string[]>();
      (taskMemberRows || []).forEach((link: any) => { linkedNames.set(link.task_id, [...(linkedNames.get(link.task_id) || []), link.accommodation_members?.name].filter(Boolean)); linkedIds.set(link.task_id, [...(linkedIds.get(link.task_id) || []), link.member_id]); });
      setTasks([
      ...(manpowerRows || []).map((t: any) => ({ ...t, source: 'manpower', assigned_to: t.accommodation_members?.name || t.assigned_to, member_ids: Array.from(new Set(linkedIds.get(t.id) || (t.member_id ? [t.member_id] : []))), sewadar_names: Array.from(new Set(linkedNames.get(t.id) || (t.accommodation_members?.name ? [t.accommodation_members.name] : []))) })),
      ...(memberRows || []).map((t: any) => ({ ...t, source: 'accommodation', team: 'Accommodation', assigned_to: t.accommodation_members?.name || t.assigned_to })),
      ].sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at))));
    }
  };
  useEffect(() => {
    loadTasks();
    if (!orgId) return;
    const channel = supabase.channel(`manpower-tasks-${orgId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'manpower_tasks', filter: `organization_id=eq.${orgId}` }, loadTasks)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'manpower_task_members', filter: `organization_id=eq.${orgId}` }, loadTasks)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'manpower_task_resources', filter: `organization_id=eq.${orgId}` }, loadTasks)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'accommodation_member_tasks', filter: `organization_id=eq.${orgId}` }, loadTasks).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [orgId]); // eslint-disable-line
  const saveTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskTitle.trim() || !orgId) return;
    if (taskPriority === 'till_time' && !taskPriorityUntil) { auth.addToast?.('Specify the time for this task priority.', 'error'); return; }
    const selectedTeam = teamGroups.find(team => team.name === taskTeam);
    if (taskTeam && !selectedTeam) { auth.addToast?.('Choose a team from the current Sewadar team register.', 'error'); return; }
    if (taskMembers.some(id => !availableTaskMembers.some(person => person.id === id))) { auth.addToast?.('One or more selected Sewadars are no longer available.', 'error'); return; }
    setTaskBusy(true);
    const assignee = canManage ? taskAssignee.trim() : (auth.currentUser?.name || '');
    const ownerIsTeamLeader = teamLeaderNames.has(normalizeName(assignee));
    if (assignee && busyMemberNames.has(normalizeName(assignee))) { setTaskBusy(false); auth.addToast?.('That person is already assigned to an active task.', 'error'); return; }
    if (ownerIsTeamLeader && (!selectedTeam || normalizeName(selectedTeam.lead) !== normalizeName(assignee))) { setTaskBusy(false); auth.addToast?.('A team leader can only be assigned through their own team.', 'error'); return; }
    const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const { error } = await supabase.from('manpower_tasks').insert({
      id: taskId, organization_id: orgId, parent_task_id: null, meeting_id: null, resources: '', team_id: selectedTeam?.id || null,
      title: taskTitle.trim(), details: taskDetails.trim(), team: taskTeam.trim(), assigned_to: assignee,
      priority_level: taskPriority, priority_until: taskPriority === 'till_time' ? new Date(taskPriorityUntil).toISOString() : null,
      member_id: taskMembers[0] || null, sewadar_id: null, due_date: taskDue || null, event_id: taskEventId || null, department_id: taskDepartment || null, created_by: auth.currentUser?.id,
    });
    if (error) { setTaskBusy(false); auth.addToast?.(/team_id|schema cache/i.test(error.message) ? `${error.message} — run supabase/migration_v84_task_team_links.sql, then reload the app.` : /priority_level|priority_until/i.test(error.message) ? `${error.message} — run supabase/migration_v66_team_task_priority.sql, then reload the app.` : /row-level security|permission denied/i.test(error.message) ? `${error.message} — run supabase/migration_v83_manpower_task_assignment_access.sql, then reload the app.` : `Could not create task: ${error.message}`, 'error'); return; }
    const checklist = taskChecklist.split('\n').map(title => title.trim()).filter(Boolean);
    if (checklist.length) {
      const { error: checklistError } = await supabase.from('manpower_tasks').insert(checklist.map(title => ({ id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, organization_id: orgId, event_id: taskEventId || null, parent_task_id: taskId, meeting_id: null, department_id: taskDepartment || null, title, details: '', resources: '', team: taskTeam.trim(), team_id: selectedTeam?.id || null, assigned_to: assignee, priority_level: taskPriority, priority_until: taskPriority === 'till_time' ? new Date(taskPriorityUntil).toISOString() : null, due_date: taskDue || null, created_by: auth.currentUser?.id, status: 'todo' })));
      if (checklistError) auth.addToast?.(`Task saved, but its checklist could not be saved: ${checklistError.message}`, 'error');
    }
    if (taskMembers.length) {
      const links = taskMembers.map(member_id => ({ id: `task-member-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, organization_id: orgId, task_id: taskId, member_id }));
      const { error: linkError } = await supabase.from('manpower_task_members').insert(links);
      if (linkError) auth.addToast?.(`Task created, but Sewadars could not be linked: ${linkError.message}${/row-level security|permission denied/i.test(linkError.message) ? ' — run supabase/migration_v83_manpower_task_assignment_access.sql, then reload the app.' : ''}`, 'error');
    }
    setTaskBusy(false);
    setTaskTitle(''); setTaskDetails(''); setTaskChecklist(''); setTaskTeam(''); setTaskAssignee(''); setTaskMembers([]); setTaskDue(''); setTaskPriority('as_you_have_time'); setTaskPriorityUntil('');
    setTaskMemberQuery(''); setTaskPickerOpen(false);
    await loadTasks();
    setTaskDialogOpen(false);
  };
  const openTaskResources = async (task: any) => {
    setResourceModalTask(task); setResourceItemId(''); setResourceQty('1'); setResourceReturnDrafts({});
    const [{ error }] = await Promise.all([reloadTaskResources(), reloadResourceAvailability()]);
    if (error) auth.addToast?.(`${error.message} — run supabase/migration_v67_task_resource_handoffs.sql, then reload the app.`, 'error');
  };
  const allocateTaskResource = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!resourceModalTask || !resourceItemId || !resourceLocationId) return;
    setResourceBusy(true);
    const { error } = await supabase.rpc('manpower_task_add_resource', { p_task_id: resourceModalTask.id, p_item_id: resourceItemId, p_location: resourceLocationId, p_qty: Number(resourceQty) });
    setResourceBusy(false);
    if (error) { auth.addToast?.(`${error.message}${/function|schema cache/i.test(error.message) ? ' — run supabase/migration_v67_task_resource_handoffs.sql, then reload the app.' : /row-level security|permission denied|cannot allocate task resources/i.test(error.message) ? ' — run supabase/migration_v83_manpower_task_assignment_access.sql, then reload the app.' : ''}`, 'error'); await reloadResourceAvailability(); return; }
    setResourceItemId(''); setResourceQty('1'); await Promise.all([reloadTaskResources(), reloadResourceAvailability()]);
    auth.addToast?.('Resource allocated and reserved. The team leader can confirm receipt.', 'success');
  };
  const confirmResourceReceipt = async (resource: any) => {
    setResourceBusy(true);
    const { error } = await supabase.rpc('manpower_task_receive_resource', { p_resource_id: resource.id });
    setResourceBusy(false);
    if (error) { auth.addToast?.(`Could not confirm receipt: ${error.message}${/reserved for approved requests/i.test(error.message) && !/other tasks/i.test(error.message) ? ' — run supabase/migration_v85_task_resource_reservations.sql so allocations reserve stock.' : ''}`, 'error'); return; }
    await Promise.all([reloadTaskResources(), reloadResourceAvailability()]); auth.addToast?.(`Receipt recorded for ${resource.team_leader}.`, 'success');
  };
  const cancelResourceAllocation = async (resource: any) => {
    setResourceBusy(true);
    const { error } = await supabase.rpc('manpower_task_cancel_resource', { p_resource_id: resource.id });
    setResourceBusy(false);
    if (error) { auth.addToast?.(`Could not cancel allocation: ${error.message}${/function|schema cache/i.test(error.message) ? ' — run supabase/migration_v85_task_resource_reservations.sql, then reload the app.' : ''}`, 'error'); return; }
    await Promise.all([reloadTaskResources(), reloadResourceAvailability()]); auth.addToast?.('Allocation cancelled. The stock is free again.', 'success');
  };
  const recordResourceReturn = async (resource: any) => {
    const remaining = resource.qty - resource.returned_good_qty - resource.returned_damaged_qty;
    const draft = resourceReturnDrafts[resource.id] || { good: String(remaining), damaged: '0' };
    setResourceBusy(true);
    const { error } = await supabase.rpc('manpower_task_return_resource', { p_resource_id: resource.id, p_good_qty: Number(draft.good) || 0, p_damaged_qty: Number(draft.damaged) || 0 });
    setResourceBusy(false);
    if (error) { auth.addToast?.(`Could not record resource return: ${error.message}`, 'error'); return; }
    await Promise.all([reloadTaskResources(), reloadResourceAvailability()]); auth.addToast?.(`Return recorded by ${resource.team_leader}.`, 'success');
  };
  const setTaskStatus = async (t: any, status: string) => {
    if (status === 'complete' && t.source === 'manpower' && resourcesForTask(t.id).some(resource => !resource.received_at)) {
      auth.addToast?.('Confirm receipt of all allocated resources with the team leader before completing this task.', 'warning'); return;
    }
    if (status === 'complete' && t.request_fulfilment_id) {
      setDeliveryTask(t); setDeliveryLocation(''); setDeliveryReceivedBy(auth.currentUser?.name || ''); setDeliveryNote('');
      return;
    }
    const table = t.source === 'accommodation' ? 'accommodation_member_tasks' : 'manpower_tasks';
    const oldStatus = t.status;
    setBusyTaskIds(current => new Set(current).add(t.id));
    setTasks(current => current.map(task => task.id === t.id ? { ...task, status } : task));
    const { error } = await supabase.from(table).update({ status, updated_at: new Date().toISOString() }).eq('id', t.id);
    if (error) { setTasks(current => current.map(task => task.id === t.id ? { ...task, status: oldStatus } : task)); auth.addToast?.(`Could not update task: ${error.message}`, 'error'); }
    else await loadTasks();
    setBusyTaskIds(current => { const next = new Set(current); next.delete(t.id); return next; });
  };
  const completeDeliveryTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deliveryTask) return;
    setBusyTaskIds(current => new Set(current).add(deliveryTask.id));
    const { error } = await supabase.rpc('request_complete_delivery_task', {
      p_task: deliveryTask.id, p_location: deliveryLocation, p_received_by: deliveryReceivedBy.trim(), p_note: deliveryNote.trim(),
    });
    if (error) auth.addToast?.(`Could not complete delivery: ${error.message}`, 'error');
    else { auth.addToast?.('Delivery recorded and request updated.', 'success'); setDeliveryTask(null); await loadTasks(); }
    setBusyTaskIds(current => { const next = new Set(current); next.delete(deliveryTask.id); return next; });
  };
  const deleteTask = async (t: any) => {
    if (t.source !== 'manpower' || !canManage) return;
    if (resourcesForTask(t.id).some(resource => resource.received_at && resource.returned_good_qty + resource.returned_damaged_qty < resource.qty)) { auth.addToast?.('Return all issued task resources before removing this task.', 'warning'); return; }
    setTaskToDelete(t);
  };
  const confirmDeleteTask = async () => {
    const t = taskToDelete;
    if (!t) return;
    const { error } = await supabase.from('manpower_tasks').delete().eq('id', t.id);
    if (error) auth.addToast?.(`Could not remove task: ${error.message}`, 'error');
    else { auth.addToast?.('Task removed.', 'success'); await loadTasks(); }
    setTaskToDelete(null);
  };

  useEffect(() => { setPage(0); }, [stage, memberType, dept, q, size]);
  useEffect(() => { setStage('all'); setPage(0); setSel(new Set()); }, [memberSection]);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const view = rows.slice(page * size, page * size + size);
  const allOnPage = view.length > 0 && view.every(s => sel.has(s.id));
  const toggle = (id: string) => setSel(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const togglePage = () => setSel(p => { const n = new Set(p); view.forEach(s => (allOnPage ? n.delete(s.id) : n.add(s.id))); return n; });
  const ids = Array.from(sel);

  const exportCSV = () => {
    const includeCallFields = workspace === 'members' && memberSection === 'calling';
    const includeArrivalSchedule = workspace === 'members' && memberSection === 'calling';
    const head = ['Name', 'Member type', 'Serial no.', 'Badge no.', 'Relation', 'Relation name', 'Mobile', 'Village / city', 'Branch', 'Occupation', 'Sub-department', 'Remarks', 'Employee code', 'Employee ID', 'Address', 'Address 2', ...(includeArrivalSchedule ? ['Expected arrival date', 'Arrival time'] : []), 'Skills', 'Teams', 'Team lead', 'Device', 'Device ID', ...(includeCallFields ? ['Calls', 'Last call outcome', 'Last call at'] : []), 'Arrival', 'Arrived at', 'Badge'];
    const body = rows.map(s => [s.name, s.memberType === 'salary_based' ? 'permanent' : s.memberType === 'monthly' ? 'regular' : s.memberType, s.serialNo, s.batchNo, s.relation, s.relationName, s.phone, s.villageCity, s.branch, s.occupation, DEPT_LABEL[s.department] || s.department, s.remarks, s.employeeCode, s.employeeId, s.address, s.address2, ...(includeArrivalSchedule ? [s.memberType === 'salary_based' ? '' : s.expectedArrival, s.memberType === 'salary_based' ? '' : s.expectedArrivalPeriod] : []), (s.skills || []).join('; '), (s.teams || []).join('; '), s.teamLead, DEVICE_LABEL[s.deviceType], s.deviceRef, ...(includeCallFields ? [s.callCount, s.lastCallOutcome ? OUTCOME_LABEL[s.lastCallOutcome] : '', s.lastCallAt || ''] : []), s.arrival, s.arrivedAt || '', s.badgeReturned ? 'Returned' : s.badgeIssued ? 'Issued' : 'Pending']);
    const csv = [head, ...body].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `sewadars_${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };

  const statusCounts: Record<Stage, number> = {
    all: stats.total, toCall: stats.toCall, awaiting: stats.awaiting, arrived: stats.arrived,
    badge: stats.badgePending, notComing: stats.notComing,
    overdue: rows.filter(s => isArrivalOverdue(s, new Date())).length,
  };

  const editedMember = editing && editing !== 'new' ? sewadars.find(s => s.id === editing.id) || editing : null;
  if (editedMember) return <>
    <SewadarForm key={editedMember.id} initial={editedMember} teams={teamGroups} fullPage onClose={() => setEditing(null)}
      onSave={i => m.update(editedMember.id, i)} onDelete={() => m.remove([editedMember.id])}
      onSetArrival={arrival => m.setArrival([editedMember.id], arrival)} onSetBadge={issued => m.setBadge([editedMember.id], issued)} onSetBadgeReturned={returned => m.setBadgeReturned([editedMember.id], returned)}
      onCallHistory={() => setCalling(editedMember)} />
    {calling && <CallModal s={calling} onClose={() => setCalling(null)} />}
  </>;

  return (
    <div className="space-y-3">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold tracking-tight flex items-center gap-2">{workspace === 'tasks' ? <ListTodo className="h-4 w-4 text-blue-400" /> : <Users className="h-4 w-4 text-blue-400" />}{workspace === 'tasks' ? 'Tasks' : workspace === 'permanent' ? 'IT Department Permanent Staff' : 'Sewadar Master'}</h1>
          <p className="text-xs text-mute">{workspace === 'tasks' ? 'Plan and track work across events and departments.' : workspace === 'permanent' ? 'IT Department permanent staff records · contact, teams and devices' : 'Shared member records · contact, type, teams and devices'}</p>
        </div>
        {isRosterWorkspace && <div className="flex flex-wrap gap-2">
          <button className={cx(btnGhost(D), 'px-2.5 py-1.5 text-xs')} onClick={exportCSV}><Download className="w-3.5 h-3.5" />Export</button>
          {canManage && <button className={cx(btnGhost(D), 'px-2.5 py-1.5 text-xs')} onClick={() => setImporting(true)}><Upload className="w-3.5 h-3.5" />Import</button>}
          {canManage && <button className={cx(btnPrimary, 'px-2.5 py-1.5 text-xs')} onClick={() => setEditing('new')}><Plus className="w-3.5 h-3.5" />Add {workspace === 'permanent' ? 'permanent member' : 'member'}</button>}
        </div>}
      </div>

      {loadError && <div role="alert" className="rounded-xl border border-rose-500/40 bg-rose-500/10 text-rose-400 text-sm p-3">Could not load Sewadars: {loadError}</div>}

      {workspace === 'teams' && <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2"><div><h2 className="text-lg font-semibold text-ink">Teams</h2><p className="text-sm text-mute">Create reusable teams and link each Sewadar to one or more teams.</p></div><span className="text-xs text-mute">{teamGroups.length} teams · {sewadars.length} sewadars · {unassignedSewadars.length} unassigned</span></div>
        {canManage && <form onSubmit={async e => { e.preventDefault(); setTeamBusy(true); const ok = await m.createTeam(newTeamName, newTeamLead); setTeamBusy(false); if (ok) { setNewTeamName(''); setNewTeamLead(''); } }} className={cx(panel, 'grid gap-2 p-2 sm:grid-cols-[1fr_1fr_auto]')}>
          <label className="text-[11.5px] text-mute">Predefined team<input required value={newTeamName} onChange={e => setNewTeamName(e.target.value)} placeholder="e.g. Gate support" className={cx(inputCls(D), 'mt-1 h-9')} /></label>
          <label className="text-[11.5px] text-mute">Team lead<select value={newTeamLead} onChange={e => setNewTeamLead(e.target.value)} className={cx(inputCls(D), 'mt-1 h-9')}><option value="">Optional</option>{arrivedTeamLeaders.map(person => <option key={person.id} value={person.name}>{person.name}{memberMeta(person) ? ` · ${memberMeta(person)}` : ''}</option>)}</select></label>
          <button disabled={teamBusy} className={cx(btnPrimary, 'self-end py-2 text-xs')}>{teamBusy ? 'Creating…' : <><Plus className="h-3.5 w-3.5" />Create team</>}</button>
        </form>}
        {teamGroups.length || sewadars.length ? <div className="grid gap-2 xl:grid-cols-2">{teamGroups.map(team => <section key={team.name.toLowerCase()} className={cx(panel, 'animate-fade-in overflow-hidden')}>
          <header className="flex items-start justify-between gap-2 border-b border-line px-3 py-2"><button type="button" aria-expanded={expandedTeamIds.has(team.id)} aria-controls={`team-members-${team.id}`} onClick={() => setExpandedTeamIds(current => { const next = new Set(current); next.has(team.id) ? next.delete(team.id) : next.add(team.id); return next; })} className="flex min-w-0 flex-1 items-start gap-2 text-left"><ChevronDown className={cx('mt-0.5 h-4 w-4 shrink-0 text-mute transition-transform', expandedTeamIds.has(team.id) && 'rotate-180')} /><span className="min-w-0"><span className="block truncate text-sm font-semibold text-ink">{team.name}</span><span className="mt-0.5 block text-[10.5px] text-mute">{team.lead ? `Team lead · ${team.lead}` : 'Team lead not set'}{busyTeamNames.has(normalizeName(team.name)) ? ' · Active task' : ''}</span></span></button><div className="flex shrink-0 items-center gap-1.5"><span className="rounded-full bg-blue-500/10 px-2 py-1 text-[10.5px] font-semibold text-blue-300">{team.members.length} {team.members.length === 1 ? 'member' : 'members'}</span>{canManage && <button type="button" disabled={busyTeamNames.has(normalizeName(team.name))} title={busyTeamNames.has(normalizeName(team.name)) ? 'This team is assigned to an active task' : 'Add members'} className={cx(btnGhost(D), 'px-2 py-1 text-[10.5px] text-blue-300 disabled:cursor-not-allowed disabled:opacity-40')} onClick={() => { setActiveTeamId(team.id); setTeamMemberSelection([]); setTeamMemberQuery(''); }}><UserPlus className="h-3 w-3" />Add</button>}</div></header>
          {expandedTeamIds.has(team.id) && <ul id={`team-members-${team.id}`} aria-label={`${team.name} members; scroll to remove or contact members`} className="max-h-48 divide-y divide-line overflow-y-auto overscroll-contain">{team.members.map(person => <li key={person.id} className="animate-fade-in flex flex-wrap items-center gap-2 px-3 py-1.5"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-raised text-[10.5px] font-semibold text-ink-soft">{person.name.trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase()}</span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium text-ink">{person.name}</span><span className="block truncate text-[10.5px] text-mute">{[person.phone, DEPT_LABEL[person.department] || person.department, memberMeta(person)].filter(Boolean).join(' · ')}</span></span><span className={cx('rounded-full px-1.5 py-0.5 text-[10px]', person.arrival === 'arrived' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-raised text-mute')}>{person.arrival === 'arrived' ? 'Arrived' : 'Unavailable'}</span>{canManage && <button type="button" className={cx(btnGhost(D), 'gap-1 px-1.5 py-1 text-[10.5px] text-rose-300')} onClick={() => void m.removeFromTeam(person.id, team.name)} aria-label={`Remove ${person.name} from ${team.name}`} title="Remove from team"><UserMinus className="h-3 w-3" /><span>Remove</span></button>}<div className="flex gap-1"><button className={cx(btnGhost(D), 'p-1.5')} onClick={() => setCalling(person)} aria-label={`Call ${person.name}`}><PhoneCall className="h-3 w-3" /></button>{canManage && <button className={cx(btnGhost(D), 'p-1.5')} onClick={() => setEditing(person)} aria-label={`Edit ${person.name}`}><Edit3 className="h-3 w-3" /></button>}</div></li>)}</ul>}
        </section>)}
          {unassignedSewadars.length > 0 && <section className={cx(panel, 'overflow-hidden')}>
            <header className="flex items-start justify-between gap-2 border-b border-line px-3 py-2"><div><h3 className="text-sm font-semibold text-ink">Unassigned sewadars</h3><p className="mt-0.5 text-[10.5px] text-mute">Eligible roster members with no team yet.</p></div><span className="rounded-full bg-amber-500/10 px-2 py-1 text-[10.5px] font-semibold text-amber-300">{unassignedSewadars.length}</span></header>
            <ul className="divide-y divide-line">{unassignedSewadars.map(person => <li key={person.id} className="flex flex-wrap items-center gap-2 px-3 py-1.5"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-raised text-[10.5px] font-semibold text-ink-soft">{person.name.trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase()}</span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium text-ink">{person.name}</span><span className="block truncate text-[10.5px] text-mute">{[person.phone, DEPT_LABEL[person.department] || person.department, memberMeta(person)].filter(Boolean).join(' · ') || 'No contact details'}{person.memberType === 'salary_based' && person.arrival !== 'arrived' ? ' · Permanent · away' : ''}</span></span>
              {canManage && teamGroups.length > 0 && <select aria-label={`Assign ${person.name} to a team`} defaultValue="" onChange={e => { const selected = teamGroups.find(t => t.name === e.target.value); if (selected) void m.setTeam([person.id], selected.name, selected.lead); e.currentTarget.value = ''; }} className={rosterSelect}><option value="">Assign to team…</option>{teamGroups.filter(team => !busyTeamNames.has(normalizeName(team.name))).map(team => <option key={team.id} value={team.name}>{team.name} · {team.members.length} members</option>)}</select>}
              <div className="flex gap-1"><button className={btnGhost(D)} onClick={() => setCalling(person)} aria-label={`Call ${person.name}`}><PhoneCall className="h-3.5 w-3.5" /></button>{canManage && <button className={btnGhost(D)} onClick={() => setEditing(person)} aria-label={`Edit ${person.name}`}><Edit3 className="h-3.5 w-3.5" /></button>}</div>
            </li>)}</ul>
          </section>}
        </div> : <div className={cx(panel, 'p-10 text-center')}><Users className="mx-auto mb-3 h-7 w-7 text-faint" /><h3 className="font-semibold text-ink">No sewadars in the shared roster yet</h3><p className="mt-1 text-sm text-mute">Add members in the Members tab first. They will appear here automatically.</p><button onClick={() => setWorkspace('members')} className={cx(btnPrimary, 'mt-4')}><Users className="h-4 w-4" />Open members</button></div>}
      </section>}

      {workspace === 'tasks' && <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-end gap-2"><button type="button" className={cx(btnPrimary, 'rounded-lg px-3 py-2 text-xs')} onClick={() => startTaskCreation(taskSelectedDate)}><Plus className="h-4 w-4" />Schedule task</button></div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">{([['all','All tasks',scopedTasks.length,'text-ink'],['pending','Pending',pendingTaskCount,'text-amber-300'],['today','Scheduled today',todayTaskCount,'text-blue-300'],['upcoming','Upcoming',upcomingTaskCount,'text-cyan-300'],['overdue','Overdue',overdueTaskCount,'text-rose-300'],['completed','Completed',completedTaskCount,'text-emerald-300']] as [TaskFilter,string,number,string][]).map(([key,label,count,tone])=><button key={key} type="button" aria-pressed={taskFilter===key} onClick={()=>setTaskFilter(key)} className={cx('rounded-lg border px-3 py-2 text-left transition-colors',taskFilter===key?'border-blue-500/50 bg-blue-500/10':'border-line bg-surface/60 hover:bg-raised')}><span className="block text-[10.5px] font-medium text-mute">{label}</span><span className={cx('mt-0.5 block text-lg font-semibold tabular-nums',tone)}>{count}</span></button>)}</div>
        <div className={cx(panel, 'overflow-hidden')}>
        <div className="flex flex-col gap-3 border-b border-line px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div><h2 className="flex items-center gap-2 text-base font-semibold"><ListTodo className="h-4 w-4 text-blue-400" />Tasks</h2><p className="mt-1 text-xs text-mute">One place for event, department, team, and room work. Select a future date in Calendar to schedule it.</p></div>
          <div className="text-[10.5px] text-mute">Select a date to review its schedule. The full task list stays below.</div>
        </div>
        <div className="grid gap-2 border-b border-line px-4 py-3 sm:grid-cols-2"><label className="text-[10.5px] font-medium text-mute">Event<select value={taskEventFilter} onChange={e => setTaskEventFilter(e.target.value)} className={cx(inputCls(D), 'mt-1 h-9 w-full')}><option value="all">All events and general tasks</option>{eventScope.events.map(event => <option key={event.id} value={event.id}>{event.name}</option>)}</select></label><label className="text-[10.5px] font-medium text-mute">Sub-department<select disabled={!!lockedTaskDept} value={lockedTaskDept || taskDepartmentFilter} onChange={e => setTaskDepartmentFilter(e.target.value)} className={cx(inputCls(D), 'mt-1 h-9 w-full')}><option value="all">All sub-departments</option>{DEPT_OPTIONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}<option value="none">No sub-department assigned</option></select></label></div>
        {taskDialogOpen && <Modal dark={D} title="Allocate task" xl onClose={() => setTaskDialogOpen(false)}><form onSubmit={saveTask} className="animate-slide-up space-y-4">
          <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-2 xl:grid-cols-12">
            <label className="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-mute md:col-span-1 xl:col-span-4">Task name<input required value={taskTitle} onChange={e => setTaskTitle(e.target.value)} placeholder="e.g. Prepare welcome desk" className={cx(inputCls(D), 'h-10 w-full')} /></label>
            <label className="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-mute md:col-span-1 xl:col-span-4">Event<select value={taskEventId} onChange={e => setTaskEventId(e.target.value)} className={cx(inputCls(D), 'h-10 w-full')}><option value="">General task (no event)</option>{eventScope.events.map(event => <option key={event.id} value={event.id}>{event.name}</option>)}</select></label>
            <label className="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-mute md:col-span-1 xl:col-span-4">Sub-department<select value={taskDepartment} onChange={e => setTaskDepartment(e.target.value)} className={cx(inputCls(D), 'h-10 w-full')}><option value="">Choose a sub-department</option>{DEPT_OPTIONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label className="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-mute md:col-span-1 xl:col-span-4">Team<select value={taskTeam} onChange={e => { const name = e.target.value; setTaskTeam(name); const team = teamGroups.find(t => t.name === name); const lead = team && sewadars.find(person => normalizeName(person.name) === normalizeName(team.lead)); const memberIds = team ? team.members.filter(isFreeForAssignment).map(person => person.id) : []; if (team && lead && isFreeForAssignment(lead) && memberIds.indexOf(lead.id) < 0) memberIds.push(lead.id); setTaskMembers(memberIds); }} className={cx(inputCls(D), 'h-10 w-full')}><option value="">Choose a team</option>{teamGroups.map(team => { const availableCount = team.members.filter(isFreeForAssignment).length; return <option key={team.id} value={team.name}>{team.name} · {availableCount} available{busyTeamNames.has(normalizeName(team.name)) ? ' · already has active task' : ''}</option>; })}</select><span className="text-[10.5px] font-normal text-faint">All registered teams are available. Available Sewadars are selected automatically.</span></label>
            <label className="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-mute md:col-span-1 xl:col-span-4">Due date<input type="date" value={taskDue} onChange={e => setTaskDue(e.target.value)} className={cx(inputCls(D), 'h-10 w-full')} /></label>
            <label className="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-mute md:col-span-1 xl:col-span-4">Priority<select value={taskPriority} onChange={e => setTaskPriority(e.target.value as typeof taskPriority)} className={cx(inputCls(D), 'h-10 w-full')}><option value="immediately">Immediately</option><option value="till_time">Till the time</option><option value="as_you_have_time">As you have time</option></select></label>
            {taskPriority === 'till_time' && <label className="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-mute md:col-span-1 xl:col-span-4">Complete by<input required type="datetime-local" value={taskPriorityUntil} onChange={e => setTaskPriorityUntil(e.target.value)} className={cx(inputCls(D), 'h-10 w-full')} /></label>}
            <div className="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-mute md:col-span-1 xl:col-span-4"><span>Task owner</span>{canManage ? <input value={taskAssignee} onChange={e => setTaskAssignee(e.target.value)} placeholder="Name (optional)" className={cx(inputCls(D), 'h-10 w-full')} /> : <div className="flex h-10 items-center rounded-md border border-line bg-field px-3 text-sm text-ink-soft">{auth.currentUser?.name || 'Current user'}</div>}</div>
            <div className="min-w-0 md:col-span-1 xl:col-span-8"><span className="mb-1.5 block text-xs font-medium text-mute">Assign Sewadars <span className="ml-1 rounded-full bg-blue-500/15 px-2 py-0.5 text-[10.5px] text-blue-300">{taskMembers.length} selected</span></span><button type="button" onClick={() => { setTaskMemberQuery(''); setTaskMemberDraft(taskMembers); setTaskPickerOpen(true); }} className={cx(inputCls(D), 'flex min-h-11 items-center justify-between gap-2 text-left')}><span className="truncate">{taskMembers.length ? taskMembers.map(id => sewadars.find(person => person.id === id)?.name).filter(Boolean).join(', ') : 'Choose Sewadars'}</span><Users className="h-4 w-4 shrink-0 text-mute" /></button></div>
            <label className="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-mute md:col-span-2 xl:col-span-9"><span>Task details <span className="font-normal text-faint">· optional</span></span><textarea value={taskDetails} onChange={e => setTaskDetails(e.target.value)} placeholder="Add instructions or useful context…" rows={2} className={cx(inputCls(D), 'min-h-[72px] w-full resize-y')} /></label>
            <div className="flex items-end md:col-span-2 xl:col-span-3"><button disabled={taskBusy || !taskTitle.trim()} className={cx(btnPrimary, 'h-10 w-full justify-center disabled:cursor-not-allowed disabled:opacity-50')}><Plus className="h-4 w-4" />{taskBusy ? 'Saving task…' : 'Create task'}</button></div>
            <label className="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-mute md:col-span-2 xl:col-span-12"><span>Checklist <span className="font-normal text-faint">· optional, one step per line</span></span><textarea value={taskChecklist} onChange={e => setTaskChecklist(e.target.value)} placeholder={'Confirm the setup\nTest equipment\nComplete final check'} rows={3} className={cx(inputCls(D), 'min-h-[72px] w-full resize-y')} /></label>
          </div>
        </form></Modal>}
        {resourceModalTask && <Modal dark={D} title={`Resources · ${resourceModalTask.title}`} xl onClose={() => setResourceModalTask(null)}>
          <div className="animate-slide-up space-y-4">
            <p className="text-xs text-mute">Tools and materials are issued from Inventory to the team leader. The leader confirms receipt and records the return after the task is complete.</p>
            {canManage && resourceModalTask.status !== 'complete' && <form onSubmit={allocateTaskResource} className="grid grid-cols-1 gap-3 rounded-lg border border-line bg-surface/40 p-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_7rem_auto]">
              {(() => {
                const pickable = inventory.items.filter(item => availableFor(item) > 0 || item.id === resourceItemId);
                const unavailable = inventory.items.filter(item => item.inStock > 0 && availableFor(item) === 0);
                return <label className="flex min-w-0 flex-col gap-1.5 text-[11.5px] text-mute">Tool / material<select required value={resourceItemId} onChange={e => setResourceItemId(e.target.value)} className={cx(inputCls(D), 'h-9 w-full min-w-0')}><option value="">Choose inventory item</option>{pickable.map(item => <option key={item.id} value={item.id}>{item.name} · {availableFor(item)} {item.unit} available{availableFor(item) < item.inStock ? ` (${item.inStock} in store)` : ''}</option>)}{unavailable.length > 0 && <optgroup label="Fully reserved">{unavailable.map(item => <option key={item.id} value={item.id} disabled>{item.name} · 0 available ({item.inStock} in store)</option>)}</optgroup>}</select></label>;
              })()}
              <label className="flex min-w-0 flex-col gap-1.5 text-[11.5px] text-mute">Handover location<select required value={resourceLocationId} onChange={e => setResourceLocationId(e.target.value)} className={cx(inputCls(D), 'h-9 w-full min-w-0')}><option value="">Choose location</option>{inventory.locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
              <label className="flex min-w-0 flex-col gap-1.5 text-[11.5px] text-mute">Quantity<input required type="number" min="1" step="1" max={(() => { const item = inventory.items.find(row => row.id === resourceItemId); return item ? availableFor(item) : undefined; })()} value={resourceQty} onChange={e => setResourceQty(e.target.value)} className={cx(inputCls(D), 'h-9 w-full')} /></label>
              <button disabled={resourceBusy || !resourceItemId || !resourceLocationId || Number(resourceQty) < 1 || (() => { const item = inventory.items.find(row => row.id === resourceItemId); return !!item && Number(resourceQty) > availableFor(item); })()} className={cx(btnPrimary, 'self-end py-2 text-xs')}>{resourceBusy ? 'Saving…' : <><Plus className="h-3.5 w-3.5" />Allocate</>}</button>
              {(() => {
                const item = inventory.items.find(row => row.id === resourceItemId);
                const a = item && resourceAvailability?.[item.id];
                if (!item) return null;
                const over = Number(resourceQty) > availableFor(item);
                return <p className={cx('text-[10.5px] sm:col-span-2 lg:col-span-4', over ? 'text-rose-300' : 'text-mute')}>
                  {over ? `Only ${availableFor(item)} ${item.unit} can be allocated. ` : ''}
                  {a ? `${a.inStock} in store · ${a.reservedRequests} reserved for approved requests · ${a.reservedTasks} allocated to tasks awaiting receipt · ${a.available} available` : `${item.inStock} ${item.unit} in store`}
                </p>;
              })()}
            </form>}
            {(() => {
              const rows = resourcesForTask(resourceModalTask.id);
              if (!rows.length) return null;
              const leftover = resourceLeftover(resourceModalTask.id);
              const done = resourceModalTask.status === 'complete';
              return <div className={cx('rounded-lg border px-3 py-2.5 text-xs', leftover.length ? 'border-amber-500/30 bg-amber-500/5' : 'border-line bg-raised/30')}>
                <div className="font-semibold text-ink">{done ? 'After the task' : 'With the team now'}</div>
                <p className="mt-1 text-mute">{leftover.length ? <>Still with the team: <span className="font-semibold text-amber-200">{leftover.join(' · ')}</span>{done ? '. Record the return below.' : '.'}</> : rows.some(resource => !resource.received_at) ? 'Nothing received yet.' : 'Everything has been returned.'}</p>
              </div>;
            })()}
            <div className="space-y-2">
              {resourcesForTask(resourceModalTask.id).map(resource => {
                const item = resource.inventory_items;
                const remaining = resource.qty - resource.returned_good_qty - resource.returned_damaged_qty;
                const draft = resourceReturnDrafts[resource.id] || { good: String(remaining), damaged: '0' };
                const returnTotal = (Number(draft.good) || 0) + (Number(draft.damaged) || 0);
                return <article key={resource.id} className="rounded-lg border border-line bg-surface/50 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="text-sm font-semibold text-ink">{item?.name || 'Inventory item'} <span className="font-normal text-mute">· {resource.qty} {item?.unit || 'units'}</span></h3><p className="mt-1 text-[11.5px] text-mute">For {resource.team_leader} · {inventory.locationLabel(resource.location)}{resource.received_at ? ` · Received ${new Date(resource.received_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}` : ' · Awaiting receipt (stock reserved)'}</p></div><span className={cx('rounded-full px-2 py-1 text-[10.5px] font-semibold', remaining === 0 ? 'bg-emerald-500/10 text-emerald-300' : resource.received_at ? 'bg-amber-500/10 text-amber-300' : 'bg-blue-500/10 text-blue-300')}>{remaining === 0 ? `Returned · ${resource.returned_damaged_qty} damaged` : resource.received_at ? `${remaining} with team` : 'Awaiting receipt'}</span></div>
                  {resource.received_at && <dl className="mt-2 grid grid-cols-4 gap-2 rounded-md border border-line bg-canvas/40 p-2 text-center text-[10.5px]">
                    {([['Issued', resource.qty, 'text-ink'], ['Returned good', resource.returned_good_qty, 'text-emerald-300'], ['Returned damaged', resource.returned_damaged_qty, 'text-orange-300'], ['Still with team', remaining, remaining > 0 ? 'text-amber-300' : 'text-ink']] as const).map(([label, value, tone]) => <div key={label}><dt className="text-mute">{label}</dt><dd className={cx('mt-0.5 text-sm font-semibold tabular-nums', tone)}>{value}</dd></div>)}
                  </dl>}
                  {!resource.received_at && resourceModalTask.status !== 'complete' && <div className="mt-2 flex flex-wrap gap-2">
                    {canHandleTaskResources(resourceModalTask) && <button type="button" disabled={resourceBusy} onClick={() => void confirmResourceReceipt(resource)} className={cx(btnGhost(D), 'py-1.5 text-xs')}><Check className="h-3.5 w-3.5" />Confirm received by {resource.team_leader}</button>}
                    {canManage && <button type="button" disabled={resourceBusy} onClick={() => void cancelResourceAllocation(resource)} className={cx(btnGhost(D), 'py-1.5 text-xs text-rose-300')}><Trash2 className="h-3.5 w-3.5" />Cancel allocation</button>}
                  </div>}
                  {resource.received_at && resourceModalTask.status === 'complete' && remaining > 0 && canHandleTaskResources(resourceModalTask) && <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3"><label className="text-[10.5px] text-mute">Good returned<input type="number" min="0" max={remaining} step="1" value={draft.good} onChange={e => setResourceReturnDrafts(current => ({ ...current, [resource.id]: { ...draft, good: e.target.value } }))} className={cx(inputCls(D), 'mt-1 h-8 w-24')} /></label><label className="text-[10.5px] text-mute">Damaged returned<input type="number" min="0" max={remaining} step="1" value={draft.damaged} onChange={e => setResourceReturnDrafts(current => ({ ...current, [resource.id]: { ...draft, damaged: e.target.value } }))} className={cx(inputCls(D), 'mt-1 h-8 w-24')} /></label><span className="pb-2 text-[10.5px] text-mute">{resource.returned_good_qty} good · {resource.returned_damaged_qty} damaged returned so far</span><button type="button" disabled={resourceBusy || returnTotal < 1 || returnTotal > remaining} onClick={() => void recordResourceReturn(resource)} className={cx(btnPrimary, 'ml-auto py-1.5 text-xs')}><Package className="h-3.5 w-3.5" />{resourceBusy ? 'Saving…' : 'Record return'}</button></div>}
                  {resource.returned_at && <p className="mt-2 text-[10.5px] text-emerald-300">Fully returned by {resource.returned_by} · {new Date(resource.returned_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</p>}
                </article>;
              })}
              {!resourcesForTask(resourceModalTask.id).length && <div className="rounded-lg border border-dashed border-line px-4 py-8 text-center text-xs text-mute">No tools or materials allocated to this task yet.</div>}
            </div>
          </div>
        </Modal>}
        {deliveryTask && <Modal dark={D} title="Complete delivery" onClose={() => setDeliveryTask(null)}><form onSubmit={completeDeliveryTask} className="animate-slide-up space-y-3">
          <div className="rounded-lg border border-line bg-raised/40 px-3 py-2"><div className="text-sm font-semibold text-ink">{deliveryTask.title}</div><p className="mt-1 whitespace-pre-line text-xs text-mute">{deliveryTask.details}</p></div>
          <label className="flex flex-col gap-1.5 text-xs font-medium text-mute">Delivery location <span className="font-normal text-faint">(leave blank to use the request location)</span><select value={deliveryLocation} onChange={e => setDeliveryLocation(e.target.value)} className={inputCls(D)}><option value="">Use request location</option>{inventory.locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
          <label className="flex flex-col gap-1.5 text-xs font-medium text-mute">Delivered to<input required value={deliveryReceivedBy} onChange={e => setDeliveryReceivedBy(e.target.value)} className={inputCls(D)} placeholder="Requester or recipient" /></label>
          <label className="flex flex-col gap-1.5 text-xs font-medium text-mute">Note <span className="font-normal text-faint">· optional</span><textarea value={deliveryNote} onChange={e => setDeliveryNote(e.target.value)} className={inputCls(D)} rows={2} /></label>
          <div className="flex justify-end gap-2"><button type="button" className={btnGhost(D)} onClick={() => setDeliveryTask(null)}>Cancel</button><button className={btnPrimary} disabled={busyTaskIds.has(deliveryTask.id) || !deliveryReceivedBy.trim()}>{busyTaskIds.has(deliveryTask.id) ? 'Saving…' : 'Confirm delivery'}</button></div>
        </form></Modal>}
        </div>
        <section className={cx(panel, 'overflow-hidden')} aria-label="Task calendar">
        <div className="grid gap-3 p-3 sm:p-4 xl:grid-cols-[minmax(0,.9fr)_minmax(260px,1.1fr)]">
          <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-semibold text-ink">{calendarMonth.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</h3><p className="mt-0.5 text-[10.5px] text-mute">Select a date to review its tasks. Schedule tasks with the button above.</p></div><div className="flex items-center gap-1"><button type="button" className={cx(btnGhost(D), 'p-2')} aria-label="Previous month" onClick={() => setCalendarMonth(month => new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft className="h-4 w-4"/></button><button type="button" className={cx(btnGhost(D), 'px-2.5 py-1.5 text-[10.5px]')} onClick={() => {const now=new Date();setCalendarMonth(new Date(now.getFullYear(),now.getMonth(),1));setTaskSelectedDate(taskDateKey(now));}}>Today</button><button type="button" className={cx(btnGhost(D), 'p-2')} aria-label="Next month" onClick={() => setCalendarMonth(month => new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight className="h-4 w-4"/></button></div></div>
          <div className="grid grid-cols-7 gap-1">{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(day => <div key={day} className="px-1 py-1.5 text-center text-[10px] font-semibold uppercase tracking-wide text-mute">{day}</div>)}
            {calendarDates.map(date => { const dayKey = taskDateKey(date); const dayTasks = calendarTasks.filter(task => String(task.due_date).slice(0, 10) === dayKey); const currentMonth = date.getMonth() === calendarMonth.getMonth(); const today = dayKey === todayTaskKey; return <button key={dayKey} type="button" onClick={() => setTaskSelectedDate(dayKey)} aria-pressed={taskSelectedDate === dayKey} aria-label={`${date.toLocaleDateString('en-IN', { dateStyle: 'full' })}, ${dayTasks.length} scheduled tasks`} className={cx('flex min-h-12 min-w-0 flex-col items-stretch gap-0.5 rounded-md border p-1 text-left transition-colors sm:min-h-14 sm:p-1.5', currentMonth ? 'border-line bg-surface hover:border-blue-400/50 hover:bg-blue-500/5' : 'border-line/50 bg-raised/20 text-faint', today && 'ring-1 ring-blue-400/60', taskSelectedDate === dayKey && 'border-blue-400 bg-blue-500/10')}><span className={cx('flex h-4 w-4 items-center justify-center rounded-full text-[10px] tabular-nums', today ? 'bg-blue-600 font-semibold text-white' : currentMonth ? 'text-ink-soft' : 'text-faint')}>{date.getDate()}</span><span className="min-w-0 space-y-0.5">{dayTasks.slice(0, 1).map(task => <span key={task.id} className={cx('block truncate rounded px-1 py-0.5 text-[10px]', task.status === 'complete' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-blue-500/10 text-blue-200')}>{task.title}</span>)}{dayTasks.length > 1 && <span className="block px-1 text-[10px] text-mute">+{dayTasks.length - 1} more</span>}</span></button>; })}
          </div>
          {!calendarTasks.length && <p className="rounded-md border border-dashed border-line p-3 text-center text-[10.5px] text-mute">No tasks are scheduled in this month.</p>}
          </div>
          <section className="min-w-0 rounded-lg border border-line bg-surface/60 p-3"><div className="mb-2 flex items-start justify-between gap-2"><div><h3 className="text-xs font-semibold text-ink">{new Date(`${taskSelectedDate}T00:00:00`).toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long'})}</h3><p className="mt-0.5 text-[10.5px] text-mute">{selectedDayTasks.length} task{selectedDayTasks.length===1?'':'s'} in this view</p></div><button type="button" className={cx(btnGhost(D),'px-2 py-1 text-[10.5px]')} onClick={()=>startTaskCreation(taskSelectedDate)}><Plus className="h-3 w-3"/>Add</button></div>{selectedDayTasks.length ? <div className="max-h-[24rem] space-y-1.5 overflow-y-auto">{selectedDayTasks.map(task=><button key={task.id} type="button" onClick={()=>setTaskFilter(task.status==='complete'?'completed':'all')} className="block w-full rounded-md border border-line bg-surface p-2 text-left hover:border-blue-400/40"><span className="block truncate text-xs font-medium text-ink">{task.title}</span><span className="mt-0.5 block truncate text-[10.5px] text-mute">{task.team||task.assigned_to||'Unassigned'} · {task.status.replace('_',' ')}</span></button>)}</div>:<p className="rounded-md border border-dashed border-line px-3 py-6 text-center text-[10.5px] text-mute">Nothing scheduled for this date.</p>}</section>
        </div>
        </section>
        <section className={cx(panel, 'overflow-hidden')} aria-label="Task register">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3"><div><h3 className="text-sm font-semibold text-ink">Task register</h3><p className="mt-0.5 text-xs text-mute">{visibleTasks.length} rows · task details, assignments, priority, status and due dates</p></div><button type="button" onClick={exportTasksToExcel} disabled={!visibleTasks.length} className={cx(btnGhost(D), 'text-xs')}><Download className="h-3.5 w-3.5" />Export Excel</button></div>
        <div className="max-h-[34rem] overflow-auto">
          {visibleTasks.length > 0 && <table className="w-full min-w-[1120px] border-collapse text-left text-xs">
            <thead className="sticky top-0 z-10 bg-raised text-[10.5px] font-semibold uppercase tracking-wide text-mute"><tr>{['Task', 'Event / sub-department', 'Team', 'Assigned to', 'Due date', 'Priority', 'Status', 'Resources', 'Actions'].map(heading => <th key={heading} scope="col" className="whitespace-nowrap border-b border-line px-3 py-2.5">{heading}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">
              {visibleTasks.map(t => {
                const taskResources = resourcesForTask(t.id);
                const taskTeam = teamGroups.find(team => normalizeName(team.name) === normalizeName(t.team || ''));
                const eventName = eventScope.events.find(event => event.id === t.event_id)?.name || (t.event_id ? 'Event' : 'General');
                const dueKey = String(t.due_date || '').slice(0, 10);
                const overdue = !!dueKey && dueKey < todayTaskKey && t.status !== 'complete';
                const assignees = (t.sewadar_names || []).filter(Boolean);
                const resourceSummary = taskResources.length
                  ? taskResources.some(resource => !resource.received_at) ? 'Awaiting receipt'
                    : taskResources.some(resource => resource.returned_good_qty + resource.returned_damaged_qty < resource.qty) ? 'Return pending'
                      : 'Issued'
                  : 'None';
                return <tr key={t.id} className="align-top transition-colors hover:bg-raised/40">
                  <td className="max-w-64 px-3 py-3"><div className="font-semibold text-ink">{t.title}</div>{t.parent_task_id && <div className="mt-0.5 text-[10.5px] text-blue-300">Checklist step · {scopedTasks.find(parent => parent.id === t.parent_task_id)?.title || 'Parent task'}</div>}{t.details && <div className="mt-1 line-clamp-2 text-[10.5px] leading-4 text-mute" title={t.details}>{t.details}</div>}</td>
                  <td className="max-w-48 px-3 py-3"><div className="font-medium text-ink-soft">{eventName}</div><div className="mt-0.5 text-[10.5px] text-mute">{DEPT_LABEL[t.department_id] || t.department_id || 'No sub-department'}</div></td>
                  <td className="max-w-40 px-3 py-3"><div className="text-ink-soft">{t.team || 'Unassigned'}</div>{taskTeam?.lead && <div className="mt-0.5 text-[10.5px] text-mute">Lead: {taskTeam.lead}</div>}</td>
                  <td className="max-w-48 px-3 py-3"><div className="text-ink-soft">{assignees.length ? assignees.join(', ') : t.assigned_to || 'Unassigned'}</div>{assignees.length > 0 && t.assigned_to && <div className="mt-0.5 text-[10.5px] text-mute">Owner: {t.assigned_to}</div>}</td>
                  <td className="whitespace-nowrap px-3 py-3"><span className={overdue ? 'font-semibold text-rose-300' : 'text-ink-soft'}>{displayTaskDate(t.due_date)}</span>{overdue && <span className="mt-1 block text-[10.5px] text-rose-300">Overdue</span>}</td>
                  <td className="whitespace-nowrap px-3 py-3"><span className={cx('inline-flex rounded-full px-2 py-1 text-[10.5px] font-semibold', t.priority_level === 'immediately' ? 'bg-rose-500/10 text-rose-300' : t.priority_level === 'till_time' ? 'bg-amber-500/10 text-amber-300' : 'bg-blue-500/10 text-blue-300')}>{t.priority_level === 'immediately' ? 'Immediate' : t.priority_level === 'till_time' ? 'Due by time' : 'As time allows'}</span>{t.priority_level === 'till_time' && t.priority_until && <div className="mt-1 text-[10.5px] text-mute">{new Date(t.priority_until).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</div>}</td>
                  <td className="whitespace-nowrap px-3 py-3"><span className={cx('inline-flex rounded-full px-2 py-1 text-[10.5px] font-semibold capitalize', t.status === 'complete' ? 'bg-emerald-500/10 text-emerald-300' : t.status === 'in_progress' ? 'bg-blue-500/10 text-blue-300' : 'bg-amber-500/10 text-amber-300')}>{busyTaskIds.has(t.id) ? 'Saving…' : t.status.replace('_', ' ')}</span></td>
                  <td className="max-w-56 px-3 py-3"><div className="text-ink-soft">{taskResources.length} item{taskResources.length === 1 ? '' : 's'}</div><div className="mt-0.5 text-[10.5px] text-mute">{resourceSummary}</div>{resourceLeftover(t.id).length > 0 && <div className={cx('mt-1 text-[10.5px] font-medium', t.status === 'complete' ? 'text-amber-300' : 'text-mute')} title={resourceLeftover(t.id).join(' · ')}>With team: {resourceLeftover(t.id).join(' · ')}</div>}</td>
                  <td className="px-3 py-3"><div className="flex items-center gap-1.5">{t.source === 'manpower' && canHandleTaskResources(t) && <button type="button" onClick={() => void openTaskResources(t)} className={cx(btnGhost(D), 'px-2 py-1 text-[10.5px] text-blue-300')} title="Manage task resources"><Package className="h-3 w-3" /><span>Resources</span></button>}{t.status === 'todo' && <button type="button" disabled={busyTaskIds.has(t.id)} onClick={() => setTaskStatus(t, 'in_progress')} className={cx(btnGhost(D), 'px-2 py-1 text-[10.5px]')}><Play className="h-3 w-3" /><span>Start</span></button>}{t.status === 'in_progress' && <button type="button" disabled={busyTaskIds.has(t.id)} onClick={() => setTaskStatus(t, 'complete')} className={cx(btnGhost(D), 'px-2 py-1 text-[10.5px]')}><CircleCheck className="h-3 w-3" /><span>Complete</span></button>}{canManage && t.source === 'manpower' && <button type="button" onClick={() => void deleteTask(t)} className={cx(btnGhost(D), 'px-2 py-1 text-rose-300')} aria-label={`Remove task ${t.title}`} title="Remove task"><Trash2 className="h-3 w-3" /></button>}</div></td>
                </tr>;
              })}
            </tbody>
          </table>}
          {!visibleTasks.length && <div className="rounded-lg border border-dashed border-line px-5 py-10 text-center"><ListTodo className="mx-auto h-6 w-6 text-faint" /><p className="mt-2 text-sm font-medium text-ink">{scopedTasks.length ? `No ${taskFilter} tasks` : 'No tasks in this filter'}</p><p className="mt-1 text-xs text-mute">{scopedTasks.length ? 'Try another status filter to see more work.' : 'Create a task or choose different event and department filters.'}</p></div>}
        </div>
        </section>
      </section>}

      {taskDialogOpen && taskPickerOpen && <Modal dark={D} title="Select Sewadars for task" wide onClose={() => setTaskPickerOpen(false)}>
        <div className="animate-slide-up space-y-4">
          <p className="text-sm text-mute">Available Sewadars include arrived members and permanent members who are away from home. People assigned to another active task are unavailable.</p>
          <label className="relative block"><Search className="absolute left-3 top-3 h-4 w-4 text-faint" /><input autoFocus value={taskMemberQuery} onChange={e => setTaskMemberQuery(e.target.value)} placeholder="Search Sewadars" className={cx(inputCls(D), 'pl-9')} /></label>
          <div className="flex items-center justify-between gap-3"><span className="text-xs font-medium text-mute">{taskMemberDraft.length} selected · {availableTaskMembers.length} available</span><div className="flex gap-2"><button type="button" className={cx(btnGhost(D), 'py-1.5')} onClick={() => setTaskMemberDraft(availableTaskMembers.filter(person => person.name.toLowerCase().includes(taskMemberQuery.trim().toLowerCase())).map(person => person.id))} disabled={!availableTaskMembers.length}>Select shown</button><button type="button" className={cx(btnGhost(D), 'py-1.5')} onClick={() => setTaskMemberDraft([])} disabled={!taskMemberDraft.length}>Clear</button></div></div>
          <div className="max-h-[min(42vh,360px)] overflow-y-auto rounded-xl border border-line bg-field/50 p-2">
            {availableTaskMembers.filter(person => person.name.toLowerCase().includes(taskMemberQuery.trim().toLowerCase())).length ? <div className="grid gap-1 sm:grid-cols-2">{availableTaskMembers.filter(person => person.name.toLowerCase().includes(taskMemberQuery.trim().toLowerCase())).map(person => <label key={person.id} className={cx('flex min-w-0 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors', taskMemberDraft.includes(person.id) ? 'border-blue-500/40 bg-blue-500/10 text-ink' : 'border-transparent text-ink-soft hover:border-line hover:bg-raised')}><input type="checkbox" checked={taskMemberDraft.includes(person.id)} onChange={e => setTaskMemberDraft(current => e.target.checked ? [...current, person.id] : current.filter(id => id !== person.id))} className="h-4 w-4 accent-blue-500" /><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-raised text-xs font-semibold">{person.name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase()}</span><span className="min-w-0 truncate">{person.name}{memberMeta(person) && <span className="ml-2 text-[10.5px] text-mute">{memberMeta(person)}</span>}<span className="ml-2 text-[10.5px] text-mute">{person.memberType === 'salary_based' && person.arrival !== 'arrived' ? 'Permanent · away' : 'Arrived'}</span></span></label>)}</div> : <p className="px-3 py-8 text-center text-sm text-mute">{availableTaskMembers.length ? 'No available Sewadars match that search.' : 'No eligible Sewadars are free for assignment right now.'}</p>}
          </div>
          <div className="flex justify-end gap-2 border-t border-line pt-3"><button type="button" className={btnGhost(D)} onClick={() => setTaskPickerOpen(false)}>Cancel</button><button type="button" className={btnPrimary} onClick={() => { setTaskMembers(taskMemberDraft); setTaskPickerOpen(false); }}>{`Use ${taskMemberDraft.length} selected`}</button></div>
        </div>
      </Modal>}

      {activeTeam && canManage && <Modal dark={D} title={`Add members to ${activeTeam.name}`} wide onClose={() => { setActiveTeamId(''); setTeamMemberSelection([]); }}>
        <div className="animate-slide-up space-y-4">
          <p className="text-sm text-mute">Choose Sewadars from the shared roster. They stay in the roster if you later remove them from this team.</p>
          <label className="relative block"><Search className="absolute left-3 top-3 h-4 w-4 text-faint" /><input autoFocus value={teamMemberQuery} onChange={e => setTeamMemberQuery(e.target.value)} placeholder="Search Sewadars" className={cx(inputCls(D), 'pl-9')} /></label>
          <div className="flex items-center justify-between gap-3"><span className="text-xs font-medium text-mute">{teamMemberSelection.length} selected · {eligibleTeamMembers.length} available</span><div className="flex gap-2"><button type="button" className={cx(btnGhost(D), 'py-1.5')} onClick={() => setTeamMemberSelection(visibleTeamMembers.map(person => person.id))} disabled={!visibleTeamMembers.length}>Select shown</button><button type="button" className={cx(btnGhost(D), 'py-1.5')} onClick={() => setTeamMemberSelection([])} disabled={!teamMemberSelection.length}>Clear</button></div></div>
          <div className="max-h-[min(42vh,360px)] overflow-y-auto rounded-xl border border-line bg-field/50 p-2">
            {visibleTeamMembers.length ? <div className="grid gap-1 sm:grid-cols-2">{visibleTeamMembers.map(person => <label key={person.id} className={cx('flex min-w-0 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors', teamMemberSelection.includes(person.id) ? 'border-blue-500/40 bg-blue-500/10 text-ink' : 'border-transparent text-ink-soft hover:border-line hover:bg-raised')}><input type="checkbox" checked={teamMemberSelection.includes(person.id)} onChange={e => setTeamMemberSelection(current => e.target.checked ? [...current, person.id] : current.filter(id => id !== person.id))} className="h-4 w-4 accent-blue-500" /><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-raised text-xs font-semibold">{person.name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase()}</span><span className="truncate">{person.name}{memberMeta(person) && <span className="ml-2 text-[10.5px] text-mute">{memberMeta(person)}</span>}</span></label>)}</div> : <p className="px-3 py-8 text-center text-sm text-mute">{eligibleTeamMembers.length ? 'No Sewadars match that search.' : 'All roster members are already in this team.'}</p>}
          </div>
          <div className="flex justify-end gap-2 border-t border-line pt-3"><button type="button" className={btnGhost(D)} onClick={() => { setActiveTeamId(''); setTeamMemberSelection([]); }}>Cancel</button><button type="button" disabled={!teamMemberSelection.length || teamBusy} className={cx(btnPrimary, 'min-w-36 disabled:opacity-50')} onClick={async () => { setTeamBusy(true); const ok = await m.setTeam(teamMemberSelection, activeTeam.name, activeTeam.lead); setTeamBusy(false); if (ok) { setTeamMemberSelection([]); setActiveTeamId(''); setTeamMemberQuery(''); } }}>{teamBusy ? <><LoaderCircle className="h-4 w-4 animate-spin" />Adding members…</> : <><UserPlus className="h-4 w-4" />Add {teamMemberSelection.length || ''} members</>}</button></div>
        </div>
      </Modal>}

      {/* Compact member search and single-row filters */}
      {isRosterWorkspace && <>
      <section className={cx(panel, 'flex flex-col gap-2 p-2 md:flex-row md:items-center')}>
        <label className="relative min-w-0 md:flex-1"><Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-faint" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, mobile, ID, batch, team or city…" className="h-9 w-full rounded-md border border-line bg-field pl-8 pr-2.5 text-xs text-ink outline-none placeholder:text-faint focus:border-blue-500" /></label>
        {workspace === 'members' && <select value={memberType} onChange={e => setMemberType(e.target.value as 'all' | SewadarMemberType)} aria-label="Member type" className={cx(rosterSelect, 'md:min-w-[155px]')}>
          <option value="all">All member types</option><option value="monthly">Regular ({sewadars.filter(s => s.memberType === 'monthly').length})</option><option value="annual">Annual ({sewadars.filter(s => s.memberType === 'annual').length})</option>
        </select>}
        <select value={dept} onChange={e => setDept(e.target.value)} aria-label="Sub-department" className={cx(rosterSelect, 'md:min-w-[170px]')}>
          <option value="all">All sub-departments</option>{DEPT_OPTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}<option value="none">No sub-department</option>
        </select>
        <select value={stage} onChange={e => setStage(e.target.value as Stage)} aria-label="Member status" className={cx(rosterSelect, 'md:min-w-[150px]')}>
          <option value="all">All statuses ({statusCounts.all})</option>{workspace === 'members' && memberSection === 'calling' && <><option value="toCall">Need call ({statusCounts.toCall})</option><option value="awaiting">Called · awaiting ({statusCounts.awaiting})</option><option value="overdue">Overdue · not arrived ({statusCounts.overdue})</option></>}<option value="arrived">Arrived ({statusCounts.arrived})</option><option value="badge">Badge pending ({statusCounts.badge})</option><option value="notComing">Not coming ({statusCounts.notComing})</option>
        </select>
      </section>

      {sel.size > 0 && canManage && (
        <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-2.5 flex flex-wrap items-center gap-2 text-sm">
          <b>{sel.size} selected</b>
          <button className={btnGhost(D)} onClick={() => m.setArrival(ids, 'arrived')}><Check className="w-3.5 h-3.5" />Mark arrived</button>
          <button className={btnGhost(D)} onClick={() => m.setBadge(ids, true)}>Issue badge</button>
          <select aria-label="Assign selected members to a team" value="" onChange={e => { const team = teamGroups.find(t => t.name === e.target.value); const eligibleIds = ids.filter(id => { const person = sewadars.find(candidate => candidate.id === id); return !!person && person.arrival === 'arrived' && !teamLeaderNames.has(normalizeName(person.name)); }); if (team && eligibleIds.length) m.setTeam(eligibleIds, team.name, team.lead); else if (team) auth.addToast?.('Only arrived, non-leader members can be assigned to a team.', 'warning'); }} className={cx(inputCls(D), 'w-auto !py-1.5 text-xs')}>
            <option value="">Assign to team…</option>{teamGroups.filter(team => !busyTeamNames.has(normalizeName(team.name))).map(team => <option key={team.name} value={team.name}>{team.name} · {team.members.length} members</option>)}
          </select>
          <select aria-label="Move to sub-department" value="" onChange={e => { if (e.target.value) m.setDepartment(ids, e.target.value === '__none' ? '' : e.target.value); }} className={cx(inputCls(D), 'w-auto !py-1.5 text-xs')}>
            <option value="">Move to sub-department…</option>
            {DEPT_OPTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            <option value="__none">No sub-department</option>
          </select>
          <button className={cx(btnGhost(D), 'text-rose-400')} onClick={() => setConfirmDel(true)}><Trash2 className="w-3.5 h-3.5" />Delete</button>
          <button className="ml-auto text-xs text-mute hover:text-ink" onClick={() => setSel(new Set())}>Clear</button>
        </div>
      )}

      {workspace === 'members' && memberSection === 'calling' ? <section className={cx(panel, 'overflow-hidden')}>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-2.5 py-2 text-[11.5px] text-mute"><PhoneCall className="h-3.5 w-3.5 text-blue-300" /><span className="font-semibold text-ink">{callingEvent ? `${callingEvent.name} · ${callingEvent.event_type || 'Annual'} calling` : 'Sewadar calling'}</span><span className="rounded bg-raised px-1.5 py-0.5 tabular-nums">{rows.length}</span><span className="ml-auto">{callingEvent ? 'Arrival issues a badge; returned back marks it returned.' : 'Choose an event in Working on to track event attendance and badges.'}</span></div>
        <div className="max-h-[calc(100vh-18rem)] min-h-[180px] overflow-auto">
          <table className="h-auto w-full min-w-[1250px] border-collapse text-[11.5px] leading-4">
            <thead className="sticky top-0 z-10 bg-raised text-left text-[10.5px] font-semibold uppercase tracking-wide text-mute shadow-sm"><tr>{['Sewadar','Mobile','Team','Sub-department','Exp. arrival date - time','Arrival status','Badge','Call count','Last outcome','Last called','Return','Mark arrived','Call / log'].map(label => <th key={label} className="whitespace-nowrap border border-line/70 px-2.5 py-1.5">{label}</th>)}</tr></thead>
            <tbody>{view.map(s => { const overdue = isArrivalOverdue(s, new Date()); return <tr key={s.id} className={cx('h-auto hover:bg-raised/50', overdue && 'bg-rose-500/5')}>
              <td className="whitespace-nowrap border border-line/70 px-2.5 py-1.5 font-semibold text-ink">{s.name}<span className="ml-1.5 font-normal text-mute">{s.memberType === 'monthly' ? 'Regular' : 'Annual'}</span>{memberMeta(s) && <span className="block text-[10.5px] font-normal text-mute">{memberMeta(s)}</span>}</td>
              <td className="whitespace-nowrap border border-line/70 px-2.5 py-1.5 text-ink-soft">{s.phone ? <a href={`tel:${s.phone}`} className="hover:text-blue-300">{s.phone}</a> : '—'}</td>
              <td className="border border-line/70 px-2.5 py-1.5 text-ink-soft">{(s.teams || []).join(', ') || '—'}</td>
              <td className="border border-line/70 px-2.5 py-1.5 text-ink-soft">{DEPT_LABEL[s.department] || s.department || '—'}</td>
              <td className={cx('border border-line/70 px-2.5 py-1.5', overdue ? 'font-semibold text-rose-300' : 'text-ink-soft')}>
                {callingEvent && canManage ? (() => {
                  const draft = arrivalDrafts[s.id] || { date: s.expectedArrival, period: s.expectedArrivalPeriod };
                  const changed = draft.date !== s.expectedArrival || draft.period !== s.expectedArrivalPeriod;
                  return <div className="flex min-w-[320px] flex-wrap items-center gap-2">
                    <input type="date" aria-label={`Expected arrival date for ${s.name}`} value={draft.date} onChange={e => setArrivalDrafts(current => ({ ...current, [s.id]: { ...draft, date: e.target.value } }))} className="h-7 w-36 rounded border border-line bg-field px-2 text-[11.5px] text-ink" />
                    <select aria-label={`Expected arrival time for ${s.name}`} value={draft.period} onChange={e => setArrivalDrafts(current => ({ ...current, [s.id]: { ...draft, period: e.target.value as ArrivalTimeOfDay } }))} className="h-7 w-24 rounded border border-line bg-field px-2 text-[11.5px] text-ink"><option value="">Time</option><option value="morning">Morning</option><option value="noon">Noon</option><option value="evening">Evening</option><option value="night">Night</option></select>
                    {changed && <button type="button" className="rounded bg-blue-500/10 px-2 py-1 text-[10.5px] font-semibold text-blue-300 hover:bg-blue-500/20" onClick={async () => { const saved = await m.setExpectedArrival(s.id, draft.date, draft.period); if (saved) setArrivalDrafts(current => { const next = { ...current }; delete next[s.id]; return next; }); }}>Save</button>}
                  </div>;
                })() : <span className="inline-flex items-center gap-2 whitespace-nowrap">{s.expectedArrival && <span>{s.expectedArrival}</span>}{s.expectedArrival && s.expectedArrivalPeriod && <span className="text-faint">·</span>}{s.expectedArrivalPeriod && <span>{s.expectedArrivalPeriod[0].toUpperCase() + s.expectedArrivalPeriod.slice(1)}</span>}{!s.expectedArrival && !s.expectedArrivalPeriod && '—'}</span>}
              </td>
              <td className={cx('whitespace-nowrap border border-line/70 px-2.5 py-1.5', s.returnedBack ? 'text-cyan-300' : s.arrival === 'arrived' ? 'text-emerald-300' : s.arrival === 'not_coming' ? 'text-rose-300' : overdue ? 'font-semibold text-rose-300' : 'text-mute')}>{s.returnedBack ? 'Returned back' : s.arrival === 'arrived' ? 'Arrived' : s.arrival === 'not_coming' ? 'Not coming' : overdue ? 'Overdue · not arrived' : 'Expected'}</td>
              <td className="whitespace-nowrap border border-line/70 px-2.5 py-1.5">{s.badgeReturned ? <span className="text-cyan-300">Returned</span> : s.badgeIssued ? <span className="text-emerald-300">Issued</span> : <span className="text-mute">Not issued</span>}</td>
              <td className="border border-line/70 px-2.5 py-1.5 tabular-nums text-ink-soft">{s.callCount}</td>
              <td className="whitespace-nowrap border border-line/70 px-2.5 py-1.5 text-ink-soft">{s.lastCallOutcome ? OUTCOME_LABEL[s.lastCallOutcome] : 'Not called'}</td>
              <td className="whitespace-nowrap border border-line/70 px-2.5 py-1.5 text-mute">{s.lastCallAt ? new Date(s.lastCallAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—'}</td>
              <td className="whitespace-nowrap border border-line/70 px-2.5 py-1.5">{callingEvent && canManage && s.arrival === 'arrived' && !s.returnedBack && <button type="button" className="rounded-md bg-cyan-500/10 px-2 py-1 text-[10.5px] font-semibold text-cyan-300 hover:bg-cyan-500/20" onClick={() => void m.setReturnedBack([s.id])}>Returned back</button>}{s.returnedBack && <span className="text-cyan-300">Returned</span>}</td>
              <td className="whitespace-nowrap border border-line/70 px-2.5 py-1.5">{callingEvent && canManage && s.arrival !== 'arrived' && <button type="button" className="rounded-md bg-emerald-500/10 px-2 py-1 text-[10.5px] font-semibold text-emerald-300 hover:bg-emerald-500/20" onClick={() => void m.setArrival([s.id], 'arrived')}>Mark arrived</button>}</td>
              <td className="whitespace-nowrap border border-line/70 px-2.5 py-1.5"><button type="button" className="rounded-md bg-blue-500/10 px-2 py-1 text-[10.5px] font-semibold text-blue-300 hover:bg-blue-500/20" onClick={() => setCalling(s)}><PhoneCall className="mr-1 inline h-3 w-3" />Call / log</button></td>
            </tr>; })}</tbody>
          </table>
        </div>
        {!view.length && <div className="py-14 text-center text-sm text-faint">{loading ? 'Loading…' : 'No Sewadars match these filters.'}</div>}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-2.5 py-2 text-[11.5px] text-mute"><span>{rows.length ? `${page * size + 1}–${Math.min(rows.length, page * size + size)} of ${rows.length}` : '0 results'}</span><div className="flex items-center gap-2"><select aria-label="Rows per page" value={size} onChange={e => setSize(+e.target.value)} className={cx(inputCls(D), 'w-auto !py-1 text-xs')}>{[25, 50, 100, 200].map(n => <option key={n} value={n}>{n} / page</option>)}</select><button className={btnGhost(D)} disabled={page === 0} onClick={() => setPage(p => p - 1)} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></button><span>{page + 1} / {pages}</span><button className={btnGhost(D)} disabled={page >= pages - 1} onClick={() => setPage(p => p + 1)} aria-label="Next page"><ChevronRight className="h-4 w-4" /></button></div></div>
      </section> : <section className={cx(panel, 'overflow-hidden')}>
        <div className="flex items-center gap-2 border-b border-line px-2.5 py-2 text-[11.5px] text-mute"><span className="font-semibold text-ink">{workspace === 'permanent' ? 'IT Department Permanent Staff' : 'Members'}</span><span className="rounded bg-raised px-1.5 py-0.5 tabular-nums">{rows.length}</span>{canManage && <label className="ml-auto inline-flex items-center gap-2"><input type="checkbox" aria-label="Select page" checked={allOnPage} onChange={togglePage} className="rounded" />Select page</label>}</div>
        <div className="max-h-[calc(100vh-18rem)] min-h-[180px] overflow-auto">
        <table className="w-full min-w-[1250px] border-collapse text-[11.5px] leading-4">
          <thead className="sticky top-0 z-10 bg-raised text-left text-[10.5px] font-semibold uppercase tracking-wide text-mute shadow-sm">
            <tr>
              {canManage && <th className="border border-line/70 px-2 py-1.5"><span className="sr-only">Select</span></th>}
              {['Badge no.','Name','Member type','Mobile','Skills','Branch','Address','Sub-department',...(workspace === 'permanent' ? ['Home status','Went home','Returned','Total holidays'] : showExpectedArrival ? ['Expected arrival date','Expected arrival time'] : []),'Actions'].map(label => <th key={label} className="whitespace-nowrap border border-line/70 px-2 py-1.5">{label}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-line/70">
          {view.map(s => {
            const address = [s.address, s.address2].filter(Boolean).join(', ');
            const memberLabel = s.memberType === 'salary_based' ? 'Permanent' : s.memberType === 'monthly' ? 'Regular' : 'Annual';
            const currentLeaveDays = s.wentHomeAt && !s.returnedFromHomeAt ? Math.max(0, Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(s.wentHomeAt).setHours(0, 0, 0, 0)) / 86_400_000)) : 0;
            const homeDate = (value: string | null) => value ? new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
            const cells = [s.batchNo,s.name,memberLabel,s.phone,(s.skills || []).join(', '),s.branch,address,DEPT_LABEL[s.department] || s.department,...(workspace === 'permanent' ? [s.wentHomeAt && !s.returnedFromHomeAt ? 'Away' : s.returnedFromHomeAt ? 'Home' : '—',homeDate(s.wentHomeAt),homeDate(s.returnedFromHomeAt),String(s.totalHolidayDays + currentLeaveDays)] : showExpectedArrival ? [s.memberType === 'salary_based' ? '' : s.expectedArrival,s.memberType === 'salary_based' ? '' : s.expectedArrivalPeriod ? s.expectedArrivalPeriod[0].toUpperCase() + s.expectedArrivalPeriod.slice(1) : ''] : [])];
            return <tr key={s.id} className={cx('hover:bg-raised/50', sel.has(s.id) && 'bg-blue-500/5')}>
              {canManage && <td className="border border-line/70 px-2 py-1.5"><input type="checkbox" aria-label={`Select ${s.name}`} checked={sel.has(s.id)} onChange={() => toggle(s.id)} className="rounded" /></td>}
              {cells.map((value, i) => <td key={i} title={value || ''} className={cx('max-w-[200px] truncate whitespace-nowrap border border-line/70 px-2 py-1.5', i === 1 ? 'font-semibold text-ink' : 'text-ink-soft')}>{i === 3 && s.phone ? <a href={`tel:${s.phone}`} className="hover:text-blue-300">{value}</a> : value || '—'}</td>)}
              <td className="border border-line/70 bg-surface px-2 py-1.5"><div className="flex flex-wrap items-center gap-1">{canManage && workspace === 'permanent' && (s.wentHomeAt && !s.returnedFromHomeAt ? <button type="button" className="rounded bg-emerald-500/10 px-2 py-1 text-[10.5px] font-medium text-emerald-300 hover:bg-emerald-500/20" onClick={() => void m.markReturnedHome(s.id)}>Returned</button> : <button type="button" className="rounded bg-amber-500/10 px-2 py-1 text-[10.5px] font-medium text-amber-300 hover:bg-amber-500/20" onClick={() => void m.markWentHome(s.id)}>Went home</button>)}{canManage && <button className="rounded px-2 py-1 text-[10.5px] font-medium text-ink-soft hover:bg-raised" onClick={() => setEditing(s)}>Edit</button>}</div></td>
            </tr>;
          })}
          </tbody>
        </table>
        </div>
        {view.length === 0 && (
          <div className="py-14 text-center text-sm text-faint">
            {loading ? 'Loading…' : sewadars.length === 0 ? (canManage ? 'No sewadars yet — use "Import list" to paste names and numbers.' : 'No sewadars added yet.') : workspace === 'members' && sewadars.some(s => s.memberType === 'salary_based') && !sewadars.some(s => s.memberType !== 'salary_based') && memberType === 'all' && dept === 'all' && stage === 'all' && !q.trim() ? <div className="flex flex-col items-center gap-3"><span>All {sewadars.filter(s => s.memberType === 'salary_based').length} roster records are permanent members.</span><button type="button" className={cx(btnGhost(D), 'border-blue-500/30 text-blue-300')} onClick={() => setWorkspace('permanent')}>View permanent members</button></div> : 'No one matches these filters.'}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 px-2.5 py-2 border-t border-line text-[11.5px] text-mute">
          <span>{rows.length ? `${page * size + 1}–${Math.min(rows.length, page * size + size)} of ${rows.length}` : '0 results'}</span>
          <div className="flex items-center gap-2">
            <select aria-label="Rows per page" value={size} onChange={e => setSize(+e.target.value)} className={cx(inputCls(D), 'w-auto !py-1 text-xs')}>{[25, 50, 100, 200].map(n => <option key={n} value={n}>{n} / page</option>)}</select>
            <button className={btnGhost(D)} disabled={page === 0} onClick={() => setPage(p => p - 1)} aria-label="Previous page"><ChevronLeft className="w-4 h-4" /></button>
            <span>{page + 1} / {pages}</span>
            <button className={btnGhost(D)} disabled={page >= pages - 1} onClick={() => setPage(p => p + 1)} aria-label="Next page"><ChevronRight className="w-4 h-4" /></button>
          </div>
        </div>
      </section>}

      {editing && <SewadarForm initial={editing === 'new' ? null : editing} defaultMemberType={workspace === 'permanent' ? 'salary_based' : 'monthly'} teams={teamGroups} showArrivalSchedule={workspace === 'members' && memberSection === 'calling'} onClose={() => setEditing(null)}
        onSave={(i) => (editing === 'new' ? m.add(i) : m.update(editing.id, i))}
        onDelete={editing !== 'new' ? () => m.remove([editing.id]) : undefined}
        onSetArrival={editing !== 'new' ? arrival => m.setArrival([editing.id], arrival) : undefined}
        onSetBadge={editing !== 'new' ? issued => m.setBadge([editing.id], issued) : undefined}
        onSetBadgeReturned={editing !== 'new' ? returned => m.setBadgeReturned([editing.id], returned) : undefined} />}
      {calling && <CallModal s={calling} onClose={() => setCalling(null)} />}
      {importing && <ImportModal onClose={() => setImporting(false)} />}
      {confirmDel && <ConfirmModal dark={D} title={`Delete ${sel.size} sewadar(s)?`} body="They and their call history will be permanently removed." confirmLabel="Delete" onConfirm={async () => { if (await m.remove(ids)) setSel(new Set()); }} onClose={() => setConfirmDel(false)} />}
      </>}
      {taskToDelete && <ConfirmModal dark={D} title="Remove this task?" body={`“${taskToDelete.title}” will be deleted from the team task board.`} confirmLabel="Remove task" onConfirm={() => void confirmDeleteTask()} onClose={() => setTaskToDelete(null)} />}
    </div>
  );
};

// ---------------------------------------------------------------------------
const emptySewadar = (): SewadarInput => ({
  name: '', memberType: 'monthly', serialNo: '', batchNo: '', phone: '', department: '', relation: '', relationName: '',
  villageCity: '', branch: '', occupation: '', remarks: '', joiningDate: '', employeeCode: '', employeeId: '', address: '', address2: '',
  expectedArrival: '', expectedArrivalPeriod: '', skills: [], teamName: '', teamLead: '', teams: [], shift: '', deviceType: 'none', deviceRef: '',
});

const sewadarInput = (s: Sewadar): SewadarInput => ({
  name: s.name, memberType: s.memberType, serialNo: s.serialNo, batchNo: s.batchNo, phone: s.phone, department: s.department,
  relation: s.relation, relationName: s.relationName, villageCity: s.villageCity, branch: s.branch, occupation: s.occupation,
  remarks: s.remarks, joiningDate: s.joiningDate, employeeCode: s.employeeCode, employeeId: s.employeeId, address: s.address,
  address2: s.address2, expectedArrival: s.expectedArrival, expectedArrivalPeriod: s.expectedArrivalPeriod, skills: s.skills || [], teamName: s.teamName, teamLead: s.teamLead, teams: s.teams || (s.teamName ? [s.teamName] : []), shift: s.shift,
  deviceType: s.deviceType, deviceRef: s.deviceRef,
});

// Tag input for skills: type one and press Enter or comma (or pick a suggestion) to add it; × or Backspace removes.
const SkillsInput: React.FC<{ value: string[]; onChange: (skills: string[]) => void }> = ({ value, onChange }) => {
  const { sewadars } = useManpower();
  const [draft, setDraft] = useState('');
  const known = useMemo(() => {
    const seen = new Map<string, string>();
    sewadars.forEach(s => (s.skills || []).forEach(skill => { const k = skill.trim().toLocaleLowerCase(); if (k && !seen.has(k)) seen.set(k, skill.trim()); }));
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [sewadars]);
  const has = (skill: string) => value.some(v => v.toLocaleLowerCase() === skill.toLocaleLowerCase());
  const add = (raw: string) => {
    const next = raw.split(/[,;]/).map(s => s.trim()).filter(s => s && !has(s));
    if (next.length) onChange([...value, ...next.filter((s, i) => next.findIndex(o => o.toLocaleLowerCase() === s.toLocaleLowerCase()) === i)]);
    setDraft('');
  };
  const suggestions = known.filter(s => !has(s));
  return (
    <div className="text-xs text-mute sm:col-span-2 lg:col-span-3">Skills
      <div className={cx(inputCls(D), 'mt-1 flex flex-wrap items-center gap-1.5 !py-1.5')}>
        {value.map(skill => (
          <span key={skill} className="inline-flex items-center gap-1 rounded-md bg-blue-500/15 px-2 py-0.5 text-xs font-medium text-blue-300">
            {skill}
            <button type="button" className="rounded text-blue-300/80 hover:text-white" aria-label={`Remove ${skill}`} onClick={() => onChange(value.filter(v => v !== skill))}>×</button>
          </span>))}
        <input list="sewadar-skill-suggestions" value={draft} aria-label="Add a skill"
          placeholder={value.length ? 'Add another skill…' : 'e.g. First aid — press Enter to add'}
          onChange={e => { const v = e.target.value; if (/[,;]/.test(v)) add(v); else if (suggestions.some(s => s === v)) add(v); else setDraft(v); }}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); if (draft.trim()) add(draft); }
            else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
          }}
          onBlur={() => { if (draft.trim()) add(draft); }}
          className="min-w-[10rem] flex-1 bg-transparent py-0.5 text-sm text-ink outline-none placeholder:text-faint" />
        <datalist id="sewadar-skill-suggestions">{suggestions.map(s => <option key={s} value={s} />)}</datalist>
      </div>
      <span className="mt-1 block text-[11px] text-faint">Add as many as you need. Press Enter or comma after each skill.</span>
    </div>
  );
};

const SewadarForm: React.FC<{
  initial: Sewadar | null;
  defaultMemberType?: SewadarMemberType;
  teams: { id: string; name: string; lead: string; members: Sewadar[] }[];
  onClose: () => void;
  onSave: (i: SewadarInput) => Promise<boolean>;
  onDelete?: () => Promise<boolean>;
  fullPage?: boolean;
  showArrivalSchedule?: boolean;
  onSetArrival?: (arrival: Arrival) => Promise<boolean>;
  onSetBadge?: (issued: boolean) => Promise<boolean>;
  onSetBadgeReturned?: (returned: boolean) => Promise<boolean>;
  onCallHistory?: () => void;
}> = ({ initial, defaultMemberType = 'monthly', teams, onClose, onSave, onDelete, fullPage = false, showArrivalSchedule = false, onSetArrival, onSetBadge, onSetBadgeReturned, onCallHistory }) => {
  const [f, setF] = useState<SewadarInput>(() => initial ? ({
    name: initial.name, memberType: initial.memberType, serialNo: initial.serialNo, batchNo: initial.batchNo, phone: initial.phone,
    department: initial.department, relation: initial.relation, relationName: initial.relationName, villageCity: initial.villageCity,
    branch: initial.branch, occupation: initial.occupation, remarks: initial.remarks, joiningDate: initial.joiningDate,
    employeeCode: initial.employeeCode, employeeId: initial.employeeId, address: initial.address, address2: initial.address2,
    expectedArrival: initial.expectedArrival, expectedArrivalPeriod: initial.expectedArrivalPeriod, skills: initial.skills || [], teamName: initial.teamName, teamLead: initial.teamLead, teams: initial.teams || (initial.teamName ? [initial.teamName] : []), shift: initial.shift,
    deviceType: initial.deviceType, deviceRef: initial.deviceRef,
  }) : { ...emptySewadar(), memberType: defaultMemberType });
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState(false);
  const [teamPickerOpen, setTeamPickerOpen] = useState(false);
  const [teamQuery, setTeamQuery] = useState('');
  const ownLeaderTeams = teams.filter(team => team.lead.trim().toLocaleLowerCase() === f.name.trim().toLocaleLowerCase());
  const filteredTeams = teams.filter(team => team.name.toLowerCase().includes(teamQuery.trim().toLowerCase()) && (!ownLeaderTeams.length || ownLeaderTeams.some(own => own.id === team.id)));
  const set = <K extends keyof SewadarInput,>(k: K, v: SewadarInput[K]) => setF(p => ({ ...p, [k]: v }));
  const field = (k: Exclude<keyof SewadarInput, 'memberType' | 'deviceType' | 'skills'>, label: string, type = 'text') => <label key={k} className="text-xs text-mute">{label}<input required={k === 'name'} autoFocus={k === 'name' && !initial} type={type} {...(type === 'tel' ? phoneInputProps : {})} value={f[k]} onChange={e => set(k, type === 'tel' ? digitsOnly(e.target.value) : e.target.value)} className={cx(inputCls(D), 'mt-1')} /></label>;
  const submit = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); const saved = ownLeaderTeams.length ? { ...f, teams: (f.teams || []).filter(name => ownLeaderTeams.some(team => team.name.toLocaleLowerCase() === name.toLocaleLowerCase())), teamName: ownLeaderTeams[0].name, teamLead: ownLeaderTeams[0].lead } : f; const ok = await onSave(saved); setBusy(false); if (ok) onClose(); };
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
          <label className="text-xs text-mute">Member type{f.memberType === 'salary_based' ? <div className={cx(inputCls(D), 'mt-1 flex items-center')}>Permanent</div> : <select value={f.memberType} onChange={e => set('memberType', e.target.value as SewadarMemberType)} className={cx(inputCls(D), 'mt-1')}><option value="monthly">Regular</option><option value="annual">Annual</option></select>}</label>
          {field('serialNo', 'Sr. No.')}{field('batchNo', 'Badge no.')}{field('relation', 'Relation')}{field('relationName', 'Relation name')}
          {field('phone', 'Mobile', 'tel')}{field('villageCity', 'Village / city')}{field('branch', 'Branch')}{field('occupation', 'Occupation')}
          {field('employeeCode', 'Employee code')}{field('employeeId', 'Employee ID')}{field('address', 'Address')}{field('address2', 'Address 2')}
          {field('remarks', 'Remarks')}
          <SkillsInput value={f.skills || []} onChange={skills => set('skills', skills)} />
        </div></section>
        <section className="space-y-3 border-t border-line pt-4"><h3 className="text-xs font-semibold uppercase tracking-wider text-mute">Sewa and team assignment</h3><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-xs text-mute">Sub-department<select value={f.department} onChange={e => set('department', e.target.value)} className={cx(inputCls(D), 'mt-1')}><option value="">Not assigned</option>{DEPT_OPTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          {showArrivalSchedule && f.memberType !== 'salary_based' && <>{field('expectedArrival', 'Expected arrival date', 'date')}
          <label className="text-xs text-mute">Expected arrival time<select value={f.expectedArrivalPeriod} onChange={e => set('expectedArrivalPeriod', e.target.value as ArrivalTimeOfDay)} className={cx(inputCls(D), 'mt-1')}><option value="">Not set</option><option value="morning">Morning</option><option value="noon">Noon</option><option value="evening">Evening</option><option value="night">Night</option></select></label></>}
          <fieldset className="text-xs text-mute sm:col-span-2"><legend className="mb-1">Teams (choose any that apply)</legend>
            <button type="button" aria-expanded={teamPickerOpen} onClick={() => { setTeamPickerOpen(open => !open); setTeamQuery(''); }} className={cx(inputCls(D), 'mt-1 flex min-h-10 items-center justify-between gap-2 text-left')}>
              <span className="truncate">{(f.teams || []).length ? (f.teams || []).join(', ') : 'Search and choose teams…'}</span><ChevronDown className={cx('h-4 w-4 shrink-0 transition-transform', teamPickerOpen && 'rotate-180')} />
            </button>
            {teamPickerOpen && <div className="mt-1 overflow-hidden rounded-md border border-line bg-surface shadow-lg">
              <div className="relative border-b border-line p-2"><Search className="absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" /><input autoFocus value={teamQuery} onChange={e => setTeamQuery(e.target.value)} placeholder="Search teams…" aria-label="Search teams" className="h-9 w-full rounded-md border border-line bg-field pl-8 pr-3 text-xs text-ink outline-none placeholder:text-faint focus:border-blue-500" /></div>
              <div role="group" aria-label="Available teams" className="max-h-40 overflow-y-auto p-1.5">
                {filteredTeams.map(team => <label key={team.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-2 hover:bg-raised"><input type="checkbox" checked={(f.teams || []).some(n => n.toLowerCase() === team.name.toLowerCase())} onChange={e => setF(p => { const next = e.target.checked ? Array.from(new Set([...(p.teams || []), team.name])) : (p.teams || []).filter(n => n.toLowerCase() !== team.name.toLowerCase()); return { ...p, teams: next, teamName: next[0] || '', teamLead: teams.find(t => t.name === next[0])?.lead || '' }; })} /><span className="min-w-0 flex-1 truncate text-ink">{team.name}</span>{team.lead && <span className="max-w-32 truncate text-[10.5px] text-faint">Lead: {team.lead}</span>}</label>)}
                {!teams.length && <span className="block px-2 py-3 text-center text-faint">Create teams in the Teams tab first.</span>}
                {!!teams.length && !filteredTeams.length && <span className="block px-2 py-3 text-center text-faint">No teams match that search.</span>}
              </div>
              {!!(f.teams || []).length && <div className="flex items-center justify-between border-t border-line px-2 py-1.5"><span className="text-[10.5px] text-mute">{f.teams.length} selected</span><button type="button" className="text-[10.5px] font-medium text-blue-300 hover:text-blue-200" onClick={() => setF(p => ({ ...p, teams: [], teamName: '', teamLead: '' }))}>Clear selection</button></div>}
            </div>}
          </fieldset>
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
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface/50 px-3 py-2 text-xs"><span className="text-mute">Badge</span><div className="flex flex-wrap items-center gap-2"><span className={cx('font-medium', initial.badgeReturned ? 'text-cyan-300' : initial.badgeIssued ? 'text-emerald-300' : 'text-amber-300')}>{initial.badgeReturned ? 'Returned' : initial.badgeIssued ? 'Issued' : 'Pending'}</span>{!initial.badgeIssued && <button type="button" onClick={() => onSetBadge?.(true)} className="rounded-md bg-amber-500/10 px-2 py-1 text-xs font-semibold text-amber-300">Issue badge</button>}{initial.badgeIssued && !initial.badgeReturned && <button type="button" onClick={() => onSetBadgeReturned?.(true)} className="rounded-md bg-cyan-500/10 px-2 py-1 text-xs font-semibold text-cyan-300">Mark returned</button>}{initial.badgeIssued && <button type="button" onClick={() => onSetBadge?.(false)} className="rounded-md px-2 py-1 text-xs font-semibold text-ink-soft hover:bg-raised">Reset</button>}</div></div>
        {onCallHistory && <button type="button" onClick={onCallHistory} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface/50 px-3 py-2 text-left text-xs hover:bg-raised"><span className="text-mute">Call history</span><span className="font-medium text-blue-300">{initial.callCount} call{initial.callCount === 1 ? '' : 's'} · View</span></button>}
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
  department: ['sub department', 'subdepartment', 'sub dept', 'department', 'dept'], memberType: ['member type', 'sewadar type', 'type', 'member category'],
  joiningDate: ['sewa joining date', 'joining date', 'sewa date', 'promised date', 'date promised'],
  serialNo: ['sr no', 'sr number', 'serial no', 'serial number'], batchNo: ['badge no', 'badge number', 'badge', 'b no', 'batch no', 'batch number', 'b number'],
  relation: ['rel', 'relation'], relationName: ['relation name', 'father name', 'husband name', 'guardian name'],
  villageCity: ['village city', 'village', 'city'], branch: ['branch'], occupation: ['occupation'], remarks: ['remarks', 'remark'],
  employeeCode: ['emp code', 'employee code', 'employee number'], employeeId: ['employee id', 'emp id', 'employee identifier'],
  address: ['address', 'address 1'], address2: ['address 2', 'address line 2'], expectedArrival: ['expected arrival', 'arrival date'], expectedArrivalPeriod: ['expected arrival time', 'arrival time', 'time of day'], skills: ['skills', 'skill set'],
  teamName: ['team', 'team name'], teamLead: ['team lead', 'team leader'], shift: ['shift'], deviceType: ['device', 'device type'], deviceRef: ['device id', 'device serial', 'device reference'],
};
const memberKind = (value: string, fallback: SewadarMemberType): SewadarMemberType => {
  const kind = value.toLowerCase();
  if (kind.includes('annual')) return 'annual';
  if (kind.includes('month') || kind.includes('regular')) return 'monthly';
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
    const arrivalPeriodRaw = cell(values, 'expectedArrivalPeriod', -1).toLowerCase();
    const expectedArrivalPeriod: ArrivalTimeOfDay = ['morning', 'noon', 'evening', 'night'].includes(arrivalPeriodRaw) ? arrivalPeriodRaw as ArrivalTimeOfDay : '';
    const skills = cell(values, 'skills', -1).split(/[;,]/).map(skill => skill.trim()).filter(Boolean);
    const deviceCandidate = cell(values, 'deviceType', 19).toLowerCase();
    const deviceType = DEVICES.find(device => device.key === deviceCandidate || device.label.toLowerCase() === deviceCandidate)?.key || 'none';
    return {
      ...emptySewadar(), name: cell(values, 'name', 0), phone: cell(values, 'phone', 1), department: department?.[0] || '', memberType: type,
              joiningDate, expectedArrival, expectedArrivalPeriod, skills, batchNo: cell(values, 'batchNo', 5), teamName: cell(values, 'teamName', 6), teamLead: cell(values, 'teamLead', 7), teams: cell(values, 'teamName', 6) ? [cell(values, 'teamName', 6)] : [],
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
  const [defaultType, setDefaultType] = useState<SewadarMemberType>('monthly');
  const [busy, setBusy] = useState(false);
  const parsed = useMemo(() => parseSewadarImport(text, defaultType), [text, defaultType]);
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
        <p className="mt-2 text-[11.5px] text-faint">The spreadsheet must be available to viewers or published as CSV. Only the selected sheet tab is imported.</p>
        {sheetError && <p role="alert" className="mt-2 text-xs text-rose-300">{sheetError}</p>}
      </section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-xs text-mute">If the sheet has no member type<select value={defaultType} onChange={e => setDefaultType(e.target.value as SewadarMemberType)} className="h-8 rounded-md border border-line bg-field px-2 text-xs text-ink"><option value="monthly">Regular</option><option value="annual">Annual</option><option value="salary_based">Permanent</option></select></label>
        <label className="flex flex-wrap items-center gap-2 text-xs text-mute">Upload CSV<input type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" onChange={async e => { const file = e.currentTarget.files?.[0]; if (file) setText(await file.text()); }} className="text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-raised file:px-3 file:py-2 file:font-semibold file:text-ink" /></label>
      </div>
      <textarea rows={7} autoFocus value={text} onChange={e => setText(e.target.value)} placeholder={'Paste CSV rows with a header row, for example:\nName,Member type,Mobile,Department\nAmit Sharma,Regular,9876543210,WiFi'} className={cx(inputCls(D), 'font-mono text-xs')} />
      {parsed.length > 0 && <div className="mt-2 rounded-md bg-raised/60 px-2.5 py-2 text-[11.5px] text-mute">Preview: <span className="font-medium text-ink">{parsed.slice(0, 4).map(row => `${row.name} · ${row.memberType.replace('_', ' ')}`).join('  |  ')}</span>{parsed.length > 4 && `  |  +${parsed.length - 4} more`}</div>}
      <div className="flex items-center justify-between mt-4">
        <span className="text-xs text-mute">{parsed.length} ready to import</span>
        <div className="flex gap-2"><button className={btnGhost(D)} onClick={onClose}>Cancel</button><button className={btnPrimary} disabled={!parsed.length || busy} onClick={go}>{busy ? 'Importing…' : `Import ${parsed.length}`}</button></div>
      </div>
    </Modal>
  );
};
