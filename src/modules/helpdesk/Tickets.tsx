import React, { useEffect, useMemo, useState } from 'react';
import {
  AlarmClock,
  CheckCircle2,
  Hourglass,
  Inbox,
  Layers,
  ListChecks,
  Plus,
  Search,
  User,
  UserX,
} from 'lucide-react';
import { Modal, inputCls, labelCls } from '../accommodation/ui';
import { Badge, D, Empty, cx, ghost, panel, primary } from '../inventory/ui/kit';
import type { Helpdesk } from './useHelpdesk';
import { TicketDetail } from './TicketDetail';
import { PRIORITIES, PRIORITY, STATUS, STATUSES, isOverdue, relative, ticketNo } from './types';
import type { Priority, Status, Ticket } from './types';

export type SavedView = 'open' | 'mine' | 'unassigned' | 'overdue' | 'waiting' | 'closed' | 'all';
export const VIEWS: {
  id: SavedView;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  test: (t: Ticket, me?: string) => boolean;
}[] = [
  { id: 'open', label: 'All open', icon: Inbox, test: t => t.status !== 'closed' },
  { id: 'mine', label: 'My tickets', icon: User, test: (t, me) => t.status !== 'closed' && t.assigneeId === me },
  { id: 'unassigned', label: 'Unassigned', icon: UserX, test: t => t.status !== 'closed' && !t.assigneeId },
  { id: 'overdue', label: 'Past due', icon: AlarmClock, test: t => isOverdue(t) },
  { id: 'waiting', label: 'Waiting', icon: Hourglass, test: t => t.status === 'waiting' },
  { id: 'closed', label: 'Closed', icon: CheckCircle2, test: t => t.status === 'closed' },
  { id: 'all', label: 'All tickets', icon: Layers, test: () => true },
];
const PRI_ORDER: Record<Priority, number> = { critical: 0, high: 1, medium: 2, low: 3 };

