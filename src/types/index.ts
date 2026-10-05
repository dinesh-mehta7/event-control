export type SubDepartmentId = 
  | 'cctv'
  | 'wifi'
  | 'walkie'
  | 'control'
  | 'inventory'
  | 'purchase'
  | 'accommodation'
  | 'sewadars';

export type UserRole = 
  | 'owner'               // Super Admin
  | 'dept_head'           // Department Head
  | 'sub_dept_head'       // Sub-Department Head
  | 'staff'               // Sub-department staff/operator
  | 'volunteer';          // Guest / Unassigned

export type PermissionKey = 
  | 'view'
  | 'create'
  | 'edit'
  | 'delete'
  | 'approve'
  | 'assign'
  | 'export'
  | 'manage_users';

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: UserRole;
  subDepartmentId?: SubDepartmentId;
  departmentName?: string;
  designation: string;
  avatar: string;
  badgeId: string;
  permissions: PermissionKey[];
  status: 'active' | 'suspended' | 'pending';
  lastActive: string;
}

// Sub-department domain models
export interface CameraItem {
  id: string;
  cameraCode: string;
  name: string;
  zone: string;
  locationDetails: string;
  type: string;
  ipAddress: string;
  controlRoomId: string;
  nvrId?: string;
  switchId?: string;
  status: 'online' | 'offline' | 'maintenance';
  lastPing: string;
  uptimePercent: number;
  storageDays: number;
}

export interface WiFiAccessPoint {
  id: string;
  apCode: string;
  model: string;
  zone: string;
  location: string;
  ipAddress: string;
  macAddress: string;
  connectedClients: number;
  bandwidthUsageMbps: number;
  status: 'online' | 'offline' | 'high_latency';
  switchPort: string;
  uptimeHours: number;
}

export interface WalkieDevice {
  id: string;
  serialNumber: string;
  model: string;
  channelSet: string;
  assignedDept: string;
  assignedToName?: string;
  assignedToPhone?: string;
  status: 'active' | 'in_storage' | 'maintenance' | 'lost' | 'overdue';
  batteryHealth: number;
  dispatchedAt?: string;
  dueAt?: string;
}

export interface ControlRoom {
  id: string;
  code: string;
  name: string;
  location: string;
  videoWallScreens: number;
  activeWorkstations: number;
  totalWorkstations: number;
  activeOperatorCount: number;
  status: 'operational' | 'alert' | 'standby';
  primaryLead: string;
  phone: string;
  feedCount: number;
}

export interface InventoryItem {
  id: string;
  itemCode: string;
  name: string;
  category: 'Cables & Fiber' | 'Network Hardware' | 'Radios & Comms' | 'CCTV & Optics' | 'Power & UPS' | 'Tools & Misc';
  quantityInStock: number;
  minThreshold: number;
  unit: string;
  warehouseLocation: string;
  unitCost: number;
  issuedCount: number;
  damagedCount: number;
  vendorName: string;
}

export interface PurchaseRequest {
  id: string;
  poNumber: string;
  title: string;
  requestedByDept: SubDepartmentId;
  vendorName: string;
  totalAmount: number;
  itemCount: number;
  status: 'Draft' | 'Submitted' | 'Sub-Dept Approved' | 'Owner Approved' | 'Dispatched' | 'Delivered' | 'Paid';
  priority: 'Critical' | 'High' | 'Routine';
  dateCreated: string;
  estimatedDelivery: string;
}

export interface AccommodationRoom {
  id: string;
  campName: string;
  roomNumber: string;
  totalBeds: number;
  occupiedBeds: number;
  assignedSubDept: SubDepartmentId | 'Mixed';
  amenities: string[];
  status: 'Full' | 'Available' | 'Maintenance';
}

export interface AccommodationBed {
  id: string;
  bedCode: string;
  campName: string;
  roomNumber: string;
  assignedSewadarId?: string;
  assignedSewadarName?: string;
  assignedSubDept?: SubDepartmentId;
  status: 'Occupied' | 'Vacant' | 'Reserved' | 'Cleaning';
  checkInDate?: string;
}

export interface Sewadar {
  id: string;
  badgeNumber: string;
  fullName: string;
  phone: string;
  city: string;
  subDepartmentId: SubDepartmentId;
  team: string;
  role: string;
  currentShift: 'Morning (06:00-14:00)' | 'Evening (14:00-22:00)' | 'Night (22:00-06:00)' | 'General Support';
  dutyLocation: string;
  attendanceToday: 'Present' | 'Absent' | 'On Leave';
  accommodationBed?: string;
}

export interface AppNotification {
  id: string;
  title: string;
  message: string;
  type: 'critical' | 'warning' | 'info' | 'approval';
  subDept?: SubDepartmentId;
  timestamp: string;
  read: boolean;
  actionUrl?: {
    appId: SubDepartmentId | 'owner';
    view?: string;
  };
}
