import React, { useState } from 'react';
import { Check, Eye, EyeOff, Layers, Pencil, Plus, RotateCcw, ShieldCheck, Trash2, X } from 'lucide-react';
import { usePermissions } from '../../context/PermissionsContext';
import { useAccess } from '../../context/AccessContext';
import { useManpower } from '../../modules/manpower/ManpowerContext';
import { BUILT_IN_DEPTS, DEPTS, IT_SERVICE_SUBS } from '../../views/orgData';
import { useApp as useWalkie } from '../../modules/walkie/context/AppContext';
import { btnGhost, btnPrimary, inputCls } from '../ui';

// Administration → Sub-departments. Each department adds its own sub-departments (its "services"); the
// Super Admin can add to any department, a Department Head to their own. Built-in ones are shared by every
// department (CCTV / WiFi / Walkie / Control Rooms only by the IT department); only the Super Admin renames
// or hides them, and they can be reset but not deleted.
export const SubDepartmentsView: React.FC = () => {
  const perms = usePermissions();
  const { members } = useAccess();
  const manpower = useManpower();
  const walkie: any = useWalkie();
  const departments: { id: string; name: string; itServices?: boolean }[] = walkie.departments || [];
  const level: string = walkie.currentUser?.level || 'other';
  const myDepartment: string = walkie.currentUser?.departmentId || '';
  const isOwner = level === 'owner';
  const ro = !isOwner && level !== 'dept_head';
  const canEditRow = (builtIn: boolean, departmentId?: string | null) =>
    isOwner || (!builtIn && level === 'dept_head' && departmentId === myDepartment);
  const itName = departments.find(d => d.itServices)?.name || 'the IT department';
  const [addDept, setAddDept] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState<{ key: string; name: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState('');

  const rowOf = (k: string) => perms.customSubs.find(r => r.key === k);
  const users = (k: string) => members.filter(m => m.approved && m.subDepartment === k).length;
  const sewadars = (k: string) => manpower.sewadars.filter(s => (s.department || '') === k).length;
  const run = async (fn: () => Promise<string | null>) => {
    setBusy(true);
    setErr('');
    const e = await fn();
    setBusy(false);
    if (e) setErr(e);
    return !e;
  };
  const saveName = async () => {
    if (editing && (await run(() => perms.renameSub(editing.key, editing.name.trim())))) setEditing(null);
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setErr('Give the sub-department a name.');
    const department = isOwner ? addDept : myDepartment;
    if (!department) return setErr('Choose the department.');
    if (await run(() => perms.createSub(name.trim(), department))) setName('');
  };

  const iconBtn = 'rounded-lg p-1.5 text-mute hover:bg-raised hover:text-ink disabled:opacity-40';
  // A plain render function (not a component), so the rename box keeps focus while typing.
  const renderRow = (k: string, builtIn: boolean) => {
    const row = rowOf(k);
    const label = (DEPTS as Record<string, string>)[k] || row?.name || k;
    const original = builtIn ? BUILT_IN_DEPTS[k as keyof typeof BUILT_IN_DEPTS] : '';
    const hidden = !!row?.hidden;
    const inUse = users(k) + sewadars(k);
    const editable = canEditRow(builtIn, row?.departmentId);
    return (
      <div
        key={k}
        className={`flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 last:border-b-0 ${hidden ? 'bg-raised/30' : ''}`}
      >
        {editing?.key === k ? (
          <>
            <input
              autoFocus
              className={inputCls + ' min-w-0 flex-1 sm:max-w-xs'}
              value={editing.name}
              maxLength={60}
              aria-label="Sub-department name"
              onChange={e => setEditing({ key: k, name: e.target.value })}
              onKeyDown={e => {
                if (e.key === 'Escape') setEditing(null);
                if (e.key === 'Enter') void saveName();
              }}
            />
            <button
              type="button"
              className={btnPrimary}
              disabled={busy || !editing.name.trim()}
              onClick={() => void saveName()}
            >
              <Check size={14} />
              Save
            </button>
            <button type="button" className={btnGhost} onClick={() => setEditing(null)}>
              <X size={14} />
              Cancel
            </button>
          </>
        ) : (
          <>
            <div className="min-w-0 flex-1">
              <div
                className={`flex flex-wrap items-center gap-2 text-sm font-medium ${hidden ? 'text-mute' : 'text-ink'}`}
              >
                <span className="truncate">{label}</span>
                {builtIn && label !== original && (
                  <span className="text-[11px] font-normal text-faint">was {original}</span>
                )}
                {hidden && (
                  <span className="rounded-full bg-raised px-2 py-0.5 text-[10.5px] font-medium text-mute">Hidden</span>
                )}
                {builtIn && IT_SERVICE_SUBS.includes(k) && (
                  <span className="text-[11px] font-normal text-faint">{itName} only</span>
                )}
              </div>
              <span className="text-xs text-mute tabular-nums">
                {users(k)} user{users(k) === 1 ? '' : 's'} · {sewadars(k)} sewadar{sewadars(k) === 1 ? '' : 's'}
                {hidden && inUse > 0 ? ' · still shown on them, but no longer offered in pickers' : ''}
              </span>
            </div>
            {editable &&
              (confirmDelete === k ? (
                <>
                  <span className="text-xs text-rose-300">Delete? Sewadars in it lose their sub-department.</span>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                    disabled={busy}
                    onClick={async () => {
                      await run(() => perms.deleteSub(k));
                      setConfirmDelete('');
                    }}
                  >
                    Delete
                  </button>
                  <button type="button" className={btnGhost} onClick={() => setConfirmDelete('')}>
                    Keep
                  </button>
                </>
              ) : (
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    className={iconBtn}
                    disabled={busy}
                    aria-label={`Rename ${label}`}
                    title="Rename"
                    onClick={() => {
                      setErr('');
                      setEditing({ key: k, name: label });
                    }}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    className={iconBtn}
                    disabled={busy}
                    aria-label={`${hidden ? 'Show' : 'Hide'} ${label}`}
                    title={hidden ? 'Show again' : 'Hide from pickers and permissions'}
                    onClick={() => void run(() => perms.hideSub(k, !hidden))}
                  >
                    {hidden ? <Eye size={14} /> : <EyeOff size={14} />}
                  </button>
                  {builtIn ? (
                    row && (
                      <button
                        type="button"
                        className={iconBtn}
                        disabled={busy}
                        aria-label={`Reset ${label}`}
                        title={`Reset to "${original}" and show it`}
                        onClick={() => void run(() => perms.resetSubName(k))}
                      >
                        <RotateCcw size={14} />
                      </button>
                    )
                  ) : (
                    <button
                      type="button"
                      className="rounded-lg p-1.5 text-mute hover:bg-red-500/10 hover:text-red-400"
                      aria-label={`Delete ${label}`}
                      title="Delete"
                      onClick={() => {
                        setErr('');
                        setConfirmDelete(k);
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
          </>
        )}
      </div>
    );
  };
  const custom = perms.customSubs.filter(r => r.key.startsWith('sd_'));
  // Super Admin: every department that has its own sub-departments. Department Head: their own department.
  const groups = departments
    .filter(d => (isOwner ? custom.some(r => r.departmentId === d.id) : d.id === myDepartment))
    .map(d => ({ d, rows: custom.filter(r => r.departmentId === d.id) }));
  const heading = 'border-b border-line px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-wider text-faint';

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-ink">
            <Layers className="h-5 w-5 text-blue-300" />
            Sub-departments
          </h2>
          <p className="mt-0.5 text-xs text-mute">
            Each department has its own sub-departments. They can be given to that department's people and sewadars, and
            their pages are set in Sub-department Permissions.
          </p>
        </div>
        <a href="#/permissions" className={btnGhost}>
          <ShieldCheck size={14} />
          Set their permissions
        </a>
      </header>

      {perms.subsError && (
        <div role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-300">
          {perms.subsError}
        </div>
      )}
      {ro && (
        <p className="rounded-lg border border-line bg-raised/40 p-3 text-xs text-mute">
          You can view sub-departments. Only the Super Admin and Department Heads can change them.
        </p>
      )}

      {!ro && (
        <form
          onSubmit={add}
          className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4 sm:flex-row sm:items-end"
        >
          {isOwner && (
            <label className="min-w-0 sm:w-56">
              <span className="mb-1 block text-xs font-medium text-mute">Department</span>
              <select className={inputCls} value={addDept} onChange={e => setAddDept(e.target.value)}>
                <option value="">Choose department…</option>
                {departments.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="min-w-0 flex-1">
            <span className="mb-1 block text-xs font-medium text-mute">New sub-department</span>
            <input
              className={inputCls}
              value={name}
              maxLength={60}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Security, Parking, Medical"
            />
          </label>
          <button type="submit" className={btnPrimary} disabled={busy || !name.trim()}>
            <Plus size={14} />
            {busy ? 'Saving…' : 'Add sub-department'}
          </button>
        </form>
      )}
      {err && (
        <div
          role="alert"
          className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300"
        >
          {err}
        </div>
      )}

      {groups.map(({ d, rows }) => (
        <section key={d.id} className="overflow-hidden rounded-xl border border-line bg-surface">
          <h3 className={heading}>
            {d.name} ({rows.length})
          </h3>
          {!rows.length && <p className="px-4 py-6 text-center text-sm text-mute">None yet. Add one above.</p>}
          {rows.map(r => renderRow(r.key, false))}
        </section>
      ))}
      {!groups.length && (
        <p className="rounded-xl border border-line bg-surface px-4 py-6 text-center text-sm text-mute">
          No department has its own sub-departments yet. Add one above.
        </p>
      )}

      <section className="overflow-hidden rounded-xl border border-line bg-surface">
        <h3 className={heading}>
          Built-in ({Object.keys(BUILT_IN_DEPTS).length}) · every department · only the Super Admin renames or hides
          these
        </h3>
        {Object.keys(BUILT_IN_DEPTS).map(k => renderRow(k, true))}
      </section>
    </div>
  );
};
