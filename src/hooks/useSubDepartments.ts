import { useApp as useWalkie } from '../modules/walkie/context/AppContext';
import { DEPTS, homeDepartmentOf, subDepartmentsFor } from '../views/orgData';

// [key, label] pairs for a sub-department dropdown, limited to one department's own sub-departments
// (e.g. IT → CCTV, WiFi, Walkie-Talkie, Control Rooms … plus the general ones and IT's custom ones).
// departmentId: that department; 'all' → every sub-department; omitted → the signed-in person's
// department (the Super Admin's "Adding to" choice), or every sub-department when there is none.
// keep: a value already saved on the record, kept in the list even if it belongs to another department.
export function useSubDepartmentOptions(departmentId?: string, keep?: string | null): [string, string][] {
  const w: any = useWalkie();
  const departments: { id: string; itServices?: boolean }[] = w.departments || [];
  const id = departmentId ?? homeDepartmentOf(w.currentUser);
  const labels = DEPTS as Record<string, string>;
  const keys: string[] = !id || id === 'all' ? Object.keys(DEPTS) : subDepartmentsFor(departments.find(d => d.id === id));
  if (keep && !keys.includes(keep) && labels[keep]) keys.push(keep);
  return keys.map(k => [k, labels[k] || k]);
}
