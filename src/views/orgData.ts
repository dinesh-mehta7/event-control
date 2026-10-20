import type { SubDepartmentId } from '../types';
import { SUB_DEPARTMENTS } from '../lib/permissions';
import { DEPT_LABEL, DEPT_OPTIONS } from '../modules/accommodation/types';
import { useEffect, useState } from 'react';

export function useStore<T>(key: string, init: T): [T, (v: T) => void] {
  const [v, set] = useState<T>(() => {
    try {
      const s = localStorage.getItem(key);
      return s ? JSON.parse(s) : init;
    } catch {
      return init;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch {}
  }, [key, v]);
  return [v, set];
}
export const inr = (n: number) => '₹' + new Intl.NumberFormat('en-IN').format(n);

export const BUILT_IN_DEPTS: Record<SubDepartmentId, string> = {
  cctv: 'CCTV',
  wifi: 'WiFi',
  walkie: 'Walkie-Talkie',
  control: 'Control Rooms',
  inventory: 'Inventory',
  purchase: 'Purchase',
  accounts: 'Accounts',
  accommodation: 'Accommodation',
  sewadars: 'Sewadars',
};
// Built-in sub-departments plus the organization's own (Administration → Sub-departments).
// Filled in at runtime by PermissionsProvider, so every list and label in the app picks them up.
export const DEPTS: Record<SubDepartmentId, string> = { ...BUILT_IN_DEPTS };
// A row from org_sub_departments: either a custom one (key 'sd_…', owned by one department) or an
// organization-wide rename/hide of a built-in one (departmentId null).
export type CustomSubDepartment = { key: string; name: string; hidden: boolean; departmentId?: string | null };
// Custom sub-department key → the department it belongs to.
const SUB_OWNER: Record<string, string> = {};
export const isBuiltInSub = (key: string) => Object.prototype.hasOwnProperty.call(BUILT_IN_DEPTS, key);
export const applyCustomSubDepartments = (rows: CustomSubDepartment[]) => {
  const all = DEPTS as Record<string, string>;
  Object.getOwnPropertyNames(all).forEach(k => {
    delete all[k];
  });
  const byKey = new Map(rows.map(r => [r.key, r]));
  const entries: [string, string, boolean][] = [
    ...Object.entries(BUILT_IN_DEPTS).map(
      ([k, label]) => [k, byKey.get(k)?.name || label, !!byKey.get(k)?.hidden] as [string, string, boolean],
    ),
    ...rows.filter(r => !isBuiltInSub(r.key)).map(r => [r.key, r.name, r.hidden] as [string, string, boolean]),
  ];
  // Hidden ones stay readable (DEPTS[key] still gives the label for existing people and sewadars),
  // but are non-enumerable, so Object.keys / entries — which every picker uses — skip them.
  entries.forEach(([k, label, hidden]) =>
    Object.defineProperty(all, k, { value: label, enumerable: !hidden, writable: true, configurable: true }),
  );
  SUB_DEPARTMENTS.splice(0, SUB_DEPARTMENTS.length, ...(Object.keys(all) as SubDepartmentId[]));
  Object.keys(SUB_OWNER).forEach(k => {
    delete SUB_OWNER[k];
  });
  rows.forEach(r => {
    if (!isBuiltInSub(r.key) && r.departmentId) SUB_OWNER[r.key] = r.departmentId;
  });
  // Sewadar pickers use DEPT_OPTIONS / DEPT_LABEL.
  DEPT_OPTIONS.splice(0, DEPT_OPTIONS.length, ...Object.entries(all));
  Object.keys(DEPT_LABEL).forEach(k => {
    delete DEPT_LABEL[k];
  });
  entries.forEach(([k, label]) => {
    DEPT_LABEL[k] = label;
  });
};

// Sub-departments that only the IT department (departments.it_services) has.
export const IT_SERVICE_SUBS = ['cctv', 'wifi', 'walkie', 'control'];
// The sub-departments a person in this department can be given (visible ones only): the general
// built-ins, the IT services for the IT department, and that department's own custom ones.
export const subDepartmentsFor = (department?: { id?: string; itServices?: boolean } | null): SubDepartmentId[] =>
  (Object.keys(DEPTS) as SubDepartmentId[]).filter(k =>
    IT_SERVICE_SUBS.includes(k)
      ? !!department?.itServices
      : isBuiltInSub(k) || !SUB_OWNER[k] || SUB_OWNER[k] === department?.id,
  );
// Which department a custom sub-department belongs to (null for built-ins).
export const subDepartmentOwner = (key: string): string | null => SUB_OWNER[key] || null;

export const staffingCategoryKey = (value: string) => {
  const normalized = value.toLocaleLowerCase().replace(/[^a-z0-9]/g, '');
  return (
    Object.entries(DEPTS).find(([id, label]) =>
      [id, label].some(name => name.toLocaleLowerCase().replace(/[^a-z0-9]/g, '') === normalized),
    )?.[0] || value
  );
};
