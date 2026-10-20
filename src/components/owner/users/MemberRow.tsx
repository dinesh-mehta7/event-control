import React, { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useAccess } from '../../../context/AccessContext';
import type { GrantLevel, Member } from '../../../context/AccessContext';
import { DEPTS } from '../../../views/orgData';
import { Pill, btnDanger, btnGhost, btnPrimary, inputCls } from '../../ui';
import type { SubDepartmentId } from '../../../types';
import { ROLE_TONE, roleLabel } from '../../../lib/roles';

export const MemberRow: React.FC<{ m: Member; canEdit: boolean; departments: { id: string; name: string }[] }> = ({
  m,
  canEdit,
  departments,
}) => {
  const { review, linkSewadar, sewadarMembers, deleteMember } = useAccess();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deptId, setDeptId] = useState(m.departmentId || '');
  const deptName = departments.find(d => d.id === m.departmentId)?.name;
  const [edit, setEdit] = useState(false);
  const [level, setLevel] = useState<GrantLevel>(
    (['staff', 'sub_dept_head', 'dept_head'].includes(m.level) ? m.level : 'staff') as GrantLevel,
  );
  const [sub, setSub] = useState<SubDepartmentId | ''>((m.subDepartment as SubDepartmentId) || '');
  const [sewadarId, setSewadarId] = useState(() => sewadarMembers.find(s => s.profileId === m.id)?.id || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = async () => {
    if (level === 'dept_head' && !deptId) {
      setErr('Choose the department this Department Head leads.');
      return;
    }
    setBusy(true);
    setErr('');
    const e = await review(
      m.id,
      true,
      level,
      level === 'dept_head' ? null : sub || null,
      level === 'dept_head' ? deptId : null,
    );
    if (!e && sub === 'sewadars') {
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
    else setEdit(false);
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
  return (
    <tr className="hover:bg-raised/50 align-top">
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
            <span className="block text-xs text-faint">Sub-department{deptName ? ` · ${deptName}` : ''}</span>
          </>
        ) : (
          <span className="text-faint">—</span>
        )}
      </td>
      <td className="px-4 py-2.5">
        <Pill c={ROLE_TONE[m.level] || ROLE_TONE.other}>{roleLabel(m.level)}</Pill>
      </td>
      <td className="px-4 py-2.5">
        {!m.approved ? (
          <Pill c="bg-amber-500/15 text-amber-300">Waiting</Pill>
        ) : m.isActive ? (
          <Pill c="bg-emerald-500/15 text-emerald-300">Active</Pill>
        ) : (
          <Pill c="bg-red-500/15 text-red-300">Disabled</Pill>
        )}
      </td>
      <td className="px-4 py-2.5 text-right">
        {canEdit && m.level !== 'owner' && !edit && !confirmDelete && (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {m.approved && (
              <button
                type="button"
                className={btnGhost + ' !px-2.5 !py-1.5 !text-xs text-blue-300 hover:text-blue-200'}
                onClick={() => setEdit(true)}
              >
                Change role
              </button>
            )}
            <button
              type="button"
              className={btnGhost + ' !px-2.5 !py-1.5 !text-xs text-red-300 hover:text-red-200'}
              aria-label={`Delete ${m.name}`}
              onClick={() => {
                setErr('');
                setConfirmDelete(true);
              }}
            >
              <Trash2 size={13} />
              Delete
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
        {edit && (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <select
              className={inputCls + ' !w-44'}
              aria-label="Role"
              value={level}
              onChange={e => setLevel(e.target.value as GrantLevel)}
            >
              <option value="staff">Staff</option>
              <option value="sub_dept_head">Sub-department Head</option>
              <option value="dept_head">Department Head</option>
            </select>
            {level === 'dept_head' && (
              <select
                className={inputCls + ' !w-52'}
                aria-label="Department"
                value={deptId}
                onChange={e => setDeptId(e.target.value)}
              >
                <option value="">Department…</option>
                {departments.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            )}
            {level !== 'dept_head' && (
              <select
                className={inputCls + ' !w-40'}
                aria-label="Sub-department"
                value={sub}
                onChange={e => setSub(e.target.value as SubDepartmentId)}
              >
                <option value="">Sub-department…</option>
                {(Object.keys(DEPTS) as SubDepartmentId[]).map(k => (
                  <option key={k} value={k}>
                    {DEPTS[k]}
                  </option>
                ))}
              </select>
            )}
            {sub === 'sewadars' && (
              <select
                className={inputCls + ' !w-48'}
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
              </select>
            )}
            <button className={btnGhost} onClick={() => setEdit(false)}>
              Cancel
            </button>
            <button className={btnPrimary} disabled={busy} onClick={save}>
              Save
            </button>
            {err && (
              <div role="alert" className="w-full text-xs text-red-300 text-right">
                {err}
              </div>
            )}
          </div>
        )}
      </td>
    </tr>
  );
};
