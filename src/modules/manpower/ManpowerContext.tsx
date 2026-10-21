import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../walkie/lib/supabaseClient';
import { useWalkie } from '../walkie';
import { DEPT_OPTIONS } from '../accommodation/types';
import type { Arrival, ArrivalTimeOfDay, CallLog, CallOutcome, Sewadar } from './types';
import { useEventScope } from '../../context/EventScopeContext';
import { chunk, friendlyError, mapCall, mapSewadar, sortSewadars, uid } from './mappers';

export interface SewadarInput
  extends Pick<
    Sewadar,
    | 'name'
    | 'memberType'
    | 'serialNo'
    | 'batchNo'
    | 'phone'
    | 'department'
    | 'relation'
    | 'relationName'
    | 'villageCity'
    | 'branch'
    | 'occupation'
    | 'remarks'
    | 'joiningDate'
    | 'employeeCode'
    | 'employeeId'
    | 'address'
    | 'address2'
    | 'expectedArrival'
    | 'expectedArrivalPeriod'
    | 'skills'
    | 'teamName'
    | 'teamLead'
    | 'teams'
    | 'shift'
    | 'deviceType'
    | 'deviceRef'
  > {}

export interface Stats {
  total: number;
  toCall: number;
  awaiting: number;
  arrived: number;
  notComing: number;
  badgePending: number;
  badgeIssued: number;
  withDevice: number;
}

interface Ctx {
  sewadars: Sewadar[];
  loading: boolean;
  loadError: string;
  canManage: boolean;
  stats: Stats;
  add: (i: SewadarInput) => Promise<boolean>;
  addMany: (rows: SewadarInput[]) => Promise<{ added: number; skipped: number }>;
  update: (id: string, i: SewadarInput) => Promise<boolean>;
  remove: (ids: string[]) => Promise<boolean>;
  setArrival: (ids: string[], arrival: Arrival) => Promise<boolean>;
  setExpectedArrival: (id: string, date: string, period: ArrivalTimeOfDay) => Promise<boolean>;
  markWentHome: (id: string) => Promise<boolean>;
  markReturnedHome: (id: string) => Promise<boolean>;
  setReturnedBack: (ids: string[]) => Promise<boolean>;
  setBadge: (ids: string[], issued: boolean) => Promise<boolean>;
  setBadgeReturned: (ids: string[], returned: boolean) => Promise<boolean>;
  setDepartment: (ids: string[], department: string) => Promise<boolean>;
  setTeam: (ids: string[], teamName: string, teamLead: string) => Promise<boolean>;
  removeFromTeam: (id: string, teamName: string) => Promise<boolean>;
  teams: { id: string; name: string; lead: string }[];
  createTeam: (name: string, lead: string) => Promise<boolean>;
  logCall: (id: string, outcome: CallOutcome, note: string) => Promise<boolean>;
  fetchCalls: (id: string) => Promise<CallLog[]>;
}

const C = createContext<Ctx | null>(null);

export const useManpower = (): Ctx => {
  const c = useContext(C);
  if (!c) throw new Error('useManpower must be used inside <ManpowerProvider>');
  return c;
};

