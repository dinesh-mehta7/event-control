import React, { useEffect, useRef, useState } from 'react';
import { Menu, LayoutDashboard, CalendarClock, CalendarDays, Users, BarChart3, Video, Wifi, Radio, Monitor, Boxes, BedDouble, HeartHandshake, LifeBuoy, ClipboardList, PanelLeftClose, PanelLeftOpen, ChevronDown, ShoppingCart, PhoneCall, BadgeCheck, UsersRound } from 'lucide-react';
import { AppProvider, useApp } from './context/AppContext';
import type { UserProfile } from './types';
import { DEPTS } from './views/orgData';
import { WalkieProvider, useWalkie, Walkie, ToastContainer, LoginView, SignupView, ForgotPasswordView, ResetPasswordView, PendingApprovalView } from './modules/walkie';
import { Home } from './views/Home';
import { EventPlanning } from './views/EventPlanning';
import { ProfileMenu } from './components/ProfileMenu';
import { MeetingsEmergency, OtherDept } from './views/Pages';
import { UserManagementView } from './components/owner/UserManagementView';
import { ReportsView } from './components/owner/ReportsView';
import { IssuesReportsPage } from './components/owner/IssuesReportsPage';
// Keep module entries explicit so the development server refreshes the app shell after workspace changes.
import { CCTVApp } from './components/apps/CCTVApp';
import { WiFiApp } from './components/apps/WiFiApp';
import { ControlRoomsApp } from './components/apps/ControlRoomsApp';
import { CCTVControlRoomApp } from './components/apps/CCTVControlRoomApp';
import { InventoryApp, InventoryProvider } from './modules/inventory';
import { PurchaseApp, PurchaseProvider } from './modules/purchase';
import type { DeskView } from './modules/purchase';
import { Accommodation, AccommodationProvider, LiveMealChip } from './modules/accommodation';
import { ManpowerApp, ManpowerProvider } from './modules/manpower';
import { MeetingsProvider } from './context/MeetingsContext';
import { AccessProvider } from './context/AccessContext';
import { RequestsProvider, RequestsApp, useRequests } from './modules/requests';
import { EventScopeProvider, useEventScope } from './context/EventScopeContext';

const APP_VIEWS: Record<string, [React.ComponentType, any]> = {
  cctv: [CCTVApp, Video], wifi: [WiFiApp, Wifi], walkie: [Walkie as any, Radio], control: [ControlRoomsApp, Monitor],
  inventory: [InventoryApp, Boxes], accommodation: [Accommodation, BedDouble], sewadars: [ManpowerApp, HeartHandshake],
};
// Organization pages. `roles` decides who can open a page; anyone else is sent to their own home.
// Requests and Procurement are separate workspaces with their own routes and sidebar entries.
interface OrgPage { label: string; icon: any; roles: string[]; render: (tab?: string) => React.ReactNode }
const ORG_PAGES: Record<string, OrgPage> = {
  '': { label: 'Dashboard', icon: LayoutDashboard, roles: ['owner'], render: () => <Home /> },
  overview: { label: 'Overview', icon: LayoutDashboard, roles: ['dept_head'], render: () => <Home /> },
  requests: { label: 'Requests', icon: ClipboardList, roles: ['owner', 'dept_head'], render: t => <RequestsApp tab={t} /> },
  purchase: { label: 'Procurement', icon: ShoppingCart, roles: ['owner', 'dept_head'], render: t => <PurchaseApp initialTab={(t as DeskView) || 'buy'} /> },
  meetings: { label: 'Meetings & Emergency', icon: CalendarClock, roles: ['owner', 'dept_head'], render: t => <MeetingsEmergency tab={t} /> },
  events: { label: 'Event Planning & Coordination', icon: CalendarDays, roles: ['owner', 'dept_head'], render: t => <EventPlanning section={t} /> },
  users: { label: 'Users & Access', icon: Users, roles: ['owner', 'dept_head'], render: t => <UserManagementView initialTab={t === 'audit' ? 'audit' : 'users_all'} /> },
  reports: { label: 'Reports', icon: BarChart3, roles: ['owner', 'dept_head'], render: () => <ReportsView /> },
  issues: { label: 'Issues & Reports', icon: ClipboardList, roles: ['owner', 'dept_head'], render: () => <IssuesReportsPage /> },
  'networking-support': { label: 'Networking Support', icon: Wifi, roles: ['owner', 'dept_head'], render: () => <section className="mx-auto max-w-4xl space-y-3 p-6"><div className="rounded-xl border border-line bg-surface p-8"><Wifi className="mb-4 h-8 w-8 text-blue-400" /><h1 className="text-2xl font-bold text-ink">Networking Support</h1><p className="mt-2 text-mute">Coming soon</p></div></section> },
};
// Old addresses still work: they open the tab that replaced them.
const ALIASES: Record<string, string> = { emergency: 'meetings/emergency', approvals: 'requests/review', audit: 'users/audit', payments: 'requests/payments' };

