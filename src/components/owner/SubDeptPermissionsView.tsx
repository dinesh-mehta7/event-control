import React, { useMemo, useState } from 'react';
import { BarChart3, BedDouble, Boxes, CalendarClock, CalendarDays, ClipboardList, Clock3, Headset, LayoutGrid, ListTodo, Monitor, PhoneCall, Radio, RotateCcw, Search, ShieldCheck, ShoppingCart, BadgeCheck, Users, UsersRound, Video, Wifi, CalendarCheck, MessageSquareWarning, Network } from 'lucide-react';
import { usePermissions } from '../../context/PermissionsContext';
import { useAccess } from '../../context/AccessContext';
import { MODULES, MODULE_GROUPS, SUB_DEPARTMENTS, defaultAllowed, permKey } from '../../lib/permissions';
import type { ModuleKey } from '../../lib/permissions';
import { subDeptLabel } from '../../lib/roles';

const ICON: Record<ModuleKey, React.ComponentType<{ className?: string }>> = {
  helpdesk: Headset, cctv: Video, 'cctv-control-room': Monitor, wifi: Wifi, walkie: Radio, control: Monitor, 'networking-support': Network, issues: MessageSquareWarning,
  accommodation: BedDouble, 'sewadars:roster': Users, 'sewadars:permanent': BadgeCheck, 'sewadars:calling': PhoneCall, 'sewadars:duties': Clock3, 'sewadars:teams': UsersRound, 'sewadars:attendance': CalendarCheck, tasks: ListTodo,
  inventory: Boxes, requests: ClipboardList, purchase: ShoppingCart, events: CalendarDays, meetings: CalendarClock, reports: BarChart3,
};

// On/off switch. `size="sm"` is used inside dense rows.
const Switch: React.FC<{ on: boolean; mixed?: boolean; disabled?: boolean; label: string; onChange: () => void; size?: 'sm' | 'md' }> = ({ on, mixed, disabled, label, onChange, size = 'md' }) => (
  <button type="button" role="switch" aria-checked={mixed ? 'mixed' : on} aria-label={label} disabled={disabled}
    onClick={e => { e.stopPropagation(); onChange(); }}
    className={`relative inline-flex shrink-0 items-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${size === 'sm' ? 'h-4 w-7' : 'h-5 w-9'} ${on ? 'border-emerald-500/60 bg-emerald-500/70' : mixed ? 'border-emerald-500/50 bg-raised' : 'border-line-strong bg-raised'}`}>
    <span className={`inline-block rounded-full bg-white shadow transition-transform ${size === 'sm' ? 'h-2.5 w-2.5' : 'h-3.5 w-3.5'} ${on ? (size === 'sm' ? 'translate-x-[14px]' : 'translate-x-[18px]') : mixed ? (size === 'sm' ? 'translate-x-[8px]' : 'translate-x-[10px]') : 'translate-x-[3px]'}`} />
  </button>
);

