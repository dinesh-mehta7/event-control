import React from 'react';
import { roleLabel } from '../lib/roles';
import { User, LayoutDashboard, SunMoon, LogOut } from 'lucide-react';
import { settingsFor, themeChoiceOf, type ThemeChoice } from '../hooks/useMotion';
import { useApp as useWalkie } from '../modules/walkie/context/AppContext';
import { HeaderTools } from './HeaderTools';
import { useAnimatedPresence } from '../hooks/useAnimatedPresence';
import { useHoverMenu } from '../hooks/useHoverMenu';

// The one account menu for every screen: a round icon button at the top right.
// Opens on hover (tap on touch screens); click outside / Esc to close. Screens can pass extra items (e.g. admin tools) as children.

export const ProfileMenu: React.FC<{ extra?: React.ReactNode }> = ({ extra }) => {
  const w: any = useWalkie();
  const { open, setOpen, ref: box, hover, trigger } = useHoverMenu();
  const present = useAnimatedPresence(open);
  const u = w.currentUser;
  const choice = themeChoiceOf(w.settings);
  const pick = (c: ThemeChoice) => w.setSettings?.((p: any) => ({ ...p, ...settingsFor(c) }));
  const item =
    'w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-left text-ink-soft hover:bg-raised hover:text-ink transition-colors';
  const initials =
    (u?.name || '')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part: string) => part.charAt(0).toUpperCase())
      .join('') || '?';
  return (
    <div className="flex items-center">
      <HeaderTools />
      <div ref={box} className="relative" {...hover}>
        <button
          {...trigger}
          aria-label="Account menu"
          aria-haspopup="menu"
          aria-expanded={open}
          className={`grid place-items-center w-9 h-9 rounded-full border transition-colors ${open ? 'bg-blue-600 border-blue-600 text-white' : 'bg-raised border-line text-ink-soft hover:border-line-strong hover:text-ink'}`}
        >
          <User size={17} />
        </button>
        {present && (
          <div
            role="menu"
            aria-hidden={!open}
            {...({ inert: !open } as any)}
            className={`absolute right-0 top-full mt-2 z-50 w-72 max-w-[calc(100vw-1.5rem)] rounded-xl border border-line bg-surface shadow-xl overflow-hidden transition-[opacity,transform] duration-200 ease-out ${open ? 'animate-pop-in translate-y-0 scale-100 opacity-100' : '-translate-y-1 scale-[0.98] opacity-0 pointer-events-none'}`}
          >
            {/* Who is signed in: initials, name, email, then the role as one quiet line. */}
            <div className="flex items-start gap-3 px-4 py-3.5">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-blue-500/15 text-sm font-semibold text-blue-400">
                {initials}
              </span>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-ink" title={u?.name || undefined}>
                  {u?.name || 'Account'}
                </div>
                {u?.email && (
                  <div className="truncate text-xs text-mute" title={u.email}>
                    {u.email}
                  </div>
                )}
                <span className="mt-1.5 inline-block max-w-full rounded-md bg-blue-500/15 px-2 py-0.5 text-[11px] font-medium leading-snug text-blue-400">
                  {roleLabel(
                    u?.level,
                    u?.subDepartment,
                    (w.departments || []).find((d: any) => d.id === u?.departmentId)?.name,
                  )}
                </span>
              </div>
            </div>
            <div className="space-y-0.5 border-t border-line p-1.5">
              {(u?.level === 'owner' || u?.level === 'dept_head') && (
                <a role="menuitem" href="#/" onClick={() => setOpen(false)} className={item}>
                  <LayoutDashboard size={16} className="text-blue-400" />
                  Command Center
                </a>
              )}
              {/* Theme is a list row like the others: icon, then the three choices by name. */}
              <div className="flex items-center gap-3 px-3 py-1.5 text-sm text-ink-soft">
                <SunMoon size={16} className="shrink-0 text-blue-400" />
                <div
                  role="radiogroup"
                  aria-label="Theme"
                  className="grid flex-1 grid-cols-3 gap-0.5 rounded-lg bg-raised/70 p-0.5"
                >
                  {(
                    [
                      ['light', 'Light'],
                      ['dark', 'Dark'],
                      ['saffron', 'Royal'],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      role="radio"
                      aria-checked={choice === id}
                      onClick={() => pick(id)}
                      className={`rounded-md py-1 text-xs font-medium transition-colors ${choice === id ? 'bg-surface text-ink shadow-sm ring-1 ring-line' : 'text-mute hover:text-ink'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {extra && (
              <div className="border-t border-line" onClick={() => setOpen(false)}>
                {extra}
              </div>
            )}
            <div className="border-t border-line p-1.5">
              <button
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  w.logout?.();
                }}
                className="w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-left text-red-400 hover:bg-red-500/10 transition-colors"
              >
                <LogOut size={16} />
                Sign out
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
