import React, { useState } from 'react';
import { LifeBuoy, Search, Send, Ticket as TicketIcon } from 'lucide-react';
import { inputCls, labelCls } from '../accommodation/ui';
import { homeDepartmentOf } from '../../views/orgData';
import { useSubDepartmentOptions } from '../../hooks/useSubDepartments';
import { useApp as useWalkie } from '../walkie/context/AppContext';
import { Badge, D, Empty, Section, cx, ghost, panel, primary } from '../inventory/ui/kit';
import type { Helpdesk } from './useHelpdesk';
import { PRIORITIES, STATUS, relative, ticketNo } from './types';
import { DepartmentSelect } from '../../components/DepartmentSelect';
import { Select } from '../../components/Select';

// Submit a request. Technicians can also log one on behalf of someone else.
export const NewTicketForm: React.FC<{ hd: Helpdesk; onDone: (id: string) => void; onCancel?: () => void }> = ({
  hd,
  onDone,
  onCancel,
}) => {
  const walkie: any = useWalkie();
  const [f, setF] = useState({
    // Raised TO a department: only its people handle it. Defaults to the person's own department.
    toDepartment: homeDepartmentOf(walkie.currentUser),
    subject: '',
    description: '',
    category: hd.settings.categories[0] || 'Other',
    priority: 'medium',
    department: hd.me?.subDepartment || '',
    location: '',
    requesterName: '',
    requesterEmail: '',
  });
  const [behalf, setBehalf] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF(p => ({ ...p, [k]: v }));
  // The requester's sub-department, from their own department's list.
  const subOptions = useSubDepartmentOptions(undefined, f.department);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const id = await hd.submit({
      ...f,
      requesterName: behalf ? f.requesterName : '',
      requesterEmail: behalf ? f.requesterEmail : '',
    });
    setBusy(false);
    if (id) onDone(id);
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      {hd.isAgent && (
        <label className="flex items-center gap-2 text-xs text-mute">
          <input
            type="checkbox"
            checked={behalf}
            onChange={e => setBehalf(e.target.checked)}
            className="h-3.5 w-3.5 accent-blue-600"
          />
          Log on behalf of someone (phone call, walk-up)
        </label>
      )}
      {behalf && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls(D)} htmlFor="nt-rn">
              Requester name
            </label>
            <input
              id="nt-rn"
              required
              value={f.requesterName}
              onChange={e => set('requesterName', e.target.value)}
              className={inputCls(D)}
            />
          </div>
          <div>
            <label className={labelCls(D)} htmlFor="nt-re">
              Requester email (optional)
            </label>
            <input
              id="nt-re"
              type="email"
              value={f.requesterEmail}
              onChange={e => set('requesterEmail', e.target.value)}
              className={inputCls(D)}
            />
          </div>
        </div>
      )}
      <div>
        <label className={labelCls(D)} htmlFor="nt-s">
          What's the problem?
        </label>
        <input
          id="nt-s"
          required
          autoFocus
          value={f.subject}
          onChange={e => set('subject', e.target.value)}
          placeholder="e.g. WiFi not working at Gate 3"
          className={inputCls(D)}
        />
      </div>
      <div>
        <label className={labelCls(D)} htmlFor="nt-d">
          Details
        </label>
        <textarea
          id="nt-d"
          rows={4}
          value={f.description}
          onChange={e => set('description', e.target.value)}
          placeholder="What happened, since when, any error message…"
          className={inputCls(D)}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <div>
          <label className={labelCls(D)} htmlFor="nt-c">
            Category
          </label>
          <Select id="nt-c" value={f.category} onChange={e => set('category', e.target.value)} className={inputCls(D)}>
            {hd.settings.categories.map(c => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </div>
        <div>
          <label className={labelCls(D)} htmlFor="nt-p">
            Urgency
          </label>
          <Select id="nt-p" value={f.priority} onChange={e => set('priority', e.target.value)} className={inputCls(D)}>
            {PRIORITIES.map(p => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label className={labelCls(D)} htmlFor="nt-to">
            Raise to department
          </label>
          <DepartmentSelect
            id="nt-to"
            required
            value={f.toDepartment}
            onChange={v => set('toDepartment', v)}
            className={inputCls(D)}
            emptyOption="Choose a department"
          />
        </div>
        <div>
          <label className={labelCls(D)} htmlFor="nt-dep">
            Sub-department
          </label>
          <Select
            id="nt-dep"
            value={f.department}
            onChange={e => set('department', e.target.value)}
            className={inputCls(D)}
          >
            <option value="">—</option>
            {subOptions.map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label className={labelCls(D)} htmlFor="nt-l">
            Location
          </label>
          <input
            id="nt-l"
            value={f.location}
            onChange={e => set('location', e.target.value)}
            placeholder="Where are you?"
            className={inputCls(D)}
          />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        {onCancel && (
          <button type="button" className={ghost} onClick={onCancel}>
            Cancel
          </button>
        )}
        <button className={primary} disabled={busy || !f.subject.trim()}>
          <Send className="h-3.5 w-3.5" />
          {busy ? 'Submitting…' : 'Submit ticket'}
        </button>
      </div>
    </form>
  );
};

// Submit & Track: what every signed-in person sees.
export const PortalView: React.FC<{ hd: Helpdesk; open: (id: string) => void }> = ({ hd, open }) => {
  const [q, setQ] = useState('');
  const mine = hd.tickets.filter(t => t.requesterId === hd.me?.id);
  const t = q.trim().replace(/^#/, '').toLowerCase();
  const shown = mine.filter(x => !t || String(x.number).includes(t) || x.subject.toLowerCase().includes(t));
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <Section
        title={
          <span className="inline-flex items-center gap-1.5">
            <LifeBuoy className="h-4 w-4 text-blue-300" />
            Submit a request
          </span>
        }
        hint="It arrives with the IT team as Open. You'll get a bell alert when they reply or close it."
      >
        <div className="p-4">
          <NewTicketForm hd={hd} onDone={open} />
        </div>
      </Section>
      <Section
        title={
          <span className="inline-flex items-center gap-1.5">
            <TicketIcon className="h-4 w-4 text-blue-300" />
            Track my tickets
          </span>
        }
        hint="Open one to read replies, add details, or reopen it if it isn't fixed."
        action={
          <div className="relative">
            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-faint" />
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Ticket # or subject"
              aria-label="Find my ticket"
              className={cx(inputCls(D), 'h-8 w-44 !py-1 pl-8 text-xs')}
            />
          </div>
        }
      >
        {!shown.length ? (
          <Empty icon={TicketIcon}>
            {mine.length ? 'No ticket matches that number.' : "You haven't raised any tickets yet."}
          </Empty>
        ) : (
          <ul className="divide-y divide-line/70">
            {shown.map(x => (
              <li key={x.id}>
                <button
                  type="button"
                  onClick={() => open(x.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-raised/40"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-ink">
                      <span className="mr-1.5 text-mute">{ticketNo(x)}</span>
                      {x.subject}
                    </div>
                    <div className="text-[11.5px] text-mute">
                      {x.assigneeName ? `With ${x.assigneeName}` : 'Waiting for a technician'} · updated{' '}
                      {relative(x.updatedAt)}
                    </div>
                  </div>
                  <Badge tone={STATUS[x.status].tone}>{STATUS[x.status].label}</Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
      {hd.isAgent && (
        <p className={cx(panel, 'p-3 text-[11.5px] text-mute xl:col-span-2')}>
          This is the requester view. Tickets you raise here are tracked under your name; to log one for someone else,
          use <b>New ticket</b> in Tickets.
        </p>
      )}
    </div>
  );
};
