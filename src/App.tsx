import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PermissionsProvider, usePermissions } from './context/PermissionsContext';
import type { ModuleKey, ModuleQuery } from './lib/permissions';
import { SubDeptPermissionsView } from './components/owner/SubDeptPermissionsView';
import { SubDepartmentsView } from './components/owner/SubDepartmentsView';
import { roleLabel } from './lib/roles';
import { HelpdeskApp } from './modules/helpdesk/HelpdeskApp';
import { DutiesShiftsPage } from './modules/manpower/DutiesShifts';
import { applyTheme } from './hooks/useMotion';
import { Menu, X, Layers, LayoutDashboard, CalendarClock, CalendarDays, Users, BarChart3, Video, Wifi, Radio, Monitor, Boxes, BedDouble, HeartHandshake, LifeBuoy, ClipboardList, PanelLeftClose, PanelLeftOpen, ChevronDown, ShoppingCart, PhoneCall, BadgeCheck, UsersRound, ListTodo, Clock3, Headset, ShieldCheck } from 'lucide-react';
import { AppProvider, useApp } from './context/AppContext';
import type { UserProfile } from './types';
import { DEPTS } from './views/orgData';
import { WalkieProvider, useWalkie, Walkie, ToastContainer, PendingApprovalView } from './modules/walkie';
import AuthScreen, { AuthFlashOut } from './modules/walkie/components/AuthScreen';
import { Swap } from './components/Swap';
import { RoyalEmbers } from './components/RoyalEmbers';

// Pages slide in from the side matching where they sit in the sidebar.
const navIndex = (k: string) => Array.from(document.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Main"] a[href^="#/"]')).findIndex(a => { const h = a.getAttribute('href')!.slice(2); return h === k || h.startsWith(k + '/') || k.startsWith(h + '/'); });
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
import { AttendancePage } from './modules/manpower/AttendancePage';
import { MeetingsProvider } from './context/MeetingsContext';
import { AccessProvider } from './context/AccessContext';
import { RequestsProvider, RequestsApp, useRequests } from './modules/requests';
import { EventScopeProvider, useEventScope } from './context/EventScopeContext';
import { ErrorBoundary } from './components/ErrorBoundary';

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
  tasks: { label: 'Tasks', icon: ListTodo, roles: ['owner', 'dept_head', 'sub_dept_head', 'staff'], render: () => <ManpowerApp initialSection="tasks" /> },
  requests: { label: 'Requests', icon: ClipboardList, roles: ['owner', 'dept_head'], render: t => <RequestsApp tab={t} /> },
  purchase: { label: 'Procurement', icon: ShoppingCart, roles: ['owner', 'dept_head'], render: t => <PurchaseApp initialTab={(t as DeskView) || 'buy'} /> },
  meetings: { label: 'Meetings & Emergency', icon: CalendarClock, roles: ['owner', 'dept_head'], render: t => <MeetingsEmergency tab={t} /> },
  events: { label: 'Event Planning & Coordination', icon: CalendarDays, roles: ['owner', 'dept_head', 'sub_dept_head', 'staff'], render: t => <EventPlanning section={t} /> },
  users: { label: 'Users & Access', icon: Users, roles: ['owner', 'dept_head'], render: t => <UserManagementView initialTab={t === 'audit' ? 'audit' : 'users_all'} /> },
  reports: { label: 'Reports', icon: BarChart3, roles: ['owner', 'dept_head'], render: () => <ReportsView /> },
  subdepartments: { label: 'Sub-departments', icon: Layers, roles: ['owner', 'dept_head'], render: () => <SubDepartmentsView /> },
  permissions: { label: 'Sub-department Permissions', icon: ShieldCheck, roles: ['owner', 'dept_head'], render: () => <SubDeptPermissionsView /> },
  issues: { label: 'Issues & Reports', icon: ClipboardList, roles: ['owner', 'dept_head'], render: () => <IssuesReportsPage /> },
  'networking-support': { label: 'Networking Support', icon: Wifi, roles: ['owner', 'dept_head'], render: () => <section className="mx-auto max-w-4xl space-y-3 p-6"><div className="rounded-xl border border-line bg-surface p-8"><Wifi className="mb-4 h-8 w-8 text-blue-400" /><h1 className="text-2xl font-bold text-ink">Networking Support</h1><p className="mt-2 text-mute">Coming soon</p></div></section> },
};
// Old addresses still work: they open the tab that replaced them.
const ALIASES: Record<string, string> = { emergency: 'meetings/emergency', approvals: 'requests/review', audit: 'users/audit', payments: 'requests/payments' };
const EVENT_SECTIONS: Array<[string, string, any]> = [
  ['event-creation', 'Event Creation', CalendarDays],
  ['pre-event-meetings', 'Pre-Event Meetings', CalendarClock],
  ['requirement-management', 'Requirement Management', ClipboardList],
  ['post-event-review', 'Post-Event Review', BarChart3],
];

// Own keys only: '#/constructor' or '#/toString' must not match anything on Object.prototype.
const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

