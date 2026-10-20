import React, { useEffect, useState } from 'react';
import { ArrowLeft, RotateCcw, Send } from 'lucide-react';
import { inputCls } from '../../accommodation/ui';
import { Badge, D, cx, ghost, panel, primary } from '../../inventory/ui/kit';
import type { Helpdesk } from '../useHelpdesk';
import { STATUS, ticketNo, when } from '../types';
import type { Ticket, TicketEvent } from '../types';
import { Conversation } from './Conversation';

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
