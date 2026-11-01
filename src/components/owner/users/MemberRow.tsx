import React, { useState } from 'react';
import { Ban, Check, Trash2 } from 'lucide-react';
import { useAccess } from '../../../context/AccessContext';
import type { GrantLevel, Member } from '../../../context/AccessContext';
import { DEPTS, subDepartmentsFor } from '../../../views/orgData';
import { Pill, btnDanger, btnGhost, btnPrimary, inputCls } from '../../ui';
import type { SubDepartmentId } from '../../../types';
import { ROLE_TONE, roleLabel } from '../../../lib/roles';
import { Select } from '../../Select';
import { useApp as useWalkie } from '../../../modules/walkie/context/AppContext';

type DepartmentOption = { id: string; name: string; itServices?: boolean };

export const MemberRow: React.FC<{ m: Member; canEdit: boolean; departments: DepartmentOption[] }> = ({
  m,
  canEdit,
  departments,
}) => {
  const { review, linkSewadar, sewadarMembers, deleteMember, setMemberActive, currentUserId } = useAccess();
  const walkie: any = useWalkie();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [savedPulse, setSavedPulse] = useState(false);
  const [deptId, setDeptId] = useState(m.departmentId || '');
  const deptName = departments.find(d => d.id === m.departmentId)?.name;
  const [edit, setEdit] = useState(false);
  const [closingEdit, setClosingEdit] = useState(false);
  const [level, setLevel] = useState<GrantLevel>(
    (['staff', 'sub_dept_head', 'dept_head'].includes(m.level) ? m.level : 'staff') as GrantLevel,
  );
  const [sub, setSub] = useState<SubDepartmentId | ''>((m.subDepartment as SubDepartmentId) || '');
  const subOptions = subDepartmentsFor(departments.find(d => d.id === deptId));
  const [sewadarId, setSewadarId] = useState(() => sewadarMembers.find(s => s.profileId === m.id)?.id || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const closeEditor = (saved = false) => {
    if (closingEdit) return;
    setClosingEdit(true);
    window.setTimeout(() => {
      setEdit(false);
      setClosingEdit(false);
      if (saved) {
        setSavedPulse(true);
        window.setTimeout(() => setSavedPulse(false), 700);
      }
    }, 170);
  };
  const save = async () => {
    if (!deptId) {
      setErr(level === 'dept_head' ? 'Choose the department this Department Head leads.' : 'Choose the department.');
      return;
    }
    if (level !== 'dept_head' && !subOptions.includes(sub as SubDepartmentId)) {
      setErr('Choose a sub-department of this department.');
      return;
    }
    setBusy(true);
    setErr('');
    const e = await review(m.id, true, level, level === 'dept_head' ? null : sub || null, deptId);
    if (!e && !m.isActive) {
      const activeError = await setMemberActive(m.id, false);
      if (activeError) {
        setBusy(false);
        setErr(activeError);
        return;
      }
    }
    if (!e && level !== 'dept_head' && sub === 'sewadars') {
      const le = await linkSewadar(m.id, sewadarId || null);
      if (le) {
        setBusy(false);
        setErr(le);
        return;
      }
    } else if (!e && sewadarMembers.some(s => s.profileId === m.id)) {
      const le = await linkSewadar(m.id, null);
      if (le) {
        setBusy(false);
        setErr(le);
        return;
      }
    }
    setBusy(false);
    if (e) setErr(e);
    else {
      walkie.addToast?.(`${m.name}'s access updated.`, 'success');
      closeEditor(true);
    }
  };
  const remove = async () => {
    setBusy(true);
    setErr('');
    const r = await deleteMember(m.id);
    setBusy(false);
    if (r.error) setErr(r.error);
    else if (r.result === 'disabled') {
      setConfirmDelete(false);
      setErr('Some records still need this person, so the account was disabled and locked instead of deleted.');
    }
  };
  const toggleActive = async () => {
    setBusy(true);
    setErr('');
    const e = await setMemberActive(m.id, !m.isActive);
    setBusy(false);
    if (e) setErr(e);
    else {
      setSavedPulse(true);
      window.setTimeout(() => setSavedPulse(false), 700);
    }
  };
  if (edit) {
    return (
      <tr className={`member-row-edit-enter ${closingEdit ? 'member-row-edit-leave' : ''} bg-raised/20`}>
        <td colSpan={5} className="px-4 py-3">
          <div className="overflow-x-auto">
            <div className={`member-row-edit-panel ${closingEdit ? 'member-row-edit-panel-leave' : ''} flex min-w-max flex-nowrap items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2.5 shadow-lg shadow-black/10`}>
              <div className="w-32 shrink-0">
                <div className="truncate text-sm font-medium text-ink">{m.name}</div>
                <div className="truncate text-xs text-mute">{m.email}</div>
              </div>
              <div className="w-48 shrink-0">
                <Select
                  className={inputCls}
                  aria-label="Role"
                  value={level}
                  onChange={e => {
                    const next = e.target.value as GrantLevel;
                    setLevel(next);
                    if (next === 'dept_head') setSub('');
                  }}
                >
                  <option value="staff">Staff</option>
                  <option value="sub_dept_head">Sub-department Head</option>
                  <option value="dept_head">Department Head</option>
                </Select>
              </div>
              <div className="w-48 shrink-0">
                <Select
                  className={inputCls}
                  aria-label="Department"
                  value={deptId}
                  onChange={e => {
                    setDeptId(e.target.value);
                    setSub('');
                  }}
                >
                  <option value="">Department…</option>
                  {departments.map(d => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              </div>
              {level !== 'dept_head' && (
                <div className="w-40 shrink-0">
                  <Select
                    className={inputCls}
                    aria-label="Sub-department"
                    value={sub}
                    onChange={e => setSub(e.target.value as SubDepartmentId)}
                  >
                    <option value="">Sub-department…</option>
                    {subOptions.map(k => (
                      <option key={k} value={k}>
                        {DEPTS[k]}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
              {sub === 'sewadars' && (
                <div className="w-48 shrink-0">
                  <Select
                    className={inputCls}
                    aria-label="Link Sewadar roster member"
                    value={sewadarId}
                    onChange={e => setSewadarId(e.target.value)}
                  >
                    <option value="">No Sewadar link</option>
                    {sewadarMembers
                      .filter(s => !s.profileId || s.profileId === m.id)
                      .map(s => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                          {s.teamName ? ` · ${s.teamName}` : ''}
                        </option>
                      ))}
                  </Select>
                </div>
              )}
              <div className="ml-auto flex shrink-0 items-center gap-2 pb-0.5">
                <button
                  type="button"
                  className={btnGhost + ' transition-[transform,background-color,border-color,box-shadow] duration-150 ease-out hover:-translate-y-px active:translate-y-0 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-blue-500/40'}
                  disabled={busy || closingEdit}
                  onClick={() => closeEditor()}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={btnPrimary + ' transition-[transform,background-color,box-shadow] duration-150 ease-out hover:-translate-y-px active:translate-y-0 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-blue-500/40'}
                  disabled={busy || closingEdit}
                  onClick={save}
                >
                  {busy ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
          {err && (
            <div role="alert" className="mt-2 text-xs text-red-300">
              {err}
            </div>
          )}
        </td>
      </tr>
    );
  }
  return (
    <tr className={`${savedPulse ? 'member-row-saved ' : ''}hover:bg-raised/50 align-top`}>
      <td className="px-4 py-2.5">
        <div className="text-sm font-medium text-ink">{m.name}</div>
        <div className="text-xs text-mute">{m.email}</div>
      </td>
      <td className="px-4 py-2.5 text-sm text-ink-soft">
        {m.level === 'owner' ? (
          <span className="text-faint">All departments</span>
        ) : m.level === 'dept_head' ? (
          deptName || <span className="text-amber-300">Department not set</span>
        ) : m.subDepartment ? (
          <>
            {DEPTS[m.subDepartment]}
            {deptName ? (
              <span className="block text-xs text-faint">{deptName}</span>
            ) : (
              <span className="block text-xs text-amber-300">Department not set</span>
            )}
          </>
        ) : (
          <span className="text-faint">—</span>
        )}
      </td>
      <td className="whitespace-nowrap px-4 py-2.5">
        <Pill c={ROLE_TONE[m.level] || ROLE_TONE.other}>{roleLabel(m.level)}</Pill>
      </td>
      <td className="whitespace-nowrap px-4 py-2.5">
        {!m.isActive ? (
          <Pill c="bg-red-500/15 text-red-300">Disabled</Pill>
        ) : !m.approved ? (
          <Pill c="bg-amber-500/15 text-amber-300">Waiting</Pill>
        ) : (
          <Pill c="bg-emerald-500/15 text-emerald-300">Active</Pill>
        )}
      </td>
      <td className="px-4 py-2.5 text-right">
        {canEdit && !edit && !confirmDelete && (
          <div className="flex flex-nowrap items-center justify-end gap-1.5">
            {m.level !== 'owner' && m.approved && (
              <button
                type="button"
                className={btnGhost + ' !px-2 !py-1.5 !text-xs text-blue-300 hover:text-blue-200'}
                onClick={() => setEdit(true)}
              >
                Change role
              </button>
            )}
            {m.level !== 'owner' && (
              <button
                type="button"
                className={btnGhost + ' !px-2 !py-1.5 !text-xs text-red-300 hover:text-red-200'}
                aria-label={`Delete ${m.name}`}
                title="Delete user"
                onClick={() => {
                  setErr('');
                  setConfirmDelete(true);
                }}
              >
                <Trash2 size={13} />
              </button>
            )}
            <button
              type="button"
              className={btnGhost + ` !px-2 !py-1.5 !text-xs ${m.isActive ? 'text-amber-300 hover:text-amber-200' : 'text-emerald-300 hover:text-emerald-200'}`}
              aria-label={`${m.isActive ? 'Disable' : 'Enable'} ${m.name}`}
              title={m.id === currentUserId ? 'You cannot change your own account status' : undefined}
              disabled={busy || m.id === currentUserId}
              onClick={() => {
                setErr('');
                void toggleActive();
              }}
            >
              {m.isActive ? <Ban size={13} /> : <Check size={13} />}
              {m.isActive ? 'Disable' : 'Enable'}
            </button>
          </div>
        )}
        {confirmDelete && (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="text-xs text-ink-soft">Delete {m.name}? They lose access for good.</span>
            <button className={btnGhost} disabled={busy} onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
            <button className={btnDanger} disabled={busy} onClick={remove}>
              {busy ? 'Deleting…' : 'Delete user'}
            </button>
          </div>
        )}
        {!edit && err && (
          <div role="alert" className="mt-1 text-xs text-red-300 text-right">
            {err}
          </div>
        )}
      </td>
    </tr>
  );
};
