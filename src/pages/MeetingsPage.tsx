import React, { useState } from 'react';
import { Siren, CalendarClock, Video, MapPin, FileText, Save, Pencil } from 'lucide-react';
import { useMeetings, MeetingRow, MeetingMode } from '../context/MeetingsContext';
import { DEPTS } from './orgData';
import { Card, Pill, inputCls, btnPrimary, btnDanger, linkBtn } from '../components/ui';
import { PageIntro, Tabs } from '../components/ui';
import type { SubDepartmentId } from '../types';
import { MeetingDatePicker, MeetingTimePicker } from './MeetingDateTimePicker';

const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
const who = (m: MeetingRow) => (m.audienceAll ? 'Everyone' : m.audienceDepts.map(d => DEPTS[d] || d).join(', '));
const tone = (s: string) => s === 'live' || s === 'done' ? 'bg-emerald-500/15 text-emerald-300' : s === 'scheduled' ? 'bg-blue-500/15 text-blue-300' : s === 'cancelled' ? 'bg-red-500/15 text-red-300' : 'bg-raised text-mute';
const Empty: React.FC<{ children: React.ReactNode }> = ({ children }) => <li className="py-8 text-center text-sm text-mute">{children}</li>;
const Err: React.FC<{ msg: string }> = ({ msg }) => msg ? <p role="alert" className="text-xs text-red-400 mb-3">{msg}</p> : null;

