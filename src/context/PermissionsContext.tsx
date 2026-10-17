import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../modules/walkie/lib/supabaseClient';
import { useApp as useWalkie } from '../modules/walkie/context/AppContext';
import { isAllowed, permKey } from '../lib/permissions';
import type { ModuleKey, ModuleQuery, PermissionMap } from '../lib/permissions';

// Which modules each sub-department can open. Super Admin and Department Heads always see everything.
interface Ctx {
  map: PermissionMap; ready: boolean; loadError: string; canEdit: boolean;
  can: (module: ModuleQuery) => boolean;                                 // the signed-in person ('sewadars' = any Sewadar page)
  allowedFor: (sub: string, module: ModuleKey) => boolean;               // any sub-department (admin grid)
  setAccess: (sub: string, module: ModuleKey, allowed: boolean | null) => Promise<boolean>; // null = back to default
  resetSub: (sub: string) => Promise<boolean>;
}
const C = createContext<Ctx | null>(null);
export const usePermissions = (): Ctx => { const c = useContext(C); if (!c) throw new Error('usePermissions must be used inside <PermissionsProvider>'); return c; };

export const PermissionsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const w: any = useWalkie();
  const u = w.currentUser;
  const orgId: string | undefined = u?.approved ? u.organizationId : undefined;
  const level: string = u?.level || 'other';
  const exec = level === 'owner' || level === 'dept_head';
  const [map, setMap] = useState<PermissionMap>({});
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    if (!orgId) return;
    const { data, error } = await supabase.from('sub_department_permissions').select('sub_department,module,allowed').eq('organization_id', orgId);
    // Table missing (migration not run yet): fall back to the built-in defaults silently for users.
    setLoadError(error ? `${error.message} — run supabase/migration_v91_sub_department_permissions.sql in the Supabase SQL Editor, then reload.` : '');
    setMap(Object.fromEntries((data || []).map((r: any) => [permKey(r.sub_department, r.module), !!r.allowed])));
    setReady(true);
  }, [orgId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!orgId) return;
    const ch = supabase.channel(`sub-dept-perms-${orgId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sub_department_permissions', filter: `organization_id=eq.${orgId}` }, () => void load())
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [orgId, load]);

  const can = useCallback((module: ModuleQuery) => exec || isAllowed(map, u?.subDepartment, module), [exec, map, u?.subDepartment]);
  const allowedFor = useCallback((sub: string, module: ModuleKey) => isAllowed(map, sub, module), [map]);

  const setAccess: Ctx['setAccess'] = async (sub, module, allowed) => {
    if (!orgId || !exec) return false;
    const key = permKey(sub, module); const before = map[key];
    setMap(m => { const n = { ...m }; if (allowed === null) delete n[key]; else n[key] = allowed; return n; });
    const { error } = allowed === null
      ? await supabase.from('sub_department_permissions').delete().eq('organization_id', orgId).eq('sub_department', sub).eq('module', module)
      : await supabase.from('sub_department_permissions').upsert({ organization_id: orgId, sub_department: sub, module, allowed, updated_by: u?.name || '', updated_at: new Date().toISOString() });
    if (error) {
      setMap(m => { const n = { ...m }; if (before === undefined) delete n[key]; else n[key] = before; return n; });
      w.addToast?.(`Could not save access: ${error.message}${/sub_department_permissions|schema cache|does not exist/i.test(error.message) ? ' — run supabase/migration_v91_sub_department_permissions.sql.' : ''}`, 'error');
      return false;
    }
    return true;
  };
  const resetSub: Ctx['resetSub'] = async sub => {
    if (!orgId || !exec) return false;
    const { error } = await supabase.from('sub_department_permissions').delete().eq('organization_id', orgId).eq('sub_department', sub);
    if (error) { w.addToast?.(`Could not reset: ${error.message}`, 'error'); return false; }
    await load(); return true;
  };

  const value = useMemo<Ctx>(() => ({ map, ready, loadError, canEdit: exec, can, allowedFor, setAccess, resetSub }), [map, ready, loadError, exec, can, allowedFor]); // eslint-disable-line
  return <C.Provider value={value}>{children}</C.Provider>;
};
