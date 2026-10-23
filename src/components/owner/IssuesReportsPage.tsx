import React, { useCallback, useEffect, useState } from 'react';
import { useApp as useWalkie } from '../../modules/walkie/context/AppContext';
import { supabase } from '../../modules/walkie/lib/supabaseClient';
import { useEventScope } from '../../context/EventScopeContext';
import { Select } from '../Select';
import { PillTabs } from '../PillTabs';

type Panel = 'issues' | 'feedback' | 'announcements' | 'lessons';
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
  sub_department: string;
  created_at: string;
};
type Bulletin = {
  id: string;
  kind: 'announcement' | 'lesson';
  department: string;
  title: string;
  body: string;
  author_name: string;
  created_at: string;
};
const departments = ['all', 'cctv', 'wifi', 'walkie', 'control', 'inventory', 'purchase', 'accommodation', 'sewadars'];
const departmentName = (id: string) =>
  (
    ({
      all: 'All departments',
      cctv: 'CCTV',
      wifi: 'Wi-Fi',
      walkie: 'Walkie',
      control: 'Control Room',
      inventory: 'Inventory',
      purchase: 'Purchase',
      accommodation: 'Accommodation',
      sewadars: 'Sewadars',
    }) as Record<string, string>
  )[id] || id;
const statusNames = { open: 'Open', in_progress: 'In progress', resolved: 'Resolved' };
const input = 'w-full rounded-md border border-line bg-field px-3 py-2 text-sm text-ink placeholder:text-faint';