const useRoute = () => {
  const get = () => location.hash.replace(/^#\/?/, '');
  const [r, setR] = useState(get);
  useEffect(() => { const f = () => setR(get()); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  return r;
};

// Where does this person belong, and is the address they asked for allowed? Pure function: easy to reason about.
//   Super Admin -> Dashboard (the only one who sees it)     IT Department Head -> Overview
//   Sub-department head / staff -> straight into their own department     Volunteer -> IT Support
const resolveRoute = (route: string, role: string, own: string[], apps: string[], subDepartment?: string, can: (m: ModuleQuery) => boolean = () => true) => {
  const [s0, s1] = route.split('/');
  let [requestedSeg, requestedTab] = (has(ALIASES, s0) ? ALIASES[s0] : s1 ? `${s0}/${s1}` : s0).split('/');
  if ((requestedSeg === 'events' && requestedTab === 'task-planning') || (requestedSeg === 'sewadars' && requestedTab === 'tasks')) { requestedSeg = 'tasks'; requestedTab = undefined; }
  const purchaseViews = ['buy', 'tracking', 'orders', 'receiving', 'payments', 'vendors', 'approve'];
  // Keep old nested Procurement links working, but canonicalize them to the new sidebar page.
  if (requestedSeg === 'requests' && purchaseViews.includes(requestedTab || '')) requestedSeg = 'purchase';
  if (requestedSeg === 'purchase' && requestedTab === 'approve') requestedTab = 'payments';
  if (requestedSeg === 'purchase') requestedTab = requestedTab === 'approve' ? 'payments' : requestedTab || (subDepartment === 'accounts' ? 'payments' : 'buy');
  const seg = requestedSeg;
  const tab = requestedTab;
  const buyer = role !== 'owner' && role !== 'dept_head' && subDepartment === 'purchase';
  const accountant = role !== 'owner' && role !== 'dept_head' && subDepartment === 'accounts';
  const home = role === 'owner' ? '' : role === 'dept_head' ? 'overview' : buyer || accountant ? 'purchase' : (role === 'volunteer' || !own.length) ? 'support' : own[0];
  const exec = role === 'owner' || role === 'dept_head';
  const procurementRole = exec || can('purchase');
  const controlRoomAllowed = exec || can('cctv-control-room');
  // Shared pages for sub-department roles follow the permission grid.
  const shared = (m: ModuleQuery) => exec || can(m);
  const subRole = !exec && role !== 'volunteer';
  const allowed = (seg === 'helpdesk' && shared('helpdesk')) || (has(ORG_PAGES, seg) && ORG_PAGES[seg].roles.includes(role) && (!['tasks', 'events'].includes(seg) || shared(seg as ModuleKey))) || (seg === 'tasks' && apps.includes('sewadars')) || (seg === 'issues' && role !== 'volunteer' && shared('issues')) || (subRole && ['reports', 'networking-support'].includes(seg) && can(seg as ModuleKey)) || (seg === 'purchase' && procurementRole) || (has(APP_VIEWS, seg) && apps.includes(seg)) || (seg === 'cctv-control-room' && controlRoomAllowed) || (seg === 'support' && home === 'support') || (seg === 'meetings' && (role === 'volunteer' || shared('meetings'))) || (seg === 'requests' && shared('requests'));
  // Sewadar pages are switched on one by one (#/sewadars/<tab>; no tab = Sewadar Master).
  const sewadarPageOk = seg !== 'sewadars' || exec || can(`sewadars:${tab || 'roster'}` as ModuleKey);
  const ok = allowed && sewadarPageOk;
  const key = ok ? seg : home;
  const t = ok ? tab : (!ok && buyer ? 'buy' : undefined);
  return { key, tab: t, home, canonical: t ? `${key}/${t}` : key };
};

// One theme for the whole app. The setting lives in the Walkie settings (so it is saved and shared with
// Walkie / Accommodation) and is mirrored onto <html class="dark"> so every screen follows it.
const useTheme = () => {
  const w: any = useWalkie();
  const isDark = w.settings?.theme === 'dark';
  const palette = w.settings?.palette;
  useEffect(() => { applyTheme(isDark, palette); }, [isDark, palette]);
  const toggle = () => w.setSettings?.((p: any) => ({ ...p, theme: p.theme === 'dark' ? 'light' : 'dark' }));
  return { isDark, toggle };
};

// Sidebar entries live outside Shell so they are not rebuilt (and their icons re-animated) on every render.
const SideNavCtx = React.createContext({ active: '', collapsed: false });
const NavItem: React.FC<any> = ({ id, label, Icon, badge = 0 }: { id: string; label: string; Icon: any; badge?: number }) => {
  const { active: key, collapsed } = React.useContext(SideNavCtx);
  return (
    <a href={'#/' + id} title={label} aria-label={label} aria-current={key === id ? 'page' : undefined}
      className={`relative flex min-h-9 items-center ${collapsed ? 'md:justify-center md:px-0' : ''} gap-2.5 px-2.5 py-1.5 rounded-md text-[13.5px] font-medium transition-[background-color,color,transform,opacity] duration-200 ease-out hover:translate-x-0.5 active:scale-[0.99] ${key === id ? 'bg-blue-600/10 text-blue-300 font-semibold' : 'text-mute hover:bg-blue-600/10 hover:text-blue-300'}`}>
      <Icon size={16} className="shrink-0" /><span className={`truncate flex-1 ${collapsed ? 'md:hidden' : ''}`}>{label}</span>{badge > 0 && <span title={`${badge} notifications`} aria-label="Notifications" className={`h-2 w-2 shrink-0 rounded-full bg-amber-400 ${collapsed ? 'md:absolute md:right-1.5 md:top-1.5' : ''}`} />}</a>
  );
};
const NavSubItem: React.FC<any> = ({ href, label, Icon, active }: { href: string; label: string; Icon: any; active: boolean }) => {
  const { collapsed } = React.useContext(SideNavCtx);
  return (
    <a href={href} title={label} aria-label={label} aria-current={active ? 'page' : undefined}
      className={`flex min-h-8 items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium ${collapsed ? 'md:justify-center md:px-0' : ''} ${active ? 'bg-blue-600/10 font-semibold text-blue-300' : 'text-mute hover:bg-blue-600/10 hover:text-blue-300'}`}>
      <Icon size={collapsed ? 15 : 13} className="shrink-0 opacity-80" /><span className={`truncate ${collapsed ? 'md:hidden' : ''}`}>{label}</span></a>
  );
};
const NavLabel: React.FC<any> = ({ t }: { t: string }) => {
  const { collapsed } = React.useContext(SideNavCtx);
  return <div className={`${collapsed ? 'px-3 pt-5 pb-1.5 md:px-2 md:pt-3 md:pb-1' : 'px-3 pt-5 pb-1.5'} text-[10.5px] font-semibold uppercase tracking-wider text-faint`}>{collapsed ? <><span className="md:hidden">{t}</span><span className="hidden md:block h-px bg-line" /></> : t}</div>;
};

const Shell: React.FC<{ out: () => void }> = ({ out }) => {
  const { currentUser: u, canAccessApp } = useApp();
  const perms = usePermissions();
  const { actionCount } = useRequests();
  const { isDark } = useTheme();
  const wk: any = useWalkie();
  const palette = wk.settings?.palette;
  // Sidebar brand: the organization's name and initials (falls back to the app name while it loads).
  const orgName: string = wk.currentOrganization?.name || (wk.settings?.orgName !== 'Apex Security & Logistics' && wk.settings?.orgName) || 'Event Command';
  const orgInitials = orgName.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join('').toUpperCase() || 'EC';
  const royal = isDark && palette === 'saffron';
  const eventScope = useEventScope();
  const route = useRoute();
  const mainRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false); // mobile drawer
  // Start with the navigation expanded so users can see the full section names.
  const [collapsed, setCollapsed] = useState(false);
  // Sidebar groups work as an accordion: only one is open at a time.
  type Group = 'events' | 'volunteer' | 'stocks' | 'operations' | 'admin';
  const [openGroup, setOpenGroup] = useState<Group | null>(null);
  // Hovering a group opens it after a short pause (so sweeping past does nothing) and closes it soon after leaving.
  const [hoverGroup, setHoverGroup] = useState<Group | null>(null);
  const hoverTimer = useRef<number>();
  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);
  const hoverProps = (id: Group) => ({
    onMouseEnter: () => { window.clearTimeout(hoverTimer.current); hoverTimer.current = window.setTimeout(() => setHoverGroup(id), 150); },
    onMouseLeave: () => { window.clearTimeout(hoverTimer.current); hoverTimer.current = window.setTimeout(() => setHoverGroup(h => (h === id ? null : h)), 250); },
  });
  const isOpen = (id: Group) => openGroup === id || hoverGroup === id;
  const opener = (id: Group) => (v: boolean | ((open: boolean) => boolean)) => {
    const now = isOpen(id);
    const next = typeof v === 'function' ? v(now) : v;
    if (!next) setHoverGroup(h => (h === id ? null : h));
    setOpenGroup(g => (next ? id : g === id ? null : g));
  };
  const operationsOpen = isOpen('operations'), setOperationsOpen = opener('operations');
  const eventsOpen = isOpen('events'), setEventsOpen = opener('events');
  const volunteerOpen = isOpen('volunteer'), setVolunteerOpen = opener('volunteer');
  const stocksOpen = isOpen('stocks'), setStocksOpen = opener('stocks');
  const administrationOpen = isOpen('admin'), setAdministrationOpen = opener('admin');
  const toggleCollapsed = () => setCollapsed(v => { const next = !v; try { localStorage.setItem('crm_sidebar_collapsed', next ? '1' : '0'); } catch { /* storage can be disabled */ } return next; });

  const own = Object.keys(APP_VIEWS).filter(k => canAccessApp(k as any));
  // Everyone signed in can at least VIEW Accommodation (rooms + live menu); editing is limited by role.
  // People without a role yet can still view Accommodation; sub-department roles follow the permission grid.
  const apps = u.role === 'volunteer' && !own.includes('accommodation') ? [...own, 'accommodation'] : own;
  const { key, tab, home, canonical } = resolveRoute(route, u.role, own, apps, u.subDepartmentId, perms.can);
  const scopeModule = key === 'sewadars' || key === 'walkie' || key === 'control' || key === 'accommodation' || key === 'wifi' ? key : key === 'events' || key === 'meetings' ? 'event-reports' : key === 'cctv-control-room' ? 'cctv-control-room' : '';
  const headerScopeModule = scopeModule || 'event-reports';
  const activeEventId = eventScope.scopeFor(headerScopeModule);
  useEffect(() => { mainRef.current?.scrollTo({ top: 0, behavior: 'auto' }); }, [key]);
  // Wrong or forbidden address (e.g. a staff member typing #/): replace it, so Back never returns to it.
  useEffect(() => { if (route !== canonical) location.replace('#/' + canonical); }, [route, canonical]);

  const orgKeys = Object.keys(ORG_PAGES).filter(k => ORG_PAGES[k].roles.includes(u.role));
  // Split technical operations from volunteer and accommodation management.
  const operationalKeys = (Object.keys(APP_VIEWS) as string[]).filter(k => apps.includes(k));
  const itOperationsKeys = operationalKeys.filter(k => ['cctv', 'wifi', 'walkie', 'control'].includes(k));
  const volunteerManagementKeys = operationalKeys.filter(k => ['accommodation', 'sewadars'].includes(k));
  const isOperationsPage = itOperationsKeys.includes(key) || key === 'cctv-control-room' || key === 'networking-support' || key === 'issues' || key === 'helpdesk';
  const isVolunteerManagementPage = key === 'accommodation' || key === 'sewadars' || key === 'tasks';
  // Going to a page opens the group that holds it and folds the others away.
  const activeGroup: Group | null = key === 'events' ? 'events' : isVolunteerManagementPage ? 'volunteer' : ['inventory', 'requests', 'purchase'].includes(key) ? 'stocks'
    : isOperationsPage ? 'operations' : ['users', 'subdepartments', 'permissions', 'reports'].includes(key) ? 'admin' : null;
  useEffect(() => { setOpenGroup(activeGroup); }, [activeGroup]);
  // Mobile drawer: close after choosing a page, and on Escape.
  useEffect(() => { setOpen(false); }, [key, tab]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  const showWorkspaceNav = u.role === 'owner' || u.role === 'dept_head';
  const canOpenCctvControlRoom = showWorkspaceNav || perms.can('cctv-control-room');
  const canOpenProcurement = showWorkspaceNav || perms.can('purchase');
  const showSupport = u.role === 'volunteer' || home === 'support';
  const hasNav = showWorkspaceNav || orgKeys.length > 0 || canOpenProcurement || showSupport || canOpenCctvControlRoom || u.role !== 'volunteer';
  const view = key === 'helpdesk' ? <HelpdeskApp tab={tab} /> : key === 'support' ? <OtherDept /> : key === 'cctv-control-room' ? <CCTVControlRoomApp /> : key === 'accommodation' ? <Accommodation /> : key === 'inventory' ? <InventoryApp /> : key === 'walkie' ? React.createElement(Walkie as any, { embedded: true, initialTab: tab }) : key === 'sewadars' ? tab === 'attendance' ? <AttendancePage /> : tab === 'duties' ? <DutiesShiftsPage /> : <ManpowerApp initialSection={['calling', 'roster', 'permanent', 'teams'].includes(tab || '') ? tab as 'calling' | 'roster' | 'permanent' | 'teams' : 'roster'} /> : has(APP_VIEWS, key) ? React.createElement(APP_VIEWS[key][0]) : ORG_PAGES[key].render(tab);
  const title = key === 'helpdesk' ? 'Help Desk' : key === 'support' ? 'IT Support' : key === 'cctv-control-room' ? 'CCTV Control Room' : key === 'sewadars' ? (tab === 'attendance' ? 'Attendance' : tab === 'duties' ? 'Duties & Shifts' : tab === 'calling' ? 'Calling' : tab === 'tasks' ? 'Volunteer Tasks' : tab === 'permanent' ? 'IT Department Permanent Staff' : tab === 'teams' ? 'Teams' : 'Sewadar Master') : has(APP_VIEWS, key) ? DEPTS[key as keyof typeof DEPTS] : ORG_PAGES[key].label;

  const Item = NavItem;
  const SubItem = NavSubItem;
  // Children of a group: an indented tree when expanded; a tinted strip of centred icons when collapsed.
  const sub = `mt-1 space-y-0.5 ${collapsed ? 'md:ml-0 md:rounded-lg md:border-l-0 md:bg-raised/40 md:p-0.5 md:pl-0.5' : ''} ml-4 border-l border-line pl-2`;
  // Group header: icon only, centred, when collapsed.
  const head = (active: boolean) => `flex min-h-9 w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13.5px] font-semibold ${collapsed ? 'md:justify-center md:px-0' : ''} ${active ? 'bg-blue-600/10 text-blue-300' : 'text-mute hover:bg-blue-600/10 hover:text-blue-300'}`;
  const Label = NavLabel;
  const orgLabel = u.role === 'owner' ? 'Organization' : 'IT Department';
  return (
    <div className="app-root flex h-screen bg-canvas text-ink">
      {royal && <RoyalEmbers />}
      {hasNav && <div aria-hidden="true" onClick={() => setOpen(false)} className={`md:hidden fixed inset-0 z-30 bg-black/50 transition-opacity duration-200 ease-out ${open ? 'opacity-100' : 'pointer-events-none opacity-0'}`} />}
      {hasNav && <aside {...({ inert: !open && window.matchMedia('(max-width: 767px)').matches } as any)} className={`print:hidden flex fixed md:static inset-y-0 left-0 z-40 ${open ? 'translate-x-0 opacity-100' : '-translate-x-full opacity-0 pointer-events-none'} md:translate-x-0 md:opacity-100 md:pointer-events-auto ${collapsed ? 'md:w-16' : 'md:w-72'} w-56 shrink-0 min-h-0 flex-col border border-line bg-surface p-2 md:p-1 shadow-sm md:my-3 md:ml-3 md:mr-3 md:h-[calc(100vh-1.5rem)] md:rounded-xl transition-[width,transform,opacity] duration-200 ease-out`}>
        <div className={`flex items-center ${collapsed ? 'md:justify-between md:gap-0 md:px-0' : 'gap-2.5'} gap-2.5 min-w-0 px-1 pb-3 border-b border-line`}>
            <a href="#/" title={`${orgName} · Dashboard`} aria-label={`${orgName} dashboard`}
              className={`grid place-items-center w-9 h-9 rounded-md bg-blue-600 text-white text-xs font-bold shrink-0 overflow-hidden ${collapsed ? 'md:h-7 md:w-7' : ''}`}>
              {wk.currentOrganization?.logoUrl ? <img src={wk.currentOrganization.logoUrl} alt="" className="h-full w-full rounded-md object-contain bg-white" /> : orgInitials}
            </a>
            <span className={`min-w-0 flex-1 ${collapsed ? 'md:hidden' : ''}`}><span className="block text-[13.5px] font-semibold leading-snug text-ink line-clamp-2 break-words" title={orgName}>{orgName}</span><span className="block text-[10.5px] text-faint truncate">IT OPERATIONS</span></span>
            <button type="button" onClick={() => setOpen(false)} className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-mute hover:bg-raised hover:text-ink md:hidden" title="Close menu" aria-label="Close menu"><X size={18} /></button>
            <button type="button" onClick={toggleCollapsed} className="hidden h-7 w-7 place-items-center rounded-md text-mute hover:bg-blue-600/10 hover:text-blue-300 md:grid md:h-6 md:w-6" title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
              {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </button>
        </div>
        <SideNavCtx.Provider value={{ active: key, collapsed }}><nav className="sidebar-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain rounded-lg" aria-label="Main">
          {showWorkspaceNav && <>
            {u.role === 'owner' && <><Label t="Workspace" /><Item id="" label="Dashboard" Icon={LayoutDashboard} /></>}
            {u.role === 'dept_head' && <><Label t="Workspace" /><Item id="overview" label="Department overview" Icon={LayoutDashboard} /></>}
            {orgKeys.includes('events') && <><Label t="Coordination" /><div className="mb-1" {...hoverProps('events')}>
              <div className={`flex min-h-9 items-center rounded-md text-[13.5px] font-semibold ${key === 'events' ? 'bg-blue-600/10 text-blue-300' : 'text-mute hover:bg-blue-600/10 hover:text-blue-300'}`}>
                <a href="#/events/event-creation" onClick={() => setEventsOpen(true)} title={ORG_PAGES.events.label} aria-label={ORG_PAGES.events.label} aria-current={key === 'events' ? 'page' : undefined} className={`flex min-h-9 min-w-0 flex-1 items-center gap-2.5 rounded-md px-2.5 py-1.5 ${collapsed ? 'md:justify-center md:px-0' : ''}`}><CalendarDays size={16} className="shrink-0" /><span className={`truncate ${collapsed ? 'md:hidden' : ''}`}>{ORG_PAGES.events.label}</span></a>
                <button type="button" onClick={() => setEventsOpen(value => !value)} aria-label={eventsOpen ? 'Collapse event sections' : 'Expand event sections'} aria-expanded={eventsOpen} className={`grid h-7 w-7 shrink-0 place-items-center rounded-md hover:bg-blue-600/10 ${collapsed ? 'md:hidden' : ''}`}><ChevronDown size={13} className={`transition-transform ${eventsOpen ? 'rotate-180' : ''}`} /></button>
              </div>
              <div aria-hidden={!eventsOpen} {...({ inert: !eventsOpen } as any)} className={`grid transition-[grid-template-rows,opacity] duration-200 ${eventsOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0 pointer-events-none'}`}>
                <div className="min-h-0 overflow-hidden"><div className={sub}>{EVENT_SECTIONS.map(([id, label, Icon]) => <SubItem key={id} href={`#/events/${id}`} label={label} Icon={Icon} active={key === 'events' && tab === id} />)}</div></div>
              </div>
            </div></>}
            <section className="mt-1" {...hoverProps('volunteer')}>
              <button type="button" title="Volunteer Management" aria-label="Volunteer Management" aria-expanded={volunteerOpen} onClick={() => setVolunteerOpen(v => !v)} className={head(isVolunteerManagementPage)}>
                <HeartHandshake size={16} className="shrink-0" /><span className={`flex-1 truncate text-left ${collapsed ? 'md:hidden' : ''}`}>Volunteer Management</span><ChevronDown size={14} className={`shrink-0 transition-transform ${volunteerOpen ? 'rotate-180' : ''} ${collapsed ? 'md:hidden' : ''}`} />
              </button>
              <div className={`overflow-hidden transition-[max-height,opacity] duration-200 ease-in-out ${volunteerOpen ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'}`}>
              <div className={sub}>
                {volunteerManagementKeys.includes('accommodation') && <Item id="accommodation" label="Accommodation" Icon={BedDouble} />}
                {volunteerManagementKeys.includes('sewadars') && <>
                  <SubItem href="#/sewadars/roster" label="Sewadar Master" Icon={Users} active={key === 'sewadars' && (tab === 'roster' || !tab)} />
                  <SubItem href="#/sewadars/permanent" label="IT Department Permanent Staff" Icon={BadgeCheck} active={key === 'sewadars' && tab === 'permanent'} />
                  <SubItem href="#/sewadars/calling" label="Calling" Icon={PhoneCall} active={key === 'sewadars' && tab === 'calling'} />
                  <SubItem href="#/sewadars/attendance" label="Attendance" Icon={CalendarClock} active={key === 'sewadars' && tab === 'attendance'} />
                  <SubItem href="#/sewadars/duties" label="Duties & Shifts" Icon={Clock3} active={key === 'sewadars' && tab === 'duties'} />
                  <SubItem href="#/sewadars/teams" label="Teams" Icon={UsersRound} active={key === 'sewadars' && tab === 'teams'} />
                </>}
                <Item id="tasks" label="Tasks" Icon={ListTodo} />
              </div></div>
            </section>
            {(operationalKeys.includes('inventory') || orgKeys.includes('requests') || canOpenProcurement) && <section className="mt-1" {...hoverProps('stocks')}>
              <button type="button" title="Stocks and Approvals" aria-label="Stocks and Approvals" aria-expanded={stocksOpen} onClick={() => setStocksOpen(value => !value)} className={head(['inventory','requests','purchase'].includes(key))}>
                <Boxes size={16} className="shrink-0" /><span className={`flex-1 truncate text-left ${collapsed ? 'md:hidden' : ''}`}>Stocks and Approvals</span><ChevronDown size={14} className={`shrink-0 transition-transform ${stocksOpen ? 'rotate-180' : ''} ${collapsed ? 'md:hidden' : ''}`} />
              </button>
              <div className={`overflow-hidden transition-[max-height,opacity] duration-200 ease-in-out ${stocksOpen ? 'max-h-64 opacity-100' : 'max-h-0 opacity-0'}`}>
                <div className={sub}>
                  {operationalKeys.includes('inventory') && <Item id="inventory" label="Inventory" Icon={Boxes} />}
                  {orgKeys.includes('requests') && <Item id="requests" label="Requests" Icon={ClipboardList} badge={actionCount} />}
                  {canOpenProcurement && <Item id="purchase" label="Procurement" Icon={ShoppingCart} />}
                </div>
              </div>
            </section>}
            {(itOperationsKeys.length > 0 || canOpenCctvControlRoom) && <section className="mt-1" {...hoverProps('operations')}>
              <button type="button" title="IT Services & Operations" aria-label="IT Services & Operations" aria-expanded={operationsOpen} onClick={() => setOperationsOpen(value => !value)} className={head(isOperationsPage)}>
                <Monitor size={16} className="shrink-0" /><span className={`flex-1 truncate text-left ${collapsed ? 'md:hidden' : ''}`}>IT Services &amp; Operations</span><ChevronDown size={14} className={`shrink-0 transition-transform ${operationsOpen ? 'rotate-180' : ''} ${collapsed ? 'md:hidden' : ''}`} />
              </button>
              <div className={`overflow-hidden transition-[max-height,opacity] duration-200 ease-in-out ${operationsOpen ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'}`}>
              <div className={sub}>
                <Item id="helpdesk" label="Help Desk" Icon={Headset} />
                {itOperationsKeys.map(k => <Item key={k} id={k} label={DEPTS[k as keyof typeof DEPTS]} Icon={APP_VIEWS[k][1]} />)}
                <Item id="cctv-control-room" label="CCTV Control Room" Icon={Monitor} />
                <Item id="networking-support" label="Networking Support · Coming Soon" Icon={Wifi} />
                {orgKeys.includes('issues') && <Item id="issues" label="Issues & Reports" Icon={ClipboardList} />}
              </div></div>
            </section>}
          </>}
          {!showWorkspaceNav && u.role !== 'volunteer' && <>
            <Label t={u.subDepartmentId ? `My modules · ${DEPTS[u.subDepartmentId as keyof typeof DEPTS]}` : 'My modules'} />
            {own.filter(k => k !== 'sewadars').map(k => <Item key={k} id={k} label={DEPTS[k as keyof typeof DEPTS]} Icon={APP_VIEWS[k][1]} />)}
            {canOpenCctvControlRoom && <Item id="cctv-control-room" label="CCTV Control Room" Icon={Monitor} />}
            {own.includes('sewadars') && <div className="space-y-0.5">
              {perms.can('sewadars:roster') && <SubItem href="#/sewadars/roster" label="Sewadar Master" Icon={Users} active={key === 'sewadars' && (tab === 'roster' || !tab)} />}
              {perms.can('sewadars:permanent') && <SubItem href="#/sewadars/permanent" label="IT Department Permanent Staff" Icon={BadgeCheck} active={key === 'sewadars' && tab === 'permanent'} />}
              {perms.can('sewadars:calling') && <SubItem href="#/sewadars/calling" label="Calling" Icon={PhoneCall} active={key === 'sewadars' && tab === 'calling'} />}
              {perms.can('sewadars:attendance') && <SubItem href="#/sewadars/attendance" label="Attendance" Icon={CalendarClock} active={key === 'sewadars' && tab === 'attendance'} />}
              {perms.can('sewadars:duties') && <SubItem href="#/sewadars/duties" label="Duties & Shifts" Icon={Clock3} active={key === 'sewadars' && tab === 'duties'} />}
              {perms.can('sewadars:teams') && <SubItem href="#/sewadars/teams" label="Teams" Icon={UsersRound} active={key === 'sewadars' && tab === 'teams'} />}
            </div>}
            {canOpenProcurement && <Item id="purchase" label="Procurement" Icon={ShoppingCart} />}
            <Label t="Shared" />
            {perms.can('helpdesk') && <Item id="helpdesk" label="Help Desk" Icon={Headset} />}
            {perms.can('requests') && <Item id="requests" label="Requests" Icon={ClipboardList} badge={actionCount} />}
            {perms.can('tasks') && <Item id="tasks" label="Tasks" Icon={ListTodo} />}
            {perms.can('events') && <Item id="events" label="Event Planning" Icon={CalendarDays} />}
            {perms.can('meetings') && <Item id="meetings" label="Meetings & Emergency" Icon={CalendarClock} />}
            {perms.can('issues') && <Item id="issues" label="Issues & Reports" Icon={ClipboardList} />}
            {perms.can('networking-support') && <Item id="networking-support" label="Networking Support" Icon={Wifi} />}
            {perms.can('reports') && <Item id="reports" label="Reports" Icon={BarChart3} />}
          </>}
          {orgKeys.some(k => ['users','reports'].includes(k)) && <section className="mt-1" {...hoverProps('admin')}>
            <button type="button" title="Administration" aria-label="Administration" aria-expanded={administrationOpen} onClick={() => setAdministrationOpen(value => !value)} className={head(['users','subdepartments','permissions','reports'].includes(key))}>
              <Users size={16} className="shrink-0" /><span className={`flex-1 truncate text-left ${collapsed ? 'md:hidden' : ''}`}>Administration</span><ChevronDown size={14} className={`shrink-0 transition-transform ${administrationOpen ? 'rotate-180' : ''} ${collapsed ? 'md:hidden' : ''}`} />
            </button>
            <div className={`overflow-hidden transition-[max-height,opacity] duration-200 ease-in-out ${administrationOpen ? 'max-h-64 opacity-100' : 'max-h-0 opacity-0'}`}>
              <div className={sub}>
                {orgKeys.filter(k => ['users','subdepartments','permissions','reports'].includes(k)).map(k => <Item key={k} id={k} label={k === 'users' ? 'Manage User Access' : ORG_PAGES[k].label} Icon={ORG_PAGES[k].icon} />)}
              </div>
            </div>
          </section>}
          {!showWorkspaceNav && u.role === 'volunteer' && <><Label t="Help" /><Item id="helpdesk" label="Help Desk" Icon={Headset} />{showSupport && <Item id="support" label="IT Support" Icon={LifeBuoy} />}</>}
        </nav></SideNavCtx.Provider>
      </aside>}
      <div className="app-frame flex-1 flex flex-col min-w-0 md:my-3 md:mr-3 md:min-h-0 md:overflow-hidden md:rounded-xl md:border md:border-line">
        <header className={`app-header print:hidden h-14 shrink-0 flex items-center justify-between gap-2 px-3 sm:gap-3 sm:px-5 bg-surface ${key === 'requests' ? '' : 'border-b border-line'}`}>
          <div className="flex items-center gap-3 min-w-0">
            {hasNav && <button className="md:hidden p-2 -ml-2 rounded-lg text-mute hover:bg-raised" onClick={() => setOpen(!open)} aria-label="Open menu"><Menu size={18} /></button>}
            {!hasNav && home !== 'requests' && (key === 'meetings' || key === 'requests') && <a href={'#/' + home} className="text-sm text-blue-400 hover:underline shrink-0">← Back</a>}
            <div className="min-w-0"><div className="hidden sm:block truncate text-[10.5px] font-semibold uppercase tracking-wider text-faint" title={u.designation}>{u.designation}</div><h1 className="page-title text-base font-semibold text-ink truncate">{title}</h1></div>
          </div>
          <div className="flex min-w-0 items-center gap-1 sm:gap-1.5">
            {eventScope.events.length > 0 && <label className="flex min-w-0 items-center gap-1.5 rounded-full border border-line bg-raised/60 px-2 py-1.5 text-[11.5px] text-mute sm:gap-2 sm:px-3 sm:text-xs"><span className="hidden whitespace-nowrap sm:inline">Working on</span><select aria-label="Event in focus" className="max-w-[28vw] cursor-pointer rounded-md border-0 bg-transparent py-0.5 pl-1 pr-5 font-semibold text-ink outline-none focus:ring-1 focus:ring-blue-500 sm:max-w-[22rem]" style={{ colorScheme: isDark ? 'dark' : 'light' }} value={activeEventId} onChange={e => eventScope.setScopeFor(headerScopeModule, e.target.value)}><option className="bg-surface text-ink" value="">Normal</option>{eventScope.events.map(event => <option className="bg-surface text-ink" key={event.id} value={event.id}>{event.name}</option>)}</select></label>}
            <span className="hidden sm:block mr-1"><LiveMealChip dark={isDark} /></span>
            <ProfileMenu />
          </div>
        </header>
        <main ref={mainRef} className="flex-1 overflow-y-auto [scrollbar-gutter:stable] p-4 sm:p-6"><Swap k={key === 'sewadars' ? `${key}/${tab || ''}` : key} indexOf={navIndex} className="w-full max-w-[1600px] mx-auto"><ErrorBoundary page key={`${key}/${tab || ''}`}>{view}</ErrorBoundary></Swap></main>
      </div>
      <ToastContainer />
    </div>
  );
};

const toProfile = (w: any, departmentName?: string): UserProfile => ({
  id: w.id, name: w.name || w.email, email: w.email, phone: '', departmentName: departmentName || '', designation: roleLabel(w.level, w.subDepartment, departmentName),
  role: ({ owner: 'owner', dept_head: 'dept_head', sub_dept_head: 'sub_dept_head', staff: 'staff' } as any)[w.level] || 'volunteer',
  subDepartmentId: w.subDepartment || undefined, avatar: String(w.name || 'U').slice(0, 2).toUpperCase(), badgeId: String(w.id).slice(0, 6),
  permissions: ['view', 'create', 'edit', 'approve', 'assign', 'export'], status: 'active', lastActive: 'Now',
});
const Loader = () => <div className="min-h-screen flex items-center justify-center text-sm text-faint">Loading…</div>;

// One login for everything: Supabase auth (RadioGate screens). Its profile decides the hierarchy level.
const Gate: React.FC = () => {
  const w: any = useWalkie();
  useEffect(() => { applyTheme(w.settings?.theme === 'dark', w.settings?.palette); }, [w.settings?.theme, w.settings?.palette]); const { setCurrentUser } = useApp(); const [ready, setReady] = useState(false);
  const wu = w.currentUser;
  const wuDept = (w.departments || []).find((d: any) => d.id === wu?.departmentId)?.name;
  useEffect(() => { if (wu && wu.approved) { setCurrentUser(toProfile(wu, wuDept)); setReady(true); } else setReady(false); }, [wu, wuDept]); // eslint-disable-line
  // The sign-in screen stays up while its welcome animation plays, then light fades over the app.
  const [ceremony, setCeremony] = useState(false);
  const [flashOut, setFlashOut] = useState(false);
  const finishCeremony = useCallback(() => { setCeremony(false); setFlashOut(true); setTimeout(() => setFlashOut(false), 950); }, []);
  if (!w.authChecked) return <Loader />;
  if (!wu || ceremony || w.authView === 'reset') return <AuthScreen onCeremony={setCeremony} onFinished={finishCeremony} />;
  const flash = flashOut ? <AuthFlashOut /> : null;
  if (!wu.approved) return <>{flash}<PendingApprovalView /></>;
  return ready ? <>{flash}<Shell out={w.logout} /></> : <>{flash}<Loader /></>;
};
export default function App() {
  return (
    <ErrorBoundary><WalkieProvider><WorkspaceProviders /></WalkieProvider></ErrorBoundary>
  );
}

const WorkspaceProviders: React.FC = () => {
  const { currentUser } = useWalkie() as any;
  return <EventScopeProvider organizationId={currentUser?.organizationId} approved={!!currentUser?.approved}><PermissionsProvider><MeetingsProvider><AppProvider><AccessProvider><AccommodationProvider><ManpowerProvider><InventoryProvider><PurchaseProvider><RequestsProvider>
    <Gate />
  </RequestsProvider></PurchaseProvider></InventoryProvider></ManpowerProvider></AccommodationProvider></AccessProvider></AppProvider></MeetingsProvider></PermissionsProvider></EventScopeProvider>;
};
