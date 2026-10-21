import type { SewadarInput } from '../ManpowerContext';

// The command-center shell is always dark, so this module is dark-only.
export const D = true;

export const panel = 'rounded-lg border border-line bg-surface/50';

// ---------------------------------------------------------------------------
export const emptySewadar = (): SewadarInput => ({
  name: '',
  memberType: 'monthly',
  serialNo: '',
  batchNo: '',
  phone: '',
  department: '',
  relation: '',
  relationName: '',
  villageCity: '',
  branch: '',
  occupation: '',
  remarks: '',
  joiningDate: '',
  employeeCode: '',
  employeeId: '',
  address: '',
  address2: '',
  expectedArrival: '',
  expectedArrivalPeriod: '',
  skills: [],
  teamName: '',
  teamLead: '',
  teams: [],
  shift: '',
  deviceType: 'none',
  deviceRef: '',
});