export const ManpowerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const w: any = useWalkie();
  const eventScope = useEventScope();
  const eventId = eventScope.scopeFor('sewadars') || null;
  const eventScopeKey = eventId || 'normal';
  const user = w.currentUser;
  const orgId: string | null = user?.organizationId || null;
  const ready = !!user && user.approved !== false && user.isActive !== false && !!orgId;
  const canManage =
    ready &&
    (user.level === 'owner' ||
      user.level === 'dept_head' ||
      ['sewadars', 'accommodation'].includes(user.subDepartment));

  const [sewadars, setSewadars] = useState<Sewadar[]>([]);
  const [teams, setTeams] = useState<{ id: string; name: string; lead: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const ref = useRef(sewadars);
  ref.current = sewadars;

  const toast = useCallback(
    (m: string, t: 'success' | 'error' | 'warning' = 'success') => w.addToast?.(m, t),
    [w.addToast],
  );
  const log = useCallback(
    (a: string, d: string, t = 'info') => {
      try {
        w.logAction?.(a, d, t);
      } catch {
        /* best effort */
      }
    },
    [w.logAction],
  );

  const load = useCallback(async () => {
    if (!ready) return;
    setLoading(true);
    const out: any[] = [];
    let error: any = null;
    for (let from = 0; ; from += 1000) {
      const r = await supabase
        .from('accommodation_members')
        .select('*')
        .order('created_at', { ascending: true })
        .range(from, from + 999);
      if (r.error) {
        error = r.error;
        break;
      }
      out.push(...(r.data || []));
      if (!r.data || r.data.length < 1000) break;
    }
    if (error) setLoadError(friendlyError(error));
    else {
      const teamRows = await supabase.from('manpower_teams').select('*').order('name');
      if (teamRows.error)
        setLoadError(
          `${friendlyError(teamRows.error)} — run supabase/migration_v35_sewadar_teams_and_task_members.sql.`,
        );
      else {
        setLoadError('');
        setTeams((teamRows.data || []).map((t: any) => ({ id: t.id, name: t.name, lead: t.lead || '' })));
      }
      const [opsResult, callsResult, attendanceResult] = await Promise.all([
        supabase
          .from('sewadar_event_operations')
          .select('*')
          .eq('organization_id', orgId)
          .eq('event_scope_key', eventScopeKey),
        eventId
          ? supabase
              .from('accommodation_member_calls')
              .select('*')
              .eq('organization_id', orgId)
              .eq('event_id', eventId)
              .order('called_at', { ascending: false })
          : supabase
              .from('accommodation_member_calls')
              .select('*')
              .eq('organization_id', orgId)
              .is('event_id', null)
              .order('called_at', { ascending: false }),
        eventId
          ? supabase.from('event_attendance').select('*').eq('organization_id', orgId).eq('event_id', eventId)
          : Promise.resolve({ data: [], error: null } as any),
      ]);
      if (opsResult.error || callsResult.error || attendanceResult.error)
        setLoadError(
          `${friendlyError(opsResult.error || callsResult.error || attendanceResult.error)} — run supabase/migration_v58_event_scoped_member_operations.sql.`,
        );
      const opsByMember = new Map((opsResult.data || []).map((row: any) => [row.member_id, row]));
      const attendanceByMember = new Map((attendanceResult.data || []).map((row: any) => [row.member_id, row]));
      const scopedEvent = eventId ? eventScope.events.find(event => event.id === eventId) : undefined;
      const eventDate = scopedEvent?.starts_at
        ? (() => {
            const date = new Date(scopedEvent.starts_at);
            return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
          })()
        : '';
      const callsByMember = new Map<string, any[]>();
      for (const call of callsResult.data || [])
        callsByMember.set(call.member_id, [...(callsByMember.get(call.member_id) || []), call]);
      setSewadars(
        out
          .map(row => {
            const member = mapSewadar(row);
            const operations: any = opsByMember.get(member.id);
            const attendance: any = attendanceByMember.get(member.id);
            const calls = callsByMember.get(member.id) || [];
            const eventArrival: Arrival | undefined = attendance
              ? attendance.status === 'present' || attendance.status === 'checked_out'
                ? 'arrived'
                : attendance.status === 'absent'
                  ? 'not_coming'
                  : 'pending'
              : undefined;
            return {
              ...member,
              expectedArrival: operations?.arrival_schedule_overridden
                ? operations.expected_arrival || ''
                : eventId
                  ? eventDate
                  : member.expectedArrival,
              expectedArrivalPeriod: operations?.arrival_schedule_overridden
                ? operations.expected_arrival_period || ''
                : member.expectedArrivalPeriod,
              arrival: eventArrival || operations?.arrival_status || 'pending',
              arrivedAt: attendance?.checked_in_at || operations?.arrived_at || null,
              returnedBack: attendance?.status === 'checked_out',
              badgeIssued: !!operations?.badge_issued,
              badgeAt: operations?.badge_at || null,
              badgeReturned: !!operations?.badge_returned,
              badgeReturnedAt: operations?.badge_returned_at || null,
              callCount: calls.length,
              lastCallAt: calls[0]?.called_at || null,
              lastCallOutcome: calls[0]?.outcome || null,
              lastCallBy: calls[0]?.called_by || '',
            };
          })
          .sort(sortSewadars),
      );
    }
    setLoading(false);
  }, [ready, orgId, eventId, eventScopeKey, eventScope.events]);

  useEffect(() => {
    if (!ready) {
      setSewadars([]);
      setTeams([]);
      setLoadError('');
      return;
    }
    load();
  }, [ready, orgId, eventId, eventScope.events]); // eslint-disable-line

  const upsert = (list: Sewadar[], item: Sewadar) => [...list.filter(x => x.id !== item.id), item].sort(sortSewadars);

  useEffect(() => {
    if (!ready) return;
    const ch = supabase
      .channel(`manpower-${orgId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'accommodation_members', filter: `organization_id=eq.${orgId}` },
        load,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sewadar_event_operations', filter: `organization_id=eq.${orgId}` },
        load,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'event_attendance', filter: `organization_id=eq.${orgId}` },
        load,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'accommodation_member_calls', filter: `organization_id=eq.${orgId}` },
        load,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'manpower_teams', filter: `organization_id=eq.${orgId}` },
        load,
      )
      .subscribe();
    const t = setInterval(load, 120000); // safety net if realtime drops
    return () => {
      supabase.removeChannel(ch);
      clearInterval(t);
    };
  }, [ready, orgId, load]); // eslint-disable-line

  const deny = () => {
    toast('You can view this list but not change it.', 'error');
    return false;
  };
  const clean = (i: SewadarInput) => ({
    name: i.name.trim(),
    mobile: i.phone.replace(/[^\d+]/g, ''),
    department: i.department || null,
    member_type: i.memberType || 'salary_based',
    serial_no: i.serialNo.trim(),
    batch_no: i.batchNo.trim(),
    relation: i.relation.trim(),
    relation_name: i.relationName.trim(),
    village_city: i.villageCity.trim(),
    branch: i.branch.trim(),
    occupation: i.occupation.trim(),
    remarks: i.remarks.trim(),
    joining_date: i.joiningDate || null,
    employee_code: i.employeeCode.trim(),
    employee_id: i.employeeId.trim(),
    address: i.address.trim(),
    address2: i.address2.trim(),
    expected_arrival: i.memberType === 'salary_based' ? null : i.expectedArrival || null,
    expected_arrival_period: i.memberType === 'salary_based' ? null : i.expectedArrivalPeriod || null,
    skills: (i.skills || []).map(skill => skill.trim()).filter(Boolean),
    team_name: i.teamName.trim(),
    team_lead: i.teamLead.trim(),
    team_names: (i.teams?.length ? i.teams : i.teamName ? [i.teamName] : []).map(t => t.trim()).filter(Boolean),
    shift: i.shift || '',
    device_type: i.deviceType,
    device_ref: i.deviceType === 'none' ? '' : i.deviceRef.trim(),
  });

  const add: Ctx['add'] = async i => {
    if (!canManage) return deny();
    if (!i.name.trim()) {
      toast('Name is required.', 'error');
      return false;
    }
    const { data, error } = await supabase
      .from('accommodation_members')
      .insert({ id: uid('mem'), organization_id: orgId, ...clean(i) })
      .select()
      .single();
    if (error) {
      toast(`Could not add: ${friendlyError(error)}`, 'error');
      return false;
    }
    setSewadars(p => upsert(p, mapSewadar(data)));
    log('Sewadar Added', `${user.name} added ${i.name.trim()}`, 'success');
    toast(`${i.name.trim()} added.`);
    return true;
  };

  const addMany: Ctx['addMany'] = async rows => {
    if (!canManage) {
      deny();
      return { added: 0, skipped: rows.length };
    }
    const have = new Set(ref.current.map(s => s.phone).filter(Boolean));
    const seen = new Set<string>();
    const fresh = rows.filter(r => {
      const c = clean(r);
      if (!c.name) return false;
      if (c.mobile) {
        if (have.has(c.mobile) || seen.has(c.mobile)) return false;
        seen.add(c.mobile);
      }
      return true;
    });
    let added = 0;
    for (const part of chunk(fresh, 400)) {
      const { data, error } = await supabase
        .from('accommodation_members')
        .insert(part.map(r => ({ id: uid('mem'), organization_id: orgId, member_type: 'salary_based', ...clean(r) })))
        .select();
      if (error) {
        toast(`Import stopped: ${friendlyError(error)}`, 'error');
        break;
      }
      added += data?.length || 0;
      setSewadars(p => [...p, ...(data || []).map(mapSewadar)].sort(sortSewadars));
    }
    if (added) {
      log('Sewadars Imported', `${user.name} imported ${added} sewadars`, 'success');
      toast(`${added} sewadar(s) added.`);
    }
    return { added, skipped: rows.length - added };
  };

  const update: Ctx['update'] = async (id, i) => {
    if (!canManage) return deny();
    if (!i.name.trim()) {
      toast('Name is required.', 'error');
      return false;
    }
    const { data, error } = await supabase
      .from('accommodation_members')
      .update(clean(i))
      .eq('id', id)
      .select()
      .single();
    if (error) {
      toast(`Could not save: ${friendlyError(error)}`, 'error');
      return false;
    }
    setSewadars(p => upsert(p, mapSewadar(data)));
    toast('Saved.');
    return true;
  };

  const remove: Ctx['remove'] = async ids => {
    if (!canManage) return deny();
    for (const part of chunk(ids, 100)) {
      const { error } = await supabase.from('accommodation_members').delete().in('id', part);
      if (error) {
        toast(`Could not delete: ${friendlyError(error)}`, 'error');
        return false;
      }
    }
    setSewadars(p => p.filter(s => !ids.includes(s.id)));
    log('Sewadars Removed', `${user.name} removed ${ids.length} sewadar(s)`, 'warning');
    toast(`${ids.length} removed.`);
    return true;
  };

  // Optimistic bulk patch: update the screen first, roll back if the server refuses.
  const patch = async (ids: string[], local: (s: Sewadar) => Sewadar, db: any, okMsg?: string) => {
    if (!canManage) return deny();
    const idSet = new Set(ids);
    const before = ref.current;
    setSewadars(p => p.map(s => (idSet.has(s.id) ? local(s) : s)));
    for (const part of chunk(ids, 100)) {
      const { data, error } = await supabase.from('accommodation_members').update(db).in('id', part).select();
      if (error) {
        setSewadars(before);
        toast(`Could not update: ${friendlyError(error)}`, 'error');
        return false;
      }
      setSewadars(p => {
        let n = p;
        (data || []).forEach((d: any) => {
          n = upsert(n, mapSewadar(d));
        });
        return n;
      });
    }
    if (okMsg) toast(okMsg);
    return true;
  };

  const saveOperations = async (
    ids: string[],
    fields: Record<string, unknown>,
    local: (s: Sewadar) => Sewadar,
    okMsg?: string,
  ) => {
    if (!canManage) return deny();
    const now = new Date().toISOString();
    const idSet = new Set(ids);
    setSewadars(p => p.map(s => (idSet.has(s.id) ? local(s) : s)));
    const rows = ids.map(memberId => {
      const current = ref.current.find(s => s.id === memberId);
      return {
        id: uid('sewadar-op'),
        organization_id: orgId,
        event_id: eventId,
        event_scope_key: eventScopeKey,
        member_id: memberId,
        arrival_status: current?.arrival || 'pending',
        arrived_at: current?.arrivedAt || null,
        badge_issued: current?.badgeIssued || false,
        badge_at: current?.badgeAt || null,
        badge_returned: current?.badgeReturned || false,
        badge_returned_at: current?.badgeReturnedAt || null,
        ...fields,
        updated_at: now,
      };
    });
    const { error } = await supabase
      .from('sewadar_event_operations')
      .upsert(rows, { onConflict: 'organization_id,event_scope_key,member_id' });
    if (error) {
      await load();
      toast(
        `Could not save event data: ${friendlyError(error)} — run ${'expected_arrival' in fields ? 'supabase/migration_v64_event_arrival_time.sql' : 'supabase/migration_v58_event_scoped_member_operations.sql'}.`,
        'error',
      );
      return false;
    }
    if (okMsg) toast(okMsg);
    return true;
  };
  const setExpectedArrival: Ctx['setExpectedArrival'] = async (id, date, period) => {
    if (!eventId) {
      toast('Choose an event to set an event-specific arrival time.', 'warning');
      return false;
    }
    if (!ref.current.some(s => s.id === id)) return false;
    return saveOperations(
      [id],
      { arrival_schedule_overridden: true, expected_arrival: date || null, expected_arrival_period: period || null },
      s => ({ ...s, expectedArrival: date, expectedArrivalPeriod: period }),
      'Event arrival time saved.',
    );
  };
  const markWentHome: Ctx['markWentHome'] = async id => {
    if (!canManage) return deny();
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('accommodation_members')
      .update({ went_home_at: now, returned_from_home_at: null })
      .eq('id', id)
      .select()
      .single();
    if (error) {
      toast(
        `Could not mark Went home: ${friendlyError(error)} — run supabase/migration_v65_permanent_member_holidays.sql.`,
        'error',
      );
      return false;
    }
    setSewadars(current =>
      current.map(s => (s.id === id ? { ...s, wentHomeAt: data.went_home_at, returnedFromHomeAt: null } : s)),
    );
    toast('Marked as Went home.');
    return true;
  };
  const markReturnedHome: Ctx['markReturnedHome'] = async id => {
    if (!canManage) return deny();
    const member = ref.current.find(s => s.id === id);
    if (!member?.wentHomeAt || member.returnedFromHomeAt) return false;
    const now = new Date();
    const start = new Date(member.wentHomeAt);
    const dayStart = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
    const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const days = Math.max(0, Math.floor((dayEnd - dayStart) / 86_400_000));
    const total = member.totalHolidayDays + days;
    const returnedAt = now.toISOString();
    const { data, error } = await supabase
      .from('accommodation_members')
      .update({ returned_from_home_at: returnedAt, total_holiday_days: total })
      .eq('id', id)
      .select()
      .single();
    if (error) {
      toast(
        `Could not mark Returned: ${friendlyError(error)} — run supabase/migration_v65_permanent_member_holidays.sql.`,
        'error',
      );
      return false;
    }
    setSewadars(current =>
      current.map(s =>
        s.id === id
          ? {
              ...s,
              returnedFromHomeAt: data.returned_from_home_at,
              totalHolidayDays: Number(data.total_holiday_days) || total,
            }
          : s,
      ),
    );
    toast(`Marked Returned. ${days} day(s) added to total holidays.`);
    return true;
  };
  const setArrival: Ctx['setArrival'] = async (ids, arrival) => {
    const now = new Date().toISOString();
    if (eventId) {
      if (!canManage) return deny();
      const wanted = new Set(ids);
      const current = ref.current.filter(s => wanted.has(s.id));
      const { data: previous, error: readError } = await supabase
        .from('event_attendance')
        .select('*')
        .eq('organization_id', orgId)
        .eq('event_id', eventId)
        .in('member_id', ids);
      if (readError) {
        toast(`${friendlyError(readError)} — run supabase/migration_v33_event_planning.sql.`, 'error');
        return false;
      }
      const prior = new Map((previous || []).map((row: any) => [row.member_id, row]));
      const rows = current.map(member => {
        const old: any = prior.get(member.id);
        return {
          id: old?.id || uid('attendance'),
          organization_id: orgId,
          event_id: eventId,
          member_id: member.id,
          member_name: member.name,
          status: arrival === 'arrived' ? 'present' : arrival === 'not_coming' ? 'absent' : 'expected',
          checked_in_at: arrival === 'arrived' ? old?.checked_in_at || now : old?.checked_in_at || null,
          checked_out_at: arrival === 'arrived' ? null : old?.checked_out_at || null,
          notes: old?.notes || '',
        };
      });
      setSewadars(p =>
        p.map(s =>
          wanted.has(s.id) ? { ...s, arrival, arrivedAt: arrival === 'arrived' ? now : null, returnedBack: false } : s,
        ),
      );
      const { error } = await supabase.from('event_attendance').upsert(rows, { onConflict: 'event_id,member_id' });
      if (error) {
        await load();
        toast(`${friendlyError(error)} — run supabase/migration_v33_event_planning.sql.`, 'error');
        return false;
      }
      if (arrival === 'arrived') {
        const issued = await saveOperations(
          ids,
          {
            arrival_status: 'arrived',
            arrived_at: now,
            badge_issued: true,
            badge_at: now,
            badge_returned: false,
            badge_returned_at: null,
          },
          s => ({
            ...s,
            arrival: 'arrived',
            arrivedAt: now,
            returnedBack: false,
            badgeIssued: true,
            badgeAt: now,
            badgeReturned: false,
            badgeReturnedAt: null,
          }),
        );
        if (!issued) return false;
      }
      if (ids.length > 1) toast(`${ids.length} updated.`);
      return true;
    }
    const ok = await saveOperations(
      ids,
      { arrival_status: arrival, arrived_at: arrival === 'arrived' ? now : null },
      s => ({ ...s, arrival, arrivedAt: arrival === 'arrived' ? now : null }),
      ids.length > 1 ? `${ids.length} updated.` : undefined,
    );
    if (ok && ids.length > 1)
      log(
        'Arrival Updated',
        `${user.name} set ${ids.length} sewadars to ${arrival}${eventId ? ` for ${eventScope.events.find(e => e.id === eventId)?.name || 'event'}` : ''}`,
        'info',
      );
    return ok;
  };
  const setReturnedBack: Ctx['setReturnedBack'] = async ids => {
    if (!canManage) return deny();
    if (!eventId) {
      toast('Select an event in Working on before marking a Sewadar returned.', 'warning');
      return false;
    }
    const { data: previous, error: readError } = await supabase
      .from('event_attendance')
      .select('*')
      .eq('organization_id', orgId)
      .eq('event_id', eventId)
      .in('member_id', ids);
    if (readError) {
      toast(`${friendlyError(readError)} — run supabase/migration_v33_event_planning.sql.`, 'error');
      return false;
    }
    const prior = new Map((previous || []).map((row: any) => [row.member_id, row]));
    const now = new Date().toISOString();
    const rows = ref.current
      .filter(s => ids.includes(s.id))
      .map(member => {
        const old: any = prior.get(member.id);
        return {
          id: old?.id || uid('attendance'),
          organization_id: orgId,
          event_id: eventId,
          member_id: member.id,
          member_name: member.name,
          status: 'checked_out',
          checked_in_at: old?.checked_in_at || member.arrivedAt || now,
          checked_out_at: now,
          notes: old?.notes || '',
        };
      });
    const { error } = await supabase.from('event_attendance').upsert(rows, { onConflict: 'event_id,member_id' });
    if (error) {
      toast(`${friendlyError(error)} — run supabase/migration_v33_event_planning.sql.`, 'error');
      return false;
    }
    return saveOperations(
      ids,
      {
        arrival_status: 'arrived',
        badge_issued: true,
        badge_at: ref.current.find(s => ids.includes(s.id))?.badgeAt || now,
        badge_returned: true,
        badge_returned_at: now,
      },
      s => ({
        ...s,
        arrival: 'arrived',
        returnedBack: true,
        badgeIssued: true,
        badgeReturned: true,
        badgeReturnedAt: now,
      }),
    );
  };
  const setBadge: Ctx['setBadge'] = (ids, issued) =>
    saveOperations(
      ids,
      {
        badge_issued: issued,
        badge_at: issued ? new Date().toISOString() : null,
        ...(issued ? {} : { badge_returned: false, badge_returned_at: null }),
      },
      s => ({
        ...s,
        badgeIssued: issued,
        badgeAt: issued ? new Date().toISOString() : null,
        ...(issued ? {} : { badgeReturned: false, badgeReturnedAt: null }),
      }),
      ids.length > 1 ? `${ids.length} updated.` : undefined,
    );
  const setBadgeReturned: Ctx['setBadgeReturned'] = (ids, returned) =>
    saveOperations(
      ids,
      { badge_returned: returned, badge_returned_at: returned ? new Date().toISOString() : null },
      s => ({ ...s, badgeReturned: returned, badgeReturnedAt: returned ? new Date().toISOString() : null }),
      ids.length > 1 ? `${ids.length} updated.` : undefined,
    );
  const setDepartment: Ctx['setDepartment'] = (ids, department) =>
    patch(
      ids,
      s => ({ ...s, department }),
      { department: department || null },
      `${ids.length} moved to ${DEPT_OPTIONS.find(d => d[0] === department)?.[1] || 'no department'}.`,
    );
  const setTeam: Ctx['setTeam'] = async (ids, teamName, teamLead) => {
    if (!canManage) return deny();
    let changed = 0;
    for (const id of ids) {
      const member = ref.current.find(s => s.id === id);
      if (!member) continue;
      if (member.arrival !== 'arrived') {
        toast(`${member.name} must be marked Arrived before being added to a team.`, 'warning');
        return false;
      }
      const ledTeam = teams.find(
        team => team.lead.trim().toLocaleLowerCase() === member.name.trim().toLocaleLowerCase(),
      );
      if (ledTeam && ledTeam.name.toLocaleLowerCase() !== teamName.trim().toLocaleLowerCase()) {
        toast(`${member.name} already leads ${ledTeam.name} and cannot be assigned to another team.`, 'error');
        return false;
      }
      const memberships = Array.from(new Set([...(member.teams || []), teamName.trim()]));
      const primaryTeam = memberships[0] || '';
      const primaryLead =
        primaryTeam.toLocaleLowerCase() === teamName.trim().toLocaleLowerCase() ? teamLead.trim() : member.teamLead;
      const { data, error } = await supabase
        .from('accommodation_members')
        .update({ team_names: memberships, team_name: primaryTeam, team_lead: primaryLead })
        .eq('id', id)
        .select()
        .single();
      if (error) {
        toast(`Could not link Sewadar to team: ${friendlyError(error)}`, 'error');
        return false;
      }
      setSewadars(p => upsert(p, mapSewadar(data)));
      changed++;
    }
    if (changed) toast(`${changed} Sewadar(s) linked to ${teamName}.`);
    return true;
  };

  const removeFromTeam: Ctx['removeFromTeam'] = async (id, teamName) => {
    if (!canManage) return deny();
    const member = ref.current.find(s => s.id === id);
    if (!member) return false;
    const teams = (member.teams || []).filter(name => name.toLocaleLowerCase() !== teamName.toLocaleLowerCase());
    const primary = teams[0] || '';
    const { data, error } = await supabase
      .from('accommodation_members')
      .update({
        team_names: teams,
        team_name: primary,
        team_lead: primary ? (teams.find(n => n === member.teamName) ? member.teamLead : '') : '',
      })
      .eq('id', id)
      .select()
      .single();
    if (error) {
      toast(`Could not remove Sewadar from team: ${friendlyError(error)}`, 'error');
      return false;
    }
    setSewadars(p => upsert(p, mapSewadar(data)));
    toast(`${member.name} removed from ${teamName}.`);
    return true;
  };

  const createTeam: Ctx['createTeam'] = async (name, lead) => {
    if (!canManage) return deny();
    const trimmed = name.trim();
    if (!trimmed) {
      toast('Team name is required.', 'error');
      return false;
    }
    if (lead.trim() && teams.some(team => team.lead.trim().toLocaleLowerCase() === lead.trim().toLocaleLowerCase())) {
      toast('That Sewadar already leads a team.', 'error');
      return false;
    }
    const row = { id: uid('team'), organization_id: orgId, name: trimmed, lead: lead.trim() };
    const { data, error } = await supabase.from('manpower_teams').insert(row).select().single();
    if (error) {
      toast(`Could not create team: ${friendlyError(error)}`, 'error');
      return false;
    }
    setTeams(p =>
      [...p.filter(t => t.id !== data.id), { id: data.id, name: data.name, lead: data.lead || '' }].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    );
    toast(`${trimmed} team created.`);
    return true;
  };

  const logCall: Ctx['logCall'] = async (id, outcome, note) => {
    if (!canManage) return deny();
    const now = new Date().toISOString();
    const { error } = await supabase.from('accommodation_member_calls').insert({
      id: uid('call'),
      organization_id: orgId,
      event_id: eventId,
      member_id: id,
      outcome,
      note: note.trim(),
      called_by: user.name,
    });
    if (error) {
      toast(`Could not log call: ${friendlyError(error)}`, 'error');
      return false;
    }
    // The database bumps the counter; mirror it now so the row updates instantly.
    setSewadars(p =>
      p.map(s =>
        s.id === id
          ? { ...s, callCount: s.callCount + 1, lastCallAt: now, lastCallOutcome: outcome, lastCallBy: user.name }
          : s,
      ),
    );
    if (outcome === 'not_coming') await setArrival([id], 'not_coming');
    toast('Call logged.');
    return true;
  };

  const fetchCalls: Ctx['fetchCalls'] = async id => {
    let query = supabase
      .from('accommodation_member_calls')
      .select('*')
      .eq('member_id', id)
      .eq('organization_id', orgId);
    query = eventId ? query.eq('event_id', eventId) : query.is('event_id', null);
    const { data, error } = await query.order('called_at', { ascending: false });
    if (error) {
      toast(friendlyError(error), 'error');
      return [];
    }
    return (data || []).map(mapCall);
  };

  const stats = useMemo<Stats>(() => {
    const s: Stats = {
      total: sewadars.length,
      toCall: 0,
      awaiting: 0,
      arrived: 0,
      notComing: 0,
      badgePending: 0,
      badgeIssued: 0,
      withDevice: 0,
    };
    for (const x of sewadars) {
      if (x.arrival === 'arrived') {
        s.arrived++;
        if (x.badgeIssued) s.badgeIssued++;
        else s.badgePending++;
      } else if (x.arrival === 'not_coming') s.notComing++;
      if (x.memberType !== 'salary_based' && x.arrival === 'pending') {
        if (x.callCount === 0) s.toCall++;
        else s.awaiting++;
      }
      if (x.deviceType !== 'none') s.withDevice++;
    }
    return s;
  }, [sewadars]);

  const value: Ctx = {
    sewadars,
    loading,
    loadError,
    canManage,
    stats,
    teams,
    createTeam,
    add,
    addMany,
    update,
    remove,
    setArrival,
    setExpectedArrival,
    markWentHome,
    markReturnedHome,
    setReturnedBack,
    setBadge,
    setBadgeReturned,
    setDepartment,
    setTeam,
    removeFromTeam,
    logCall,
    fetchCalls,
  };
  return <C.Provider value={value}>{children}</C.Provider>;
};
