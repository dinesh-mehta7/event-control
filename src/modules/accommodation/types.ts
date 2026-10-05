export type MealKey = string; // slug, e.g. 'breakfast', 'brunch', 'late-night-snack'
export type MealStatus = 'scheduled' | 'preparing' | 'distributing' | 'distributed';

export interface Room {
  id: string;
  name: string;
  block: string;
  capacity: number;
  notes: string;
}

export interface Member {
  id: string;
  name: string;
  department: string; // sub-department id or ''
  roomId: string | null;
  memberType: 'salary_based' | 'monthly' | 'annual';
  serialNo: string; batchNo: string; relation: string; relationName: string; mobile: string;
  villageCity: string; branch: string; occupation: string; remarks: string; joiningDate: string;
  employeeCode: string; employeeId: string; address: string; address2: string;
  callCount: number; lastCallOutcome: string; lastCallAt: string;
  expectedArrival: string; arrivalStatus: 'pending' | 'arrived' | 'not_coming'; arrivedAt: string;
  teamName: string; teamLead: string;
}

export type MemberImportRow = Partial<Omit<Member, 'id' | 'roomId'>> & Pick<Member, 'name'> & { roomId?: string | null };

export interface MealRow {
  id: string;
  date: string; // YYYY-MM-DD
  meal: MealKey;
  label: string; // display name
  start: string; // HH:MM
  end: string; // HH:MM
  items: string; // one dish per line
  status: MealStatus;
  changedAt: string | null;
  changedBy: string;
}

// Meals a new day starts with, and the quick-add presets. Anything else can be added as a custom meal.
export const MEALS: { key: MealKey; label: string; start: string; end: string }[] = [
  { key: 'breakfast', label: 'Breakfast', start: '07:00', end: '09:00' },
  { key: 'lunch', label: 'Lunch', start: '12:30', end: '14:30' },
  { key: 'tea', label: 'Tea Time', start: '16:30', end: '17:30' },
  { key: 'dinner', label: 'Dinner', start: '19:30', end: '21:30' },
];
export const MEAL_PRESETS: { key: MealKey; label: string; start: string; end: string }[] = [
  { key: 'breakfast', label: 'Breakfast', start: '07:00', end: '09:00' },
  { key: 'brunch', label: 'Brunch', start: '10:00', end: '11:30' },
  { key: 'lunch', label: 'Lunch', start: '12:30', end: '14:30' },
  { key: 'tea', label: 'Tea Time', start: '16:30', end: '17:30' },
  { key: 'snacks', label: 'Snacks', start: '17:30', end: '18:30' },
  { key: 'dinner', label: 'Dinner', start: '19:30', end: '21:30' },
];
export const mealSlug = (label: string) => label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

export const STATUS_STEPS: { key: MealStatus; label: string; short: string }[] = [
  { key: 'scheduled', label: 'Not started', short: 'Scheduled' },
  { key: 'preparing', label: 'In preparation', short: 'Preparing' },
  { key: 'distributing', label: 'In distribution', short: 'Distributing' },
  { key: 'distributed', label: 'Distributed', short: 'Distributed' },
];

export const DEPT_OPTIONS: [string, string][] = [
  ['cctv', 'CCTV'], ['wifi', 'WiFi'], ['walkie', 'Walkie-Talkie'], ['control', 'Control Rooms'],
  ['inventory', 'Inventory'], ['purchase', 'Purchase'], ['accommodation', 'Accommodation'], ['sewadars', 'Sewadars'],
];
export const DEPT_LABEL: Record<string, string> = Object.fromEntries(DEPT_OPTIONS);
