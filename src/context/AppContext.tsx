import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { SubDepartmentId, UserProfile, CameraItem, WiFiAccessPoint, ControlRoom } from '../types';
import { useApp as useWalkie } from '../modules/walkie/context/AppContext';
import { supabase } from '../modules/walkie/lib/supabaseClient';

// ──────────────────────────────────────────────────────────────────────────────────────────────────
// App-wide state that is NOT in the database:
//   • who is signed in (filled from the real Supabase profile by <Gate/> in App.tsx)
//   • the Control Rooms demo data (kept in this browser only)
// Everything else (Walkie, Inventory, Purchase, Accommodation, Manpower, Requests, Meetings, Access)
// has its own Supabase-backed module. The old mock copies of those were removed.
// ──────────────────────────────────────────────────────────────────────────────────────────────────

const SIGNED_OUT: UserProfile = {
  id: '', name: '', email: '', phone: '', departmentName: '', designation: '', role: 'volunteer', avatar: '', badgeId: '',
  permissions: [], status: 'active', lastActive: '',
};

const INITIAL_CONTROL_ROOMS: ControlRoom[] = [
  { id: 'CR-MAIN', code: 'CR-01', name: 'Central IT Command Center', location: 'IT Headquarters Building, Level 2', videoWallScreens: 24, activeWorkstations: 18, totalWorkstations: 20, activeOperatorCount: 18, status: 'operational', primaryLead: 'Harpreet Singh Sandhu', phone: '+91 181 299901', feedCount: 180 },
  { id: 'CR-LANG', code: 'CR-02', name: 'Langar & Supplies Control Sub-Center', location: 'Langar Complex Administrative Wing', videoWallScreens: 12, activeWorkstations: 8, totalWorkstations: 8, activeOperatorCount: 8, status: 'operational', primaryLead: 'Kulwant Singh', phone: '+91 181 299902', feedCount: 64 },
  { id: 'CR-SEC', code: 'CR-03', name: 'Joint Security & Police Liaison Room', location: 'Perimeter Security Tower 1', videoWallScreens: 16, activeWorkstations: 12, totalWorkstations: 14, activeOperatorCount: 12, status: 'alert', primaryLead: 'Deputy Commissioner Liaison', phone: '+91 181 299903', feedCount: 128 },
  { id: 'CR-TRAF', code: 'CR-04', name: 'Traffic & Parking Operations Desk', location: 'West Toll Barrier Transit Office', videoWallScreens: 8, activeWorkstations: 6, totalWorkstations: 6, activeOperatorCount: 6, status: 'operational', primaryLead: 'Surinder Singh Bawa', phone: '+91 181 299904', feedCount: 48 },
  { id: 'CR-MED', code: 'CR-05', name: 'Emergency Health & Disaster Center', location: 'Base Hospital Field Unit', videoWallScreens: 6, activeWorkstations: 4, totalWorkstations: 4, activeOperatorCount: 4, status: 'operational', primaryLead: 'Dr. Paramjit Singh', phone: '+91 181 299905', feedCount: 32 },
];

const load = <T,>(key: string, init: T): T => { try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : init; } catch { return init; } };
const save = (key: string, v: unknown) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage full or blocked */ } };

interface AppContextType {
  currentUser: UserProfile;
  setCurrentUser: (user: UserProfile) => void;
  canAccessApp: (appId: SubDepartmentId | 'owner') => boolean;
  subAppActiveTab: Record<SubDepartmentId, string>;
  setSubAppActiveTab: (dept: SubDepartmentId, tab: string) => void;
  setActiveApp: (app: SubDepartmentId | 'owner') => void;
  // Organization-shared CCTV and Wi-Fi asset registers
  cameras: CameraItem[];
  assetsLoading: boolean;
  assetsError: string;
  addCamera: (cam: CameraInput) => Promise<string | null>;
  updateCamera: (id: string, cam: CameraInput) => Promise<string | null>;
  deleteCamera: (id: string) => Promise<string | null>;
  wifiAPs: WiFiAccessPoint[];
  addWiFiAP: (ap: WiFiAPInput) => Promise<string | null>;
  updateWiFiAP: (id: string, ap: WiFiAPInput) => Promise<string | null>;
  deleteWiFiAP: (id: string) => Promise<string | null>;
  controlRooms: ControlRoom[];
  updateControlRoomStatus: (id: string, status: 'operational' | 'alert' | 'standby') => void;
  addControlRoom: (cr: Omit<ControlRoom, 'id'>) => void;
  editControlRoom: (id: string, updates: Partial<Omit<ControlRoom, 'id'>>) => void;
  deleteControlRoom: (id: string) => void;
}

