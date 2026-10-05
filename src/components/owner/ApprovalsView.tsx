import React, { useState } from 'react';
import { UserCheck, Check, X } from 'lucide-react';
import { useAccess } from '../../context/AccessContext';
import type { GrantLevel, Member } from '../../context/AccessContext';
import { DEPTS } from '../../pages/orgData';
import { Card, Empty, Pill, btnGhost, btnPrimary, inputCls } from '../ui';
import type { SubDepartmentId } from '../../types';

const LEVELS: [GrantLevel, string][] = [['staff', 'Staff'], ['sub_dept_head', 'Sub-department head'], ['dept_head', 'IT department head']];

// A sign-up (or a department request) waiting for the owner. The decision is saved in the database.
const AccessRow: React.FC<{ m: Member; canDecide: boolean }> = ({ m, canDecide }) => {
  const { review } = useAccess();
  const [level, setLevel] = useState<GrantLevel>('staff');
  const [sub, setSub] = useState<SubDepartmentId | ''>(m.requestedSub || (m.subDepartment as SubDepartmentId) || '');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const go = async (approve: boolean) => {
    setBusy(true); setErr('');
    const e = await review(m.id, approve, level, level === 'dept_head' ? null : (sub || null));
    setBusy(false); if (e) setErr(e);
  };
  return (
    <li className="py-3 first:pt-0 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-ink">{m.name}</span><span className="text-xs text-mute">{m.email}</span>
        <Pill c="bg-blue-500/15 text-blue-300">{m.requestedSub ? `Asked for ${DEPTS[m.requestedSub]}` : 'New sign-up'}</Pill>
      </div>
      {canDecide ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-mute">Role<select className={inputCls + ' mt-1 !w-48'} value={level} onChange={e => setLevel(e.target.value as GrantLevel)}>{LEVELS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          {level !== 'dept_head' && <label className="text-xs text-mute">Department<select className={inputCls + ' mt-1 !w-44'} value={sub} onChange={e => setSub(e.target.value as SubDepartmentId)}>
            <option value="">Choose…</option>{(Object.keys(DEPTS) as SubDepartmentId[]).map(k => <option key={k} value={k}>{DEPTS[k]}</option>)}</select></label>}
          <button className={btnGhost} disabled={busy} onClick={() => go(false)}><X size={14} />Reject</button>
          <button className={btnPrimary} disabled={busy} onClick={() => go(true)}><Check size={14} />Approve</button>
        </div>
      ) : <div className="text-xs text-mute">Only the Organization Head can approve access.</div>}
      {err && <div role="alert" className="text-xs text-red-300">{err}</div>}
    </li>
  );
};

export const AccessRequestsList: React.FC = () => {
  const { requests: people, isOwner } = useAccess();
  return (
    <Card icon={UserCheck} title="Access requests" action={<span className="text-xs text-mute">{people.length} waiting</span>}>
      <ul className="divide-y divide-line">
        {people.map(m => <AccessRow key={m.id} m={m} canDecide={isOwner} />)}
        {!people.length && <li><Empty>No access requests are waiting.</Empty></li>}
      </ul>
    </Card>
  );
};
