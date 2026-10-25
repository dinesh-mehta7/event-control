import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, ArrowRightLeft, Radio, Search } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { supabase } from '../lib/supabaseClient';
import { Select } from '../../../components/Select';
import { btnPrimary, inputCls } from '../../../components/ui';

const label = 'mb-1.5 block text-[10.5px] font-semibold uppercase tracking-wider text-faint';
const panel = 'rounded-xl border border-line bg-surface';

// Move one radio that is out with a department straight to another department, without returning it
// first. Chargers / earphones can move with it from the radio's allocation batch. The server function
// (walkie_transfer) keeps the batch's event and, for an event walkie request, counts it as transferred.
export default function TransferView() {
  const { walkies, departments, allocations, transferWalkie, currentUser } = useApp();
  const isClient = currentUser?.role === 'Client';
  const [query, setQuery] = useState('');
  const [walkieId, setWalkieId] = useState('');
  const [target, setTarget] = useState('');
  const [chargers, setChargers] = useState('0');
  const [earphones, setEarphones] = useState('0');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  // The radio's active batch, read from the database: the batch may belong to another event than the
  // one in "Working on", which the allocations on screen are limited to.
  const [batch, setBatch] = useState(null);

  const deptName = id => departments.find(d => d.id === id)?.name || 'Unknown';
  const out = useMemo(
    () =>
      walkies
        .filter(w => w.status === 'Allocated')
        .sort((a, b) => (a.label || '').localeCompare(b.label || '', undefined, { numeric: true })),
    [walkies],
  );
  const term = query.trim().toLowerCase();
  const matches = out.filter(
    w =>
      !term ||
      (w.label || '').toLowerCase().includes(term) ||
      w.id.toLowerCase().includes(term) ||
      deptName(w.departmentId).toLowerCase().includes(term),
  );
  const radio = walkies.find(w => w.id === walkieId);

  useEffect(() => {
    setBatch(null);
    if (!walkieId) return;
    let on = true;
    supabase
      .from('allocations')
      .select('id,walkie_ids,charger_count,earphone_count,event_radio_request_id')
      .eq('status', 'Active')
      .contains('walkie_ids', [walkieId])
      .limit(1)
      .then(({ data }) => on && setBatch(data?.[0] || null));
    return () => {
      on = false;
    };
  }, [walkieId]);

  const held = { chargers: batch?.charger_count || 0, earphones: batch?.earphone_count || 0 };
  const c = Math.max(0, parseInt(chargers, 10) || 0);
  const e = Math.max(0, parseInt(earphones, 10) || 0);
  const accessoriesOk = c <= held.chargers && e <= held.earphones;
  const lastInBatch = !!batch && (batch.walkie_ids || []).length === 1;
  const can = !!radio && !!target && target !== radio?.departmentId && accessoriesOk && reason.trim() && !isClient;

  const submit = async ev => {
    ev.preventDefault();
    if (!can) return;
    setBusy(true);
    const ok = await transferWalkie(walkieId, target, reason.trim(), c, e);
    setBusy(false);
    if (ok) {
      setWalkieId('');
      setTarget('');
      setChargers('0');
      setEarphones('0');
      setReason('');
    }
  };

  // Recent transfers: allocations the server created for a transfer (in the event shown in "Working on").
  const recent = allocations.filter(a => (a.remarks || '').startsWith('Transferred from')).slice(0, 12);

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
      <form onSubmit={submit} className={`${panel} space-y-5 p-5`}>
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <ArrowRightLeft size={16} className="text-blue-400" />
            Transfer a radio
          </h2>
          <p className="mt-1 text-xs text-mute">
            Move a radio that is with one department straight to another, without returning it first.
          </p>
        </div>

        <div>
          <span className={label}>1 · Radio</span>
          <div className="relative mb-2">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input
              className={`${inputCls} pl-8`}
              placeholder="Search radio name or department"
              value={query}
              onChange={ev => setQuery(ev.target.value)}
              disabled={isClient}
            />
          </div>
          <div className="grid max-h-56 gap-1.5 overflow-y-auto rounded-lg border border-line p-1.5 sm:grid-cols-2">
            {matches.map(w => {
              const on = w.id === walkieId;
              return (
                <button
                  key={w.id}
                  type="button"
                  disabled={isClient}
                  onClick={() => {
                    setWalkieId(w.id);
                    setChargers('0');
                    setEarphones('0');
                  }}
                  className={`rounded-md border px-2.5 py-2 text-left transition-colors ${on ? 'border-blue-500 bg-blue-500/10' : 'border-transparent hover:bg-raised'}`}
                >
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-ink">
                    <Radio size={12} className="text-faint" />
                    {w.label || w.id}
                  </div>
                  <div className="mt-0.5 text-[10.5px] text-mute">
                    {deptName(w.departmentId)}
                    {w.channel ? ` · CH ${w.channel}` : ''}
                  </div>
                </button>
              );
            })}
            {!matches.length && (
              <p className="col-span-full py-4 text-center text-xs text-mute">
                {term ? `No radio out with a department matches “${query}”.` : 'No radios are out with departments.'}
              </p>
            )}
          </div>
        </div>

        <div>
          <span className={label}>2 · Move to</span>
          {radio && (
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-md bg-raised px-2 py-1 text-ink-soft">{deptName(radio.departmentId)}</span>
              <ArrowRight size={13} className="text-faint" />
              <span
                className={`rounded-md px-2 py-1 ${target ? 'bg-blue-500/15 text-blue-300' : 'bg-raised text-faint'}`}
              >
                {target ? deptName(target) : 'Choose department'}
              </span>
            </div>
          )}
          <Select
            className={inputCls}
            value={target}
            onChange={ev => setTarget(ev.target.value)}
            disabled={isClient || !radio}
            aria-label="Department to move the radio to"
          >
            <option value="">Choose department</option>
            {departments
              .filter(d => d.id !== radio?.departmentId)
              .map(d => (
                <option key={d.id} value={d.id}>
                  {d.name}
                  {d.channelNumber ? ` · channel ${d.channelNumber}` : ''}
                </option>
              ))}
          </Select>
        </div>

        <div>
          <span className={label}>3 · Accessories to move with it</span>
          <div className="grid grid-cols-2 gap-3">
            {[
              ['Chargers', chargers, setChargers, held.chargers],
              ['Earphones', earphones, setEarphones, held.earphones],
            ].map(([name, value, set, max]) => (
              <label key={name} className="text-[11.5px] text-mute">
                {name} <span className="text-faint">(batch holds {max})</span>
                <input
                  type="number"
                  min="0"
                  max={max}
                  className={`${inputCls} mt-1`}
                  value={value}
                  disabled={isClient || !radio}
                  onChange={ev => set(ev.target.value)}
                />
              </label>
            ))}
          </div>
          {radio && !accessoriesOk && (
            <p className="mt-1.5 text-[11.5px] text-rose-400">
              The batch holds only {held.chargers} charger(s) and {held.earphones} earphone(s).
            </p>
          )}
          {radio && accessoriesOk && lastInBatch && held.chargers + held.earphones > c + e && (
            <p className="mt-1.5 text-[11.5px] text-amber-300">
              Last radio of its batch: the {held.chargers - c} charger(s) and {held.earphones - e} earphone(s) not moved
              go back to stock.
            </p>
          )}
          {batch?.event_radio_request_id && (
            <p className="mt-1.5 text-[11.5px] text-violet-300">
              Given on an event walkie request — the request will count it as transferred.
            </p>
          )}
        </div>

        <label className="block">
          <span className={label}>4 · Reason</span>
          <input
            className={inputCls}
            placeholder="e.g. Security needs one more at Gate 2"
            value={reason}
            onChange={ev => setReason(ev.target.value)}
            disabled={isClient}
          />
        </label>

        <button type="submit" disabled={!can || busy} className={`${btnPrimary} w-full justify-center`}>
          <ArrowRightLeft size={14} />
          {busy ? 'Transferring…' : radio && target ? `Transfer to ${deptName(target)}` : 'Transfer'}
        </button>
      </form>

      <div className="space-y-5">
        <div className={`${panel} overflow-hidden`}>
          <div className="border-b border-line px-4 py-3">
            <h3 className="text-sm font-semibold text-ink">Recent transfers</h3>
            <p className="mt-0.5 text-[11.5px] text-mute">For the event in “Working on”.</p>
          </div>
          {recent.length ? (
            <ul className="divide-y divide-line/80">
              {recent.map(a => (
                <li key={a.id} className="px-4 py-2.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-ink">
                      {(a.walkieIds || []).map(id => walkies.find(w => w.id === id)?.label || id).join(', ')}
                    </span>
                    <span className="text-[10.5px] text-faint">{a.date}</span>
                  </div>
                  <div className="mt-0.5 text-mute">
                    {a.remarks.replace(/^Transferred from /, '').split('.')[0]} → {deptName(a.departmentId)}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-6 text-center text-xs text-mute">No transfers yet.</p>
          )}
        </div>

        <div className={`${panel} p-4`}>
          <h3 className="text-sm font-semibold text-ink">Out with departments · {out.length}</h3>
          <div className="mt-2 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
            {out.map(w => (
              <span key={w.id} className="rounded-md bg-raised px-2 py-1 text-[10.5px] text-ink-soft">
                {w.label || w.id} · {deptName(w.departmentId)}
              </span>
            ))}
            {!out.length && <span className="text-xs text-mute">None.</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
