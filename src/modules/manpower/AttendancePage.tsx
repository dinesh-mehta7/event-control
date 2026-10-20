import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { memberMeta } from './memberMeta';
import { CalendarCheck, Search, Users } from 'lucide-react';
import { cx } from '../accommodation/ui';
import { useWalkie } from '../walkie';
import { useManpower } from './ManpowerContext';
import { useEventScope } from '../../context/EventScopeContext';
import { supabase } from '../walkie/lib/supabaseClient';

type AttendanceRow = {
  id: string;
  member_id: string;
  member_name: string;
  status: string;
  checked_in_at: string | null;
  checked_out_at: string | null;
  notes: string;
};
type Operation = {
  member_id: string;
  arrival_status: string;
  arrived_at: string | null;
  badge_issued: boolean;
  badge_at: string | null;
  badge_returned: boolean;
  badge_returned_at: string | null;
};
const uid = () => `attendance-${globalThis.crypto?.randomUUID?.() || Date.now()}`;
const cls = 'rounded-lg border border-line bg-surface';
const btn =
  'rounded-md border border-line px-3 py-2 text-xs font-medium text-ink-soft hover:bg-raised disabled:opacity-50';

export const AttendancePage: React.FC = () => {
  const auth: any = useWalkie();
  const manpower = useManpower();
  const { sewadars, loading } = manpower;
  const scope = useEventScope();
  const eventId = scope.scopeFor('sewadars');
  const event = scope.events.find(item => item.id === eventId);
  const orgId = auth.currentUser?.organizationId;
  const canManage = manpower.canManage;
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [ops, setOps] = useState<Operation[]>([]);
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState('');
  const [loadError, setLoadError] = useState('');
  // Clicking a summary card shows only people with that status ('' = everyone).
  const [statusFilter, setStatusFilter] = useState<'' | 'expected' | 'present' | 'checked_out' | 'absent'>('');
  const refresh = useCallback(async () => {
    if (!orgId || !eventId) {
      setRows([]);
      setOps([]);
      setLoadError('');
      return;
    }
    const [a, o] = await Promise.all([
      supabase.from('event_attendance').select('*').eq('organization_id', orgId).eq('event_id', eventId),
      supabase
        .from('sewadar_event_operations')
        .select('member_id,arrival_status,arrived_at,badge_issued,badge_at,badge_returned,badge_returned_at')
        .eq('organization_id', orgId)
        .eq('event_id', eventId),
    ]);
    const error = a.error || o.error;
    if (error) {
      setLoadError(`Could not load event attendance: ${error.message}`);
      return;
    }
    setLoadError('');
    setRows((a.data || []) as AttendanceRow[]);
    setOps((o.data || []) as Operation[]);
  }, [orgId, eventId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const eligible = useMemo(
    () =>
      sewadars.filter(
        person =>
          person.memberType !== 'salary_based' &&
          (event?.event_type !== 'monthly' || person.memberType === 'monthly') &&
          (event?.event_type !== 'special' || (event.special_member_ids || []).includes(person.id)),
      ),
    [sewadars, event],
  );
  const byMember = new Map(rows.map(row => [row.member_id, row]));
  const opByMember = new Map(ops.map(row => [row.member_id, row]));
  const visible = eligible.filter(
    person =>
      (!query ||
        `${person.name} ${person.teamName} ${person.department} ${person.batchNo} ${person.branch}`
          .toLowerCase()
          .includes(query.toLowerCase())) &&
      (!statusFilter || (byMember.get(person.id)?.status || 'expected') === statusFilter),
  );
  const mark = async (person: any, status: 'present' | 'checked_out' | 'absent') => {
    if (!canManage || !orgId || !eventId || busyId) return;
    setBusyId(person.id);
    try {
      const ok =
        status === 'checked_out'
          ? await manpower.setReturnedBack([person.id])
          : await manpower.setArrival([person.id], status === 'present' ? 'arrived' : 'not_coming');
      if (ok)
        auth.addToast?.(
          status === 'present'
            ? `${person.name} marked arrived · badge issued.`
            : status === 'checked_out'
              ? `${person.name} marked returned · badge returned.`
              : `${person.name} marked absent.`,
        );
      await refresh();
    } catch (error: any) {
      auth.addToast?.(`Attendance update failed: ${error.message || 'Unexpected error'}`, 'error');
    } finally {
      setBusyId('');
    }
  };
  const badge = async (personId: string, mode: 'issue' | 'return') => {
    if (!canManage || !orgId || !eventId || busyId) return;
    setBusyId(personId);
    try {
      const ok =
        mode === 'issue'
          ? await manpower.setBadge([personId], true)
          : await manpower.setBadgeReturned([personId], true);
      if (ok) auth.addToast?.(mode === 'issue' ? 'Badge issued.' : 'Badge return recorded.');
      await refresh();
    } catch (error: any) {
      auth.addToast?.(`Badge update failed: ${error.message || 'Unexpected error'}`, 'error');
    } finally {
      setBusyId('');
    }
  };
  const listed = eligible.map(person => byMember.get(person.id)?.status || 'expected');
  const arrived = listed.filter(s => s === 'present').length;
  const returned = listed.filter(s => s === 'checked_out').length;
  const absent = listed.filter(s => s === 'absent').length;
  const expected = listed.filter(s => s === 'expected').length;
  return (
    <div className="space-y-4">
      <header className={`${cls} flex flex-wrap items-center justify-between gap-3 p-4`}>
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-blue-500/10 text-blue-300">
            <CalendarCheck size={19} />
          </span>
          <div>
            <h1 className="font-semibold text-ink">Event Attendance</h1>
            <p className="text-xs text-mute">{event?.name || 'Choose an event in the header to record attendance.'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="relative">
            <Search size={14} className="absolute left-2.5 top-2.5 text-mute" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search Sewadars or team"
              className="w-56 rounded-md border border-line bg-field py-2 pl-8 pr-2 text-xs text-ink"
            />
          </label>
          <span className="text-xs text-mute">{eligible.length} on this list</span>
        </div>
      </header>
      {!eventId ? (
        <div className={`${cls} p-8 text-center text-sm text-mute`}>
          Select an event from the persistent header to manage its attendance.
        </div>
      ) : (
        <>
          {loadError && (
            <p role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">
              {loadError}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {(
              [
                ['Expected', expected, 'expected'],
                ['Arrived', arrived, 'present'],
                ['Returned', returned, 'checked_out'],
                ['Absent', absent, 'absent'],
              ] as const
            ).map(([label, value, key]) => {
              const on = statusFilter === key;
              return (
                <button
                  key={label}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setStatusFilter(f => (f === key ? '' : key))}
                  title={on ? 'Show everyone' : `Show only ${label.toLowerCase()}`}
                  className={cx(
                    'rounded-lg border bg-surface p-3 text-left transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-blue-400/50',
                    on ? 'border-blue-500 ring-1 ring-blue-500/40' : 'border-line',
                  )}
                >
                  <div className="text-xs text-mute">{label}</div>
                  <div className="mt-1 text-xl font-semibold tabular-nums text-ink">{value}</div>
                </button>
              );
            })}
          </div>
          <section className={`${cls} overflow-hidden`}>
            <div className="flex items-center gap-2 border-b border-line p-3 text-sm font-semibold text-ink">
              <Users size={15} className="text-blue-300" />
              Sewadar attendance
            </div>
            {loading ? (
              <p className="p-5 text-sm text-mute">Loading roster…</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1000px] text-left text-xs">
                  <thead className="bg-raised text-mute">
                    <tr>
                      {[
                        'Badge no.',
                        'Sewadar',
                        'Branch',
                        'Team / sub-department',
                        'Status',
                        'Arrived',
                        'Returned',
                        'Badge status',
                        'Actions',
                      ].map(label => (
                        <th key={label} className="px-3 py-2.5">
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {visible.map(person => {
                      const a = byMember.get(person.id);
                      const b = opByMember.get(person.id);
                      return (
                        <tr key={person.id}>
                          <td className="px-3 py-2.5 whitespace-nowrap tabular-nums text-ink-soft">
                            {person.batchNo || '—'}
                          </td>
                          <td className="px-3 py-2.5 font-medium text-ink">
                            {person.name}
                            {memberMeta(person) && (
                              <span className="block text-[10.5px] font-normal text-mute">{memberMeta(person)}</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-mute">{person.branch || '—'}</td>
                          <td className="px-3 py-2.5 text-mute">{person.teamName || person.department || '—'}</td>
                          <td className="px-3 py-2.5 capitalize text-mute">
                            {(a?.status || 'expected').replace('_', ' ')}
                          </td>
                          <td className="px-3 py-2.5 text-mute">
                            {a?.checked_in_at ? new Date(a.checked_in_at).toLocaleString('en-IN') : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-mute">
                            {a?.checked_out_at ? new Date(a.checked_out_at).toLocaleString('en-IN') : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-mute">
                            {b?.badge_returned ? 'Returned' : b?.badge_issued ? 'Issued' : '—'}
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex flex-wrap gap-1">
                              {canManage && (
                                <>
                                  {(!a || a.status === 'expected' || a.status === 'absent') && (
                                    <>
                                      <button
                                        className={btn}
                                        disabled={!!busyId}
                                        onClick={() => void mark(person, 'present')}
                                      >
                                        Arrived
                                      </button>
                                      <button
                                        className={btn}
                                        disabled={!!busyId}
                                        onClick={() => void mark(person, 'absent')}
                                      >
                                        Absent
                                      </button>
                                    </>
                                  )}
                                  {a?.status === 'present' && (
                                    <button
                                      className={btn}
                                      disabled={!!busyId}
                                      onClick={() => void mark(person, 'checked_out')}
                                    >
                                      Returned
                                    </button>
                                  )}
                                  {a?.status === 'checked_out' && (
                                    <button
                                      className={btn}
                                      disabled={!!busyId}
                                      onClick={() => void mark(person, 'present')}
                                    >
                                      Mark arrived again
                                    </button>
                                  )}
                                  {(!b?.badge_issued || b?.badge_returned) && (
                                    <button
                                      className={btn}
                                      disabled={!!busyId}
                                      onClick={() => void badge(person.id, 'issue')}
                                    >
                                      {b?.badge_returned ? 'Reissue badge' : 'Issue badge'}
                                    </button>
                                  )}
                                  {b?.badge_issued && !b.badge_returned && (
                                    <button
                                      className={btn}
                                      disabled={!!busyId}
                                      onClick={() => void badge(person.id, 'return')}
                                    >
                                      Return badge
                                    </button>
                                  )}
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {!visible.length && (
                  <p className="p-6 text-center text-sm text-mute">No Sewadars match the current search.</p>
                )}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
};