export const IssuesReportsPage: React.FC = () => {
  const auth: any = useWalkie();
  const user = auth.currentUser;
  const eventScope = useEventScope();
  const isAdmin = ['owner', 'dept_head'].includes(user?.level);
  const [panel, setPanel] = useState<Panel>(isAdmin ? 'issues' : 'announcements');
  const [issues, setIssues] = useState<Issue[]>([]);
  const [posts, setPosts] = useState<Bulletin[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [department, setDepartment] = useState(departments[0]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [eventFilter, setEventFilter] = useState('all');

  const load = useCallback(async () => {
    setError('');
    if ((panel === 'issues' || panel === 'feedback') && isAdmin) {
      const { data, error: e } = await supabase
        .from('member_issues')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);
      if (e) setError(e.message);
      else setIssues((data || []) as Issue[]);
    } else if (panel !== 'feedback') {
      const { data, error: e } = await supabase
        .from('department_updates')
        .select('*')
        .eq('kind', panel === 'lessons' ? 'lesson' : 'announcement')
        .order('created_at', { ascending: false })
        .limit(200);
      if (e) setError(e.message);
      else setPosts((data || []) as Bulletin[]);
    }
  }, [panel, isAdmin]);
  useEffect(() => {
    void load();
  }, [load]);

  const savePost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin || !user?.id || !user?.organizationId || !title.trim() || !body.trim()) return;
    const kind = panel === 'lessons' ? 'lesson' : 'announcement';
    setBusy(true);
    setError('');
    setNotice('');
    const { error: e2 } = await supabase.from('department_updates').insert({
      organization_id: user.organizationId,
      kind,
      department,
      title: title.trim(),
      body: body.trim(),
      author_id: user.id,
      author_name: user.name || user.email || 'Administrator',
    });
    setBusy(false);
    if (e2) {
      setError(e2.message);
      return;
    }
    setTitle('');
    setBody('');
    setNotice(`${kind === 'lesson' ? 'Lesson learned' : 'Announcement'} posted for ${departmentName(department)}.`);
    await load();
  };

  const updateStatus = async (issue: Issue, status: Issue['status']) => {
    const { error: e } = await supabase.rpc('set_member_issue_status', { p_id: issue.id, p_status: status });
    if (e) setError(e.message);
    else await load();
  };
  const linkIssueToEvent = async (issue: Issue, eventId: string) => {
    if (!eventId) return;
    const { error: e } = await supabase.from('member_issues').update({ event_id: eventId }).eq('id', issue.id);
    if (e) setError(e.message);
    else await load();
  };
  const tabs: { id: Panel; label: string }[] = [
    ...(isAdmin
      ? [
          { id: 'issues' as Panel, label: 'Issues' },
          { id: 'feedback' as Panel, label: 'Feedback' },
        ]
      : []),
    { id: 'announcements', label: 'Announcements' },
    { id: 'lessons', label: 'Lessons learned' },
  ];
  const visibleIssues = issues.filter(
    issue =>
      (panel === 'issues' ? issue.kind !== 'feedback' : issue.kind === 'feedback') &&
      (eventFilter === 'all' || (eventFilter === 'unlinked' ? !issue.event_id : issue.event_id === eventFilter)),
  );

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-ink">Issues & Reports</h2>
        <p className="mt-1 text-sm text-mute">Issues, feedback, announcements, and lessons learned.</p>
      </div>
      <div className="inline-flex">
        <PillTabs
          label="Issues and reports modules"
          value={panel}
          onChange={id => {
            setPanel(id as typeof panel);
            setError('');
            setNotice('');
          }}
          className="gap-1 rounded-lg border border-line bg-surface p-1"
          itemClassName="px-3 py-2 text-sm"
          tabs={tabs}
        />
      </div>

      {(panel === 'issues' || panel === 'feedback') && isAdmin ? (
        <section className="rounded-lg border border-line bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
            <div>
              <h3 className="font-semibold text-ink">{panel === 'issues' ? 'Issues & complaints' : 'Feedback'}</h3>
              <p className="text-xs text-mute">
                Submitted from the header shortcut; each new report is attached to an event.
              </p>
            </div>
            <Select
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
            </Select>
          </div>
          <ul className="divide-y divide-line">
            {visibleIssues.map(i => (
              <li key={i.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-ink">{i.title}</div>
                  <p className="mt-1 text-xs text-mute">
                    <span className="font-semibold text-blue-300">
                      {eventScope.events.find(event => event.id === i.event_id)?.name || 'Unlinked legacy report'}
                    </span>{' '}
                    · {departmentName(i.sub_department)} · {i.reporter_name} ·{' '}
                    {i.kind === 'feedback'
                      ? 'General feedback'
                      : i.kind === 'material'
                        ? `Issue · Material · ${i.material}`
                        : i.kind === 'site_event'
                          ? 'Issue · Site / event complaint'
                          : `Issue / complaint${i.material ? ` · ${i.material}` : ''}`}
                    {i.location ? ` · ${i.location}` : ''} · {new Date(i.created_at).toLocaleString('en-IN')}
                  </p>
                  {i.details && <p className="mt-2 whitespace-pre-wrap text-sm text-ink-soft">{i.details}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {!i.event_id && (
                    <Select
                      aria-label={`Link ${i.title} to an event`}
                      defaultValue=""
                      onChange={e => void linkIssueToEvent(i, e.target.value)}
                      className="rounded-md border border-line bg-field px-2 py-1.5 text-xs text-ink"
                    >
                      <option value="">Link to event…</option>
                      {eventScope.events.map(event => (
                        <option key={event.id} value={event.id}>
                          {event.name}
                        </option>
                      ))}
                    </Select>
                  )}
                  <Select
                    aria-label={`Status for ${i.title}`}
                    value={i.status}
                    onChange={e => void updateStatus(i, e.target.value as Issue['status'])}
                    className="rounded-md border border-line bg-field px-2 py-1.5 text-xs text-ink"
                  >
                    {Object.entries(statusNames).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </Select>
                </div>
              </li>
            ))}
            {!visibleIssues.length && (
              <li className="p-8 text-center text-sm text-mute">
                No {panel === 'issues' ? 'issues or complaints' : 'feedback'} for this event.
              </li>
            )}
          </ul>
        </section>
      ) : (
        <>
          {isAdmin && (
            <form onSubmit={savePost} className="space-y-3 rounded-lg border border-line bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-semibold text-ink">
                  Post {panel === 'lessons' ? 'a lesson learned' : 'an announcement'}
                </h3>
                <Select
                  aria-label="Department audience"
                  value={department}
                  onChange={e => setDepartment(e.target.value)}
                  className="rounded-md border border-line bg-field px-2 py-2 text-sm text-ink"
                >
                  {departments.map(d => (
                    <option key={d} value={d}>
                      {departmentName(d)}
                    </option>
                  ))}
                </Select>
              </div>
              <input
                required
                maxLength={180}
                value={title}
                onChange={e => setTitle(e.target.value)}
                className={input}
                placeholder="Title"
                aria-label="Title"
              />
              <textarea
                required
                rows={3}
                maxLength={8000}
                value={body}
                onChange={e => setBody(e.target.value)}
                className={input}
                placeholder="Write the details"
                aria-label="Details"
              />
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-mute">
                  {department === 'all'
                    ? 'Visible to all departments.'
                    : `Visible to ${departmentName(department)} only.`}
                </span>
                <button
                  disabled={busy}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
                >
                  {busy ? 'Posting…' : 'Post'}
                </button>
              </div>
            </form>
          )}
          <section className="rounded-lg border border-line bg-surface">
            <div className="border-b border-line px-4 py-3">
              <h3 className="font-semibold text-ink">{panel === 'lessons' ? 'Lessons learned' : 'Announcements'}</h3>
              <p className="text-xs text-mute">
                {isAdmin
                  ? 'Posts can be targeted to one department or all departments.'
                  : 'Posts shared with your department.'}
              </p>
            </div>
            <ul className="divide-y divide-line">
              {posts.map(post => (
                <li key={post.id} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h4 className="font-medium text-ink">{post.title}</h4>
                    <span className="text-xs text-mute">{new Date(post.created_at).toLocaleString('en-IN')}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-ink-soft">{post.body}</p>
                  <p className="mt-2 text-xs text-mute">
                    {departmentName(post.department)} · {post.author_name}
                  </p>
                </li>
              ))}
              {!posts.length && (
                <li className="p-8 text-center text-sm text-mute">
                  No {panel === 'lessons' ? 'lessons learned' : 'announcements'} yet.
                </li>
              )}
            </ul>
          </section>
        </>
      )}
      {error && (
        <p role="alert" className="rounded-md border border-rose-900/50 bg-rose-950/30 p-3 text-sm text-rose-300">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-emerald-300">
          {notice}
        </p>
      )}
    </div>
  );
};
