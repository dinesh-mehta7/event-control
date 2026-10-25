import React, { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Check, MapPin, Pencil, Radio, X } from 'lucide-react';
import { supabase } from '../walkie/lib/supabaseClient';
import { useApp as useWalkie } from '../walkie/context/AppContext';
import { useEventScope } from '../../context/EventScopeContext';
import { itDepartmentOf } from '../../views/orgData';
import { btnGhost, btnPrimary, inputCls } from '../../components/ui';

const STEPS = ['Requested', 'Approved', 'Ready', 'Handed over', 'Returned'];
const stepOf = (status: string) =>
  ({ pending_approval: 0, approved: 1, ready: 2, delivered: 3, partial_return: 3, returned: 4 })[status] ?? 0;
const LABEL: Record<string, [string, string]> = {
  pending_approval: ['Waiting for approval', 'bg-amber-500/15 text-amber-300'],
  approved: ['Walkie team allocating', 'bg-blue-500/15 text-blue-300'],
  rejected: ['Declined', 'bg-red-500/15 text-red-300'],
  ready: ['Ready to collect', 'bg-violet-500/15 text-violet-300'],
  delivered: ['Handed over', 'bg-cyan-500/15 text-cyan-300'],
  partial_return: ['Partly returned', 'bg-orange-500/15 text-orange-300'],
  returned: ['Returned', 'bg-emerald-500/15 text-emerald-300'],
};
const th = 'px-3 py-2 text-left font-medium';
const td = 'px-3 py-3 align-middle';

export type WalkieMode = 'mine' | 'review' | 'incoming' | 'all';

