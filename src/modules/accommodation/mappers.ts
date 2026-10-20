import { supabase } from '../walkie/lib/supabaseClient';
import { MEAL_PRESETS } from './types';
import { minutesOf } from './dates';
import type { MealRow, Member, Room, RoomRequirement } from './types';
import { collator } from '../../lib/ids';
export { uid } from '../../lib/ids';

// ---------------------------------------------------------------------------
// Row mappers (database snake_case  ->  UI camelCase)
// ---------------------------------------------------------------------------
export const mapRoom = (r: any, scopeKey = 'normal'): Room => ({
  id: r.id,
  eventId: r.event_id || null,
  name: r.name,
  category: r.category === 'control_room' ? 'control_room' : 'rest_room',
  block: r.block || '',
  capacity: r.capacity,
  notes: r.notes || '',
  responsibleTeam: r.responsible_team || '',
  requirements: (() => {
    const source = r.requirements_by_scope?.[scopeKey] ?? (scopeKey === 'normal' ? r.requirements : []);
    return Array.isArray(source)
      ? source
          .map((x: any) => ({
            name: String(x.name || ''),
            quantity: Math.max(0, Number(x.quantity) || 0),
            readyQuantity: Math.max(0, Number(x.readyQuantity) || 0),
            collectFrom: String(x.collectFrom || ''),
            returned: !!x.returned,
          }))
          .filter((x: RoomRequirement) => x.name)
      : [];
  })(),
  readyAt: r.readiness_by_scope?.[scopeKey]?.readyAt || '',
  returnedAt: r.readiness_by_scope?.[scopeKey]?.returnedAt || '',
  requirementsByScope: r.requirements_by_scope || {},
  readinessByScope: r.readiness_by_scope || {},
});

export const mapMember = (r: any): Member => ({
  id: r.id,
  name: r.name,
  department: r.department || '',
  roomId: r.room_id || null,
  memberType: r.member_type === 'permanent' ? 'salary_based' : r.member_type || 'salary_based',
  serialNo: r.serial_no || '',
  batchNo: r.batch_no || '',
  relation: r.relation || '',
  relationName: r.relation_name || '',
  mobile: r.mobile || '',
  villageCity: r.village_city || '',
  branch: r.branch || '',
  occupation: r.occupation || '',
  remarks: r.remarks || '',
  joiningDate: r.joining_date || '',
  employeeCode: r.employee_code || '',
  employeeId: r.employee_id || '',
  address: r.address || '',
  address2: r.address2 || '',
  callCount: r.call_count || 0,
  lastCallOutcome: r.last_call_outcome || '',
  lastCallAt: r.last_call_at || '',
  expectedArrival: r.expected_arrival || '',
  arrivalStatus: r.arrival_status || 'pending',
  arrivedAt: r.arrived_at || '',
  teamName: r.team_name || '',
  teamLead: r.team_lead || '',
});

export const mapMeal = (r: any): MealRow => ({
  id: r.id,
  date: r.menu_date,
  meal: r.meal,
  label:
    r.meal_label ||
    MEAL_PRESETS.find(x => x.key === r.meal)?.label ||
    (r.meal ? r.meal.charAt(0).toUpperCase() + r.meal.slice(1).replace(/-/g, ' ') : 'Meal'),
  start: String(r.start_time).slice(0, 5),
  end: String(r.end_time).slice(0, 5),
  items: r.items || '',
  status: r.status,
  changedAt: r.status_changed_at || null,
  changedBy: r.status_changed_by || '',
  readyAt: r.ready_at || '',
});

export const sortRooms = (a: Room, b: Room) =>
  collator.compare(`${a.block}\u0000${a.name}`, `${b.block}\u0000${b.name}`);

export const sortMembers = (a: Member, b: Member) => collator.compare(a.name, b.name);

export const sortMeals = (a: MealRow, b: MealRow) =>
  a.date === b.date ? minutesOf(a.start) - minutesOf(b.start) : a.date < b.date ? -1 : 1;

// Turn raw database / policy errors into something a person can act on.
export const friendlyError = (error: any): string => {
  const msg: string = error?.message || 'Unknown error';
  if (/row-level security|permission denied/i.test(msg)) return "You don't have permission to do that.";
  if (error?.code === '23505' || /duplicate key|already exists/i.test(msg))
    return 'That name already exists — pick a different one.';
  if (/meal_menu_meal_check/i.test(msg))
    return 'The database only allows breakfast, lunch, tea and dinner. Run supabase/migration_v9_custom_meals.sql in the Supabase SQL Editor to allow custom meals, then reload.';
  if (/meal_label/i.test(msg))
    return 'The database is missing meal_menu.meal_label. Run supabase/migration_v23_meal_label_repair.sql in the Supabase SQL Editor, then reload the app.';
  if (
    /accommodation_rooms.*(category|responsible_team)|(category|responsible_team).*accommodation_rooms|accommodation_update_room_requirements/i.test(
      msg,
    )
  )
    return 'Room categories and team-based requirements need migration v69. Run supabase/migration_v69_accommodation_room_categories.sql in the Supabase SQL Editor, then reload.';
  if (
    /event_requirement_id|accommodation_rooms.*event_id|event_requirements.*room_requirements|room_id.*accommodation_member_tasks/i.test(
      msg,
    )
  )
    return 'Event room requirements need migration v79. Run supabase/migration_v79_event_room_requirements.sql in the Supabase SQL Editor, then reload.';
  if (/scope_key|readiness_by_scope|requirements_by_scope/i.test(msg))
    return 'The database is missing event-scoped accommodation fields. Run supabase/migration_v63_accommodation_event_readiness.sql in the Supabase SQL Editor, then reload the app.';
  if (/member_type/i.test(msg))
    return 'The database still has the old member types. Run supabase/migration_v25_member_types.sql in the Supabase SQL Editor, then reload the app.';
  if (/call_count|last_call_outcome|expected_arrival|arrival_status|accommodation_member_tasks/i.test(msg))
    return 'The database is missing member operations fields. Run supabase/migration_v24_member_operations.sql in the Supabase SQL Editor, then reload the app.';
  if (/schema cache|does not exist|could not find/i.test(msg)) {
    return `${msg} — check that accommodation migrations v7, v8, v9, v22, v24, and v63 have been run in Supabase, then reload the app.`;
  }
  return msg;
};

// Supabase returns at most 1000 rows per request; page through so a big camp
// (hundreds of members) is never silently cut off.
export async function fetchAll(table: string, order: string, scopeKey?: string): Promise<{ data: any[]; error: any }> {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    let query: any = supabase.from(table).select('*');
    if (scopeKey) query = query.eq('scope_key', scopeKey);
    const { data, error } = await query.order(order, { ascending: true }).range(from, from + 999);
    if (error) return { data: [], error };
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return { data: out, error: null };
}
