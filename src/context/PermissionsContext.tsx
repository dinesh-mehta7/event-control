import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../modules/walkie/lib/supabaseClient';
import { useApp as useWalkie } from '../modules/walkie/context/AppContext';
import { IT_MODULES, isAllowed, permKey } from '../lib/permissions';
import type { ModuleKey, ModuleQuery, PermissionMap } from '../lib/permissions';
import { applyCustomSubDepartments } from '../views/orgData';
import type { CustomSubDepartment } from '../views/orgData';

// Which modules each sub-department of each department can open. The Super Admin sees everything; a
// Department Head sees everything in their department except IT services, which only the IT department has.
interface Ctx {
  map: PermissionMap;
  ready: boolean;
  loadError: string;
  canEdit: boolean; // may change the grid of gridDept
  can: (module: ModuleQuery) => boolean; // the signed-in person ('sewadars' = any Sewadar page)
  // The admin grid works on one department at a time (Super Admin can switch; a Department Head has their own).
  gridDept: string;
  setGridDept: (departmentId: string) => void;
  allowedFor: (sub: string, module: ModuleKey) => boolean; // a sub-department of gridDept
  setAccess: (sub: string, module: ModuleKey, allowed: boolean | null) => Promise<boolean>; // null = back to default
  resetSub: (sub: string) => Promise<boolean>;
  // The organization's own sub-departments (built-in ones are in BUILT_IN_DEPTS). Errors come back as text.
  customSubs: CustomSubDepartment[];
  subsError: string;
  createSub: (name: string, departmentId: string) => Promise<string | null>;
  renameSub: (key: string, name: string) => Promise<string | null>;
  deleteSub: (key: string) => Promise<string | null>;
  hideSub: (key: string, hidden: boolean) => Promise<string | null>;
  resetSubName: (key: string) => Promise<string | null>; // built-in: back to its original name, visible
}
const C = createContext<Ctx | null>(null);
export const usePermissions = (): Ctx => {
  const c = useContext(C);
  if (!c) throw new Error('usePermissions must be used inside <PermissionsProvider>');
  return c;
};

