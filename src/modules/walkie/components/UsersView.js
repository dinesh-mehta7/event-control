import React, { useEffect, useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { Search, ShieldCheck, Shield, User, Lock, Unlock, UserCheck, UserX, Clock } from 'lucide-react';

const ROLES = ['Admin', 'Operator', 'Client'];

const roleBadgeClasses = {
  Admin: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400',
  Operator: 'bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400',
  Client: 'bg-blue-500/10 border-blue-500/20 text-blue-600 dark:text-blue-400'
};

const LEVELS = [
  ['owner', 'Owner (edits rooms)'],
  ['dept_head', 'Department head'],
  ['sub_dept_head', 'Sub-dept head'],
  ['staff', 'Staff'],
  ['other', 'Other']
];
const SUB_DEPTS = [
  ['cctv', 'CCTV'], ['wifi', 'WiFi'], ['walkie', 'Walkie-Talkie'], ['control', 'Control Rooms'],
  ['inventory', 'Inventory'], ['purchase', 'Purchase'], ['accommodation', 'Accommodation (live menu)'], ['sewadars', 'Sewadars']
];

export default function UsersView({ embedded = false }) {
  const { allProfiles, fetchAllUsers, updateUserRole, updateUserHierarchy, setUserActive, approveUser, denyUser, settings, currentUser } = useApp();
  const isDark = settings.theme === 'dark';
  const [search, setSearch] = useState('');

  const handleToggleUser = async (user) => {
    if (user.isActive) {
      const confirmed = window.confirm(`Disable ${user.name || user.email}? This will block their sign-in until an admin enables them again.`);
      if (!confirmed) return;
    }

    await setUserActive(user.id, !user.isActive);
  };

  useEffect(() => {
    if (currentUser?.role === 'Admin') {
      fetchAllUsers();
    }
  }, [currentUser, fetchAllUsers]);

  const filtered = useMemo(() => allProfiles.filter(p =>
    (p.name || '').toLowerCase().includes(search.toLowerCase()) ||
    (p.email || '').toLowerCase().includes(search.toLowerCase())
  ), [allProfiles, search]);

  const pendingProfiles = useMemo(() => filtered.filter(p => !p.approved), [filtered]);
  const approvedProfiles = useMemo(() => filtered.filter(p => p.approved), [filtered]);

  const handleApprove = async (user) => {
    await approveUser(user.id);
  };

  const handleDeny = async (user) => {
    const confirmed = window.confirm(`Deny ${user.name || user.email}'s request to join? They won't be able to sign in.`);
    if (!confirmed) return;
    await denyUser(user.id);
  };

  if (currentUser?.role !== 'Admin') {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3 text-slate-400">
        <Lock className="w-10 h-10" />
        <p className="text-sm font-semibold">User management is restricted to Administrators.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          {embedded ? (
            <h3 className="font-bold text-lg flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-500" />
              Users &amp; Roles
            </h3>
          ) : (
            <h2 className="text-lg font-bold tracking-tight flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-500" />
              User Management
            </h2>
          )}
          <p className="text-xs text-slate-400 mt-0.5">
            Assign roles and control who can sign in. People joining via your join code land here as pending until approved.
          </p>
        </div>
        <div className="relative w-full md:w-72">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={`w-full pl-9 pr-4 py-2 text-sm rounded-full border outline-none transition-all
              ${isDark
                ? 'bg-slate-900 border-slate-800 text-slate-100 placeholder-slate-500 focus:border-blue-500'
                : 'bg-slate-100 border-slate-200 text-slate-800 placeholder-slate-400 focus:bg-white focus:border-blue-500'}`}
          />
        </div>
      </div>

      {pendingProfiles.length > 0 && (
        <div className={`rounded-xl border p-5 ${isDark ? 'border-amber-500/20 bg-amber-500/5' : 'border-amber-200 bg-amber-50'}`}>
          <h3 className="font-bold text-sm mb-3 flex items-center gap-2 text-amber-600 dark:text-amber-400">
            <Clock className="w-4 h-4" />
            Pending Approval ({pendingProfiles.length})
          </h3>
          <div className="space-y-2">
            {pendingProfiles.map(p => (
              <div key={p.id} className={`p-3 rounded-xl border flex items-center justify-between gap-3 ${isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-amber-500 text-white flex items-center justify-center font-bold text-xs shrink-0">
                    {p.name?.charAt(0) || <User className="w-4 h-4" />}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold truncate text-sm">{p.name}</p>
                    <p className="text-xs text-slate-400 truncate">{p.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleApprove(p)}
                    className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500 hover:text-white transition-all"
                  >
                    <UserCheck className="w-3.5 h-3.5" /> Approve
                  </button>
                  <button
                    onClick={() => handleDeny(p)}
                    className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-rose-500/10 text-rose-500 hover:bg-rose-500 hover:text-white transition-all"
                  >
                    <UserX className="w-3.5 h-3.5" /> Deny
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={`rounded-xl border overflow-hidden ${isDark ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-white'}`}>
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className={`text-left text-xs uppercase tracking-wider ${isDark ? 'text-slate-500 border-b border-slate-800' : 'text-slate-500 border-b border-slate-100'}`}>
              <th className="px-5 py-3 font-semibold">User</th>
              <th className="px-5 py-3 font-semibold">Role</th>
              <th className="px-5 py-3 font-semibold">Access level</th>
              <th className="px-5 py-3 font-semibold">Status</th>
              <th className="px-5 py-3 font-semibold text-right">Actions</th>
            </tr>
          </thead>
          <tbody className={isDark ? 'divide-y divide-slate-800' : 'divide-y divide-slate-100'}>
            {approvedProfiles.map(p => (
              <tr key={p.id}>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-full bg-blue-500 text-white flex items-center justify-center font-bold text-xs shrink-0">
                      {p.name?.charAt(0) || <User className="w-4 h-4" />}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold truncate">{p.name}{p.id === currentUser.id && ' (you)'}</p>
                      <p className="text-xs text-slate-400 truncate">{p.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-5 py-3">
                  <select
                    value={p.role}
                    disabled={p.id === currentUser.id}
                    onChange={(e) => updateUserRole(p.id, e.target.value)}
                    className={`text-xs font-bold rounded-lg px-2.5 py-1.5 border outline-none disabled:opacity-60 disabled:cursor-not-allowed ${roleBadgeClasses[p.role] || ''} ${isDark ? 'bg-slate-950' : 'bg-white'}`}
                  >
                    {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </td>
                <td className="px-5 py-3">
                  <div className="flex flex-col gap-1.5 min-w-[9.5rem]">
                    <select
                      aria-label={`Access level for ${p.name}`}
                      value={p.level || 'other'}
                      onChange={(e) => updateUserHierarchy(p.id, e.target.value, p.subDepartment)}
                      className={`text-xs font-semibold rounded-lg px-2 py-1.5 border outline-none ${isDark ? 'bg-slate-950 border-slate-700' : 'bg-white border-slate-200'}`}
                    >
                      {LEVELS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                    </select>
                    {(p.level === 'sub_dept_head' || p.level === 'staff') && (
                      <select
                        aria-label={`Department for ${p.name}`}
                        value={p.subDepartment || ''}
                        onChange={(e) => updateUserHierarchy(p.id, p.level, e.target.value)}
                        className={`text-xs rounded-lg px-2 py-1.5 border outline-none ${isDark ? 'bg-slate-950 border-slate-700' : 'bg-white border-slate-200'}`}
                      >
                        <option value="">Pick department…</option>
                        {SUB_DEPTS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                      </select>
                    )}
                  </div>
                </td>
                <td className="px-5 py-3">
                  <span className={`text-xs font-bold rounded-lg px-2.5 py-1 border ${p.isActive
                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                    : 'bg-rose-500/10 border-rose-500/20 text-rose-600 dark:text-rose-400'}`}>
                    {p.isActive ? 'Active' : 'Disabled'}
                  </span>
                </td>
                <td className="px-5 py-3 text-right">
                  <button
                    disabled={p.id === currentUser.id}
                    onClick={() => handleToggleUser(p)}
                    className={`inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed
                      ${p.isActive
                        ? 'bg-rose-500/10 text-rose-500 hover:bg-rose-500 hover:text-white'
                        : 'bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500 hover:text-white'}`}
                  >
                    {p.isActive ? <><Lock className="w-3.5 h-3.5" /> Disable</> : <><Unlock className="w-3.5 h-3.5" /> Enable</>}
                  </button>
                </td>
              </tr>
            ))}
            {approvedProfiles.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-sm text-slate-400">
                  <div className="flex flex-col items-center gap-2">
                    <Shield className="w-8 h-8 text-slate-300 dark:text-slate-700" />
                    No users found.
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>

      <p className="text-xs text-slate-500">
        Removing full access requires deleting the account from the Supabase dashboard
        (Authentication → Users) — disabling here immediately signs the user out and
        blocks sign-in without deleting their history.
      </p>
    </div>
  );
}
