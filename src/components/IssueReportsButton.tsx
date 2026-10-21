import React, { useEffect, useState } from 'react';
import { CircleAlert, X } from 'lucide-react';
import { useApp as useWalkie } from '../modules/walkie/context/AppContext';
import { supabase } from '../modules/walkie/lib/supabaseClient';
import { useAnimatedPresence } from '../hooks/useAnimatedPresence';
import { useEventScope } from '../context/EventScopeContext';
import { DepartmentSelect } from './DepartmentSelect';
import { homeDepartmentOf } from '../views/orgData';

type Kind = 'issue' | 'feedback';
type Issue = {
  id: string;
  event_id: string | null;
  kind: 'material' | 'site_event' | 'issue' | 'feedback';
  material: string;
  location: string;
  title: string;
  details: string;
  status: 'open' | 'in_progress' | 'resolved';
  reporter_name: string;
  created_at: string;
};
const statusLabel: Record<Issue['status'], string> = { open: 'Open', in_progress: 'In progress', resolved: 'Resolved' };

export const IssueReportsButton: React.FC = () => {
  const auth: any = useWalkie();
  const user = auth.currentUser;
  const eventScope = useEventScope();
  const canManage = ['owner', 'dept_head'].includes(user?.level);
  const [open, setOpen] = useState(false);
  const present = useAnimatedPresence(open);
  const [kind, setKind] = useState<Kind>('issue');
  const [material, setMaterial] = useState('');
  const [location, setLocation] = useState('');
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [issues, setIssues] = useState<Issue[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [eventId, setEventId] = useState('');
  const [eventFilter, setEventFilter] = useState('all');
  // Raised TO a department: only its people see and handle it. Defaults to the person's own department.
  const [toDepartment, setToDepartment] = useState<string>(homeDepartmentOf(user));

  useEffect(() => {
    const saved = eventScope.scopeFor('issues');
    if (saved && eventScope.events.some(event => event.id === saved)) setEventId(saved);
    else if (eventScope.events.length === 1) setEventId(eventScope.events[0].id);
  }, [eventScope.events, eventScope.scopeFor]);

  const load = async () => {
    const { data, error: loadError } = await supabase
      .from('member_issues')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(80);
    if (loadError)
      setError(
        /does not exist|schema cache/i.test(loadError.message)
          ? 'Run migration_v32_member_issue_reports.sql in Supabase to enable issue reports.'
          : loadError.message,
      );
    else setIssues((data || []) as Issue[]);
  };
  useEffect(() => {
    const openFromNotification = () => {
      setOpen(true);
      setError('');
      void load();
    };
    window.addEventListener('open-issue-reports', openFromNotification);
    return () => window.removeEventListener('open-issue-reports', openFromNotification);
  }, []);
  useEffect(() => {
    if (open) {
      setError('');
      void load();
    }
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.id || !user?.organizationId || !eventId || !title.trim()) return;
    setBusy(true);
    setError('');
    setNotice('');
    const { error: saveError } = await supabase.from('member_issues').insert({
      organization_id: user.organizationId,
      reporter_id: user.id,
      reporter_name: user.name || user.email || 'Member',
      event_id: eventId,
      to_department_id: toDepartment || null,
      kind,
      material: material.trim(),
      location: location.trim(),
      title: title.trim(),
      details: details.trim(),
    });
    setBusy(false);
    if (saveError) {
      setError(
        /to_department_id/i.test(saveError.message)
          ? 'Run migration_v105_helpdesk_issues_to_department.sql in the Supabase SQL Editor, then reload.'
          : /event_id|schema cache|column.*does not exist/i.test(saveError.message)
            ? 'Run migration_v73_event_linked_reports.sql in Supabase to link reports to events.'
            : saveError.message,
      );
      return;
    }
    setMaterial('');
    setLocation('');
    setTitle('');
    setDetails('');
    setNotice('Report sent. Team leads will follow up.');
    await load();
  };
  const updateStatus = async (issue: Issue, status: Issue['status']) => {
    const { error: statusError } = await supabase.rpc('set_member_issue_status', { p_id: issue.id, p_status: status });
    if (statusError) setError(statusError.message);
    else await load();
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Send feedback"
        title="Send feedback"
        className="p-2 rounded-lg text-mute transition-colors hover:bg-raised hover:text-ink"
      >
        <CircleAlert size={18} />
      </button>
      {present && (
        <div
          aria-hidden={!open}
          {...({ inert: !open } as any)}
          className={`fixed inset-0 z-[70] grid place-items-center bg-black/60 p-4 transition-opacity duration-200 ease-out ${open ? 'animate-fade-in opacity-100' : 'pointer-events-none opacity-0'}`}
          onMouseDown={e => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="issue-report-title"
            className={`flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-2xl transition-transform duration-200 ease-out ${open ? 'animate-slide-up translate-y-0 scale-100' : 'translate-y-2 scale-[0.98]'}`}
          >
            <header className="flex items-center justify-between border-b border-line px-4 py-3">
              <div>
                <h2 id="issue-report-title" className="font-semibold text-ink">
                  Send feedback
                </h2>
                <p className="text-xs text-mute">
                  Report an issue or share general feedback with your department leads.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close feedback"
                className="rounded-md p-1.5 text-mute hover:bg-raised"
              >
                <X size={17} />
              </button>
            </header>
            <div className="overflow-y-auto p-4 space-y-4">
              <form onSubmit={submit} className="space-y-3 rounded-lg border border-line bg-raised/30 p-3">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setKind('issue')}
                    aria-pressed={kind === 'issue'}
                    className={`rounded-md px-3 py-2 text-xs font-semibold ${kind === 'issue' ? 'bg-blue-600 text-white' : 'text-mute hover:bg-raised'}`}
                  >
                    Issue / complaint
                  </button>
                  <button
                    type="button"
                    onClick={() => setKind('feedback')}
                    aria-pressed={kind === 'feedback'}
                    className={`rounded-md px-3 py-2 text-xs font-semibold ${kind === 'feedback' ? 'bg-blue-600 text-white' : 'text-mute hover:bg-raised'}`}
                  >
                    Feedback
                  </button>
                </div>
                <label className="block text-xs text-mute">
                  Report to department
                  <DepartmentSelect
                    required
                    value={toDepartment}
                    onChange={setToDepartment}
                    className="mt-1 w-full rounded-md border border-line bg-field px-3 py-2 text-sm text-ink"
                    emptyOption="Choose a department"
                    aria-label="Report to department"
                  />
                </label>
                <label className="block text-xs text-mute">
                  Event
                  <select
                    required
                    value={eventId}
                    onChange={e => {
                      setEventId(e.target.value);
                      eventScope.setScopeFor('issues', e.target.value);
                    }}
                    className="mt-1 w-full rounded-md border border-line bg-field px-3 py-2 text-sm text-ink"
                  >
                    <option value="">Choose event</option>
                    {eventScope.events.map(event => (
                      <option key={event.id} value={event.id}>
                        {event.name}
                      </option>
                    ))}
                  </select>
                </label>
                {!eventScope.events.length && (
                  <p className="text-xs text-amber-300">Create an event before submitting an issue or feedback.</p>
                )}
                <div className="grid gap-2 sm:grid-cols-2">
                  {kind === 'issue' && (
                    <input
                      value={material}
                      onChange={e => setMaterial(e.target.value)}
                      placeholder="Material or equipment (optional)"
                      aria-label="Material or equipment (optional)"
                      className="w-full rounded-md border border-line bg-field px-3 py-2 text-sm text-ink placeholder:text-faint"
                    />
                  )}
                  {kind === 'issue' && (
                    <input
                      value={location}
                      onChange={e => setLocation(e.target.value)}
                      placeholder="Site or location (optional)"
                      aria-label="Site or location (optional)"
                      className="w-full rounded-md border border-line bg-field px-3 py-2 text-sm text-ink placeholder:text-faint"
                    />
                  )}
                  <input
                    required
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    placeholder={kind === 'feedback' ? 'What would you like to share?' : 'What is the issue?'}
                    aria-label={kind === 'feedback' ? 'Feedback summary' : 'Issue summary'}
                    maxLength={160}
                    className="w-full rounded-md border border-line bg-field px-3 py-2 text-sm text-ink placeholder:text-faint sm:col-span-2"
                  />
                </div>
                <textarea
                  value={details}
                  onChange={e => setDetails(e.target.value)}
                  placeholder="Add details (optional)"
                  aria-label="Issue details"
                  rows={2}
                  maxLength={4000}
                  className="w-full rounded-md border border-line bg-field px-3 py-2 text-sm text-ink placeholder:text-faint"
                />
                {error && (
                  <p role="alert" className="text-xs text-rose-300">
                    {error}
                  </p>
                )}
                {notice && (
                  <p role="status" className="text-xs text-emerald-300">
                    {notice}
                  </p>
                )}
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={busy || !eventId || !eventScope.events.length}
                    className="rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
                  >
                    {busy ? 'Sending…' : 'Send report'}
                  </button>
                </div>
              </form>
              {canManage && (
                <div>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-ink">Department reports inbox</h3>
                    <select
                      aria-label="Filter reports by event"
                      value={eventFilter}
                      onChange={e => setEventFilter(e.target.value)}
                      className="rounded-md border border-line bg-field px-2 py-1.5 text-xs text-ink"
                    >
                      <option value="all">All events</option>
                      {eventScope.events.map(event => (
                        <option key={event.id} value={event.id}>
                          {event.name}
                        </option>
                      ))}
                      <option value="unlinked">Unlinked legacy reports</option>
                    </select>
                  </div>
                  <ul className="divide-y divide-line rounded-lg border border-line">
                    {issues
                      .filter(
                        issue =>
                          eventFilter === 'all' ||
                          (eventFilter === 'unlinked' ? !issue.event_id : issue.event_id === eventFilter),
                      )
                      .map(issue => (
                        <li key={issue.id} className="flex flex-wrap items-start justify-between gap-3 p-3">
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium text-ink">{issue.title}</div>
                            <div className="mt-0.5 text-xs text-mute">
                              {eventScope.events.find(event => event.id === issue.event_id)?.name ||
                                'Unlinked legacy report'}{' '}
                              ·{' '}
                              {issue.kind === 'feedback'
                                ? 'Feedback'
                                : issue.kind === 'material'
                                  ? `Issue · Material · ${issue.material}`
                                  : issue.kind === 'site_event'
                                    ? 'Issue · Site / event complaint'
                                    : `Issue / complaint${issue.material ? ` · ${issue.material}` : ''}`}
                              {issue.location ? ` · ${issue.location}` : ''} ·{' '}
                              {canManage ? `${issue.reporter_name} · ` : ''}
                              {new Date(issue.created_at).toLocaleString('en-IN')}
                            </div>
                            {issue.details && (
                              <p className="mt-1 whitespace-pre-wrap text-xs text-ink-soft">{issue.details}</p>
                            )}
                          </div>
                          {canManage ? (
                            <select
                              aria-label={`Status for ${issue.title}`}
                              value={issue.status}
                              onChange={e => void updateStatus(issue, e.target.value as Issue['status'])}
                              className="rounded-md border border-line bg-field px-2 py-1.5 text-xs text-ink"
                            >
                              {Object.entries(statusLabel).map(([value, label]) => (
                                <option key={value} value={value}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="rounded-full bg-raised px-2 py-1 text-[10.5px] text-mute">
                              {statusLabel[issue.status]}
                            </span>
                          )}
                        </li>
                      ))}
                    {!issues.filter(
                      issue =>
                        eventFilter === 'all' ||
                        (eventFilter === 'unlinked' ? !issue.event_id : issue.event_id === eventFilter),
                    ).length && (
                      <li className="p-5 text-center text-xs text-mute">
                        {error ? 'Reports are not available yet.' : 'No reports for this event.'}
                      </li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
};
