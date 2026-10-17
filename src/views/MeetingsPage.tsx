import React from 'react';
import { Siren, Clock3, FileClock } from 'lucide-react';
import { useMeetings } from '../context/MeetingsContext';
import { btnDanger } from '../components/ui';
import { PageIntro, Tabs } from '../components/ui';
import { Swap } from '../components/Swap';
import { when } from './meetings/shared';
import { MeetingsList } from './meetings/MeetingsList';
import { EmergencyList } from './meetings/EmergencyList';
export const MeetingsEmergency: React.FC<{ tab?: string }> = ({ tab }) => {
  const { meetings, emergencies } = useMeetings();
  const active = emergencies.filter(e => e.status === 'live');
  const upcoming = meetings.filter(m => m.status === 'scheduled' && +new Date(m.startsAt) > Date.now());
  const minutesToWrite = meetings.filter(m => m.status === 'done' && !m.minutes).length;
  const cur = tab === 'emergency' ? 'emergency' : 'meetings';
  const go = (id: string) => { location.hash = '#/meetings/' + id; };
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-line bg-gradient-to-br from-blue-500/[0.08] via-surface to-surface p-5 sm:p-6">
        <PageIntro>Keep plans, decisions, and urgent coordination in one place.</PageIntro>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <button type="button" onClick={() => go('meetings')} className="flex items-center gap-3 rounded-xl border border-line bg-surface/70 p-3 text-left hover:border-blue-400/40"><span className="grid h-9 w-9 place-items-center rounded-lg bg-blue-500/10 text-blue-300"><Clock3 size={17} /></span><span><strong className="block text-lg text-ink">{upcoming.length}</strong><span className="text-xs text-mute">Upcoming meetings</span></span></button>
          <button type="button" onClick={() => go('emergency')} className={`flex items-center gap-3 rounded-xl border p-3 text-left ${active.length ? 'border-red-500/40 bg-red-500/[0.08]' : 'border-line bg-surface/70'}`}><span className="grid h-9 w-9 place-items-center rounded-lg bg-red-500/10 text-red-300"><Siren size={17} /></span><span><strong className={`block text-lg ${active.length ? 'text-red-300' : 'text-ink'}`}>{active.length}</strong><span className="text-xs text-mute">Active emergencies</span></span></button>
          <button type="button" onClick={() => go('meetings')} className="flex items-center gap-3 rounded-xl border border-line bg-surface/70 p-3 text-left hover:border-blue-400/40"><span className="grid h-9 w-9 place-items-center rounded-lg bg-amber-500/10 text-amber-300"><FileClock size={17} /></span><span><strong className="block text-lg text-ink">{minutesToWrite}</strong><span className="text-xs text-mute">Meetings needing minutes</span></span></button>
        </div>
      </div>
      {active.length > 0 && <div role="alert" className="rounded-xl border border-red-500/40 bg-red-500/[0.08] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex min-w-0 items-start gap-3"><Siren size={19} className="mt-0.5 shrink-0 text-red-400" /><div><p className="text-sm font-semibold text-red-300">{active.length} active {active.length === 1 ? 'emergency' : 'emergencies'}</p><p className="mt-1 text-sm font-medium text-ink">{active[0].title}</p><p className="mt-1 text-xs text-mute">{active[0].place || 'Assembly point not specified'} · Started {when(active[0].startsAt)}</p>{active[0].message && <p className="mt-2 max-w-3xl whitespace-pre-wrap text-sm text-ink-soft">{active[0].message}</p>}</div></div><button className={btnDanger} onClick={() => go('emergency')}>Open emergency log</button></div>
        </div>
      }
      <Tabs bordered={false} label="Meetings and emergency" value={cur} onChange={go} tabs={[
        { id: 'meetings', label: 'Meetings', count: meetings.filter(m => m.status === 'scheduled' || m.status === 'live').length },
        { id: 'emergency', label: 'Emergency', count: active.length, alert: true },
      ]} />
      <Swap k={cur} indexOf={k => ['meetings', 'emergency'].indexOf(k)}>{cur === 'meetings' ? <MeetingsList /> : <EmergencyList />}</Swap>
    </div>
  );
};
