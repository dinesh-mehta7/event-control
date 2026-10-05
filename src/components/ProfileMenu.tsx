import React, { useEffect, useRef, useState } from 'react';
import { User, LayoutDashboard, Sun, Moon, LogOut } from 'lucide-react';
import { useApp as useWalkie } from '../modules/walkie/context/AppContext';
import { HeaderTools } from './HeaderTools';

// The one account menu for every screen: a round icon button at the top right.
// Click to open; click outside / Esc to close. Screens can pass extra items (e.g. admin tools) as children.
const LEVEL: Record<string, string> = { owner: 'Organization Head', dept_head: 'IT Department Head', sub_dept_head: 'Sub-department Head', staff: 'Staff' };

export const ProfileMenu: React.FC<{ extra?: React.ReactNode }> = ({ extra }) => {
  const w: any = useWalkie();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const u = w.currentUser;
  const isDark = w.settings?.theme === 'dark';
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  const item = 'w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left text-ink-soft hover:bg-raised transition-colors';
  return (
    <div className="flex items-center">
    <HeaderTools />
    <div ref={box} className="relative">
      <button onClick={() => setOpen(o => !o)} aria-label="Account menu" aria-haspopup="menu" aria-expanded={open} title="Account"
        className={`grid place-items-center w-9 h-9 rounded-full border transition-colors ${open ? 'bg-blue-600 border-blue-600 text-white' : 'bg-raised border-line text-ink-soft hover:border-line-strong hover:text-ink'}`}>
        <User size={17} />
      </button>
      {open && (
        <div role="menu" className="animate-pop-in absolute right-0 top-full mt-2 z-50 w-64 rounded-xl border border-line bg-surface shadow-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-line">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm font-semibold text-ink truncate">{u?.name || 'Account'}</span>
              {(LEVEL[u?.level] || u?.role) && <span className="shrink-0 text-xs font-medium px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-400">{LEVEL[u?.level] || u?.role}</span>}
            </div>
            {u?.email && <div className="text-xs text-mute truncate">{u.email}</div>}
          </div>
          {(u?.level === 'owner' || u?.level === 'dept_head') && <a role="menuitem" href="#/" onClick={() => setOpen(false)} className={item}><LayoutDashboard size={16} className="text-blue-400" />Command Center</a>}
          <button role="menuitem" onClick={() => w.setSettings?.((p: any) => ({ ...p, theme: p.theme === 'dark' ? 'light' : 'dark' }))} className={item}>
            {isDark ? <Sun size={16} className="text-amber-400" /> : <Moon size={16} className="text-blue-400" />}
            <span className="flex-1">{isDark ? 'Light theme' : 'Dark theme'}</span>
          </button>
          {extra && <div className="border-t border-line" onClick={() => setOpen(false)}>{extra}</div>}
          <button role="menuitem" onClick={() => { setOpen(false); w.logout?.(); }} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm font-semibold text-left text-red-400 hover:bg-red-500/10 border-t border-line transition-colors"><LogOut size={16} />Sign out</button>
        </div>
      )}
    </div>
    </div>
  );
};
