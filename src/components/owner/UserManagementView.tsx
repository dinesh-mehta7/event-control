import React, { useState } from 'react';
import { Search, KeyRound, RefreshCw, Copy } from 'lucide-react';
import { useAccess } from '../../context/AccessContext';
import type { GrantLevel, Member } from '../../context/AccessContext';
import { DEPTS } from '../../views/orgData';
import { Empty, Pill, Tabs, PageIntro, btnGhost, btnPrimary, inputCls, th } from '../ui';
import { Swap } from '../Swap';

const USER_TABS = ['members', 'requests', 'codes', 'audit'];
import { AccessRequestsList } from './ApprovalsView';
import { AuditLogsView } from './AuditLogsView';
import type { SubDepartmentId } from '../../types';
import { ROLE_TONE, roleLabel } from '../../lib/roles';
import { useApp as useWalkie } from '../../modules/walkie/context/AppContext';


const MemberRow: React.FC<{ m: Member; canEdit: boolean; departments: { id: string; name: string }[] }> = ({ m, canEdit, departments }) => {
  const { review, linkSewadar, sewadarMembers } = useAccess();
  const [deptId, setDeptId] = useState(m.departmentId || '');
  const deptName = departments.find(d => d.id === m.departmentId)?.name;
  const [edit, setEdit] = useState(false);
  const [level, setLevel] = useState<GrantLevel>((['staff', 'sub_dept_head', 'dept_head'].includes(m.level) ? m.level : 'staff') as GrantLevel);
  const [sub, setSub] = useState<SubDepartmentId | ''>((m.subDepartment as SubDepartmentId) || '');
  const [sewadarId, setSewadarId] = useState(() => sewadarMembers.find(s => s.profileId === m.id)?.id || '');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const save = async () => {
    if (level === 'dept_head' && !deptId) { setErr('Choose the department this Department Head leads.'); return; }
    setBusy(true); setErr('');
    const e = await review(m.id, true, level, level === 'dept_head' ? null : (sub || null), level === 'dept_head' ? deptId : null);
    if (!e && sub === 'sewadars') { const le = await linkSewadar(m.id, sewadarId || null); if (le) { setBusy(false); setErr(le); return; } }
    else if (!e && sewadarMembers.some(s => s.profileId === m.id)) { const le = await linkSewadar(m.id, null); if (le) { setBusy(false); setErr(le); return; } }
    setBusy(false); if (e) setErr(e); else setEdit(false);
  };
  return (
    <tr className="hover:bg-raised/50 align-top">
      <td className="px-4 py-2.5"><div className="text-sm font-medium text-ink">{m.name}</div><div className="text-xs text-mute">{m.email}</div></td>
      <td className="px-4 py-2.5 text-sm text-ink-soft">{m.level === 'owner' ? <span className="text-faint">All departments</span> : m.level === 'dept_head' ? (deptName || <span className="text-amber-300">Department not set</span>) : m.subDepartment ? <>{DEPTS[m.subDepartment]}<span className="block text-xs text-faint">Sub-department{deptName ? ` · ${deptName}` : ''}</span></> : <span className="text-faint">—</span>}</td>
      <td className="px-4 py-2.5"><Pill c={ROLE_TONE[m.level] || ROLE_TONE.other}>{roleLabel(m.level)}</Pill></td>
      <td className="px-4 py-2.5">{!m.approved ? <Pill c="bg-amber-500/15 text-amber-300">Waiting</Pill> : m.isActive ? <Pill c="bg-emerald-500/15 text-emerald-300">Active</Pill> : <Pill c="bg-red-500/15 text-red-300">Disabled</Pill>}</td>
      <td className="px-4 py-2.5 text-right">
        {canEdit && m.level !== 'owner' && m.approved && !edit && <button type="button" className={btnGhost + ' !px-2.5 !py-1.5 !text-xs text-blue-300 hover:text-blue-200'} onClick={() => setEdit(true)}>Change role</button>}
        {edit && (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <select className={inputCls + ' !w-44'} aria-label="Role" value={level} onChange={e => setLevel(e.target.value as GrantLevel)}>
              <option value="staff">Staff</option><option value="sub_dept_head">Sub-department Head</option><option value="dept_head">Department Head</option></select>
            {level === 'dept_head' && <select className={inputCls + ' !w-52'} aria-label="Department" value={deptId} onChange={e => setDeptId(e.target.value)}><option value="">Department…</option>{departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select>}
            {level !== 'dept_head' && <select className={inputCls + ' !w-40'} aria-label="Sub-department" value={sub} onChange={e => setSub(e.target.value as SubDepartmentId)}>
              <option value="">Sub-department…</option>{(Object.keys(DEPTS) as SubDepartmentId[]).map(k => <option key={k} value={k}>{DEPTS[k]}</option>)}</select>}
            {sub === 'sewadars' && <select className={inputCls + ' !w-48'} aria-label="Link Sewadar roster member" value={sewadarId} onChange={e => setSewadarId(e.target.value)}><option value="">No Sewadar link</option>{sewadarMembers.filter(s => !s.profileId || s.profileId === m.id).map(s => <option key={s.id} value={s.id}>{s.name}{s.teamName ? ` · ${s.teamName}` : ''}</option>)}</select>}
            <button className={btnGhost} onClick={() => setEdit(false)}>Cancel</button>
            <button className={btnPrimary} disabled={busy} onClick={save}>Save</button>
            {err && <div role="alert" className="w-full text-xs text-red-300 text-right">{err}</div>}
          </div>)}
      </td>
    </tr>
  );
};

const Codes: React.FC = () => {
  const { codes, regenerate, isOwner } = useAccess();
  const [msg, setMsg] = useState('');
  const copy = async (c: string) => { try { await navigator.clipboard.writeText(c); setMsg('Copied.'); } catch { setMsg('Copy failed.'); } setTimeout(() => setMsg(''), 1500); };
  const keys = (Object.keys(DEPTS) as SubDepartmentId[]).filter(k => codes[k]);
  return (
    <div className="rounded-xl border border-line bg-surface overflow-hidden">
      <div className="px-4 py-3 border-b border-line flex items-center justify-between"><div className="text-sm font-semibold text-ink flex items-center gap-2"><KeyRound size={15} className="text-blue-400" />Sign-up codes</div><span className="text-xs text-mute">{msg}</span></div>
      <p className="px-4 pt-3 text-xs text-mute">Give a department its code. A new person enters it when signing up and then waits for the owner's approval. Regenerate a code if it leaks.</p>
      <ul className="divide-y divide-line">
        {keys.map(k => (
          <li key={k} className="px-4 py-2.5 flex items-center justify-between gap-3">
            <span className="text-sm text-ink">{DEPTS[k]}</span>
            <span className="flex items-center gap-2"><code className="text-sm tabular-nums tracking-wider text-ink-soft bg-raised px-2 py-0.5 rounded">{codes[k]}</code>
              <button className="p-1.5 rounded-lg text-mute hover:bg-raised hover:text-ink" aria-label={`Copy ${DEPTS[k]} code`} onClick={() => copy(codes[k]!)}><Copy size={14} /></button>
              {isOwner && <button className="p-1.5 rounded-lg text-mute hover:bg-raised hover:text-ink" aria-label={`New code for ${DEPTS[k]}`} onClick={async () => { const e = await regenerate(k); setMsg(e || 'New code created.'); }}><RefreshCw size={14} /></button>}
            </span>
          </li>))}
        {!keys.length && <li><Empty>No codes yet. Run migration_v15 in the Supabase SQL Editor.</Empty></li>}
      </ul>
    </div>
  );
};

export const UserManagementView: React.FC<{ initialTab?: string }> = ({ initialTab = 'members' }) => {
  const { members, requests, isOwner, loading } = useAccess();
  const departments: { id: string; name: string }[] = (useWalkie() as any).departments || [];
  const [tab, setTab] = useState(initialTab === 'users_all' ? 'members' : initialTab);
  const [q, setQ] = useState(''); const [dept, setDept] = useState('all');
  const needle = q.trim().toLowerCase();
  const rows = members.filter(m => (dept === 'all' || m.subDepartment === dept) && (!needle || m.name.toLowerCase().includes(needle) || m.email.toLowerCase().includes(needle)));

  return (
    <div className="space-y-4">
      <PageIntro>Super Admin → Department Head (one of {departments.length || 'the'} departments) → Sub-department Head (CCTV, WiFi, Walkie-Talkie…) → Staff. New people sign up with their sub-department's code, then the Super Admin approves them.</PageIntro>
      <Tabs label="Users" value={tab} onChange={setTab} tabs={[
        { id: 'members', label: 'People', count: members.length },
        { id: 'requests', label: 'Access requests', count: requests.length, alert: true },
        { id: 'codes', label: 'Sign-up codes' },
        ...(isOwner ? [{ id: 'audit', label: 'Audit log' }] : []),
      ]} />
      <Swap k={tab} indexOf={k => USER_TABS.indexOf(k)}>
      {tab === 'requests' && <AccessRequestsList />}
      {tab === 'codes' && <Codes />}
      {tab === 'audit' && isOwner && <AuditLogsView />}
      {tab === 'members' && (
        <div className="rounded-xl border border-line bg-surface overflow-hidden">
          <div className="p-3 border-b border-line flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px] max-w-sm"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
              <input className={inputCls + ' pl-9'} placeholder="Search name or email" aria-label="Search people" value={q} onChange={e => setQ(e.target.value)} /></div>
            <select className={inputCls + ' !w-auto'} aria-label="Sub-department" value={dept} onChange={e => setDept(e.target.value)}>
              <option value="all">All sub-departments</option>{(Object.keys(DEPTS) as SubDepartmentId[]).map(k => <option key={k} value={k}>{DEPTS[k]}</option>)}</select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-canvas"><th className={th}>Person</th><th className={th}>Department / sub-department</th><th className={th}>Role</th><th className={th}>Status</th><th className={th + ' text-right'}>&nbsp;</th></tr></thead>
              <tbody className="divide-y divide-line">{rows.map(m => <MemberRow key={m.id} m={m} canEdit={isOwner} departments={departments} />)}</tbody>
            </table>
            {!rows.length && <Empty>{loading ? 'Loading…' : 'No one matches.'}</Empty>}
          </div>
        </div>)}
      </Swap>
    </div>
  );
};
