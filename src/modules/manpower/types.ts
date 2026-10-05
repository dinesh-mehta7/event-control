export type Arrival = 'pending' | 'arrived' | 'not_coming';
export type CallOutcome = 'coming' | 'later' | 'not_coming' | 'no_answer' | 'busy' | 'off' | 'wrong';
export type DeviceType = 'none' | 'walkie' | 'phone' | 'laptop' | 'tablet' | 'other';
export type SewadarMemberType = 'salary_based' | 'monthly' | 'annual';

export interface Sewadar {
  id: string;
  name: string;
  memberType: SewadarMemberType;
  serialNo: string;
  batchNo: string;
  phone: string;
  department: string; // sub-department id or ''
  relation: string;
  relationName: string;
  villageCity: string;
  branch: string;
  occupation: string;
  remarks: string;
  joiningDate: string;
  employeeCode: string;
  employeeId: string;
  address: string;
  address2: string;
  expectedArrival: string;
  teamName: string;
  teamLead: string;
  shift: 'night' | 'morning' | '';
  deviceType: DeviceType;
  deviceRef: string;
  arrival: Arrival;
  arrivedAt: string | null;
  badgeIssued: boolean;
  badgeAt: string | null;
  callCount: number;
  lastCallAt: string | null;
  lastCallOutcome: CallOutcome | null;
  lastCallBy: string;
}

export interface CallLog { id: string; sewadarId: string; outcome: CallOutcome; note: string; calledBy: string; calledAt: string }

export const OUTCOMES: { key: CallOutcome; label: string; tone: 'ok' | 'warn' | 'bad' | 'mute' }[] = [
  { key: 'coming', label: 'Answered · Coming', tone: 'ok' },
  { key: 'later', label: 'Answered · Will confirm later', tone: 'warn' },
  { key: 'not_coming', label: 'Answered · Not coming', tone: 'bad' },
  { key: 'no_answer', label: 'No answer', tone: 'warn' },
  { key: 'busy', label: 'Busy · call back', tone: 'warn' },
  { key: 'off', label: 'Switched off / unreachable', tone: 'mute' },
  { key: 'wrong', label: 'Wrong number', tone: 'bad' },
];
export const OUTCOME_LABEL: Record<CallOutcome, string> = Object.fromEntries(OUTCOMES.map(o => [o.key, o.label])) as any;
export const OUTCOME_TONE: Record<CallOutcome, 'ok' | 'warn' | 'bad' | 'mute'> = Object.fromEntries(OUTCOMES.map(o => [o.key, o.tone])) as any;

export const DEVICES: { key: DeviceType; label: string }[] = [
  { key: 'none', label: 'No device' },
  { key: 'walkie', label: 'Walkie-Talkie' },
  { key: 'phone', label: 'Mobile' },
  { key: 'laptop', label: 'Laptop' },
  { key: 'tablet', label: 'Tablet' },
  { key: 'other', label: 'Other' },
];
export const DEVICE_LABEL: Record<DeviceType, string> = Object.fromEntries(DEVICES.map(d => [d.key, d.label])) as any;
