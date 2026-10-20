import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  CheckSquare,
  Clock,
  Lock,
  Mail,
  MessageSquare,
  Package,
  Plus,
  RotateCcw,
  Send,
  Square,
  StickyNote,
  Trash2,
  X,
} from 'lucide-react';
import { ConfirmModal, Modal, inputCls, labelCls } from '../accommodation/ui';
import { DEPTS } from '../../views/orgData';
import { useInventoryMaybe } from '../inventory';
import { Badge, D, cx, ghost, iconBtn, panel, primary } from '../inventory/ui/kit';
import type { Helpdesk } from './useHelpdesk';
import { PRIORITIES, PRIORITY, STATUS, STATUSES, isOverdue, minutesLabel, relative, ticketNo, when } from './types';
import type { Status, Ticket, TicketEvent, TicketTask } from './types';

const toLocal = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};
const tid = () => `t-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// Conversation: original request, then responses / notes / change log in time order.
const Conversation: React.FC<{ ticket: Ticket; events: TicketEvent[] | null; showNotes: boolean }> = ({
  ticket,
  events,
  showNotes,
}) => (
  <ol className="space-y-3">
    <li className={cx(panel, 'p-4')}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-mute">
        <span>
          <b className="text-ink">{ticket.requesterName || 'Requester'}</b> opened this ticket
        </span>
        <span>{when(ticket.createdAt)}</span>
      </div>
      <p className="whitespace-pre-wrap text-sm text-ink-soft">
        {ticket.description || <span className="text-faint">No description.</span>}
      </p>
    </li>
    {events === null ? (
      <li className="text-xs text-mute">Loading conversation…</li>
    ) : (
      events
        .filter(e => showNotes || e.kind !== 'note')
        .map(e =>
          e.kind === 'log' ? (
            <li key={e.id} className="flex items-center gap-2 px-2 text-[11.5px] text-faint">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-line-strong" />
              <span className="min-w-0">
                {e.body}
                <span>
                  {' '}
                  · {e.authorName} · {relative(e.createdAt)}
                </span>
              </span>
            </li>
          ) : (
            <li
              key={e.id}
              className={cx(
                'animate-calm-enter rounded-xl border p-3',
                e.kind === 'note'
                  ? 'border-amber-500/30 bg-amber-500/5'
                  : e.authorId === ticket.requesterId
                    ? 'border-line bg-surface'
                    : 'border-blue-500/25 bg-blue-500/5',
              )}
            >
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-mute">
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  <b className="text-ink">{e.authorName}</b>
                  {e.kind === 'note' ? (
                    <Badge tone="warn">
                      <Lock className="h-3 w-3" />
                      Internal note
                    </Badge>
                  ) : e.authorId === ticket.requesterId ? (
                    <span>replied</span>
                  ) : (
                    <Badge tone="info">Response</Badge>
                  )}
                  {showNotes && e.minutes > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-raised px-1.5 py-0.5 text-[10.5px]">
                      <Clock className="h-3 w-3" />
                      {minutesLabel(e.minutes)}
                    </span>
                  )}
                </span>
                <span>{when(e.createdAt)}</span>
              </div>
              <p className="whitespace-pre-wrap text-sm text-ink-soft">{e.body}</p>
            </li>
          ),
        )
    )}
  </ol>
);

// ---- Technician view -------------------------------------------------------------------------------------------
export const TicketDetail: React.FC<{ hd: Helpdesk; ticket: Ticket; onBack: () => void; compact?: boolean }> = ({
  hd,
  ticket,
  onBack,
  compact,
}) => {
  const invItems = useInventoryMaybe()?.items || [];
  const [events, setEvents] = useState<TicketEvent[] | null>(null);
  const [mode, setMode] = useState<'reply' | 'note'>('reply');
  const [text, setText] = useState('');
  const [minutes, setMinutes] = useState('');
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState<{ resolution: string; withReply: boolean } | null>(null);
  const [del, setDel] = useState(false);
  const [newTask, setNewTask] = useState('');
  const reload = async () => setEvents(await hd.fetchEvents(ticket.id));
  useEffect(() => {
    void reload();
    setText('');
    setMinutes('');
  }, [ticket.id]); // eslint-disable-line
  useEffect(() => {
    void reload();
  }, [ticket.updatedAt]); // eslint-disable-line

  const mins = Math.max(0, Math.round(Number(minutes) || 0));
  const totalMinutes = (events || []).reduce((s, e) => s + (e.minutes || 0), 0);
  const set = (patch: Parameters<Helpdesk['update']>[1]) => hd.update([ticket.id], patch, true);
  const changeStatus = (s: Status) => {
    if (s === 'closed') setClosing({ resolution: ticket.resolution, withReply: false });
    else void set({ status: s });
  };
  const send = async (andClose = false) => {
    if (!text.trim() && !(mins && mode === 'note')) return;
    if (andClose) {
      setClosing({ resolution: ticket.resolution || text.trim(), withReply: true });
      return;
    }
    setBusy(true);
    const ok = await hd.post(ticket.id, mode, text, false, mins);
    setBusy(false);
    if (ok) {
      setText('');
      setMinutes('');
      void reload();
    }
  };
  const confirmClose = async () => {
    if (!closing?.resolution.trim()) return;
    setBusy(true);
    if (closing.withReply && text.trim()) {
      if (await hd.post(ticket.id, 'reply', text, false, mins)) {
        setText('');
        setMinutes('');
      }
    }
    const ok = await set({ status: 'closed', resolution: closing.resolution.trim() });
    setBusy(false);
    if (ok) {
      setClosing(null);
      void reload();
    }
  };
  const saveTasks = (tasks: TicketTask[]) => void set({ tasks });
  const mail = `mailto:${encodeURIComponent(ticket.requesterEmail)}?subject=${encodeURIComponent(`[${ticketNo(ticket)}] ${ticket.subject}`)}&body=${encodeURIComponent(`Hi ${ticket.requesterName || ''},\n\n\n\n— IT Help Desk, ticket ${ticketNo(ticket)}`)}`;
  const field = cx(inputCls(D), 'h-9 !py-1 text-xs');
  const done = ticket.tasks.filter(t => t.done).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <button className={cx(ghost, compact && 'xl:hidden')} onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
          Tickets
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-ink">
            <span className="text-mute">{ticketNo(ticket)}</span> {ticket.subject}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px] text-mute">
            <Badge tone={STATUS[ticket.status].tone}>{STATUS[ticket.status].label}</Badge>
            <Badge tone={PRIORITY[ticket.priority].tone}>{PRIORITY[ticket.priority].label}</Badge>
            {isOverdue(ticket) && <Badge tone="bad">Past due</Badge>}
            <span>
              · {ticket.requesterName}
              {ticket.requesterEmail ? ` <${ticket.requesterEmail}>` : ''}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {ticket.status === 'closed' ? (
            <button className={ghost} onClick={() => void set({ status: 'open' })}>
              <RotateCcw className="h-3.5 w-3.5" />
              Reopen
            </button>
          ) : (
            <button className={ghost} onClick={() => changeStatus('closed')}>
              <CheckCircle2 className="h-3.5 w-3.5" />
              Close ticket
            </button>
          )}
          {ticket.requesterEmail && (
            <a className={ghost} href={mail}>
              <Mail className="h-3.5 w-3.5" />
              Email requester
            </a>
          )}
          <button className={cx(ghost, 'text-rose-400')} onClick={() => setDel(true)} aria-label="Delete ticket">
            <Trash2 className="h-3.5 w-3.5" />
            {!compact && 'Delete'}
          </button>
        </div>
      </div>

      <div
        className={cx(
          'grid gap-4',
          compact ? '2xl:grid-cols-[minmax(0,1fr)_17rem]' : 'lg:grid-cols-[minmax(0,1fr)_18rem]',
        )}
      >
        <div className="min-w-0 space-y-3">
          {/* Composer first, like Spiceworks: Respond to the requester or Add an internal note, with time spent. */}
          <div className={cx(panel, 'p-3')}>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <div
                role="tablist"
                aria-label="Message type"
                className="inline-flex rounded-md border border-line bg-raised/40 p-0.5"
              >
                {(
                  [
                    ['reply', 'Respond', MessageSquare],
                    ['note', 'Add note', StickyNote],
                  ] as const
                ).map(([k, l, I]) => (
                  <button
                    key={k}
                    role="tab"
                    aria-selected={mode === k}
                    onClick={() => setMode(k)}
                    className={cx(
                      'inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-[11.5px] font-medium',
                      mode === k ? 'bg-surface text-ink shadow-sm' : 'text-mute hover:text-ink',
                    )}
                  >
                    <I className="h-3.5 w-3.5" />
                    {l}
                  </button>
                ))}
              </div>
              {hd.canned.length > 0 && (
                <select
                  value=""
                  onChange={e => {
                    const c = hd.canned.find(x => x.id === e.target.value);
                    if (c) setText(t => (t ? `${t}\n\n${c.body}` : c.body));
                  }}
                  aria-label="Insert canned response"
                  className={cx(field, 'w-48')}
                >
                  <option value="">Insert canned response…</option>
                  {hd.canned.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
              )}
              <span className="ml-auto text-[11.5px] text-faint">
                {mode === 'note' ? 'Only technicians see notes.' : 'The requester sees responses.'}
              </span>
            </div>
            <textarea
              rows={3}
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder={mode === 'note' ? 'Add a private note for the team…' : 'Write a response to the requester…'}
              aria-label={mode === 'note' ? 'Internal note' : 'Response'}
              className={cx(inputCls(D), mode === 'note' && 'border-amber-500/40')}
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-[11.5px] text-mute">
                <Clock className="h-3.5 w-3.5" />
                Time spent
                <input
                  type="number"
                  min={0}
                  step={5}
                  value={minutes}
                  onChange={e => setMinutes(e.target.value)}
                  placeholder="0"
                  aria-label="Time spent in minutes"
                  className="h-8 w-16 rounded-md border border-line bg-field px-2 text-xs text-ink outline-none focus:border-blue-500"
                />
                min
              </label>
              {[15, 30, 60].map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMinutes(String((Number(minutes) || 0) + m))}
                  className="rounded-md border border-line px-2 py-1 text-[10.5px] text-mute hover:bg-raised hover:text-ink"
                >
                  +{m < 60 ? `${m}m` : '1h'}
                </button>
              ))}
              <div className="ml-auto flex flex-wrap gap-2">
                {mode === 'reply' && ticket.status !== 'closed' && (
                  <button className={ghost} disabled={busy || !text.trim()} onClick={() => void send(true)}>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Respond &amp; close
                  </button>
                )}
                <button
                  className={primary}
                  disabled={busy || !(text.trim() || (mode === 'note' && mins))}
                  onClick={() => void send()}
                >
                  {mode === 'note' ? (
                    <>
                      <StickyNote className="h-3.5 w-3.5" />
                      {text.trim() ? 'Add note' : 'Log time'}
                    </>
                  ) : (
                    <>
                      <Send className="h-3.5 w-3.5" />
                      Respond
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
          {ticket.status === 'closed' && ticket.resolution && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm">
              <div className="mb-1 inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-emerald-300">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Resolution · {when(ticket.closedAt)}
              </div>
              <p className="whitespace-pre-wrap text-ink-soft">{ticket.resolution}</p>
            </div>
          )}
          <Conversation ticket={ticket} events={events} showNotes />
        </div>

        <aside className="h-max space-y-3">
          <section className={cx(panel, 'space-y-3 p-3')}>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-faint">Properties</h3>
            <div>
              <label className={labelCls(D)} htmlFor="hd-status">
                Status
              </label>
              <select
                id="hd-status"
                value={ticket.status}
                onChange={e => changeStatus(e.target.value as Status)}
                className={field}
              >
                {STATUSES.map(s => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls(D)} htmlFor="hd-pri">
                Priority
              </label>
              <select
                id="hd-pri"
                value={ticket.priority}
                onChange={e => void set({ priority: e.target.value as Ticket['priority'] })}
                className={field}
              >
                {PRIORITIES.map(p => (
                  <option key={p.key} value={p.key}>
                    {p.label} · {hd.settings.slaHours[p.key]}h SLA
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls(D)} htmlFor="hd-asg">
                Assigned to
              </label>
              <select
                id="hd-asg"
                value={ticket.assigneeId || ''}
                onChange={e => void set({ assigneeId: e.target.value || null })}
                className={field}
              >
                <option value="">Unassigned</option>
                {hd.technicians.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.id === hd.me?.id ? ' (me)' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls(D)} htmlFor="hd-cat">
                Category
              </label>
              <select
                id="hd-cat"
                value={ticket.category}
                onChange={e => void set({ category: e.target.value })}
                className={field}
              >
                {Array.from(new Set([...hd.settings.categories, ticket.category])).map(c => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls(D)} htmlFor="hd-dep">
                Sub-department
              </label>
              <select
                id="hd-dep"
                value={ticket.department}
                onChange={e => void set({ department: e.target.value })}
                className={field}
              >
                <option value="">—</option>
                {Object.entries(DEPTS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls(D)} htmlFor="hd-loc">
                Location
              </label>
              <input
                id="hd-loc"
                defaultValue={ticket.location}
                key={ticket.id + ticket.location}
                onBlur={e => {
                  if (e.target.value.trim() !== ticket.location) void set({ location: e.target.value.trim() });
                }}
                placeholder="e.g. Gate 3, Office 2"
                className={field}
              />
            </div>
            <div>
              <label className={labelCls(D)} htmlFor="hd-due">
                Due
              </label>
              <input
                id="hd-due"
                type="datetime-local"
                defaultValue={toLocal(ticket.dueAt)}
                key={ticket.id + (ticket.dueAt || '')}
                onBlur={e => {
                  const v = e.target.value ? new Date(e.target.value).toISOString() : null;
                  if (v !== ticket.dueAt) void set({ dueAt: v });
                }}
                className={field}
              />
              <p className={cx('mt-1 text-[10.5px]', isOverdue(ticket) ? 'text-rose-400' : 'text-faint')}>
                {ticket.status === 'closed'
                  ? `Closed ${when(ticket.closedAt)}`
                  : isOverdue(ticket)
                    ? `Past due · ${relative(ticket.dueAt)}`
                    : `Due ${relative(ticket.dueAt)}`}
              </p>
            </div>
            <dl className="space-y-1 border-t border-line pt-3 text-[11.5px]">
              <div className="flex justify-between gap-2">
                <dt className="text-mute">Time spent</dt>
                <dd className="font-semibold text-ink">{totalMinutes ? minutesLabel(totalMinutes) : '—'}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-mute">Created</dt>
                <dd className="text-ink-soft">{when(ticket.createdAt)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-mute">First response</dt>
                <dd className="text-ink-soft">{when(ticket.firstResponseAt)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-mute">Updated</dt>
                <dd className="text-ink-soft">{relative(ticket.updatedAt)}</dd>
              </div>
            </dl>
          </section>

          <section className={cx(panel, 'p-3')}>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-faint">Tasks</h3>
              {ticket.tasks.length > 0 && (
                <span className="text-[10.5px] text-mute">
                  {done}/{ticket.tasks.length} done
                </span>
              )}
            </div>
            {ticket.tasks.length > 0 && (
              <div className="mb-2 h-1 overflow-hidden rounded-full bg-raised">
                <div
                  className="meter-fill h-full rounded-full bg-chart-ok"
                  style={{ width: `${(done / ticket.tasks.length) * 100}%` }}
                />
              </div>
            )}
            <ul className="space-y-1">
              {ticket.tasks.map(t => (
                <li key={t.id} className="group flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => saveTasks(ticket.tasks.map(x => (x.id === t.id ? { ...x, done: !x.done } : x)))}
                    aria-label={`${t.done ? 'Reopen' : 'Complete'} task ${t.title}`}
                    className={t.done ? 'text-emerald-300' : 'text-mute hover:text-ink'}
                  >
                    {t.done ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                  </button>
                  <span className={cx('min-w-0 flex-1 truncate', t.done ? 'text-faint line-through' : 'text-ink-soft')}>
                    {t.title}
                  </span>
                  <button
                    type="button"
                    onClick={() => saveTasks(ticket.tasks.filter(x => x.id !== t.id))}
                    aria-label={`Remove task ${t.title}`}
                    className={cx(iconBtn, 'h-5 w-5 opacity-0 group-hover:opacity-100 focus:opacity-100')}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
            <form
              className="mt-2 flex gap-1.5"
              onSubmit={e => {
                e.preventDefault();
                if (newTask.trim()) {
                  saveTasks([...ticket.tasks, { id: tid(), title: newTask.trim(), done: false }]);
                  setNewTask('');
                }
              }}
            >
              <input
                value={newTask}
                onChange={e => setNewTask(e.target.value)}
                placeholder="Add a task…"
                aria-label="New task"
                className="h-8 min-w-0 flex-1 rounded-md border border-line bg-field px-2 text-xs text-ink outline-none focus:border-blue-500"
              />
              <button className={cx(ghost, 'h-8 py-0')} disabled={!newTask.trim()} aria-label="Add task">
                <Plus className="h-3.5 w-3.5" />
              </button>
            </form>
          </section>

          <section className={cx(panel, 'p-3')}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-faint">Related item</h3>
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 shrink-0 text-blue-300" />
              <select
                value={ticket.assetItemId || ''}
                onChange={e => {
                  const it = invItems.find(i => i.id === e.target.value);
                  void set({
                    assetItemId: it?.id || null,
                    assetName: it ? `${it.name}${it.code ? ` · ${it.code}` : ''}` : '',
                  });
                }}
                aria-label="Related inventory item"
                className={field}
              >
                <option value="">None</option>
                {ticket.assetItemId && !invItems.some(i => i.id === ticket.assetItemId) && (
                  <option value={ticket.assetItemId}>{ticket.assetName || 'Removed item'}</option>
                )}
                {invItems.map(i => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                    {i.code ? ` · ${i.code}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <p className="mt-1 text-[10.5px] text-faint">
              The device or equipment this ticket is about, from Inventory.
            </p>
          </section>
        </aside>
      </div>

      {closing && (
        <Modal title={`Close ${ticketNo(ticket)}`} dark={D} onClose={() => setClosing(null)}>
          <p className="mb-3 text-xs text-mute">
            Closing needs a resolution. The requester is notified and can reopen it if the problem is not fixed.
            {totalMinutes ? ` Time spent so far: ${minutesLabel(totalMinutes + (closing.withReply ? mins : 0))}.` : ''}
          </p>
          <label className={labelCls(D)} htmlFor="hd-res">
            Resolution
          </label>
          <textarea
            id="hd-res"
            rows={4}
            autoFocus
            value={closing.resolution}
            onChange={e => setClosing(c => c && { ...c, resolution: e.target.value })}
            placeholder="What fixed it?"
            className={inputCls(D)}
          />
          <div className="mt-4 flex justify-end gap-2">
            <button className={ghost} onClick={() => setClosing(null)}>
              Cancel
            </button>
            <button
              className={primary}
              disabled={busy || !closing.resolution.trim()}
              onClick={() => void confirmClose()}
            >
              {closing.withReply ? 'Respond & close' : 'Close ticket'}
            </button>
          </div>
        </Modal>
      )}
      {del && (
        <ConfirmModal
          dark={D}
          title={`Delete ${ticketNo(ticket)}?`}
          body="The ticket and its whole conversation will be removed permanently."
          confirmLabel="Delete"
          onConfirm={async () => {
            if (await hd.remove(ticket.id)) onBack();
          }}
          onClose={() => setDel(false)}
        />
      )}
    </div>
  );
};

