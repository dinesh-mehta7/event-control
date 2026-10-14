import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, Download, FileText, Plus, Radio, Users, ListChecks, Clipboard, CalendarClock } from 'lucide-react';
import { useWalkie } from '../modules/walkie';
import { supabase } from '../modules/walkie/lib/supabaseClient';
import { useManpower } from '../modules/manpower';
import { useEventScope } from '../context/EventScopeContext';
import { ClockTimePicker } from '../components/ClockTimePicker';
import * as XLSX from 'xlsx';
import { useInventory } from '../modules/inventory';

type EventPlan = { id: string; name: string; location: string; starts_at: string; ends_at: string | null; owner_name: string; owner_department_id?: string | null; status: string; event_type?: 'monthly' | 'annual' | 'special'; special_member_ids?: string[] };
type EventDepartment = { id: string; department_id: string; department_name: string; lead_name: string; resource_notes: string; status: string };
type EventMeeting = { id: string; title: string; starts_at: string; agenda: string; minutes: string; event_id: string };
type Requirement = { id: string; category: string; inventory_item_id: string | null; department_id: string | null; department_name: string; title: string; quantity: number; unit: string; notes: string; status: string };
type EventTask = { id: string; event_id: string | null; meeting_id: string | null; parent_task_id: string | null; department_id: string | null; title: string; details: string; resources: string; team: string; assigned_to: string; due_date: string | null; priority_level: string; priority_until: string | null; status: string; created_at: string };
type EventFeedback = { id: string; kind: string; title: string; details: string; reporter_name: string; sub_department: string; status: string; created_at: string };
type Attendance = { id: string; member_id: string; member_name: string; status: string; checked_in_at: string | null; checked_out_at: string | null; notes: string };
type BadgeOperation = { id: string; member_id: string; badge_issued: boolean; badge_at: string | null; badge_returned: boolean; badge_returned_at: string | null; arrival_status: string; arrived_at: string | null };
type RadioReturnReport = { id: string; department_name: string; returned_walkies: number; returned_chargers: number; returned_earphones: number; returned_at: string | null; return_feedback: string; status: string; updated_at: string };
type Review = { id: string; lessons_learned: string; issues_faced: string; recommendations: string; closure_report: string };
const idFor = (prefix: string) => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
const localDay = (value: string | Date) => {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const attendanceDayCount = (row: Attendance, today: string) => {
  if (!row.checked_in_at) return 0;
  const start = localDay(row.checked_in_at);
  const end = localDay(row.checked_out_at || today);
  const toUtc = (day: string) => { const [y, m, d] = day.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.max(0, Math.floor((toUtc(end) - toUtc(start)) / 86400000) + 1);
};
const csvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
const input = 'w-full rounded-md border border-line bg-field px-3 py-2 text-sm text-ink outline-none focus:border-blue-500';
const panel = 'rounded-xl border border-line bg-surface';
const action = 'inline-flex items-center justify-center gap-1.5 rounded-md bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50';
const quiet = 'inline-flex items-center justify-center gap-1.5 rounded-md border border-line px-3 py-2 text-xs font-medium text-ink-soft hover:bg-raised disabled:opacity-50';

const when = (value: string) => new Date(value).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const schemaError = (error: any) => /does not exist|schema cache|could not find/i.test(error?.message || '')
  ? 'Event planning needs its database setup. Run supabase/migration_v76_event_workflow_links.sql in the Supabase SQL Editor, then reload this page.'
  : error?.message || 'Something went wrong. Please try again.';

const EVENT_SECTIONS = [
  { id: 'event-creation', label: 'Event Creation', description: 'Set up the event, choose its type, and select its calling list.', icon: CalendarDays },
  { id: 'pre-event-meetings', label: 'Pre-Event Meetings', description: 'Schedule coordination meetings and capture minutes and action items.', icon: CalendarClock },
  { id: 'requirement-management', label: 'Requirement Management', description: 'Collect and track the resources each department needs.', icon: Clipboard },
  { id: 'task-planning', label: 'Task Planning', description: 'Assign event work, owners, priorities, and due dates.', icon: ListChecks },
  { id: 'team-alignment', label: 'Team Alignment', description: 'Set department leads, readiness, and resource notes.', icon: Users },
  { id: 'post-event-review', label: 'Post-Event Review', description: 'Review attendance, returns, lessons, and event closure.', icon: FileText },
] as const;

export const EventPlanning: React.FC<{ section?: string }> = ({ section }) => {
  const w: any = useWalkie();
  const manpower = useManpower();
  const eventScope = useEventScope();
  const user = w.currentUser;
  const orgId = user?.organizationId as string | undefined;
  const canPlan = ['owner', 'dept_head'].includes(user?.level);
  const canMarkAttendance = canPlan || (user?.level === 'sub_dept_head' && ['sewadars', 'accommodation'].includes(user?.subDepartment));
  const departments: any[] = w.departments || [];
  const [events, setEvents] = useState<EventPlan[]>([]);
  const selectedId = eventScope.scopeFor('event-reports');
  const setSelectedId = (id: string) => eventScope.setScopeFor('event-reports', id);
  const selected = events.find(e => e.id === selectedId) || null;
  const [busy, setBusy] = useState(false);
  const [statusBusyId, setStatusBusyId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [eventForm, setEventForm] = useState<{ name: string; location: string; date: string; time: string; ownerDepartmentId: string; type: 'monthly' | 'annual' | 'special'; memberIds: string[] }>({ name: '', location: '', date: '', time: '', ownerDepartmentId: '', type: 'monthly', memberIds: [] });
  const [eventDepartments, setEventDepartments] = useState<EventDepartment[]>([]);
  const [meetings, setMeetings] = useState<EventMeeting[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [tasks, setTasks] = useState<EventTask[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [badgeOperations, setBadgeOperations] = useState<BadgeOperation[]>([]);
  const [radioReturns, setRadioReturns] = useState<RadioReturnReport[]>([]);
  const [review, setReview] = useState<Review>({ id: '', lessons_learned: '', issues_faced: '', recommendations: '', closure_report: '' });
  const [searchMembers, setSearchMembers] = useState('');
  const [today, setToday] = useState(() => localDay(new Date()));
  const [requirementForm, setRequirementForm] = useState({ category: 'it', departmentId: '', inventoryItemId: '', title: '', quantity: '1', unit: '', notes: '' });
  const [requirementCategory, setRequirementCategory] = useState('it');
  const [taskForm, setTaskForm] = useState({ departmentId: '', team: '', title: '', details: '', resources: '', dueDate: '', priority: 'as_you_have_time', parentTaskId: '' });
  const [feedback, setFeedback] = useState<EventFeedback[]>([]);
  const [eventSearch, setEventSearch] = useState('');
  const inventory = useInventory();
  const activeSection = EVENT_SECTIONS.some(item => item.id === section) ? section! : EVENT_SECTIONS[0].id;

  const loadEvents = useCallback(async () => {
    if (!orgId) return;
    setLoading(true); setError('');
    const { data, error: loadError } = await supabase.from('event_plans').select('*').eq('organization_id', orgId).order('starts_at', { ascending: false });
    if (loadError) setError(schemaError(loadError));
    else {
      const list = (data || []) as EventPlan[];
      setEvents(list);
      const current = eventScope.scopeFor('event-reports');
      if (!list.some(e => e.id === current)) setSelectedId(list[0]?.id || '');
    }
    setLoading(false);
  }, [orgId, eventScope.scopeFor]);

  const loadDetails = useCallback(async (eventId: string) => {
    if (!orgId || !eventId) return;
    const results = await Promise.all([
      supabase.from('event_attendance').select('*').eq('organization_id', orgId).eq('event_id', eventId).order('member_name'),
      supabase.from('event_reviews').select('*').eq('organization_id', orgId).eq('event_id', eventId).maybeSingle(),
      supabase.from('event_radio_requests').select('id,department_name,returned_walkies,returned_chargers,returned_earphones,returned_at,return_feedback,status,updated_at').eq('organization_id', orgId).eq('event_id', eventId).in('status', ['partial_return', 'returned']).order('updated_at', { ascending: false }),
      supabase.from('sewadar_event_operations').select('id,member_id,badge_issued,badge_at,badge_returned,badge_returned_at,arrival_status,arrived_at').eq('organization_id', orgId).eq('event_id', eventId),
      supabase.from('member_issues').select('id,kind,title,details,reporter_name,sub_department,status,created_at').eq('organization_id', orgId).eq('event_id', eventId).order('created_at', { ascending: false }),
    ]);
    const operationsResult = results[3];
    if (operationsResult.error) { setError(`${operationsResult.error.message} — run supabase/migration_v58_event_scoped_member_operations.sql, then reload the schema.`); return; }
    const failed = results.slice(0, 3).concat([results[4]]).find(r => r.error);
    if (failed?.error) { setError(schemaError(failed.error)); return; }
    setAttendance((results[0].data || []) as Attendance[]);
    setReview((results[1].data as Review) || { id: '', lessons_learned: '', issues_faced: '', recommendations: '', closure_report: '' });
    setRadioReturns((results[2].data || []) as RadioReturnReport[]);
    setBadgeOperations((results[3].data || []) as BadgeOperation[]);
    setFeedback((results[4].data || []) as EventFeedback[]);
    const [meetingRows, requirementRows, taskRows, departmentRows] = await Promise.all([
      supabase.from('meetings').select('id,title,starts_at,agenda,minutes,event_id').eq('organization_id', orgId).eq('event_id', eventId).eq('kind', 'meeting').order('starts_at'),
      supabase.from('event_requirements').select('*').eq('organization_id', orgId).eq('event_id', eventId).order('created_at', { ascending: false }),
      supabase.from('manpower_tasks').select('*').eq('organization_id', orgId).eq('event_id', eventId).order('due_date', { ascending: true }),
      supabase.from('event_departments').select('*').eq('organization_id', orgId).eq('event_id', eventId).order('department_name'),
    ]);
    const workflowError = [meetingRows, requirementRows, taskRows, departmentRows].find(result => result.error);
    if (workflowError?.error) { setError(schemaError(workflowError.error)); return; }
    setMeetings((meetingRows.data || []) as EventMeeting[]);
    setRequirements((requirementRows.data || []) as Requirement[]);
    setTasks((taskRows.data || []) as EventTask[]);
    setEventDepartments((departmentRows.data || []) as EventDepartment[]);
  }, [orgId]);

  useEffect(() => { void loadEvents(); }, [loadEvents]);
  useEffect(() => { if (selectedId) void loadDetails(selectedId); }, [selectedId, loadDetails]);
  useEffect(() => { const timer = window.setInterval(() => setToday(localDay(new Date())), 60_000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    if (!orgId || !selectedId) return;
    const channel = supabase.channel(`event-report-${selectedId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_radio_requests', filter: `organization_id=eq.${orgId}` }, (payload: any) => {
        if (payload.new?.event_id === selectedId || payload.old?.event_id === selectedId) void loadDetails(selectedId);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_attendance', filter: `organization_id=eq.${orgId}` }, (payload: any) => {
        if (payload.new?.event_id === selectedId || payload.old?.event_id === selectedId) void loadDetails(selectedId);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sewadar_event_operations', filter: `organization_id=eq.${orgId}` }, (payload: any) => {
        if (payload.new?.event_id === selectedId || payload.old?.event_id === selectedId) void loadDetails(selectedId);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meetings', filter: `organization_id=eq.${orgId}` }, (payload: any) => {
        if (payload.new?.event_id === selectedId || payload.old?.event_id === selectedId) void loadDetails(selectedId);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'manpower_tasks', filter: `organization_id=eq.${orgId}` }, (payload: any) => {
        if (payload.new?.event_id === selectedId || payload.old?.event_id === selectedId) void loadDetails(selectedId);
      }).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [orgId, selectedId, loadDetails]);

  const createEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !eventForm.name.trim() || !eventForm.date || !eventForm.time) return;
    setBusy(true); setError('');
    const eventId = idFor('event');
    const startsAt = new Date(`${eventForm.date}T${eventForm.time}`).toISOString();
    const ownerDepartment = departments.find(department => department.id === eventForm.ownerDepartmentId);
    const { error: createError } = await supabase.from('event_plans').insert({ id: eventId, organization_id: orgId, name: eventForm.name.trim(), location: eventForm.location.trim(), starts_at: startsAt, ends_at: null, owner_name: ownerDepartment?.name || '', owner_department_id: ownerDepartment?.id || null, event_type: eventForm.type, special_member_ids: eventForm.type === 'special' ? eventForm.memberIds : [] });
    if (createError) { setError(schemaError(createError)); setBusy(false); return; }
    setBusy(false); setShowCreate(false); setSelectedId(eventId); eventScope.setScopeFor('sewadars', eventId);
    await eventScope.refreshEvents();
    await loadEvents();
  };

  const updateEvent = async (patch: Partial<EventPlan>) => {
    if (!selected || !orgId || !canPlan) return;
    setBusy(true); setError('');
    const { error: updateError } = await supabase.from('event_plans').update(patch).eq('id', selected.id).eq('organization_id', orgId);
    if (updateError) setError(schemaError(updateError));
    else setEvents(old => old.map(e => e.id === selected.id ? { ...e, ...patch } : e));
    setBusy(false);
  };

  const updateEventStatus = async (event: EventPlan, status: string) => {
    if (!orgId || !canPlan) return;
    setStatusBusyId(event.id); setError('');
    const { error: updateError } = await supabase.from('event_plans').update({ status }).eq('id', event.id).eq('organization_id', orgId);
    if (updateError) setError(schemaError(updateError));
    else setEvents(old => old.map(row => row.id === event.id ? { ...row, status } : row));
    setStatusBusyId('');
  };

  const saveDepartment = async (item: EventDepartment) => {
    if (!orgId || !canPlan) return;
    setBusy(true); setError('');
    const { error: saveError } = await supabase.from('event_departments').update({ lead_name: item.lead_name, resource_notes: item.resource_notes, status: item.status }).eq('id', item.id).eq('organization_id', orgId);
    if (saveError) setError(schemaError(saveError));
    else setEventDepartments(old => old.map(row => row.id === item.id ? item : row));
    setBusy(false);
  };

  const addRequirement = async (e: React.FormEvent) => {
    e.preventDefault();
    const inventoryItem = inventory.items.find(item => item.id === requirementForm.inventoryItemId);
    if (!selected || !orgId || (requirementForm.category === 'inventory' ? !inventoryItem : !requirementForm.title.trim())) return;
    const department = departments.find(d => d.id === requirementForm.departmentId);
    setBusy(true); setError('');
    const { error: saveError } = await supabase.from('event_requirements').insert({ id: idFor('event-req'), organization_id: orgId, event_id: selected.id, category: requirementForm.category, inventory_item_id: inventoryItem?.id || null, department_id: department?.id || null, department_name: department?.name || '', title: inventoryItem?.name || requirementForm.title.trim(), quantity: Math.max(0, Number(requirementForm.quantity) || 0), unit: requirementForm.unit.trim() || inventoryItem?.unit || '', notes: requirementForm.notes.trim() });
    if (saveError) setError(schemaError(saveError)); else { setRequirementForm({ category: requirementCategory, departmentId: '', inventoryItemId: '', title: '', quantity: '1', unit: '', notes: '' }); await loadDetails(selected.id); }
    setBusy(false);
  };

  const addTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected || !orgId || !taskForm.title.trim() || !taskForm.team) return;
    const department = departments.find(d => d.id === taskForm.departmentId);
    const team = manpower.teams.find(item => item.name === taskForm.team);
    setBusy(true); setError('');
    const { error: saveError } = await supabase.from('manpower_tasks').insert({ id: idFor('event-task'), organization_id: orgId, event_id: selected.id, parent_task_id: taskForm.parentTaskId || null, meeting_id: null, department_id: department?.id || null, title: taskForm.title.trim(), details: taskForm.details.trim(), resources: taskForm.resources.trim(), team: taskForm.team, assigned_to: team?.lead || '', due_date: taskForm.dueDate || null, priority_level: taskForm.priority, priority_until: taskForm.priority === 'till_time' && taskForm.dueDate ? `${taskForm.dueDate}T23:59:00` : null, status: 'todo' });
    if (saveError) setError(schemaError(saveError)); else { setTaskForm({ departmentId: '', team: '', title: '', details: '', resources: '', dueDate: '', priority: 'as_you_have_time', parentTaskId: '' }); await loadDetails(selected.id); }
    setBusy(false);
  };

  const updateRequirementStatus = async (item: Requirement, status: Requirement['status']) => {
    if (!orgId || !canPlan) return;
    setBusy(true); setError('');
    const { error: saveError } = await supabase.from('event_requirements').update({ status }).eq('id', item.id).eq('organization_id', orgId);
    if (saveError) setError(schemaError(saveError)); else setRequirements(old => old.map(row => row.id === item.id ? { ...row, status } : row));
    setBusy(false);
  };

  const alignDepartments = async () => {
    if (!selected || !orgId || !canPlan) return;
    const rows = departments.map((department: any) => ({ id: `${selected.id}-${department.id}`, organization_id: orgId, event_id: selected.id, department_id: department.id, department_name: department.name || department.departmentName || department.id }));
    if (!rows.length) return;
    setBusy(true); setError('');
    const { error: saveError } = await supabase.from('event_departments').upsert(rows, { onConflict: 'event_id,department_id', ignoreDuplicates: true });
    if (saveError) setError(schemaError(saveError)); else await loadDetails(selected.id);
    setBusy(false);
  };

  const updateTaskStatus = async (task: EventTask, status: string) => {
    if (!selected || !orgId || !(canPlan || (!!user?.name && task.assigned_to === user.name))) return;
    setBusy(true); setError('');
    const { error: saveError } = await supabase.from('manpower_tasks').update({ status }).eq('id', task.id).eq('organization_id', orgId);
    if (saveError) setError(schemaError(saveError)); else setTasks(old => old.map(t => t.id === task.id ? { ...t, status } : t));
    setBusy(false);
  };

  const setMemberAttendance = async (member: typeof manpower.sewadars[number], current: Attendance | undefined, next: 'present' | 'checked_out' | 'absent') => {
    if (!selected || !orgId || !canMarkAttendance) return;
    const now = new Date().toISOString();
    const row = {
      id: current?.id || idFor('attendance'), organization_id: orgId, event_id: selected.id,
      member_id: member.id, member_name: member.name,
      status: next,
      checked_in_at: next === 'present' ? (current?.checked_in_at || now) : current?.checked_in_at || null,
      checked_out_at: next === 'checked_out' ? now : null,
      notes: current?.notes || '',
    };
    setBusy(true); setError('');
    const { error: saveError } = await supabase.from('event_attendance').upsert(row, { onConflict: 'event_id,member_id' });
    if (saveError) setError(schemaError(saveError)); else await loadDetails(selected.id);
    setBusy(false);
  };

  const saveReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected || !orgId || !canPlan) return;
    setBusy(true); setError('');
    const { error: saveError } = await supabase.from('event_reviews').upsert({ id: review.id || idFor('event-review'), organization_id: orgId, event_id: selected.id, lessons_learned: review.lessons_learned, issues_faced: review.issues_faced, recommendations: review.recommendations, closure_report: review.closure_report, updated_at: new Date().toISOString() }, { onConflict: 'event_id' });
    if (saveError) setError(schemaError(saveError)); else await loadDetails(selected.id);
    setBusy(false);
  };

  const attendanceByMember = useMemo(() => new Map(attendance.map(a => [a.member_id, a])), [attendance]);
  const badgeByMember = useMemo(() => new Map(badgeOperations.map(op => [op.member_id, op])), [badgeOperations]);
  const setBadgeState = async (memberId: string, change: 'issue' | 'return') => {
    if (!selected || !orgId || !canMarkAttendance) return;
    setBusy(true); setError('');
    const { data: existing, error: readError } = await supabase.from('sewadar_event_operations').select('*').eq('organization_id', orgId).eq('event_scope_key', selected.id).eq('member_id', memberId).maybeSingle();
    if (readError) { setError(schemaError(readError)); setBusy(false); return; }
    const now = new Date().toISOString();
    const row = {
      id: existing?.id || idFor('sewadar-op'), organization_id: orgId, event_id: selected.id,
      event_scope_key: selected.id, member_id: memberId,
      arrival_status: existing?.arrival_status || 'pending', arrived_at: existing?.arrived_at || null,
      badge_issued: change === 'issue' ? true : existing?.badge_issued || false,
      badge_at: change === 'issue' ? existing?.badge_at || now : existing?.badge_at || null,
      badge_returned: change === 'return' ? true : existing?.badge_returned || false,
      badge_returned_at: change === 'return' ? now : existing?.badge_returned_at || null,
      updated_at: now,
    };
    const { error: saveError } = await supabase.from('sewadar_event_operations').upsert(row, { onConflict: 'organization_id,event_scope_key,member_id' });
    if (saveError) setError(schemaError(saveError)); else await loadDetails(selected.id);
    setBusy(false);
  };
  const eventMembers = useMemo(() => {
    const eligible = manpower.sewadars.filter(member => member.memberType !== 'salary_based');
    const type = selected?.event_type || 'annual';
    const roster = type === 'monthly' ? eligible.filter(member => member.memberType === 'monthly')
      : type === 'special' ? eligible.filter(member => (selected?.special_member_ids || []).includes(member.id)) : eligible;
    const query = searchMembers.trim().toLowerCase();
    return roster.filter(s => `${s.name} ${s.phone} ${s.teamName} ${s.batchNo}`.toLowerCase().includes(query));
  }, [manpower.sewadars, searchMembers, selected]);
  const downloadAttendance = () => {
    if (!selected) return;
    const rows = [
      ['Event', 'Sewadar', 'Phone', 'Team', 'Status', 'Arrived at', 'Returned back', 'Badge', 'Badge returned at', 'Attendance days', 'Notes'],
      ...eventMembers.map(member => {
        const record = attendanceByMember.get(member.id);
        const status = record?.status === 'present' ? 'Here now' : record?.status === 'checked_out' ? 'Returned back' : record?.status === 'absent' ? 'Absent' : 'Expected';
        const badge = badgeByMember.get(member.id);
        return [selected.name, member.name, member.phone || '', member.teamName || '', status, record?.checked_in_at ? new Date(record.checked_in_at).toLocaleString('en-IN') : '', record?.checked_out_at ? new Date(record.checked_out_at).toLocaleString('en-IN') : '', badge?.badge_returned ? 'Returned' : badge?.badge_issued ? 'Issued' : 'Not issued', badge?.badge_returned_at ? new Date(badge.badge_returned_at).toLocaleString('en-IN') : '', record ? attendanceDayCount(record, today) : 0, record?.notes || ''];
      }),
    ];
    const csv = rows.map(row => row.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${selected.name.trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'event'}-attendance.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const attendanceStats = useMemo(() => ({ active: attendance.filter(a => a.status === 'present').length, returned: attendance.filter(a => a.status === 'checked_out').length, absent: attendance.filter(a => a.status === 'absent').length, days: attendance.reduce((sum, a) => sum + attendanceDayCount(a, today), 0) }), [attendance, today]);
  const visibleEvents = useMemo(() => events
    .filter(event => `${event.name} ${event.location} ${event.owner_name} ${event.status}`.toLowerCase().includes(eventSearch.trim().toLowerCase()))
    .sort((a, b) => {
      const rank = (status: string) => status === 'live' ? 0 : ['planning', 'ready'].includes(status) ? 1 : status === 'complete' ? 2 : 3;
      return rank(a.status) - rank(b.status) || (rank(a.status) === 1
        ? new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()
        : new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime());
    }), [events, eventSearch]);
  const visibleRequirements = useMemo(() => requirements.filter(item => item.category === requirementCategory), [requirements, requirementCategory]);
  const exportEvents = () => {
    const rows = events.map(event => ({ 'Event name': event.name, Location: event.location, 'Date & time': new Date(event.starts_at).toLocaleString('en-IN'), 'Event owner (department)': departments.find(department => department.id === event.owner_department_id)?.name || event.owner_name, Type: event.event_type || 'annual', Status: event.status }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows.length ? rows : [{ 'Event name': 'No events' }]), 'Events');
    XLSX.writeFile(workbook, 'event-list.xlsx');
  };
  const exportRequirements = () => {
    const workbook = XLSX.utils.book_new();
    const categories = ['it', 'sewadar', 'inventory', 'accommodation', 'other'];
    for (const category of categories) {
      const rows = requirements.filter(row => row.category === category).map(row => ({
        'Event name': selected?.name || '', 'Event date & time': selected ? new Date(selected.starts_at).toLocaleString('en-IN') : '',
        Category: category[0].toUpperCase() + category.slice(1), Department: row.department_name || 'Unassigned',
        Requirement: row.title, Quantity: row.quantity, Unit: row.unit, Notes: row.notes,
        Status: row.status.replace('_', ' '), 'Inventory item ID': row.inventory_item_id || '', 'Requirement ID': row.id,
      }));
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows.length ? rows : [{ Information: 'No requirements in this category' }]), category[0].toUpperCase() + category.slice(1, 31));
    }
    const safe = selected?.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'event';
    XLSX.writeFile(workbook, `${safe}-requirements.xlsx`);
  };
  const downloadEventReport = async (event: EventPlan) => {
    if (!orgId) return;
    setBusy(true); setError('');
    const [meetingsResult, requirementsResult, tasksResult, teamsResult, attendanceResult, reviewResult, feedbackResult] = await Promise.all([
      supabase.from('meetings').select('title,starts_at,agenda,minutes,status,mode,place,created_by_name').eq('organization_id', orgId).eq('event_id', event.id).eq('kind', 'meeting'),
      supabase.from('event_requirements').select('*').eq('organization_id', orgId).eq('event_id', event.id),
      supabase.from('manpower_tasks').select('*').eq('organization_id', orgId).eq('event_id', event.id),
      supabase.from('event_departments').select('*').eq('organization_id', orgId).eq('event_id', event.id),
      supabase.from('event_attendance').select('*').eq('organization_id', orgId).eq('event_id', event.id),
      supabase.from('event_reviews').select('*').eq('organization_id', orgId).eq('event_id', event.id).maybeSingle(),
      supabase.from('member_issues').select('kind,title,details,reporter_name,sub_department,status,created_at').eq('organization_id', orgId).eq('event_id', event.id),
    ]);
    const failed = [meetingsResult, requirementsResult, tasksResult, teamsResult, attendanceResult, reviewResult, feedbackResult].find(result => result.error);
    if (failed?.error) { setError(schemaError(failed.error)); setBusy(false); return; }
    const workbook = XLSX.utils.book_new();
    const addSheet = (name: string, rows: any[]) => XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows.length ? rows : [{ Information: 'No records' }]), name);
    addSheet('Event', [{ 'Event name': event.name, Location: event.location, 'Date & time': new Date(event.starts_at).toLocaleString('en-IN'), 'Owner department': departments.find(department => department.id === event.owner_department_id)?.name || event.owner_name, Type: event.event_type || 'annual', Status: event.status }]);
    addSheet('Meetings', meetingsResult.data || []); addSheet('Requirements', requirementsResult.data || []); addSheet('Tasks', tasksResult.data || []); addSheet('Team alignment', teamsResult.data || []); addSheet('Attendance', attendanceResult.data || []); addSheet('Department feedback', feedbackResult.data || []); addSheet('Review', reviewResult.data ? [reviewResult.data] : []);
    const safe = event.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'event';
    XLSX.writeFile(workbook, `${safe}-event-report.xlsx`);
    setBusy(false);
  };
  const sectionTitle = EVENT_SECTIONS.find(item => item.id === activeSection)!;
  const SectionIcon = sectionTitle.icon;

  return <div className="space-y-4">
    <header><div className="flex items-center gap-2"><SectionIcon size={18} className="text-blue-400" /><h2 className="text-xl font-semibold text-ink">{sectionTitle.label}</h2></div><p className="mt-1 text-sm text-mute">{sectionTitle.description}</p></header>
    {error && <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</div>}
    {loading ? <div className={`${panel} p-8 text-center text-sm text-mute`}>Loading events…</div> : <>
      {activeSection !== 'event-creation' && <section className={`${panel} flex flex-wrap items-end gap-3 p-4`}>
        <label className="min-w-60 flex-1 text-xs text-mute">Current event<select className={`${input} mt-1`} value={selectedId} onChange={e => setSelectedId(e.target.value)} aria-label="Choose event">{!events.length && <option value="">No events created</option>}{events.map(event => <option key={event.id} value={event.id}>{event.name} · {event.event_type || 'Annual'} · {when(event.starts_at)}</option>)}</select></label>
        {selected && <div className="text-xs text-mute">{selected.status.replace('_', ' ')} · {when(selected.starts_at)}{selected.owner_name ? ` · Owner: ${selected.owner_name}` : ''}</div>}
      </section>}

      {activeSection === 'event-creation' && <>
        <section className={`${panel} overflow-hidden`}>
          <div className="flex flex-wrap items-center gap-2 border-b border-line p-4"><input className={`${input} max-w-xs`} placeholder="Search events" aria-label="Search events" value={eventSearch} onChange={e => setEventSearch(e.target.value)} /><span className="text-xs text-mute">{visibleEvents.length} event{visibleEvents.length === 1 ? '' : 's'}</span><div className="ml-auto flex gap-2"><button type="button" className={quiet} onClick={exportEvents}><Download size={14} />Export Excel</button>{canPlan && <button className={action} type="button" onClick={() => setShowCreate(value => !value)}><Plus size={15} />{showCreate ? 'Close' : 'Add event'}</button>}</div></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-raised text-xs uppercase tracking-wide text-mute"><tr>{['Event name','Location','Date & time','Event owner (department)','Status','Reports'].map(label => <th key={label} className="px-4 py-3">{label}</th>)}</tr></thead><tbody className="divide-y divide-line">{visibleEvents.map((event, index) => <tr key={event.id} className={event.status === 'live' ? 'bg-emerald-500/[0.06]' : ''}><td className="px-4 py-3 font-medium text-ink">{event.name}{event.status === 'live' && index === 0 && <span className="ml-2 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300">Ongoing · Top priority</span>}<div className="text-xs capitalize text-mute">{event.event_type || 'annual'}</div></td><td className="px-4 py-3 text-ink-soft">{event.location || '—'}</td><td className="px-4 py-3 text-ink-soft">{when(event.starts_at)}</td><td className="px-4 py-3 text-ink-soft">{departments.find(department => department.id === event.owner_department_id)?.name || event.owner_name || '—'}</td><td className="px-4 py-3"><select aria-label={`Status for ${event.name}`} className={`${input} min-w-36`} disabled={!canPlan || statusBusyId === event.id} value={event.status} onChange={e => void updateEventStatus(event, e.target.value)}><option value="planning">Planning</option><option value="ready">Ready</option><option value="live">Live</option><option value="complete">Complete</option><option value="cancelled">Cancelled</option></select></td><td className="px-4 py-3"><div className="flex flex-wrap gap-2"><button className={quiet} type="button" disabled={busy} onClick={() => void downloadEventReport(event)}><Download size={13} />Excel report</button><button className={quiet} type="button" onClick={() => { setSelectedId(event.id); location.hash = '#/events/post-event-review'; }}>View reports</button></div></td></tr>)}{!visibleEvents.length && <tr><td colSpan={6} className="p-8 text-center text-sm text-mute">No events match this search.</td></tr>}</tbody></table></div>
        </section>
        {showCreate && <form onSubmit={createEvent} className={`${panel} grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4`}>
          <label className="text-xs text-mute">Event name<input required className={`${input} mt-1`} value={eventForm.name} onChange={e => setEventForm({ ...eventForm, name: e.target.value })} placeholder="Annual gathering" /></label>
          <label className="text-xs text-mute">Location<input required className={`${input} mt-1`} value={eventForm.location} onChange={e => setEventForm({ ...eventForm, location: e.target.value })} placeholder="Main hall" /></label>
          <label className="text-xs text-mute">Event date<input required type="date" className={`${input} mt-1`} value={eventForm.date} onChange={e => setEventForm({ ...eventForm, date: e.target.value })} /></label>
          <label className="text-xs text-mute">Start time<ClockTimePicker label="Event start time" className="mt-1" value={eventForm.time} onChange={time => setEventForm({ ...eventForm, time })} /></label>
          <label className="text-xs text-mute">Event owner (department)<select required className={`${input} mt-1`} value={eventForm.ownerDepartmentId} onChange={e => setEventForm({ ...eventForm, ownerDepartmentId: e.target.value })}><option value="">Choose department</option>{departments.map((department: any) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label>
          <label className="text-xs text-mute">Event type<select required className={`${input} mt-1`} value={eventForm.type} onChange={e => setEventForm({ ...eventForm, type: e.target.value as typeof eventForm.type, memberIds: [] })}><option value="monthly">Monthly</option><option value="annual">Annual</option><option value="special">Special</option></select></label>
          {eventForm.type === 'special' && <div className="sm:col-span-2 xl:col-span-4"><div className="mb-1 text-xs text-mute">Choose Sewadars for this event’s calling list.</div><div className="grid max-h-44 gap-1 overflow-auto rounded-lg border border-line bg-raised/40 p-2 sm:grid-cols-2 xl:grid-cols-3">{manpower.sewadars.filter(member => member.memberType !== 'salary_based').map(member => <label key={member.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-ink hover:bg-raised"><input type="checkbox" checked={eventForm.memberIds.includes(member.id)} onChange={e => setEventForm(current => ({ ...current, memberIds: e.target.checked ? [...current.memberIds, member.id] : current.memberIds.filter(id => id !== member.id) }))} /><span className="truncate">{member.name}</span><span className="ml-auto text-mute">{member.memberType === 'monthly' ? 'Regular' : 'Annual'}</span></label>)}</div></div>}
          <div className="flex items-end"><button className={action} disabled={busy || (eventForm.type === 'special' && eventForm.memberIds.length === 0)}>{busy ? 'Saving…' : 'Save event'}</button></div>
        </form>}
        {!selected ? <div className={`${panel} p-8 text-center text-sm text-mute`}>Create an event to begin planning.</div> : <section className={`${panel} space-y-3 p-4`}><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold text-ink">{selected.name}</h3><p className="text-sm text-mute">{selected.event_type || 'Annual'} event · {when(selected.starts_at)} · Organized by {departments.find(department => department.id === selected.owner_department_id)?.name || selected.owner_name || '—'}</p></div><button type="button" className={quiet} disabled={busy} onClick={() => void downloadEventReport(selected)}><Download size={14} />Download event report</button></div>{canPlan && <label className="block max-w-xl text-xs text-mute">Location<input className={`${input} mt-1`} value={selected.location} onChange={e => setEvents(old => old.map(row => row.id === selected.id ? { ...row, location: e.target.value } : row))} onBlur={e => void updateEvent({ location: e.target.value })} /></label>}</section>}
      </>}

      {activeSection === 'pre-event-meetings' && <>
        {!selected ? <div className={`${panel} p-6 text-sm text-mute`}>Create an event first to schedule its coordination meetings.</div> : <>
          <a href="#/meetings/meetings" className={action}>Schedule or manage meetings</a>
          {!meetings.length ? <div className={`${panel} p-6 text-center text-sm text-mute`}>No meetings are linked to this event yet. In Meetings, choose “Event-related meeting” and select this event.</div> : meetings.map(meeting => <article key={meeting.id} className={`${panel} space-y-2 p-4`}><div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-semibold text-ink">{meeting.title}</h3><p className="text-xs text-mute">{when(meeting.starts_at)}{meeting.agenda ? ` · ${meeting.agenda}` : ''}</p></div><a href="#/meetings/meetings" className={quiet}>Open meeting and action tasks</a></div><div className="rounded-lg bg-raised/40 p-3"><div className="text-[10px] font-semibold uppercase tracking-wide text-blue-300">Minutes of meeting</div><p className="mt-1 whitespace-pre-wrap text-sm text-ink-soft">{meeting.minutes || 'Minutes have not been recorded yet.'}</p></div><div className="text-xs text-mute">{tasks.filter(task => task.meeting_id === meeting.id).length} action task(s) linked and visible in Task Planning.</div></article>)}
        </>}
      </>}

      {activeSection === 'requirement-management' && <>
        {!selected ? <div className={`${panel} p-6 text-sm text-mute`}>Create an event first to manage requirements.</div> : <>
          <section className={`${panel} overflow-hidden`}>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-3"><div className="flex flex-wrap gap-2">{['it','sewadar','inventory','accommodation','other'].map(category => { const count = requirements.filter(item => item.category === category).length; const active = requirementCategory === category; return <button type="button" key={category} onClick={() => { setRequirementCategory(category); setRequirementForm(old => ({ ...old, category, inventoryItemId: '', title: '' })); }} className={`rounded-lg px-3 py-2 text-xs font-medium capitalize ${active ? 'bg-blue-600 text-white' : 'text-ink-soft hover:bg-raised'}`}>{category === 'it' ? 'IT' : category === 'sewadar' ? 'Sewadar' : category === 'other' ? 'Other' : category[0].toUpperCase() + category.slice(1)}<span className={`ml-2 rounded-full px-1.5 py-0.5 ${active ? 'bg-white/15' : 'bg-raised'}`}>{count}</span></button>; })}</div><button type="button" className={quiet} onClick={exportRequirements}><Download size={14} />Export requirements Excel</button></div>
            <div className="px-4 py-3"><h3 className="text-sm font-semibold text-ink">{requirementCategory === 'it' ? 'IT' : requirementCategory[0].toUpperCase() + requirementCategory.slice(1)} requirements</h3><p className="mt-1 text-xs text-mute">Separate category workspace with structured fields and a spreadsheet export covering every category.</p></div>
            {canPlan && <form onSubmit={addRequirement} className="grid gap-3 border-t border-line p-4 sm:grid-cols-2 xl:grid-cols-4"><h4 className="sm:col-span-2 xl:col-span-4 text-sm font-semibold text-ink">Add {requirementCategory === 'it' ? 'IT' : requirementCategory} requirement</h4><label className="text-xs text-mute">Department responsible<select className={`${input} mt-1`} value={requirementForm.departmentId} onChange={e => setRequirementForm({ ...requirementForm, departmentId: e.target.value })}><option value="">Unassigned</option>{departments.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>{requirementCategory === 'inventory' ? <label className="text-xs text-mute">Inventory item<select required className={`${input} mt-1`} value={requirementForm.inventoryItemId} onChange={e => { const item = inventory.items.find(row => row.id === e.target.value); setRequirementForm(old => ({ ...old, inventoryItemId: e.target.value, unit: item?.unit || old.unit })); }}><option value="">Select an item</option>{inventory.items.map(item => <option key={item.id} value={item.id}>{item.name} ({item.unit})</option>)}</select></label> : <label className="text-xs text-mute">{requirementCategory === 'accommodation' ? 'Room or accommodation type' : requirementCategory === 'sewadar' ? 'Volunteer role or team' : 'Equipment or service needed'}<input required className={`${input} mt-1`} placeholder={requirementCategory === 'accommodation' ? 'e.g. Rest rooms, control rooms' : requirementCategory === 'sewadar' ? 'e.g. Setup volunteers' : 'Describe what is needed'} value={requirementForm.title} onChange={e => setRequirementForm({ ...requirementForm, title: e.target.value })} /></label>}<label className="text-xs text-mute">Quantity and unit<div className="mt-1 flex gap-2"><input required type="number" min="0" className={input} value={requirementForm.quantity} onChange={e => setRequirementForm({ ...requirementForm, quantity: e.target.value })} /><input required={requirementCategory !== 'inventory'} className={input} placeholder={requirementCategory === 'accommodation' ? 'rooms' : requirementCategory === 'sewadar' ? 'people' : 'units'} value={requirementForm.unit} onChange={e => setRequirementForm({ ...requirementForm, unit: e.target.value })} /></div></label><label className="text-xs text-mute sm:col-span-2">Specifications / notes<input className={`${input} mt-1`} placeholder="Sizes, timing, location, or other details" value={requirementForm.notes} onChange={e => setRequirementForm({ ...requirementForm, notes: e.target.value })} /></label><button className={`${action} justify-self-start`} disabled={busy}><Plus size={14} />Add to {requirementCategory} list</button>{requirementCategory === 'inventory' && <p className="self-center text-xs text-mute sm:col-span-2">Published requests sync to Inventory → Event Requirements.</p>}</form>}
            {!visibleRequirements.length ? <div className="border-t border-line p-6 text-center text-sm text-mute">No {requirementCategory} requirements recorded for this event.</div> : <div className="overflow-x-auto border-t border-line"><table className="w-full min-w-[760px] text-left text-xs"><thead className="bg-raised text-mute"><tr>{['Requirement','Department','Quantity','Specifications','Status'].map(label => <th key={label} className="px-4 py-3 font-semibold uppercase tracking-wide">{label}</th>)}</tr></thead><tbody className="divide-y divide-line">{visibleRequirements.map(item => <tr key={item.id}><td className="px-4 py-3 font-medium text-ink">{item.title}<span className="mt-1 block text-[10px] font-normal text-mute">{item.id}</span></td><td className="px-4 py-3 text-ink-soft">{item.department_name || 'Unassigned'}</td><td className="px-4 py-3 text-ink-soft">{item.quantity} {item.unit}</td><td className="max-w-md whitespace-pre-wrap px-4 py-3 text-ink-soft">{item.notes || '—'}</td><td className="px-4 py-3"><select aria-label={`Status for ${item.title}`} className={`${input} min-w-36`} disabled={!canPlan || busy} value={item.status} onChange={e => void updateRequirementStatus(item, e.target.value as Requirement['status'])}>{['requested','in_progress','ready','not_needed'].map(v => <option key={v} value={v}>{v.replace('_',' ')}</option>)}</select></td></tr>)}</tbody></table></div>}
          </section>
        </>}
      </>}

      {activeSection === 'task-planning' && <>
        {!selected ? <div className={`${panel} p-6 text-sm text-mute`}>Create an event first to plan tasks.</div> : <>
          {canPlan && <form onSubmit={addTask} className={`${panel} grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4`}><h3 className="sm:col-span-2 xl:col-span-4 text-sm font-semibold text-ink">Plan task or subtask</h3><label className="text-xs text-mute">Task title<input required className={`${input} mt-1`} value={taskForm.title} onChange={e => setTaskForm({ ...taskForm, title: e.target.value })} /></label><label className="text-xs text-mute">Parent task (optional)<select className={`${input} mt-1`} value={taskForm.parentTaskId} onChange={e => setTaskForm({ ...taskForm, parentTaskId: e.target.value })}><option value="">Top-level task</option>{tasks.filter(task => !task.parent_task_id).map(task => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label><label className="text-xs text-mute">Department<select className={`${input} mt-1`} value={taskForm.departmentId} onChange={e => setTaskForm({ ...taskForm, departmentId: e.target.value })}><option value="">Unassigned</option>{departments.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label><label className="text-xs text-mute">Team<select required className={`${input} mt-1`} value={taskForm.team} onChange={e => setTaskForm({ ...taskForm, team: e.target.value })}><option value="">Select team</option>{manpower.teams.map(team => <option key={team.id} value={team.name}>{team.name}</option>)}</select></label><label className="text-xs text-mute">Due date<input type="date" className={`${input} mt-1`} value={taskForm.dueDate} onChange={e => setTaskForm({ ...taskForm, dueDate: e.target.value })} /></label><label className="text-xs text-mute">Priority<select className={`${input} mt-1`} value={taskForm.priority} onChange={e => setTaskForm({ ...taskForm, priority: e.target.value })}><option value="immediately">Immediately</option><option value="till_time">High (due by)</option><option value="as_you_have_time">As you have time</option></select></label><label className="text-xs text-mute sm:col-span-2">Resources<input className={`${input} mt-1`} placeholder="Equipment, people, or supplies" value={taskForm.resources} onChange={e => setTaskForm({ ...taskForm, resources: e.target.value })} /></label><label className="text-xs text-mute sm:col-span-2">Details<textarea className={`${input} mt-1`} rows={2} value={taskForm.details} onChange={e => setTaskForm({ ...taskForm, details: e.target.value })} /></label><button className={`${action} justify-self-start`} disabled={busy || !taskForm.team}><Plus size={14} />Add task</button></form>}
          {!tasks.length ? <div className={`${panel} p-6 text-center text-sm text-mute`}>No tasks planned yet.</div> : <div className="space-y-3">{tasks.filter(task => !task.parent_task_id).map(task => { const children = tasks.filter(child => child.parent_task_id === task.id); const completed = children.filter(child => child.status === 'complete').length; const progress = children.length ? Math.round(completed / children.length * 100) : task.status === 'complete' ? 100 : task.status === 'in_progress' ? 50 : 0; return <article key={task.id} className={`${panel} space-y-3 p-4`}><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-48 flex-1"><h3 className="text-sm font-semibold text-ink">{task.title}</h3><p className="mt-1 text-xs text-mute">{task.team || 'Unassigned team'} · {task.due_date || 'No due date'} · {task.priority_level === 'immediately' ? 'Immediately' : task.priority_level === 'till_time' ? 'High' : 'As you have time'}</p>{(task.details || task.resources) && <p className="mt-2 text-xs text-ink-soft">{task.details}{task.resources ? ` · Resources: ${task.resources}` : ''}</p>}</div><select aria-label={`Status for ${task.title}`} className={`${input} max-w-40`} disabled={(!canPlan && task.assigned_to !== user?.name) || busy} value={task.status} onChange={e => void updateTaskStatus(task, e.target.value)}>{['todo','in_progress','complete'].map(v => <option key={v} value={v}>{v.replace('_',' ')}</option>)}</select></div><div><div className="mb-1 flex justify-between text-xs text-mute"><span>{children.length ? `${completed}/${children.length} subtasks complete` : 'Task progress'}</span><span>{progress}%</span></div><div className="h-2 overflow-hidden rounded-full bg-raised"><div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${progress}%` }} /></div></div>{children.length > 0 && <div className="space-y-2 border-l border-line pl-4">{children.map(child => <div key={child.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-raised/30 p-3"><div><div className="text-sm text-ink">{child.title}</div><div className="mt-1 text-xs text-mute">{child.team} · {child.due_date || 'No due date'}{child.resources ? ` · ${child.resources}` : ''}</div></div><select aria-label={`Status for ${child.title}`} className={`${input} max-w-40`} disabled={(!canPlan && child.assigned_to !== user?.name) || busy} value={child.status} onChange={e => void updateTaskStatus(child, e.target.value)}>{['todo','in_progress','complete'].map(v => <option key={v} value={v}>{v.replace('_',' ')}</option>)}</select></div>)}</div>}</article>; })}{tasks.filter(task => task.parent_task_id && !tasks.some(parent => parent.id === task.parent_task_id)).map(task => <article key={task.id} className={`${panel} p-4 text-sm text-amber-300`}>Orphaned subtask: {task.title}</article>)}</div>}
        </>}
      </>}

      {activeSection === 'team-alignment' && <>
        {!selected ? <div className={`${panel} p-6 text-sm text-mute`}>Create an event first to align teams.</div> : <>
          {canPlan && <div className="flex justify-end"><button className={action} type="button" disabled={busy} onClick={() => void alignDepartments()}><Users size={14} />{eventDepartments.length ? 'Add missing departments' : 'Set up department roster'}</button></div>}
          {!eventDepartments.length ? <div className={`${panel} p-6 text-center text-sm text-mute`}>Set up the department roster to assign leads and readiness.</div> : <div className="grid gap-3 lg:grid-cols-2">{eventDepartments.map(item => <TeamAlignmentCard key={item.id} item={item} canPlan={canPlan} busy={busy} onSave={saveDepartment} />)}</div>}
        </>}
      </>}

      {activeSection === 'post-event-review' && (!selected ? <div className={`${panel} p-6 text-sm text-mute`}>Create an event first to record its review.</div> : <>
        <section className={`${panel} overflow-hidden`}><div className="border-b border-line p-4"><h3 className="text-sm font-semibold">Department feedback and reported issues</h3><p className="mt-1 text-xs text-mute">Feedback linked to this event, including reports submitted from the department feedback flow.</p></div>{feedback.length ? <div className="divide-y divide-line">{feedback.map(item => <article key={item.id} className="p-4"><div className="flex flex-wrap items-start justify-between gap-2"><div><h4 className="text-sm font-medium text-ink">{item.title || item.kind}</h4><p className="mt-1 text-xs text-mute">{item.sub_department || 'Department'} · {item.reporter_name || 'Reporter'} · {new Date(item.created_at).toLocaleString('en-IN')}</p></div><span className="rounded-full bg-raised px-2 py-1 text-xs text-ink-soft">{item.status || item.kind}</span></div><p className="mt-2 whitespace-pre-wrap text-sm text-ink-soft">{item.details}</p></article>)}</div> : <p className="p-4 text-sm text-mute">No department feedback or issue reports are linked to this event yet.</p>}</section>
        <section className={`${panel} p-4`}><div className="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-3"><div><h3 className="text-sm font-semibold">Sewadar attendance</h3><p className="mt-1 text-xs text-mute">{selected.event_type === 'monthly' ? 'Regular members only.' : selected.event_type === 'special' ? `${(selected.special_member_ids || []).length} selected Sewadars.` : 'All regular and annual members.'}</p></div><div className="flex flex-wrap items-center gap-2"><input className={`${input} max-w-xs`} placeholder="Search Sewadars or team" aria-label="Search Sewadars" value={searchMembers} onChange={e => setSearchMembers(e.target.value)} /><button type="button" className={quiet} disabled={manpower.loading || !eventMembers.length} onClick={downloadAttendance}><Download size={14} />Download CSV</button></div></div><div className="mt-3 grid grid-cols-2 gap-2 xl:grid-cols-4">{[['Here now', attendanceStats.active, 'text-emerald-300'],['Attendance days', attendanceStats.days, 'text-blue-300'],['Returned back', attendanceStats.returned, 'text-cyan-300'],['Absent', attendanceStats.absent, 'text-rose-300']].map(([label,value,tone]) => <div key={label} className="rounded-lg border border-line bg-raised/40 p-3"><div className="text-xs text-mute">{label}</div><div className={`mt-1 text-xl font-semibold tabular-nums ${tone}`}>{value}</div></div>)}</div>{manpower.loading ? <p className="py-6 text-sm text-mute">Loading Sewadar roster…</p> : <div className="mt-3 overflow-x-auto rounded-lg border border-line"><table className="w-full min-w-[760px] text-left text-xs"><thead className="bg-raised text-mute"><tr>{['Sewadar','Team','Status','Arrived','Returned','Badge','Days','Action'].map(label => <th key={label} className="px-3 py-2.5">{label}</th>)}</tr></thead><tbody className="divide-y divide-line">{eventMembers.map(member => { const a = attendanceByMember.get(member.id); const badge = badgeByMember.get(member.id); const days = a ? attendanceDayCount(a, today) : 0; const status = a?.status === 'present' ? 'Here now' : a?.status === 'checked_out' ? 'Returned' : a?.status === 'absent' ? 'Absent' : 'Expected'; return <tr key={member.id}><td className="px-3 py-2.5 font-medium text-ink">{member.name}</td><td className="px-3 py-2.5 text-mute">{member.teamName || '—'}</td><td className="px-3 py-2.5 text-mute">{status}</td><td className="px-3 py-2.5 text-mute">{a?.checked_in_at ? new Date(a.checked_in_at).toLocaleString('en-IN') : '—'}</td><td className="px-3 py-2.5 text-mute">{a?.checked_out_at ? new Date(a.checked_out_at).toLocaleString('en-IN') : '—'}</td><td className="px-3 py-2.5 text-mute">{badge?.badge_returned ? 'Returned' : badge?.badge_issued ? 'Issued' : '—'}</td><td className="px-3 py-2.5 text-ink">{days}</td><td className="px-3 py-2.5"><div className="flex flex-wrap gap-1">{canMarkAttendance && <>{(!a || a.status === 'absent') && <button className={quiet} disabled={busy} onClick={() => void setMemberAttendance(member,a,'present')}>Arrived</button>}{a?.status === 'present' && <button className={quiet} disabled={busy} onClick={() => void setMemberAttendance(member,a,'checked_out')}>Returned</button>}{!badge?.badge_issued && <button className={quiet} disabled={busy} onClick={() => void setBadgeState(member.id,'issue')}>Issue badge</button>}{badge?.badge_issued && !badge.badge_returned && <button className={quiet} disabled={busy} onClick={() => void setBadgeState(member.id,'return')}>Return badge</button>}</>}</div></td></tr>; })}</tbody></table>{!eventMembers.length && <p className="p-6 text-center text-sm text-mute">No Sewadars match this event.</p>}</div>}</section>
        <section className={`${panel} overflow-hidden`}><div className="border-b border-line p-4"><div className="flex items-center gap-2"><Radio size={16} className="text-blue-400" /><div><h3 className="text-sm font-semibold">Walkie return feedback</h3><p className="mt-1 text-xs text-mute">Department feedback recorded when event radios are returned.</p></div></div></div>{radioReturns.length ? <div className="divide-y divide-line">{radioReturns.map(r => <article key={r.id} className="p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div className="text-sm font-medium text-ink">{r.department_name}</div><div className="text-xs text-mute">{r.returned_walkies} walkies · {r.returned_chargers} chargers · {r.returned_earphones} earphones</div></div><p className="mt-2 whitespace-pre-wrap text-sm text-ink-soft">{r.return_feedback || 'No feedback recorded.'}</p></article>)}</div> : <p className="p-4 text-sm text-mute">No walkie returns recorded for this event yet.</p>}</section>
        <form onSubmit={saveReview} className={`${panel} space-y-3 p-4`}><div className="flex items-center gap-2"><FileText size={16} className="text-blue-400" /><div><h3 className="text-sm font-semibold">Event review and closure</h3><p className="mt-1 text-xs text-mute">Capture lessons, issues, recommendations, and the closure report.</p></div></div>{([['lessons_learned','Lessons learned'],['issues_faced','Issues faced'],['recommendations','Recommendations'],['closure_report','Closure report']] as const).map(([key,label]) => <label key={key} className="block text-xs text-mute">{label}<textarea className={`${input} mt-1`} rows={2} value={review[key]} disabled={!canPlan} onChange={e => setReview(old => ({ ...old, [key]: e.target.value }))} /></label>)}{canPlan && <button className={action} disabled={busy}>{busy ? 'Saving…' : 'Save review'}</button>}</form>
      </>)}
    </>}
  </div>;
};

const TeamAlignmentCard: React.FC<{ item: EventDepartment; canPlan: boolean; busy: boolean; onSave: (item: EventDepartment) => void }> = ({ item, canPlan, busy, onSave }) => {
  const [draft, setDraft] = useState(item);
  useEffect(() => setDraft(item), [item]);
  return <article className={`${panel} space-y-3 p-4`}><h3 className="text-sm font-semibold text-ink">{item.department_name}</h3><label className="block text-xs text-mute">Team lead<input className={`${input} mt-1`} disabled={!canPlan} value={draft.lead_name} onChange={e => setDraft(old => ({ ...old, lead_name: e.target.value }))} /></label><label className="block text-xs text-mute">Resource and coordination notes<textarea className={`${input} mt-1`} rows={2} disabled={!canPlan} value={draft.resource_notes} onChange={e => setDraft(old => ({ ...old, resource_notes: e.target.value }))} /></label><label className="block text-xs text-mute">Readiness<select className={`${input} mt-1`} disabled={!canPlan} value={draft.status} onChange={e => setDraft(old => ({ ...old, status: e.target.value }))}><option value="not_started">Not started</option><option value="planning">Planning</option><option value="ready">Ready</option><option value="blocked">Blocked</option></select></label>{canPlan && <button className={action} disabled={busy} onClick={() => onSave(draft)}>Save alignment</button>}</article>;
};


