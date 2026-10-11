import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, PackageCheck, Radio, RefreshCw, RotateCcw, Send, X } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { supabase } from '../lib/supabaseClient';
import { useRequests } from '../../requests';

const statusLabels = {
  pending_approval: 'Waiting for approval', approved: 'Approved · awaiting allocation', rejected: 'Declined',
  ready: 'Ready to pick up / deliver', delivered: 'Delivered', partial_return: 'Partially returned', returned: 'Returned'
};
const statusTone = {
  pending_approval: 'bg-amber-500/10 text-amber-300', approved: 'bg-blue-500/10 text-blue-300', rejected: 'bg-red-500/10 text-red-300',
  ready: 'bg-violet-500/10 text-violet-300', delivered: 'bg-cyan-500/10 text-cyan-300', partial_return: 'bg-orange-500/10 text-orange-300', returned: 'bg-emerald-500/10 text-emerald-300'
};
const safeCount = (x) => Math.max(0, Math.floor(Number(x) || 0));

export default function EventRadioRequests() {
  const { currentUser, departments, walkies, allocateWalkies, availableChargers, availableEarphones, settings, addToast } = useApp();
  const { requests: organizationRequests } = useRequests();
  const orgId = currentUser?.organizationId;
  const canApprove = currentUser?.level === 'owner' || currentUser?.level === 'dept_head';
  const canRequest = currentUser?.role !== 'Client' && ['owner', 'dept_head', 'sub_dept_head'].includes(currentUser?.level);
  const canFulfil = ['Admin', 'Operator'].includes(currentUser?.role) && (currentUser?.level === 'owner' || (currentUser?.level === 'sub_dept_head' && currentUser?.subDepartment === 'walkie'));
  const deptId = currentUser?.departmentId || '';
  const ownDept = departments.find(d => d.id === deptId);
  const dark = settings.theme === 'dark';
  const [events, setEvents] = useState([]);
  const [requests, setRequests] = useState([]);
  const [eventId, setEventId] = useState('');
  const [form, setForm] = useState({ walkies: '1', chargers: '0', earphones: '0' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState({});
  const [returnCounts, setReturnCounts] = useState({});
  const [signers, setSigners] = useState({});

  const load = useCallback(async () => {
    if (!orgId) return;
    const [ev, rq] = await Promise.all([
      supabase.from('event_plans').select('id,name,starts_at,status').eq('organization_id', orgId).neq('status', 'cancelled').order('starts_at', { ascending: false }),
      supabase.from('event_radio_requests').select('*').eq('organization_id', orgId).order('created_at', { ascending: false })
    ]);
    if (ev.error || rq.error) {
      setError((ev.error || rq.error).message || 'Could not load event requests.');
      return;
    }
    setEvents(ev.data || []); setRequests(rq.data || []);
    setEventId(current => current || ev.data?.[0]?.id || '');
    setError('');
  }, [orgId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!orgId) return;
    const channel = supabase.channel(`event-radio-${orgId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'event_radio_requests', filter: `organization_id=eq.${orgId}` }, load).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [orgId, load]);

  const visible = useMemo(() => requests.filter(r => !eventId || r.event_id === eventId), [requests, eventId]);
  const summary = useMemo(() => visible.reduce((s, r) => {
    if (r.status === 'rejected') return s;
    s.walkies += r.walkie_count; s.chargers += r.charger_count; s.earphones += r.earphone_count;
    s.delivered += r.delivered_walkies || 0; s.returned += r.returned_walkies || 0;
    return s;
  }, { walkies: 0, chargers: 0, earphones: 0, delivered: 0, returned: 0 }), [visible]);
  const grouped = useMemo(() => {
    const map = new Map();
    visible.filter(r => r.status !== 'rejected').forEach(r => {
      const x = map.get(r.department_id) || { department: r.department_name, walkies: 0, chargers: 0, earphones: 0, tickets: 0 };
      x.walkies += r.walkie_count; x.chargers += r.charger_count; x.earphones += r.earphone_count; x.tickets += 1; map.set(r.department_id, x);
    });
    return [...map.values()];
  }, [visible]);

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    const { error: err } = await supabase.rpc('event_radio_request_submit', { p_event_id: eventId, p_walkies: safeCount(form.walkies), p_chargers: safeCount(form.chargers), p_earphones: safeCount(form.earphones) });
    setBusy(false);
    if (err) { setError(err.message); return; }
    setForm({ walkies: '1', chargers: '0', earphones: '0' }); addToast('Event radio request sent for approval.'); await load();
  };

  const decide = async (r, approve) => {
    setBusy(true); setError('');
    const { error: err } = await supabase.rpc('event_radio_request_decide', { p_id: r.id, p_approve: approve, p_note: '' });
    setBusy(false); if (err) setError(err.message); else await load();
  };

  const syncOne = async (r, nextSerial) => {
    const dept = departments.find(d => d.id === r.department_id);
    if (!dept) throw new Error(`Department for request ${r.id} is missing.`);
    const available = walkies.filter(w => w.status === 'Available').sort((a, b) => (a.label || '').localeCompare(b.label || '', undefined, { numeric: true }));
    if (available.length < r.walkie_count) throw new Error(`Only ${available.length} radios are available; ${r.walkie_count} are needed for ${dept.name}.`);
    if (r.charger_count > availableChargers || r.earphone_count > availableEarphones) throw new Error('There are not enough chargers or earphones in stock for this request.');
    const picked = available.slice(0, r.walkie_count);
    const code = (dept.code || dept.name.replace(/[^a-z0-9]/gi, '').slice(0, 4) || 'DEPT').toUpperCase();
    const year = new Date(events.find(e => e.id === r.event_id)?.starts_at || Date.now()).getFullYear();
    const labels = picked.map((_, i) => `GP-${year}-${code}-${String(nextSerial + i).padStart(4, '0')}`);
    const renamed = await Promise.all(picked.map((w, i) => supabase.from('walkies').update({ label: labels[i], is_rented: true }).eq('id', w.id)));
    const nameErr = renamed.find(result => result.error)?.error;
    if (nameErr) throw nameErr;
    const allocation = await allocateWalkies(dept.id, picked.map(w => w.id), currentUser?.name || '', `Event radio request ${r.id}`, '', '', r.charger_count, r.earphone_count);
    if (!allocation) throw new Error(`Allocation failed for ${dept.name}. Check radio and accessory stock.`);
    const { error: linkErr } = await supabase.from('allocations').update({ event_radio_request_id: r.id }).eq('id', allocation.id);
    if (linkErr) throw linkErr;
    const { error: rpcErr } = await supabase.rpc('event_radio_request_allocate', { p_id: r.id, p_walkie_ids: picked.map(w => w.id) });
    if (rpcErr) throw rpcErr;
    return nextSerial + r.walkie_count;
  };

  const syncAndAllocate = async () => {
    const approved = visible.filter(r => r.status === 'approved');
    if (!approved.length) return;
    if (!canFulfil) return;
    setBusy(true); setError('');
    const counters = new Map();
    try {
      for (const r of approved) {
        const dept = departments.find(d => d.id === r.department_id);
        const code = (dept?.code || dept?.name?.replace(/[^a-z0-9]/gi, '').slice(0, 4) || 'DEPT').toUpperCase();
        const year = new Date(events.find(e => e.id === r.event_id)?.starts_at || Date.now()).getFullYear();
        const counterKey = `${year}:${code}`;
        const existingMax = Math.max(0, ...walkies.map(w => {
          const match = (w.label || '').match(new RegExp(`^GP-${year}-${code}-(\\d+)$`, 'i'));
          return match ? Number(match[1]) : 0;
        }));
        const next = counters.has(counterKey) ? counters.get(counterKey) : existingMax + 1;
        counters.set(counterKey, await syncOne(r, next));
      }
      addToast('Approved requests were named and allocated. They are ready for handover.');
      await load();
    } catch (e) { setError(e.message || 'Could not finish allocation.'); await load(); }
    setBusy(false);
  };

  const markDelivered = async (r) => {
    setBusy(true); setError('');
    const { error: err } = await supabase.rpc('event_radio_request_deliver', { p_id: r.id, p_signed_by: signers[r.id] || '' });
    setBusy(false); if (err) setError(err.message); else await load();
  };

  const submitReturn = async (r) => {
    const qty = returnCounts[r.id] || { walkies: 0, chargers: 0, earphones: 0 };
    const n = safeCount(qty.walkies);
    if (!n) { setError('Enter the number of walkies received back.'); return; }
    if (!(feedback[r.id] || '').trim()) { setError('Add feedback from the department before recording this return.'); return; }
    setBusy(true); setError('');
    const allocated = (await supabase.from('allocations').select('id,walkie_ids').eq('event_radio_request_id', r.id).eq('status', 'Active')).data || [];
    const ids = allocated.flatMap(a => Array.isArray(a.walkie_ids) ? a.walkie_ids : []).slice(0, n);
    if (ids.length !== n) { setBusy(false); setError('Could not match the returned radios to this request.'); return; }
    const { error: retErr } = await supabase.rpc('event_radio_request_return', { p_id: r.id, p_walkie_ids: ids, p_walkies: n, p_chargers: safeCount(qty.chargers), p_earphones: safeCount(qty.earphones), p_feedback: feedback[r.id] || '' });
    setBusy(false); if (retErr) setError(retErr.message); else { addToast('Return and feedback recorded.'); await load(); }
  };

  const input = `w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-blue-500 ${dark ? 'bg-slate-950 border-slate-700 text-slate-100' : 'bg-white border-slate-200 text-slate-900'}`;
  const panel = `rounded-xl border p-4 ${dark ? 'border-slate-800 bg-slate-900/70' : 'border-slate-200 bg-white'}`;
  const event = events.find(e => e.id === eventId);
  const deliveryPct = summary.walkies ? Math.round(summary.delivered * 100 / summary.walkies) : 0;
  const returnPct = summary.delivered ? Math.round(summary.returned * 100 / summary.delivered) : 0;
  const approvalsOpen = visible.some(r => r.status === 'pending_approval');
  const departmentRadioRequests = organizationRequests.filter(r => r.items.some(item => item.kind === 'radio'));
  const requestStatus = (r) => {
    if (r.status === 'pending_sub') return 'Waiting for department head';
    if (r.status === 'pending_it') return 'Waiting for IT head';
    if (r.status === 'pending_owner') return 'Waiting for Super Admin';
    if (r.status === 'rejected') return 'Declined';
    if (r.status === 'cancelled') return 'Cancelled';
    if (r.status === 'fulfilled') return 'Delivered';
    if (r.status === 'approved') {
      const lines = r.items.filter(item => item.kind === 'radio' && (item.approved ?? 0) > 0);
      const ready = lines.length > 0 && lines.every(item => r.parts.filter(part => part.itemId === item.id).reduce((sum, part) => sum + part.qty, 0) >= (item.approved ?? 0));
      return ready ? 'Ready to pick up / deliver' : 'With Walkie team';
    }
    return 'Waiting for approval';
  };

  return <section className="space-y-5" aria-labelledby="event-radio-heading">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><div className="flex items-center gap-2"><Radio className="h-5 w-5 text-blue-400" /><h1 id="event-radio-heading" className="text-xl font-semibold">Event walkie requests</h1></div><p className="mt-1 text-xs text-mute">Requests stay separate for approval; approved quantities roll up into one event demand.</p></div>
      <button className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-xs hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500" onClick={() => void load()}><RefreshCw size={14} />Refresh</button>
    </header>
    {error && <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}
    <div className="flex flex-wrap items-center gap-3"><label className="text-xs text-mute" htmlFor="event-radio-event">Event</label><select id="event-radio-event" className={`${input} max-w-md`} value={eventId} onChange={e => setEventId(e.target.value)}><option value="">Choose an event</option>{events.map(e => <option key={e.id} value={e.id}>{e.name} · {new Date(e.starts_at).toLocaleDateString('en-IN')}</option>)}</select></div>
    <div className={`${panel} space-y-3`}>
      <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-sm font-semibold">Department walkie requests</h2><p className="mt-1 text-xs text-mute">Requests raised from Requests → New request. They stay here with their approval and Walkie team status.</p></div><a href="#/requests/fulfil" className="text-xs font-medium text-blue-400 hover:underline">Open request workflow</a></div>
      {departmentRadioRequests.length ? <div className="divide-y divide-line">{departmentRadioRequests.map(r => {
        const radioLines = r.items.filter(item => item.kind === 'radio');
        const quantities = radioLines.map(item => `${item.requested} ${item.name}`).join(' · ');
        return <a key={r.id} href={`#/requests/${r.id}`} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-1 last:pb-1 hover:bg-raised/20">
          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{r.title} <span className="ml-1 text-xs font-normal text-mute">{r.number}</span></span><span className="mt-1 block text-xs text-mute">{r.requesterName}{r.subDepartment ? ` · ${r.subDepartment}` : ''} · {quantities}</span></span>
          <span className={`rounded-full px-2.5 py-1 text-[11px] ${r.status === 'approved' ? 'bg-blue-500/10 text-blue-300' : r.status === 'fulfilled' ? 'bg-emerald-500/10 text-emerald-300' : r.status === 'rejected' || r.status === 'cancelled' ? 'bg-red-500/10 text-red-300' : 'bg-amber-500/10 text-amber-300'}`}>{requestStatus(r)}</span>
        </a>;
      })}</div> : <p className="py-2 text-xs text-mute">No general walkie requests yet.</p>}
    </div>
    {ownDept && currentUser?.level !== 'owner' && canRequest && <form onSubmit={submit} className={panel}>
      <h2 className="text-sm font-semibold">Request for {ownDept.name}</h2><p className="mt-1 text-xs text-mute">No reason or extra items are required. The request goes to your department owner or Super Admin for approval.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {[['walkies','Walkies',1],['chargers','Chargers',0],['earphones','Earphones',0]].map(([key,label,min]) => <label key={key} className="text-xs text-mute">{label}<input className={`${input} mt-1`} type="number" min={min} step="1" value={form[key]} onChange={e => setForm(v => ({ ...v, [key]: e.target.value }))} /></label>)}
      </div>
      <button disabled={busy || !eventId} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"><Send size={14} />Send request</button>
    </form>}
    {!ownDept && currentUser?.level !== 'owner' && canRequest && <div className={panel}>Your login is not assigned to a department yet. An administrator can assign it under Walkie users → Access level.</div>}

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {[["Requested walkies",summary.walkies],["Delivered",`${summary.delivered} · ${deliveryPct}%`],["Returned",`${summary.returned} · ${returnPct}%`],["Accessories",`${summary.chargers} chargers · ${summary.earphones} earphones`]].map(([label,value]) => <div key={label} className={panel}><div className="text-xs text-mute">{label}</div><div className="mt-1 text-lg font-semibold tabular-nums">{value}</div></div>)}
    </div>
    <div className={`${panel} space-y-3`}>
      <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Event progress</h2><span className="text-xs text-mute">{event?.name || 'Select an event'}</span></div>
      {[["Delivery",summary.delivered,summary.walkies,deliveryPct],["Returns",summary.returned,summary.delivered,returnPct]].map(([label,n,total,pct]) => <div key={label}><div className="mb-1 flex justify-between text-xs"><span>{label}</span><span className="tabular-nums">{n}/{total} · {pct}%</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-700/50"><div className="h-full rounded-full bg-blue-500 transition-[width] duration-200" style={{ width: `${pct}%` }} /></div></div>)}
    </div>

    <div className={panel}><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold">Consolidated requirement</h2><p className="mt-1 text-xs text-mute">Totals combine active requests for this event, while the tickets below remain separate. Sync after all submitted requests are reviewed.</p></div>{canFulfil && <button disabled={busy || approvalsOpen || !visible.some(r => r.status === 'approved')} onClick={() => void syncAndAllocate()} title={approvalsOpen ? 'Review every submitted request before allocation.' : 'Generate radio labels and allocate approved quantities.'} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"><PackageCheck size={14} />Sync naming &amp; allocate</button>}</div>
      <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[520px] text-xs"><thead className="text-left text-mute"><tr><th className="py-2">Department</th><th className="py-2">Requests</th><th className="py-2">Walkies</th><th className="py-2">Chargers</th><th className="py-2">Earphones</th></tr></thead><tbody className="divide-y divide-line">{grouped.map(g => <tr key={g.department}><td className="py-2 font-medium">{g.department}</td><td>{g.tickets}</td><td>{g.walkies}</td><td>{g.chargers}</td><td>{g.earphones}</td></tr>)}{!grouped.length && <tr><td colSpan="5" className="py-6 text-center text-mute">No active requests for this event.</td></tr>}</tbody></table></div>
    </div>

    <div className={`${panel} overflow-hidden`}><h2 className="mb-3 text-sm font-semibold">Request tickets</h2><div className="space-y-3">{visible.map(r => {
      const isOwner = currentUser?.level === 'owner';
      const mayDecide = canApprove && r.status === 'pending_approval' && (isOwner || (currentUser?.level === 'dept_head' && deptId === r.department_id));
      const canReturn = canFulfil && ['delivered','partial_return'].includes(r.status);
      const qty = returnCounts[r.id] || { walkies: '', chargers: '', earphones: '' };
      const allocatedIds = Array.isArray(r.allocated_walkie_ids) ? r.allocated_walkie_ids : [];
      return <article key={r.id} className="rounded-lg border border-line bg-raised/30 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2"><div><div className="text-sm font-medium">{r.department_name}<span className="ml-2 text-xs text-mute">{r.requester_name}</span></div><div className="mt-1 text-xs text-mute">{r.walkie_count} walkies · {r.charger_count} chargers · {r.earphone_count} earphones</div><div className="mt-1 text-[11px] text-mute">{new Date(r.created_at).toLocaleString('en-IN')}{r.approval_note ? ` · ${r.approval_note}` : ''}</div></div><span className={`rounded-full px-2 py-1 text-[11px] ${statusTone[r.status]}`}>{statusLabels[r.status]}</span></div>
        {mayDecide && <div className="mt-3 flex gap-2"><button disabled={busy} onClick={() => void decide(r,true)} className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1.5 text-xs text-white disabled:opacity-50"><Check size={13}/>Approve</button><button disabled={busy} onClick={() => void decide(r,false)} className="inline-flex items-center gap-1 rounded-md border border-line px-2.5 py-1.5 text-xs hover:bg-raised disabled:opacity-50"><X size={13}/>Decline</button></div>}
        {canFulfil && r.status === 'ready' && <div className="mt-3 flex flex-wrap items-end gap-2"><label className="text-xs text-mute">Received by<input className={`${input} mt-1 max-w-xs`} value={signers[r.id] || ''} onChange={e => setSigners(s => ({ ...s, [r.id]: e.target.value }))} /></label><button disabled={busy} onClick={() => void markDelivered(r)} className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-2 text-xs text-white disabled:opacity-50"><PackageCheck size={13}/>Mark delivered</button><span className="text-[11px] text-mute">{allocatedIds.length} named radios: {allocatedIds.slice(0,3).join(', ')}{allocatedIds.length > 3 ? '…' : ''}</span></div>}
        {canReturn && <div className="mt-3 grid gap-2 sm:grid-cols-4"><label className="text-[11px] text-mute">Walkies received<input className={`${input} mt-1`} type="number" min="0" max={r.delivered_walkies-r.returned_walkies} value={qty.walkies} onChange={e => setReturnCounts(v => ({ ...v, [r.id]: { ...qty, walkies: e.target.value } }))}/></label><label className="text-[11px] text-mute">Chargers<input className={`${input} mt-1`} type="number" min="0" max={r.delivered_chargers-r.returned_chargers} value={qty.chargers} onChange={e => setReturnCounts(v => ({ ...v, [r.id]: { ...qty, chargers: e.target.value } }))}/></label><label className="text-[11px] text-mute">Earphones<input className={`${input} mt-1`} type="number" min="0" max={r.delivered_earphones-r.returned_earphones} value={qty.earphones} onChange={e => setReturnCounts(v => ({ ...v, [r.id]: { ...qty, earphones: e.target.value } }))}/></label><button disabled={busy || !(feedback[r.id] || '').trim()} onClick={() => void submitReturn(r)} className="mt-auto inline-flex items-center justify-center gap-1 rounded-md bg-emerald-600 px-2.5 py-2 text-xs text-white disabled:opacity-50"><RotateCcw size={13}/>Record return</button><label className="text-[11px] text-mute sm:col-span-4">Department feedback <span className="text-rose-400">*</span><textarea required className={`${input} mt-1`} rows="2" value={feedback[r.id] || ''} onChange={e => setFeedback(s => ({ ...s, [r.id]: e.target.value }))} placeholder="Ask the department for return feedback: condition, missing items, or experience"/></label></div>}
      </article>;
    })}{!visible.length && <div className="py-8 text-center text-xs text-mute">No requests for this event yet.</div>}</div></div>
  </section>;
}
