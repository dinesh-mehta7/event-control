import React, { useEffect, useRef, useState } from 'react';
import { Bell, CalendarClock, ClipboardList } from 'lucide-react';
import { useRequests } from '../modules/requests';
import { useMeetings } from '../context/MeetingsContext';
import type { NotificationRow } from '../context/MeetingsContext';

// The two header buttons every screen gets (they live inside ProfileMenu, which every module already shows):
//   Meetings button  -> opens the meetings panel from any department
//   Notification bell -> this person's own notifications (meetings, approvals, emergencies)

const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
const tone = (t: string) => t === 'critical' ? 'bg-red-500' : t === 'warning' ? 'bg-amber-400' : t === 'approval' ? 'bg-amber-400' : t === 'meeting' ? 'bg-emerald-400' : 'bg-blue-500';

const MeetingsButton: React.FC = () => {
  const { openPanel, notifications, emergencies } = useMeetings();
  const unreadMeetings = notifications.filter(n => !n.read && (n.type === 'meeting' || n.type === 'critical')).length;
  const alarm = emergencies.some(e => e.status === 'live');
  return (
    <button onClick={openPanel} aria-label={`Meetings${unreadMeetings ? `, ${unreadMeetings} new` : ''}`} title="Meetings"
      className={`relative p-2 rounded-lg transition-colors ${alarm ? 'text-red-400 hover:bg-red-500/10' : 'text-mute hover:bg-raised hover:text-ink'}`}>
      <CalendarClock size={18} />
      {(unreadMeetings > 0 || alarm) && <span className={`absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full text-white text-xs font-bold leading-4 text-center ${alarm ? 'bg-red-500 animate-pulse' : 'bg-emerald-500'}`}>{alarm && !unreadMeetings ? '!' : unreadMeetings > 9 ? '9+' : unreadMeetings}</span>}
    </button>
  );
};

// Requests: opens the request desk. The badge counts what is waiting for THIS person (approvals, items to arrange).
const RequestsButton: React.FC = () => {
  const { actionCount } = useRequests();
  return (
    <a href="#/requests" aria-label={`Requests${actionCount ? `, ${actionCount} waiting for you` : ''}`} title="Requests"
      className="relative p-2 rounded-lg transition-colors text-mute hover:bg-raised hover:text-ink">
      <ClipboardList size={18} />
      {actionCount > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-amber-500 text-white text-xs font-bold leading-4 text-center">{actionCount > 9 ? '9+' : actionCount}</span>}
    </a>
  );
};

// Open while the pointer is on the bell or the list; a tap toggles it on touch screens.
const Bell_: React.FC = () => {
  const { notifications, unread, markRead, markAllRead, openPanel } = useMeetings();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const last = useRef<string>('');
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  const go = (n: NotificationRow) => {
    markRead(n.id);
    setOpen(false);
    if (n.link === 'meetings') openPanel();
    else if (n.link) location.hash = '#/' + n.link;
  };

  return (
    <div ref={box} className="relative"
      onPointerEnter={e => { if (e.pointerType === 'mouse') setOpen(true); }}
      onPointerLeave={e => { if (e.pointerType === 'mouse') setOpen(false); }}>
      <button aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-expanded={open}
        onPointerDown={e => { last.current = e.pointerType; }}
        onClick={() => { if (last.current !== 'mouse') setOpen(o => !o); last.current = ''; }}
        className={`relative p-2 rounded-lg transition-colors ${open ? 'bg-raised text-ink' : 'text-mute hover:bg-raised hover:text-ink'}`}>
        <Bell size={18} />
        {unread > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-xs font-bold leading-4 text-center">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 top-full pt-2 z-50 w-[min(22rem,calc(100vw-1.5rem))]">
          <div className="animate-pop-in rounded-xl border border-line bg-surface shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-line">
              <div className="text-sm font-semibold text-ink">Notifications{unread > 0 && <span className="ml-2 text-xs font-normal text-mute">{unread} new</span>}</div>
              {unread > 0 && <button onClick={markAllRead} className="text-xs text-blue-400 hover:underline">Mark all read</button>}
            </div>
            <ul className="max-h-96 overflow-y-auto divide-y divide-line">
              {notifications.slice(0, 20).map(n => (
                <li key={n.id}>
                  <button onClick={() => go(n)} className={`w-full text-left px-4 py-3 flex gap-3 hover:bg-raised/60 ${n.read ? 'opacity-60' : ''}`}>
                    <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${n.read ? 'bg-line-strong' : tone(n.type)}`} />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-ink truncate">{n.title}</span>
                      <span className="block text-xs text-mute line-clamp-2">{n.message}</span>
                      <span className="block text-xs text-faint mt-0.5">{ago(n.createdAt)}</span>
                    </span>
                  </button>
                </li>))}
              {!notifications.length && <li className="px-4 py-8 text-center text-sm text-mute">You are all caught up.</li>}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
};

export const HeaderTools: React.FC = () => (
  <div className="flex items-center gap-0.5 mr-1">
    <RequestsButton />
    <MeetingsButton />
    <Bell_ />
  </div>
);
