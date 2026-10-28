import React, { useEffect, useRef, useState } from 'react';
import { usePermissions } from '../context/PermissionsContext';
import { HelpdeskApp } from '../modules/helpdesk/HelpdeskApp';
import { DutiesShiftsPage } from '../modules/manpower/DutiesShifts';
import { applyTheme } from '../hooks/useMotion';
import {
  Menu,
  X,
  LayoutDashboard,
  CalendarClock,
  CalendarDays,
  Users,
  BarChart3,
  Wifi,
  Monitor,
  Boxes,
  BedDouble,
  HeartHandshake,
  LifeBuoy,
  ClipboardList,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronDown,
  ShoppingCart,
  PhoneCall,
  BadgeCheck,
  UsersRound,
  ListTodo,
  Clock3,
  Headset,
  Radio,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { DEPTS } from '../views/orgData';
import { useWalkie, Walkie, ToastContainer } from '../modules/walkie';
import { Swap } from '../components/Swap';
import { RoyalEmbers } from '../components/RoyalEmbers';
import { ProfileMenu } from '../components/ProfileMenu';
import { HoverSelect } from '../components/HoverSelect';
import { OtherDept } from '../views/Pages';
import { CCTVControlRoomApp } from '../components/apps/CCTVControlRoomApp';
import { InventoryApp } from '../modules/inventory';
import { Accommodation, LiveMealChip } from '../modules/accommodation';
import { AddingToDepartment } from './AddingToDepartment';
import { permanentStaffLabel } from '../lib/roles';
import { ManpowerApp } from '../modules/manpower';
import { AttendancePage } from '../modules/manpower/AttendancePage';
import { useRequests } from '../modules/requests';
import { useEventScope } from '../context/EventScopeContext';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { APP_VIEWS, EVENT_SECTIONS, ORG_PAGES, has, navIndex, resolveRoute, useRoute } from './routes';
import { NavItem, NavLabel, NavSubItem, SideNavCtx } from './nav';

// One theme for the whole app. The setting lives in the Walkie settings (so it is saved and shared with
// Walkie / Accommodation) and is mirrored onto <html class="dark"> so every screen follows it.
const useTheme = () => {
  const w: any = useWalkie();
  const isDark = w.settings?.theme === 'dark';
  const palette = w.settings?.palette;
  useEffect(() => {
    applyTheme(isDark, palette);
  }, [isDark, palette]);
  const toggle = () => w.setSettings?.((p: any) => ({ ...p, theme: p.theme === 'dark' ? 'light' : 'dark' }));
  return { isDark, toggle };
};

export const Shell: React.FC<{ out: () => void }> = ({ out }) => {
  const { currentUser: u, canAccessApp } = useApp();
  const perms = usePermissions();
  const { actionCount } = useRequests();
  const { isDark } = useTheme();
  const wk: any = useWalkie();
  const palette = wk.settings?.palette;
  // Sidebar brand: the organization's name and initials (falls back to the app name while it loads).
  const orgName: string =
    wk.currentOrganization?.name ||
    (wk.settings?.orgName !== 'Apex Security & Logistics' && wk.settings?.orgName) ||
    'Event Command';
  const orgInitials =
    orgName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(word => word[0])
      .join('')
      .toUpperCase() || 'EC';
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
    onMouseEnter: () => {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = window.setTimeout(() => setHoverGroup(id), 150);
    },
    onMouseLeave: () => {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = window.setTimeout(() => setHoverGroup(h => (h === id ? null : h)), 250);
    },
  });
  const isOpen = (id: Group) => openGroup === id || hoverGroup === id;
  const opener = (id: Group) => (v: boolean | ((open: boolean) => boolean)) => {
    const now = isOpen(id);
    const next = typeof v === 'function' ? v(now) : v;
    if (!next) setHoverGroup(h => (h === id ? null : h));
    setOpenGroup(g => (next ? id : g === id ? null : g));
  };
  const operationsOpen = isOpen('operations'),
    setOperationsOpen = opener('operations');
  const eventsOpen = isOpen('events'),
    setEventsOpen = opener('events');
  const volunteerOpen = isOpen('volunteer'),
    setVolunteerOpen = opener('volunteer');
  const stocksOpen = isOpen('stocks'),
    setStocksOpen = opener('stocks');
  const administrationOpen = isOpen('admin'),
    setAdministrationOpen = opener('admin');
  const toggleCollapsed = () =>
    setCollapsed(v => {
      const next = !v;
      try {
        localStorage.setItem('crm_sidebar_collapsed', next ? '1' : '0');
      } catch {
        /* storage can be disabled */
      }
      return next;
    });

  const own = Object.keys(APP_VIEWS).filter(k => canAccessApp(k as any));
  // Everyone signed in can at least VIEW Accommodation (rooms + live menu); editing is limited by role.
  // People without a role yet can still view Accommodation; sub-department roles follow the permission grid.
  const apps = u.role === 'volunteer' && !own.includes('accommodation') ? [...own, 'accommodation'] : own;
  const { key, tab, home, canonical } = resolveRoute(route, u.role, own, apps, u.subDepartmentId, perms.can);
  const scopeModule =
    key === 'sewadars' || key === 'walkie' || key === 'control' || key === 'accommodation' || key === 'wifi'
      ? key
      : key === 'events' || key === 'meetings'
        ? 'event-reports'
        : key === 'cctv-control-room'
          ? 'cctv-control-room'
          : '';
  const headerScopeModule = scopeModule || 'event-reports';
  // The whole page slides only when the sidebar page changes. Events and Sewadars list each tab as its own
  // sidebar page; elsewhere a tab change stays inside the module, so its title, totals and tab bar stay put.
  const pageKey = key === 'events' || key === 'sewadars' ? `${key}/${tab || ''}` : key;
  const activeEventId = eventScope.scopeFor(headerScopeModule);
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [key]);
  // Wrong or forbidden address (e.g. a staff member typing #/): replace it, so Back never returns to it.
  useEffect(() => {
    if (route !== canonical) location.replace('#/' + canonical);
  }, [route, canonical]);

  const orgKeys = Object.keys(ORG_PAGES).filter(k => ORG_PAGES[k].roles.includes(u.role));
  // Split technical operations from volunteer and accommodation management.
  const operationalKeys = (Object.keys(APP_VIEWS) as string[]).filter(k => apps.includes(k));
  const itOperationsKeys = operationalKeys.filter(k => ['cctv', 'wifi', 'walkie', 'control'].includes(k));
  const volunteerManagementKeys = operationalKeys.filter(k => ['accommodation', 'sewadars'].includes(k));
  const isOperationsPage =
    itOperationsKeys.includes(key) ||
    key === 'cctv-control-room' ||
    key === 'networking-support' ||
    key === 'issues' ||
    key === 'helpdesk';
  const isVolunteerManagementPage = key === 'accommodation' || key === 'sewadars' || key === 'tasks';
  // Going to a page opens the group that holds it and folds the others away.
  const activeGroup: Group | null =
    key === 'events'
      ? 'events'
      : isVolunteerManagementPage
        ? 'volunteer'
        : ['inventory', 'requests', 'purchase'].includes(key)
          ? 'stocks'
          : isOperationsPage
            ? 'operations'
            : ['users', 'subdepartments', 'permissions', 'reports'].includes(key)
              ? 'admin'
              : null;
  useEffect(() => {
    setOpenGroup(activeGroup);
  }, [activeGroup]);
  // Mobile drawer: close after choosing a page, and on Escape.
  useEffect(() => {
    setOpen(false);
  }, [key, tab]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  const showWorkspaceNav = u.role === 'owner' || u.role === 'dept_head';
  const canOpenCctvControlRoom = perms.can('cctv-control-room'); // IT department and Super Admin
  // Other departments keep Help Desk and Issues here; the IT services only show for IT and the Super Admin.
  const operationsTitle =
    itOperationsKeys.length > 0 || canOpenCctvControlRoom ? 'IT Services & Operations' : 'Services & Operations';
  const canOpenProcurement = showWorkspaceNav || perms.can('purchase');
  const showSupport = u.role === 'volunteer' || home === 'support';
  const hasNav =
    showWorkspaceNav ||
    orgKeys.length > 0 ||
    canOpenProcurement ||
    showSupport ||
    canOpenCctvControlRoom ||
    u.role !== 'volunteer';
  const view =
    key === 'helpdesk' ? (
      <HelpdeskApp tab={tab} />
    ) : key === 'support' ? (
      <OtherDept />
    ) : key === 'cctv-control-room' ? (
      <CCTVControlRoomApp />
    ) : key === 'accommodation' ? (
      <Accommodation />
    ) : key === 'inventory' ? (
      <InventoryApp />
    ) : key === 'walkie' ? (
      React.createElement(Walkie as any, { embedded: true, initialTab: tab })
    ) : key === 'sewadars' ? (
      tab === 'attendance' ? (
        <AttendancePage />
      ) : tab === 'duties' ? (
        <DutiesShiftsPage />
      ) : (
        <ManpowerApp
          initialSection={
            ['calling', 'roster', 'permanent', 'teams'].includes(tab || '')
              ? (tab as 'calling' | 'roster' | 'permanent' | 'teams')
              : 'roster'
          }
        />
      )
    ) : has(APP_VIEWS, key) ? (
      React.createElement(APP_VIEWS[key][0])
    ) : (
      ORG_PAGES[key].render(tab)
    );
  const title =
    key === 'helpdesk'
      ? 'Help Desk'
      : key === 'support'
        ? 'IT Support'
        : key === 'cctv-control-room'
          ? 'CCTV Control Room'
          : key === 'sewadars'
            ? tab === 'attendance'
              ? 'Attendance'
              : tab === 'duties'
                ? 'Duties & Shifts'
                : tab === 'calling'
                  ? 'Calling'
                  : tab === 'tasks'
                    ? 'Volunteer Tasks'
                    : tab === 'permanent'
                      ? permanentStaffLabel(u.departmentName)
                      : tab === 'teams'
                        ? 'Teams'
                        : 'Sewadar Master'
            : has(APP_VIEWS, key)
              ? DEPTS[key as keyof typeof DEPTS]
              : ORG_PAGES[key].label;

  const Item = NavItem;
  const SubItem = NavSubItem;
  // Children of a group: an indented tree when expanded; a tinted strip of centred icons when collapsed.
  const sub = `mt-1 space-y-0.5 ${collapsed ? 'md:ml-0 md:rounded-lg md:border-l-0 md:bg-raised/40 md:p-0.5 md:pl-0.5' : ''} ml-4 border-l border-line pl-2`;
  // Group header: icon only, centred, when collapsed.
  const head = (active: boolean) =>
    `flex min-h-9 w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13.5px] font-semibold ${collapsed ? 'md:justify-center md:px-0' : ''} ${active ? 'bg-blue-600/10 text-blue-300' : 'text-mute hover:bg-blue-600/10 hover:text-blue-300'}`;
  const Label = NavLabel;
  const orgLabel = u.role === 'owner' ? 'Organization' : 'IT Department';
  return (
    <div className="app-root flex h-screen bg-canvas text-ink">
      {royal && <RoyalEmbers />}
      {hasNav && (
        <div
          aria-hidden="true"
          onClick={() => setOpen(false)}
          className={`md:hidden fixed inset-0 z-30 bg-black/50 transition-opacity duration-200 ease-out ${open ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        />
      )}
      {hasNav && (
        <aside
          {...({ inert: !open && window.matchMedia('(max-width: 767px)').matches } as any)}
          className={`print:hidden flex fixed md:static inset-y-0 left-0 z-40 ${open ? 'translate-x-0 opacity-100' : '-translate-x-full opacity-0 pointer-events-none'} md:translate-x-0 md:opacity-100 md:pointer-events-auto ${collapsed ? 'md:w-16' : 'md:w-72'} w-56 shrink-0 min-h-0 flex-col border border-line bg-surface p-2 md:p-1 shadow-sm md:my-3 md:ml-3 md:mr-3 md:h-[calc(100vh-1.5rem)] md:rounded-xl transition-[width,transform,opacity] duration-200 ease-out`}
        >
          <div
            className={`flex items-center ${collapsed ? 'md:justify-between md:gap-0 md:px-0' : 'gap-2.5'} gap-2.5 min-w-0 px-1 pb-3 border-b border-line`}
          >
            <a
              href="#/"
              title={`${orgName} · Dashboard`}
              aria-label={`${orgName} dashboard`}
              className={`grid place-items-center w-9 h-9 rounded-md bg-blue-600 text-white text-xs font-bold shrink-0 overflow-hidden ${collapsed ? 'md:h-7 md:w-7' : ''}`}
            >
              {wk.currentOrganization?.logoUrl ? (
                <img
                  src={wk.currentOrganization.logoUrl}
                  alt=""
                  className="h-full w-full rounded-md object-contain bg-white"
                />
              ) : (
                orgInitials
              )}
            </a>
            <span className={`min-w-0 flex-1 ${collapsed ? 'md:hidden' : ''}`}>
              <span
                className="block text-[13.5px] font-semibold leading-snug text-ink line-clamp-2 break-words"
                title={orgName}
              >
                {orgName}
              </span>
              <span className="block text-[10.5px] text-faint truncate">IT OPERATIONS</span>
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-mute hover:bg-raised hover:text-ink md:hidden"
              title="Close menu"
              aria-label="Close menu"
            >
              <X size={18} />
            </button>
            <button
              type="button"
              onClick={toggleCollapsed}
              className="hidden h-7 w-7 place-items-center rounded-md text-mute hover:bg-blue-600/10 hover:text-blue-300 md:grid md:h-6 md:w-6"
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </button>
          </div>
          <SideNavCtx.Provider value={{ active: key, collapsed }}>
            <nav
              className="sidebar-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain rounded-lg"
              aria-label="Main"
            >
              {showWorkspaceNav && (
                <>
                  {u.role === 'owner' && (
                    <>
                      <Label t="Workspace" />
                      <Item id="" label="Dashboard" Icon={LayoutDashboard} />
                    </>
                  )}
                  {u.role === 'dept_head' && (
                    <>
                      <Label t="Workspace" />
                      <Item id="overview" label="Department overview" Icon={LayoutDashboard} />
                    </>
                  )}
                  {orgKeys.includes('events') && (
                    <>
                      <Label t="Coordination" />
                      <div className="mb-1" {...hoverProps('events')}>
                        <div
                          className={`flex min-h-9 items-center rounded-md text-[13.5px] font-semibold ${key === 'events' ? 'bg-blue-600/10 text-blue-300' : 'text-mute hover:bg-blue-600/10 hover:text-blue-300'}`}
                        >
                          <a
                            href="#/events/event-creation"
                            onClick={() => setEventsOpen(true)}
                            title={ORG_PAGES.events.label}
                            aria-label={ORG_PAGES.events.label}
                            aria-current={key === 'events' ? 'page' : undefined}
                            className={`flex min-h-9 min-w-0 flex-1 items-center gap-2.5 rounded-md px-2.5 py-1.5 ${collapsed ? 'md:justify-center md:px-0' : ''}`}
                          >
                            <CalendarDays size={16} className="shrink-0" />
                            <span className={`truncate ${collapsed ? 'md:hidden' : ''}`}>{ORG_PAGES.events.label}</span>
                          </a>
                          <button
                            type="button"
                            onClick={() => setEventsOpen(value => !value)}
                            aria-label={eventsOpen ? 'Collapse event sections' : 'Expand event sections'}
                            aria-expanded={eventsOpen}
                            className={`grid h-7 w-7 shrink-0 place-items-center rounded-md hover:bg-blue-600/10 ${collapsed ? 'md:hidden' : ''}`}
                          >
                            <ChevronDown
                              size={13}
                              className={`transition-transform ${eventsOpen ? 'rotate-180' : ''}`}
                            />
                          </button>
                        </div>
                        <div
                          aria-hidden={!eventsOpen}
                          {...({ inert: !eventsOpen } as any)}
                          className={`grid transition-[grid-template-rows,opacity] duration-200 ${eventsOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0 pointer-events-none'}`}
                        >
                          <div className="min-h-0 overflow-hidden">
                            <div className={sub}>
                              {EVENT_SECTIONS.map(([id, label, Icon]) => (
                                <SubItem
                                  key={id}
                                  href={`#/events/${id}`}
                                  label={label}
                                  Icon={Icon}
                                  active={key === 'events' && tab === id}
                                />
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                  <section className="mt-1" {...hoverProps('volunteer')}>
                    <button
                      type="button"
                      title="Volunteer Management"
                      aria-label="Volunteer Management"
                      aria-expanded={volunteerOpen}
                      onClick={() => setVolunteerOpen(v => !v)}
                      className={head(isVolunteerManagementPage)}
                    >
                      <HeartHandshake size={16} className="shrink-0" />
                      <span className={`flex-1 truncate text-left ${collapsed ? 'md:hidden' : ''}`}>
                        Volunteer Management
                      </span>
                      <ChevronDown
                        size={14}
                        className={`shrink-0 transition-transform ${volunteerOpen ? 'rotate-180' : ''} ${collapsed ? 'md:hidden' : ''}`}
                      />
                    </button>
                    <div
                      className={`overflow-hidden transition-[max-height,opacity] duration-200 ease-in-out ${volunteerOpen ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'}`}
                    >
                      <div className={sub}>
                        {volunteerManagementKeys.includes('accommodation') && (
                          <Item id="accommodation" label="Accommodation" Icon={BedDouble} />
                        )}
                        {volunteerManagementKeys.includes('sewadars') && (
                          <>
                            <SubItem
                              href="#/sewadars/roster"
                              label="Sewadar Master"
                              Icon={Users}
                              active={key === 'sewadars' && (tab === 'roster' || !tab)}
                            />
                            <SubItem
                              href="#/sewadars/permanent"
                              label={permanentStaffLabel(u.departmentName)}
                              Icon={BadgeCheck}
                              active={key === 'sewadars' && tab === 'permanent'}
                            />
                            <SubItem
                              href="#/sewadars/calling"
                              label="Calling"
                              Icon={PhoneCall}
                              active={key === 'sewadars' && tab === 'calling'}
                            />
                            <SubItem
                              href="#/sewadars/attendance"
                              label="Attendance"
                              Icon={CalendarClock}
                              active={key === 'sewadars' && tab === 'attendance'}
                            />
                            <SubItem
                              href="#/sewadars/duties"
                              label="Duties & Shifts"
                              Icon={Clock3}
                              active={key === 'sewadars' && tab === 'duties'}
                            />
                            <SubItem
                              href="#/sewadars/teams"
                              label="Teams"
                              Icon={UsersRound}
                              active={key === 'sewadars' && tab === 'teams'}
                            />
                          </>
                        )}
                        <Item id="tasks" label="Tasks" Icon={ListTodo} />
                      </div>
                    </div>
                  </section>
                  {(operationalKeys.includes('inventory') ||
                    orgKeys.includes('requests') ||
                    orgKeys.includes('my-walkies') ||
                    canOpenProcurement) && (
                    <section className="mt-1" {...hoverProps('stocks')}>
                      <button
                        type="button"
                        title="Stocks and Approvals"
                        aria-label="Stocks and Approvals"
                        aria-expanded={stocksOpen}
                        onClick={() => setStocksOpen(value => !value)}
                        className={head(['inventory', 'requests', 'my-walkies', 'purchase'].includes(key))}
                      >
                        <Boxes size={16} className="shrink-0" />
                        <span className={`flex-1 truncate text-left ${collapsed ? 'md:hidden' : ''}`}>
                          Stocks and Approvals
                        </span>
                        <ChevronDown
                          size={14}
                          className={`shrink-0 transition-transform ${stocksOpen ? 'rotate-180' : ''} ${collapsed ? 'md:hidden' : ''}`}
                        />
                      </button>
                      <div
                        className={`overflow-hidden transition-[max-height,opacity] duration-200 ease-in-out ${stocksOpen ? 'max-h-64 opacity-100' : 'max-h-0 opacity-0'}`}
                      >
                        <div className={sub}>
                          {operationalKeys.includes('inventory') && (
                            <Item id="inventory" label="Inventory" Icon={Boxes} />
                          )}
                          {orgKeys.includes('requests') && (
                            <Item id="requests" label="Requests" Icon={ClipboardList} badge={actionCount} />
                          )}
                          {orgKeys.includes('my-walkies') && <Item id="my-walkies" label="Walkies" Icon={Radio} />}
                          {canOpenProcurement && <Item id="purchase" label="Procurement" Icon={ShoppingCart} />}
                        </div>
                      </div>
                    </section>
                  )}
                  {
                    <section className="mt-1" {...hoverProps('operations')}>
                      <button
                        type="button"
                        title={operationsTitle}
                        aria-label={operationsTitle}
                        aria-expanded={operationsOpen}
                        onClick={() => setOperationsOpen(value => !value)}
                        className={head(isOperationsPage)}
                      >
                        <Monitor size={16} className="shrink-0" />
                        <span className={`flex-1 truncate text-left ${collapsed ? 'md:hidden' : ''}`}>
                          {operationsTitle}
                        </span>
                        <ChevronDown
                          size={14}
                          className={`shrink-0 transition-transform ${operationsOpen ? 'rotate-180' : ''} ${collapsed ? 'md:hidden' : ''}`}
                        />
                      </button>
                      <div
                        className={`overflow-hidden transition-[max-height,opacity] duration-200 ease-in-out ${operationsOpen ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'}`}
                      >
                        <div className={sub}>
                          <Item id="helpdesk" label="Help Desk" Icon={Headset} />
                          {itOperationsKeys.map(k => (
                            <Item key={k} id={k} label={DEPTS[k as keyof typeof DEPTS]} Icon={APP_VIEWS[k][1]} />
                          ))}
                          {canOpenCctvControlRoom && (
                            <Item id="cctv-control-room" label="CCTV Control Room" Icon={Monitor} />
                          )}
                          {perms.can('networking-support') && (
                            <Item id="networking-support" label="Networking Support · Coming Soon" Icon={Wifi} />
                          )}
                          {orgKeys.includes('issues') && (
                            <Item id="issues" label="Issues & Reports" Icon={ClipboardList} />
                          )}
                        </div>
                      </div>
                    </section>
                  }
                </>
              )}
              {!showWorkspaceNav && u.role !== 'volunteer' && (
                <>
                  <Label
                    t={
                      u.subDepartmentId
                        ? `My modules · ${DEPTS[u.subDepartmentId as keyof typeof DEPTS]}`
                        : 'My modules'
                    }
                  />
                  {own
                    .filter(k => k !== 'sewadars')
                    .map(k => (
                      <Item key={k} id={k} label={DEPTS[k as keyof typeof DEPTS]} Icon={APP_VIEWS[k][1]} />
                    ))}
                  {canOpenCctvControlRoom && <Item id="cctv-control-room" label="CCTV Control Room" Icon={Monitor} />}
                  {own.includes('sewadars') && (
                    <div className="space-y-0.5">
                      {perms.can('sewadars:roster') && (
                        <SubItem
                          href="#/sewadars/roster"
                          label="Sewadar Master"
                          Icon={Users}
                          active={key === 'sewadars' && (tab === 'roster' || !tab)}
                        />
                      )}
                      {perms.can('sewadars:permanent') && (
                        <SubItem
                          href="#/sewadars/permanent"
                          label={permanentStaffLabel(u.departmentName)}
                          Icon={BadgeCheck}
                          active={key === 'sewadars' && tab === 'permanent'}
                        />
                      )}
                      {perms.can('sewadars:calling') && (
                        <SubItem
                          href="#/sewadars/calling"
                          label="Calling"
                          Icon={PhoneCall}
                          active={key === 'sewadars' && tab === 'calling'}
                        />
                      )}
                      {perms.can('sewadars:attendance') && (
                        <SubItem
                          href="#/sewadars/attendance"
                          label="Attendance"
                          Icon={CalendarClock}
                          active={key === 'sewadars' && tab === 'attendance'}
                        />
                      )}
                      {perms.can('sewadars:duties') && (
                        <SubItem
                          href="#/sewadars/duties"
                          label="Duties & Shifts"
                          Icon={Clock3}
                          active={key === 'sewadars' && tab === 'duties'}
                        />
                      )}
                      {perms.can('sewadars:teams') && (
                        <SubItem
                          href="#/sewadars/teams"
                          label="Teams"
                          Icon={UsersRound}
                          active={key === 'sewadars' && tab === 'teams'}
                        />
                      )}
                    </div>
                  )}
                  {canOpenProcurement && <Item id="purchase" label="Procurement" Icon={ShoppingCart} />}
                  <Label t="Shared" />
                  {perms.can('helpdesk') && <Item id="helpdesk" label="Help Desk" Icon={Headset} />}
                  {perms.can('requests') && (
                    <Item id="requests" label="Requests" Icon={ClipboardList} badge={actionCount} />
                  )}
                  {perms.can('tasks') && <Item id="tasks" label="Tasks" Icon={ListTodo} />}
                  {perms.can('events') && <Item id="events" label="Event Planning" Icon={CalendarDays} />}
                  {perms.can('meetings') && <Item id="meetings" label="Meetings & Emergency" Icon={CalendarClock} />}
                  {perms.can('issues') && <Item id="issues" label="Issues & Reports" Icon={ClipboardList} />}
                  {perms.can('networking-support') && (
                    <Item id="networking-support" label="Networking Support" Icon={Wifi} />
                  )}
                  {perms.can('reports') && <Item id="reports" label="Reports" Icon={BarChart3} />}
                </>
              )}
              {orgKeys.some(k => ['users', 'reports'].includes(k)) && (
                <section className="mt-1" {...hoverProps('admin')}>
                  <button
                    type="button"
                    title="Administration"
                    aria-label="Administration"
                    aria-expanded={administrationOpen}
                    onClick={() => setAdministrationOpen(value => !value)}
                    className={head(['users', 'subdepartments', 'permissions', 'reports'].includes(key))}
                  >
                    <Users size={16} className="shrink-0" />
                    <span className={`flex-1 truncate text-left ${collapsed ? 'md:hidden' : ''}`}>Administration</span>
                    <ChevronDown
                      size={14}
                      className={`shrink-0 transition-transform ${administrationOpen ? 'rotate-180' : ''} ${collapsed ? 'md:hidden' : ''}`}
                    />
                  </button>
                  <div
                    className={`overflow-hidden transition-[max-height,opacity] duration-200 ease-in-out ${administrationOpen ? 'max-h-64 opacity-100' : 'max-h-0 opacity-0'}`}
                  >
                    <div className={sub}>
                      {orgKeys
                        .filter(k => ['users', 'subdepartments', 'permissions', 'reports'].includes(k))
                        .map(k => (
                          <Item
                            key={k}
                            id={k}
                            label={k === 'users' ? 'Manage User Access' : ORG_PAGES[k].label}
                            Icon={ORG_PAGES[k].icon}
                          />
                        ))}
                    </div>
                  </div>
                </section>
              )}
              {!showWorkspaceNav && u.role === 'volunteer' && (
                <>
                  <Label t="Help" />
                  <Item id="helpdesk" label="Help Desk" Icon={Headset} />
                  {showSupport && <Item id="support" label="IT Support" Icon={LifeBuoy} />}
                </>
              )}
            </nav>
          </SideNavCtx.Provider>
        </aside>
      )}
      <div className="app-frame flex-1 flex flex-col min-w-0 md:my-3 md:mr-3 md:min-h-0 md:overflow-hidden md:rounded-xl md:border md:border-line">
        <header
          className={`app-header print:hidden h-14 shrink-0 flex items-center justify-between gap-2 px-3 sm:gap-3 sm:px-5 bg-surface ${key === 'requests' ? '' : 'border-b border-line'}`}
        >
          <div className="flex items-center gap-3 min-w-0">
            {hasNav && (
              <button
                className="md:hidden p-2 -ml-2 rounded-lg text-mute hover:bg-raised"
                onClick={() => setOpen(!open)}
                aria-label="Open menu"
              >
                <Menu size={18} />
              </button>
            )}
            {!hasNav && home !== 'requests' && (key === 'meetings' || key === 'requests') && (
              <a href={'#/' + home} className="text-sm text-blue-400 hover:underline shrink-0">
                ← Back
              </a>
            )}
            <div className="min-w-0">
              <div
                className="hidden sm:block truncate text-[10.5px] font-semibold uppercase tracking-wider text-faint"
                title={u.designation}
              >
                {u.designation}
              </div>
              <h1 className="page-title text-base font-semibold text-ink truncate">{title}</h1>
            </div>
          </div>
          <div className="flex min-w-0 items-center gap-1 sm:gap-1.5">
            <AddingToDepartment dark={isDark} />
            {eventScope.events.length > 0 && (
              <div className="flex min-w-0 items-center gap-1.5 rounded-full border border-line bg-raised/60 px-2 py-1.5 text-[11.5px] text-mute sm:gap-2 sm:px-3 sm:text-xs">
                <span className="hidden whitespace-nowrap sm:inline">Working on</span>
                <HoverSelect
                  label="Event in focus"
                  value={activeEventId}
                  options={[['', 'Normal'], ...eventScope.events.map(event => [event.id, event.name] as const)]}
                  onChange={id => eventScope.setScopeFor(headerScopeModule, id)}
                  className="max-w-[28vw] rounded-md py-0.5 pl-1 font-semibold text-ink outline-none focus-visible:ring-1 focus-visible:ring-blue-500 sm:max-w-[22rem]"
                />
              </div>
            )}
            <span className="hidden sm:block mr-1">
              <LiveMealChip dark={isDark} />
            </span>
            <ProfileMenu />
          </div>
        </header>
        <main ref={mainRef} className="flex-1 overflow-y-auto [scrollbar-gutter:stable] p-4 sm:p-6">
          <Swap k={pageKey} indexOf={navIndex} className="w-full max-w-[1600px] mx-auto">
            <ErrorBoundary page key={pageKey} resetKey={`${key}/${tab || ''}`}>
              {view}
            </ErrorBoundary>
          </Swap>
        </main>
      </div>
      <ToastContainer />
    </div>
  );
};
