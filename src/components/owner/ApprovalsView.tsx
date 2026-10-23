import React, { useState } from 'react';
import { UserCheck, Check, X } from 'lucide-react';
import { useAccess } from '../../context/AccessContext';
import type { GrantLevel, Member } from '../../context/AccessContext';
import { DEPTS, subDepartmentsFor } from '../../views/orgData';
import { Card, Empty, Pill, btnGhost, btnPrimary, inputCls } from '../ui';
import type { SubDepartmentId } from '../../types';
import { useApp as useWalkie } from '../../modules/walkie/context/AppContext';
import { Select } from '../Select';

const LEVELS: [GrantLevel, string][] = [
  ['staff', 'Staff'],
  ['sub_dept_head', 'Sub-department Head'],
  ['dept_head', 'Department Head'],
];

// A sign-up (or a department request) waiting for the owner. The decision is saved in the database.
const AccessRow: React.FC<{ m: Member; canDecide: boolean }> = ({ m, canDecide }) => {
  const { review, linkSewadar, sewadarMembers } = useAccess();
  const [level, setLevel] = useState<GrantLevel>('staff');
  const [sub, setSub] = useState<SubDepartmentId | ''>(m.requestedSub || (m.subDepartment as SubDepartmentId) || '');
  const [sewadarId, setSewadarId] = useState('');
  const departments: { id: string; name: string; itServices?: boolean }[] = (useWalkie() as any).departments || [];
  const [deptId, setDeptId] = useState(m.requestedDepartmentId || m.departmentId || '');
  const subOptions = subDepartmentsFor(departments.find(d => d.id === deptId));
  const askedDept = departments.find(d => d.id === m.requestedDepartmentId)?.name;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = async (approve: boolean) => {
    if (approve && sub === 'sewadars' && !sewadarId) {
      setErr('Choose the Sewadar roster member for this account.');
      return;
    }
    if (approve && !deptId) {
      setErr(level === 'dept_head' ? 'Choose the department this Department Head leads.' : 'Choose the department.');
      return;
    }
    if (approve && level !== 'dept_head' && !subOptions.includes(sub as SubDepartmentId)) {
      setErr('Choose a sub-department of this department.');
      return;
    }
    setBusy(true);
    setErr('');
    const e = await review(m.id, approve, level, level === 'dept_head' ? null : sub || null, deptId);
    if (!e && approve && sub === 'sewadars' && sewadarId) {
      const linkError = await linkSewadar(m.id, sewadarId);
      setBusy(false);
      if (linkError) setErr(linkError);
      return;
    }
    setBusy(false);
    if (e) setErr(e);
  };
  return (
    <li className="py-3 first:pt-0 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-ink">{m.name}</span>
        <span className="text-xs text-mute">{m.email}</span>
        <Pill c="bg-blue-500/15 text-blue-300">
          {m.requestedSub
            ? `Asked for ${[askedDept, DEPTS[m.requestedSub] || m.requestedSub].filter(Boolean).join(' · ')}`
            : 'New sign-up'}
        </Pill>
      </div>
      {canDecide ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-mute">
            Role
            <Select
              className={inputCls + ' mt-1 !w-48'}
              value={level}
              onChange={e => setLevel(e.target.value as GrantLevel)}
            >
              {LEVELS.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          </label>
          {
            <label className="text-xs text-mute">
              Department
              <Select className={inputCls + ' mt-1 !w-52'} value={deptId} onChange={e => setDeptId(e.target.value)}>
                <option value="">Choose department…</option>
                {departments.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </label>
          }
          {level !== 'dept_head' && (
            <label className="text-xs text-mute">
              Sub-department
              <Select
                className={inputCls + ' mt-1 !w-44'}
                value={sub}
                onChange={e => setSub(e.target.value as SubDepartmentId)}
              >
                <option value="">Choose…</option>
                {subOptions.map(k => (
                  <option key={k} value={k}>
                    {DEPTS[k]}
                  </option>
                ))}
              </Select>
            </label>
          )}
          {sub === 'sewadars' && (
            <label className="text-xs text-mute">
              Link Sewadar account
              <Select
                className={inputCls + ' mt-1 !w-56'}
                value={sewadarId}
                onChange={e => setSewadarId(e.target.value)}
              >
                <option value="">Choose roster member…</option>
                {sewadarMembers
                  .filter(s => !s.profileId)
                  .map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                      {s.teamName ? ` · ${s.teamName}` : ''}
                    </option>
                  ))}
              </Select>
            </label>
          )}
          <button className={btnGhost} disabled={busy} onClick={() => go(false)}>
            <X size={14} />
            Reject
          </button>
          <button className={btnPrimary} disabled={busy} onClick={() => go(true)}>
            <Check size={14} />
            Approve
          </button>
        </div>
      ) : (
        <div className="text-xs text-mute">Only the Super Admin can approve access.</div>
      )}
      {err && (
        <div role="alert" className="text-xs text-red-300">
          {err}
        </div>
      )}
    </li>
  );
};

export const AccessRequestsList: React.FC = () => {
  const { requests: people, isOwner } = useAccess();
  return (
    <Card
      icon={UserCheck}
      title="Access requests"
      action={<span className="text-xs text-mute">{people.length} waiting</span>}
    >
      <ul className="divide-y divide-line">
        {people.map(m => (
          <AccessRow key={m.id} m={m} canDecide={isOwner} />
        ))}
        {!people.length && (
          <li>
            <Empty>No access requests are waiting.</Empty>
          </li>
        )}
      </ul>
    </Card>
  );
};