// Event walkie requests for the Requests page, loaded once and kept live, filtered by the event chosen
// in the header ("Working on"). The radios belong to the IT department, so walkie requests are always
// made TO IT: IT's head approves them and sees them as incoming; the Super Admin sees all.
//   mine     → my current department's requests (Super Admin without a department: the ones I raised)
//   review   → waiting for approval, for the IT Department Head / Super Admin
//   incoming → every request made to IT, for IT's head
//   all      → everything, for the Super Admin
export function useEventWalkies() {
  const { currentUser, departments } = useWalkie() as any;
  const eventScope = useEventScope();
  const eventId = eventScope.scopeFor('event-reports');
  const eventName = (id: string) => eventScope.events.find(e => e.id === id)?.name || 'Event';
  const [rows, setRows] = useState<any[]>([]);
  const orgId = currentUser?.organizationId;
  const reload = useCallback(async () => {
    if (!orgId) return;
    const { data, error } = await supabase
      .from('event_radio_requests')
      .select('*')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false });
    if (!error) setRows(data || []);
  }, [orgId]);
  useEffect(() => {
    void reload();
    if (!orgId) return;
    const ch = supabase
      .channel(`event-walkies-${orgId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'event_radio_requests', filter: `organization_id=eq.${orgId}` },
        () => void reload(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [reload, orgId]);

  const isOwner = currentUser?.level === 'owner';
  const myDept: string | undefined = currentUser?.departmentId;
  const itDeptId = itDepartmentOf<{ id: string; itServices?: boolean }>(departments || [])?.id;
  const isItHead = currentUser?.level === 'dept_head' && !!myDept && myDept === itDeptId;
  const approver = isOwner || isItHead;
  const forMode = (mode: WalkieMode) =>
    rows.filter(
      r =>
        (!eventId || r.event_id === eventId) &&
        (mode === 'mine'
          ? myDept
            ? r.department_id === myDept
            : r.requester_id === currentUser?.id
          : mode === 'review'
            ? r.status === 'pending_approval' && approver
            : mode === 'incoming'
              ? isItHead
              : isOwner),
    );
  const canRequest = ['owner', 'dept_head', 'sub_dept_head'].includes(currentUser?.level);
  return { rows, reload, forMode, eventId, eventName, currentUser, isOwner, isItHead, approver, canRequest };
}
export type EventWalkies = ReturnType<typeof useEventWalkies>;

// The walkie list for one view. standalone: shown in its own category tab, so it renders even when empty.
export const EventWalkieTickets: React.FC<{ mode: WalkieMode; data: EventWalkies; standalone?: boolean }> = ({
  mode,
  data,
  standalone = false,
}) => {
  const { reload: load, forMode, eventId, eventName, currentUser, isOwner, canRequest } = data;
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState<{ id: string; walkies: string; chargers: string; earphones: string } | null>(
    null,
  );
  const shown = forMode(mode);
  const decides = mode === 'review';
  // Nothing to show: in My requests, offer to ask for this event; elsewhere stay out of the way.
  if (!shown.length && !standalone && !(mode === 'mine' && eventId && canRequest)) return null;

  const decide = async (r: any, approve: boolean) => {
    setBusy(r.id);
    setErr('');
    const { error } = await supabase.rpc('event_radio_request_decide', { p_id: r.id, p_approve: approve, p_note: '' });
    setBusy('');
    if (error) setErr(error.message);
    else void load();
  };
  const saveEdit = async () => {
    if (!editing) return;
    const [w, c, e] = [editing.walkies, editing.chargers, editing.earphones].map(Number);
    if (![w, c, e].every(n => Number.isInteger(n) && n >= 0) || w < 1)
      return setErr('Enter whole numbers, with at least one walkie.');
    setBusy(editing.id);
    setErr('');
    const { error } = await supabase.rpc('event_radio_request_update', {
      p_id: editing.id,
      p_walkies: w,
      p_chargers: c,
      p_earphones: e,
    });
    setBusy('');
    if (error)
      setErr(
        /event_radio_request_update|schema cache/i.test(error.message || '')
          ? 'Run supabase/migration_v114_one_walkie_request_per_event.sql in the Supabase SQL Editor, then try again.'
          : error.message,
      );
    else {
      setEditing(null);
      void load();
    }
  };

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-medium text-ink">
          <Radio size={15} className="text-blue-400" />
          Event walkies{eventId ? ` · ${eventName(eventId)}` : ''}
        </h3>
        <span className="text-[11.5px] text-mute">
          {!eventId
            ? 'All events · pick one in “Working on” to focus'
            : mode === 'mine'
              ? 'One request per department for this event'
              : 'Requests made to IT for this event'}
        </span>
      </div>
      {err && <p className="text-xs text-red-300">{err}</p>}
      {!shown.length ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-line px-4 py-6 text-xs text-mute">
          {mode === 'review'
            ? 'No walkie request is waiting for approval.'
            : mode !== 'mine'
              ? 'No walkie requests for this event.'
              : eventId
                ? `Your department has not asked for walkies for ${eventName(eventId)} yet.`
                : 'No walkie requests yet.'}
          {mode === 'mine' && canRequest && (
            <a href="#/requests/new" className={btnPrimary}>
              <Radio size={14} />
              Request walkies
            </a>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[820px] text-xs">
            <thead>
              <tr className="bg-raised/40 text-[10.5px] uppercase tracking-wide text-mute">
                {!eventId && <th className={th}>Event</th>}
                <th className={th}>From → To</th>
                <th className={th}>Walkies</th>
                <th className={th}>Chargers</th>
                <th className={th}>Earphones</th>
                <th className={th}>{decides ? 'Asked by' : 'Pickup point'}</th>
                <th className={th}>{decides ? '' : 'Progress'}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(r => {
                const [label, tone] = LABEL[r.status] || [r.status, 'bg-raised text-mute'];
                const out = r.delivered_walkies - r.returned_walkies;
                const edit = editing?.id === r.id ? editing : null;
                const canEdit =
                  mode === 'mine' &&
                  r.status === 'pending_approval' &&
                  (r.requester_id === currentUser?.id || isOwner || currentUser?.level === 'dept_head');
                const qty = (key: 'walkies' | 'chargers' | 'earphones', value: number) =>
                  edit ? (
                    <input
                      aria-label={key}
                      type="number"
                      min={key === 'walkies' ? 1 : 0}
                      className={inputCls + ' !h-8 !w-20 tabular-nums'}
                      value={edit[key]}
                      onChange={e => setEditing({ ...edit, [key]: e.target.value })}
                    />
                  ) : (
                    <span className="text-sm font-semibold tabular-nums text-ink">{value}</span>
                  );
                return (
                  <tr key={r.id} className="border-t border-line/80">
                    {!eventId && <td className={`${td} font-medium text-ink`}>{eventName(r.event_id)}</td>}
                    <td className={`${td} text-ink-soft`}>
                      <span className="inline-flex flex-wrap items-center gap-x-1">
                        {r.department_name}
                        <ArrowRight size={11} className="text-faint" aria-label="to" />
                        Walkie team (IT)
                      </span>
                      <div className="mt-0.5 text-[10.5px] text-faint">
                        {mode !== 'mine' && !decides ? `${r.requester_name} · ` : ''}
                        {new Date(r.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                      </div>
                    </td>
                    <td className={td}>{qty('walkies', r.walkie_count)}</td>
                    <td className={td}>{qty('chargers', r.charger_count)}</td>
                    <td className={td}>{qty('earphones', r.earphone_count)}</td>
                    <td className={td}>
                      {decides ? (
                        <span className="text-ink-soft">{r.requester_name}</span>
                      ) : r.collect_from ? (
                        <span className="inline-flex items-center gap-1 text-violet-300">
                          <MapPin size={12} />
                          {r.collect_from}
                        </span>
                      ) : (
                        <span className="text-mute">
                          {['pending_approval', 'approved'].includes(r.status) ? 'Walkie team will set it' : '—'}
                        </span>
                      )}
                      {mode === 'mine' && out > 0 && (
                        <div className="mt-0.5 text-[10.5px] text-orange-300">{out} to return after the event</div>
                      )}
                    </td>
                    <td className={`${td} text-right`}>
                      {decides ? (
                        <div className="flex justify-end gap-2">
                          <button className={btnGhost} disabled={busy === r.id} onClick={() => void decide(r, false)}>
                            <X size={13} />
                            Decline
                          </button>
                          <button className={btnPrimary} disabled={busy === r.id} onClick={() => void decide(r, true)}>
                            <Check size={13} />
                            Approve
                          </button>
                        </div>
                      ) : edit ? (
                        <div className="flex justify-end gap-2">
                          <button className={btnGhost} onClick={() => setEditing(null)}>
                            Cancel
                          </button>
                          <button className={btnPrimary} disabled={busy === r.id} onClick={() => void saveEdit()}>
                            Save
                          </button>
                        </div>
                      ) : (
                        <div className="flex flex-col items-end gap-1.5">
                          <span className="flex items-center gap-2">
                            {canEdit && (
                              <button
                                className="inline-flex items-center gap-1 text-[11.5px] text-blue-300 hover:underline"
                                onClick={() =>
                                  setEditing({
                                    id: r.id,
                                    walkies: String(r.walkie_count),
                                    chargers: String(r.charger_count),
                                    earphones: String(r.earphone_count),
                                  })
                                }
                              >
                                <Pencil size={11} />
                                Change
                              </button>
                            )}
                            <span className={`rounded-full px-2.5 py-0.5 font-medium ${tone}`}>{label}</span>
                          </span>
                          {r.status !== 'rejected' && (
                            <span className="flex gap-1" aria-label={`Step ${stepOf(r.status) + 1} of ${STEPS.length}`}>
                              {STEPS.map((s, i) => (
                                <span
                                  key={s}
                                  title={s}
                                  className={`h-1 w-6 rounded-full ${i <= stepOf(r.status) ? 'bg-blue-500' : 'bg-line-strong'}`}
                                />
                              ))}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
