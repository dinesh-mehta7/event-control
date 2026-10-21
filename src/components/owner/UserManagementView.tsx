import React, { useState } from 'react';
import { Search } from 'lucide-react';
import { useAccess } from '../../context/AccessContext';
import { DEPTS } from '../../views/orgData';
import { Empty, Tabs, PageIntro, inputCls, th } from '../ui';
import { Swap } from '../Swap';
import { AccessRequestsList } from './ApprovalsView';
import { AuditLogsView } from './AuditLogsView';
import type { SubDepartmentId } from '../../types';
import { useApp as useWalkie } from '../../modules/walkie/context/AppContext';
import { Codes } from './users/Codes';
import { OrganizationSettings } from './users/OrganizationSettings';
import { MemberRow } from './users/MemberRow';

const USER_TABS = ['members', 'requests', 'codes', 'organization', 'audit'];

export const UserManagementView: React.FC<{ initialTab?: string }> = ({ initialTab = 'members' }) => {
  const { members, requests, isOwner, loading } = useAccess();
  const departments: { id: string; name: string; itServices?: boolean }[] = (useWalkie() as any).departments || [];
  const [tab, setTab] = useState(initialTab === 'users_all' ? 'members' : initialTab);
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('all');
  const [departmentId, setDepartmentId] = useState('all');
  const needle = q.trim().toLowerCase();
  const rows = members.filter(
    m =>
      (departmentId === 'all' || m.departmentId === departmentId) &&
      (dept === 'all' || m.subDepartment === dept) &&
      (!needle || m.name.toLowerCase().includes(needle) || m.email.toLowerCase().includes(needle)),
  );

  return (
    <div className="space-y-4">
      <PageIntro>
        Super Admin → Department Head (one of {departments.length || 'the'} departments) → Sub-department Head → Staff.
        Everyone belongs to a department and one of its sub-departments. New people sign up with that department's
        sub-department code, then the Super Admin approves them.
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
                aria-label="Department"
                value={departmentId}
                onChange={e => setDepartmentId(e.target.value)}
              >
                <option value="all">All departments</option>
                {departments.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
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
