import React, { useCallback, useEffect, useState } from 'react';
import { roleLabel } from '../lib/roles';
import { applyTheme } from '../hooks/useMotion';
import { useApp } from '../context/AppContext';
import type { UserProfile } from '../types';
import { useWalkie, PendingApprovalView } from '../modules/walkie';
import AuthScreen, { AuthFlashOut } from '../modules/walkie/components/AuthScreen';
import { Shell } from './Shell';

const toProfile = (w: any, departmentName?: string): UserProfile => ({
  id: w.id,
  name: w.name || w.email,
  email: w.email,
  phone: '',
  departmentName: departmentName || '',
  designation: roleLabel(w.level, w.subDepartment, departmentName),
  role:
    ({ owner: 'owner', dept_head: 'dept_head', sub_dept_head: 'sub_dept_head', staff: 'staff' } as any)[w.level] ||
    'volunteer',
  subDepartmentId: w.subDepartment || undefined,
  avatar: String(w.name || 'U')
    .slice(0, 2)
    .toUpperCase(),
  badgeId: String(w.id).slice(0, 6),
  permissions: ['view', 'create', 'edit', 'approve', 'assign', 'export'],
  status: 'active',
  lastActive: 'Now',
});

const Loader = () => <div className="min-h-screen flex items-center justify-center text-sm text-faint">Loading…</div>;

// One login for everything: Supabase auth (RadioGate screens). Its profile decides the hierarchy level.
export const Gate: React.FC = () => {
  const w: any = useWalkie();
  useEffect(() => {
    applyTheme(w.settings?.theme === 'dark', w.settings?.palette);
  }, [w.settings?.theme, w.settings?.palette]);
  const { setCurrentUser } = useApp();
  const [ready, setReady] = useState(false);
  const wu = w.currentUser;
  const wuDept = (w.departments || []).find((d: any) => d.id === wu?.departmentId)?.name;
  useEffect(() => {
    if (wu && wu.approved) {
      setCurrentUser(toProfile(wu, wuDept));
      setReady(true);
    } else setReady(false);
  }, [wu, wuDept]); // eslint-disable-line
  // The sign-in screen stays up while its welcome animation plays, then light fades over the app.
  const [ceremony, setCeremony] = useState(false);
  const [flashOut, setFlashOut] = useState(false);
  const finishCeremony = useCallback(() => {
    setCeremony(false);
    setFlashOut(true);
    setTimeout(() => setFlashOut(false), 950);
  }, []);
  if (!w.authChecked) return <Loader />;
  if (!wu || ceremony || w.authView === 'reset')
    return <AuthScreen onCeremony={setCeremony} onFinished={finishCeremony} />;
  const flash = flashOut ? <AuthFlashOut /> : null;
  if (!wu.approved)
    return (
      <>
        {flash}
        <PendingApprovalView />
      </>
    );
  return ready ? (
    <>
      {flash}
      <Shell out={w.logout} />
    </>
  ) : (
    <>
      {flash}
      <Loader />
    </>
  );
};