export const PermissionsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const w: any = useWalkie();
  const u = w.currentUser;
  const orgId: string | undefined = u?.approved ? u.organizationId : undefined;
  const level: string = u?.level || 'other';
  const exec = level === 'owner' || level === 'dept_head';
  const departments: { id: string; itServices?: boolean }[] = w.departments || [];
  const myDept = departments.find(d => d.id === u?.departmentId);
  // Until departments load, don't hide IT pages (the database enforces it anyway).
  const outsideIt = level !== 'owner' && !!myDept && !myDept.itServices;
  const [chosenGridDept, setGridDept] = useState('');
  const gridDept =
    level === 'owner'
      ? chosenGridDept || departments.find(d => d.itServices)?.id || departments[0]?.id || ''
      : u?.departmentId || '';
  const [map, setMap] = useState<PermissionMap>({});
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [customSubs, setCustomSubs] = useState<CustomSubDepartment[]>([]);
  const [subsError, setSubsError] = useState('');

  const load = useCallback(async () => {
    if (!orgId) return;
    const { data, error } = await supabase
      .from('sub_department_permissions')
      .select('department_id,sub_department,module,allowed')
      .eq('organization_id', orgId);
    // Table missing (migration not run yet): fall back to the built-in defaults silently for users.
    setLoadError(
      error
        ? `${error.message} — run supabase/migration_v100_department_sub_departments.sql in the Supabase SQL Editor, then reload.`
        : '',
    );
    setMap(
      Object.fromEntries(
        (data || []).map((r: any) => [permKey(r.department_id || '', r.sub_department, r.module), !!r.allowed]),
      ),
    );
    setReady(true);
  }, [orgId]);
  useEffect(() => {
    void load();
  }, [load]);

  const loadSubs = useCallback(async () => {
    if (!orgId) return;
    const { data, error } = await supabase
      .from('org_sub_departments')
      .select('key,name,hidden,department_id')
      .eq('organization_id', orgId)
      .order('name');
    setSubsError(
      error
        ? `${error.message} — run supabase/migration_v96_custom_sub_departments.sql and migration_v97_sub_department_rename_hide.sql in the Supabase SQL Editor, then reload.`
        : '',
    );
    const list = (data || []).map((r: any) => ({
      key: r.key as string,
      name: r.name as string,
      hidden: !!r.hidden,
      departmentId: (r.department_id as string) || null,
    }));
    applyCustomSubDepartments(list);
    setCustomSubs(list);
  }, [orgId]);
  useEffect(() => {
    void loadSubs();
  }, [loadSubs]);
  useEffect(() => {
    if (!orgId) return;
    const ch = supabase
      .channel(`org-sub-depts-${orgId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'org_sub_departments', filter: `organization_id=eq.${orgId}` },
        () => void loadSubs(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [orgId, loadSubs]);
  const subRpc = async (fn: string, args: Record<string, string | boolean>) => {
    const { error } = await supabase.rpc(fn, args);
    if (error) return error.message;
    await loadSubs();
    return null;
  };
  const createSub = (name: string, departmentId: string) =>
    subRpc('create_sub_department', { p_name: name, p_department_id: departmentId });
  const renameSub = (key: string, name: string) => subRpc('rename_sub_department', { p_key: key, p_name: name });
  const hideSub = (key: string, hidden: boolean) =>
    subRpc('set_sub_department_hidden', { p_key: key, p_hidden: hidden });
  const resetSubName = (key: string) => subRpc('reset_sub_department', { p_key: key });
  const deleteSub = async (key: string) => {
    const e = await subRpc('delete_sub_department', { p_key: key });
    if (!e) await load();
    return e;
  };
  useEffect(() => {
    if (!orgId) return;
    const ch = supabase
      .channel(`sub-dept-perms-${orgId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sub_department_permissions', filter: `organization_id=eq.${orgId}` },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [orgId, load]);

  const can = useCallback(
    (module: ModuleQuery) => {
      if (level === 'owner') return true;
      if (outsideIt && IT_MODULES.includes(module as ModuleKey)) return false;
      return level === 'dept_head' || isAllowed(map, u?.departmentId, u?.subDepartment, module);
    },
    [level, outsideIt, map, u?.departmentId, u?.subDepartment],
  );
  const allowedFor = useCallback(
    (sub: string, module: ModuleKey) => isAllowed(map, gridDept, sub, module),
    [map, gridDept],
  );
  const canEdit = exec && !!gridDept;

  const setAccess: Ctx['setAccess'] = async (sub, module, allowed) => {
    if (!orgId || !canEdit) return false;
    const key = permKey(gridDept, sub, module);
    const before = map[key];
    setMap(m => {
      const n = { ...m };
      if (allowed === null) delete n[key];
      else n[key] = allowed;
      return n;
    });
    const { error } =
      allowed === null
        ? await supabase
            .from('sub_department_permissions')
            .delete()
            .eq('organization_id', orgId)
            .eq('department_id', gridDept)
            .eq('sub_department', sub)
            .eq('module', module)
        : await supabase.from('sub_department_permissions').upsert({
            organization_id: orgId,
            department_id: gridDept,
            sub_department: sub,
            module,
            allowed,
            updated_by: u?.name || '',
            updated_at: new Date().toISOString(),
          });
    if (error) {
      setMap(m => {
        const n = { ...m };
        if (before === undefined) delete n[key];
        else n[key] = before;
        return n;
      });
      w.addToast?.(
        `Could not save access: ${error.message}${/sub_department_permissions|schema cache|does not exist/i.test(error.message) ? ' — run supabase/migration_v100_department_sub_departments.sql.' : ''}`,
        'error',
      );
      return false;
    }
    return true;
  };
  const resetSub: Ctx['resetSub'] = async sub => {
    if (!orgId || !canEdit) return false;
    const { error } = await supabase
      .from('sub_department_permissions')
      .delete()
      .eq('organization_id', orgId)
      .eq('department_id', gridDept)
      .eq('sub_department', sub);
    if (error) {
      w.addToast?.(`Could not reset: ${error.message}`, 'error');
      return false;
    }
    await load();
    return true;
  };

  const value = useMemo<Ctx>(
    () => ({
      map,
      ready,
      loadError,
      canEdit,
      can,
      gridDept,
      setGridDept,
      allowedFor,
      setAccess,
      resetSub,
      customSubs,
      subsError,
      createSub,
      renameSub,
      deleteSub,
      hideSub,
      resetSubName,
    }),
    [map, ready, loadError, canEdit, can, gridDept, allowedFor, customSubs, subsError],
  ); // eslint-disable-line
  return <C.Provider value={value}>{children}</C.Provider>;
};
