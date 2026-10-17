import React, { useState } from 'react';
import { BarChart3, Headset, Inbox, LayoutDashboard, LifeBuoy, Settings as SettingsIcon } from 'lucide-react';
import { Modal } from '../accommodation/ui';
import { D, cx, panel } from '../inventory/ui/kit';
import { useHelpdesk } from './useHelpdesk';
import { TicketsView } from './Tickets';
import type { SavedView } from './Tickets';
import { RequesterTicket } from './TicketDetail';
import { NewTicketForm, PortalView } from './Portal';
import { OverviewView, ReportsView } from './Insights';
import { SettingsView } from './SettingsView';
import { Swap } from '../../components/Swap';
import { SlideNav } from '../../components/SlideNav';

type Tab = 'overview' | 'tickets' | 'portal' | 'reports' | 'settings';
const TABS: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }>; agent: boolean }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, agent: true },
  { id: 'tickets', label: 'Tickets', icon: Inbox, agent: true },
  { id: 'portal', label: 'Submit & Track', icon: LifeBuoy, agent: false },
  { id: 'reports', label: 'Reports', icon: BarChart3, agent: true },
  { id: 'settings', label: 'Settings', icon: SettingsIcon, agent: true },
];
const go = (tab: string) => { location.hash = `#/helpdesk/${tab}`; };

// Route: #/helpdesk/<tab> or #/helpdesk/ticket-<id> (bell alerts link straight to a ticket).
export const HelpdeskApp: React.FC<{ tab?: string }> = ({ tab: routeTab }) => {
  const hd = useHelpdesk();
  const [view, setView] = useState<SavedView>('open');
  const [newOpen, setNewOpen] = useState(false);
  const ticketId = routeTab?.startsWith('ticket-') ? routeTab.slice(7) : '';
  const tabs = TABS.filter(t => hd.isAgent || !t.agent);
  const tab: Tab = (tabs.find(t => t.id === routeTab)?.id) || (hd.isAgent ? 'overview' : 'portal');
  const ticket = ticketId ? hd.tickets.find(t => t.id === ticketId) : undefined;
  const open = (id: string) => go(`ticket-${id}`);
  // A technician's open ticket lives in the Tickets workspace (split pane), so that tab stays highlighted.
  const activeTab: Tab | '' = ticketId ? (hd.isAgent ? 'tickets' : 'portal') : tab;
  const back = () => go(hd.isAgent ? 'tickets' : 'portal');

  return (
    <div className="space-y-4">
      <header className={cx(panel, 'overflow-hidden')}>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-2 pt-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-blue-400/20 bg-blue-500/10 text-blue-300"><Headset className="h-4 w-4" /></span>
            <div className="min-w-0"><h1 className="text-sm font-semibold text-ink">Help Desk</h1><p className="mt-0.5 truncate text-xs text-mute">{hd.isAgent ? 'IT tickets from request to resolution.' : 'Raise an IT problem and follow it until it is fixed.'}</p></div>
          </div>
          {hd.isAgent && <span className="rounded-md border border-line bg-raised/50 px-2.5 py-1.5 text-xs text-mute"><b className="tabular-nums text-ink">{hd.tickets.filter(t => t.status !== 'closed').length}</b> open · <b className="tabular-nums text-ink">{hd.tickets.filter(t => t.status !== 'closed' && t.assigneeId === hd.me?.id).length}</b> mine</span>}
        </div>
        {tabs.length > 1 && <SlideNav className="flex gap-1 overflow-x-auto px-2 pb-2" aria-label="Help desk sections">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" aria-current={activeTab === id ? 'page' : undefined} onClick={() => go(id)}
              className={cx('inline-flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-xs font-medium', activeTab === id ? 'text-brand' : 'text-mute hover:bg-raised hover:text-ink')}><Icon className="h-4 w-4" />{label}</button>
          ))}
        </SlideNav>}
      </header>

      {hd.loadError && <div role="alert" className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-300">{hd.loadError}</div>}

      <Swap k={ticketId && !hd.isAgent ? `ticket-${ticketId}` : activeTab} indexOf={k => tabs.findIndex(t => t.id === k)}>
        {ticketId && !ticket ? <p className={cx(panel, 'p-6 text-center text-sm text-mute')}>{hd.loading ? 'Loading ticket…' : 'This ticket was not found, or you do not have access to it.'}</p>
          : ticketId && !hd.isAgent && ticket ? <RequesterTicket hd={hd} ticket={ticket} onBack={back} />
          : activeTab === 'tickets' ? <TicketsView hd={hd} view={view} setView={setView} selectedId={ticketId || undefined} open={open} onClose={back} onNew={() => setNewOpen(true)} />
          : tab === 'overview' ? <OverviewView hd={hd} go={v => { setView(v); go('tickets'); }} open={open} />
          : tab === 'reports' ? <ReportsView hd={hd} />
          : tab === 'settings' ? <SettingsView hd={hd} />
          : <PortalView hd={hd} open={open} />}
      </Swap>

      {newOpen && <Modal title="New ticket" dark={D} xl onClose={() => setNewOpen(false)}><NewTicketForm hd={hd} onCancel={() => setNewOpen(false)} onDone={id => { setNewOpen(false); open(id); }} /></Modal>}
    </div>
  );
};