// ---- Requester view (portal): no internal notes or time, reply or reopen ------------------------------------
export const RequesterTicket: React.FC<{ hd: Helpdesk; ticket: Ticket; onBack: () => void }> = ({
  hd,
  ticket,
  onBack,
}) => {
  const [events, setEvents] = useState<TicketEvent[] | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const reload = async () => setEvents(await hd.fetchEvents(ticket.id));
  useEffect(() => {
    void reload();
  }, [ticket.id, ticket.updatedAt]); // eslint-disable-line
  const send = async (reopen: boolean) => {
    if (!text.trim()) return;
    setBusy(true);
    const ok = await hd.post(ticket.id, 'reply', text, reopen);
    setBusy(false);
    if (ok) {
      setText('');
      void reload();
    }
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <button className={ghost} onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
          My tickets
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-ink">
            <span className="text-mute">{ticketNo(ticket)}</span> {ticket.subject}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px] text-mute">
            <Badge tone={STATUS[ticket.status].tone}>{STATUS[ticket.status].label}</Badge>
            <span>{ticket.assigneeName ? `Handled by ${ticket.assigneeName}` : 'Waiting for a technician'}</span>
          </div>
        </div>
      </div>
      <Conversation ticket={ticket} events={events} showNotes={false} />
      {ticket.status === 'closed' && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm">
          <div className="mb-1 text-[11.5px] font-semibold text-emerald-300">Resolved · {when(ticket.closedAt)}</div>
          <p className="whitespace-pre-wrap text-ink-soft">{ticket.resolution}</p>
        </div>
      )}
      <div className={cx(panel, 'p-3')}>
        <textarea
          rows={3}
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={
            ticket.status === 'closed'
              ? 'Still not fixed? Tell us what is happening…'
              : 'Add more details or answer a question…'
          }
          aria-label="Your reply"
          className={inputCls(D)}
        />
        <div className="mt-2 flex justify-end gap-2">
          {ticket.status === 'closed' ? (
            <button className={primary} disabled={busy || !text.trim()} onClick={() => void send(true)}>
              <RotateCcw className="h-3.5 w-3.5" />
              Reopen with this reply
            </button>
          ) : (
            <button className={primary} disabled={busy || !text.trim()} onClick={() => void send(false)}>
              <Send className="h-3.5 w-3.5" />
              Send reply
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
