import type { Tone } from '../inventory/ui/kit';

export type Status = 'open' | 'in_progress' | 'waiting' | 'closed';
export type Priority = 'critical' | 'high' | 'medium' | 'low';

export interface Ticket {
  id: string;
  number: number;
  subject: string;
  description: string;
  status: Status;
  priority: Priority;
  category: string;
  department: string;
  location: string;
  requesterId: string | null;
  requesterName: string;
  requesterEmail: string;
  assigneeId: string | null;
  assigneeName: string;
  dueAt: string | null;
  resolution: string;
  firstResponseAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  tasks: TicketTask[];
  assetItemId: string | null;
  assetName: string;
}
export interface TicketTask {
  id: string;
  title: string;
  done: boolean;
}
export interface TicketEvent {
  id: string;
  ticketId: string;
  kind: 'reply' | 'note' | 'log';
  body: string;
  authorId: string | null;
  authorName: string;
  createdAt: string;
  minutes: number;
}
export interface Settings {
  slaHours: Record<Priority, number>;
  categories: string[];
  technicianIds: string[];
  categoryRules: Record<string, string>;
}
export interface Person {
  id: string;
  name: string;
  email: string;
  level: string;
}
export interface Canned {
  id: string;
  title: string;
  body: string;
}

export const STATUSES: { key: Status; label: string; tone: Tone }[] = [
  { key: 'open', label: 'Open', tone: 'info' },
  { key: 'in_progress', label: 'In progress', tone: 'warn' },
  { key: 'waiting', label: 'Waiting', tone: 'mute' },
  { key: 'closed', label: 'Closed', tone: 'ok' },
];
export const PRIORITIES: { key: Priority; label: string; tone: Tone }[] = [
  { key: 'critical', label: 'Critical', tone: 'bad' },
  { key: 'high', label: 'High', tone: 'orange' },
  { key: 'medium', label: 'Medium', tone: 'info' },
  { key: 'low', label: 'Low', tone: 'mute' },
];
export const STATUS = Object.fromEntries(STATUSES.map(s => [s.key, s])) as Record<Status, (typeof STATUSES)[number]>;
export const PRIORITY = Object.fromEntries(PRIORITIES.map(p => [p.key, p])) as Record<
  Priority,
  (typeof PRIORITIES)[number]
>;
export const DEFAULT_SETTINGS: Settings = {
  slaHours: { critical: 4, high: 8, medium: 24, low: 72 },
  categories: [
    'Hardware',
    'Software',
    'Network / WiFi',
    'CCTV',
    'Walkie-Talkie',
    'Access / Accounts',
    'Printer',
    'Other',
  ],
  technicianIds: [],
  categoryRules: {},
};

export const ticketNo = (t: { number: number }) => `#${t.number}`;
export const isOverdue = (t: Ticket, now = Date.now()) =>
  t.status !== 'closed' && !!t.dueAt && new Date(t.dueAt).getTime() < now;
export const dueToday = (t: Ticket) => {
  if (t.status === 'closed' || !t.dueAt) return false;
  const d = new Date(t.dueAt),
    n = new Date();
  return d.toDateString() === n.toDateString();
};
export const when = (s: string | null) =>
  s ? new Date(s).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—';
export const relative = (s: string | null) => {
  if (!s) return '—';
  const diff = new Date(s).getTime() - Date.now();
  const abs = Math.abs(diff);
  const unit =
    abs < 3.6e6
      ? [Math.round(abs / 6e4), 'min']
      : abs < 8.64e7
        ? [Math.round(abs / 3.6e6), 'h']
        : [Math.round(abs / 8.64e7), 'd'];
  return diff >= 0 ? `in ${unit[0]} ${unit[1]}` : `${unit[0]} ${unit[1]} ago`;
};
export const minutesLabel = (m: number) =>
  m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
export const hours = (ms: number) =>
  ms < 3.6e6
    ? `${Math.round(ms / 6e4)} min`
    : ms < 8.64e7 * 2
      ? `${(ms / 3.6e6).toFixed(1)} h`
      : `${(ms / 8.64e7).toFixed(1)} d`;
