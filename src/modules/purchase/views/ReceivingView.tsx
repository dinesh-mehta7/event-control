import React, { useState } from 'react';
import { Modal, btnGhost, cx, inputCls, labelCls } from '../../accommodation/ui';
import { usePurchase } from '../PurchaseContext';
import { useInventory } from '../../inventory';
import type { Receipt } from '../types';
import { D, Empty, ReceiptList, Section, StatusChip, good, useLedger } from './shared';
import { Select } from '../../../components/Select';

export const ReceivingView: React.FC = () => {
  const { orders, vendorName } = usePurchase();
  const received = orders
    .filter(o => o.items.some(item => item.qtyReceived > 0))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const rows = useLedger<Receipt>('receipts', 300);
  return (
    <div className="space-y-5">
      <Section title={`Received orders (${received.length})`}>
        {received.length === 0 ? (
          <Empty>No orders have been received yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-xs">
              <thead className="bg-raised/40 text-left text-[10.5px] uppercase tracking-wide text-mute">
                <tr>
                  {['Purchase order', 'Request', 'Vendor', 'Items received', 'Quantity received', 'Status'].map(
                    (heading, index) => (
                      <th key={index} className="px-3 py-2.5 font-semibold">
                        {heading}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-line/70">
                {received.map(order => {
                  const items = order.items.filter(item => item.qtyReceived > 0);
                  const requestNos = Array.from(new Set(items.map(item => item.requestNumber).filter(Boolean)));
                  const receivedQty = items.reduce((sum, item) => sum + item.qtyReceived, 0);
                  return (
                    <tr key={order.id} className="hover:bg-raised/30">
                      <td className="px-3 py-2.5 whitespace-nowrap font-mono font-bold text-blue-300">
                        {order.number}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{requestNos.join(', ') || '—'}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{vendorName(order.vendorId)}</td>
                      <td className="px-3 py-2.5">
                        {items.map(item => `${item.name} × ${item.qtyReceived} ${item.unit}`).join(', ')}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap font-semibold tabular-nums text-emerald-300">
                        {receivedQty}
                      </td>
                      <td className="px-3 py-2.5">
                        <StatusChip s={order.status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
      <Section title="Goods received log">
        <ReceiptList rows={rows} empty="Nothing has been received yet." />
      </Section>
    </div>
  );
};

export const ReceiveModal: React.FC<{ id: string; onClose: () => void }> = ({ id, onClose }) => {
  const { orders, receive, userName } = usePurchase();
  const inventory = useInventory();
  const o = orders.find(x => x.id === id);
  const open = (o?.items || []).filter(i => i.qtyOrdered > i.qtyReceived);
  const [qty, setQty] = useState<Record<string, string>>(() =>
    Object.fromEntries(open.map(i => [i.id, String(i.qtyOrdered - i.qtyReceived)])),
  );
  const [givenBy, setGivenBy] = useState('');
  const [receivedBy, setReceivedBy] = useState(userName);
  const [location, setLocation] = useState('');
  const [challan, setChallan] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  if (!o) return null;
  const lines = open.map(i => ({
    itemId: i.id,
    qty: parseInt(qty[i.id] || '0', 10) || 0,
    left: i.qtyOrdered - i.qtyReceived,
    linked: !!i.inventoryItemId,
  }));
  const bad = lines.find(l => l.qty > l.left);
  const any = lines.some(l => l.qty > 0);
  const can = any && !bad && receivedBy.trim() !== '';
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!can) return;
    setBusy(true);
    const ok = await receive(
      o.id,
      lines.map(l => ({ itemId: l.itemId, qty: l.qty })),
      { location, givenBy, receivedBy, challan, note },
    );
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <Modal title={`Receive goods · ${o.number}`} dark={D} onClose={onClose} xl>
      <form onSubmit={submit} className="space-y-4">
        {open.length === 0 ? (
          <p className="text-sm text-mute">Everything on this order has been received.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-sm min-w-[28rem]">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-faint border-b border-line">
                  <th className="pl-3 py-2.5 font-semibold">Item</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Ordered</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Already in</th>
                  <th className="px-3 py-2.5 pr-3 font-semibold text-right w-28">Receive now</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/70">
                {open.map(i => (
                  <tr key={i.id}>
                    <td className="pl-3 py-2.5">
                      <div className="font-medium">{i.name}</div>
                      <div className="text-xs text-emerald-400">
                        {i.inventoryItemId ? 'adds to inventory stock' : 'adds to inventory catalogue on receipt'}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {i.qtyOrdered} <span className="text-xs text-faint">{i.unit}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-mute">{i.qtyReceived}</td>
                    <td className="px-3 py-2 pr-3">
                      <input
                        aria-label={`Receive now: ${i.name}`}
                        inputMode="numeric"
                        value={qty[i.id] ?? ''}
                        onChange={e => setQty(p => ({ ...p, [i.id]: e.target.value.replace(/\D/g, '') }))}
                        className={cx(inputCls(D), 'text-right !py-1.5')}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {bad && (
          <p role="alert" className="text-xs text-rose-400">
            More than is left to receive on one of the lines.
          </p>
        )}
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className={labelCls(D)} htmlFor="rc-l">
              Store location
            </label>
            <Select id="rc-l" value={location} onChange={e => setLocation(e.target.value)} className={inputCls(D)}>
              <option value="">Main Store (default)</option>
              {inventory.locations.map(place => (
                <option key={place.id} value={place.id}>
                  {place.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className={labelCls(D)} htmlFor="rc-g">
              Delivered by (vendor / driver)
            </label>
            <input id="rc-g" value={givenBy} onChange={e => setGivenBy(e.target.value)} className={inputCls(D)} />
          </div>
          <div>
            <label className={labelCls(D)} htmlFor="rc-r">
              Received by *
            </label>
            <input id="rc-r" value={receivedBy} onChange={e => setReceivedBy(e.target.value)} className={inputCls(D)} />
          </div>
          <div>
            <label className={labelCls(D)} htmlFor="rc-c">
              Challan / bill no.
            </label>
            <input id="rc-c" value={challan} onChange={e => setChallan(e.target.value)} className={inputCls(D)} />
          </div>
          <div>
            <label className={labelCls(D)} htmlFor="rc-n">
              Note (optional)
            </label>
            <input id="rc-n" value={note} onChange={e => setNote(e.target.value)} className={inputCls(D)} />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnGhost(D)}>
            Cancel
          </button>
          <button type="submit" disabled={!can || busy} className={good}>
            {busy ? 'Saving…' : 'Record received'}
          </button>
        </div>
      </form>
    </Modal>
  );
};
