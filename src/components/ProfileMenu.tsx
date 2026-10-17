import React, { useEffect, useRef, useState } from 'react';
import { roleLabel } from '../lib/roles';
import { User, LayoutDashboard, Sun, Moon, Crown, LogOut } from 'lucide-react';
import { settingsFor, themeChoiceOf, type ThemeChoice } from '../hooks/useMotion';
import { useApp as useWalkie } from '../modules/walkie/context/AppContext';
import { HeaderTools } from './HeaderTools';
import { useAnimatedPresence } from '../hooks/useAnimatedPresence';

// The one account menu for every screen: a round icon button at the top right.
// Click to open; click outside / Esc to close. Screens can pass extra items (e.g. admin tools) as children.

export const ProfileMenu: React.FC<{ extra?: React.ReactNode }> = ({ extra }) => {
  const w: any = useWalkie();
  const [open, setOpen] = useState(false);
  const present = useAnimatedPresence(open);
  const box = useRef<HTMLDivElement>(null);
  const u = w.currentUser;
  const choice = themeChoiceOf(w.settings);
  const pick = (c: ThemeChoice) => w.setSettings?.((p: any) => ({ ...p, ...settingsFor(c) }));
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
      {present && (
        <div role="menu" aria-hidden={!open} {...({ inert: !open } as any)} className={`absolute right-0 top-full mt-2 z-50 w-64 rounded-xl border border-line bg-surface shadow-xl overflow-hidden transition-[opacity,transform] duration-200 ease-out ${open ? 'animate-pop-in translate-y-0 scale-100 opacity-100' : '-translate-y-1 scale-[0.98] opacity-0 pointer-events-none'}`}>
          <div className="px-4 py-3 border-b border-line">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm font-semibold text-ink truncate">{u?.name || 'Account'}</span>
              <span className="shrink-0 text-xs font-medium px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-400">{roleLabel(u?.level, u?.subDepartment, (w.departments || []).find((d: any) => d.id === u?.departmentId)?.name)}</span>
            </div>
            {u?.email && <div className="text-xs text-mute truncate">{u.email}</div>}
          </div>
          {(u?.level === 'owner' || u?.level === 'dept_head') && <a role="menuitem" href="#/" onClick={() => setOpen(false)} className={item}><LayoutDashboard size={16} className="text-blue-400" />Command Center</a>}
          <div className="px-4 py-3 border-t border-line">
            <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-wider text-faint">Theme</div>
            <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-1.5">
              {([['light', 'Light', Sun, 'bg-[#f5f5f6]', 'bg-[#4f46e5]'], ['dark', 'Dark', Moon, 'bg-[#17181b]', 'bg-[#7c83f7]'], ['saffron', 'Royal', Crown, 'bg-[#0d0e11]', 'bg-gradient-to-br from-[#ffcf55] to-[#ff6a1f]']] as const).map(([id, label, Icon, base, dot]) => (
                <button key={id} type="button" role="radio" aria-checked={choice === id} onClick={() => pick(id)}
                  className={`flex flex-col items-center gap-1.5 rounded-lg border p-1.5 text-[11px] font-medium transition-colors ${choice === id ? 'border-blue-500 text-ink ring-1 ring-blue-500/40' : 'border-line text-mute hover:border-line-strong hover:text-ink'}`}>
                  <span className={`relative grid h-8 w-full place-items-center overflow-hidden rounded-md border border-black/10 ${base}`}><span className={`h-3 w-3 rounded-full ${dot}`} /></span>
                  <span className="flex items-center gap-1"><Icon size={11} />{label}</span>
                </button>
              ))}
            </div>
          </div>
          {extra && <div className="border-t border-line" onClick={() => setOpen(false)}>{extra}</div>}
          <button role="menuitem" onClick={() => { setOpen(false); w.logout?.(); }} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm font-semibold text-left text-red-400 hover:bg-red-500/10 border-t border-line transition-colors"><LogOut size={16} />Sign out</button>
        </div>
      )}
    </div>
    </div>
  );
};