export interface CameraInput { cameraCode: string; location: string; type: string; nvrId: string; switchId: string; status: CameraItem['status'] }
export interface WiFiAPInput { apCode: string; model: string; location: string; status: WiFiAccessPoint['status'] }

const mapCamera = (r: any): CameraItem => ({
  id: r.id, cameraCode: r.camera_code, name: r.camera_code, zone: r.location, locationDetails: r.location,
  type: r.camera_type || '', ipAddress: '', controlRoomId: '', nvrId: r.nvr_id || '', switchId: r.switch_id || '',
  status: r.status, lastPing: '', uptimePercent: 0, storageDays: 0,
});
const mapWiFiAP = (r: any): WiFiAccessPoint => ({
  id: r.id, apCode: r.ap_code, model: r.model || '', zone: r.location, location: r.location,
  ipAddress: '', macAddress: '', connectedClients: 0, bandwidthUsageMbps: 0, status: r.status,
  switchPort: '', uptimeHours: 0,
});
const assetsErrorText = (error: any) => /schema cache|does not exist|could not find/i.test(error?.message || '')
  ? `${error.message} — run supabase/migration_v27_cctv_wifi_assets.sql in the Supabase SQL Editor, then reload.`
  : error?.code === '23505' ? 'That ID is already used in this organization.' : error?.message || 'Could not save this record.';

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const auth: any = useWalkie();
  const organizationId: string | null = auth.currentUser?.organizationId || null;
  const [currentUser, setCurrentUser] = useState<UserProfile>(SIGNED_OUT);
  const [tabs, setTabs] = useState<Record<SubDepartmentId, string>>({
    cctv: 'Dashboard', wifi: 'Dashboard', walkie: 'Dashboard', control: 'Dashboard',
    inventory: 'Dashboard', purchase: 'Dashboard', accommodation: 'Dashboard', sewadars: 'Dashboard',
  });
  const [cameras, setCameras] = useState<CameraItem[]>([]);
  const [wifiAPs, setWifiAPs] = useState<WiFiAccessPoint[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [assetsError, setAssetsError] = useState('');
  const [controlRooms, setControlRooms] = useState<ControlRoom[]>(() => load('event_it_control_rooms', INITIAL_CONTROL_ROOMS));

  useEffect(() => save('event_it_control_rooms', controlRooms), [controlRooms]);

  useEffect(() => {
    let active = true;
    if (!organizationId || !auth.currentUser?.approved || auth.currentUser?.isActive === false) {
      setCameras([]); setWifiAPs([]); setAssetsError(''); setAssetsLoading(false);
      return;
    }
    setCameras([]); setWifiAPs([]); setAssetsError('');
    setAssetsLoading(true);
    const loadAssets = async () => {
      const [c, w] = await Promise.all([
        supabase.from('cctv_cameras').select('*').order('location').order('camera_code'),
        supabase.from('wifi_access_points').select('*').order('location').order('ap_code'),
      ]);
      if (!active) return;
      if (c.error || w.error) {
        setAssetsError(assetsErrorText(c.error || w.error));
      } else {
        setAssetsError(''); setCameras((c.data || []).map(mapCamera)); setWifiAPs((w.data || []).map(mapWiFiAP));
      }
      setAssetsLoading(false);
    };
    loadAssets();
    const channel = supabase.channel(`network-assets-${organizationId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cctv_cameras', filter: `organization_id=eq.${organizationId}` }, (p: any) => {
        if (!active) return;
        if (p.eventType === 'DELETE') setCameras(rows => rows.filter(row => row.id !== p.old.id));
        else setCameras(rows => [...rows.filter(row => row.id !== p.new.id), mapCamera(p.new)].sort((a, b) => a.zone.localeCompare(b.zone) || a.cameraCode.localeCompare(b.cameraCode)));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wifi_access_points', filter: `organization_id=eq.${organizationId}` }, (p: any) => {
        if (!active) return;
        if (p.eventType === 'DELETE') setWifiAPs(rows => rows.filter(row => row.id !== p.old.id));
        else setWifiAPs(rows => [...rows.filter(row => row.id !== p.new.id), mapWiFiAP(p.new)].sort((a, b) => a.zone.localeCompare(b.zone) || a.apCode.localeCompare(b.apCode)));
      }).subscribe();
    return () => { active = false; supabase.removeChannel(channel); };
  }, [organizationId, auth.currentUser?.approved, auth.currentUser?.isActive]);

  // Owner and IT head open every department; everyone else only their own.
  const canAccessApp = (appId: SubDepartmentId | 'owner'): boolean => {
    if (currentUser.role === 'owner') return true;
    if (appId === 'owner') return false;
    if (currentUser.role === 'dept_head') return true;
    return currentUser.subDepartmentId === appId;
  };
  const setActiveApp = (target: SubDepartmentId | 'owner') => { if (canAccessApp(target)) window.location.hash = target === 'owner' ? '#/' : '#/' + target; };

  const addCamera: AppContextType['addCamera'] = async cam => {
    if (!organizationId) return 'Sign in to an organization first.';
    const { data, error } = await supabase.from('cctv_cameras').insert({ organization_id: organizationId, camera_code: cam.cameraCode.trim(), location: cam.location.trim(), camera_type: cam.type.trim(), nvr_id: cam.nvrId.trim(), switch_id: cam.switchId.trim(), status: cam.status }).select().single();
    if (error) return assetsErrorText(error);
    setCameras(rows => [...rows, mapCamera(data)].sort((a, b) => a.zone.localeCompare(b.zone) || a.cameraCode.localeCompare(b.cameraCode)));
    return null;
  };
  const updateCamera: AppContextType['updateCamera'] = async (id, cam) => {
    const { data, error } = await supabase.from('cctv_cameras').update({ camera_code: cam.cameraCode.trim(), location: cam.location.trim(), camera_type: cam.type.trim(), nvr_id: cam.nvrId.trim(), switch_id: cam.switchId.trim(), status: cam.status }).eq('id', id).select().single();
    if (error) return assetsErrorText(error);
    setCameras(rows => [...rows.filter(row => row.id !== id), mapCamera(data)].sort((a, b) => a.zone.localeCompare(b.zone) || a.cameraCode.localeCompare(b.cameraCode)));
    return null;
  };
  const deleteCamera: AppContextType['deleteCamera'] = async id => {
    const { error } = await supabase.from('cctv_cameras').delete().eq('id', id);
    if (error) return assetsErrorText(error);
    setCameras(rows => rows.filter(row => row.id !== id)); return null;
  };
  const addWiFiAP: AppContextType['addWiFiAP'] = async ap => {
    if (!organizationId) return 'Sign in to an organization first.';
    const { data, error } = await supabase.from('wifi_access_points').insert({ organization_id: organizationId, ap_code: ap.apCode.trim(), model: ap.model.trim(), location: ap.location.trim(), status: ap.status }).select().single();
    if (error) return assetsErrorText(error);
    setWifiAPs(rows => [...rows, mapWiFiAP(data)].sort((a, b) => a.zone.localeCompare(b.zone) || a.apCode.localeCompare(b.apCode)));
    return null;
  };
  const updateWiFiAP: AppContextType['updateWiFiAP'] = async (id, ap) => {
    const { data, error } = await supabase.from('wifi_access_points').update({ ap_code: ap.apCode.trim(), model: ap.model.trim(), location: ap.location.trim(), status: ap.status }).eq('id', id).select().single();
    if (error) return assetsErrorText(error);
    setWifiAPs(rows => [...rows.filter(row => row.id !== id), mapWiFiAP(data)].sort((a, b) => a.zone.localeCompare(b.zone) || a.apCode.localeCompare(b.apCode)));
    return null;
  };
  const deleteWiFiAP: AppContextType['deleteWiFiAP'] = async id => {
    const { error } = await supabase.from('wifi_access_points').delete().eq('id', id);
    if (error) return assetsErrorText(error);
    setWifiAPs(rows => rows.filter(row => row.id !== id)); return null;
  };

  const value = useMemo<AppContextType>(() => ({
    currentUser, setCurrentUser, canAccessApp, setActiveApp,
    subAppActiveTab: tabs, setSubAppActiveTab: (d, t) => setTabs(p => ({ ...p, [d]: t })),
    cameras, wifiAPs, assetsLoading, assetsError, addCamera, updateCamera, deleteCamera, addWiFiAP, updateWiFiAP, deleteWiFiAP, controlRooms,
    updateControlRoomStatus: (id, status) => setControlRooms(p => p.map(c => (c.id === id ? { ...c, status } : c))),
    addControlRoom: cr => setControlRooms(p => [...p, { ...cr, id: `CR-${Date.now()}` }]),
    editControlRoom: (id, u) => setControlRooms(p => p.map(c => (c.id === id ? { ...c, ...u } : c))),
    deleteControlRoom: id => setControlRooms(p => p.filter(c => c.id !== id)),
  }), [currentUser, tabs, cameras, wifiAPs, controlRooms, assetsLoading, assetsError, organizationId]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within an AppProvider');
  return context;
};
