import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../modules/walkie/lib/supabaseClient';
import { useApp as useWalkie } from '../modules/walkie/context/AppContext';
import type { SubDepartmentId } from '../types';

// Meetings (planned + emergency) and notifications, both stored in Supabase so every person sees their own.
// (Imports the Walkie context file directly, not the module index, to avoid an import cycle with the header.)

export type MeetingKind = 'meeting' | 'emergency';
export type MeetingMode = 'offline' | 'online';
export type MeetingStatus = 'scheduled' | 'live' | 'done' | 'cancelled';

export interface MeetingRow {
  id: string; kind: MeetingKind; title: string; agenda: string; message: string; mode: MeetingMode; place: string; link: string;
  startsAt: string; audienceAll: boolean; audienceDepts: SubDepartmentId[]; audienceGroups: string[]; status: MeetingStatus;
  createdBy: string | null; createdByName: string; minutes: string;
}
export interface NotificationRow {
  id: string; title: string; message: string; type: 'critical' | 'warning' | 'info' | 'approval' | 'meeting';
  link: string | null; refId: string | null; read: boolean; createdAt: string;
}
export interface NewMeeting {
  kind: MeetingKind; title: string; agenda?: string; message?: string; mode?: MeetingMode; place?: string; link?: string;
  startsAt?: string; audienceAll?: boolean; audienceDepts?: SubDepartmentId[]; audienceGroups?: string[];
}

const mapMeeting = (r: any): MeetingRow => ({
  id: r.id, kind: r.kind, title: r.title, agenda: r.agenda || '', message: r.message || '', mode: r.mode, place: r.place || '', link: r.link || '',
  startsAt: r.starts_at, audienceAll: !!r.audience_all, audienceDepts: r.audience_depts || [], audienceGroups: r.audience_groups || [], status: r.status,
  createdBy: r.created_by || null, createdByName: r.created_by_name || '', minutes: r.minutes || '',
});
const mapNotification = (r: any): NotificationRow => ({
  id: r.id, title: r.title, message: r.message || '', type: r.type, link: r.link || null, refId: r.ref_id || null,
  read: !!r.read, createdAt: r.created_at,
});

// A friendly message when the SQL migration has not been run yet.
const dbMessage = (e: any): string => {
  const m: string = e?.message || 'Something went wrong.';
  if (/could not find the function|schema cache|does not exist/i.test(m)) return 'Meetings need the latest setup. Run supabase/migration_v31_meeting_audience_groups.sql in the Supabase SQL Editor.';
  return m;
};

interface Ctx {
  meetings: MeetingRow[]; emergencies: MeetingRow[]; notifications: NotificationRow[]; unread: number; sewadarTeams: string[];
  canSchedule: boolean; canCallEmergency: boolean; ready: boolean;
  canEditMeetingMinutes: (m: MeetingRow) => boolean;
  createMeeting: (m: NewMeeting) => Promise<string | null>;       // returns an error message, or null when it worked
  setMeetingStatus: (id: string, status: MeetingStatus) => Promise<string | null>;
  saveMeetingMinutes: (id: string, minutes: string) => Promise<string | null>;
  markRead: (id: string) => void; markAllRead: () => void;
  panelOpen: boolean; openPanel: () => void; closePanel: () => void;
}
const C = createContext<Ctx | null>(null);