// Spiceworks-style workspace: saved views across the top, ticket list, and the selected ticket beside it.
export const TicketsView: React.FC<{
  hd: Helpdesk;
  view: SavedView;
  setView: (v: SavedView) => void;
  selectedId?: string;
  open: (id: string) => void;
  onClose: () => void;
  onNew: () => void;
}> = ({ hd, view, setView, selectedId, open, onClose, onNew }) => {
  const [q, setQ] = useState('');
  const [pri, setPri] = useState<'all' | Priority>('all');
  const [cat, setCat] = useState('all');
  const [tech, setTech] = useState('all');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulkClose, setBulkClose] = useState('');
  const [closingBulk, setClosingBulk] = useState(false);
  const me = hd.me?.id;
  const current = VIEWS.find(v => v.id === view) || VIEWS[0];
  const selected = selectedId ? hd.tickets.find(t => t.id === selectedId) : undefined;

  const rows = useMemo(() => {
    const t = q.trim().replace(/^#/, '').toLowerCase();
    return hd.tickets
      .filter(
        x =>
          current.test(x, me) &&
          (pri === 'all' || x.priority === pri) &&
          (cat === 'all' || x.category === cat) &&
          (tech === 'all' || (tech === 'none' ? !x.assigneeId : x.assigneeId === tech)) &&
          (!t ||
            `${x.number} ${x.subject} ${x.requesterName} ${x.requesterEmail} ${x.location} ${x.description} ${x.assetName}`
              .toLowerCase()
              .includes(t)),
      )
      .sort(
        (a, b) =>
          (a.status === 'closed' ? 1 : 0) - (b.status === 'closed' ? 1 : 0) ||
          PRI_ORDER[a.priority] - PRI_ORDER[b.priority] ||
          (a.dueAt || '').localeCompare(b.dueAt || ''),
      );
  }, [hd.tickets, current, me, q, pri, cat, tech]);
  useEffect(() => {
    setSel(new Set());
  }, [view, q, pri, cat, tech]);

  const picked = rows.filter(r => sel.has(r.id)).map(r => r.id);
  const all = rows.length > 0 && rows.every(r => sel.has(r.id));
  const toggle = (id: string) =>
    setSel(s => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const bulk = async (patch: Parameters<Helpdesk['update']>[1]) => {
    if (await hd.update(picked, patch)) setSel(new Set());
  };
  const bulkStatus = (s: Status) => {
    if (s === 'closed') setClosingBulk(true);
    else void bulk({ status: s });
  };
  const field = cx(inputCls(D), 'h-9 !py-1 text-xs');
  const check = (t: Ticket) => (
    <input
      type="checkbox"
      aria-label={`Select ${ticketNo(t)}`}
      checked={sel.has(t.id)}
      onChange={() => toggle(t.id)}
      onClick={e => e.stopPropagation()}
      className="h-3.5 w-3.5 accent-blue-600"
    />
  );

  return (
    <div className="space-y-3">
      {/* Saved views */}
      <div className={cx(panel, 'flex items-center gap-1 overflow-x-auto p-1.5')}>
        <nav aria-label="Saved views" className="flex min-w-0 flex-1 gap-1">
          {VIEWS.map(v => {
            const n = hd.tickets.filter(t => v.test(t, me)).length;
            return (
              <button
                key={v.id}
                type="button"
                aria-current={view === v.id ? 'page' : undefined}
                onClick={() => setView(v.id)}
                className={cx(
                  'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs',
                  view === v.id
                    ? 'bg-blue-500/10 font-semibold text-blue-300'
                    : 'text-mute hover:bg-raised hover:text-ink',
                )}
              >
                <v.icon className="h-3.5 w-3.5" />
                {v.label}
                <span
                  className={cx(
                    'rounded-full px-1.5 text-[10.5px] tabular-nums',
                    v.id === 'overdue' && n ? 'bg-rose-500/15 text-rose-300' : 'bg-raised',
                  )}
                >
                  {n}
                </span>
              </button>
            );
          })}
        </nav>
        <button className={cx(primary, 'shrink-0')} onClick={onNew}>
          <Plus className="h-4 w-4" />
          New ticket
        </button>
      </div>

      <div className={cx('grid gap-3', selected && 'xl:grid-cols-[minmax(0,25rem)_minmax(0,1fr)]')}>
        {/* List (hidden on small screens while a ticket is open) */}
        <div className={cx('min-w-0 space-y-3', selected && 'hidden xl:block')}>
          <div className={cx(panel, 'flex flex-col gap-2 p-2', !selected && 'xl:flex-row xl:items-center')}>
            <div className="relative w-full xl:max-w-xs">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-faint" />
              <input
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Search # number, summary, requester…"
                aria-label="Search tickets"
                className={cx(field, 'pl-8')}
              />
            </div>
            <div className={cx('grid gap-2', selected ? 'grid-cols-3' : 'grid-cols-3 xl:flex')}>
              <select
                value={pri}
                onChange={e => setPri(e.target.value as any)}
                aria-label="Priority"
                className={cx(field, !selected && 'xl:w-36')}
              >
                <option value="all">All priorities</option>
                {PRIORITIES.map(p => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
              <select
                value={cat}
                onChange={e => setCat(e.target.value)}
                aria-label="Category"
                className={cx(field, !selected && 'xl:w-44')}
              >
                <option value="all">All categories</option>
                {hd.settings.categories.map(c => (
                  <option key={c}>{c}</option>
                ))}
              </select>
              <select
                value={tech}
                onChange={e => setTech(e.target.value)}
                aria-label="Assigned to"
                className={cx(field, !selected && 'xl:w-44')}
              >
                <option value="all">Anyone</option>
                <option value="none">Unassigned</option>
                {hd.technicians.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {picked.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-xs">
              <ListChecks className="h-4 w-4 text-blue-300" />
              <b className="text-ink">{picked.length} selected</b>
              <select
                value=""
                onChange={e => {
                  if (e.target.value) void bulk({ assigneeId: e.target.value === 'none' ? null : e.target.value });
                }}
                aria-label="Assign selected"
                className={cx(field, 'w-36')}
              >
                <option value="">Assign to…</option>
                <option value="none">Unassigned</option>
                {hd.technicians.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <select
                value=""
                onChange={e => {
                  if (e.target.value) bulkStatus(e.target.value as Status);
                }}
                aria-label="Set status of selected"
                className={cx(field, 'w-32')}
              >
                <option value="">Status…</option>
                {STATUSES.map(s => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
              <select
                value=""
                onChange={e => {
                  if (e.target.value) void bulk({ priority: e.target.value as Priority });
                }}
                aria-label="Set priority of selected"
                className={cx(field, 'w-32')}
              >
                <option value="">Priority…</option>
                {PRIORITIES.map(p => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
              <button className="ml-auto text-mute hover:text-ink" onClick={() => setSel(new Set())}>
                Clear
              </button>
            </div>
          )}

          <section className={cx(panel, 'overflow-hidden')}>
            {selected ? (
              // Compact list beside the open ticket.
              <ul className="max-h-[calc(100vh-17rem)] divide-y divide-line/70 overflow-y-auto">
                {rows.map(t => (
                  <li key={t.id}>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => open(t.id)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') open(t.id);
                      }}
                      aria-current={t.id === selectedId ? 'true' : undefined}
                      className={cx(
                        'flex cursor-pointer gap-2.5 px-3 py-2.5',
                        t.id === selectedId
                          ? 'bg-blue-500/10 shadow-[inset_3px_0_0] shadow-blue-400'
                          : 'hover:bg-raised/40',
                      )}
                    >
                      <span className="pt-0.5">{check(t)}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11.5px] text-mute">{ticketNo(t)}</span>
                          <span className="truncate text-xs font-semibold text-ink">{t.subject}</span>
                        </div>
                        <div className="mt-0.5 truncate text-[11px] text-mute">
                          {t.requesterName || '—'} · {t.assigneeName || 'Unassigned'}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          <Badge tone={STATUS[t.status].tone}>{STATUS[t.status].label}</Badge>
                          <Badge tone={PRIORITY[t.priority].tone}>{PRIORITY[t.priority].label}</Badge>
                          <span
                            className={cx(
                              'ml-auto text-[10.5px]',
                              isOverdue(t) ? 'font-semibold text-rose-400' : 'text-faint',
                            )}
                          >
                            {t.status === 'closed'
                              ? `closed ${relative(t.closedAt)}`
                              : isOverdue(t)
                                ? 'past due'
                                : `due ${relative(t.dueAt)}`}
                          </span>
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[56rem] text-left text-xs">
                  <thead className="border-b border-line text-[10.5px] uppercase tracking-wider text-faint">
                    <tr>
                      <th className="w-8 py-2.5 pl-3">
                        <input
                          type="checkbox"
                          aria-label="Select all"
                          checked={all}
                          onChange={() => setSel(all ? new Set() : new Set(rows.map(r => r.id)))}
                          className="h-3.5 w-3.5 accent-blue-600"
                        />
                      </th>
                      <th className="px-2 py-2.5 font-semibold">#</th>
                      <th className="px-2 py-2.5 font-semibold">Summary</th>
                      <th className="px-2 py-2.5 font-semibold">Status</th>
                      <th className="px-2 py-2.5 font-semibold">Priority</th>
                      <th className="px-2 py-2.5 font-semibold">Assigned to</th>
                      <th className="px-2 py-2.5 font-semibold">Due</th>
                      <th className="px-2 py-2.5 font-semibold">Created</th>
                      <th className="px-2 py-2.5 pr-3 font-semibold">Updated</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/70">
                    {rows.map(t => (
                      <tr
                        key={t.id}
                        onClick={() => open(t.id)}
                        className={cx('cursor-pointer hover:bg-raised/40', sel.has(t.id) && 'bg-blue-500/5')}
                      >
                        <td className="py-2.5 pl-3">{check(t)}</td>
                        <td className="whitespace-nowrap px-2 py-2.5 text-mute">{ticketNo(t)}</td>
                        <td className="max-w-md px-2 py-2.5">
                          <div className="truncate font-semibold text-ink">{t.subject}</div>
                          <div className="truncate text-[11.5px] text-mute">
                            {t.requesterName || '—'} · {t.category}
                            {t.location ? ` · ${t.location}` : ''}
                          </div>
                        </td>
                        <td className="px-2 py-2.5">
                          <Badge tone={STATUS[t.status].tone}>{STATUS[t.status].label}</Badge>
                        </td>
                        <td className="px-2 py-2.5">
                          <Badge tone={PRIORITY[t.priority].tone}>{PRIORITY[t.priority].label}</Badge>
                        </td>
                        <td className="px-2 py-2.5 text-ink-soft">
                          {t.assigneeName || <span className="text-amber-300">Unassigned</span>}
                        </td>
                        <td
                          className={cx(
                            'whitespace-nowrap px-2 py-2.5',
                            isOverdue(t) ? 'font-semibold text-rose-400' : 'text-mute',
                          )}
                        >
                          {t.status === 'closed'
                            ? '—'
                            : isOverdue(t)
                              ? `Past due · ${relative(t.dueAt)}`
                              : relative(t.dueAt)}
                        </td>
                        <td className="whitespace-nowrap px-2 py-2.5 text-mute">{relative(t.createdAt)}</td>
                        <td className="whitespace-nowrap px-2 py-2.5 pr-3 text-mute">{relative(t.updatedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {!rows.length && (
              <Empty icon={Inbox}>
                {hd.loading
                  ? 'Loading tickets…'
                  : hd.tickets.length
                    ? 'No tickets in this view.'
                    : 'No tickets yet. New requests from the portal land here as Open.'}
              </Empty>
            )}
            {rows.length > 0 && (
              <div className="border-t border-line px-3 py-2 text-[11.5px] text-mute">
                {rows.length} ticket{rows.length === 1 ? '' : 's'} · {current.label}
              </div>
            )}
          </section>
        </div>

        {selected && (
          <div className="min-w-0">
            <TicketDetail hd={hd} ticket={selected} onBack={onClose} compact />
          </div>
        )}
      </div>

      {closingBulk && (
        <Modal title={`Close ${picked.length} tickets`} dark={D} onClose={() => setClosingBulk(false)}>
          <label className={labelCls(D)} htmlFor="bulk-res">
            Resolution (applied to every selected ticket)
          </label>
          <textarea
            id="bulk-res"
            rows={3}
            autoFocus
            value={bulkClose}
            onChange={e => setBulkClose(e.target.value)}
            className={inputCls(D)}
          />
          <div className="mt-4 flex justify-end gap-2">
            <button className={ghost} onClick={() => setClosingBulk(false)}>
              Cancel
            </button>
            <button
              className={primary}
              disabled={!bulkClose.trim()}
              onClick={async () => {
                await bulk({ status: 'closed', resolution: bulkClose.trim() });
                setClosingBulk(false);
                setBulkClose('');
              }}
            >
              Close tickets
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
};
