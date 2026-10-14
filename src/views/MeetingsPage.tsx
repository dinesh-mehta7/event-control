import React, { useEffect, useState } from 'react';
import { Siren, CalendarClock, Video, MapPin, FileText, Save, Pencil, CalendarPlus, ExternalLink, CalendarDays, Users, UserRound, ListPlus } from 'lucide-react';
import { useMeetings, MeetingRow, MeetingMode } from '../context/MeetingsContext';
import { DEPTS } from './orgData';
import { Card, Pill, inputCls, btnPrimary, btnDanger, linkBtn } from '../components/ui';
import { PageIntro, Tabs } from '../components/ui';
import type { SubDepartmentId } from '../types';
import { MeetingDatePicker, MeetingTimePicker } from './MeetingDateTimePicker';
import { useWalkie } from '../modules/walkie';
import { supabase } from '../modules/walkie/lib/supabaseClient';
import { useEventScope } from '../context/EventScopeContext';

const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
const groupName = (group: string) => group === 'it:staff' ? 'IT Staff' : group === 'sewadar:all' ? 'All Sewadars' : group === 'sewadar:regular' ? 'Regular Sewadars' : group === 'sewadar:annual' ? 'Annual Sewadars' : group.startsWith('sewadar:team:') ? group.slice(13) : group;
const who = (m: MeetingRow) => (m.audienceAll ? 'Everyone' : [...m.audienceDepts.map(d => DEPTS[d] || d), ...m.audienceGroups.map(groupName)].join(', '));
const icsText = (value: string) => value.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
const icsDate = (value: string) => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const downloadCalendarInvite = (meeting: MeetingRow) => {
  const start = new Date(meeting.startsAt); const end = new Date(start.getTime() + 60 * 60 * 1000);
  const details = [meeting.agenda, meeting.message, meeting.link ? `Join: ${meeting.link}` : ''].filter(Boolean).join('\\n\\n');
  const lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Event Command Center//Meetings//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH','BEGIN:VEVENT',`UID:${meeting.id}@event-command-center`,`DTSTAMP:${icsDate(new Date().toISOString())}`,`DTSTART:${icsDate(start.toISOString())}`,`DTEND:${icsDate(end.toISOString())}`,`SUMMARY:${icsText(meeting.title)}`,`DESCRIPTION:${icsText(details)}`];
  if (meeting.mode === 'offline' && meeting.place) lines.push(`LOCATION:${icsText(meeting.place)}`);
  lines.push('END:VEVENT','END:VCALENDAR');
  const url = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${meeting.title.replace(/[^a-z0-9_-]+/gi, '-') || 'meeting'}.ics`; anchor.click(); URL.revokeObjectURL(url);
};
const tone = (s: string) => s === 'live' || s === 'done' ? 'bg-emerald-500/15 text-emerald-300' : s === 'scheduled' ? 'bg-blue-500/15 text-blue-300' : s === 'cancelled' ? 'bg-red-500/15 text-red-300' : 'bg-raised text-mute';
const meetingAction = 'inline-flex items-center gap-1.5 rounded-md border border-line bg-surface/50 px-2.5 py-1.5 text-[11px] font-medium text-ink-soft transition-colors hover:border-blue-500/50 hover:text-blue-300';
const Empty: React.FC<{ children: React.ReactNode }> = ({ children }) => <li className="py-8 text-center text-sm text-mute">{children}</li>;
const Err: React.FC<{ msg: string }> = ({ msg }) => msg ? <p role="alert" className="text-xs text-red-400 mb-3">{msg}</p> : null;

const AudiencePicker: React.FC<{ all: boolean; setAll: (v: boolean) => void; depts: SubDepartmentId[]; setDepts: React.Dispatch<React.SetStateAction<SubDepartmentId[]>>; groups: string[]; setGroups: React.Dispatch<React.SetStateAction<string[]>>; teams: string[] }> = ({ all, setAll, depts, setDepts, groups, setGroups, teams }) => {
  const toggleDept = (d: SubDepartmentId) => setDepts(p => p.includes(d) ? p.filter(x => x !== d) : [...p, d]);
  const toggleGroup = (g: string) => setGroups(p => p.includes(g) ? p.filter(x => x !== g) : [...p, g]);
  const choices: [string, string][] = [['it:staff', 'IT Staff'], ['sewadar:all', 'All Sewadars'], ['sewadar:regular', 'Regular Sewadars'], ['sewadar:annual', 'Annual Sewadars'], ...teams.map(t => [`sewadar:team:${t}`, t] as [string, string])];
  return <div className="sm:col-span-3 space-y-2">
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-ink">
      <label className="flex items-center gap-2"><input type="radio" checked={all} onChange={() => setAll(true)} /> Everyone</label>
      <label className="flex items-center gap-2"><input type="radio" checked={!all} onChange={() => setAll(false)} /> Selected groups</label>
    </div>
    {!all && <div className="rounded-md border border-line bg-raised/30 p-3 space-y-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-mute">Departments</div>
      <div className="flex flex-wrap gap-x-4 gap-y-2">{(Object.keys(DEPTS) as SubDepartmentId[]).map(d => <label key={d} className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={depts.includes(d)} onChange={() => toggleDept(d)} />{DEPTS[d]}</label>)}</div>
      <div className="pt-1 text-[10px] font-semibold uppercase tracking-wide text-mute">Member groups</div>
      <div className="flex flex-wrap gap-x-4 gap-y-2">{choices.map(([value, label]) => <label key={value} className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={groups.includes(value)} onChange={() => toggleGroup(value)} />{label}</label>)}</div>
      {!teams.length && <p className="text-xs text-mute">No Sewadar teams have been added yet.</p>}
    </div>}
    <p className="text-xs text-mute">Every account linked to a selected member or team receives a portal notification.</p>
  </div>;
};

type MeetingTaskDraft = { title: string; department: SubDepartmentId; dueDate: string; priority: string };
const MeetingRowView: React.FC<{ m: MeetingRow; eventName?: string; canChange: boolean; canEditMom: boolean; onStatus: (id: string, s: any) => void; onSaveMom: (id: string, mom: string) => Promise<string | null>; onGenerateMinutes?: (id: string) => Promise<string | null>; onAddTask?: (m: MeetingRow, task: MeetingTaskDraft) => Promise<string | null> }> = ({ m, eventName, canChange, canEditMom, onStatus, onSaveMom, onGenerateMinutes, onAddTask }) => {
  const [editingMom, setEditingMom] = useState(false); const [mom, setMom] = useState(m.minutes); const [momError, setMomError] = useState(''); const [savingMom, setSavingMom] = useState(false); const [generatingMom, setGeneratingMom] = useState(false);
  const [showTaskForm, setShowTaskForm] = useState(false); const [task, setTask] = useState<MeetingTaskDraft>({ title: '', department: 'sewadars', dueDate: '', priority: 'as_you_have_time' }); const [taskError, setTaskError] = useState(''); const [savingTask, setSavingTask] = useState(false);
  const open = m.status === 'scheduled' || m.status === 'live';
  const saveMom = async () => { setSavingMom(true); setMomError(''); const e = await onSaveMom(m.id, mom); setSavingMom(false); if (e) setMomError(e); else setEditingMom(false); };
  return (
    <li className="rounded-xl border border-line bg-raised/20 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-blue-400/20 bg-blue-500/15 text-blue-300"><CalendarClock size={18} /></span>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 className="truncate font-semibold text-ink">{m.title}</h3><Pill c={tone(m.status)}>{m.status === 'done' ? '✓ Done' : m.status}</Pill>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
          {m.kind === 'meeting' && <button type="button" className={meetingAction} onClick={() => downloadCalendarInvite(m)}><CalendarPlus size={13} />Add to calendar</button>}
          {m.kind === 'meeting' && m.status === 'done' && !m.minutes && canEditMom && onGenerateMinutes && <button type="button" className={meetingAction} disabled={generatingMom} onClick={async () => { setGeneratingMom(true); setMomError(''); const error = await onGenerateMinutes(m.id); setGeneratingMom(false); if (error) setMomError(error); }}><FileText size={13} />{generatingMom ? 'Generating…' : 'Retry automatic minutes'}</button>}
          {canChange && m.status === 'scheduled' && <button className={linkBtn} onClick={() => onStatus(m.id, 'live')}>Start</button>}
          {canChange && open && <button className={linkBtn} onClick={() => onStatus(m.id, 'done')}>{m.kind === 'emergency' ? 'Resolve' : 'Mark done'}</button>}
          {canChange && m.status === 'scheduled' && <button className={linkBtn} onClick={() => onStatus(m.id, 'cancelled')}>Cancel</button>}
          {canChange && m.kind === 'meeting' && onAddTask && <button className={meetingAction} onClick={() => setShowTaskForm(value => !value)}><ListPlus size={13} />Add action item</button>}
        </div>
      </div>
      <div className="ml-11 mt-1.5 flex flex-wrap items-center text-[11px] text-mute">
        <span className="inline-flex items-center gap-1.5 border-r border-line pr-3"><CalendarDays size={13} />{when(m.startsAt)}</span>
        <span className="inline-flex items-center gap-1.5 border-r border-line px-3">{m.mode === 'online' ? <Video size={13} /> : <MapPin size={13} />}{m.mode === 'online' ? 'Online' : m.place}</span>
        <span className="inline-flex items-center gap-1.5 border-r border-line px-3"><Users size={13} />{who(m)}</span>
        <span className="inline-flex items-center gap-1.5 px-3"><UserRound size={13} />{m.createdByName}</span>
        {m.eventId && <span className="ml-1 rounded-full bg-blue-500/10 px-2 py-0.5 text-blue-300">{eventName || 'Linked event'}</span>}
        {m.mode === 'online' && m.link && open && <a className={`${linkBtn} ml-2`} href={m.link} target="_blank" rel="noreferrer">Join meeting</a>}
      </div>
      {(m.agenda || m.message) && <section className="mt-3 border-t border-line/70 pt-2.5">
        <h4 className="text-[10px] font-semibold uppercase tracking-wide text-mute">Description</h4>
        {m.agenda && <p className="mt-1 text-xs leading-relaxed text-ink-soft whitespace-pre-wrap">{m.agenda}</p>}
        {m.message && <p className="mt-1 text-xs leading-relaxed text-ink-soft whitespace-pre-wrap">{m.message}</p>}
      </section>}
      {m.kind === 'meeting' && (m.minutes || canEditMom) && <section className="mt-3 border-t border-line/70 pt-2.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h4 className="flex items-center gap-2 text-xs font-semibold text-ink"><span className="grid h-8 w-8 place-items-center rounded-md border border-blue-400/20 bg-blue-500/15 text-blue-300"><FileText size={16} /></span>Meeting minutes</h4>
          {canEditMom && !editingMom && <button type="button" className={linkBtn} onClick={() => { setMom(m.minutes); setEditingMom(true); }}><Pencil size={12} />{m.minutes ? 'Edit minutes' : 'Add minutes'}</button>}
        </div>
        {momError && !editingMom && <Err msg={momError} />}
        {editingMom
          ? <div className="space-y-2">
              <textarea className={inputCls + ' w-full'} rows={4} maxLength={20000} placeholder="Decisions, action items, owners and due dates…" value={mom} onChange={e => setMom(e.target.value)} />
              <Err msg={momError} />
              <div className="flex justify-end gap-2"><button className={linkBtn} onClick={() => { setEditingMom(false); setMom(m.minutes); }}>Cancel</button><button className={linkBtn} disabled={savingMom} onClick={saveMom}><Save size={12} />{savingMom ? 'Saving…' : 'Save MOM'}</button></div>
            </div>
          : <div className="ml-10 mt-1 whitespace-pre-wrap text-xs leading-snug text-ink-soft">{m.minutes || <span className="text-faint">No minutes added yet.</span>}</div>}
      </section>}
      {showTaskForm && onAddTask && <form className="mt-3 grid gap-2 rounded-lg border border-line bg-raised/40 p-3 sm:grid-cols-2" onSubmit={async event => { event.preventDefault(); setTaskError(''); setSavingTask(true); const error = await onAddTask(m, task); setSavingTask(false); if (error) setTaskError(error); else { setTask({ ...task, title: '' }); setShowTaskForm(false); } }}><h4 className="sm:col-span-2 text-xs font-semibold text-ink">Create task from meeting action</h4><input required className={inputCls} placeholder="Action / task" value={task.title} onChange={e => setTask(old => ({ ...old, title: e.target.value }))} /><select className={inputCls} aria-label="Department responsible" value={task.department} onChange={e => setTask(old => ({ ...old, department: e.target.value as SubDepartmentId }))}>{Object.entries(DEPTS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select><label className="text-xs text-mute">Deadline<input required type="date" className={inputCls + ' mt-1'} value={task.dueDate} onChange={e => setTask(old => ({ ...old, dueDate: e.target.value }))} /></label><label className="text-xs text-mute">Priority<select className={inputCls + ' mt-1'} value={task.priority} onChange={e => setTask(old => ({ ...old, priority: e.target.value }))}><option value="immediately">Urgent</option><option value="till_time">High · due by deadline</option><option value="as_you_have_time">Normal</option></select></label><Err msg={taskError} /><button type="submit" className={linkBtn} disabled={savingTask}>{savingTask ? 'Adding…' : 'Add task to Tasks'}</button></form>}
    </li>
  );
};

const MeetingsList: React.FC = () => {
  const { meetings, canSchedule, createMeeting, setMeetingStatus, saveMeetingMinutes, generateMeetingMinutes, canEditMeetingMinutes, sewadarTeams } = useMeetings();
  const auth: any = useWalkie();
  const eventScope = useEventScope();
  const [title, setTitle] = useState(''); const [agenda, setAgenda] = useState(''); const [mode, setMode] = useState<MeetingMode>('online'); const [onlinePlatform, setOnlinePlatform] = useState<'google' | 'teams' | 'outlook'>('teams');
  const [place, setPlace] = useState(''); const [link, setLink] = useState(''); const [date, setDate] = useState(''); const [time, setTime] = useState('');
  const [all, setAll] = useState(true); const [depts, setDepts] = useState<SubDepartmentId[]>([]); const [groups, setGroups] = useState<string[]>([]); const [message, setMessage] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [showScheduler, setShowScheduler] = useState(false);
  const [meetingCategory, setMeetingCategory] = useState<'general' | 'event'>('general');
  const [meetingEventId, setMeetingEventId] = useState(() => eventScope.scopeFor('event-reports'));
  const [teamsAttendees, setTeamsAttendees] = useState<string[]>([]);
  useEffect(() => {
    const organizationId = auth.currentUser?.organizationId;
    if (!organizationId) { setTeamsAttendees([]); return; }
    let live = true;
    const loadAttendees = async () => {
      const [{ data: people }, { data: members }] = await Promise.all([
        supabase.from('profiles').select('id,email,level,sub_department').eq('organization_id', organizationId).eq('approved', true).eq('is_active', true),
        supabase.from('accommodation_members').select('profile_id,member_type,team_name,team_names').eq('organization_id', organizationId).not('profile_id', 'is', null),
      ]);
      if (!live) return;
      const linked = new Map<string, any[]>();
      for (const member of members || []) if (member.profile_id) linked.set(member.profile_id, [...(linked.get(member.profile_id) || []), member]);
      const emails = (people || []).filter(person => {
        if (person.id === auth.currentUser?.id) return false;
        if (all || ['owner', 'dept_head'].includes(person.level) || depts.includes(person.sub_department)) return true;
        if (groups.includes('it:staff') && ['staff', 'sub_dept_head', 'dept_head'].includes(person.level)) return true;
        return (linked.get(person.id) || []).some(member => {
          const teamNames = [member.team_name, ...(Array.isArray(member.team_names) ? member.team_names : [])].filter(Boolean).map((name: string) => name.toLocaleLowerCase());
          return groups.includes('sewadar:all')
            || (groups.includes('sewadar:regular') && ['salary_based', 'monthly'].includes(member.member_type))
            || (groups.includes('sewadar:annual') && member.member_type === 'annual')
            || groups.some(group => group.startsWith('sewadar:team:') && teamNames.includes(group.slice(13).trim().toLocaleLowerCase()));
        });
      }).map(person => String(person.email || '').trim().toLowerCase()).filter(Boolean);
      setTeamsAttendees(Array.from(new Set(emails)));
    };
    void loadAttendees();
    return () => { live = false; };
  }, [auth.currentUser?.organizationId, auth.currentUser?.id, all, depts, groups]);
  const providerComposer = () => {
    const start = new Date(`${date}T${time}`);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const description = [agenda, message].filter(Boolean).join('\n\n');
    const p = new URLSearchParams();
    if (onlinePlatform === 'google') {
      p.set('action', 'TEMPLATE'); p.set('text', title); p.set('dates', `${start.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}/${end.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`); p.set('details', description); p.set('ctz', 'Asia/Kolkata');
      return `https://calendar.google.com/calendar/render?${p.toString()}`;
    }
    if (onlinePlatform === 'teams') {
      p.set('subject', title); p.set('startTime', start.toISOString()); p.set('endTime', end.toISOString()); p.set('content', description);
      if (teamsAttendees.length) p.set('attendees', teamsAttendees.join(','));
      return `https://teams.microsoft.com/l/meeting/new?${p.toString().replace(/\+/g, '%20')}`;
    }
    p.set('path', '/calendar/action/compose'); p.set('rru', 'addevent'); p.set('subject', title); p.set('body', description); p.set('startdt', start.toISOString()); p.set('enddt', end.toISOString());
    return `https://outlook.office.com/calendar/0/deeplink/compose?${p.toString()}`;
  };
  const submit = async () => {
    setErr(''); if (!date || !time) { setErr('Pick a date and time.'); return; }
    if (meetingCategory === 'event' && !meetingEventId) { setErr('Choose the event this meeting belongs to.'); return; }
    if (+new Date(`${date}T${time}`) <= Date.now()) { setErr('Choose a future date and time.'); return; }
    setBusy(true);
    const e = await createMeeting({ kind: 'meeting', title, agenda, message, mode, place, link, startsAt: new Date(`${date}T${time}`).toISOString(), audienceAll: all, audienceDepts: depts, audienceGroups: groups, eventId: meetingCategory === 'event' ? meetingEventId : undefined });
    setBusy(false);
    const emailWarning = e?.startsWith('EMAIL_WARNING:') ? e.slice('EMAIL_WARNING:'.length).trim() : '';
    if (e && !emailWarning) { setErr(e); return; }
    setTitle(''); setAgenda(''); setMessage(''); setPlace(''); setLink(''); setDate(''); setTime(''); setDepts([]); setGroups([]); setAll(true); setMeetingCategory('general'); setShowScheduler(false);
    if (emailWarning) setErr(emailWarning);
  };
  const now = Date.now();
  const isUpcoming = (m: MeetingRow) => ['scheduled', 'live'].includes(m.status) && +new Date(m.startsAt) > now;
  const sorted = [...meetings].sort((a, b) => Number(isUpcoming(b)) - Number(isUpcoming(a)) || (isUpcoming(a) ? 1 : -1) * (+new Date(a.startsAt) - +new Date(b.startsAt)));
  const addMeetingTask = async (meeting: MeetingRow, draft: MeetingTaskDraft) => {
    const event = eventScope.events.find(item => item.id === meeting.eventId);
    const { error } = await supabase.from('manpower_tasks').insert({ id: `meeting-task-${crypto.randomUUID()}`, organization_id: auth.currentUser?.organizationId, event_id: meeting.eventId, meeting_id: meeting.id, parent_task_id: null, department_id: draft.department, title: draft.title.trim(), details: `Action from meeting: ${meeting.title}${event ? ` · Event: ${event.name}` : ''}`, resources: '', team: DEPTS[draft.department], assigned_to: '', due_date: draft.dueDate, priority_level: draft.priority, priority_until: draft.priority === 'till_time' ? `${draft.dueDate}T23:59:00` : null, status: 'todo' });
    return error?.message || null;
  };
  return (
    <div className="space-y-4">
    {canSchedule && <Card icon={CalendarClock} title="Schedule a meeting" className="border-blue-500/20 bg-gradient-to-br from-blue-500/[0.07] to-surface">
      <div className="rounded-xl border border-blue-500/25 bg-gradient-to-r from-blue-500/[0.10] via-blue-500/[0.04] to-transparent p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-blue-400/20 bg-blue-500/15 text-blue-300"><CalendarClock size={19} /></span><div className="min-w-0"><h3 className="text-sm font-semibold text-ink">Plan your next meeting</h3><p className="mt-0.5 text-xs text-mute">Set the time, share the details and choose who should receive it.</p></div></div>
          <button type="button" onClick={() => setShowScheduler(v => !v)} className={btnPrimary + ' shadow-lg shadow-blue-950/30'}>{showScheduler ? 'Close scheduler' : <><CalendarClock size={15} />Schedule a meeting</>}</button>
        </div>
        {showScheduler && <form onSubmit={e => { e.preventDefault(); submit(); }} className="mt-4 space-y-4 rounded-lg border border-line bg-surface/80 p-3 sm:p-4">
          <div><h4 className="text-xs font-semibold uppercase tracking-wide text-blue-300">Meeting details</h4><div className="mt-2 grid gap-2 sm:grid-cols-2">
            <input required className={inputCls} placeholder="Meeting title" aria-label="Meeting title" value={title} onChange={e => setTitle(e.target.value)} />
            <select className={inputCls} aria-label="Meeting type" value={mode} onChange={e => setMode(e.target.value as MeetingMode)}><option value="offline">Offline (in person)</option><option value="online">Online</option></select>
            {mode === 'offline' ? <input required className={inputCls} placeholder="Place" aria-label="Place" value={place} onChange={e => setPlace(e.target.value)} /> : <div className="space-y-2"><div className="flex flex-wrap gap-2"><select className={inputCls + ' min-w-40'} aria-label="Online meeting provider" value={onlinePlatform} onChange={e => setOnlinePlatform(e.target.value as typeof onlinePlatform)}><option value="google">Google Meet / Calendar</option><option value="teams">Microsoft Teams</option><option value="outlook">Outlook Calendar</option></select><a className={linkBtn} href={date && time && title.trim() ? providerComposer() : onlinePlatform === 'google' ? 'https://calendar.google.com/calendar/' : onlinePlatform === 'teams' ? 'https://teams.microsoft.com/' : 'https://outlook.office.com/calendar/'} target="_blank" rel="noreferrer"><ExternalLink size={12} />{date && time && title.trim() ? onlinePlatform === 'teams' ? `Open Teams · invite ${teamsAttendees.length} members` : 'Create with provider' : 'Open provider'}</a></div><input required={onlinePlatform !== 'teams'} type="url" className={inputCls + ' w-full'} placeholder={onlinePlatform === 'teams' ? 'Optional: paste an existing Teams meeting link' : 'Paste the meeting join link here after creating it'} aria-label="Meeting link" value={link} onChange={e => setLink(e.target.value)} /><p className="flex items-center gap-1 text-[10px] text-mute"><ExternalLink size={10} />{onlinePlatform === 'teams' ? 'With Teams automation configured, the app creates a meeting and sends its join link automatically. You can also paste an existing link.' : 'Create the meeting with your provider, then paste its join link here.'}</p></div>}
            <input className={inputCls} placeholder="Agenda (optional)" aria-label="Agenda" value={agenda} onChange={e => setAgenda(e.target.value)} />
          </div></div>
          <div><h4 className="text-xs font-semibold uppercase tracking-wide text-blue-300">When</h4><div className="mt-2 grid gap-2 sm:grid-cols-2"><MeetingDatePicker value={date} onChange={setDate} /><MeetingTimePicker value={time} onChange={setTime} /></div></div>
          <div className="grid gap-2 sm:grid-cols-2"><label className="text-xs text-mute">Meeting category<select className={inputCls + ' mt-1'} value={meetingCategory} onChange={e => setMeetingCategory(e.target.value as 'general' | 'event')}><option value="general">General meeting</option><option value="event">Event-related meeting</option></select></label>{meetingCategory === 'event' && <label className="text-xs text-mute">Event<select required className={inputCls + ' mt-1'} value={meetingEventId} onChange={e => setMeetingEventId(e.target.value)}><option value="">Choose event</option>{eventScope.events.map(event => <option key={event.id} value={event.id}>{event.name}</option>)}</select></label>}</div>
          <div><h4 className="text-xs font-semibold uppercase tracking-wide text-blue-300">Message and audience</h4><textarea className={inputCls + ' mt-2 w-full'} rows={2} maxLength={2000} placeholder="Message for invited members (optional)" aria-label="Portal message" value={message} onChange={e => setMessage(e.target.value)} /><div className="mt-3"><AudiencePicker all={all} setAll={setAll} depts={depts} setDepts={setDepts} groups={groups} setGroups={setGroups} teams={sewadarTeams} /></div></div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3"><span className="text-xs text-mute">Invitees receive a portal notification and Outlook calendar invite when connected.</span><button type="submit" disabled={busy} className={btnPrimary}>{busy ? 'Scheduling…' : 'Schedule meeting'}</button></div>
        </form>}
      </div>
    </Card>}
    <Card icon={CalendarClock} title="All meetings" action={<span className="text-xs text-mute">{meetings.filter(m => m.status === 'scheduled' || m.status === 'live').length} scheduled</span>}>
      <Err msg={err} />
      <ul className="space-y-3">
        {sorted.map(m => <MeetingRowView key={m.id} m={m} eventName={eventScope.events.find(event => event.id === m.eventId)?.name} canChange={canSchedule} canEditMom={canEditMeetingMinutes(m)} onStatus={async (id, s) => setErr((await setMeetingStatus(id, s)) || '')} onSaveMom={saveMeetingMinutes} onGenerateMinutes={generateMeetingMinutes} onAddTask={addMeetingTask} />)}
        {!sorted.length && <Empty>{canSchedule ? 'No meetings yet.' : 'No meetings for you right now.'}</Empty>}
      </ul>
    </Card>
    </div>
  );
};

