import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { LayoutDashboard, Radio, Building2, Send, RotateCcw, Wrench, History, Users, ChevronsLeft, ChevronsRight } from 'lucide-react';

export default function Sidebar() {
  const { currentTab, setCurrentTab, settings, currentUser, allProfiles } = useApp();
  const [folded, setFolded] = useState(() => localStorage.getItem('wt_sidebar_folded') === '1');
  const toggle = () => setFolded(f => { localStorage.setItem('wt_sidebar_folded', f ? '0' : '1'); return !f; });
  const isDark = settings.theme === 'dark';
  const isAdmin = currentUser?.role === 'Admin';
  const isClient = currentUser?.role === 'Client';

  const items = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'walkies', label: 'Walkie Talkies', icon: Radio },
    { id: 'departments', label: 'Departments', icon: Building2 },
    ...(!isClient ? [
      { id: 'allocation', label: 'Allocations', icon: Send },
      { id: 'returns', label: 'Returns', icon: RotateCcw },
      { id: 'maintenance', label: 'Maintenance', icon: Wrench },
    ] : []),
    { id: 'history', label: 'Activity History', icon: History },
    ...(isAdmin ? [{ id: 'users', label: 'Team & Users', icon: Users }] : []),
  ];
  // Users now live inside Settings — surface pending sign-up requests there.
  const pendingCount = isAdmin ? allProfiles.filter(p => !p.approved && p.isActive).length : 0;
  const line = isDark ? 'border-slate-800' : 'border-slate-100';

  return (
    <aside className={`${folded ? 'w-16' : 'w-64'} h-screen hidden lg:flex flex-col border-r shrink-0 transition-all duration-200 ${isDark ? 'bg-slate-950 border-slate-800 text-slate-200' : 'bg-white border-slate-200 text-slate-800'}`}>
      <div className={`h-16 px-4 border-b flex items-center ${folded ? 'justify-center' : 'justify-between'} ${line}`}>
        {!folded && (
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-2xl">{settings.logo || '📻'}</span>
            <h1 className="font-bold text-sm uppercase truncate">{settings.orgName}</h1>
          </div>
        )}
        <button onClick={toggle} title={folded ? 'Expand' : 'Fold'} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-500/10">
          {folded ? <ChevronsRight className="w-5 h-5" /> : <ChevronsLeft className="w-5 h-5" />}
        </button>
      </div>
      <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
        {items.map(({ id, label, icon: Icon }) => {
          const on = currentTab === id || (id === 'users' && currentTab === 'settings');
          return (
            <button key={id} onClick={() => setCurrentTab(id)} title={label}
              className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium ${folded ? 'justify-center' : ''} ${on ? 'bg-blue-600 text-white' : isDark ? 'text-slate-400 hover:bg-slate-900 hover:text-slate-100' : 'text-slate-600 hover:bg-slate-100'}`}>
              <span className="relative shrink-0">
                <Icon className="w-5 h-5" />
                {id === 'users' && pendingCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-500 ring-2 ring-white dark:ring-slate-950" />
                )}
              </span>
              {!folded && <span>{label}</span>}
              {!folded && id === 'users' && pendingCount > 0 && (
                <span className="ml-auto text-xs font-bold px-1.5 py-0.5 rounded-full bg-amber-500 text-white">{pendingCount}</span>
              )}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
