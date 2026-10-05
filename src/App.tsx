import React, { useEffect, useState } from 'react';
import { Menu, LayoutDashboard, CalendarClock, Users, BarChart3, Video, Wifi, Radio, Monitor, Boxes, ShoppingCart, BedDouble, HeartHandshake, LifeBuoy, ClipboardList, PanelLeftClose, PanelLeftOpen, ChevronDown } from 'lucide-react';
import { AppProvider, useApp } from './context/AppContext';
import type { UserProfile } from './types';
import { DEPTS } from './pages/orgData';
import { WalkieProvider, useWalkie, Walkie, ToastContainer, LoginView, SignupView, ForgotPasswordView, ResetPasswordView, PendingApprovalView } from './modules/walkie';
import { Home } from './pages/Home';
import { ProfileMenu } from './components/ProfileMenu';
import { MeetingsEmergency, OtherDept } from './pages/Pages';
import { UserManagementView } from './components/owner/UserManagementView';
import { ReportsView } from './components/owner/ReportsView';
// Keep module entries explicit so the development server refreshes the app shell after workspace changes.
import { CCTVApp } from './components/apps/CCTVApp';
import { WiFiApp } from './components/apps/WiFiApp';
import { ControlRoomsApp } from './components/apps/ControlRoomsApp';
import { InventoryApp, InventoryProvider } from './modules/inventory';
import { PurchaseApp, PurchaseProvider, useProcurementCount } from './modules/purchase';
import { Accommodation, AccommodationProvider, LiveMealChip } from './modules/accommodation';
import { ManpowerApp, ManpowerProvider } from './modules/manpower';
import { MeetingsProvider } from './context/MeetingsContext';
import { AccessProvider } from './context/AccessContext';
import { RequestsProvider, RequestsApp, useRequests } from './modules/requests';

// The Purchase module is independent from the department Requests workspace.
const PurchaseLanding: React.FC = () => {
  const { currentUser } = useApp();
  return <PurchaseApp initialTab={currentUser.subDepartmentId === 'purchase' ? 'buy' : 'orders'} />;
};

