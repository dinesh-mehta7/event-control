import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, ClipboardList, Download, FileText, Plus, Radio } from 'lucide-react';
import { useWalkie } from '../modules/walkie';
import { supabase } from '../modules/walkie/lib/supabaseClient';
import { useManpower } from '../modules/manpower';

type EventPlan = { id: string; name: string; location: string; starts_at: string; ends_at: string | null; owner_name: string; status: string };
type EventDepartment = { id: string; department_id: string; department_name: string; lead_name: string; resource_notes: string; status: string };
type EventMeeting = { id: string; title: string; starts_at: string; agenda: string; minutes: string; action_items: string };
type Requirement = { id: string; category: string; department_id: string | null; department_name: string; title: string; quantity: number; unit: string; notes: string; status: string };
type EventTask = { id: string; department_id: string | null; department_name: string; title: string; assigned_to: string; due_date: string | null; priority: string; status: string };
type Attendance = { id: string; member_id: string; member_name: string; status: string; checked_in_at: string | null; checked_out_at: string | null; notes: string };
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
  ? 'Event planning needs its database setup. Run supabase/migration_v33_event_planning.sql in the Supabase SQL Editor, then reload this page.'
  : error?.message || 'Something went wrong. Please try again.';

export const EventPlanning: React.FC = () => {
  const w: any = useWalkie();
  const manpower = useManpower();
  const user = w.currentUser;
  const orgId = user?.organizationId as string | undefined;
  const canPlan = ['owner', 'dept_head'].includes(user?.level);
  const canMarkAttendance = canPlan || (user?.level === 'sub_dept_head' && ['sewadars', 'accommodation'].includes(user?.subDepartment));
  const departments: any[] = w.departments || [];
  const [events, setEvents] = useState<EventPlan[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const selected = events.find(e => e.id === selectedId) || null;
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [eventForm, setEventForm] = useState({ name: '', date: '', time: '', owner: user?.name || '' });
  const [eventDepartments, setEventDepartments] = useState<EventDepartment[]>([]);
  const [meetings, setMeetings] = useState<EventMeeting[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [tasks, setTasks] = useState<EventTask[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [radioReturns, setRadioReturns] = useState<RadioReturnReport[]>([]);
  const [review, setReview] = useState<Review>({ id: '', lessons_learned: '', issues_faced: '', recommendations: '', closure_report: '' });
  const [searchMembers, setSearchMembers] = useState('');
  const [today, setToday] = useState(() => localDay(new Date()));
  const [meetingForm, setMeetingForm] = useState({ title: '', date: '', time: '', agenda: '' });
  const [requirementForm, setRequirementForm] = useState({ category: 'it', departmentId: '', title: '', quantity: '1', unit: '', notes: '' });
  const [taskForm, setTaskForm] = useState({ departmentId: '', title: '', assignedTo: '', dueDate: '', priority: 'normal' });

  const loadEvents = useCallback(async () => {
    if (!orgId) return;
    setLoading(true); setError('');
    const { data, error: loadError } = await supabase.from('event_plans').select('*').eq('organization_id', orgId).order('starts_at', { ascending: false });
    if (loadError) setError(schemaError(loadError));
    else {
      const list = (data || []) as EventPlan[];
      setEvents(list);
      setSelectedId(current => list.some(e => e.id === current) ? current : list[0]?.id || '');
    }
    setLoading(false);
  }, [orgId]);

  const loadDetails = useCallback(async (eventId: string) => {
    if (!orgId || !eventId) return;
    const results = await Promise.all([
      supabase.from('event_attendance').select('*').eq('organization_id', orgId).eq('event_id', eventId).order('member_name'),
      supabase.from('event_reviews').select('*').eq('organization_id', orgId).eq('event_id', eventId).maybeSingle(),
      supabase.from('event_radio_requests').select('id,department_name,returned_walkies,returned_chargers,returned_earphones,returned_at,return_feedback,status,updated_at').eq('organization_id', orgId).eq('event_id', eventId).in('status', ['partial_return', 'returned']).order('updated_at', { ascending: false }),
    ]);
    const failed = results.find(r => r.error);
    if (failed?.error) { setError(schemaError(failed.error)); return; }
    setAttendance((results[0].data || []) as Attendance[]);
    setReview((results[1].data as Review) || { id: '', lessons_learned: '', issues_faced: '', recommendations: '', closure_report: '' });
    setRadioReturns((results[2].data || []) as RadioReturnReport[]);
  }, [orgId]);

  useEffect(() => { void loadEvents(); }, [loadEvents]);
  useEffect(() => { if (selectedId) void loadDetails(selectedId); }, [selectedId, loadDetails]);
  useEffect(() => { const timer = window.setInterval(() => setToday(localDay(new Date())), 60_000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    if (!orgId || !selectedId) return;
    const channel = supabase.channel(`event-report-${selectedId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'event_radio_requests', filter: `organization_id=eq.${orgId}` }, (payload: any) => {
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
    const { error: createError } = await supabase.from('event_plans').insert({ id: eventId, organization_id: orgId, name: eventForm.name.trim(), location: '', starts_at: startsAt, ends_at: null, owner_name: eventForm.owner.trim() });
    if (createError) { setError(schemaError(createError)); setBusy(false); return; }
    setBusy(false); setShowCreate(false); setSelectedId(eventId);
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

  const saveDepartment = async (item: EventDepartment) => {
    if (!orgId || !canPlan) return;
    setBusy(true); setError('');
    const { error: saveError } = await supabase.from('event_departments').update({ lead_name: item.lead_name, resource_notes: item.resource_notes, status: item.status }).eq('id', item.id).eq('organization_id', orgId);
    if (saveError) setError(schemaError(saveError));
    setBusy(false);
  };

  const addMeeting = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected || !orgId || !meetingForm.title.trim() || !meetingForm.date || !meetingForm.time) return;
    setBusy(true); setError('');
    const { error: saveError } = await supabase.from('event_meetings').insert({ id: idFor('event-meet'), organization_id: orgId, event_id: selected.id, title: meetingForm.title.trim(), starts_at: new Date(`${meetingForm.date}T${meetingForm.time}`).toISOString(), agenda: meetingForm.agenda.trim() });
    if (saveError) setError(schemaError(saveError)); else { setMeetingForm({ title: '', date: '', time: '', agenda: '' }); await loadDetails(selected.id); }
    setBusy(false);
  };

  const addRequirement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected || !orgId || !requirementForm.title.trim()) return;
    const department = departments.find(d => d.id === requirementForm.departmentId);
    setBusy(true); setError('');
    const { error: saveError } = await supabase.from('event_requirements').insert({ id: idFor('event-req'), organization_id: orgId, event_id: selected.id, category: requirementForm.category, department_id: department?.id || null, department_name: department?.name || '', title: requirementForm.title.trim(), quantity: Math.max(0, Number(requirementForm.quantity) || 0), unit: requirementForm.unit.trim(), notes: requirementForm.notes.trim() });
    if (saveError) setError(schemaError(saveError)); else { setRequirementForm({ category: 'it', departmentId: '', title: '', quantity: '1', unit: '', notes: '' }); await loadDetails(selected.id); }
    setBusy(false);
  };

  const addTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected || !orgId || !taskForm.title.trim()) return;
    const department = departments.find(d => d.id === taskForm.departmentId);
    setBusy(true); setError('');
    const { error: saveError } = await supabase.from('event_tasks').insert({ id: idFor('event-task'), organization_id: orgId, event_id: selected.id, department_id: department?.id || null, department_name: department?.name || '', title: taskForm.title.trim(), assigned_to: taskForm.assignedTo.trim(), due_date: taskForm.dueDate || null, priority: taskForm.priority });
    if (saveError) setError(schemaError(saveError)); else { setTaskForm({ departmentId: '', title: '', assignedTo: '', dueDate: '', priority: 'normal' }); await loadDetails(selected.id); }
    setBusy(false);
  };

  const updateTaskStatus = async (task: EventTask, status: string) => {
    if (!selected || !orgId || !canPlan) return;
    setBusy(true); setError('');
    const { error: saveError } = await supabase.from('event_tasks').update({ status }).eq('id', task.id).eq('organization_id', orgId);
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
  const filteredSewadars = useMemo(() => manpower.sewadars.filter(s => `${s.name} ${s.phone} ${s.teamName} ${s.batchNo}`.toLowerCase().includes(searchMembers.toLowerCase())), [manpower.sewadars, searchMembers]);
  const downloadAttendance = () => {
    if (!selected) return;
    const rows = [
      ['Event', 'Sewadar', 'Phone', 'Team', 'Status', 'Arrived at', 'Returned back', 'Attendance days', 'Notes'],
      ...manpower.sewadars.map(member => {
        const record = attendanceByMember.get(member.id);
        const status = record?.status === 'present' ? 'Here now' : record?.status === 'checked_out' ? 'Returned back' : record?.status === 'absent' ? 'Absent' : 'Expected';
        return [selected.name, member.name, member.phone || '', member.teamName || '', status, record?.checked_in_at ? new Date(record.checked_in_at).toLocaleString('en-IN') : '', record?.checked_out_at ? new Date(record.checked_out_at).toLocaleString('en-IN') : '', record ? attendanceDayCount(record, today) : 0, record?.notes || ''];
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
  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="text-xl font-semibold text-ink">Event reports</h2><p className="mt-1 text-sm text-mute">Sewadar arrival, return, and attendance days for each event.</p></div>
        {canPlan && <button className={action} onClick={() => setShowCreate(v => !v)}><Plus size={15} />{showCreate ? 'Close' : 'Add event'}</button>}
      </header>

      {showCreate && <form onSubmit={createEvent} className={`${panel} grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4`}>
        <label className="text-xs text-mute">Event name<input required className={`${input} mt-1`} value={eventForm.name} onChange={e => setEventForm({ ...eventForm, name: e.target.value })} placeholder="Annual gathering" /></label>
        <label className="text-xs text-mute">Event date<input required type="date" className={`${input} mt-1`} value={eventForm.date} onChange={e => setEventForm({ ...eventForm, date: e.target.value })} /></label>
        <label className="text-xs text-mute">Start time<input required type="time" className={`${input} mt-1`} value={eventForm.time} onChange={e => setEventForm({ ...eventForm, time: e.target.value })} /></label>
        <label className="text-xs text-mute">Event owner<input className={`${input} mt-1`} value={eventForm.owner} onChange={e => setEventForm({ ...eventForm, owner: e.target.value })} placeholder="Owner name" /></label>
        <div className="flex items-end"><button className={action} disabled={busy}>{busy ? 'Saving…' : 'Save event'}</button></div>
      </form>}

      {error && <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</div>}
      {loading ? <div className={`${panel} p-8 text-center text-sm text-mute`}>Loading event reports…</div> : !events.length ? <div className={`${panel} p-8 text-center`}><ClipboardList className="mx-auto mb-2 h-6 w-6 text-mute" /><p className="text-sm font-medium">No event reports yet</p><p className="mt-1 text-xs text-mute">Add an event to start recording Sewadar attendance.</p></div> : <>
        <label className="block max-w-lg text-xs text-mute">Event<select className={`${input} mt-1`} value={selectedId} onChange={e => setSelectedId(e.target.value)} aria-label="Choose event report">{events.map(event => <option key={event.id} value={event.id}>{event.name} · {when(event.starts_at)}</option>)}</select></label>
        {selected && <>
          <section className={`${panel} flex flex-wrap items-start justify-between gap-3 p-4`}>
            <div><div className="flex items-center gap-2"><CalendarDays size={17} className="text-blue-400" /><h3 className="text-lg font-semibold text-ink">{selected.name}</h3></div><p className="mt-1 text-xs text-mute">{when(selected.starts_at)}{selected.owner_name ? ` · Owner: ${selected.owner_name}` : ''}</p></div>
            <span className="rounded-full bg-raised px-2.5 py-1 text-xs capitalize text-ink-soft">{selected.status}</span>
          </section>

          <section className={`${panel} p-4`}>
            <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-3"><div><h3 className="text-sm font-semibold">Sewadar attendance report</h3><p className="mt-1 text-xs text-mute">Attendance days count from arrival through today, and stop on the date “Returned back” is recorded. The total updates daily.</p></div><div className="flex flex-wrap items-center gap-2"><input className={`${input} max-w-xs`} placeholder="Search Sewadars or team" aria-label="Search Sewadars" value={searchMembers} onChange={e => setSearchMembers(e.target.value)} /><button type="button" className={quiet} disabled={manpower.loading || !manpower.sewadars.length} onClick={downloadAttendance}><Download size={14} />Download CSV</button></div></div>
            <div className="mt-3 grid grid-cols-2 gap-2 xl:grid-cols-4">
              {[
                ['Here now', attendanceStats.active, 'text-emerald-300'],
                ['Attendance days', attendanceStats.days, 'text-blue-300'],
                ['Returned back', attendanceStats.returned, 'text-cyan-300'],
                ['Absent', attendanceStats.absent, 'text-rose-300'],
              ].map(([label, value, tone]) => <div key={label} className="rounded-lg border border-line bg-raised/40 p-3"><div className="text-xs text-mute">{label}</div><div className={`mt-1 text-xl font-semibold tabular-nums ${tone}`}>{value}</div></div>)}
            </div>
            {manpower.loading ? <p className="py-6 text-sm text-mute">Loading Sewadar roster…</p> : <div className="mt-3 max-h-[60vh] overflow-auto rounded-lg border border-line"><table className="w-full min-w-[760px] text-left text-xs"><thead className="sticky top-0 bg-raised text-mute"><tr><th className="px-3 py-2.5">Sewadar</th><th className="px-3 py-2.5">Team</th><th className="px-3 py-2.5">Status</th><th className="px-3 py-2.5">Arrived at</th><th className="px-3 py-2.5">Returned back</th><th className="px-3 py-2.5 text-right">Attendance days</th><th className="px-3 py-2.5">Action</th></tr></thead><tbody className="divide-y divide-line">{filteredSewadars.map(member => { const a = attendanceByMember.get(member.id); const days = a ? attendanceDayCount(a, today) : 0; const status = a?.status === 'present' ? 'Here now' : a?.status === 'checked_out' ? 'Returned back' : a?.status === 'absent' ? 'Absent' : 'Expected'; return <tr key={member.id}>
                <td className="px-3 py-2.5 font-medium text-ink">{member.name}<span className="ml-2 font-normal text-mute">{member.phone}</span></td><td className="px-3 py-2.5 text-mute">{member.teamName || '—'}</td>
                <td className={`px-3 py-2.5 ${a?.status === 'present' ? 'text-emerald-300' : a?.status === 'checked_out' ? 'text-cyan-300' : a?.status === 'absent' ? 'text-rose-300' : 'text-mute'}`}>{status}</td>
                <td className="px-3 py-2.5 text-mute">{a?.checked_in_at ? new Date(a.checked_in_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</td><td className="px-3 py-2.5 text-mute">{a?.checked_out_at ? new Date(a.checked_out_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : a?.status === 'present' ? 'Not returned' : '—'}</td><td className="px-3 py-2.5 text-right font-semibold tabular-nums text-ink">{days}</td>
                <td className="px-3 py-2.5">{canMarkAttendance && <div className="flex gap-1">{(!a || a.status === 'absent') && <button className={quiet} disabled={busy} onClick={() => void setMemberAttendance(member, a, 'present')}>Mark arrived</button>}{a?.status === 'present' && <button className={quiet} disabled={busy} onClick={() => void setMemberAttendance(member, a, 'checked_out')}>Returned back</button>}{!a && <button className={quiet} disabled={busy} onClick={() => void setMemberAttendance(member, a, 'absent')}>Mark absent</button>}</div>}</td>
              </tr>; })}</tbody></table>{!filteredSewadars.length && <p className="p-6 text-center text-sm text-mute">No Sewadars match this search.</p>}</div>}
          </section>

          <section className={`${panel} overflow-hidden`}>
            <div className="border-b border-line p-4"><div className="flex items-center gap-2"><Radio size={16} className="text-blue-400" /><div><h3 className="text-sm font-semibold">Walkie return feedback by department</h3><p className="mt-1 text-xs text-mute">Feedback entered when each department returns event radios is saved on its request and shown here.</p></div></div></div>
            {radioReturns.length ? <div className="divide-y divide-line">{radioReturns.map(r => <article key={r.id} className="p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div className="text-sm font-medium text-ink">{r.department_name}</div><div className="text-xs text-mute">{r.returned_walkies} walkies · {r.returned_chargers} chargers · {r.returned_earphones} earphones · Updated {new Date(r.updated_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div></div><p className="mt-2 whitespace-pre-wrap text-sm text-ink-soft">{r.return_feedback || 'No feedback recorded.'}</p></article>)}</div> : <p className="p-4 text-sm text-mute">No walkie returns or department feedback recorded for this event yet.</p>}
          </section>

          <form onSubmit={saveReview} className={`${panel} space-y-3 p-4`}>
            <div className="flex items-center gap-2"><FileText size={16} className="text-blue-400" /><div><h3 className="text-sm font-semibold">Event report notes</h3><p className="mt-1 text-xs text-mute">Record lessons, issues, recommendations, and the closure report.</p></div></div>
            {([
              ['lessons_learned', 'Lessons learned'], ['issues_faced', 'Issues faced'], ['recommendations', 'Recommendations'], ['closure_report', 'Closure report'],
            ] as const).map(([key, label]) => <label key={key} className="block text-xs text-mute">{label}<textarea className={`${input} mt-1`} rows={2} value={review[key]} disabled={!canPlan} onChange={e => setReview(old => ({ ...old, [key]: e.target.value }))} /></label>)}
            {canPlan && <button className={action} disabled={busy}>{busy ? 'Saving…' : 'Save report'}</button>}
          </form>
        </>}
      </>}
    </div>
  );
};
