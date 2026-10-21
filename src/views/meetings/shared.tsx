import React, { useState } from 'react';
import {
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  FileText,
  MapPin,
  Pencil,
  Save,
  UserRound,
  Users,
  Video,
  ListPlus,
  Siren,
} from 'lucide-react';
import type { MeetingRow, MeetingStatus } from '../../context/MeetingsContext';
import { DEPTS } from '../orgData';
import { Pill, inputCls, linkBtn } from '../../components/ui';
import type { SubDepartmentId } from '../../types';

export const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
const groupName = (group: string) =>
  group === 'it:staff'
    ? 'IT Staff'
    : group === 'sewadar:all'
      ? 'All Sewadars'
      : group === 'sewadar:regular'
        ? 'Regular Sewadars'
        : group === 'sewadar:annual'
          ? 'Annual Sewadars'
          : group.startsWith('sewadar:team:')
            ? group.slice(13)
            : group;
const who = (m: MeetingRow) =>
  m.audienceAll
    ? 'Everyone'
    : [...m.audienceDepts.map(d => DEPTS[d] || d), ...m.audienceGroups.map(groupName)].join(', ');
const icsText = (value: string) =>
  value.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
const icsDate = (value: string) =>
  new Date(value)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
const downloadCalendarInvite = (meeting: MeetingRow) => {
  const start = new Date(meeting.startsAt);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const details = [meeting.agenda, meeting.message, meeting.link ? `Join: ${meeting.link}` : '']
    .filter(Boolean)
    .join('\\n\\n');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Event Command Center//Meetings//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${meeting.id}@event-command-center`,
    `DTSTAMP:${icsDate(new Date().toISOString())}`,
    `DTSTART:${icsDate(start.toISOString())}`,
    `DTEND:${icsDate(end.toISOString())}`,
    `SUMMARY:${icsText(meeting.title)}`,
    `DESCRIPTION:${icsText(details)}`,
  ];
  if (meeting.mode === 'offline' && meeting.place) lines.push(`LOCATION:${icsText(meeting.place)}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  const url = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${meeting.title.replace(/[^a-z0-9_-]+/gi, '-') || 'meeting'}.ics`;
  anchor.click();
  URL.revokeObjectURL(url);
};
const tone = (s: string) =>
  s === 'live' || s === 'done'
    ? 'bg-emerald-500/15 text-emerald-300'
    : s === 'scheduled'
      ? 'bg-blue-500/15 text-blue-300'
      : s === 'cancelled'
        ? 'bg-red-500/15 text-red-300'
        : 'bg-raised text-mute';
const meetingAction =
  'inline-flex items-center gap-1.5 rounded-md border border-line bg-surface/50 px-2.5 py-1.5 text-[11.5px] font-medium text-ink-soft transition-colors hover:border-blue-500/50 hover:text-blue-300';

export const Empty: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <li className="py-8 text-center text-sm text-mute">{children}</li>
);
export const Err: React.FC<{ msg: string }> = ({ msg }) =>
  msg ? (
    <p role="alert" className="text-xs text-red-400 mb-3">
      {msg}
    </p>
  ) : null;