const APP_VIEWS: Record<string, [React.ComponentType, any]> = {
  cctv: [CCTVApp, Video], wifi: [WiFiApp, Wifi], walkie: [Walkie as any, Radio], control: [ControlRoomsApp, Monitor],
  inventory: [InventoryApp, Boxes], purchase: [PurchaseLanding, ShoppingCart], accommodation: [Accommodation, BedDouble], sewadars: [ManpowerApp, HeartHandshake],
};
// Organization pages. `roles` decides who can open a page; anyone else is sent to their own home.
// Meetings + Emergency is one page, and so is Requests (which now also holds buying, orders and payments). The tab is the second part of the address.
interface OrgPage { label: string; icon: any; roles: string[]; render: (tab?: string) => React.ReactNode }
const ORG_PAGES: Record<string, OrgPage> = {
  '': { label: 'Dashboard', icon: LayoutDashboard, roles: ['owner'], render: () => <Home /> },
  overview: { label: 'Overview', icon: LayoutDashboard, roles: ['dept_head'], render: () => <Home /> },
  requests: { label: 'Requests', icon: ClipboardList, roles: ['owner', 'dept_head'], render: t => <RequestsApp tab={t} /> },
  meetings: { label: 'Meetings & Emergency', icon: CalendarClock, roles: ['owner', 'dept_head'], render: t => <MeetingsEmergency tab={t} /> },
  users: { label: 'Users & Access', icon: Users, roles: ['owner', 'dept_head'], render: t => <UserManagementView initialTab={t === 'audit' ? 'audit' : 'users_all'} /> },
  reports: { label: 'Reports', icon: BarChart3, roles: ['owner', 'dept_head'], render: () => <ReportsView /> },
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
const resolveRoute = (route: string, role: string, own: string[], apps: string[]) => {
  const [s0, s1] = route.split('/');
  const [requestedSeg, requestedTab] = (has(ALIASES, s0) ? ALIASES[s0] : s1 ? `${s0}/${s1}` : s0).split('/');
  const purchaseTab = requestedSeg === 'requests' && ['buy', 'orders', 'receiving', 'payments', 'vendors'].includes(requestedTab || '');
  const seg = purchaseTab ? 'purchase' : requestedSeg;
  const tab = purchaseTab ? requestedTab : requestedTab;
  const buyer = role !== 'owner' && role !== 'dept_head' && own[0] === 'purchase';   // the Purchase team works inside Requests
  const home = role === 'owner' ? '' : role === 'dept_head' ? 'overview' : buyer ? 'purchase' : (role === 'volunteer' || !own.length) ? 'support' : own[0];
  const allowed = (has(ORG_PAGES, seg) && ORG_PAGES[seg].roles.includes(role)) || (has(APP_VIEWS, seg) && apps.includes(seg)) || (seg === 'support' && home === 'support') || seg === 'meetings' || seg === 'requests';
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
  const proc = useProcurementCount();
  const { isDark } = useTheme();
  const route = useRoute();
  const [open, setOpen] = useState(false); // mobile drawer
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('crm_sidebar_collapsed') === '1'; } catch { return false; } });
  const [operationsOpen, setOperationsOpen] = useState(false);
  const toggleCollapsed = () => setCollapsed(v => { const next = !v; try { localStorage.setItem('crm_sidebar_collapsed', next ? '1' : '0'); } catch { /* storage can be disabled */ } return next; });

  const own = Object.keys(APP_VIEWS).filter(k => canAccessApp(k as any));
  // Everyone signed in can at least VIEW Accommodation (rooms + live menu); editing is limited by role.
  const apps = own.includes('accommodation') ? own : [...own, 'accommodation'];
  const { key, tab, home, canonical } = resolveRoute(route, u.role, own, apps);
  // Wrong or forbidden address (e.g. a staff member typing #/): replace it, so Back never returns to it.
  useEffect(() => { if (route !== canonical) location.replace('#/' + canonical); }, [route, canonical]);

  const orgKeys = Object.keys(ORG_PAGES).filter(k => ORG_PAGES[k].roles.includes(u.role));
  // Keep the owner's operational areas in one predictable workspace navigation.
  // Department heads see the areas assigned to them plus the shared coordination tools.
  const operationalKeys = (Object.keys(APP_VIEWS) as string[]).filter(k => apps.includes(k));
  useEffect(() => { setOperationsOpen(operationalKeys.includes(key)); }, [key]);
  const showWorkspaceNav = u.role === 'owner' || u.role === 'dept_head';
  const view = key === 'support' ? <OtherDept /> : key === 'accommodation' ? <Accommodation /> : key === 'inventory' ? <InventoryApp /> : key === 'walkie' ? <Walkie embedded /> : has(APP_VIEWS, key) ? React.createElement(APP_VIEWS[key][0]) : ORG_PAGES[key].render(tab);
  const title = key === 'support' ? 'IT Support' : has(APP_VIEWS, key) ? DEPTS[key as keyof typeof DEPTS] : ORG_PAGES[key].label;

  const Item = ({ id, label, Icon, badge = 0 }: { id: string; label: string; Icon: any; badge?: number }) => (
    <a href={'#/' + id} onClick={() => setOpen(false)} title={label} aria-label={label} aria-current={key === id ? 'page' : undefined}
      className={`relative flex min-h-10 items-center ${collapsed ? 'md:justify-center md:px-0' : ''} gap-3 px-3 py-2.5 rounded-md text-sm transition-colors ${key === id ? 'bg-blue-600 text-white font-semibold' : 'text-mute hover:bg-raised hover:text-ink'}`}>
      <Icon size={17} className="shrink-0" /><span className={`truncate flex-1 ${collapsed ? 'md:hidden' : ''}`}>{label}</span>{badge > 0 && <span title={`${badge} notifications`} aria-label="Notifications" className={`h-2 w-2 shrink-0 rounded-full bg-amber-400 ${collapsed ? 'md:absolute md:right-1.5 md:top-1.5' : ''}`} />}</a>
  );
  const Label = ({ t }: { t: string }) => <div className={`${collapsed ? 'px-3 pt-5 pb-1.5 md:px-2 md:pt-3 md:pb-1' : 'px-3 pt-5 pb-1.5'} text-[10px] font-semibold uppercase tracking-wider text-faint`}>{collapsed ? <><span className="md:hidden">{t}</span><span className="hidden md:block h-px bg-line" /></> : t}</div>;
  const orgLabel = u.role === 'owner' ? 'Organization' : 'IT Department';
  const showSupport = u.role === 'volunteer' || home === 'support';
  const hasNav = showWorkspaceNav || orgKeys.length > 0 || showSupport; // department staff go straight to their app: nothing to list
  return (
    <div className="flex h-screen bg-canvas text-ink">
      {hasNav && open && <div className="md:hidden fixed inset-0 z-30 bg-black/50" onClick={() => setOpen(false)} />}
      {hasNav && <aside className={`print:hidden ${open ? 'flex' : 'hidden'} md:flex fixed md:static inset-y-0 left-0 z-40 ${collapsed ? 'md:w-20' : operationsOpen ? 'md:w-72' : 'md:w-60'} w-60 shrink-0 min-h-0 flex-col border border-line bg-surface p-2 shadow-sm md:my-3 md:ml-3 md:mr-0 md:h-[calc(100vh-1.5rem)] md:rounded-xl transition-[width] duration-200`}>
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
            <Label t="Operations Management" />
            <div onMouseLeave={() => { if (!operationalKeys.includes(key)) setOperationsOpen(false); }}>
              <button type="button" onMouseEnter={() => setOperationsOpen(true)} onFocus={() => setOperationsOpen(true)} aria-expanded={operationsOpen} className={`flex min-h-10 w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm font-semibold transition-colors ${operationalKeys.includes(key) ? 'bg-blue-600/10 text-blue-300' : 'text-mute hover:bg-raised hover:text-ink'}`}>
                <Monitor size={17} className="shrink-0" /><span className={`flex-1 truncate ${collapsed ? 'md:hidden' : ''}`}>Operations</span><ChevronDown size={15} className={`shrink-0 transition-transform ${operationsOpen ? 'rotate-180' : ''} ${collapsed ? 'md:hidden' : ''}`} />
              </button>
              {operationsOpen && operationalKeys.map(k => <div key={k} className="md:ml-3 md:border-l md:border-line md:pl-2"><Item id={k} label={DEPTS[k as keyof typeof DEPTS]} Icon={APP_VIEWS[k][1]} badge={k === 'purchase' ? proc.total : 0} /></div>)}
            </div>
          </>}
          {orgKeys.some(k => ['requests','meetings','users','reports'].includes(k)) && <><Label t="Coordination" />{orgKeys.filter(k => ['requests','meetings'].includes(k)).map(k => <Item key={k} id={k} label={ORG_PAGES[k].label} Icon={ORG_PAGES[k].icon} badge={k === 'requests' ? actionCount : 0} />)}</>}
          {orgKeys.some(k => ['users','reports'].includes(k)) && <><Label t="Administration" />{orgKeys.filter(k => ['users','reports'].includes(k)).map(k => <Item key={k} id={k} label={ORG_PAGES[k].label} Icon={ORG_PAGES[k].icon} />)}</>}
          {showSupport && <><Label t="Help" /><Item id="support" label="IT Support" Icon={LifeBuoy} /></>}
        </nav>
      </aside>}
      <div className="flex-1 flex flex-col min-w-0 md:my-3 md:mr-3 md:min-h-0 md:overflow-hidden md:rounded-xl md:border md:border-line">
        <header className="print:hidden h-14 shrink-0 flex items-center justify-between gap-3 px-5 border-b border-line bg-surface">
          <div className="flex items-center gap-3 min-w-0">
            {hasNav && <button className="md:hidden p-2 -ml-2 rounded-lg text-mute hover:bg-raised" onClick={() => setOpen(!open)} aria-label="Open menu"><Menu size={18} /></button>}
            {!hasNav && home !== 'requests' && (key === 'meetings' || key === 'requests') && <a href={'#/' + home} className="text-sm text-blue-400 hover:underline shrink-0">← Back</a>}
            <div className="min-w-0"><div className="hidden sm:block text-[10px] font-semibold uppercase tracking-wider text-faint">{u.role === 'owner' ? 'Organization workspace' : u.role === 'dept_head' ? 'IT department' : u.designation}</div><h1 className="text-base font-semibold text-ink truncate">{title}</h1></div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="hidden sm:block mr-1"><LiveMealChip dark={isDark} /></span>
            <ProfileMenu />
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 sm:p-6"><div className="w-full max-w-[1600px] mx-auto">{view}</div></main>
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
    <WalkieProvider><MeetingsProvider><AppProvider><AccessProvider><AccommodationProvider><ManpowerProvider><InventoryProvider><PurchaseProvider><RequestsProvider>
      <Gate />
    </RequestsProvider></PurchaseProvider></InventoryProvider></ManpowerProvider></AccommodationProvider></AccessProvider></AppProvider></MeetingsProvider></WalkieProvider>
  );
}