const EmergencyList: React.FC = () => {
  const { emergencies, canCallEmergency, createMeeting, setMeetingStatus, saveMeetingMinutes, sewadarTeams } = useMeetings();
  const [title, setTitle] = useState(''); const [place, setPlace] = useState(''); const [message, setMessage] = useState('');
  const [all, setAll] = useState(true); const [depts, setDepts] = useState<SubDepartmentId[]>([]); const [groups, setGroups] = useState<string[]>([]);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const call = async () => { setErr(''); if (!title.trim()) { setErr('Add a short description of the emergency.'); return; } setBusy(true); const e = await createMeeting({ kind: 'emergency', title, place, message, audienceAll: all, audienceDepts: depts, audienceGroups: groups }); setBusy(false); if (e) setErr(e); else { setTitle(''); setPlace(''); setMessage(''); setAll(true); setDepts([]); setGroups([]); setShowForm(false); } };
  return (
    <div className="space-y-4">
    {canCallEmergency && <Card icon={Siren} title="Call an emergency meetup" tone="text-red-400" className="border-red-500/25 bg-gradient-to-br from-red-500/[0.06] to-surface">
      <div className="rounded-xl border border-red-500/25 bg-gradient-to-r from-red-500/[0.10] via-red-500/[0.04] to-transparent p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-red-400/20 bg-red-500/15 text-red-300"><Siren size={19} /></span><div className="min-w-0"><h3 className="text-sm font-semibold text-ink">Notify members now</h3><p className="mt-0.5 text-xs text-mute">Share what happened, where to meet, and who should receive the alert.</p></div></div>
          <button type="button" onClick={() => setShowForm(v => !v)} className={btnDanger}>{showForm ? 'Close form' : 'Call an emergency meetup'}</button>
        </div>
        {showForm && <form onSubmit={e => { e.preventDefault(); call(); }} className="mt-4 space-y-4 rounded-lg border border-line bg-surface/80 p-3 sm:p-4">
          <div className="grid gap-2 sm:grid-cols-2"><input required className={inputCls} placeholder="What happened?" aria-label="What happened" value={title} onChange={e => setTitle(e.target.value)} /><input className={inputCls} placeholder="Meet at (optional)" aria-label="Meet at" value={place} onChange={e => setPlace(e.target.value)} /></div>
          <textarea className={inputCls + ' w-full'} rows={2} maxLength={2000} placeholder="Message for the selected members (optional)" aria-label="Emergency message" value={message} onChange={e => setMessage(e.target.value)} />
          <AudiencePicker all={all} setAll={setAll} depts={depts} setDepts={setDepts} groups={groups} setGroups={setGroups} teams={sewadarTeams} />
          <div className="flex justify-end border-t border-line pt-3"><button type="submit" disabled={busy} className={btnDanger}>{busy ? 'Calling…' : 'Send emergency alert'}</button></div>
        </form>}
      </div>
      <Err msg={err} />
    </Card>}
    <Card icon={Siren} title="Emergency meetups" tone="text-red-400" action={<span className="text-xs text-mute">{emergencies.filter(e => e.status === 'live').length} active</span>}>
      <Err msg={err} />
      <ul className="space-y-3">
        {emergencies.map(m => <MeetingRowView key={m.id} m={m} canChange={canCallEmergency} canEditMom={false} onStatus={async (id, s) => setErr((await setMeetingStatus(id, s)) || '')} onSaveMom={saveMeetingMinutes} />)}
        {!emergencies.length && <Empty>No emergency meetups. Everyone is notified at once when one is called.</Empty>}
      </ul>
    </Card>
    </div>
  );
};

