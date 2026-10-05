import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../modules/walkie/lib/supabaseClient';
import { useApp as useWalkie } from '../modules/walkie/context/AppContext';
import type { SubDepartmentId } from '../types';

// Who is in the organization, who is waiting for approval, and the sign-up code of every department.
// Reading is for owner / IT head (and a sub-department head sees their own code). Approving is owner only,
// and the database enforces that too.

export type GrantLevel = 'staff' | 'sub_dept_head' | 'dept_head';

export interface Member {
  id: string; name: string; email: string; role: string; level: string; subDepartment: SubDepartmentId | null;
  isActive: boolean; approved: boolean; requestedSub: SubDepartmentId | null; requestedAt: string | null; createdAt: string;
}
export interface SewadarAccountLink { id: string; name: string; memberType: string; teamName: string; profileId: string | null }

const mapMember = (p: any): Member => ({
  id: p.id, name: p.name || p.email, email: p.email, role: p.role, level: p.level || 'other',
  subDepartment: p.sub_department || null, isActive: p.is_active !== false, approved: p.approved !== false,
  requestedSub: p.requested_sub_department || null, requestedAt: p.requested_at || null, createdAt: p.created_at,
});

const dbMessage = (e: any): string => {
  const m: string = e?.message || 'Something went wrong.';
  if (/could not find the function|schema cache|does not exist/i.test(m)) return 'Run supabase/migration_v31_meeting_audience_groups.sql in the Supabase SQL Editor first.';
  return m;
};

interface Ctx {
  members: Member[]; requests: Member[]; codes: Partial<Record<SubDepartmentId, string>>; isOwner: boolean; loading: boolean;
  sewadarMembers: SewadarAccountLink[];
  review: (userId: string, approve: boolean, level?: GrantLevel, sub?: SubDepartmentId | null) => Promise<string | null>;
  linkSewadar: (userId: string, memberId: string | null) => Promise<string | null>;
  regenerate: (sub: SubDepartmentId) => Promise<string | null>;
  requestAccess: (code: string) => Promise<string | null>;
  refresh: () => Promise<void>;
}
const C = createContext<Ctx | null>(null);

export const AccessProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const w: any = useWalkie();
  const u = w.currentUser;
  const uid: string | undefined = u?.approved ? u.id : undefined;
  const level: string = u?.level || 'other';
  const isOwner = level === 'owner' && u?.role === 'Admin';
  const seesPeople = level === 'owner' || level === 'dept_head';
  const seesCodes = seesPeople || level === 'sub_dept_head';
  const [members, setMembers] = useState<Member[]>([]);
  const [sewadarMembers, setSewadarMembers] = useState<SewadarAccountLink[]>([]);
  const [codes, setCodes] = useState<Partial<Record<SubDepartmentId, string>>>({});
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!uid) return;
    setLoading(true);
    if (seesPeople) {
      const { data, error } = await supabase.from('profiles').select('*').order('created_at', { ascending: true });
      if (!error && data) setMembers(data.map(mapMember));
      const roster = await supabase.from('accommodation_members').select('id,name,member_type,team_name,profile_id').eq('organization_id', u.organizationId).order('name');
      if (!roster.error && roster.data) setSewadarMembers(roster.data.map((r: any) => ({ id: r.id, name: r.name, memberType: r.member_type || 'salary_based', teamName: r.team_name || '', profileId: r.profile_id || null })));
    }
    if (seesCodes) {
      const { data, error } = await supabase.from('department_codes').select('sub_department, code');
      if (!error && data) setCodes(Object.fromEntries(data.map((d: any) => [d.sub_department, d.code])));
    }
    setLoading(false);
  }, [uid, seesPeople, seesCodes]);

  useEffect(() => {
    if (!uid || !seesCodes) { setMembers([]); setCodes({}); return; }
    refresh();
    const ch = supabase.channel(`access-${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'department_codes' }, () => refresh())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [uid, seesCodes, refresh]);

  const review = useCallback(async (userId: string, approve: boolean, lvl: GrantLevel = 'staff', sub: SubDepartmentId | null = null) => {
    const { error } = await supabase.rpc('review_access_request', { p_user: userId, p_approve: approve, p_level: lvl, p_sub: sub });
    if (error) return dbMessage(error);
    await refresh();
    return null;
  }, [refresh]);

  const linkSewadar = useCallback(async (userId: string, memberId: string | null) => {
    const { error } = await supabase.rpc('link_profile_to_sewadar', { p_profile: userId, p_member_id: memberId || '' });
    if (error) return dbMessage(error);
    await refresh();
    return null;
  }, [refresh]);

  const regenerate = useCallback(async (sub: SubDepartmentId) => {
    const { error } = await supabase.rpc('regenerate_department_code', { p_sub: sub });
    if (error) return dbMessage(error);
    await refresh();
    return null;
  }, [refresh]);

  const requestAccess = useCallback(async (code: string) => {
    const { error } = await supabase.rpc('request_department_access', { p_code: code });
    return error ? dbMessage(error) : null;
  }, []);

  // Waiting for a decision: not approved yet, or approved but asked for a department. Declined sign-ups are inactive and drop out.
  const requests = useMemo(() => members.filter(m => m.isActive && (!m.approved || m.requestedSub)), [members]);

  const value = useMemo<Ctx>(() => ({ members, requests, codes, isOwner, loading, sewadarMembers, review, linkSewadar, regenerate, requestAccess, refresh }),
    [members, requests, codes, isOwner, loading, sewadarMembers, review, linkSewadar, regenerate, requestAccess, refresh]);
  return <C.Provider value={value}>{children}</C.Provider>;
};

export const useAccess = (): Ctx => {
  const v = useContext(C);
  if (!v) throw new Error('useAccess must be used inside AccessProvider');
  return v;
};