export const MeetingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const w: any = useWalkie();
  const u = w.currentUser;
  const uid: string | undefined = u?.approved ? u.id : undefined;
  const org: string | undefined = u?.organizationId || undefined;
  const level: string = u?.level || 'other';
  const [meetings, setMeetings] = useState<MeetingRow[]>([]);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [sewadarTeams, setSewadarTeams] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);

  const load = useCallback(async () => {
    if (!uid) return;
    const [m, n, roster] = await Promise.all([
      supabase.from('meetings').select('*').order('starts_at', { ascending: false }).limit(200),
      supabase.from('notifications').select('*').eq('user_id', uid).order('created_at', { ascending: false }).limit(60),
      supabase.from('accommodation_members').select('team_name').eq('organization_id', org).neq('team_name', '').limit(2000),
    ]);
    if (!m.error && m.data) setMeetings(m.data.map(mapMeeting));
    if (!n.error && n.data) setNotifications(n.data.map(mapNotification));
    if (!roster.error && roster.data) setSewadarTeams(Array.from(new Set(roster.data.map((r: any) => String(r.team_name || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })));
    setReady(true);
  }, [uid, org]);

  // Live changes: only this organization's meetings, and a burst of events causes ONE reload.
  const timer = useRef<any>(null);
  const lastLoad = useRef(0);
  const loadSoon = useCallback(() => { clearTimeout(timer.current); timer.current = setTimeout(() => { lastLoad.current = Date.now(); load(); }, 400); }, [load]);

  useEffect(() => {
    if (!uid) { setMeetings([]); setNotifications([]); setReady(false); return; }
    lastLoad.current = Date.now();
    load();
    const ch = supabase.channel(`meet-${uid}`);
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'meetings', ...(org ? { filter: `organization_id=eq.${org}` } : {}) }, loadSoon);
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${uid}` }, loadSoon);
    ch.subscribe();
    // Coming back to the tab: refresh only if the data is over a minute old (live updates may have been missed).
    const onFocus = () => { if (Date.now() - lastLoad.current > 60000) loadSoon(); };
    window.addEventListener('focus', onFocus);
    const poll = setInterval(loadSoon, 300000); // safety net if live updates are not enabled
    return () => { clearTimeout(timer.current); supabase.removeChannel(ch); window.removeEventListener('focus', onFocus); clearInterval(poll); };
  }, [uid, org, load, loadSoon]);

  const createMeeting = useCallback(async (m: NewMeeting) => {
    const { error } = await supabase.rpc('create_meeting', {
      p_kind: m.kind, p_title: m.title, p_agenda: m.agenda || '', p_mode: m.mode || 'offline',
      p_place: m.place || '', p_link: m.link || '', p_starts_at: m.startsAt || new Date().toISOString(),
      p_audience_all: m.audienceAll ?? true, p_audience_depts: m.audienceDepts || [],
      p_audience_groups: m.audienceGroups || [], p_message: m.message || '',
    });
    if (error) return dbMessage(error);
    await load();
    return null;
  }, [load]);

  const setMeetingStatus = useCallback(async (id: string, status: MeetingStatus) => {
    const { error } = await supabase.rpc('set_meeting_status', { p_id: id, p_status: status });
    if (error) return dbMessage(error);
    await load();
    return null;
  }, [load]);

  const saveMeetingMinutes = useCallback(async (id: string, minutes: string) => {
    const { error } = await supabase.rpc('save_meeting_minutes', { p_id: id, p_minutes: minutes });
    if (error) return dbMessage(error);
    await load();
    return null;
  }, [load]);

  const markRead = useCallback((id: string) => {
    setNotifications(p => p.map(n => (n.id === id ? { ...n, read: true } : n)));
    supabase.from('notifications').update({ read: true }).eq('id', id).then(() => {});
  }, []);
  const markAllRead = useCallback(() => {
    setNotifications(p => p.map(n => ({ ...n, read: true })));
    if (uid) supabase.from('notifications').update({ read: true }).eq('user_id', uid).eq('read', false).then(() => {});
  }, [uid]);

  const value = useMemo<Ctx>(() => ({
    meetings: meetings.filter(m => m.kind === 'meeting'),
    emergencies: meetings.filter(m => m.kind === 'emergency'),
    notifications, unread: notifications.filter(n => !n.read).length, sewadarTeams,
    canSchedule: ['owner', 'dept_head', 'sub_dept_head'].includes(level),
    canCallEmergency: ['owner', 'dept_head', 'sub_dept_head', 'staff'].includes(level),
    canEditMeetingMinutes: (m: MeetingRow) => ['owner', 'dept_head'].includes(level) || m.createdBy === uid,
    ready, createMeeting, setMeetingStatus, saveMeetingMinutes, markRead, markAllRead,
    panelOpen, openPanel: () => setPanelOpen(true), closePanel: () => setPanelOpen(false),
  }), [meetings, notifications, sewadarTeams, level, uid, ready, createMeeting, setMeetingStatus, saveMeetingMinutes, markRead, markAllRead, panelOpen]);

  return <C.Provider value={value}>{children}</C.Provider>;
};

export const useMeetings = (): Ctx => {
  const v = useContext(C);
  if (!v) throw new Error('useMeetings must be used inside MeetingsProvider');
  return v;
};
