import React, { useEffect, useRef, useState } from 'react';
import { Search, KeyRound, RefreshCw, Copy, Trash2, Building2, ImagePlus } from 'lucide-react';
import { useAccess } from '../../context/AccessContext';
import type { GrantLevel, Member } from '../../context/AccessContext';
import { DEPTS } from '../../views/orgData';
import { Empty, Pill, Tabs, PageIntro, btnDanger, btnGhost, btnPrimary, inputCls, th } from '../ui';
import { Swap } from '../Swap';

const USER_TABS = ['members', 'requests', 'codes', 'organization', 'audit'];
import { AccessRequestsList } from './ApprovalsView';
import { AuditLogsView } from './AuditLogsView';
import type { SubDepartmentId } from '../../types';
import { ROLE_TONE, roleLabel } from '../../lib/roles';
import { useApp as useWalkie } from '../../modules/walkie/context/AppContext';

const MemberRow: React.FC<{ m: Member; canEdit: boolean; departments: { id: string; name: string }[] }> = ({
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

const Codes: React.FC = () => {
  const { codes, regenerate, isOwner } = useAccess();
  const [msg, setMsg] = useState('');
  const copy = async (c: string) => {
    try {
      await navigator.clipboard.writeText(c);
      setMsg('Copied.');
    } catch {
      setMsg('Copy failed.');
    }
    setTimeout(() => setMsg(''), 1500);
  };
  const keys = (Object.keys(DEPTS) as SubDepartmentId[]).filter(k => codes[k]);
  return (
    <div className="rounded-xl border border-line bg-surface overflow-hidden">
      <div className="px-4 py-3 border-b border-line flex items-center justify-between">
        <div className="text-sm font-semibold text-ink flex items-center gap-2">
          <KeyRound size={15} className="text-blue-400" />
          Sign-up codes
        </div>
        <span className="text-xs text-mute">{msg}</span>
      </div>
      <p className="px-4 pt-3 text-xs text-mute">
        Give a department its code. A new person enters it when signing up and then waits for the owner's approval.
        Regenerate a code if it leaks.
      </p>
      <ul className="divide-y divide-line">
        {keys.map(k => (
          <li key={k} className="px-4 py-2.5 flex items-center justify-between gap-3">
            <span className="text-sm text-ink">{DEPTS[k]}</span>
            <span className="flex items-center gap-2">
              <code className="text-sm tabular-nums tracking-wider text-ink-soft bg-raised px-2 py-0.5 rounded">
                {codes[k]}
              </code>
              <button
                className="p-1.5 rounded-lg text-mute hover:bg-raised hover:text-ink"
                aria-label={`Copy ${DEPTS[k]} code`}
                onClick={() => copy(codes[k]!)}
              >
                <Copy size={14} />
              </button>
              {isOwner && (
                <button
                  className="p-1.5 rounded-lg text-mute hover:bg-raised hover:text-ink"
                  aria-label={`New code for ${DEPTS[k]}`}
                  onClick={async () => {
                    const e = await regenerate(k);
                    setMsg(e || 'New code created.');
                  }}
                >
                  <RefreshCw size={14} />
                </button>
              )}
            </span>
          </li>
        ))}
        {!keys.length && (
          <li>
            <Empty>No codes yet. Run migration_v15 in the Supabase SQL Editor.</Empty>
          </li>
        )}
      </ul>
    </div>
  );
};

// Reads an image file and shrinks it to fit 256×256, so the stored logo stays small.
const shrinkImage = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file is not an image.'));
      img.onload = () => {
        const scale = Math.min(1, 256 / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });

// Super Admin: the organization's name and logo, shown in the sidebar for everyone.
const OrganizationSettings: React.FC = () => {
  const w: any = useWalkie();
  const org = w.currentOrganization;
  const [name, setName] = useState(org?.name || '');
  const [logo, setLogo] = useState<string | null>(org?.logoUrl || null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setName(org?.name || '');
    setLogo(org?.logoUrl || null);
  }, [org?.name, org?.logoUrl]);

  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      setLogo(await shrinkImage(f));
      setMsg(null);
    } catch (x: any) {
      setMsg({ ok: false, text: x.message });
    }
  };
  const save = async () => {
    if (name.trim().length < 2) {
      setMsg({ ok: false, text: 'Enter an organization name.' });
      return;
    }
    setBusy(true);
    setMsg(null);
    const e = await w.updateOrganization(name, logo);
    setBusy(false);
    setMsg(e ? { ok: false, text: e } : { ok: true, text: 'Saved.' });
  };
  const changed = name.trim() !== (org?.name || '') || logo !== (org?.logoUrl || null);
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((x: string) => x[0])
      .join('')
      .toUpperCase() || 'EC';

  return (
    <div className="rounded-xl border border-line bg-surface overflow-hidden">
      <div className="px-4 py-3 border-b border-line text-sm font-semibold text-ink flex items-center gap-2">
        <Building2 size={15} className="text-blue-400" />
        Organization
      </div>
      <div className="p-4 space-y-4 max-w-lg">
        <div className="flex items-center gap-4">
          <div className="grid place-items-center w-16 h-16 rounded-xl bg-blue-600 text-white text-lg font-bold overflow-hidden shrink-0">
            {logo ? (
              <img src={logo} alt="Organization logo" className="w-full h-full object-contain bg-white" />
            ) : (
              initials
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={pick} />
            <button type="button" className={btnGhost} onClick={() => fileRef.current?.click()}>
              <ImagePlus size={14} />
              {logo ? 'Change logo' : 'Upload logo'}
            </button>
            {logo && (
              <button
                type="button"
                className={btnGhost + ' text-red-300 hover:text-red-200'}
                onClick={() => setLogo(null)}
              >
                Remove
              </button>
            )}
          </div>
        </div>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-mute">Organization name</span>
          <input className={inputCls} value={name} maxLength={80} onChange={e => setName(e.target.value)} />
        </label>
        <div className="flex items-center gap-3">
          <button type="button" className={btnPrimary} disabled={busy || !changed} onClick={save}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
          {msg && (
            <span role="status" className={`text-xs ${msg.ok ? 'text-emerald-300' : 'text-red-300'}`}>
              {msg.text}
            </span>
          )}
        </div>
        <p className="text-xs text-faint">The name and logo show in the sidebar for everyone in the organization.</p>
      </div>
    </div>
  );
};

export const UserManagementView: React.FC<{ initialTab?: string }> = ({ initialTab = 'members' }) => {
  const { members, requests, isOwner, loading } = useAccess();
  const departments: { id: string; name: string }[] = (useWalkie() as any).departments || [];
  const [tab, setTab] = useState(initialTab === 'users_all' ? 'members' : initialTab);
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('all');
  const needle = q.trim().toLowerCase();
  const rows = members.filter(
    m =>
      (dept === 'all' || m.subDepartment === dept) &&
      (!needle || m.name.toLowerCase().includes(needle) || m.email.toLowerCase().includes(needle)),
  );

  return (
    <div className="space-y-4">
      <PageIntro>
        Super Admin → Department Head (one of {departments.length || 'the'} departments) → Sub-department Head (CCTV,
        WiFi, Walkie-Talkie…) → Staff. New people sign up with their sub-department's code, then the Super Admin
        approves them.
      </PageIntro>
      <Tabs
        label="Users"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'members', label: 'People', count: members.length },
          { id: 'requests', label: 'Access requests', count: requests.length, alert: true },
          { id: 'codes', label: 'Sign-up codes' },
          ...(isOwner ? [{ id: 'organization', label: 'Organization' }] : []),
          ...(isOwner ? [{ id: 'audit', label: 'Audit log' }] : []),
        ]}
      />
      <Swap k={tab} indexOf={k => USER_TABS.indexOf(k)}>
        {tab === 'requests' && <AccessRequestsList />}
        {tab === 'codes' && <Codes />}
        {tab === 'organization' && isOwner && <OrganizationSettings />}
        {tab === 'audit' && isOwner && <AuditLogsView />}
        {tab === 'members' && (
          <div className="rounded-xl border border-line bg-surface overflow-hidden">
            <div className="p-3 border-b border-line flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px] max-w-sm">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
                <input
                  className={inputCls + ' pl-9'}
                  placeholder="Search name or email"
                  aria-label="Search people"
                  value={q}
                  onChange={e => setQ(e.target.value)}
                />
              </div>
              <select
                className={inputCls + ' !w-auto'}
                aria-label="Sub-department"
                value={dept}
                onChange={e => setDept(e.target.value)}
              >
                <option value="all">All sub-departments</option>
                {(Object.keys(DEPTS) as SubDepartmentId[]).map(k => (
                  <option key={k} value={k}>
                    {DEPTS[k]}
                  </option>
                ))}
              </select>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-canvas">
                    <th className={th}>Person</th>
                    <th className={th}>Department / sub-department</th>
                    <th className={th}>Role</th>
                    <th className={th}>Status</th>
                    <th className={th + ' text-right'}>&nbsp;</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map(m => (
                    <MemberRow key={m.id} m={m} canEdit={isOwner} departments={departments} />
                  ))}
                </tbody>
              </table>
              {!rows.length && <Empty>{loading ? 'Loading…' : 'No one matches.'}</Empty>}
            </div>
          </div>
        )}
      </Swap>
    </div>
  );
};
