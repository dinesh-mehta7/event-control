import React, { useMemo, useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { useInventory } from '../../modules/inventory';
import { usePurchase } from '../../modules/purchase';
import { useRequests } from '../../modules/requests';
import { useManpower } from '../../modules/manpower';
import { useAccommodation } from '../../modules/accommodation';
import { STATUS as PO_STATUS, PAYABLE, poDue, poTotal } from '../../modules/purchase/types';
import { STATUS_LABEL } from '../../modules/requests/types';
import { inr } from '../../pages/orgData';
import { Card, Empty, Stat, Tabs, btnGhost, btnPrimary, printLight, th } from '../ui';

const csvCell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const download = (name: string, rows: (string | number)[][]) => {
  const url = URL.createObjectURL(new Blob([rows.map(r => r.map(csvCell).join(',')).join('\n')], { type: 'text/csv' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
};

// Reports from the live data only (inventory, purchase, requests, manpower, accommodation). Each tab exports what it shows.
export const ReportsView: React.FC = () => {
  const inv = useInventory(); const pur = usePurchase(); const req = useRequests(); const mp = useManpower(); const acc = useAccommodation();
  const [tab, setTab] = useState('requests');

  const reqByStatus = useMemo(() => {
    const m: Record<string, number> = {}; req.requests.forEach(r => { m[r.status] = (m[r.status] || 0) + 1; }); return m;
  }, [req.requests]);
  const live = pur.orders.filter(o => PAYABLE.includes(o.status));
  const committed = live.reduce((t, o) => t + poTotal(o), 0); const paid = live.reduce((t, o) => t + o.paid, 0); const due = live.reduce((t, o) => t + poDue(o), 0);
  const low = inv.items.filter(i => i.minLevel > 0 && i.inStock <= i.minLevel);
  const beds = acc.rooms.reduce((t, r) => t + r.capacity, 0); const placed = acc.members.filter(m => m.roomId).length;

  const exportCsv = () => {
    if (tab === 'requests') download('requests.csv', [['Number', 'Title', 'Requested by', 'Status', 'Items', 'Raised'], ...req.requests.map(r => [r.number, r.title, r.requesterName, STATUS_LABEL[r.status], r.items.length, r.createdAt.slice(0, 10)])]);
    else if (tab === 'purchase') download('purchase-orders.csv', [['PO', 'Title', 'Vendor', 'Status', 'Total', 'Paid', 'Due'], ...pur.orders.map(o => [o.number, o.title, pur.vendorName(o.vendorId), PO_STATUS[o.status].label, poTotal(o), o.paid, poDue(o)])]);
    else if (tab === 'inventory') download('inventory.csv', [['Item', 'Code', 'Category', 'In stock', 'Issued', 'Damaged', 'Minimum'], ...inv.items.map(i => [i.name, i.code, i.category, i.inStock, i.issued, i.damaged, i.minLevel])]);
    else download('people.csv', [['Metric', 'Value'], ['Sewadars', mp.stats.total], ['Arrived', mp.stats.arrived], ['To call', mp.stats.toCall], ['Badge pending', mp.stats.badgePending], ['Beds', beds], ['Beds filled', placed]]);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-mute max-w-2xl">Live figures from Requests, Purchase, Inventory and People. Nothing on this page is sample data.</p>
        <div className="flex gap-2"><button className={btnGhost} onClick={printLight}><Printer size={14} />Print</button><button className={btnPrimary} onClick={exportCsv}><Download size={14} />Export CSV</button></div>
      </div>
      <Tabs label="Reports" value={tab} onChange={setTab} tabs={[{ id: 'requests', label: 'Requests' }, { id: 'purchase', label: 'Purchase' }, { id: 'inventory', label: 'Inventory' }, { id: 'people', label: 'People' }]} />

      {tab === 'requests' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Raised" value={req.requests.length} />
            <Stat label="With approvers" value={(reqByStatus.pending_sub || 0) + (reqByStatus.pending_owner || 0)} warn={(reqByStatus.pending_owner || 0) > 0} />
            <Stat label="Being arranged" value={reqByStatus.approved || 0} />
            <Stat label="Delivered" value={reqByStatus.fulfilled || 0} />
          </div>
          <Card title="By status">
            <ul className="divide-y divide-line">{Object.entries(STATUS_LABEL).map(([k, l]) => <li key={k} className="py-2 flex justify-between text-sm"><span className="text-ink-soft">{l}</span><span className="tabular-nums text-ink">{reqByStatus[k] || 0}</span></li>)}</ul>
          </Card>
        </div>)}

      {tab === 'purchase' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Orders" value={pur.orders.length} /><Stat label="Committed" value={inr(committed)} /><Stat label="Paid" value={inr(paid)} /><Stat label="Still due" value={inr(due)} warn={due > 0} />
          </div>
          <div className="rounded-xl border border-line bg-surface overflow-x-auto">
            <table className="w-full text-sm"><thead><tr className="bg-canvas"><th className={th}>Order</th><th className={th}>Vendor</th><th className={th}>Status</th><th className={th + ' text-right'}>Total</th><th className={th + ' text-right'}>Due</th></tr></thead>
              <tbody className="divide-y divide-line">{pur.orders.map(o => (
                <tr key={o.id}><td className="px-4 py-2 text-ink">{o.number}<div className="text-xs text-mute">{o.title}</div></td><td className="px-4 py-2 text-ink-soft">{pur.vendorName(o.vendorId) || '—'}</td>
                  <td className="px-4 py-2 text-ink-soft">{PO_STATUS[o.status].label}</td><td className="px-4 py-2 text-right tabular-nums">{inr(poTotal(o))}</td><td className="px-4 py-2 text-right tabular-nums">{inr(poDue(o))}</td></tr>))}</tbody></table>
            {!pur.orders.length && <Empty>No purchase orders yet.</Empty>}
          </div>
        </div>)}

      {tab === 'inventory' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Items" value={inv.stats.total} /><Stat label="Need restock" value={inv.stats.needRestock} warn={inv.stats.needRestock > 0} /><Stat label="With damage" value={inv.stats.withDamaged} /><Stat label="Out of stock" value={inv.stats.out} warn={inv.stats.out > 0} />
          </div>
          <Card title="Below minimum level">
            <ul className="divide-y divide-line">{low.map(i => <li key={i.id} className="py-2 flex justify-between text-sm"><span className="text-ink">{i.name}<span className="text-xs text-mute"> · {i.category}</span></span><span className="tabular-nums text-amber-300">{i.inStock} / min {i.minLevel}</span></li>)}
              {!low.length && <li><Empty>Everything is above its minimum level.</Empty></li>}</ul>
          </Card>
        </div>)}

      {tab === 'people' && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat label="Sewadars" value={mp.stats.total} /><Stat label="Arrived" value={mp.stats.arrived} /><Stat label="Still to call" value={mp.stats.toCall} warn={mp.stats.toCall > 0} /><Stat label="Badge pending" value={mp.stats.badgePending} warn={mp.stats.badgePending > 0} />
          <Stat label="Beds" value={beds} /><Stat label="Beds filled" value={placed} /><Stat label="Members without a room" value={acc.members.length - placed} warn={acc.members.length - placed > 0} />
        </div>)}
    </div>
  );
};
