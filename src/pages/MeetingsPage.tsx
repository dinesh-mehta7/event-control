import React, { useState } from 'react';
import { Siren, CalendarClock, Video, MapPin, FileText, Save, Pencil } from 'lucide-react';
import { useMeetings, MeetingRow, MeetingMode } from '../context/MeetingsContext';
import { DEPTS } from './orgData';
import { Card, Pill, inputCls, btnPrimary, btnDanger, linkBtn } from '../components/ui';
import { PageIntro, Tabs } from '../components/ui';
import type { SubDepartmentId } from '../types';
import { MeetingDatePicker, MeetingTimePicker } from './MeetingDateTimePicker';

const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
const groupName = (group: string) => group === 'it:staff' ? 'IT Staff' : group === 'sewadar:all' ? 'All Sewadars' : group === 'sewadar:regular' ? 'Regular Sewadars' : group === 'sewadar:annual' ? 'Annual Sewadars' : group.startsWith('sewadar:team:') ? group.slice(13) : group;
const who = (m: MeetingRow) => (m.audienceAll ? 'Everyone' : [...m.audienceDepts.map(d => DEPTS[d] || d), ...m.audienceGroups.map(groupName)].join(', '));
const tone = (s: string) => s === 'live' || s === 'done' ? 'bg-emerald-500/15 text-emerald-300' : s === 'scheduled' ? 'bg-blue-500/15 text-blue-300' : s === 'cancelled' ? 'bg-red-500/15 text-red-300' : 'bg-raised text-mute';
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

const MeetingRowView: React.FC<{ m: MeetingRow; canChange: boolean; canEditMom: boolean; onStatus: (id: string, s: any) => void; onSaveMom: (id: string, mom: string) => Promise<string | null> }> = ({ m, canChange, canEditMom, onStatus, onSaveMom }) => {
  const [editingMom, setEditingMom] = useState(false); const [mom, setMom] = useState(m.minutes); const [momError, setMomError] = useState(''); const [savingMom, setSavingMom] = useState(false);
  const open = m.status === 'scheduled' || m.status === 'live';
  const saveMom = async () => { setSavingMom(true); setMomError(''); const e = await onSaveMom(m.id, mom); setSavingMom(false); if (e) setMomError(e); else setEditingMom(false); };
  return (
    <li className="rounded-xl border border-line bg-raised/20 p-4 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-ink font-medium">{m.title}</div>
          <div className="text-xs text-mute flex flex-wrap gap-x-2 items-center">
            <span>{when(m.startsAt)}</span>
            <span className="inline-flex items-center gap-1">{m.mode === 'online' ? <Video size={12} /> : <MapPin size={12} />}{m.mode === 'online' ? 'Online' : m.place}</span>
            <span>For {who(m)}</span><span>by {m.createdByName}</span>
          </div>
          {m.agenda && <div className="mt-2 inline-block max-w-full rounded-lg border border-line/70 bg-surface/50 px-2.5 py-1.5"><div className="mb-0.5 text-[9px] font-semibold uppercase tracking-wide text-mute">Description</div><div className="text-[10px] leading-snug text-ink-soft whitespace-pre-wrap">{m.agenda}</div></div>}
          {m.message && <div className="mt-2 rounded-md border border-blue-500/20 bg-blue-500/5 px-2.5 py-2 text-[11px] text-ink-soft whitespace-pre-wrap">{m.message}</div>}
          {m.mode === 'online' && m.link && open && <a className={linkBtn} href={m.link} target="_blank" rel="noreferrer">Join meeting</a>}
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          <Pill c={tone(m.status)}>{m.status}</Pill>
          {canChange && m.status === 'scheduled' && <button className={linkBtn} onClick={() => onStatus(m.id, 'live')}>Start</button>}
          {canChange && open && <button className={linkBtn} onClick={() => onStatus(m.id, 'done')}>{m.kind === 'emergency' ? 'Resolve' : 'Mark done'}</button>}
          {canChange && m.status === 'scheduled' && <button className={linkBtn} onClick={() => onStatus(m.id, 'cancelled')}>Cancel</button>}
        </div>
      </div>
      {m.kind === 'meeting' && (m.minutes || canEditMom) && <section className="mt-3 rounded-lg border border-line bg-raised/40 p-3">
        <div className="flex items-center justify-between gap-3 mb-2">
          <h4 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-blue-400"><FileText size={12} />Minutes of meeting</h4>
          {canEditMom && !editingMom && <button type="button" className={linkBtn} onClick={() => { setMom(m.minutes); setEditingMom(true); }}><Pencil size={12} />{m.minutes ? 'Edit MOM' : 'Add MOM'}</button>}
        </div>
        {editingMom
          ? <div className="space-y-2">
              <textarea className={inputCls + ' w-full'} rows={4} maxLength={20000} placeholder="Decisions, action items, owners and due dates…" value={mom} onChange={e => setMom(e.target.value)} />
              <Err msg={momError} />
              <div className="flex justify-end gap-2"><button className={linkBtn} onClick={() => { setEditingMom(false); setMom(m.minutes); }}>Cancel</button><button className={linkBtn} disabled={savingMom} onClick={saveMom}><Save size={12} />{savingMom ? 'Saving…' : 'Save MOM'}</button></div>
            </div>
          : <div className="whitespace-pre-wrap text-xs leading-relaxed text-ink-soft">{m.minutes || <span className="text-faint">No minutes added yet.</span>}</div>}
      </section>}
    </li>
  );
};

