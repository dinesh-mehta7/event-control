import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, MapPin, PackageCheck, Radio, RefreshCw, RotateCcw, X } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { supabase } from '../lib/supabaseClient';
import { useRequests } from '../../requests';
import { Select } from '../../../components/Select';
import { PillTabs } from '../../../components/PillTabs';
import { btnGhost, btnPrimary, inputCls } from '../../../components/ui';
import { useEventScope } from '../../../context/EventScopeContext';
import { itDepartmentOf } from '../../../views/orgData';

const statusLabels = {
  pending_approval: 'Waiting for approval',
  approved: 'Approved · awaiting allocation',
  rejected: 'Declined',
  ready: 'Ready to pick up / deliver',
  delivered: 'Delivered',
  partial_return: 'Partially returned',
  returned: 'Returned',
};
const statusTone = {
  pending_approval: 'bg-amber-500/10 text-amber-300',
  approved: 'bg-blue-500/10 text-blue-300',
  rejected: 'bg-red-500/10 text-red-300',
  ready: 'bg-violet-500/10 text-violet-300',
  delivered: 'bg-cyan-500/10 text-cyan-300',
  partial_return: 'bg-orange-500/10 text-orange-300',
  returned: 'bg-emerald-500/10 text-emerald-300',
};
const safeCount = x => Math.max(0, Math.floor(Number(x) || 0));

