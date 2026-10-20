import { DEPTS } from '../views/orgData';

// The organisation hierarchy, top to bottom. Database `profiles.level` values on the left.
//   owner          Super Admin            — over all departments
//   dept_head      Department Head        — heads one department (profiles.department_id → departments)
//   sub_dept_head  Sub-department Head    — heads one sub-department of their department (profiles.sub_department)
//   staff          Staff                  — works in one sub-department of their department
//   other          No access yet          — signed up, not yet given a role
export const ROLE_LABEL: Record<string, string> = {
  owner: 'Super Admin',
  dept_head: 'Department Head',
  sub_dept_head: 'Sub-department Head',
  staff: 'Staff',
  other: 'No role yet',
};
export const ROLE_TONE: Record<string, string> = {
  owner: 'bg-amber-500/15 text-amber-300',
  dept_head: 'bg-blue-500/15 text-blue-300',
  sub_dept_head: 'bg-blue-500/15 text-blue-300',
  staff: 'bg-raised text-ink-soft',
  other: 'bg-raised text-mute',
};
export const subDeptLabel = (sub?: string | null) => (sub ? DEPTS[sub as keyof typeof DEPTS] || sub : '');

// "Department Head · IT COMMUNICATIONS", "Sub-department Head · CCTV · IT COMMUNICATIONS", "Super Admin".
export const roleLabel = (level?: string | null, sub?: string | null, departmentName?: string | null) => {
  const base = ROLE_LABEL[level || 'other'] || ROLE_LABEL.other;
  if (level === 'dept_head') return departmentName ? `${base} · ${departmentName}` : base;
  if (level === 'sub_dept_head' || level === 'staff')
    return [base, subDeptLabel(sub), departmentName].filter(Boolean).join(' · ');
  return base;
};
