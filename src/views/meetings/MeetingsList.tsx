import React, { useEffect, useState } from 'react';
import { CalendarClock, ExternalLink, Search } from 'lucide-react';
import { useMeetings, type MeetingMode, type MeetingRow } from '../../context/MeetingsContext';
import { DEPTS } from '../orgData';
import { Card, inputCls, btnPrimary } from '../../components/ui';
import type { SubDepartmentId } from '../../types';
import { AudiencePicker, Empty, Err, MeetingRowView, type MeetingTaskDraft } from './shared';
import { MeetingDatePicker, MeetingTimePicker } from '../MeetingDateTimePicker';
import { useWalkie } from '../../modules/walkie';
import { supabase } from '../../modules/walkie/lib/supabaseClient';
import { useEventScope } from '../../context/EventScopeContext';
export const MeetingsList: React.FC<{ eventId?: string }> = ({ eventId }) => {
  const {
    meetings,
    canSchedule,
    createMeeting,
    setMeetingStatus,
    saveMeetingMinutes,
    generateMeetingMinutes,
    canEditMeetingMinutes,
    sewadarTeams,
    ready,
  } = useMeetings();
  const auth: any = useWalkie();
  const eventScope = useEventScope();
  const [title, setTitle] = useState('');
  const [agenda, setAgenda] = useState('');
  const [mode, setMode] = useState<MeetingMode>('online');
  const [onlinePlatform, setOnlinePlatform] = useState<'google' | 'teams' | 'outlook'>('teams');
  const [place, setPlace] = useState('');
  const [link, setLink] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [all, setAll] = useState(true);
  const [depts, setDepts] = useState<SubDepartmentId[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [showScheduler, setShowScheduler] = useState(false);
  const [schedulerStep, setSchedulerStep] = useState<'details' | 'when' | 'audience'>('details');
  const [meetingCategory, setMeetingCategory] = useState<'general' | 'event'>(eventId ? 'event' : 'general');
  const [meetingEventId, setMeetingEventId] = useState(() => eventId || eventScope.scopeFor('event-reports'));
  const [teamsAttendees, setTeamsAttendees] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [meetingFilter, setMeetingFilter] = useState<'all' | 'upcoming' | 'past'>('upcoming');
  useEffect(() => {
    const selectedEvent = eventId || eventScope.scopeFor('event-reports');
    if (selectedEvent && eventScope.events.some(event => event.id === selectedEvent)) {
      setMeetingEventId(selectedEvent);
      setMeetingCategory('event');
    }
  }, [eventId, eventScope.events, eventScope.scopeFor]);
  useEffect(() => {
    const organizationId = auth.currentUser?.organizationId;
    if (!organizationId) {
      setTeamsAttendees([]);
      return;
    }
    let live = true;
    const loadAttendees = async () => {
      const [{ data: people }, { data: members }] = await Promise.all([
        supabase
          .from('profiles')
          .select('id,email,level,sub_department')
          .eq('organization_id', organizationId)
          .eq('approved', true)
          .eq('is_active', true),
        supabase
          .from('accommodation_members')
          .select('profile_id,member_type,team_name,team_names')
          .eq('organization_id', organizationId)
          .not('profile_id', 'is', null),
      ]);
      if (!live) return;
      const linked = new Map<string, any[]>();
      for (const member of members || [])
        if (member.profile_id) linked.set(member.profile_id, [...(linked.get(member.profile_id) || []), member]);
      const emails = (people || [])
        .filter(person => {
          if (person.id === auth.currentUser?.id) return false;
          if (all || ['owner', 'dept_head'].includes(person.level) || depts.includes(person.sub_department))
            return true;
          if (groups.includes('it:staff') && ['staff', 'sub_dept_head', 'dept_head'].includes(person.level))
            return true;
          return (linked.get(person.id) || []).some(member => {
            const teamNames = [member.team_name, ...(Array.isArray(member.team_names) ? member.team_names : [])]
              .filter(Boolean)
              .map((name: string) => name.toLocaleLowerCase());
            return (
              groups.includes('sewadar:all') ||
              (groups.includes('sewadar:regular') && ['salary_based', 'monthly'].includes(member.member_type)) ||
              (groups.includes('sewadar:annual') && member.member_type === 'annual') ||
              groups.some(
                group =>
                  group.startsWith('sewadar:team:') && teamNames.includes(group.slice(13).trim().toLocaleLowerCase()),
              )
            );
          });
        })
        .map(person =>
          String(person.email || '')
            .trim()
            .toLowerCase(),
        )
        .filter(Boolean);
      setTeamsAttendees(Array.from(new Set(emails)));
    };
    void loadAttendees();
    return () => {
      live = false;
    };
  }, [auth.currentUser?.organizationId, auth.currentUser?.id, all, depts, groups]);
  const providerComposer = () => {
    const start = new Date(`${date}T${time}`);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const description = [agenda, message].filter(Boolean).join('\n\n');
    const p = new URLSearchParams();
    if (onlinePlatform === 'google') {
      p.set('action', 'TEMPLATE');
      p.set('text', title);
      p.set(
        'dates',
        `${start
          .toISOString()
          .replace(/[-:]/g, '')
          .replace(/\.\d{3}Z$/, 'Z')}/${end
          .toISOString()
          .replace(/[-:]/g, '')
          .replace(/\.\d{3}Z$/, 'Z')}`,
      );
      p.set('details', description);
      p.set('ctz', 'Asia/Kolkata');
      return `https://calendar.google.com/calendar/render?${p.toString()}`;
    }
    if (onlinePlatform === 'teams') {
      p.set('subject', title);
      p.set('startTime', start.toISOString());
      p.set('endTime', end.toISOString());
      p.set('content', description);
      if (teamsAttendees.length) p.set('attendees', teamsAttendees.join(','));
      return `https://teams.microsoft.com/l/meeting/new?${p.toString().replace(/\+/g, '%20')}`;
    }
    p.set('path', '/calendar/action/compose');
    p.set('rru', 'addevent');
    p.set('subject', title);
    p.set('body', description);
    p.set('startdt', start.toISOString());
    p.set('enddt', end.toISOString());
    return `https://outlook.office.com/calendar/0/deeplink/compose?${p.toString()}`;
  };
  const submit = async () => {
    setErr('');
    if (!date || !time) {
      setErr('Pick a date and time.');
      setSchedulerStep('when');
      return;
    }
    if (!title.trim()) {
      setErr('Add a meeting title.');
      setSchedulerStep('details');
      return;
    }
    if (mode === 'offline' && !place.trim()) {
      setErr('Add the meeting place.');
      setSchedulerStep('details');
      return;
    }
    if (mode === 'online' && onlinePlatform !== 'teams' && !link.trim()) {
      setErr('Add the meeting link.');
      setSchedulerStep('details');
      return;
    }
    if (!all && !depts.length && !groups.length) {
      setErr('Choose at least one department or member group, or select Everyone.');
      setSchedulerStep('audience');
      return;
    }
    if (meetingCategory === 'event' && !meetingEventId) {
      setErr('Choose the event this meeting belongs to.');
      setSchedulerStep('when');
      return;
    }
    if (+new Date(`${date}T${time}`) <= Date.now()) {
      setErr('Choose a future date and time.');
      setSchedulerStep('when');
      return;
    }
    setBusy(true);
    const e = await createMeeting({
      kind: 'meeting',
      title: title.trim(),
      agenda,
      message,
      mode,
      place,
      link,
      startsAt: new Date(`${date}T${time}`).toISOString(),
      audienceAll: all,
      audienceDepts: depts,
      audienceGroups: groups,
      eventId: meetingCategory === 'event' ? meetingEventId : undefined,
    });
    setBusy(false);
    const emailWarning = e?.startsWith('EMAIL_WARNING:') ? e.slice('EMAIL_WARNING:'.length).trim() : '';
    if (e && !emailWarning) {
      setErr(e);
      return;
    }
    setTitle('');
    setAgenda('');
    setMessage('');
    setPlace('');
    setLink('');
    setDate('');
    setTime('');
    setDepts([]);
    setGroups([]);
    setAll(true);
    setMeetingCategory(eventId ? 'event' : 'general');
    setShowScheduler(!!eventId);
    if (emailWarning) setErr(emailWarning);
  };
  const now = Date.now();
  const isUpcoming = (m: MeetingRow) => ['scheduled', 'live'].includes(m.status) && +new Date(m.startsAt) > now;
  const isPast = (m: MeetingRow) => +new Date(m.startsAt) <= now || ['done', 'cancelled'].includes(m.status);
  const sorted = [...meetings]
    .filter(m => !eventId || m.eventId === eventId)
    .filter(m => meetingFilter === 'all' || (meetingFilter === 'upcoming' ? isUpcoming(m) : isPast(m)))
    .filter(
      m =>
        !query.trim() ||
        `${m.title} ${m.agenda} ${m.message} ${m.place}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
    )
    .sort((a, b) =>
      isUpcoming(a) && isUpcoming(b)
        ? +new Date(a.startsAt) - +new Date(b.startsAt)
        : +new Date(b.startsAt) - +new Date(a.startsAt),
    );
  const addMeetingTask = async (meeting: MeetingRow, draft: MeetingTaskDraft) => {
    const event = eventScope.events.find(item => item.id === meeting.eventId);
    const { error } = await supabase
      .from('manpower_tasks')
      .insert({
        id: `meeting-task-${crypto.randomUUID()}`,
        organization_id: auth.currentUser?.organizationId,
        event_id: meeting.eventId,
        meeting_id: meeting.id,
        parent_task_id: null,
        department_id: draft.department,
        title: draft.title.trim(),
        details: `Action from meeting: ${meeting.title}${event ? ` · Event: ${event.name}` : ''}`,
        resources: '',
        team: DEPTS[draft.department],
        assigned_to: '',
        due_date: draft.dueDate,
        priority_level: draft.priority,
        priority_until: draft.priority === 'till_time' ? `${draft.dueDate}T23:59:00` : null,
        status: 'todo',
      });
    return error?.message || null;
  };
  if (!ready)
    return (
      <section
        role="status"
        aria-live="polite"
        aria-label="Loading meeting schedule"
        className="relative isolate overflow-hidden rounded-xl border border-line bg-surface p-5 sm:p-7"
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-gradient-to-br from-blue-500/[0.08] via-transparent to-cyan-400/[0.04]"
        />
        <div className="mx-auto max-w-3xl">
          <div className="flex items-center gap-4">
            <span className="relative grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-blue-400/20 bg-blue-500/10 text-blue-300">
              <CalendarClock size={21} />
              <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-surface bg-cyan-300 animate-pulse" />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-ink">Getting meetings ready</h3>
              <p className="mt-1 text-xs text-mute">Loading your schedule and coordination tools…</p>
            </div>
            <span
              aria-hidden="true"
              className="hidden h-8 w-8 shrink-0 rounded-full border-2 border-blue-400/20 border-t-blue-300 animate-spin sm:block"
            />
          </div>
          <div aria-hidden="true" className="mt-6 space-y-3">
            <div className="animate-shimmer h-3 w-1/3 rounded-full bg-white/[0.08]" />
            <div className="animate-shimmer h-12 rounded-lg border border-line bg-raised/40" />
            <div className="animate-shimmer h-12 rounded-lg border border-line bg-raised/40" />
          </div>
          <div aria-hidden="true" className="mt-4 h-1 overflow-hidden rounded-full bg-blue-500/10">
            <div className="animate-loading-sweep h-full w-1/3 rounded-full bg-gradient-to-r from-blue-500 to-cyan-300" />
          </div>
        </div>
      </section>
    );
  return (
    <div className="space-y-4">
      {canSchedule && (
        <Card
          icon={CalendarClock}
          title={eventId ? 'Schedule an event meeting' : 'Schedule a meeting'}
          className="border-blue-500/20 bg-gradient-to-br from-blue-500/[0.07] to-surface"
        >
          <div className="rounded-xl border border-blue-500/25 bg-gradient-to-r from-blue-500/[0.10] via-blue-500/[0.04] to-transparent p-3 sm:p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-blue-400/20 bg-blue-500/15 text-blue-300">
                  <CalendarClock size={19} />
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-ink">
                    {eventId ? 'Plan a meeting for this event' : 'Plan your next meeting'}
                  </h3>
                  <p className="mt-0.5 text-xs text-mute">
                    Set the time, share the details and choose who should receive it.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowScheduler(v => !v)}
                className={btnPrimary + ' shadow-lg shadow-blue-950/30'}
              >
                {showScheduler ? (
                  'Close scheduler'
                ) : (
                  <>
                    <CalendarClock size={15} />
                    Schedule a meeting
                  </>
                )}
              </button>
            </div>
            {showScheduler && (
              <form
                onSubmit={e => {
                  e.preventDefault();
                  submit();
                }}
                className="mt-4 space-y-3 rounded-lg border border-line bg-surface/80 p-3 sm:p-4"
              >
                <nav
                  aria-label="Meeting setup steps"
                  className="grid grid-cols-3 gap-1 rounded-lg border border-line bg-raised/40 p-1"
                >
                  {(['details', 'when', 'audience'] as const).map((step, index) => (
                    <button
                      key={step}
                      type="button"
                      aria-pressed={schedulerStep === step}
                      onClick={() => setSchedulerStep(step)}
                      className={
                        'flex items-center justify-center gap-2 rounded-md px-2 py-2 text-xs font-medium transition-colors ' +
                        (schedulerStep === step
                          ? 'bg-blue-500/15 text-blue-300'
                          : 'text-mute hover:bg-white/[0.04] hover:text-ink')
                      }
                    >
                      <span className="grid h-5 w-5 place-items-center rounded-full border border-current text-[10.5px]">
                        {index + 1}
                      </span>
                      {step === 'details' ? 'Details' : step === 'when' ? 'When' : 'Audience'}
                    </button>
                  ))}
                </nav>

                {schedulerStep === 'details' && (
                  <section aria-label="Meeting details" className="space-y-3">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="text-xs text-mute">
                        Meeting title
                        <input
                          required
                          className={inputCls + ' mt-1'}
                          placeholder="e.g. Event coordination"
                          aria-label="Meeting title"
                          value={title}
                          onChange={e => setTitle(e.target.value)}
                        />
                      </label>
                      <label className="text-xs text-mute">
                        Meeting type
                        <select
                          className={inputCls + ' mt-1'}
                          aria-label="Meeting type"
                          value={mode}
                          onChange={e => setMode(e.target.value as MeetingMode)}
                        >
                          <option value="offline">Offline (in person)</option>
                          <option value="online">Online</option>
                        </select>
                      </label>
                    </div>
                    {mode === 'offline' ? (
                      <label className="block text-xs text-mute">
                        Place
                        <input
                          required
                          className={inputCls + ' mt-1 w-full'}
                          placeholder="Meeting location"
                          aria-label="Place"
                          value={place}
                          onChange={e => setPlace(e.target.value)}
                        />
                      </label>
                    ) : (
                      <div className="grid items-start gap-2 sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
                        <label className="text-xs text-mute">
                          Provider
                          <select
                            className={inputCls + ' mt-1'}
                            aria-label="Online meeting provider"
                            value={onlinePlatform}
                            onChange={e => setOnlinePlatform(e.target.value as typeof onlinePlatform)}
                          >
                            <option value="google">Google Meet / Calendar</option>
                            <option value="teams">Microsoft Teams</option>
                            <option value="outlook">Outlook Calendar</option>
                          </select>
                        </label>
                        <div className="min-w-0 text-xs text-mute">
                          <div className="flex items-center justify-between gap-2">
                            <label htmlFor="meeting-link">
                              Meeting link{onlinePlatform === 'teams' ? ' (optional)' : ''}
                            </label>
                            <a
                              className="inline-flex shrink-0 items-center gap-1 font-medium text-blue-300 hover:text-blue-200 hover:underline"
                              href={
                                date && time && title.trim()
                                  ? providerComposer()
                                  : onlinePlatform === 'google'
                                    ? 'https://calendar.google.com/calendar/'
                                    : onlinePlatform === 'teams'
                                      ? 'https://teams.microsoft.com/'
                                      : 'https://outlook.office.com/calendar/'
                              }
                              target="_blank"
                              rel="noreferrer"
                            >
                              <ExternalLink size={12} />
                              {date && time && title.trim()
                                ? onlinePlatform === 'teams'
                                  ? `Open Teams · invite ${teamsAttendees.length} members`
                                  : 'Create with provider'
                                : 'Open provider'}
                            </a>
                          </div>
                          <input
                            id="meeting-link"
                            required={onlinePlatform !== 'teams'}
                            type="url"
                            className={inputCls + ' mt-1 w-full'}
                            placeholder={
                              onlinePlatform === 'teams'
                                ? 'Optional: paste an existing Teams meeting link'
                                : 'Paste the meeting join link here after creating it'
                            }
                            aria-label="Meeting link"
                            value={link}
                            onChange={e => setLink(e.target.value)}
                          />
                          <p className="mt-1.5 flex items-center gap-1 text-[10.5px] text-mute">
                            <ExternalLink size={10} className="shrink-0" />
                            {onlinePlatform === 'teams'
                              ? 'Teams can create a meeting automatically when configured, or paste an existing link.'
                              : 'Create the meeting with your provider, then paste its join link here.'}
                          </p>
                        </div>
                      </div>
                    )}
                    <label className="block text-xs text-mute">
                      Agenda (optional)
                      <textarea
                        rows={2}
                        className={inputCls + ' mt-1 w-full resize-y'}
                        placeholder="Topics to cover"
                        aria-label="Agenda"
                        value={agenda}
                        onChange={e => setAgenda(e.target.value)}
                      />
                    </label>
                  </section>
                )}

                {schedulerStep === 'when' && (
                  <section aria-label="Meeting time and event" className="space-y-3">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <MeetingDatePicker value={date} onChange={setDate} />
                      <MeetingTimePicker value={time} onChange={setTime} />
                    </div>
                    {eventId ? (
                      <p className="rounded-lg border border-blue-500/20 bg-blue-500/[0.06] px-3 py-2 text-xs text-mute">
                        Event meeting ·{' '}
                        {eventScope.events.find(event => event.id === eventId)?.name || 'Selected event'}
                      </p>
                    ) : (
                      <div className="grid gap-2 sm:grid-cols-2">
                        <label className="text-xs text-mute">
                          Meeting category
                          <select
                            className={inputCls + ' mt-1'}
                            value={meetingCategory}
                            onChange={e => setMeetingCategory(e.target.value as 'general' | 'event')}
                          >
                            <option value="general">General meeting</option>
                            <option value="event">Event-related meeting</option>
                          </select>
                        </label>
                        {meetingCategory === 'event' && (
                          <label className="text-xs text-mute">
                            Event
                            <select
                              required
                              className={inputCls + ' mt-1'}
                              value={meetingEventId}
                              onChange={e => setMeetingEventId(e.target.value)}
                            >
                              <option value="">Choose event</option>
                              {eventScope.events.map(event => (
                                <option key={event.id} value={event.id}>
                                  {event.name}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                      </div>
                    )}
                  </section>
                )}

                {schedulerStep === 'audience' && (
                  <section aria-label="Message and audience" className="space-y-3">
                    <label className="block text-xs text-mute">
                      Message (optional)
                      <textarea
                        className={inputCls + ' mt-1 w-full'}
                        rows={2}
                        maxLength={2000}
                        placeholder="Message for invited members"
                        aria-label="Portal message"
                        value={message}
                        onChange={e => setMessage(e.target.value)}
                      />
                    </label>
                    <AudiencePicker
                      all={all}
                      setAll={setAll}
                      depts={depts}
                      setDepts={setDepts}
                      groups={groups}
                      setGroups={setGroups}
                      teams={sewadarTeams}
                    />
                  </section>
                )}

                <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
                  <button
                    type="button"
                    disabled={schedulerStep === 'details'}
                    onClick={() => setSchedulerStep(schedulerStep === 'audience' ? 'when' : 'details')}
                    className="rounded-md px-3 py-2 text-xs font-medium text-mute hover:bg-white/[0.04] hover:text-ink disabled:invisible"
                  >
                    Back
                  </button>
                  {schedulerStep === 'audience' ? (
                    <div className="flex flex-wrap items-center justify-end gap-3">
                      <span className="hidden text-xs text-mute md:inline">
                        Invitees receive a portal notification and Outlook calendar invite when connected.
                      </span>
                      <button type="submit" disabled={busy} className={btnPrimary}>
                        {busy ? 'Scheduling…' : 'Schedule meeting'}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setSchedulerStep(schedulerStep === 'details' ? 'when' : 'audience')}
                      className={btnPrimary}
                    >
                      Continue
                    </button>
                  )}
                </div>
              </form>
            )}
          </div>
        </Card>
      )}
      <Card
        icon={CalendarClock}
        title={eventId ? 'Meetings for this event' : 'Meeting schedule'}
        action={
          <span className="text-xs text-mute">
            {
              (eventId ? meetings.filter(m => m.eventId === eventId) : meetings).filter(
                m => m.status === 'scheduled' || m.status === 'live',
              ).length
            }{' '}
            active
          </span>
        }
      >
        <Err msg={err} />
        <div className="mb-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <label className="relative block">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute" />
            <input
              className={inputCls + ' w-full pl-9'}
              placeholder="Search meetings"
              aria-label="Search meetings"
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
          </label>
          <div
            className="flex rounded-lg border border-line bg-raised/30 p-1"
            role="group"
            aria-label="Filter meetings"
          >
            {(['upcoming', 'past', 'all'] as const).map(filter => (
              <button
                key={filter}
                type="button"
                aria-pressed={meetingFilter === filter}
                onClick={() => setMeetingFilter(filter)}
                className={`rounded-md px-3 py-1.5 text-xs capitalize ${meetingFilter === filter ? 'bg-blue-500/15 font-semibold text-blue-300' : 'text-mute hover:text-ink'}`}
              >
                {filter}
              </button>
            ))}
          </div>
        </div>
        <ul className="space-y-3">
          {sorted.map(m => (
            <MeetingRowView
              key={m.id}
              m={m}
              eventName={eventScope.events.find(event => event.id === m.eventId)?.name}
              canChange={canSchedule}
              canEditMom={canEditMeetingMinutes(m)}
              onStatus={async (id, s) => setErr((await setMeetingStatus(id, s)) || '')}
              onSaveMom={saveMeetingMinutes}
              onGenerateMinutes={generateMeetingMinutes}
              onAddTask={addMeetingTask}
            />
          ))}
          {!sorted.length && (
            <Empty>
              {meetings.length
                ? 'No meetings match this view.'
                : canSchedule
                  ? 'No meetings yet. Schedule one to get coordination started.'
                  : 'No meetings for you right now.'}
            </Empty>
          )}
        </ul>
      </Card>
    </div>
  );
};