export const AudiencePicker: React.FC<{
  all: boolean;
  setAll: (v: boolean) => void;
  depts: SubDepartmentId[];
  setDepts: React.Dispatch<React.SetStateAction<SubDepartmentId[]>>;
  groups: string[];
  setGroups: React.Dispatch<React.SetStateAction<string[]>>;
  teams: string[];
}> = ({ all, setAll, depts, setDepts, groups, setGroups, teams }) => {
  const toggleDept = (d: SubDepartmentId) => setDepts(p => (p.includes(d) ? p.filter(x => x !== d) : [...p, d]));
  const toggleGroup = (g: string) => setGroups(p => (p.includes(g) ? p.filter(x => x !== g) : [...p, g]));
  const choices: [string, string][] = [
    ['it:staff', 'IT Staff'],
    ['sewadar:all', 'All Sewadars'],
    ['sewadar:regular', 'Regular Sewadars'],
    ['sewadar:annual', 'Annual Sewadars'],
    ...teams.map(t => [`sewadar:team:${t}`, t] as [string, string]),
  ];
  return (
    <fieldset className="sm:col-span-3 space-y-3 rounded-lg border border-line bg-raised/20 p-3">
      <legend className="px-1 text-xs font-semibold text-ink">Who should receive this?</legend>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-ink">
        <label className="flex items-center gap-2">
          <input type="radio" name="audience" checked={all} onChange={() => setAll(true)} /> Everyone
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="audience" checked={!all} onChange={() => setAll(false)} /> Selected groups
        </label>
      </div>
      {!all && (
        <div className="grid gap-3 border-t border-line pt-3 sm:grid-cols-2">
          <div className="space-y-2">
            <div className="text-[10.5px] font-semibold uppercase tracking-wide text-mute">Departments</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {(Object.keys(DEPTS) as SubDepartmentId[]).map(d => (
                <label key={d} className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={depts.includes(d)} onChange={() => toggleDept(d)} />
                  {DEPTS[d]}
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <div className="text-[10.5px] font-semibold uppercase tracking-wide text-mute">Member groups</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {choices.map(([value, label]) => (
                <label key={value} className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={groups.includes(value)} onChange={() => toggleGroup(value)} />
                  {label}
                </label>
              ))}
            </div>
            {!teams.length && <p className="text-xs text-mute">No Sewadar teams have been added yet.</p>}
          </div>
        </div>
      )}
      <p className="text-xs text-mute">
        Selected members receive a portal alert. Meeting invitations are also sent by email when connected.
      </p>
    </fieldset>
  );
};

export type MeetingTaskDraft = { title: string; department: SubDepartmentId; dueDate: string; priority: string };
export const MeetingRowView: React.FC<{
  m: MeetingRow;
  eventName?: string;
  canChange: boolean;
  canEditMom: boolean;
  onStatus: (id: string, s: MeetingStatus) => void;
  onSaveMom: (id: string, mom: string) => Promise<string | null>;
  onGenerateMinutes?: (id: string) => Promise<string | null>;
  onAddTask?: (m: MeetingRow, task: MeetingTaskDraft) => Promise<string | null>;
}> = ({ m, eventName, canChange, canEditMom, onStatus, onSaveMom, onGenerateMinutes, onAddTask }) => {
  const [editingMom, setEditingMom] = useState(false);
  const [mom, setMom] = useState(m.minutes);
  const [momError, setMomError] = useState('');
  const [savingMom, setSavingMom] = useState(false);
  const [generatingMom, setGeneratingMom] = useState(false);
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [task, setTask] = useState<MeetingTaskDraft>({
    title: '',
    department: 'sewadars',
    dueDate: '',
    priority: 'as_you_have_time',
  });
  const [taskError, setTaskError] = useState('');
  const [savingTask, setSavingTask] = useState(false);
  const open = m.status === 'scheduled' || m.status === 'live';
  const saveMom = async () => {
    setSavingMom(true);
    setMomError('');
    const e = await onSaveMom(m.id, mom);
    setSavingMom(false);
    if (e) setMomError(e);
    else setEditingMom(false);
  };
  return (
    <li
      className={`rounded-xl border ${m.kind === 'emergency' && open ? 'border-red-500/40 bg-red-500/[0.04]' : 'border-line bg-raised/20'} px-4 py-3 text-sm`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg border ${m.kind === 'emergency' ? 'border-red-400/20 bg-red-500/15 text-red-300' : 'border-blue-400/20 bg-blue-500/15 text-blue-300'}`}
          >
            {m.kind === 'emergency' ? <Siren size={18} /> : <CalendarClock size={18} />}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate font-semibold text-ink">{m.title}</h3>
              <Pill c={tone(m.status)}>{m.status === 'done' ? '✓ Done' : m.status}</Pill>
            </div>
            <p className="mt-0.5 text-xs text-mute">{m.kind === 'emergency' ? 'Emergency meetup' : 'Meeting'}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {m.kind === 'meeting' && (
            <button type="button" className={meetingAction} onClick={() => downloadCalendarInvite(m)}>
              <CalendarPlus size={13} />
              Calendar
            </button>
          )}
          {m.kind === 'meeting' && m.status === 'done' && !m.minutes && canEditMom && onGenerateMinutes && (
            <button
              type="button"
              className={meetingAction}
              disabled={generatingMom}
              onClick={async () => {
                setGeneratingMom(true);
                setMomError('');
                const error = await onGenerateMinutes(m.id);
                setGeneratingMom(false);
                if (error) setMomError(error);
              }}
            >
              <FileText size={13} />
              {generatingMom ? 'Generating…' : 'Retry minutes'}
            </button>
          )}
          {canChange && m.status === 'scheduled' && (
            <button className={linkBtn} onClick={() => onStatus(m.id, 'live')}>
              Start
            </button>
          )}
          {canChange && open && (
            <button className={linkBtn} onClick={() => onStatus(m.id, 'done')}>
              {m.kind === 'emergency' ? 'Resolve' : 'Mark done'}
            </button>
          )}
          {canChange && m.status === 'scheduled' && (
            <button className={linkBtn} onClick={() => onStatus(m.id, 'cancelled')}>
              Cancel
            </button>
          )}
          {canChange && m.kind === 'meeting' && onAddTask && (
            <button className={meetingAction} onClick={() => setShowTaskForm(value => !value)}>
              <ListPlus size={13} />
              Action item
            </button>
          )}
        </div>
      </div>
      <div className="ml-11 mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-[11.5px] text-mute">
        <span className="inline-flex items-center gap-1.5">
          <CalendarDays size={13} />
          {when(m.startsAt)}
        </span>
        <span className="inline-flex items-center gap-1.5">
          {m.mode === 'online' ? <Video size={13} /> : <MapPin size={13} />}
          {m.mode === 'online' ? 'Online' : m.place || 'Location not set'}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Users size={13} />
          {who(m) || 'No audience selected'}
        </span>
        {m.createdByName && (
          <span className="inline-flex items-center gap-1.5">
            <UserRound size={13} />
            {m.createdByName}
          </span>
        )}
        {m.eventId && (
          <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-blue-300">{eventName || 'Linked event'}</span>
        )}
        {m.mode === 'online' && m.link && open && (
          <a className={linkBtn} href={m.link} target="_blank" rel="noreferrer">
            Join meeting
          </a>
        )}
      </div>
      {(m.agenda || m.message) && (
        <section className="ml-11 mt-3 space-y-1 border-t border-line/70 pt-2.5">
          <h4 className="text-[10.5px] font-semibold uppercase tracking-wide text-mute">Details</h4>
          {m.agenda && <p className="text-xs leading-relaxed text-ink-soft whitespace-pre-wrap">{m.agenda}</p>}
          {m.message && <p className="text-xs leading-relaxed text-ink-soft whitespace-pre-wrap">{m.message}</p>}
        </section>
      )}
      {m.kind === 'meeting' && (m.minutes || canEditMom) && (
        <section className="ml-11 mt-3 border-t border-line/70 pt-2.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h4 className="flex items-center gap-2 text-xs font-semibold text-ink">
              <FileText size={16} />
              Meeting minutes
            </h4>
            {canEditMom && !editingMom && (
              <button
                type="button"
                className={linkBtn}
                onClick={() => {
                  setMom(m.minutes);
                  setEditingMom(true);
                }}
              >
                <Pencil size={12} />
                {m.minutes ? 'Edit minutes' : 'Add minutes'}
              </button>
            )}
          </div>
          {momError && !editingMom && <Err msg={momError} />}
          {editingMom ? (
            <div className="mt-2 space-y-2">
              <textarea
                className={inputCls + ' w-full'}
                rows={4}
                maxLength={20000}
                placeholder="Decisions, action items, owners and due dates…"
                value={mom}
                onChange={e => setMom(e.target.value)}
              />
              <Err msg={momError} />
              <div className="flex justify-end gap-2">
                <button
                  className={linkBtn}
                  onClick={() => {
                    setEditingMom(false);
                    setMom(m.minutes);
                  }}
                >
                  Cancel
                </button>
                <button className={linkBtn} disabled={savingMom} onClick={saveMom}>
                  <Save size={12} />
                  {savingMom ? 'Saving…' : 'Save minutes'}
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-2 whitespace-pre-wrap text-xs leading-snug text-ink-soft">
              {m.minutes || <span className="text-faint">No minutes added yet.</span>}
            </div>
          )}
        </section>
      )}
      {showTaskForm && onAddTask && (
        <form
          className="ml-11 mt-3 grid gap-2 rounded-lg border border-line bg-raised/40 p-3 sm:grid-cols-2"
          onSubmit={async event => {
            event.preventDefault();
            setTaskError('');
            setSavingTask(true);
            const error = await onAddTask(m, task);
            setSavingTask(false);
            if (error) setTaskError(error);
            else {
              setTask({ ...task, title: '' });
              setShowTaskForm(false);
            }
          }}
        >
          <h4 className="sm:col-span-2 text-xs font-semibold text-ink">Create task from meeting action</h4>
          <input
            required
            className={inputCls}
            placeholder="Action / task"
            value={task.title}
            onChange={e => setTask(old => ({ ...old, title: e.target.value }))}
          />
          <select
            className={inputCls}
            aria-label="Department responsible"
            value={task.department}
            onChange={e => setTask(old => ({ ...old, department: e.target.value as SubDepartmentId }))}
          >
            {Object.entries(DEPTS).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
          <label className="text-xs text-mute">
            Deadline
            <input
              required
              type="date"
              className={inputCls + ' mt-1'}
              value={task.dueDate}
              onChange={e => setTask(old => ({ ...old, dueDate: e.target.value }))}
            />
          </label>
          <label className="text-xs text-mute">
            Priority
            <select
              className={inputCls + ' mt-1'}
              value={task.priority}
              onChange={e => setTask(old => ({ ...old, priority: e.target.value }))}
            >
              <option value="immediately">Urgent</option>
              <option value="till_time">High · due by deadline</option>
              <option value="as_you_have_time">Normal</option>
            </select>
          </label>
          <Err msg={taskError} />
          <button type="submit" className={linkBtn} disabled={savingTask}>
            {savingTask ? 'Adding…' : 'Add task'}
          </button>
        </form>
      )}
    </li>
  );
};