const MeetingRowView: React.FC<{ m: MeetingRow; canChange: boolean; canEditMom: boolean; onStatus: (id: string, s: any) => void; onSaveMom: (id: string, mom: string) => Promise<string | null> }> = ({ m, canChange, canEditMom, onStatus, onSaveMom }) => {
  const [editingMom, setEditingMom] = useState(false); const [mom, setMom] = useState(m.minutes); const [momError, setMomError] = useState(''); const [savingMom, setSavingMom] = useState(false);
  const open = m.status === 'scheduled' || m.status === 'live';
  const saveMom = async () => { setSavingMom(true); setMomError(''); const e = await onSaveMom(m.id, mom); setSavingMom(false); if (e) setMomError(e); else setEditingMom(false); };
  return (
    <li className="py-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-ink font-medium">{m.title}</div>
          <div className="text-xs text-mute flex flex-wrap gap-x-2 items-center">
            <span>{when(m.startsAt)}</span>
            <span className="inline-flex items-center gap-1">{m.mode === 'online' ? <Video size={12} /> : <MapPin size={12} />}{m.mode === 'online' ? 'Online' : m.place}</span>
            <span>For {who(m)}</span><span>by {m.createdByName}</span>
          </div>
          {m.agenda && <div className="text-xs text-mute mt-1">{m.agenda}</div>}
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
  const { meetings, canSchedule, createMeeting, setMeetingStatus, saveMeetingMinutes, canEditMeetingMinutes } = useMeetings();
  const [title, setTitle] = useState(''); const [agenda, setAgenda] = useState(''); const [mode, setMode] = useState<MeetingMode>('offline');
  const [place, setPlace] = useState(''); const [link, setLink] = useState(''); const [date, setDate] = useState(''); const [time, setTime] = useState('');
  const [all, setAll] = useState(true); const [depts, setDepts] = useState<SubDepartmentId[]>([]);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [showScheduler, setShowScheduler] = useState(false);
  const toggle = (d: SubDepartmentId) => setDepts(p => p.includes(d) ? p.filter(x => x !== d) : [...p, d]);
  const submit = async () => {
    setErr(''); if (!date || !time) { setErr('Pick a date and time.'); return; }
    if (+new Date(`${date}T${time}`) <= Date.now()) { setErr('Choose a future date and time.'); return; }
    setBusy(true);
    const e = await createMeeting({ kind: 'meeting', title, agenda, mode, place, link, startsAt: new Date(`${date}T${time}`).toISOString(), audienceAll: all, audienceDepts: depts });
    setBusy(false);
    if (e) { setErr(e); return; }
    setTitle(''); setAgenda(''); setPlace(''); setLink(''); setDate(''); setTime(''); setDepts([]); setAll(true); setShowScheduler(false);
  };
  const now = Date.now();
  const isUpcoming = (m: MeetingRow) => ['scheduled', 'live'].includes(m.status) && +new Date(m.startsAt) > now;
  const sorted = [...meetings].sort((a, b) => Number(isUpcoming(b)) - Number(isUpcoming(a)) || (isUpcoming(a) ? 1 : -1) * (+new Date(a.startsAt) - +new Date(b.startsAt)));
  return (
    <Card icon={CalendarClock} title="Meetings" action={<span className="text-xs text-mute">{meetings.filter(m => m.status === 'scheduled' || m.status === 'live').length} scheduled</span>}>
      {canSchedule && <div className="border-t border-line pt-3">
        <button type="button" onClick={() => setShowScheduler(v => !v)} className="text-xs font-semibold text-blue-400 hover:text-blue-300">{showScheduler ? '− Close scheduler' : '+ Schedule a meeting'}</button>
        {showScheduler && <form onSubmit={e => { e.preventDefault(); submit(); }} className="mt-3 grid gap-2 sm:grid-cols-3">
          <input className={inputCls} placeholder="Meeting title" aria-label="Meeting title" value={title} onChange={e => setTitle(e.target.value)} />
          <MeetingDatePicker value={date} onChange={setDate} />
          <MeetingTimePicker value={time} onChange={setTime} />
          <select className={inputCls} aria-label="Meeting type" value={mode} onChange={e => setMode(e.target.value as MeetingMode)}>
            <option value="offline">Offline (in person)</option><option value="online">Online</option>
          </select>
          {mode === 'offline'
            ? <input className={inputCls} placeholder="Place" aria-label="Place" value={place} onChange={e => setPlace(e.target.value)} />
            : <input className={inputCls} placeholder="Meeting link" aria-label="Meeting link" value={link} onChange={e => setLink(e.target.value)} />}
          <input className={inputCls} placeholder="Agenda (optional)" aria-label="Agenda" value={agenda} onChange={e => setAgenda(e.target.value)} />
          <div className="sm:col-span-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-ink">
            <label className="flex items-center gap-2"><input type="radio" checked={all} onChange={() => setAll(true)} /> Everyone</label>
            <label className="flex items-center gap-2"><input type="radio" checked={!all} onChange={() => setAll(false)} /> Selected departments</label>
            {!all && (Object.keys(DEPTS) as SubDepartmentId[]).map(d => (
              <label key={d} className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={depts.includes(d)} onChange={() => toggle(d)} />{DEPTS[d]}</label>
            ))}
          </div>
          <div className="sm:col-span-3 flex items-center justify-between gap-3">
            <span className="text-xs text-mute">Everyone invited gets a notification.</span>
            <button type="submit" disabled={busy} className={btnPrimary}>{busy ? 'Scheduling…' : 'Schedule'}</button>
          </div>
        </form>}
      </div>}
      <Err msg={err} />
      <ul className="divide-y divide-line">
        {sorted.map(m => <MeetingRowView key={m.id} m={m} canChange={canSchedule} canEditMom={canEditMeetingMinutes(m)} onStatus={async (id, s) => setErr((await setMeetingStatus(id, s)) || '')} onSaveMom={saveMeetingMinutes} />)}
        {!sorted.length && <Empty>{canSchedule ? 'No meetings yet.' : 'No meetings for you right now.'}</Empty>}
      </ul>
    </Card>
  );
};

const EmergencyList: React.FC = () => {
  const { emergencies, canCallEmergency, createMeeting, setMeetingStatus, saveMeetingMinutes } = useMeetings();
  const [title, setTitle] = useState(''); const [place, setPlace] = useState(''); const [err, setErr] = useState('');
  const call = async () => { setErr(''); const e = await createMeeting({ kind: 'emergency', title, place }); if (e) setErr(e); else { setTitle(''); setPlace(''); } };
  return (
    <Card icon={Siren} title="Emergency meetups" tone="text-red-400" action={<span className="text-xs text-mute">{emergencies.filter(e => e.status === 'live').length} active</span>}>
      {canCallEmergency && (
        <form onSubmit={e => { e.preventDefault(); call(); }} className="grid gap-2 sm:grid-cols-[2fr_1fr_auto] mb-4 pb-4 border-b border-line">
          <input className={inputCls} placeholder="What happened?" aria-label="What happened" value={title} onChange={e => setTitle(e.target.value)} />
          <input className={inputCls} placeholder="Meet at" aria-label="Meet at" value={place} onChange={e => setPlace(e.target.value)} />
          <button type="submit" className={btnDanger}>Call meetup</button>
        </form>
      )}
      <Err msg={err} />
      <ul className="divide-y divide-line">
        {emergencies.map(m => <MeetingRowView key={m.id} m={m} canChange={canCallEmergency} canEditMom={false} onStatus={async (id, s) => setErr((await setMeetingStatus(id, s)) || '')} onSaveMom={saveMeetingMinutes} />)}
        {!emergencies.length && <Empty>No emergency meetups. Everyone is notified at once when one is called.</Empty>}
      </ul>
    </Card>
  );
};

export const MeetingsEmergency: React.FC<{ tab?: string }> = ({ tab }) => {
  const { meetings, emergencies } = useMeetings();
  const active = emergencies.filter(e => e.status === 'live');
  const cur = tab === 'emergency' ? 'emergency' : 'meetings';
  const go = (id: string) => { location.hash = '#/meetings/' + id; };
  return (
    <div className="space-y-4">
      <PageIntro>Schedule meetings (in person or online) for everyone or chosen departments, and call an emergency meetup when needed.</PageIntro>
      {active.length > 0 && cur !== 'emergency' && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm">
          <span className="flex items-center gap-2 text-ink min-w-0"><Siren size={16} className="text-red-400 shrink-0" /><span className="truncate"><b>{active.length} active {active.length > 1 ? 'emergencies' : 'emergency'}:</b> {active[0].title}</span></span>
          <button className={linkBtn} onClick={() => go('emergency')}>View</button>
        </div>
      )}
      <Tabs label="Meetings and emergency" value={cur} onChange={go} tabs={[
        { id: 'meetings', label: 'Meetings', count: meetings.filter(m => m.status === 'scheduled' || m.status === 'live').length },
        { id: 'emergency', label: 'Emergency', count: active.length, alert: true },
      ]} />
      {cur === 'meetings' ? <MeetingsList /> : <EmergencyList />}
    </div>
  );
};
