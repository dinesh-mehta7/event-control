import React, { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Modal, inputCls, labelCls } from '../../accommodation/ui';
import { useInventory } from '../InventoryContext';
import { MOVE } from '../types';
import type { MoveType } from '../types';
import { stockDelta } from '../lib/stock';
import { D, TONE, cx, ghost, primary } from '../ui/kit';
import { Select } from '../../../components/Select';

// Movement types grouped by what they do, so the right one is quick to find.
const GROUPS: { label: string; types: MoveType[] }[] = [
  { label: 'Out & in', types: ['issue', 'receive', 'return'] },
  { label: 'Condition', types: ['return_damaged', 'damage', 'repair', 'write_off'] },
  { label: 'Correction', types: ['adjust'] },
];

export const MoveModal: React.FC<{ start: { itemId: string; type: MoveType }; onClose: () => void }> = ({
  start,
  onClose,
}) => {
  const { items, holdingsOf, move, locationLabel, locations, ensureLocation, userName } = useInventory();
  const [itemId, setItemId] = useState(start.itemId);
  const [type, setType] = useState<MoveType>(start.type);
  const [qty, setQty] = useState('');
  const [loc, setLoc] = useState(''); // Issue: the place name you type or pick · Return: id of the location it comes back from
  const [givenBy, setGivenBy] = useState('');
  const [receivedBy, setReceivedBy] = useState('');
  const [returnedBy, setReturnedBy] = useState('');
  const [ref, setRef] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const it = items.find(x => x.id === itemId);
  const meta = MOVE[type];
  const held = it ? holdingsOf(it.id) : [];
  const isIssue = type === 'issue';
  const isReturn = type === 'return' || type === 'return_damaged';
  const isReceive = type === 'receive';
  useEffect(() => {
    setLoc('');
  }, [type, itemId]);
  useEffect(() => {
    setGivenBy(isIssue ? userName : '');
    setReceivedBy(isReturn || isReceive ? userName : '');
    setReturnedBy('');
  }, [type]); // eslint-disable-line

  const n = qty === '' || qty === '-' ? 0 : parseInt(qty, 10) || 0;
  const delta = stockDelta(type, n);
  const atLoc = held.find(h => h.location === loc)?.qty || 0;
  const problem = !it
    ? 'Pick an item.'
    : !n
      ? ''
      : it.inStock + delta.s < 0
        ? `Only ${it.inStock} ${it.unit} in store.`
        : it.damaged + delta.d < 0
          ? `Only ${it.damaged} damaged on record.`
          : isReturn && loc && atLoc < n
            ? `${locationLabel(loc)} has only ${atLoc}.`
            : '';
  const locOk = !meta.needsLocation || (isIssue ? loc.trim() !== '' : loc !== '');
  const peopleOk = isIssue ? receivedBy.trim() !== '' : isReturn ? returnedBy.trim() !== '' : true;
  const can = !!it && n !== 0 && (type === 'adjust' || n > 0) && locOk && peopleOk && !problem;
  const isNewPlace =
    isIssue && loc.trim() !== '' && !locations.some(l => l.name.toLowerCase() === loc.trim().toLowerCase());

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!can) return;
    setBusy(true);
    let locId = '';
    if (meta.needsLocation) {
      if (isIssue) {
        const id = await ensureLocation(loc);
        if (!id) {
          setBusy(false);
          return;
        }
        locId = id;
      } else locId = loc;
    }
    const ok = await move(itemId, { type, qty: n, location: locId, givenBy, receivedBy, returnedBy, ref, note });
    setBusy(false);
    if (ok) onClose();
  };
  const text = (id: string, label: string, v: string, set: (s: string) => void, ph = '') => (
    <div>
      <label className={labelCls(D)} htmlFor={id}>
        {label}
      </label>
      <input id={id} value={v} onChange={e => set(e.target.value)} placeholder={ph} className={inputCls(D)} />
    </div>
  );

  return (
    <Modal title="Stock movement" dark={D} onClose={onClose} xl>
      <form onSubmit={submit} className="space-y-5">
        <div>
          <label className={labelCls(D)} htmlFor="mv-i">
            Item
          </label>
          <Select id="mv-i" value={itemId} onChange={e => setItemId(e.target.value)} className={inputCls(D)}>
            {items.map(i => (
              <option key={i.id} value={i.id}>
                {i.name}
                {i.code ? ` · ${i.code}` : ''} — {i.inStock} {i.unit} in store
              </option>
            ))}
          </Select>
        </div>

        <div role="group" aria-label="Movement type" className="flex flex-wrap gap-x-6 gap-y-3">
          {GROUPS.map(g => (
            <div key={g.label}>
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-faint">{g.label}</div>
              <div className="flex flex-wrap gap-1.5">
                {g.types.map(k => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={type === k}
                    onClick={() => setType(k)}
                    className={cx(
                      'rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
                      type === k ? 'border-blue-400 bg-blue-600 text-white' : TONE[MOVE[k].tone],
                    )}
                  >
                    {MOVE[k].label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="-mt-2 text-xs text-mute">{meta.hint}.</p>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls(D)} htmlFor="mv-q">
              Quantity{it ? ` (${it.unit})` : ''}
            </label>
            <input
              id="mv-q"
              autoFocus
              inputMode="numeric"
              value={qty}
              onChange={e => setQty(e.target.value.replace(type === 'adjust' ? /[^\d-]/g : /\D/g, ''))}
              placeholder={type === 'adjust' ? 'e.g. -2 or 5' : '0'}
              className={inputCls(D)}
            />
          </div>
          {isIssue && (
            <div>
              <label className={labelCls(D)} htmlFor="mv-l">
                Send to location
              </label>
              <input
                id="mv-l"
                list="mv-locs"
                value={loc}
                onChange={e => setLoc(e.target.value)}
                placeholder="e.g. Gate 3, Main Stage…"
                autoComplete="off"
                className={inputCls(D)}
              />
              <datalist id="mv-locs">
                {locations.map(l => (
                  <option key={l.id} value={l.name} />
                ))}
              </datalist>
              {isNewPlace && <p className="mt-1 text-xs text-amber-300">New location, it will be added.</p>}
            </div>
          )}
          {isReturn && (
            <div>
              <label className={labelCls(D)} htmlFor="mv-l">
                Coming back from
              </label>
              <Select id="mv-l" value={loc} onChange={e => setLoc(e.target.value)} className={inputCls(D)}>
                <option value="">{held.length ? 'Select location…' : 'This item is not out anywhere'}</option>
                {held.map(h => (
                  <option key={h.location} value={h.location}>
                    {locationLabel(h.location)} (has {h.qty})
                  </option>
                ))}
              </Select>
            </div>
          )}
        </div>
        {isIssue && (
          <div className="grid grid-cols-2 gap-3">
            {text('mv-g', 'Given by', givenBy, setGivenBy, 'Store person')}
            {text('mv-r', 'Received by *', receivedBy, setReceivedBy, 'Who took it at the location')}
          </div>
        )}
        {isReturn && (
          <div className="grid grid-cols-2 gap-3">
            {text('mv-t', 'Returned by *', returnedBy, setReturnedBy, 'Who brought it back')}
            {text('mv-r', 'Received by (store)', receivedBy, setReceivedBy)}
          </div>
        )}
        {isReceive && (
          <div className="grid grid-cols-2 gap-3">
            {text('mv-g', 'Received from (vendor / person)', givenBy, setGivenBy)}
            {text('mv-r', 'Received by', receivedBy, setReceivedBy)}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          {text('mv-f', 'Challan / PO / ticket no.', ref, setRef)}
          {text('mv-n', 'Note (optional)', note, setNote)}
        </div>

        {it && n !== 0 && (
          <div className="grid grid-cols-3 gap-2 rounded-xl border border-line bg-canvas/60 p-3 text-center text-xs">
            {(
              [
                ['In store', it.inStock, delta.s],
                ['Issued', it.issued, delta.i],
                ['Damaged', it.damaged, delta.d],
              ] as const
            ).map(([l, cur, d]) => (
              <div key={l}>
                <div className="text-faint">{l}</div>
                <div className="mt-0.5 inline-flex items-center gap-1.5 text-sm font-bold tabular-nums">
                  {cur}
                  {d !== 0 && (
                    <>
                      <ArrowRight className="h-3 w-3 text-faint" />
                      <span className={d > 0 ? 'text-emerald-400' : 'text-amber-400'}>{cur + d}</span>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {problem && (
          <p role="alert" className="text-xs text-rose-400">
            {problem}
          </p>
        )}
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <button type="button" onClick={onClose} className={ghost}>
            Cancel
          </button>
          <button type="submit" disabled={!can || busy} className={primary}>
            {busy ? 'Saving…' : `Record ${meta.label.toLowerCase()}`}
          </button>
        </div>
      </form>
    </Modal>
  );
};
