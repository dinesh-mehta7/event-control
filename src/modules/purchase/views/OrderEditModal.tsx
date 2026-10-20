import React, { useEffect, useState } from 'react';
import { Modal, btnGhost, cx, inputCls, labelCls } from '../../accommodation/ui';
import { useRequests } from '../../requests/RequestsContext';
import { usePurchase } from '../PurchaseContext';
import type { VendorMode } from '../types';
import { D, money, primary } from './shared';

// ---- vendor + rates (the lines themselves come from the tickets) ------------------------------------------
export const OrderEditModal: React.FC<{ id: string; onClose: () => void }> = ({ id, onClose }) => {
  const { orders, vendors, saveDraft } = usePurchase();
  const { requests } = useRequests();
  const o = orders.find(x => x.id === id);
  const [vendorId, setVendorId] = useState(o?.vendorId || '');
  const [expected, setExpected] = useState(o?.expectedDate || '');
  const [notes, setNotes] = useState(o?.notes || '');
  const [vendorMode, setVendorMode] = useState<VendorMode>(
    vendors.find(v => v.id === o?.vendorId)?.vendorMode || o?.vendorMode || 'online',
  );
  const [rates, setRates] = useState<Record<string, string>>(() =>
    Object.fromEntries((o?.items || []).map(i => [i.id, i.rate ? String(i.rate) : ''])),
  );
  const requestNumbers = Array.from(new Set((o?.items || []).map(item => item.requestNumber).filter(Boolean)));
  const autoMisc = requests
    .filter(
      request =>
        requestNumbers.includes(request.number) &&
        !orders.some(
          other =>
            other.id !== o?.id &&
            other.miscAmount > 0 &&
            other.items.some(item => item.requestNumber === request.number),
        ),
    )
    .reduce((sum, request) => sum + (request.miscBudget || 0), 0);
  const [miscAmount, setMiscAmount] = useState(o?.miscAmount || 0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!o?.miscAmount && autoMisc > 0) setMiscAmount(autoMisc);
  }, [o?.id, o?.miscAmount, autoMisc]);
  if (!o) return null;
  const num = (id2: string) => parseFloat(rates[id2]) || 0;
  const total = o.items.reduce((a, i) => a + i.qtyOrdered * num(i.id), 0) + miscAmount;
  const save = async (submit: boolean) => {
    setBusy(true);
    const ok = await saveDraft(
      o.id,
      {
        vendorId,
        vendorMode,
        expectedDate: expected,
        notes,
        miscAmount,
        rates: Object.fromEntries(o.items.map(i => [i.id, num(i.id)])),
      },
      submit,
    );
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <Modal title={`${o.number} · vendor and rates`} dark={D} onClose={onClose} xl>
      <div className="space-y-4">
        {o.status === 'rejected' && o.decisionNote && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            Order needs changes: {o.decisionNote}
          </div>
        )}
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          <div>
            <label className={labelCls(D)} htmlFor="oe-mode">
              Vendor type
            </label>
            <select
              id="oe-mode"
              value={vendorMode}
              onChange={e => {
                const mode = e.target.value as VendorMode;
                setVendorMode(mode);
                if (vendors.find(v => v.id === vendorId)?.vendorMode !== mode) setVendorId('');
              }}
              className={inputCls(D)}
            >
              <option value="online">Online marketplace</option>
              <option value="offline">Offline / local vendor</option>
            </select>
          </div>
          <div>
            <label className={labelCls(D)} htmlFor="oe-v">
              Choose vendor
            </label>
            <select id="oe-v" value={vendorId} onChange={e => setVendorId(e.target.value)} className={inputCls(D)}>
              <option value="">Choose {vendorMode === 'online' ? 'an online marketplace' : 'a local'} vendor…</option>
              {vendors
                .filter(v => v.vendorMode === vendorMode)
                .map(v => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label className={labelCls(D)} htmlFor="oe-d">
              Expected delivery
            </label>
            <input
              id="oe-d"
              type="date"
              value={expected}
              onChange={e => setExpected(e.target.value)}
              className={inputCls(D)}
            />
          </div>
          <div>
            <label className={labelCls(D)} htmlFor="oe-n">
              Note
            </label>
            <input id="oe-n" value={notes} onChange={e => setNotes(e.target.value)} className={inputCls(D)} />
          </div>
        </div>
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-sm min-w-[32rem]">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-faint border-b border-line">
                <th className="pl-3 py-2.5 font-semibold">Item</th>
                <th className="px-3 py-2.5 font-semibold text-right">Qty</th>
                <th className="px-3 py-2.5 font-semibold text-right w-32">Rate (₹)</th>
                <th className="px-3 py-2.5 pr-3 font-semibold text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70">
              {o.items.map(i => (
                <tr key={i.id}>
                  <td className="pl-3 py-2">
                    <div className="font-medium">{i.name}</div>
                    {i.requestNumber && <div className="text-xs text-mute">for {i.requestNumber}</div>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {i.qtyOrdered} <span className="text-xs text-faint">{i.unit}</span>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      aria-label={`Rate for ${i.name}`}
                      inputMode="decimal"
                      value={rates[i.id] ?? ''}
                      onChange={e => setRates(r => ({ ...r, [i.id]: e.target.value.replace(/[^\d.]/g, '') }))}
                      className={cx(inputCls(D), 'text-right tabular-nums')}
                    />
                  </td>
                  <td className="px-3 py-2 pr-3 text-right tabular-nums font-semibold">
                    {money(i.qtyOrdered * num(i.id))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {autoMisc > 0 && (
          <div className="rounded-lg border border-blue-500/25 bg-blue-500/5 px-3 py-2 text-xs text-ink-soft">
            Request miscellaneous / installation allowance is included automatically:{' '}
            <b className="tabular-nums">{money(miscAmount)}</b>. It is included in the PO total without creating a
            separate item line.
          </div>
        )}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span className="text-sm text-mute">
            Total <b className="text-ink tabular-nums">{money(total)}</b>
          </span>
          <div className="flex gap-2">
            <button className={btnGhost(D)} onClick={onClose}>
              Cancel
            </button>
            <button
              className={primary}
              disabled={busy || !vendorId || o.items.some(item => !(num(item.id) > 0))}
              onClick={() => save(false)}
            >
              {busy ? 'Saving…' : 'Save details'}
            </button>
          </div>
        </div>
        <p className="text-xs text-mute">
          {vendorMode === 'online'
            ? 'Place the order on the e-commerce marketplace (such as Amazon or Flipkart), then record it here. Add the marketplace order number and courier details for tracking.'
            : vendorMode === 'offline'
              ? 'Place the order directly with the local supplier, then mark it here. Marketplace tracking is not used.'
              : 'Choose a vendor category to continue: online marketplace (e-commerce brand) or offline/local supplier.'}{' '}
          Order lines come from approved requests.
        </p>
      </div>
    </Modal>
  );
};
