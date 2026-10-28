import React, { useEffect, useState } from 'react';
import type { ModuleKey, ModuleQuery } from '../lib/permissions';
import { SubDeptPermissionsView } from '../components/owner/SubDeptPermissionsView';
import { SubDepartmentsView } from '../components/owner/SubDepartmentsView';
import {
  Layers,
  LayoutDashboard,
  CalendarClock,
  CalendarDays,
  Users,
  BarChart3,
  Video,
  Wifi,
  Radio,
  Monitor,
  Boxes,
  BedDouble,
  HeartHandshake,
  ClipboardList,
  ShoppingCart,
  ListTodo,
  ShieldCheck,
} from 'lucide-react';
import { Walkie } from '../modules/walkie';
import { Home } from '../views/Home';
import { MyWalkies } from '../views/MyWalkies';
import { EventPlanning } from '../views/EventPlanning';
import { MeetingsEmergency } from '../views/Pages';
import { UserManagementView } from '../components/owner/UserManagementView';
import { ReportsView } from '../components/owner/ReportsView';
import { IssuesReportsPage } from '../components/owner/IssuesReportsPage';
import { CCTVApp } from '../components/apps/CCTVApp';
import { WiFiApp } from '../components/apps/WiFiApp';
import { ControlRoomsApp } from '../components/apps/ControlRoomsApp';
import { InventoryApp } from '../modules/inventory';
import { PurchaseApp } from '../modules/purchase';
import type { DeskView } from '../modules/purchase';
import { Accommodation } from '../modules/accommodation';
import { ManpowerApp } from '../modules/manpower';
import { RequestsApp } from '../modules/requests';

// Pages slide in from the side matching where they sit in the sidebar.
export const navIndex = (k: string) =>
  Array.from(document.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Main"] a[href^="#/"]')).findIndex(a => {
    const h = a.getAttribute('href')!.slice(2);
    return h === k || h.startsWith(k + '/') || k.startsWith(h + '/');
  });

export const APP_VIEWS: Record<string, [React.ComponentType, any]> = {
  cctv: [CCTVApp, Video],
  wifi: [WiFiApp, Wifi],
  walkie: [Walkie as any, Radio],
  control: [ControlRoomsApp, Monitor],
  inventory: [InventoryApp, Boxes],
  accommodation: [Accommodation, BedDouble],
  sewadars: [ManpowerApp, HeartHandshake],
};

// Organization pages. `roles` decides who can open a page; anyone else is sent to their own home.
// Requests and Procurement are separate workspaces with their own routes and sidebar entries.
interface OrgPage {
  label: string;
  icon: any;
  roles: string[];
  render: (tab?: string) => React.ReactNode;
}

export const ORG_PAGES: Record<string, OrgPage> = {
  '': { label: 'Dashboard', icon: LayoutDashboard, roles: ['owner'], render: () => <Home /> },
  overview: { label: 'Overview', icon: LayoutDashboard, roles: ['dept_head'], render: () => <Home /> },
  tasks: {
    label: 'Tasks',
    icon: ListTodo,
    roles: ['owner', 'dept_head', 'sub_dept_head', 'staff'],
    render: () => <ManpowerApp initialSection="tasks" />,
  },
  requests: {
    label: 'Requests',
    icon: ClipboardList,
    roles: ['owner', 'dept_head'],
    render: t => <RequestsApp tab={t} />,
  },
  // Every department's own radios: holders and problem reports (the Walkie team runs the Walkie module).
  'my-walkies': {
    label: 'Walkies',
    icon: Radio,
    roles: ['owner', 'dept_head', 'sub_dept_head', 'staff'],
    render: () => <MyWalkies />,
  },
  purchase: {
    label: 'Procurement',
    icon: ShoppingCart,
    roles: ['owner', 'dept_head'],
    render: t => <PurchaseApp initialTab={(t as DeskView) || 'buy'} />,
  },
  meetings: {
    label: 'Meetings & Emergency',
    icon: CalendarClock,
    roles: ['owner', 'dept_head'],
    render: t => <MeetingsEmergency tab={t} />,
  },
  events: {
    label: 'Event Planning & Coordination',
    icon: CalendarDays,
    roles: ['owner', 'dept_head', 'sub_dept_head', 'staff'],
    render: t => <EventPlanning section={t} />,
  },
  users: {
    label: 'Users & Access',
    icon: Users,
    roles: ['owner', 'dept_head'],
    render: t => <UserManagementView initialTab={t === 'audit' ? 'audit' : 'users_all'} />,
  },
  reports: { label: 'Reports', icon: BarChart3, roles: ['owner', 'dept_head'], render: () => <ReportsView /> },
  subdepartments: {
    label: 'Sub-departments',
    icon: Layers,
    roles: ['owner', 'dept_head'],
    render: () => <SubDepartmentsView />,
  },
  permissions: {
    label: 'Sub-department Permissions',
    icon: ShieldCheck,
    roles: ['owner', 'dept_head'],
    render: () => <SubDeptPermissionsView />,
  },
  issues: {
    label: 'Issues & Reports',
    icon: ClipboardList,
    roles: ['owner', 'dept_head'],
    render: () => <IssuesReportsPage />,
  },
  'networking-support': {
    label: 'Networking Support',
    icon: Wifi,
    roles: ['owner', 'dept_head'],
    render: () => (
      <section className="mx-auto max-w-4xl space-y-3 p-6">
        <div className="rounded-xl border border-line bg-surface p-8">
          <Wifi className="mb-4 h-8 w-8 text-blue-400" />
          <h1 className="text-2xl font-bold text-ink">Networking Support</h1>
          <p className="mt-2 text-mute">Coming soon</p>
        </div>
      </section>
    ),
  },
};

