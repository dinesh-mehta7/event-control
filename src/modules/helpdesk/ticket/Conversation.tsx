import React from 'react';
import { Clock, Lock } from 'lucide-react';
import { Badge, cx, panel } from '../../inventory/ui/kit';
import { minutesLabel, relative, when } from '../types';
import type { Ticket, TicketEvent } from '../types';

// Conversation: original request, then responses / notes / change log in time order.
export const Conversation: React.FC<{ ticket: Ticket; events: TicketEvent[] | null; showNotes: boolean }> = ({
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
                'rounded-xl border p-3',
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
