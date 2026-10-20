import type { CallLog, Sewadar } from './types';
import { collator } from '../../lib/ids';
export { uid } from '../../lib/ids';

export const mapSewadar = (r: any): Sewadar => ({
  id: r.id,
  name: r.name,
  memberType: r.member_type === 'monthly' || r.member_type === 'annual' ? r.member_type : 'salary_based',
  serialNo: r.serial_no || '',
  batchNo: r.batch_no || '',
  phone: r.mobile || r.phone || '',
  department: r.department || '',
  relation: r.relation || '',
  relationName: r.relation_name || '',
  villageCity: r.village_city || '',
  branch: r.branch || '',
  occupation: r.occupation || '',
  remarks: r.remarks || '',
  joiningDate: r.joining_date || '',
  employeeCode: r.employee_code || '',
  employeeId: r.employee_id || '',
  address: r.address || '',
  address2: r.address2 || '',
  expectedArrival: r.expected_arrival || '',
  expectedArrivalPeriod: r.expected_arrival_period || '',
  skills: Array.isArray(r.skills) ? r.skills : [],
  teamName: r.team_name || '',
  teamLead: r.team_lead || '',
  teams: Array.isArray(r.team_names) && r.team_names.length ? r.team_names : r.team_name ? [r.team_name] : [],
  shift: r.shift || '',
  wentHomeAt: r.went_home_at || null,
  returnedFromHomeAt: r.returned_from_home_at || null,
  totalHolidayDays: Number(r.total_holiday_days) || 0,
  deviceType: r.device_type || 'none',
  deviceRef: r.device_ref || '',
  arrival: r.arrival_status || r.arrival || 'pending',
  arrivedAt: r.arrived_at || null,
  returnedBack: false,
  badgeIssued: !!r.badge_issued,
  badgeAt: r.badge_at || null,
  badgeReturned: !!r.badge_returned,
  badgeReturnedAt: r.badge_returned_at || null,
  callCount: r.call_count || 0,
  lastCallAt: r.last_call_at || null,
  lastCallOutcome: r.last_call_outcome || null,
  lastCallBy: r.last_call_by || '',
});

export const mapCall = (r: any): CallLog => ({
  id: r.id,
  sewadarId: r.member_id || r.sewadar_id,
  outcome: r.outcome,
  note: r.note || '',
  calledBy: r.called_by || '',
  calledAt: r.called_at,
});

export const sortSewadars = (a: Sewadar, b: Sewadar) => collator.compare(a.name, b.name);

export const chunk = <T>(a: T[], n: number) =>
  Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

export const friendlyError = (error: any): string => {
  const msg: string = error?.message || 'Unknown error';
  if (/row-level security|permission denied/i.test(msg)) return "You don't have permission to do that.";
  if (error?.code === '23505' || /duplicate key/i.test(msg)) return 'A record with those details already exists.';
  if (
    /arrival_schedule_overridden|sewadar_event_operations.*expected_arrival|expected_arrival.*sewadar_event_operations/i.test(
      msg,
    )
  )
    return `${msg} — run supabase/migration_v64_event_arrival_time.sql, then reload the schema.`;
  if (/skills|expected_arrival_period/i.test(msg))
    return `${msg} — run supabase/migration_v57_sewadar_roster_skills_arrival_period.sql, then reload the schema.`;
  if (/schema cache|does not exist|could not find/i.test(msg))
    return `${msg} — run supabase/migration_v26_shared_member_roster.sql in the Supabase SQL Editor, then reload.`;
  return msg;
};
