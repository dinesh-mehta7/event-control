import React, { useState } from 'react';
import { Siren } from 'lucide-react';
import { useMeetings } from '../../context/MeetingsContext';
import { Card, inputCls, btnDanger } from '../../components/ui';
import type { SubDepartmentId } from '../../types';
import { AudiencePicker, Empty, Err, MeetingRowView } from './shared';
export const EmergencyList: React.FC = () => {
  const { emergencies, canCallEmergency, createMeeting, setMeetingStatus, saveMeetingMinutes, sewadarTeams } =
    useMeetings();
  const [title, setTitle] = useState('');
  const [place, setPlace] = useState('');
  const [message, setMessage] = useState('');
  const [all, setAll] = useState(true);
  const [depts, setDepts] = useState<SubDepartmentId[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const call = async () => {
    setErr('');
    if (!title.trim()) {
      setErr('Add a short description of the emergency.');
      return;
    }
    if (!all && !depts.length && !groups.length) {
      setErr('Choose at least one department or member group, or select Everyone.');
      return;
    }
    setBusy(true);
    const e = await createMeeting({
      kind: 'emergency',
      title: title.trim(),
      place,
      message,
      audienceAll: all,
      audienceDepts: depts,
      audienceGroups: groups,
    });
    setBusy(false);
    if (e) setErr(e);
    else {
      setTitle('');
      setPlace('');
      setMessage('');
      setAll(true);
      setDepts([]);
      setGroups([]);
      setShowForm(false);
    }
  };
  return (
    <div className="space-y-4">
      {canCallEmergency && (
        <Card
          icon={Siren}
          title="Call an emergency meetup"
          tone="text-red-400"
          className="border-red-500/25 bg-gradient-to-br from-red-500/[0.06] to-surface"
        >
          <div className="rounded-xl border border-red-500/25 bg-gradient-to-r from-red-500/[0.10] via-red-500/[0.04] to-transparent p-3 sm:p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-red-400/20 bg-red-500/15 text-red-300">
                  <Siren size={19} />
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-ink">Notify members now</h3>
                  <p className="mt-0.5 text-xs text-mute">
                    Share what happened, where to meet, and who should receive the alert.
                  </p>
                </div>
              </div>
              <button type="button" aria-expanded={showForm} onClick={() => setShowForm(v => !v)} className={btnDanger}>
                {showForm ? 'Close alert form' : 'Call an emergency meetup'}
              </button>
            </div>
            {showForm && (
              <form
                onSubmit={e => {
                  e.preventDefault();
                  call();
                }}
                className="mt-4 space-y-4 rounded-lg border border-line bg-surface/80 p-3 sm:p-4"
              >
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="text-xs font-medium text-ink-soft">
                    Emergency summary
                    <input
                      required
                      maxLength={160}
                      className={inputCls + ' mt-1 w-full'}
                      placeholder="What happened?"
                      aria-label="What happened"
                      value={title}
                      onChange={e => setTitle(e.target.value)}
                    />
                  </label>
                  <label className="text-xs font-medium text-ink-soft">
                    Assembly point
                    <input
                      className={inputCls + ' mt-1 w-full'}
                      placeholder="Where should members meet?"
                      aria-label="Meet at"
                      value={place}
                      onChange={e => setPlace(e.target.value)}
                    />
                  </label>
                </div>
                <textarea
                  className={inputCls + ' w-full'}
                  rows={2}
                  maxLength={2000}
                  placeholder="Message for the selected members (optional)"
                  aria-label="Emergency message"
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                />
                <AudiencePicker
                  all={all}
                  setAll={setAll}
                  depts={depts}
                  setDepts={setDepts}
                  groups={groups}
                  setGroups={setGroups}
                  teams={sewadarTeams}
                />
                <div className="flex justify-end border-t border-line pt-3">
                  <button type="submit" disabled={busy} className={btnDanger}>
                    {busy ? 'Calling…' : 'Send emergency alert'}
                  </button>
                </div>
              </form>
            )}
          </div>
          <Err msg={err} />
        </Card>
      )}
      <Card
        icon={Siren}
        title="Emergency log"
        tone="text-red-400"
        action={
          <span className="text-xs text-mute">
            {emergencies.filter(e => e.status === 'live').length} active · {emergencies.length} total
          </span>
        }
      >
        <Err msg={err} />
        <ul className="space-y-3">
          {emergencies.map(m => (
            <MeetingRowView
              key={m.id}
              m={m}
              canChange={canCallEmergency}
              canEditMom={false}
              onStatus={async (id, s) => setErr((await setMeetingStatus(id, s)) || '')}
              onSaveMom={saveMeetingMinutes}
            />
          ))}
          {!emergencies.length && <Empty>No emergency meetups. Everyone is notified at once when one is called.</Empty>}
        </ul>
      </Card>
    </div>
  );
};