export default function EventRadioRequests() {
  const { currentUser, departments, walkies, allocateWalkies, availableChargers, availableEarphones, addToast } =
    useApp();
  const { requests: organizationRequests } = useRequests();
  const eventScope = useEventScope();
  const orgId = currentUser?.organizationId;
  const canApprove = currentUser?.level === 'owner' || currentUser?.level === 'dept_head';
  const canFulfil =
    ['Admin', 'Operator'].includes(currentUser?.role) &&
    (currentUser?.level === 'owner' ||
      (currentUser?.level === 'sub_dept_head' && currentUser?.subDepartment === 'walkie'));
  const deptId = currentUser?.departmentId || '';
  const itDeptId = itDepartmentOf(departments)?.id;
  const [events, setEvents] = useState([]);
  const [requests, setRequests] = useState([]);
  // Starts on the event chosen in the header ("Working on"); '' = all events.
  const eventId = eventScope.scopeFor('walkie'); // '' (Normal) = all events
  const [stage, setStage] = useState(''); // '' = the first stage with work in it
  useEffect(() => setStage(''), [eventId]); // a new event opens on its first busy stage
  const [openReturn, setOpenReturn] = useState('');
  const [returnPick, setReturnPick] = useState({}); // request id → radio ids ticked as handed back
  const [pickups, setPickups] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState({});
  const [returnCounts, setReturnCounts] = useState({});
  const [signers, setSigners] = useState({});

  const load = useCallback(async () => {
    if (!orgId) return;
    const [ev, rq] = await Promise.all([
      supabase
        .from('event_plans')
        .select('id,name,starts_at,status')
        .eq('organization_id', orgId)
        .neq('status', 'cancelled')
        .order('starts_at', { ascending: false }),
      supabase
        .from('event_radio_requests')
        .select('*')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false }),
    ]);
    if (ev.error || rq.error) {
      setError((ev.error || rq.error).message || 'Could not load event requests.');
      return;
    }
    setEvents(ev.data || []);
    setRequests(rq.data || []);
    setError('');
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!orgId) return;
    const channel = supabase
      .channel(`event-radio-${orgId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'event_radio_requests', filter: `organization_id=eq.${orgId}` },
        load,
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, load]);

  const visible = useMemo(() => requests.filter(r => !eventId || r.event_id === eventId), [requests, eventId]);
  const summary = useMemo(
    () =>
      visible.reduce(
        (s, r) => {
          if (r.status === 'rejected') return s;
          s.walkies += r.walkie_count;
          s.chargers += r.charger_count;
          s.earphones += r.earphone_count;
          s.delivered += r.delivered_walkies || 0;
          s.returned += r.returned_walkies || 0;
          return s;
        },
        { walkies: 0, chargers: 0, earphones: 0, delivered: 0, returned: 0 },
      ),
    [visible],
  );
  const grouped = useMemo(() => {
    const map = new Map();
    visible
      .filter(r => r.status !== 'rejected')
      .forEach(r => {
        const x = map.get(r.department_id) || {
          department: r.department_name,
          walkies: 0,
          chargers: 0,
          earphones: 0,
          tickets: 0,
        };
        x.walkies += r.walkie_count;
        x.chargers += r.charger_count;
        x.earphones += r.earphone_count;
        x.tickets += 1;
        map.set(r.department_id, x);
      });
    return [...map.values()];
  }, [visible]);

  // Departments raise walkie requests from Requests → New request; this page is where IT and the
  // Walkie team work them.
  const decide = async (r, approve) => {
    setBusy(true);
    setError('');
    const { error: err } = await supabase.rpc('event_radio_request_decide', {
      p_id: r.id,
      p_approve: approve,
      p_note: '',
    });
    setBusy(false);
    if (err) setError(err.message);
    else await load();
  };

  // One approved request: pick free radios, allocate them to the department for the request's event,
  // then name them GP-<year>-<dept>-0001… and mark the request ready.
  // `batch` carries what earlier requests of the same run already took: the radio list and accessory
  // counts on screen are only refreshed after the run, so without it two departments would get the
  // same radios and accessories would be over-issued.
  const syncOne = async (r, nextSerial, batch) => {
    const dept = departments.find(d => d.id === r.department_id);
    if (!dept) throw new Error(`Department for request ${r.id} is missing.`);
    const available = walkies
      .filter(w => w.status === 'Available' && !batch.taken.has(w.id))
      .sort((a, b) => (a.label || '').localeCompare(b.label || '', undefined, { numeric: true }));
    if (available.length < r.walkie_count)
      throw new Error(`Only ${available.length} radios are free; ${r.walkie_count} are needed for ${dept.name}.`);
    if (r.charger_count > batch.chargers || r.earphone_count > batch.earphones)
      throw new Error(
        `Not enough accessories left for ${dept.name}: ${batch.chargers} chargers and ${batch.earphones} earphones free.`,
      );
    const picked = available.slice(0, r.walkie_count);
    const allocation = await allocateWalkies(
      dept.id,
      picked.map(w => w.id),
      currentUser?.name || '',
      `Event radio request ${r.id}`,
      '',
      '',
      r.charger_count,
      r.earphone_count,
      r.event_id,
    );
    if (!allocation) throw new Error(`Allocation failed for ${dept.name}. Check radio and accessory stock.`);
    picked.forEach(w => batch.taken.add(w.id));
    batch.chargers -= r.charger_count;
    batch.earphones -= r.earphone_count;
    const { error: linkErr } = await supabase
      .from('allocations')
      .update({ event_radio_request_id: r.id })
      .eq('id', allocation.id);
    if (linkErr) throw linkErr;
    // Named only once they really belong to the department.
    const code = (dept.code || dept.name.replace(/[^a-z0-9]/gi, '').slice(0, 4) || 'DEPT').toUpperCase();
    const year = new Date(events.find(e => e.id === r.event_id)?.starts_at || Date.now()).getFullYear();
    const labels = picked.map((_, i) => `GP-${year}-${code}-${String(nextSerial + i).padStart(4, '0')}`);
    const renamed = await Promise.all(
      picked.map((w, i) => supabase.from('walkies').update({ label: labels[i], is_rented: true }).eq('id', w.id)),
    );
    const nameErr = renamed.find(result => result.error)?.error;
    if (nameErr) throw nameErr;
    const { error: rpcErr } = await supabase.rpc('event_radio_request_allocate', {
      p_id: r.id,
      p_walkie_ids: picked.map(w => w.id),
    });
    if (rpcErr) throw rpcErr;
    return nextSerial + r.walkie_count;
  };

  const syncAndAllocate = async () => {
    const approved = visible.filter(r => r.status === 'approved');
    if (!approved.length) return;
    if (!canFulfil) return;
    // Check the whole run up front, so it does not stop halfway with some departments done.
    const free = walkies.filter(w => w.status === 'Available').length;
    const need = approved.reduce(
      (s, r) => ({ w: s.w + r.walkie_count, c: s.c + r.charger_count, e: s.e + r.earphone_count }),
      { w: 0, c: 0, e: 0 },
    );
    if (need.w > free || need.c > availableChargers || need.e > availableEarphones) {
      setError(
        `Not enough stock for all ${approved.length} requests: need ${need.w} radios (${free} free), ` +
          `${need.c} chargers (${availableChargers} free), ${need.e} earphones (${availableEarphones} free).`,
      );
      return;
    }
    setBusy(true);
    setError('');
    const counters = new Map();
    const batch = { taken: new Set(), chargers: availableChargers, earphones: availableEarphones };
    let done = 0;
    try {
      for (const r of approved) {
        const dept = departments.find(d => d.id === r.department_id);
        const code = (dept?.code || dept?.name?.replace(/[^a-z0-9]/gi, '').slice(0, 4) || 'DEPT').toUpperCase();
        const year = new Date(events.find(e => e.id === r.event_id)?.starts_at || Date.now()).getFullYear();
        const counterKey = `${year}:${code}`;
        const existingMax = Math.max(
          0,
          ...walkies.map(w => {
            const match = (w.label || '').match(new RegExp(`^GP-${year}-${code}-(\\d+)$`, 'i'));
            return match ? Number(match[1]) : 0;
          }),
        );
        const next = counters.has(counterKey) ? counters.get(counterKey) : existingMax + 1;
        counters.set(counterKey, await syncOne(r, next, batch));
        done += 1;
      }
      addToast(`${done} request${done === 1 ? '' : 's'} named and allocated. Ready to hand over.`);
      await load();
    } catch (e) {
      setError(
        `${done ? `${done} of ${approved.length} allocated, then stopped: ` : ''}${e.message || 'Could not finish allocation.'}`,
      );
      await load();
    }
    setBusy(false);
  };

  // Where the department collects its radios: set by the Walkie team, shown to the requester.
  const savePickup = async r => {
    const point = (pickups[r.id] ?? r.collect_from ?? '').trim();
    if (!point) {
      setError('Enter where the department should collect the radios.');
      return;
    }
    setBusy(true);
    setError('');
    const { error: err } = await supabase.rpc('event_radio_request_set_pickup', { p_id: r.id, p_point: point });
    setBusy(false);
    if (err)
      setError(
        /event_radio_request_set_pickup|schema cache/i.test(err.message || '')
          ? 'Run supabase/migration_v112_event_walkie_request_sync.sql in the Supabase SQL Editor, then reload this page.'
          : err.message,
      );
    else {
      setPickups(v => {
        const next = { ...v };
        delete next[r.id];
        return next;
      });
      addToast('Pickup point saved. The department can see it.');
      await load();
    }
  };

  const markDelivered = async r => {
    setBusy(true);
    setError('');
    const { error: err } = await supabase.rpc('event_radio_request_deliver', {
      p_id: r.id,
      p_signed_by: signers[r.id] || '',
    });
    setBusy(false);
    if (err) setError(err.message);
    else await load();
  };

  // Radios of this request still with the department (allocated to it), to tick on return.
  const stillOut = r =>
    (Array.isArray(r.allocated_walkie_ids) ? r.allocated_walkie_ids : []).filter(id =>
      walkies.some(w => w.id === id && w.status === 'Allocated' && w.departmentId === r.department_id),
    );
  // Records exactly the radios ticked (not "the first N"), plus the accessories handed back.
  const submitReturn = async r => {
    const qty = returnCounts[r.id] || { chargers: 0, earphones: 0 };
    const ids = [...(returnPick[r.id] || [])];
    if (!ids.length) {
      setError('Tick the radios the department handed back.');
      return;
    }
    if (!(feedback[r.id] || '').trim()) {
      setError('Add feedback from the department before recording this return.');
      return;
    }
    setBusy(true);
    setError('');
    const { error: retErr } = await supabase.rpc('event_radio_request_return', {
      p_id: r.id,
      p_walkie_ids: ids,
      p_walkies: ids.length,
      p_chargers: safeCount(qty.chargers),
      p_earphones: safeCount(qty.earphones),
      p_feedback: feedback[r.id] || '',
    });
    setBusy(false);
    if (retErr) setError(retErr.message);
    else {
      setReturnPick(v => ({ ...v, [r.id]: [] }));
      setOpenReturn('');
      addToast('Return and feedback recorded.');
      await load();
    }
  };

  // ---- view --------------------------------------------------------------------------------------
  const event = events.find(e => e.id === eventId);
  const deliveryPct = summary.walkies ? Math.round((summary.delivered * 100) / summary.walkies) : 0;
  const returnPct = summary.delivered ? Math.round((summary.returned * 100) / summary.delivered) : 0;
  const departmentRadioRequests = organizationRequests.filter(r => r.items.some(item => item.kind === 'radio'));
  const requestStatus = r => {
    if (r.status === 'pending_sub') return 'Waiting for department head';
    if (r.status === 'pending_it') return 'Waiting for IT head';
    if (r.status === 'pending_owner') return 'Waiting for Super Admin';
    if (r.status === 'rejected') return 'Declined';
    if (r.status === 'cancelled') return 'Cancelled';
    if (r.status === 'fulfilled') return 'Handed over';
    if (r.status === 'approved') return 'With Walkie team';
    return 'Waiting for approval';
  };
  // Each ticket sits in one stage; the team works stage by stage.
  const stageOf = r =>
    r.status === 'pending_approval'
      ? 'approval'
      : r.status === 'approved'
        ? 'allocate'
        : r.status === 'ready'
          ? 'ready'
          : ['delivered', 'partial_return'].includes(r.status)
            ? 'out'
            : 'done';
  const STAGES = [
    ['approval', 'To approve'],
    ['allocate', 'To allocate'],
    ['ready', 'Ready to hand over'],
    ['out', 'With departments'],
    ['done', 'Closed'],
  ];
  const stageCount = id => visible.filter(r => stageOf(r) === id).length;
  const readyCount = stageCount('ready');
  const readyWalkies = visible.filter(r => r.status === 'ready').reduce((sum, r) => sum + r.walkie_count, 0);
  const firstBusy = (STAGES.find(([id]) => stageCount(id) > 0) || STAGES[0])[0];
  const activeStage = stage || firstBusy;
  const rows = visible.filter(r => stageOf(r) === activeStage);
  const radioLabel = id => walkies.find(w => w.id === id)?.label || id;
  const isOwner = currentUser?.level === 'owner';
  const tile = 'rounded-xl border border-line bg-surface px-4 py-3';
  const th = 'px-3 py-2.5 text-left font-medium';
  const td = 'px-3 py-3 align-middle';
  const smallInput = `${inputCls} !h-8 !py-0 text-xs`;

  return (
    <section className="space-y-5" aria-labelledby="event-radio-heading">
      {/* Header: what this page is, which event, refresh */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-blue-500/10 text-blue-400">
              <Radio size={16} />
            </span>
            <h1 id="event-radio-heading" className="text-lg font-semibold text-ink">
              Event walkies
            </h1>
          </div>
          <p className="mt-1 text-xs text-mute">
            Departments ask from Requests → New request. IT approves, the Walkie team allocates, hands over and takes
            them back.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* One event for the whole Walkie module: the header's "Working on". */}
          <span className="rounded-full border border-line bg-raised/50 px-3 py-1.5 text-xs text-mute">
            Event ·{' '}
            <span className="font-semibold text-ink">{events.find(e => e.id === eventId)?.name || 'All events'}</span>
            <span className="ml-1 text-faint">(change in “Working on”)</span>
          </span>
          <button className={btnGhost} onClick={() => void load()} aria-label="Refresh">
            <RefreshCw size={14} />
          </button>
        </div>
      </header>

      {error && (
        <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Event at a glance */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <div className={tile}>
          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-faint">Requested</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-ink">{summary.walkies}</div>
          <div className="text-[11.5px] text-mute">
            walkies · {grouped.length} department{grouped.length === 1 ? '' : 's'}
          </div>
        </div>
        <div className={tile}>
          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-faint">Accessories</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-ink">
            {summary.chargers} <span className="text-sm font-normal text-mute">chargers</span>
          </div>
          <div className="text-[11.5px] text-mute">{summary.earphones} earphones</div>
        </div>
        {/* Allocated and named, waiting for the department to collect: opens the Ready stage. */}
        <button
          type="button"
          onClick={() => setStage('ready')}
          className={`${tile} text-left transition-colors hover:border-violet-500/40 hover:bg-violet-500/5`}
        >
          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-faint">Ready to hand over</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-violet-300">{readyWalkies}</div>
          <div className="text-[11.5px] text-mute">
            {readyCount
              ? `walkies · ${readyCount} department${readyCount === 1 ? '' : 's'} to collect`
              : 'nothing waiting'}
          </div>
        </button>
        {[
          ['Handed over', summary.delivered, summary.walkies, deliveryPct, 'bg-blue-500'],
          ['Returned', summary.returned, summary.delivered, returnPct, 'bg-emerald-500'],
        ].map(([label, n, total, pct, bar]) => (
          <div key={label} className={tile}>
            <div className="flex items-baseline justify-between">
              <span className="text-[10.5px] font-semibold uppercase tracking-wider text-faint">{label}</span>
              <span className="text-[11.5px] tabular-nums text-mute">{pct}%</span>
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-ink">
              {n}
              <span className="text-sm font-normal text-mute"> / {total}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-raised">
              <div
                className={`h-full rounded-full ${bar} transition-[width] duration-300`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Tickets, stage by stage */}
      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-3 py-2.5">
          <PillTabs
            variant="segmented"
            label="Ticket stage"
            value={activeStage}
            onChange={setStage}
            className="inline-flex flex-wrap rounded-lg bg-raised/50 p-0.5"
            itemClassName="px-3 py-1.5 text-xs"
            tabs={STAGES.map(([id, label]) => ({ id, label: `${label} · ${stageCount(id)}` }))}
          />
          {activeStage === 'allocate' && canFulfil && (
            <button
              disabled={busy || !rows.length}
              onClick={() => void syncAndAllocate()}
              title="Name the radios (GP-year-dept-0001) and allocate every approved request in this list"
              className={btnPrimary}
            >
              <PackageCheck size={14} />
              Name &amp; allocate all · {rows.length}
            </button>
          )}
        </div>

        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-xs">
              <thead>
                <tr className="bg-raised/40 text-[10.5px] uppercase tracking-wide text-mute">
                  {!eventId && <th className={th}>Event</th>}
                  <th className={th}>Department</th>
                  <th className={th}>Walkies</th>
                  <th className={th}>Chargers</th>
                  <th className={th}>Earphones</th>
                  <th className={th}>Pickup point</th>
                  <th className={th}>Status</th>
                  <th className={`${th} text-right`}>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const mayDecide =
                    canApprove &&
                    r.status === 'pending_approval' &&
                    (isOwner || (currentUser?.level === 'dept_head' && !!deptId && deptId === itDeptId));
                  const allocatedIds = Array.isArray(r.allocated_walkie_ids) ? r.allocated_walkie_ids : [];
                  const qty = returnCounts[r.id] || { walkies: '', chargers: '', earphones: '' };
                  const returning = canFulfil && openReturn === r.id;
                  const pickupValue = pickups[r.id] ?? r.collect_from ?? '';
                  const pickupDirty = pickupValue.trim() !== (r.collect_from || '');
                  return (
                    <React.Fragment key={r.id}>
                      <tr className="border-t border-line/80 hover:bg-raised/20">
                        {!eventId && (
                          <td className={`${td} font-medium text-ink`}>
                            {events.find(e => e.id === r.event_id)?.name || 'Event'}
                          </td>
                        )}
                        <td className={td}>
                          <div className="font-medium text-ink">{r.department_name}</div>
                          <div className="mt-0.5 text-[10.5px] text-mute">
                            {r.requester_name} ·{' '}
                            {new Date(r.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                          </div>
                        </td>
                        <td className={td}>
                          <span className="text-sm font-semibold tabular-nums text-ink">{r.walkie_count}</span>
                          {allocatedIds.length > 0 && (
                            <div
                              className="mt-0.5 max-w-[11rem] truncate font-mono text-[10px] text-faint"
                              title={allocatedIds.map(radioLabel).join(', ')}
                            >
                              {allocatedIds.slice(0, 2).map(radioLabel).join(', ')}
                              {allocatedIds.length > 2 ? ` +${allocatedIds.length - 2}` : ''}
                            </div>
                          )}
                        </td>
                        <td className={`${td} tabular-nums text-ink-soft`}>{r.charger_count}</td>
                        <td className={`${td} tabular-nums text-ink-soft`}>{r.earphone_count}</td>
                        <td className={td}>
                          {canFulfil && ['approved', 'ready'].includes(r.status) ? (
                            <div className="flex items-center gap-1.5">
                              <input
                                list="walkie-pickup-points"
                                aria-label={`Pickup point for ${r.department_name}`}
                                className={`${smallInput} !w-40`}
                                placeholder="Set pickup point"
                                value={pickupValue}
                                onChange={e => setPickups(v => ({ ...v, [r.id]: e.target.value }))}
                              />
                              {pickupDirty && (
                                <button
                                  className="text-[11.5px] font-medium text-blue-300 hover:underline disabled:opacity-50"
                                  disabled={busy}
                                  onClick={() => void savePickup(r)}
                                >
                                  Save
                                </button>
                              )}
                            </div>
                          ) : r.collect_from ? (
                            <span className="inline-flex items-center gap-1 text-violet-300">
                              <MapPin size={12} />
                              {r.collect_from}
                            </span>
                          ) : (
                            <span className="text-faint">—</span>
                          )}
                        </td>
                        <td className={td}>
                          <span
                            className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${statusTone[r.status]}`}
                          >
                            {statusLabels[r.status]}
                          </span>
                          {r.status === 'partial_return' && (
                            <div className="mt-0.5 text-[10.5px] text-orange-300">
                              {r.delivered_walkies - r.returned_walkies} still out
                            </div>
                          )}
                        </td>
                        <td className={`${td} text-right`}>
                          {mayDecide ? (
                            <div className="flex justify-end gap-1.5">
                              <button className={btnGhost} disabled={busy} onClick={() => void decide(r, false)}>
                                <X size={13} />
                                Decline
                              </button>
                              <button className={btnPrimary} disabled={busy} onClick={() => void decide(r, true)}>
                                <Check size={13} />
                                Approve
                              </button>
                            </div>
                          ) : canFulfil && r.status === 'ready' ? (
                            <div className="flex items-center justify-end gap-1.5">
                              <input
                                aria-label="Received by"
                                className={`${smallInput} !w-36`}
                                placeholder="Received by"
                                value={signers[r.id] || ''}
                                onChange={e => setSigners(s => ({ ...s, [r.id]: e.target.value }))}
                              />
                              <button className={btnPrimary} disabled={busy} onClick={() => void markDelivered(r)}>
                                <PackageCheck size={13} />
                                Hand over
                              </button>
                            </div>
                          ) : canFulfil && ['delivered', 'partial_return'].includes(r.status) ? (
                            <button className={btnGhost} onClick={() => setOpenReturn(returning ? '' : r.id)}>
                              <RotateCcw size={13} />
                              {returning ? 'Close' : 'Record return'}
                            </button>
                          ) : r.status === 'pending_approval' ? (
                            <span className="text-[11.5px] text-mute">Waiting for IT</span>
                          ) : r.status === 'approved' ? (
                            <span className="text-[11.5px] text-mute">Use “Name &amp; allocate”</span>
                          ) : r.return_feedback ? (
                            <span className="line-clamp-2 text-[11.5px] text-mute" title={r.return_feedback}>
                              “{r.return_feedback}”
                            </span>
                          ) : (
                            <span className="text-faint">—</span>
                          )}
                        </td>
                      </tr>
                      {returning && (
                        <tr className="bg-raised/20">
                          <td colSpan={eventId ? 7 : 8} className="px-3 pb-4 pt-1">
                            {/* Tick the radios actually handed back (not "the first N"). */}
                            <div className="mb-2 rounded-lg border border-line bg-surface p-3">
                              <div className="mb-2 flex items-center justify-between text-[11.5px] text-mute">
                                <span>
                                  Radios handed back · {(returnPick[r.id] || []).length} of {stillOut(r).length} ticked
                                </span>
                                <button
                                  type="button"
                                  className="font-medium text-blue-300 hover:underline"
                                  onClick={() => setReturnPick(v => ({ ...v, [r.id]: stillOut(r) }))}
                                >
                                  Tick all
                                </button>
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {stillOut(r).map(id => {
                                  const on = (returnPick[r.id] || []).includes(id);
                                  return (
                                    <button
                                      key={id}
                                      type="button"
                                      aria-pressed={on}
                                      onClick={() =>
                                        setReturnPick(v => {
                                          const cur = v[r.id] || [];
                                          return { ...v, [r.id]: on ? cur.filter(x => x !== id) : [...cur, id] };
                                        })
                                      }
                                      className={`rounded-md border px-2 py-1 font-mono text-[10.5px] transition-colors ${on ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300' : 'border-line text-ink-soft hover:bg-raised'}`}
                                    >
                                      {on ? '✓ ' : ''}
                                      {radioLabel(id)}
                                    </button>
                                  );
                                })}
                                {!stillOut(r).length && (
                                  <span className="text-[11.5px] text-mute">
                                    No radios of this request are still out.
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="grid gap-3 rounded-lg border border-line bg-surface p-3 sm:grid-cols-[repeat(2,minmax(0,8rem))_minmax(0,1fr)_auto] sm:items-end">
                              {[
                                ['chargers', 'Chargers back', r.delivered_chargers - r.returned_chargers],
                                ['earphones', 'Earphones back', r.delivered_earphones - r.returned_earphones],
                              ].map(([key, label, max]) => (
                                <label key={key} className="text-[11.5px] text-mute">
                                  {label} <span className="text-faint">(of {max})</span>
                                  <input
                                    className={`${smallInput} mt-1`}
                                    type="number"
                                    min="0"
                                    max={max}
                                    value={qty[key]}
                                    onChange={e =>
                                      setReturnCounts(v => ({ ...v, [r.id]: { ...qty, [key]: e.target.value } }))
                                    }
                                  />
                                </label>
                              ))}
                              <label className="text-[11.5px] text-mute">
                                Department feedback <span className="text-rose-400">*</span>
                                <input
                                  className={`${smallInput} mt-1`}
                                  value={feedback[r.id] || ''}
                                  onChange={e => setFeedback(s => ({ ...s, [r.id]: e.target.value }))}
                                  placeholder="Condition, anything missing, how it went"
                                />
                              </label>
                              <button
                                disabled={busy || !(feedback[r.id] || '').trim()}
                                onClick={() => void submitReturn(r)}
                                className={btnPrimary}
                              >
                                <RotateCcw size={13} />
                                Save return
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-4 py-10 text-center text-xs text-mute">
            {visible.length ? 'Nothing in this stage.' : `No walkie requests for ${event?.name || 'this event'} yet.`}
          </div>
        )}
      </div>

      {/* Supporting information */}
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          <div className="border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold text-ink">Demand by department</h2>
            <p className="mt-0.5 text-[11.5px] text-mute">Active requests for this event, declined ones left out.</p>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-raised/40 text-[10.5px] uppercase tracking-wide text-mute">
                <th className={th}>Department</th>
                <th className={th}>Walkies</th>
                <th className={th}>Chargers</th>
                <th className={th}>Earphones</th>
              </tr>
            </thead>
            <tbody>
              {grouped.map(g => (
                <tr key={g.department} className="border-t border-line/80">
                  <td className={`${td} font-medium text-ink`}>{g.department}</td>
                  <td className={`${td} tabular-nums`}>{g.walkies}</td>
                  <td className={`${td} tabular-nums`}>{g.chargers}</td>
                  <td className={`${td} tabular-nums`}>{g.earphones}</td>
                </tr>
              ))}
              {!grouped.length && (
                <tr>
                  <td colSpan="4" className="px-3 py-6 text-center text-mute">
                    No active requests.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-ink">Radios inside item requests</h2>
              <p className="mt-0.5 text-[11.5px] text-mute">
                Item requests that also ask for walkie-talkies. Handed over from the request itself.
              </p>
            </div>
          </div>
          {departmentRadioRequests.length ? (
            <ul className="divide-y divide-line/80">
              {departmentRadioRequests.map(r => (
                <li key={r.id}>
                  <a
                    href={`#/requests/${r.id}`}
                    className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs hover:bg-raised/30"
                  >
                    <span className="min-w-0">
                      <span className="font-mono text-mute">{r.number}</span>{' '}
                      <span className="font-medium text-ink">{r.title}</span>
                      <span className="block truncate text-[10.5px] text-mute">
                        {r.fromDepartmentName || r.requesterName} ·{' '}
                        {r.items
                          .filter(item => item.kind === 'radio')
                          .map(item => `${item.requested} ${item.name}`)
                          .join(' · ')}
                      </span>
                    </span>
                    <span className="shrink-0 rounded-full bg-raised px-2 py-0.5 text-[10.5px] text-ink-soft">
                      {requestStatus(r)}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-6 text-center text-xs text-mute">None.</p>
          )}
        </div>
      </div>

      <datalist id="walkie-pickup-points">
        <option value="Main Control Room" />
        <option value="Walkie-Talkie Store" />
        <option value="IT Office" />
        <option value="Control Room" />
      </datalist>
    </section>
  );
}
