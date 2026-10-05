import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { ProfileMenu } from '../../../components/ProfileMenu';
import { Search, Menu, LogOut, Database, RotateCcw, ClipboardList } from 'lucide-react';

export default function Topbar({ extra = null }) {
  const {
    settings,
    globalSearch,
    setGlobalSearch,
    setCurrentTab,
    currentTab,
    currentUser,
    logout,
    clearAllData,
    resetAllData
  } = useApp();
  const isAdmin = currentUser?.role === 'Admin';

  const [showMobileMenu, setShowMobileMenu] = useState(false);

  const isDark = settings.theme === 'dark';
  const isClient = currentUser?.role === 'Client';

  // Mobile Sidebar Menu
  const menuItems = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'walkies', label: 'Walkie Talkies' },
    { id: 'departments', label: 'Departments' },
    ...(!isClient ? [
      { id: 'allocation', label: 'Allocations' },
      { id: 'returns', label: 'Returns' },
      { id: 'maintenance', label: 'Maintenance' },
    ] : []),
    { id: 'history', label: 'Activity History' },
    ...(!isClient && currentUser?.role === 'Admin' ? [{ id: 'users', label: 'Team & Users' }] : []),
  ];

  return (
    <header className={`h-14 border-b px-3 md:px-6 flex items-center justify-between z-20 transition-colors duration-300 
      ${isDark ? 'bg-slate-950 border-slate-800 text-slate-100' : 'bg-white border-slate-100 text-slate-800'}`}>
      
      {/* Left: Mobile Menu Trigger & Title */}
      <div className="flex items-center gap-3">
        <button 
          onClick={() => setShowMobileMenu(!showMobileMenu)} 
          className="lg:hidden p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <Menu className="w-5 h-5" />
        </button>
        <div className="hidden md:block">
          <h2 className="text-lg font-semibold tracking-tight capitalize">
            {currentTab.replace('-', ' ')} Overview
          </h2>
          <p className="text-xs text-slate-400">Manage and monitor radio assets</p>
        </div>
      </div>

      {/* Center: Global Search Bar */}
      <div className="flex-1 min-w-0 max-w-sm mx-3">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search serial, walkie ID, model..."
            value={globalSearch}
            onChange={(e) => setGlobalSearch(e.target.value)}
            className={`w-full pl-9 pr-4 py-2 text-sm rounded-full border outline-none transition-all
              ${isDark 
                ? 'bg-slate-900 border-slate-800 text-slate-100 placeholder-slate-500 focus:border-blue-500' 
                : 'bg-slate-100 border-slate-200 text-slate-800 placeholder-slate-400 focus:bg-white focus:border-blue-500'}`}
          />
        </div>
      </div>

      {/* Right: Quick Controls */}
      <div className="flex items-center gap-1.5 md:gap-3 shrink min-w-0">
        
        {extra ? <div className="min-w-0 hidden sm:block">{extra}</div> : null}

        <a href="#/requests" className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold text-blue-400 hover:bg-blue-500/10 whitespace-nowrap" aria-label="Open material requests">
          <ClipboardList className="w-4 h-4" /><span className="hidden sm:inline">Requests</span>
        </a>

        {/* Account menu: Command Center, theme, admin data tools, Sign out */}
        <ProfileMenu extra={isAdmin ? (
          <>
            <button
              onClick={() => { if (window.confirm('Clear ALL departments, walkies and allocations to start fresh?')) clearAllData(); }}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left text-rose-500 hover:bg-rose-500/10"
            >
              <Database className="w-4 h-4" />Clear all data
            </button>
            <button
              onClick={() => { if (window.confirm('Restore default demo data?')) resetAllData(); }}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left text-ink-soft hover:bg-raised"
            >
              <RotateCcw className="w-4 h-4 text-slate-400" />Restore demo data
            </button>
          </>
        ) : null} />
      </div>

      {/* Mobile Drawer Menu */}
      {showMobileMenu && (
        <div className="fixed inset-0 bg-black/55 z-40 lg:hidden" onClick={() => setShowMobileMenu(false)}>
          <div 
            className={`w-64 h-full p-6 flex flex-col justify-between transition-transform duration-200 
              ${isDark ? 'bg-slate-900 text-slate-100' : 'bg-white text-slate-800'}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <div className="flex items-center gap-3 mb-8">
                <span className="text-3xl">{settings.logo}</span>
                <h1 className="font-bold text-md tracking-wide uppercase">{settings.orgName}</h1>
              </div>
              <nav className="space-y-2">
                {menuItems.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      setCurrentTab(item.id);
                      setShowMobileMenu(false);
                    }}
                    className={`w-full text-left px-4 py-2.5 rounded-lg text-sm font-medium transition-colors
                      ${currentTab === item.id 
                        ? 'bg-blue-600 text-white' 
                        : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-300'}`}
                  >
                    {item.label}
                  </button>
                ))}
              </nav>
            </div>
            <div className="space-y-3">
              <button
                onClick={() => { setShowMobileMenu(false); logout(); }}
                className="w-full py-2 bg-rose-600 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-2"
              >
                <LogOut className="w-4 h-4" />
                Sign Out
              </button>
              <div className="text-xs text-slate-400 border-t pt-4">
                Logged in as <span className="font-semibold">{currentUser?.name}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