// Administration → Sub-department Permissions.
export const SubDeptPermissionsView: React.FC = () => {
  const perms = usePermissions();
  const { members } = useAccess();
  const [view, setView] = useState<'sub' | 'module'>('sub');
  const [sub, setSub] = useState<string>(SUB_DEPARTMENTS[0]);
  const [q, setQ] = useState('');
  const ro = !perms.canEdit;
  const headcount = (s: string) => members.filter(m => m.approved && m.subDepartment === s && ['sub_dept_head', 'staff'].includes(m.level)).length;
  const onCount = (s: string) => MODULES.filter(m => perms.allowedFor(s, m.key)).length;
  const changedCount = (s: string) => MODULES.filter(m => perms.map[permKey(s, m.key)] !== undefined).length;
  const isChanged = (s: string, k: ModuleKey) => perms.map[permKey(s, k)] !== undefined;
  // Only differences from the default are stored.
  const set = (s: string, k: ModuleKey, on: boolean) => perms.setAccess(s, k, on === defaultAllowed(s, k) ? null : on);
  const toggle = (s: string, k: ModuleKey) => { if (!ro) void set(s, k, !perms.allowedFor(s, k)); };
  const setMany = (s: string, keys: ModuleKey[], on: boolean) => keys.forEach(k => { if (perms.allowedFor(s, k) !== on) void set(s, k, on); });
  const t = q.trim().toLowerCase();
  const shown = useMemo(() => MODULES.filter(m => !t || `${m.label} ${m.hint} ${m.group}`.toLowerCase().includes(t)), [t]);
  const pct = Math.round((onCount(sub) / MODULES.length) * 100);
  const actionBtn = 'inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-medium text-ink-soft hover:bg-raised disabled:opacity-40';

  return (
    <div className="space-y-4">
      {/* Title row */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-ink"><ShieldCheck className="h-5 w-5 text-blue-300" />Sub-department Permissions</h2>
          <p className="mt-0.5 text-xs text-mute">Choose which pages each sub-department can open. Super Admin and Department Heads always see everything.</p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <div role="tablist" aria-label="Permissions view" className="inline-flex h-9 rounded-lg border border-line bg-raised/40 p-0.5">
            {([['sub', 'By sub-department', ShieldCheck], ['module', 'By module', LayoutGrid]] as const).map(([k, l, I]) => (
              <button key={k} role="tab" aria-selected={view === k} onClick={() => setView(k)} className={`inline-flex items-center gap-1.5 rounded-md px-3 text-xs font-medium ${view === k ? 'bg-surface text-ink shadow-sm' : 'text-mute hover:text-ink'}`}><I className="h-3.5 w-3.5" />{l}</button>
            ))}
          </div>
          <label className="relative min-w-0 flex-1 sm:w-56 sm:flex-none"><span className="sr-only">Find a module</span><Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder={`Find a module (${MODULES.length})…`} className="h-9 w-full rounded-lg border border-line bg-field pl-8 pr-2.5 text-xs text-ink outline-none placeholder:text-faint focus:border-blue-500" /></label>
        </div>
      </header>

      {perms.loadError && <div role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-300">{perms.loadError}</div>}
      {ro && <p className="rounded-lg border border-line bg-raised/40 p-3 text-xs text-mute">You can view access. Only the Super Admin and Department Heads can change it.</p>}

      {view === 'sub' ? <>
        {/* Sub-department tabs */}
        <nav aria-label="Sub-departments" className="flex gap-1.5 overflow-x-auto pb-1">
          {SUB_DEPARTMENTS.map(s => (
            <button key={s} type="button" aria-current={sub === s ? 'true' : undefined} onClick={() => setSub(s)}
              className={`inline-flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium ${sub === s ? 'border-blue-500/50 bg-blue-500/10 text-blue-200' : 'border-line bg-surface text-mute hover:border-line-strong hover:text-ink'}`}>
              {subDeptLabel(s)}
              <span className={`rounded-full px-1.5 text-[10.5px] tabular-nums ${sub === s ? 'bg-blue-500/20 text-blue-100' : 'bg-raised text-mute'}`}>{onCount(s)}</span>
              {changedCount(s) > 0 && <i aria-label="customised" className="h-1.5 w-1.5 rounded-full bg-amber-400" />}
            </button>
          ))}
        </nav>

        {/* Summary for the selected sub-department */}
        <section className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-line bg-surface px-4 py-3">
          <div className="min-w-[10rem]">
            <div className="text-base font-semibold text-ink">{subDeptLabel(sub)}</div>
            <div className="text-[11.5px] text-mute">{headcount(sub)} {headcount(sub) === 1 ? 'person' : 'people'} · {changedCount(sub) ? `${changedCount(sub)} change${changedCount(sub) === 1 ? '' : 's'} from default` : 'default access'}</div>
          </div>
          <div className="min-w-[12rem] flex-1">
            <div className="flex items-baseline justify-between text-[11.5px]"><span className="text-mute">Pages on</span><span className="font-semibold tabular-nums text-ink">{onCount(sub)} <span className="font-normal text-faint">of {MODULES.length}</span></span></div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-raised"><div className="meter-fill h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} /></div>
          </div>
          {!ro && <div className="flex flex-wrap gap-1.5">
            <button type="button" className={actionBtn} onClick={() => setMany(sub, MODULES.map(m => m.key), true)}>All on</button>
            <button type="button" className={actionBtn} onClick={() => setMany(sub, MODULES.map(m => m.key), false)}>All off</button>
            <button type="button" className={actionBtn} disabled={!changedCount(sub)} onClick={() => void perms.resetSub(sub)}><RotateCcw className="h-3.5 w-3.5" />Defaults</button>
          </div>}
        </section>

        {/* Module cards, by group */}
        <div className="space-y-5">
          {MODULE_GROUPS.map(g => {
            const list = shown.filter(m => m.group === g); if (!list.length) return null;
            const on = list.filter(m => perms.allowedFor(sub, m.key)).length;
            return (
              <section key={g} aria-label={g}>
                <div className="mb-2 flex items-center gap-3">
                  <h3 className="text-[10.5px] font-semibold uppercase tracking-wider text-faint">{g}</h3>
                  <span className="text-[11px] tabular-nums text-faint">{on}/{list.length}</span>
                  <div className="h-px flex-1 bg-line" />
                  {!ro && <label className="flex items-center gap-2 text-[11px] text-mute">All<Switch size="sm" on={on === list.length} mixed={on > 0 && on < list.length} label={`All ${g} pages for ${subDeptLabel(sub)}`} onChange={() => setMany(sub, list.map(m => m.key), on !== list.length)} /></label>}
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                  {list.map(m => {
                    const allowed = perms.allowedFor(sub, m.key); const I = ICON[m.key];
                    return (
                      <div key={m.key} role="button" tabIndex={ro ? -1 : 0} aria-pressed={allowed} aria-label={`${m.label}: ${allowed ? 'on' : 'off'}`}
                        onClick={() => toggle(sub, m.key)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(sub, m.key); } }}
                        className={`lift relative flex items-center gap-3 rounded-xl border px-3 py-2.5 ${ro ? 'cursor-default' : 'cursor-pointer'} ${allowed ? 'border-emerald-500/30 bg-emerald-500/[0.06]' : 'border-line bg-surface'}`}>
                        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${allowed ? 'bg-emerald-500/15 text-emerald-300' : 'bg-raised text-faint'}`}><I className="h-4 w-4" /></span>
                        <div className="min-w-0 flex-1">
                          <div className={`truncate text-[13px] font-medium ${allowed ? 'text-ink' : 'text-mute'}`} title={m.label}>{m.label}</div>
                          <div className="truncate text-[11px] text-faint" title={m.hint}>{m.hint}</div>
                        </div>
                        <Switch on={allowed} disabled={ro} label={`${m.label} for ${subDeptLabel(sub)}`} onChange={() => toggle(sub, m.key)} />
                        {isChanged(sub, m.key) && <i aria-label="changed from default" title="Changed from default" className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-amber-400" />}
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
          {!shown.length && <p className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-mute">No module matches “{q}”.</p>}
        </div>
      </> : (
        // Every module as a card, with the sub-departments that can open it.
        <div className="space-y-5">
          {MODULE_GROUPS.map(g => {
            const list = shown.filter(m => m.group === g); if (!list.length) return null;
            return (
              <section key={g} aria-label={g}>
                <div className="mb-2 flex items-center gap-3"><h3 className="text-[10.5px] font-semibold uppercase tracking-wider text-faint">{g}</h3><div className="h-px flex-1 bg-line" /></div>
                <div className="grid gap-2 xl:grid-cols-2">
                  {list.map(m => {
                    const I = ICON[m.key]; const who = SUB_DEPARTMENTS.filter(s => perms.allowedFor(s, m.key)).length;
                    return (
                      <article key={m.key} className="rounded-xl border border-line bg-surface p-3">
                        <div className="mb-2.5 flex items-center gap-3">
                          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-raised text-blue-300"><I className="h-4 w-4" /></span>
                          <div className="min-w-0 flex-1"><div className="truncate text-[13px] font-medium text-ink">{m.label}</div><div className="truncate text-[11px] text-faint">{m.hint}</div></div>
                          <span className="shrink-0 rounded-full bg-raised px-2 py-0.5 text-[11px] tabular-nums text-ink-soft">{who}/{SUB_DEPARTMENTS.length}</span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {SUB_DEPARTMENTS.map(s => { const on = perms.allowedFor(s, m.key); return (
                            <button key={s} type="button" role="switch" aria-checked={on} disabled={ro} onClick={() => toggle(s, m.key)} aria-label={`${m.label} for ${subDeptLabel(s)}`}
                              className={`relative rounded-md border px-2 py-1 text-[11px] font-medium disabled:cursor-not-allowed ${on ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200' : 'border-line text-faint hover:border-line-strong hover:text-mute'}`}>
                              {subDeptLabel(s)}{isChanged(s, m.key) && <i aria-hidden className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-amber-400" />}
                            </button>); })}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
          {!shown.length && <p className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-mute">No module matches “{q}”.</p>}
        </div>
      )}

      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-faint">
        <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500/50" />On — appears in their sidebar and opens</span>
        <span className="inline-flex items-center gap-1.5"><i className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />Changed from default</span>
        <span>Changes apply immediately. Editing inside a page still follows each person's role.</span>
      </p>
    </div>
  );
};
