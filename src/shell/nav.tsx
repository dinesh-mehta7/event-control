import React from 'react';

// Sidebar entries live outside Shell so they are not rebuilt (and their icons re-animated) on every render.
export const SideNavCtx = React.createContext({ active: '', collapsed: false });

export const NavItem: React.FC<any> = ({
  id,
  label,
  Icon,
  badge = 0,
}: {
  id: string;
  label: string;
  Icon: any;
  badge?: number;
}) => {
  const { active: key, collapsed } = React.useContext(SideNavCtx);
  return (
    <a
      href={'#/' + id}
      title={label}
      aria-label={label}
      aria-current={key === id ? 'page' : undefined}
      className={`relative flex min-h-9 items-center ${collapsed ? 'md:justify-center md:px-0' : ''} gap-2.5 px-2.5 py-1.5 rounded-md text-[13.5px] font-medium transition-[background-color,color,transform,opacity] duration-200 ease-out hover:translate-x-0.5 active:scale-[0.99] ${key === id ? 'bg-blue-600/10 text-blue-300 font-semibold' : 'text-mute hover:bg-blue-600/10 hover:text-blue-300'}`}
    >
      <Icon size={16} className="shrink-0" />
      <span className={`truncate flex-1 ${collapsed ? 'md:hidden' : ''}`}>{label}</span>
      {badge > 0 && (
        <span
          title={`${badge} notifications`}
          aria-label="Notifications"
          className={`h-2 w-2 shrink-0 rounded-full bg-amber-400 ${collapsed ? 'md:absolute md:right-1.5 md:top-1.5' : ''}`}
        />
      )}
    </a>
  );
};

export const NavSubItem: React.FC<any> = ({
  href,
  label,
  Icon,
  active,
}: {
  href: string;
  label: string;
  Icon: any;
  active: boolean;
}) => {
  const { collapsed } = React.useContext(SideNavCtx);
  return (
    <a
      href={href}
      title={label}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      className={`flex min-h-8 items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium ${collapsed ? 'md:justify-center md:px-0' : ''} ${active ? 'bg-blue-600/10 font-semibold text-blue-300' : 'text-mute hover:bg-blue-600/10 hover:text-blue-300'}`}
    >
      <Icon size={collapsed ? 15 : 13} className="shrink-0 opacity-80" />
      <span className={`truncate ${collapsed ? 'md:hidden' : ''}`}>{label}</span>
    </a>
  );
};

export const NavLabel: React.FC<any> = ({ t }: { t: string }) => {
  const { collapsed } = React.useContext(SideNavCtx);
  return (
    <div
      className={`${collapsed ? 'px-3 pt-5 pb-1.5 md:px-2 md:pt-3 md:pb-1' : 'px-3 pt-5 pb-1.5'} text-[10.5px] font-semibold uppercase tracking-wider text-faint`}
    >
      {collapsed ? (
        <>
          <span className="md:hidden">{t}</span>
          <span className="hidden md:block h-px bg-line" />
        </>
      ) : (
        t
      )}
    </div>
  );
};