export const MeetingsEmergency: React.FC<{ tab?: string }> = ({ tab }) => {
  const { meetings, emergencies } = useMeetings();
  const active = emergencies.filter(e => e.status === 'live');
  const cur = tab === 'emergency' ? 'emergency' : 'meetings';
  const go = (id: string) => { location.hash = '#/meetings/' + id; };
  return (
    <div className="space-y-4">
      <PageIntro>Plan online or in-person meetings, share a description and message with invited members, or call an emergency meetup when needed.</PageIntro>
      {active.length > 0 && cur !== 'emergency' && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm">
          <span className="flex items-center gap-2 text-ink min-w-0"><Siren size={16} className="text-red-400 shrink-0" /><span className="truncate"><b>{active.length} active {active.length > 1 ? 'emergencies' : 'emergency'}:</b> {active[0].title}</span></span>
          <button className={linkBtn} onClick={() => go('emergency')}>View</button>
        </div>
      )}
      <Tabs bordered={false} label="Meetings and emergency" value={cur} onChange={go} tabs={[
        { id: 'meetings', label: 'Meetings', count: meetings.filter(m => m.status === 'scheduled' || m.status === 'live').length },
        { id: 'emergency', label: 'Emergency', count: active.length, alert: true },
      ]} />
      {cur === 'meetings' ? <MeetingsList /> : <EmergencyList />}
    </div>
  );
};
