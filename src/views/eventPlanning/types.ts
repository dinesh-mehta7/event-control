import type { RoomRequirement } from '../../modules/accommodation/types';

export type EventPlan = {
  id: string;
  name: string;
  location: string;
  starts_at: string;
  ends_at: string | null;
  owner_name: string;
  owner_department_id?: string | null;
  status: string;
  event_type?: 'monthly' | 'annual' | 'special';
  special_member_ids?: string[];
  staffing_days_before?: number;
  staffing_days_after?: number;
};

export type Requirement = {
  id: string;
  category: string;
  inventory_item_id: string | null;
  department_id: string | null;
  department_name: string;
  title: string;
  quantity: number;
  unit: string;
  notes: string;
  collect_from?: string;
  collect_from_department?: string;
  collect_from_location?: string;
  status: string;
  accommodation_category?: string | null;
  room_requirements?: RoomRequirement[] | null;
  created_at?: string;
};

export type EventFeedback = {
  id: string;
  kind: string;
  title: string;
  details: string;
  reporter_name: string;
  sub_department: string;
  status: string;
  created_at: string;
};

export type Attendance = {
  id: string;
  member_id: string;
  member_name: string;
  status: string;
  checked_in_at: string | null;
  checked_out_at: string | null;
  notes: string;
};

export type BadgeOperation = {
  id: string;
  member_id: string;
  badge_issued: boolean;
  badge_at: string | null;
  badge_returned: boolean;
  badge_returned_at: string | null;
  arrival_status: string;
  arrived_at: string | null;
};

export type RadioReturnReport = {
  id: string;
  department_name: string;
  returned_walkies: number;
  returned_chargers: number;
  returned_earphones: number;
  returned_at: string | null;
  return_feedback: string;
  status: string;
  updated_at: string;
};

export type EventRadioRequest = {
  id: string;
  department_name: string;
  collect_from: string;
  walkie_count: number;
  charger_count: number;
  earphone_count: number;
  status: string;
  created_at: string;
};

export type Review = {
  id: string;
  lessons_learned: string;
  issues_faced: string;
  recommendations: string;
  closure_report: string;
};

export type DailyStaffingRequirement = {
  id: string;
  event_id: string;
  requirement_date: string;
  category: string;
  required_count: number;
  notes: string;
};