const MeetingsList: React.FC = () => {
  const { meetings, canSchedule, createMeeting, setMeetingStatus, saveMeetingMinutes, canEditMeetingMinutes, sewadarTeams } = useMeetings();
  const [title, setTitle] = useState(''); const [agenda, setAgenda] = useState(''); const [mode, setMode] = useState<MeetingMode>('offline');
  const [place, setPlace] = useState(''); const [link, setLink] = useState(''); const [date, setDate] = useState(''); const [time, setTime] = useState('');
  const [all, setAll] = useState(true); const [depts, setDepts] = useState<SubDepartmentId[]>([]); const [groups, setGroups] = useState<string[]>([]); const [message, setMessage] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [showScheduler, setShowScheduler] = useState(false);
  const submit = async () => {
    setErr(''); if (!date || !time) { setErr('Pick a date and time.'); return; }
    if (+new Date(`${date}T${time}`) <= Date.now()) { setErr('Choose a future date and time.'); return; }
    setBusy(true);
    const e = await createMeeting({ kind: 'meeting', title, agenda, message, mode, place, link, startsAt: new Date(`${date}T${time}`).toISOString(), audienceAll: all, audienceDepts: depts, audienceGroups: groups });
    setBusy(false);
    if (e) { setErr(e); return; }
    setTitle(''); setAgenda(''); setMessage(''); setPlace(''); setLink(''); setDate(''); setTime(''); setDepts([]); setGroups([]); setAll(true); setShowScheduler(false);
  };
  const now = Date.now();
  const isUpcoming = (m: MeetingRow) => ['scheduled', 'live'].includes(m.status) && +new Date(m.startsAt) > now;
  const sorted = [...meetings].sort((a, b) => Number(isUpcoming(b)) - Number(isUpcoming(a)) || (isUpcoming(a) ? 1 : -1) * (+new Date(a.startsAt) - +new Date(b.startsAt)));
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
            {mode === 'offline' ? <input required className={inputCls} placeholder="Place" aria-label="Place" value={place} onChange={e => setPlace(e.target.value)} /> : <input required className={inputCls} placeholder="Meeting link" aria-label="Meeting link" value={link} onChange={e => setLink(e.target.value)} />}
            <input className={inputCls} placeholder="Agenda (optional)" aria-label="Agenda" value={agenda} onChange={e => setAgenda(e.target.value)} />
          </div></div>
          <div><h4 className="text-xs font-semibold uppercase tracking-wide text-blue-300">When</h4><div className="mt-2 grid gap-2 sm:grid-cols-2"><MeetingDatePicker value={date} onChange={setDate} /><MeetingTimePicker value={time} onChange={setTime} /></div></div>
          <div><h4 className="text-xs font-semibold uppercase tracking-wide text-blue-300">Message and audience</h4><textarea className={inputCls + ' mt-2 w-full'} rows={2} maxLength={2000} placeholder="Message for invited members (optional)" aria-label="Portal message" value={message} onChange={e => setMessage(e.target.value)} /><div className="mt-3"><AudiencePicker all={all} setAll={setAll} depts={depts} setDepts={setDepts} groups={groups} setGroups={setGroups} teams={sewadarTeams} /></div></div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3"><span className="text-xs text-mute">Invited accounts receive a portal notification.</span><button type="submit" disabled={busy} className={btnPrimary}>{busy ? 'Scheduling…' : 'Schedule meeting'}</button></div>
        </form>}
      </div>
    </Card>}
    <Card icon={CalendarClock} title="All meetings" action={<span className="text-xs text-mute">{meetings.filter(m => m.status === 'scheduled' || m.status === 'live').length} scheduled</span>}>
      <Err msg={err} />
      <ul className="space-y-3">
        {sorted.map(m => <MeetingRowView key={m.id} m={m} canChange={canSchedule} canEditMom={canEditMeetingMinutes(m)} onStatus={async (id, s) => setErr((await setMeetingStatus(id, s)) || '')} onSaveMom={saveMeetingMinutes} />)}
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
