import React, { Suspense, lazy } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import Sidebar from './components/Sidebar';
import Topbar from './components/Topbar';
import ToastContainer from './components/ToastContainer';

// Views are code-split: each tab's JS is only fetched the first time that
// tab is opened, instead of all nine views loading up front on login.
const DashboardView = lazy(() => import('./components/DashboardView'));
const WalkiesView = lazy(() => import('./components/WalkiesView'));
const DepartmentsView = lazy(() => import('./components/DepartmentsView'));
const AllocationsView = lazy(() => import('./components/AllocationsView'));
const ReturnsView = lazy(() => import('./components/ReturnsView'));
const MaintenanceView = lazy(() => import('./components/MaintenanceView'));
const HistoryView = lazy(() => import('./components/HistoryView'));
const SettingsView = lazy(() => import('./components/SettingsView'));
const ServiceInbox = lazy(() => import('../requests/ServiceInbox'));

function ViewLoadingFallback() {
  return (
    <div className="flex items-center justify-center py-24">
      <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
    </div>
  );
}

export function MainLayout({ headerExtra = null, embedded = false }) {
  const { currentTab, settings, currentUser, dataLoading, globalSearch, setGlobalSearch, setCurrentTab } = useApp();

  const renderContent = () => {
    switch (currentTab) {
      case 'dashboard':
        return <DashboardView />;
      case 'walkies':
        return <WalkiesView />;
      case 'departments':
        return <DepartmentsView />;
      case 'allocation':
        return <AllocationsView />;
      case 'returns':
        return <ReturnsView />;
      case 'maintenance':
        return <MaintenanceView />;
      case 'history':
        return <HistoryView />;
      case 'settings':
      case 'users':
        return <SettingsView />;
      case 'requests':
        return <ServiceInbox kind="radio" title="Walkie-Talkie" />;
      default:
        return <DashboardView />;
    }
  };

  // Guard view rendering based on role permissions
  const isClient = currentUser?.role === 'Client';
  const isOperator = currentUser?.role === 'Operator';
  const isAdmin = currentUser?.role === 'Admin';
  const sectionItems = [
    { id: 'dashboard', label: 'Overview' },
    { id: 'walkies', label: 'Walkie devices' },
    { id: 'departments', label: 'Departments' },
    ...(!isClient ? [{ id: 'allocation', label: 'Allocations' }, { id: 'returns', label: 'Returns' }, { id: 'maintenance', label: 'Maintenance' }] : []),
    { id: 'history', label: 'Activity history' },
    { id: 'requests', label: 'Department requests' },
    ...(isAdmin ? [{ id: 'users', label: 'Walkie users' }] : []),
  ];

  if (embedded) return (
    <div className="walkie-embedded space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-mute">Radio assets, allocations, returns and maintenance</p>
        <div className="w-full sm:w-72">
          <input type="search" placeholder="Search serial, walkie ID, model…" value={globalSearch}
            onChange={e => setGlobalSearch(e.target.value)} aria-label="Search walkies"
            className="w-full rounded-md border border-line bg-field px-3 py-2 text-sm text-ink outline-none focus:border-blue-500" />
        </div>
      </div>
      <nav className="flex gap-1 overflow-x-auto border-b border-line" aria-label="Walkie sections">
        {sectionItems.map(({ id, label }) => <button key={id} onClick={() => setCurrentTab(id)} aria-current={currentTab === id ? 'page' : undefined}
          className={`px-3 py-2.5 border-b-2 text-xs font-medium whitespace-nowrap ${currentTab === id ? 'border-blue-600 text-blue-500' : 'border-transparent text-mute hover:text-ink'}`}>{label}</button>)}
      </nav>
      {isOperator && <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">Operator access · administrative changes are restricted.</div>}
      {isClient && <div className="rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-xs text-blue-300">Read-only access.</div>}
      <Suspense fallback={<ViewLoadingFallback />}>
        {dataLoading ? <div className="py-16 text-center text-sm text-mute">Syncing with your database…</div> : renderContent()}
      </Suspense>
    </div>
  );

  return (
    <div className={`h-screen flex overflow-hidden transition-colors duration-300 ${settings.theme === 'dark' ? 'bg-slate-900 text-slate-100' : 'bg-slate-50 text-slate-800'}`}>
      {/* Sidebar */}
      <Sidebar />

      {/* Main Container */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        {/* Topbar */}
        <Topbar extra={headerExtra} />

        {/* Main Content Area */}
        <main className="flex-1 overflow-y-auto p-4 md:p-8">
          {/* Role Indicator Banner for Operators */}
          {isOperator && (
            <div className="mb-6 p-3 bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 rounded-xl text-xs flex items-center justify-between">
              <span>You are logged in as an <strong>Operator</strong>. Administrative operations (deletions, bulk uploads, and global settings) are locked.</span>
              <span className="font-bold uppercase tracking-wider bg-amber-500 text-white px-2 py-0.5 rounded text-xs">Operator Access</span>
            </div>
          )}

          {/* Role Indicator Banner for Clients */}
          {isClient && (
            <div className="mb-6 p-3 bg-blue-500/10 border border-blue-500/20 text-blue-600 dark:text-blue-400 rounded-xl text-xs flex items-center justify-between">
              <span>You are logged in as a <strong>Client/Guest</strong>. You have read-only access to view radio status, departments, and reports. All modifications are disabled.</span>
              <span className="font-bold uppercase tracking-wider bg-blue-500 text-white px-2 py-0.5 rounded text-xs">Read Only</span>
            </div>
          )}

          <Suspense fallback={<ViewLoadingFallback />}>
            {dataLoading ? (
              <div className="flex flex-col items-center justify-center py-24 gap-3 text-slate-400">
                <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                <p className="text-xs font-semibold tracking-wide">Syncing with your Supabase database…</p>
              </div>
            ) : (
              renderContent()
            )}
          </Suspense>
        </main>
      </div>

      {/* Global Notifications */}
      <ToastContainer />
    </div>
  );
}