// Own keys only: '#/constructor' or '#/toString' must not match anything on Object.prototype.
const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

const useRoute = () => {
  const get = () => location.hash.replace(/^#\/?/, '');
  const [r, setR] = useState(get);
  useEffect(() => { const f = () => setR(get()); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  return r;
};

// Where does this person belong, and is the address they asked for allowed? Pure function: easy to reason about.
//   Organization Head -> Dashboard (the only one who sees it)     IT Department Head -> Overview
//   Sub-department head / staff -> straight into their own department     Volunteer -> IT Support
const resolveRoute = (route: string, role: string, own: string[], apps: string[], subDepartment?: string) => {
  const [s0, s1] = route.split('/');
  let [requestedSeg, requestedTab] = (has(ALIASES, s0) ? ALIASES[s0] : s1 ? `${s0}/${s1}` : s0).split('/');
  const purchaseViews = ['buy', 'tracking', 'orders', 'receiving', 'payments', 'vendors', 'approve'];
  // Keep old nested Procurement links working, but canonicalize them to the new sidebar page.
  if (requestedSeg === 'requests' && purchaseViews.includes(requestedTab || '')) requestedSeg = 'purchase';
  if (requestedSeg === 'purchase' && requestedTab === 'approve') requestedTab = 'payments';
  if (requestedSeg === 'purchase') requestedTab = requestedTab === 'approve' ? 'payments' : requestedTab || 'buy';
  const seg = requestedSeg;
  const tab = requestedTab;
  const buyer = role !== 'owner' && role !== 'dept_head' && subDepartment === 'purchase';
  const home = role === 'owner' ? '' : role === 'dept_head' ? 'overview' : buyer ? 'purchase' : (role === 'volunteer' || !own.length) ? 'support' : own[0];
  const procurementRole = role === 'owner' || role === 'dept_head' || subDepartment === 'purchase' || subDepartment === 'inventory';
  const controlRoomAllowed = role === 'owner' || role === 'dept_head' || ['cctv', 'control'].includes(subDepartment || '');
  const allowed = (has(ORG_PAGES, seg) && ORG_PAGES[seg].roles.includes(role)) || (seg === 'issues' && role !== 'volunteer') || (seg === 'purchase' && procurementRole) || (has(APP_VIEWS, seg) && apps.includes(seg)) || (seg === 'cctv-control-room' && controlRoomAllowed) || (seg === 'support' && home === 'support') || seg === 'meetings' || seg === 'requests';
  const key = allowed ? seg : home;
  const t = allowed ? tab : (!allowed && buyer ? 'buy' : undefined);
  return { key, tab: t, home, canonical: t ? `${key}/${t}` : key };
};

// One theme for the whole app. The setting lives in the Walkie settings (so it is saved and shared with
// Walkie / Accommodation) and is mirrored onto <html class="dark"> so every screen follows it.
const useTheme = () => {
  const w: any = useWalkie();
  const isDark = w.settings?.theme === 'dark';
  useEffect(() => { document.documentElement.classList.toggle('dark', isDark); }, [isDark]);
  const toggle = () => w.setSettings?.((p: any) => ({ ...p, theme: p.theme === 'dark' ? 'light' : 'dark' }));
  return { isDark, toggle };
};

const Shell: React.FC<{ out: () => void }> = ({ out }) => {
  const { currentUser: u, canAccessApp } = useApp();
  const { actionCount } = useRequests();
  const { isDark } = useTheme();
  const eventScope = useEventScope();
  const route = useRoute();
  const mainRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false); // mobile drawer
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('crm_sidebar_collapsed') === '1'; } catch { return false; } });
  const [operationsOpen, setOperationsOpen] = useState(false);
  const [eventsOpen, setEventsOpen] = useState(false);
  const [volunteerOpen, setVolunteerOpen] = useState(false);
  const toggleCollapsed = () => setCollapsed(v => { const next = !v; try { localStorage.setItem('crm_sidebar_collapsed', next ? '1' : '0'); } catch { /* storage can be disabled */ } return next; });

  const own = Object.keys(APP_VIEWS).filter(k => canAccessApp(k as any));
  // Everyone signed in can at least VIEW Accommodation (rooms + live menu); editing is limited by role.
  const apps = own.includes('accommodation') ? own : [...own, 'accommodation'];
  const { key, tab, home, canonical } = resolveRoute(route, u.role, own, apps, u.subDepartmentId);
  const scopeModule = key === 'sewadars' || key === 'walkie' || key === 'control' || key === 'accommodation' || key === 'wifi' ? key : key === 'events' ? 'event-reports' : key === 'cctv-control-room' ? 'cctv-control-room' : '';
  const activeEventId = scopeModule ? eventScope.scopeFor(scopeModule) : '';
  useEffect(() => { mainRef.current?.scrollTo({ top: 0, behavior: 'auto' }); }, [key]);
  // Wrong or forbidden address (e.g. a staff member typing #/): replace it, so Back never returns to it.
  useEffect(() => { if (route !== canonical) location.replace('#/' + canonical); }, [route, canonical]);

  const orgKeys = Object.keys(ORG_PAGES).filter(k => ORG_PAGES[k].roles.includes(u.role));
  // Split technical operations from volunteer and accommodation management.
  const operationalKeys = (Object.keys(APP_VIEWS) as string[]).filter(k => apps.includes(k));
  const itOperationsKeys = operationalKeys.filter(k => ['cctv', 'wifi', 'walkie', 'control'].includes(k));
  const volunteerManagementKeys = operationalKeys.filter(k => ['accommodation', 'sewadars'].includes(k));
  const isOperationsPage = itOperationsKeys.includes(key) || key === 'cctv-control-room' || key === 'networking-support' || key === 'issues';
  const isVolunteerManagementPage = key === 'accommodation' || key === 'sewadars';
  useEffect(() => { if (isOperationsPage) setOperationsOpen(true); }, [isOperationsPage]);
  useEffect(() => { if (key === 'events') setEventsOpen(true); }, [key]);
  useEffect(() => { if (isVolunteerManagementPage) setVolunteerOpen(true); }, [isVolunteerManagementPage]);
  const showWorkspaceNav = u.role === 'owner' || u.role === 'dept_head';
  const canOpenCctvControlRoom = showWorkspaceNav || ['cctv', 'control'].includes(u.subDepartmentId || '');
  const canOpenProcurement = u.role === 'owner' || u.role === 'dept_head' || u.subDepartmentId === 'purchase' || u.subDepartmentId === 'inventory';
  const showSupport = u.role === 'volunteer' || home === 'support';
  const hasNav = showWorkspaceNav || orgKeys.length > 0 || canOpenProcurement || showSupport || canOpenCctvControlRoom || u.role !== 'volunteer';
  const view = key === 'support' ? <OtherDept /> : key === 'cctv-control-room' ? <CCTVControlRoomApp /> : key === 'accommodation' ? <Accommodation /> : key === 'inventory' ? <InventoryApp /> : key === 'walkie' ? React.createElement(Walkie as any, { embedded: true, initialTab: tab }) : key === 'sewadars' ? <ManpowerApp initialSection={['calling', 'tasks', 'roster', 'permanent', 'teams'].includes(tab || '') ? tab as 'calling' | 'tasks' | 'roster' | 'permanent' | 'teams' : 'roster'} /> : has(APP_VIEWS, key) ? React.createElement(APP_VIEWS[key][0]) : ORG_PAGES[key].render(tab);
  const title = key === 'support' ? 'IT Support' : key === 'cctv-control-room' ? 'CCTV Control Room' : key === 'sewadars' ? (tab === 'calling' ? 'Calling' : tab === 'tasks' ? 'Volunteer Tasks' : tab === 'permanent' ? 'Permanent Members' : tab === 'teams' ? 'Teams' : 'Sewadar Roster') : has(APP_VIEWS, key) ? DEPTS[key as keyof typeof DEPTS] : ORG_PAGES[key].label;

  const Item = ({ id, label, Icon, badge = 0, uniform = false }: { id: string; label: string; Icon: any; badge?: number; uniform?: boolean }) => (
    <a href={'#/' + id} title={label} aria-label={label} aria-current={key === id ? 'page' : undefined}
      className={`relative flex min-h-10 items-center ${collapsed ? 'md:justify-center md:px-0' : ''} gap-3 px-3 py-2.5 rounded-md text-sm transition-[background-color,color,transform,opacity] duration-200 ease-out hover:translate-x-0.5 active:scale-[0.99] ${uniform ? 'bg-transparent text-mute hover:bg-transparent hover:text-ink' : key === id ? 'bg-blue-600 text-white font-semibold' : 'text-mute hover:bg-raised hover:text-ink'}`}>
      <Icon size={17} className="shrink-0" /><span className={`truncate flex-1 ${collapsed ? 'md:hidden' : ''}`}>{label}</span>{badge > 0 && <span title={`${badge} notifications`} aria-label="Notifications" className={`h-2 w-2 shrink-0 rounded-full bg-amber-400 ${collapsed ? 'md:absolute md:right-1.5 md:top-1.5' : ''}`} />}</a>
  );
  const Label = ({ t }: { t: string }) => <div className={`${collapsed ? 'px-3 pt-5 pb-1.5 md:px-2 md:pt-3 md:pb-1' : 'px-3 pt-5 pb-1.5'} text-[10px] font-semibold uppercase tracking-wider text-faint`}>{collapsed ? <><span className="md:hidden">{t}</span><span className="hidden md:block h-px bg-line" /></> : t}</div>;
  const orgLabel = u.role === 'owner' ? 'Organization' : 'IT Department';
  return (
    <div className="flex h-screen bg-canvas text-ink">
      {hasNav && <div aria-hidden="true" className={`md:hidden fixed inset-0 z-30 bg-black/50 transition-opacity duration-200 ease-out ${open ? 'opacity-100' : 'pointer-events-none opacity-0'}`} />}
      {hasNav && <aside {...({ inert: !open && window.matchMedia('(max-width: 767px)').matches } as any)} className={`print:hidden flex fixed md:static inset-y-0 left-0 z-40 ${open ? 'translate-x-0 opacity-100' : '-translate-x-full opacity-0 pointer-events-none'} md:translate-x-0 md:opacity-100 md:pointer-events-auto ${collapsed ? 'md:w-20' : 'md:w-72'} w-60 shrink-0 min-h-0 flex-col border border-line bg-surface p-2 shadow-sm md:my-3 md:ml-3 md:mr-0 md:h-[calc(100vh-1.5rem)] md:rounded-xl transition-[width,transform,opacity] duration-200 ease-out`}>
        <div className={`flex items-center ${collapsed ? 'md:justify-between md:gap-1' : 'gap-2.5'} gap-2.5 min-w-0 px-1 pb-3 border-b border-line`}>
            <a href="#/" title="Owner Dashboard" aria-label="Owner Dashboard"
              className="grid place-items-center w-9 h-9 rounded-md bg-blue-600 text-white text-xs font-bold shrink-0">
              EC
            </a>
            <span className={`min-w-0 flex-1 ${collapsed ? 'md:hidden' : ''}`}><span className="block font-semibold text-ink truncate">Event Command</span><span className="block text-[10px] text-faint truncate">IT OPERATIONS</span></span>
            <button type="button" onClick={toggleCollapsed} className={`hidden md:grid place-items-center w-8 h-8 rounded-md text-mute hover:bg-raised hover:text-ink ${collapsed ? '' : ''}`} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
              {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </button>
        </div>
        <nav className="sidebar-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain rounded-lg" aria-label="Main">
          {showWorkspaceNav && <>
            {u.role === 'owner' && <><Label t="Workspace" /><Item id="" label="Command overview" Icon={LayoutDashboard} /></>}
            {u.role === 'dept_head' && <><Label t="Workspace" /><Item id="overview" label="Department overview" Icon={LayoutDashboard} /></>}
            {(itOperationsKeys.length > 0 || canOpenCctvControlRoom) && <section className="mt-1" onMouseEnter={() => setOperationsOpen(true)} onMouseLeave={() => { if (!isOperationsPage) setOperationsOpen(false); }}>
              <button type="button" aria-expanded={operationsOpen} onClick={() => setOperationsOpen(value => !value)} className="flex min-h-10 w-full items-center gap-3 rounded-md bg-transparent px-3 py-2.5 text-sm font-semibold text-mute transition-colors hover:bg-transparent hover:text-ink">
                <Monitor size={17} className="shrink-0" /><span className={`flex-1 truncate text-left ${collapsed ? 'md:hidden' : ''}`}>IT Services &amp; Operations</span><ChevronDown size={15} className={`shrink-0 transition-transform ${operationsOpen ? 'rotate-180' : ''} ${collapsed ? 'md:hidden' : ''}`} />
              </button>
              <div className={`overflow-hidden transition-[max-height,opacity] duration-200 ease-in-out ${operationsOpen ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'}`}>
              <div className={`ml-4 mt-1 space-y-0.5 border-l border-line pl-2 ${collapsed ? 'md:hidden' : ''}`}>
                {itOperationsKeys.map(k => <Item key={k} id={k} label={DEPTS[k as keyof typeof DEPTS]} Icon={APP_VIEWS[k][1]} uniform />)}
                <Item id="cctv-control-room" label="CCTV Control Room" Icon={Monitor} uniform />
                <Item id="networking-support" label="Networking Support · Coming Soon" Icon={Wifi} uniform />
                {orgKeys.includes('issues') && <Item id="issues" label="Issues & Reports" Icon={ClipboardList} uniform />}
              </div></div>
            </section>}
            {operationalKeys.includes('inventory') && <><Label t="Inventory Management" /><Item id="inventory" label="Inventory" Icon={Boxes} /></>}
            {volunteerManagementKeys.length > 0 && <section className="mt-1" onMouseEnter={() => setVolunteerOpen(true)} onMouseLeave={() => { if (!isVolunteerManagementPage) setVolunteerOpen(false); }}>
              <button type="button" aria-expanded={volunteerOpen} onClick={() => setVolunteerOpen(v => !v)} className={`flex min-h-10 w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-semibold transition-colors ${key === 'accommodation' || key === 'sewadars' ? 'bg-raised text-ink' : 'text-mute hover:bg-raised hover:text-ink'}`}>
                <HeartHandshake size={17} className="shrink-0" /><span className={`flex-1 truncate text-left ${collapsed ? 'md:hidden' : ''}`}>Volunteer Management</span><ChevronDown size={15} className={`shrink-0 transition-transform ${volunteerOpen ? 'rotate-180' : ''} ${collapsed ? 'md:hidden' : ''}`} />
              </button>
              <div className={`overflow-hidden transition-[max-height,opacity] duration-200 ease-in-out ${volunteerOpen ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'}`}>
              <div className={`ml-4 mt-1 space-y-0.5 border-l border-line pl-2 ${collapsed ? 'md:hidden' : ''}`}>
                {volunteerManagementKeys.includes('accommodation') && <Item id="accommodation" label="Accommodation" Icon={BedDouble} />}
                {volunteerManagementKeys.includes('sewadars') && <>
                  <a href="#/sewadars/roster" aria-current={key === 'sewadars' && (tab === 'roster' || !tab) ? 'page' : undefined} className={`flex min-h-9 items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors ${key === 'sewadars' && (tab === 'roster' || !tab) ? 'bg-blue-600 text-white font-semibold' : 'text-mute hover:bg-raised hover:text-ink'}`}>{<Users size={15} className="shrink-0 opacity-80" />}<span>Sewadar Roster</span></a>
                  <a href="#/sewadars/calling" aria-current={key === 'sewadars' && tab === 'calling' ? 'page' : undefined} className={`flex min-h-9 items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors ${key === 'sewadars' && tab === 'calling' ? 'bg-blue-600 text-white font-semibold' : 'text-mute hover:bg-raised hover:text-ink'}`}>{<PhoneCall size={15} className="shrink-0 opacity-80" />}<span>Calling</span></a>
                  <a href="#/sewadars/permanent" aria-current={key === 'sewadars' && tab === 'permanent' ? 'page' : undefined} className={`flex min-h-9 items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors ${key === 'sewadars' && tab === 'permanent' ? 'bg-blue-600 text-white font-semibold' : 'text-mute hover:bg-raised hover:text-ink'}`}>{<BadgeCheck size={15} className="shrink-0 opacity-80" />}<span>Permanent Members</span></a>
                  <a href="#/sewadars/teams" aria-current={key === 'sewadars' && tab === 'teams' ? 'page' : undefined} className={`flex min-h-9 items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors ${key === 'sewadars' && tab === 'teams' ? 'bg-blue-600 text-white font-semibold' : 'text-mute hover:bg-raised hover:text-ink'}`}>{<UsersRound size={15} className="shrink-0 opacity-80" />}<span>Teams</span></a>
                  <a href="#/sewadars/tasks" aria-current={key === 'sewadars' && tab === 'tasks' ? 'page' : undefined} className={`flex min-h-9 items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors ${key === 'sewadars' && tab === 'tasks' ? 'bg-blue-600 text-white font-semibold' : 'text-mute hover:bg-raised hover:text-ink'}`}>{<ClipboardList size={15} className="shrink-0 opacity-80" />}<span>Tasks</span></a>
                </>}
              </div></div>
            </section>}
          </>}
          {!showWorkspaceNav && canOpenCctvControlRoom && <><Label t="IT Services & Operations" />{operationalKeys.filter(k => ['cctv', 'control'].includes(k)).map(k => <Item key={k} id={k} label={DEPTS[k as keyof typeof DEPTS]} Icon={APP_VIEWS[k][1]} />)}<Item id="cctv-control-room" label="CCTV Control Room" Icon={Monitor} /></>}
          {orgKeys.some(k => ['requests','meetings','events'].includes(k)) && <><Label t="Coordination" />{orgKeys.filter(k => ['requests','meetings','events'].includes(k)).map(k => k === 'events' ? <div key={k} className="mb-1" onMouseEnter={() => setEventsOpen(true)} onMouseLeave={() => { if (key !== 'events') setEventsOpen(false); }}>
            <div className={`flex items-center rounded-md ${key === 'events' ? 'bg-blue-600/10 text-blue-300' : 'text-mute hover:bg-raised hover:text-ink'}`}>
              <a href="#/events/event-creation" onClick={() => setEventsOpen(true)} title={ORG_PAGES.events.label} aria-label={ORG_PAGES.events.label} aria-current={key === 'events' ? 'page' : undefined} className="flex min-h-10 min-w-0 flex-1 items-center gap-3 rounded-md px-3 py-2.5 text-sm font-semibold"><CalendarDays size={17} className="shrink-0" /><span className="truncate">{ORG_PAGES.events.label}</span></a>
              <button type="button" onClick={() => setEventsOpen(value => !value)} aria-label={eventsOpen ? 'Collapse event sections' : 'Expand event sections'} aria-expanded={eventsOpen} className="grid h-9 w-9 shrink-0 place-items-center rounded-md hover:bg-raised"><ChevronDown size={15} className={`transition-transform ${eventsOpen ? 'rotate-180' : ''}`} /></button>
            </div>
            <div aria-hidden={!eventsOpen} {...({ inert: !eventsOpen } as any)} className={`grid transition-[grid-template-rows,opacity] duration-200 ${eventsOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0 pointer-events-none'}`}>
              <div className="min-h-0 overflow-hidden ml-3 border-l border-line pl-2">{[['event-creation','Event Creation'],['pre-event-meetings','Pre-Event Meetings'],['requirement-management','Requirement Management'],['task-planning','Task Planning'],['team-alignment','Team Alignment'],['post-event-review','Post-Event Review']].map(([id,label]) => <a key={id} href={`#/events/${id}`} aria-current={key === 'events' && tab === id ? 'page' : undefined} className={`block rounded-md px-3 py-2 text-xs transition-colors ${key === 'events' && tab === id ? 'bg-blue-600/10 font-semibold text-blue-300' : 'text-mute hover:bg-raised hover:text-ink'}`}>{label}</a>)}</div>
            </div>
          </div> : <React.Fragment key={k}><Item id={k} label={ORG_PAGES[k].label} Icon={ORG_PAGES[k].icon} badge={k === 'requests' ? actionCount : 0} uniform={k === 'users'} />{k === 'requests' && canOpenProcurement && <Item id="purchase" label="Procurement" Icon={ShoppingCart} />}</React.Fragment>)}</>}
          {canOpenProcurement && !orgKeys.includes('requests') && <><Label t="Coordination" /><Item id="requests" label="Requests" Icon={ClipboardList} badge={actionCount} /><Item id="purchase" label="Procurement" Icon={ShoppingCart} /></>}
          {(orgKeys.some(k => ['users','reports'].includes(k)) || u.role !== 'volunteer') && <><Label t="Administration" />{orgKeys.filter(k => ['users','reports'].includes(k)).map(k => <Item key={k} id={k} label={ORG_PAGES[k].label} Icon={ORG_PAGES[k].icon} uniform={k === 'users'} />)}</>}
          {showSupport && <><Label t="Help" /><Item id="support" label="IT Support" Icon={LifeBuoy} /></>}
        </nav>
      </aside>}
      <div className="flex-1 flex flex-col min-w-0 md:my-3 md:mr-3 md:min-h-0 md:overflow-hidden md:rounded-xl md:border md:border-line">
        <header className={`print:hidden h-14 shrink-0 flex items-center justify-between gap-3 px-5 bg-surface ${key === 'requests' ? '' : 'border-b border-line'}`}>
          <div className="flex items-center gap-3 min-w-0">
            {hasNav && <button className="md:hidden p-2 -ml-2 rounded-lg text-mute hover:bg-raised" onClick={() => setOpen(!open)} aria-label="Open menu"><Menu size={18} /></button>}
            {!hasNav && home !== 'requests' && (key === 'meetings' || key === 'requests') && <a href={'#/' + home} className="text-sm text-blue-400 hover:underline shrink-0">← Back</a>}
            <div className="min-w-0"><div className="hidden sm:block text-[10px] font-semibold uppercase tracking-wider text-faint">{u.role === 'owner' ? 'Organization workspace' : u.role === 'dept_head' ? 'IT department' : u.designation}</div><h1 className="text-base font-semibold text-ink truncate">{title}</h1></div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {scopeModule && <label className="flex min-w-0 items-center gap-1.5 rounded-full border border-line bg-raised/60 px-2 py-1.5 text-[11px] text-mute sm:gap-2 sm:px-3 sm:text-xs"><span className="whitespace-nowrap">Working on</span><select aria-label={`Working on ${scopeModule === 'event-reports' ? 'event reports' : scopeModule}`} className="max-w-28 cursor-pointer rounded-md border-0 bg-transparent py-0.5 pl-1 pr-5 font-semibold text-ink outline-none focus:ring-1 focus:ring-blue-500 sm:max-w-44" style={{ colorScheme: isDark ? 'dark' : 'light' }} value={activeEventId} onChange={e => eventScope.setScopeFor(scopeModule, e.target.value)}><option className="bg-surface text-ink" value="">Normal</option>{eventScope.events.map(event => <option className="bg-surface text-ink" key={event.id} value={event.id}>{event.name}</option>)}</select></label>}
            <span className="hidden sm:block mr-1"><LiveMealChip dark={isDark} /></span>
            <ProfileMenu />
          </div>
        </header>
        <main ref={mainRef} className="flex-1 overflow-y-auto [scrollbar-gutter:stable] p-4 sm:p-6"><div key={key} className="w-full max-w-[1600px] mx-auto">{view}</div></main>
      </div>
      <ToastContainer />
    </div>
  );
};

