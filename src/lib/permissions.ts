import type { SubDepartmentId } from '../types';

// Every page a sub-department can be given. `key` matches the page address (#/<key>, or #/sewadars/<tab>).
export type ModuleKey =
  | 'helpdesk'
  | 'cctv'
  | 'cctv-control-room'
  | 'wifi'
  | 'walkie'
  | 'control'
  | 'networking-support'
  | 'issues'
  | 'accommodation'
  | 'sewadars:roster'
  | 'sewadars:permanent'
  | 'sewadars:calling'
  | 'sewadars:duties'
  | 'sewadars:teams'
  | 'sewadars:attendance'
  | 'tasks'
  | 'inventory'
  | 'requests'
  | 'purchase'
  | 'events'
  | 'meetings'
  | 'reports';
// 'sewadars' asks "any Sewadar page".
export type ModuleQuery = ModuleKey | 'sewadars';

export type ModuleGroup =
  | 'IT Services & Operations'
  | 'Volunteer Management'
  | 'Stocks and Approvals'
  | 'Coordination'
  | 'Administration';
export const MODULES: { key: ModuleKey; label: string; group: ModuleGroup; hint: string }[] = [
  { key: 'helpdesk', label: 'Help Desk', group: 'IT Services & Operations', hint: 'Raise and track IT tickets' },
  { key: 'cctv', label: 'CCTV', group: 'IT Services & Operations', hint: 'Cameras, NVRs and their status' },
  {
    key: 'cctv-control-room',
    label: 'CCTV Control Room',
    group: 'IT Services & Operations',
    hint: 'Control rooms, PCs, shift roster',
  },
  { key: 'wifi', label: 'WiFi', group: 'IT Services & Operations', hint: 'Access points and WiFi access register' },
  { key: 'walkie', label: 'Walkie-Talkie', group: 'IT Services & Operations', hint: 'Radios, allocations, returns' },
  { key: 'control', label: 'Control Rooms', group: 'IT Services & Operations', hint: 'Control room status' },
  { key: 'networking-support', label: 'Networking Support', group: 'IT Services & Operations', hint: 'Coming soon' },
  {
    key: 'issues',
    label: 'Issues & Reports',
    group: 'IT Services & Operations',
    hint: 'Member issues and announcements',
  },
  { key: 'accommodation', label: 'Accommodation', group: 'Volunteer Management', hint: 'Rooms, members, meal menu' },
  {
    key: 'sewadars:roster',
    label: 'Sewadar Master',
    group: 'Volunteer Management',
    hint: 'Member roster and arrivals',
  },
  {
    key: 'sewadars:permanent',
    label: 'IT Department Permanent Staff',
    group: 'Volunteer Management',
    hint: 'Permanent staff, home leave',
  },
  { key: 'sewadars:calling', label: 'Calling', group: 'Volunteer Management', hint: 'Call members before the event' },
  { key: 'sewadars:attendance', label: 'Attendance', group: 'Volunteer Management', hint: 'Arrived, returned, badges' },
  { key: 'sewadars:duties', label: 'Duties & Shifts', group: 'Volunteer Management', hint: 'Daily shift roster' },
  { key: 'sewadars:teams', label: 'Teams', group: 'Volunteer Management', hint: 'Teams and team leads' },
  { key: 'tasks', label: 'Tasks', group: 'Volunteer Management', hint: 'Team tasks and resources' },
  { key: 'inventory', label: 'Inventory', group: 'Stocks and Approvals', hint: 'Stock, issues, returns' },
  { key: 'requests', label: 'Requests', group: 'Stocks and Approvals', hint: 'Raise and approve requests' },
  { key: 'purchase', label: 'Procurement', group: 'Stocks and Approvals', hint: 'Orders, vendors, payments' },
  { key: 'events', label: 'Event Planning', group: 'Coordination', hint: 'Events and requirements (view)' },
  { key: 'meetings', label: 'Meetings & Emergency', group: 'Coordination', hint: 'Meetings and emergency alerts' },
  { key: 'reports', label: 'Reports', group: 'Administration', hint: 'Organisation reports' },
];
export const MODULE_GROUPS: ModuleGroup[] = [
  'IT Services & Operations',
  'Volunteer Management',
  'Stocks and Approvals',
  'Coordination',
  'Administration',
];
export const SUB_DEPARTMENTS: SubDepartmentId[] = [
  'cctv',
  'wifi',
  'walkie',
  'control',
  'inventory',
  'purchase',
  'accounts',
  'accommodation',
  'sewadars',
];
export const SEWADAR_TABS = ['roster', 'permanent', 'calling', 'duties', 'teams', 'attendance'] as const;

// What each sub-department gets when nothing has been changed (matches how the app behaved before).
export const defaultAllowed = (sub: string, module: ModuleKey): boolean => {
  if (['helpdesk', 'requests', 'tasks', 'events', 'meetings', 'issues', 'accommodation'].includes(module)) return true;
  if (module === 'reports' || module === 'networking-support') return false;
  if (module.startsWith('sewadars:')) return sub === 'sewadars';
  if (module === 'cctv-control-room') return sub === 'cctv' || sub === 'control';
  if (module === 'purchase') return ['purchase', 'inventory', 'accounts'].includes(sub);
  return sub === module;
};

// Saved overrides: "<sub>:<module>" → allowed. Only differences from the defaults are stored.
export type PermissionMap = Record<string, boolean>;
export const permKey = (sub: string, module: string) => `${sub}:${module}`;
export const isAllowed = (map: PermissionMap, sub: string | null | undefined, module: ModuleQuery): boolean => {
  if (module === 'sewadars') return SEWADAR_TABS.some(t => isAllowed(map, sub, `sewadars:${t}` as ModuleKey));
  if (!sub) return module === 'helpdesk' || module === 'requests'; // no sub-department yet: raise tickets and requests only
  const saved = map[permKey(sub, module)];
  return saved === undefined ? defaultAllowed(sub, module) : saved;
};