// Old addresses still work: they open the tab that replaced them.
const ALIASES: Record<string, string> = {
  emergency: 'meetings/emergency',
  approvals: 'requests/review',
  audit: 'users/audit',
  payments: 'requests/payments',
};

export const EVENT_SECTIONS: Array<[string, string, any]> = [
  ['event-creation', 'Event Creation', CalendarDays],
  ['pre-event-meetings', 'Pre-Event Meetings', CalendarClock],
  ['requirement-management', 'Requirement Management', ClipboardList],
  ['post-event-review', 'Post-Event Review', BarChart3],
];

// Own keys only: '#/constructor' or '#/toString' must not match anything on Object.prototype.
export const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

export const useRoute = () => {
  const get = () => location.hash.replace(/^#\/?/, '');
  const [r, setR] = useState(get);
  useEffect(() => {
    const f = () => setR(get());
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);
  return r;
};

// Where does this person belong, and is the address they asked for allowed? Pure function: easy to reason about.
//   Super Admin -> Dashboard (the only one who sees it)     IT Department Head -> Overview
//   Sub-department head / staff -> straight into their own department     Volunteer -> IT Support
export const resolveRoute = (
  route: string,
  role: string,
  own: string[],
  apps: string[],
  subDepartment?: string,
  can: (m: ModuleQuery) => boolean = () => true,
) => {
  const [s0, s1] = route.split('/');
  let [requestedSeg, requestedTab] = (has(ALIASES, s0) ? ALIASES[s0] : s1 ? `${s0}/${s1}` : s0).split('/');
  if (
    (requestedSeg === 'events' && requestedTab === 'task-planning') ||
    (requestedSeg === 'sewadars' && requestedTab === 'tasks')
  ) {
    requestedSeg = 'tasks';
    requestedTab = undefined;
  }
  const purchaseViews = ['buy', 'tracking', 'orders', 'receiving', 'payments', 'vendors', 'approve'];
  // Keep old nested Procurement links working, but canonicalize them to the new sidebar page.
  if (requestedSeg === 'requests' && purchaseViews.includes(requestedTab || '')) requestedSeg = 'purchase';
  if (requestedSeg === 'purchase' && requestedTab === 'approve') requestedTab = 'payments';
  if (requestedSeg === 'purchase')
    requestedTab =
      requestedTab === 'approve' ? 'payments' : requestedTab || (subDepartment === 'accounts' ? 'payments' : 'buy');
  const seg = requestedSeg;
  const tab = requestedTab;
  const buyer = role !== 'owner' && role !== 'dept_head' && subDepartment === 'purchase';
  const accountant = role !== 'owner' && role !== 'dept_head' && subDepartment === 'accounts';
  const home =
    role === 'owner'
      ? ''
      : role === 'dept_head'
        ? 'overview'
        : buyer || accountant
          ? 'purchase'
          : role === 'volunteer' || !own.length
            ? 'support'
            : own[0];
  const exec = role === 'owner' || role === 'dept_head';
  const procurementRole = exec || can('purchase');
  const controlRoomAllowed = can('cctv-control-room'); // IT department and Super Admin
  // Shared pages for sub-department roles follow the permission grid.
  const shared = (m: ModuleQuery) => exec || can(m);
  const subRole = !exec && role !== 'volunteer';
  const allowed =
    (seg === 'helpdesk' && shared('helpdesk')) ||
    (has(ORG_PAGES, seg) &&
      ORG_PAGES[seg].roles.includes(role) &&
      (!['tasks', 'events'].includes(seg) || shared(seg as ModuleKey)) &&
      (seg !== 'networking-support' || can(seg))) ||
    (seg === 'tasks' && apps.includes('sewadars')) ||
    (seg === 'issues' && role !== 'volunteer' && shared('issues')) ||
    (subRole && ['reports', 'networking-support'].includes(seg) && can(seg as ModuleKey)) ||
    (seg === 'purchase' && procurementRole) ||
    (has(APP_VIEWS, seg) && apps.includes(seg)) ||
    (seg === 'cctv-control-room' && controlRoomAllowed) ||
    (seg === 'support' && home === 'support') ||
    (seg === 'meetings' && (role === 'volunteer' || shared('meetings'))) ||
    (seg === 'requests' && shared('requests'));
  // Sewadar pages are switched on one by one (#/sewadars/<tab>; no tab = Sewadar Master).
  const sewadarPageOk = seg !== 'sewadars' || exec || can(`sewadars:${tab || 'roster'}` as ModuleKey);
  const ok = allowed && sewadarPageOk;
  const key = ok ? seg : home;
  const t = ok ? tab : !ok && buyer ? 'buy' : undefined;
  return { key, tab: t, home, canonical: t ? `${key}/${t}` : key };
};