const LABEL: Record<string, string> = { owner: 'Organization Head', dept_head: 'IT Department Head', sub_dept_head: 'Sub-department Head', staff: 'Staff', other: 'Other Department' };
const toProfile = (w: any): UserProfile => ({
  id: w.id, name: w.name || w.email, email: w.email, phone: '', departmentName: 'IT Department', designation: LABEL[w.level] || LABEL.other,
  role: ({ owner: 'owner', dept_head: 'dept_head', sub_dept_head: 'sub_dept_head', staff: 'staff' } as any)[w.level] || 'volunteer',
  subDepartmentId: w.subDepartment || undefined, avatar: String(w.name || 'U').slice(0, 2).toUpperCase(), badgeId: String(w.id).slice(0, 6),
  permissions: ['view', 'create', 'edit', 'approve', 'assign', 'export'], status: 'active', lastActive: 'Now',
});
const Loader = () => <div className="min-h-screen flex items-center justify-center text-sm text-faint">Loading…</div>;

// One login for everything: Supabase auth (RadioGate screens). Its profile decides the hierarchy level.
const Gate: React.FC = () => {
  const w: any = useWalkie();
  useEffect(() => { document.documentElement.classList.toggle('dark', w.settings?.theme === 'dark'); }, [w.settings?.theme]); const { setCurrentUser } = useApp(); const [ready, setReady] = useState(false);
  const wu = w.currentUser;
  useEffect(() => { if (wu && wu.approved) { setCurrentUser(toProfile(wu)); setReady(true); } else setReady(false); }, [wu]); // eslint-disable-line
  if (!w.authChecked) return <Loader />;
  if (w.authView === 'reset') return <ResetPasswordView />;
  if (!wu) return w.authView === 'signup' ? <SignupView /> : w.authView === 'forgot' ? <ForgotPasswordView /> : <LoginView />;
  if (!wu.approved) return <PendingApprovalView />;
  return ready ? <Shell out={w.logout} /> : <Loader />;
};
export default function App() {
  return (
    <WalkieProvider><WorkspaceProviders /></WalkieProvider>
  );
}

const WorkspaceProviders: React.FC = () => {
  const { currentUser } = useWalkie() as any;
  return <EventScopeProvider organizationId={currentUser?.organizationId} approved={!!currentUser?.approved}><MeetingsProvider><AppProvider><AccessProvider><AccommodationProvider><ManpowerProvider><InventoryProvider><PurchaseProvider><RequestsProvider>
    <Gate />
  </RequestsProvider></PurchaseProvider></InventoryProvider></ManpowerProvider></AccommodationProvider></AccessProvider></AppProvider></MeetingsProvider></EventScopeProvider>;
};
