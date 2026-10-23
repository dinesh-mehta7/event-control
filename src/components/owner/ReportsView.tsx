import React, { useEffect, useMemo, useState } from 'react';
import { Download, Printer } from 'lucide-react';
import * as XLSX from 'xlsx';
import { useInventory } from '../../modules/inventory';
import { MOVE } from '../../modules/inventory/types';
import { usePurchase } from '../../modules/purchase';
import { useRequests } from '../../modules/requests';
import { useManpower } from '../../modules/manpower';
import { useAccommodation } from '../../modules/accommodation';
import { useWalkie } from '../../modules/walkie';
import { supabase } from '../../modules/walkie/lib/supabaseClient';
import { useEventScope } from '../../context/EventScopeContext';
import { useMeetings } from '../../context/MeetingsContext';
import { STATUS as PO_STATUS, PAYABLE, poDue, poTotal } from '../../modules/purchase/types';
import { STATUS_LABEL } from '../../modules/requests/types';
import { inr } from '../../views/orgData';
import { Card, Empty, Stat, Tabs, btnGhost, btnPrimary, printLight, th } from '../ui';
import { Swap } from '../Swap';
import {
  ExtraReports,
  REPORT_TABS,
  WifiUsageRow,
  download,
  extraReportTables,
  fetchOrgReportRows,
  wifiStatus,
  wifiUsageError,
} from './reports/reportData';
import { ReportTable } from './reports/ReportTable';
import { Select } from '../Select';

// Reports from the live data only (inventory, purchase, requests, manpower, accommodation). Each tab exports what it shows.
export const ReportsView: React.FC = () => {
  const inv = useInventory();
  const pur = usePurchase();
  const req = useRequests();
  const mp = useManpower();
  const acc = useAccommodation();
  const auth: any = useWalkie();
  const eventScope = useEventScope();
  const meetings = useMeetings();
  const organizationId = auth.currentUser?.organizationId;
  const [tab, setTab] = useState('requests');
  const [extraReports, setExtraReports] = useState<ExtraReports>({});
  const [extraLoading, setExtraLoading] = useState(false);
  const [extraErrors, setExtraErrors] = useState<string[]>([]);
  const [wifiRows, setWifiRows] = useState<WifiUsageRow[]>([]);
  const [wifiLoading, setWifiLoading] = useState(false);
  const [wifiError, setWifiError] = useState('');
  const [wifiReportEventId, setWifiReportEventId] = useState('all');

  useEffect(() => {
    if (!organizationId) {
      setExtraReports({});
      return;
    }
    let active = true;
    setExtraLoading(true);
    void Promise.all(
      extraReportTables.map(async ([key, table]) => {
        const result = await fetchOrgReportRows(table, organizationId);
        return { key, rows: result.rows, error: result.error };
      }),
    ).then(results => {
      if (!active) return;
      setExtraReports(Object.fromEntries(results.map(result => [result.key, result.rows])));
      setExtraErrors(results.filter(result => result.error).map(result => result.error));
      setExtraLoading(false);
    });
    return () => {
      active = false;
    };
  }, [organizationId]);

  useEffect(() => {
    if (!organizationId) {
      setWifiRows([]);
      return;
    }
    let active = true;
    const load = async () => {
      setWifiLoading(true);
      const rows: WifiUsageRow[] = [];
      let error: any = null;
      for (let from = 0; ; from += 1000) {
        const result = await supabase
          .from('wifi_access_accounts')
          .select('id,event_id,network_name,access_point,recipient_name,department,valid_until,status,created_at')
          .eq('organization_id', organizationId)
          .order('created_at', { ascending: false })
          .range(from, from + 999);
        if (result.error) {
          error = result.error;
          break;
        }
        rows.push(...((result.data || []) as WifiUsageRow[]));
        if (!result.data || result.data.length < 1000) break;
      }
      if (!active) return;
      setWifiError(error ? wifiUsageError(error) : '');
      if (!error) setWifiRows(rows);
      setWifiLoading(false);
    };
    void load();
    const channel = supabase
      .channel(`wifi-usage-report-${organizationId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'wifi_access_accounts', filter: `organization_id=eq.${organizationId}` },
        () => {
          void load();
        },
      )
      .subscribe();
    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [organizationId]);

  const reqByStatus = useMemo(() => {
    const m: Record<string, number> = {};
    req.requests.forEach(r => {
      m[r.status] = (m[r.status] || 0) + 1;
    });
    return m;
  }, [req.requests]);
  const live = pur.orders.filter(o => PAYABLE.includes(o.status));
  const committed = live.reduce((t, o) => t + poTotal(o), 0);
  const paid = live.reduce((t, o) => t + o.paid, 0);
  const due = live.reduce((t, o) => t + poDue(o), 0);
  const low = inv.items.filter(i => i.minLevel > 0 && i.inStock <= i.minLevel);
  // Stock movements as people read them: item and location names (not ids), the movement's label, and a clear local date & time.
  const movementRows = useMemo(() => {
    const itemName = new Map(inv.items.map(i => [i.id, i.name]));
    const when = (value?: string) => {
      const d = value ? new Date(value) : null;
      return d && !Number.isNaN(d.getTime())
        ? d.toLocaleString('en-IN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
          })
        : '—';
    };
    return (extraReports.inventoryMovements || [])
      .slice()
      .sort((a: any, b: any) => String(b.done_at || '').localeCompare(String(a.done_at || '')))
      .map((m: any) => ({
        ...m,
        item_name: m.item_name || itemName.get(m.item_id) || (m.item_id ? 'Deleted item' : ''),
        type: (MOVE as Record<string, { label: string }>)[m.type]?.label || m.type,
        location: m.location ? inv.locationLabel(m.location) : '',
        done_at: when(m.done_at),
      }));
  }, [extraReports.inventoryMovements, inv.items, inv.locationLabel]);
  const beds = acc.rooms.reduce((t, r) => t + r.capacity, 0);
  const placed = acc.members.filter(m => m.roomId).length;

  const exportCsv = () => {
    if (tab === 'requests')
      download('requests.csv', [
        ['Number', 'Title', 'Requested by', 'Status', 'Items', 'Raised'],
        ...req.requests.map(r => [
          r.number,
          r.title,
          r.requesterName,
          STATUS_LABEL[r.status],
          r.items.length,
          r.createdAt.slice(0, 10),
        ]),
      ]);
    else if (tab === 'purchase')
      download('purchase-orders.csv', [
        [
          'Record type',
          'PO',
          'Title / note',
          'Vendor / paid by',
          'Status / item',
          'Total / quantity',
          'Paid / received by',
          'Due / date',
        ],
        ...pur.orders.map(o => [
          'Order',
          o.number,
          o.title,
          pur.vendorName(o.vendorId),
          PO_STATUS[o.status].label,
          poTotal(o),
          o.paid,
          poDue(o),
        ]),
        ...(extraReports.purchaseReceipts || []).map(r => [
          'Receipt',
          r.po_id,
          r.note,
          r.given_by,
          r.item_id,
          r.qty,
          r.received_by,
          r.done_at,
        ]),
        ...(extraReports.purchasePayments || []).map(p => [
          'Payment',
          p.po_id,
          p.note,
          p.done_by,
          p.status,
          p.amount,
          p.done_by,
          p.done_at,
        ]),
      ]);
    else if (tab === 'inventory')
      download('inventory.csv', [
        [
          'Record type',
          'Item',
          'Code / movement',
          'Category / location',
          'In stock / quantity',
          'Issued by',
          'Received by',
          'Date',
        ],
        ...inv.items.map(i => ['Stock', i.name, i.code, i.category, i.inStock, '', '', '']),
        ...movementRows.map(m => [
          'Movement',
          m.item_name,
          m.type,
          m.location,
          m.qty,
          m.given_by,
          m.received_by,
          m.done_at,
        ]),
      ]);
    else if (tab === 'wifi') {
      const rows = wifiRows.filter(
        row =>
          wifiReportEventId === 'all' ||
          (wifiReportEventId === 'none' ? !row.event_id : row.event_id === wifiReportEventId),
      );
      download('wifi-event-usage.csv', [
        ['Event', 'Network', 'Access point / location', 'Recipient', 'Department', 'Issued', 'Valid through', 'Status'],
        ...rows.map(row => [
          eventScope.events.find(event => event.id === row.event_id)?.name ||
            (row.event_id ? 'Archived event' : 'General / no event'),
          row.network_name,
          row.access_point,
          row.recipient_name,
          row.department,
          row.created_at.slice(0, 10),
          row.valid_until || 'No expiry',
          wifiStatus(row),
        ]),
      ]);
    } else if (tab === 'people')
      download('people.csv', [
        ['Metric', 'Value'],
        ['Sewadars', mp.stats.total],
        ['Arrived', mp.stats.arrived],
        ['To call', mp.stats.toCall],
        ['Badge pending', mp.stats.badgePending],
        ['Beds', beds],
        ['Beds filled', placed],
      ]);
    else if (tab === 'accommodation')
      download('accommodation.csv', [
        ['Record type', 'Name', 'Department / Block', 'Room / time', 'Capacity / status', 'Items'],
        ...acc.rooms.map(r => ['Room', r.name, r.block, '', r.capacity, r.notes]),
        ...acc.members.map(m => [
          'Member',
          m.name,
          m.department,
          acc.rooms.find(r => r.id === m.roomId)?.name || 'Unassigned',
          m.arrivalStatus,
          m.remarks,
        ]),
        ...acc.meals.map(m => ['Meal', m.label, m.date, `${m.start}-${m.end}`, m.status, m.items]),
      ]);
    else if (tab === 'events')
      download('event-reports.csv', [
        ['Event', 'Starts at', 'Location', 'Status', 'Requirements', 'Tasks', 'Attendance', 'Review'],
        ...(extraReports.events || []).map(e => [
          e.name,
          e.starts_at,
          e.location,
          e.status,
          (extraReports.requirements || []).filter(r => r.event_id === e.id).length,
          (extraReports.eventTasks || []).filter(t => t.event_id === e.id).length,
          (extraReports.attendance || []).filter(a => a.event_id === e.id).length,
          (extraReports.eventReviews || []).some(r => r.event_id === e.id) ? 'Available' : 'Not submitted',
        ]),
      ]);
    else if (tab === 'tasks')
      download('task-reports.csv', [
        ['Source', 'Title', 'Assigned to', 'Department', 'Priority', 'Due date', 'Status'],
        ...(extraReports.eventTasks || []).map(t => [
          'Event task',
          t.title,
          t.assigned_to,
          t.department_name || t.department_id,
          t.priority_level,
          t.due_date,
          t.status,
        ]),
        ...(extraReports.memberTasks || []).map(t => [
          'Volunteer task',
          t.title,
          t.assigned_to || t.member_name,
          t.department,
          t.priority,
          t.due_date,
          t.status,
        ]),
      ]);
    else if (tab === 'issues')
      download('issues-feedback-lessons.csv', [
        ['Type', 'Event', 'Department', 'Title', 'Details', 'Reporter / author', 'Status', 'Created'],
        ...(extraReports.issues || []).map(i => [
          i.kind,
          eventScope.events.find(e => e.id === i.event_id)?.name || 'Unlinked',
          i.sub_department,
          i.title,
          i.details,
          i.reporter_name,
          i.status,
          i.created_at,
        ]),
        ...(extraReports.updates || []).map(u => [
          u.kind,
          '',
          u.department,
          u.title,
          u.body,
          u.author_name,
          '',
          u.created_at,
        ]),
        ...(extraReports.eventReviews || []).map(r => [
          'Event review',
          eventScope.events.find(e => e.id === r.event_id)?.name || 'Archived event',
          '',
          'Lessons / issues / recommendations',
          [r.lessons_learned, r.issues_faced, r.recommendations, r.closure_report].filter(Boolean).join(' | '),
          '',
          '',
          r.updated_at,
        ]),
      ]);
    else if (tab === 'meetings')
      download('meetings-and-minutes.csv', [
        ['Title', 'Kind', 'Starts at', 'Status', 'Event', 'Agenda', 'Minutes'],
        ...[...meetings.meetings, ...meetings.emergencies].map(m => [
          m.title,
          m.kind,
          m.startsAt,
          m.status,
          eventScope.events.find(e => e.id === m.eventId)?.name || '',
          m.agenda,
          m.minutes,
        ]),
      ]);
    else
      download('radio-return-reports.csv', [
        [
          'Event',
          'Department',
          'Walkies returned',
          'Chargers returned',
          'Earphones returned',
          'Feedback',
          'Status',
          'Updated',
        ],
        ...(extraReports.radioReturns || []).map(r => [
          eventScope.events.find(e => e.id === r.event_id)?.name || 'General / no event',
          r.department_name,
          r.returned_walkies,
          r.returned_chargers,
          r.returned_earphones,
          r.return_feedback,
          r.status,
          r.updated_at,
        ]),
      ]);
  };

  const exportAllReports = () => {
    const workbook = XLSX.utils.book_new();
    const addSheet = (name: string, rows: any[]) =>
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.json_to_sheet(rows.length ? rows : [{ Note: 'No records available' }]),
        name.slice(0, 31),
      );
    addSheet(
      'Requests',
      req.requests.map(r => ({
        Number: r.number,
        Title: r.title,
        RequestedBy: r.requesterName,
        Status: STATUS_LABEL[r.status],
        Items: r.items.length,
        Raised: r.createdAt,
      })),
    );
    addSheet(
      'Purchase Orders',
      pur.orders.map(o => ({
        PO: o.number,
        Title: o.title,
        Vendor: pur.vendorName(o.vendorId),
        Status: PO_STATUS[o.status].label,
        Total: poTotal(o),
        Paid: o.paid,
        Due: poDue(o),
      })),
    );
    addSheet('Purchase Receipts', extraReports.purchaseReceipts || []);
    addSheet('Purchase Payments', extraReports.purchasePayments || []);
    addSheet(
      'Request Items',
      req.requests.flatMap(r => r.items.map(item => ({ Request: r.number, Title: r.title, ...item }))),
    );
    addSheet(
      'Inventory',
      inv.items.map(i => ({
        Name: i.name,
        Code: i.code,
        Category: i.category,
        InStock: i.inStock,
        Issued: i.issued,
        Damaged: i.damaged,
        Minimum: i.minLevel,
      })),
    );
    addSheet(
      'Inventory Movements',
      movementRows.map(m => ({
        Item: m.item_name,
        Movement: m.type,
        Quantity: m.qty,
        Location: m.location,
        'Given by': m.given_by,
        'Received by': m.received_by,
        'Date & time': m.done_at,
        Note: m.note || '',
      })),
    );
    addSheet('Request Activity', extraReports.requestEvents || []);
    addSheet('Request Fulfilments', extraReports.requestFulfilments || []);
    addSheet(
      'Wi-Fi Access',
      wifiRows.map(r => ({
        Event: eventScope.events.find(e => e.id === r.event_id)?.name || 'General / no event',
        Network: r.network_name,
        Location: r.access_point,
        Recipient: r.recipient_name,
        Department: r.department,
        Status: wifiStatus(r),
        Issued: r.created_at,
        ValidUntil: r.valid_until,
      })),
    );
    addSheet(
      'Sewadars',
      mp.sewadars.map(s => ({
        Name: s.name,
        Phone: s.phone,
        Department: s.department,
        Type: s.memberType,
        Arrival: s.arrival,
        ExpectedArrival: s.expectedArrival,
        Team: s.teamName,
        CallCount: s.callCount,
      })),
    );
    addSheet(
      'Accommodation Rooms',
      acc.rooms.map(r => ({
        Name: r.name,
        Category: r.category,
        Block: r.block,
        Capacity: r.capacity,
        AssignedMembers: acc.members.filter(m => m.roomId === r.id).length,
        Notes: r.notes,
      })),
    );
    addSheet(
      'Accommodation Members',
      acc.members.map(m => ({
        Name: m.name,
        Department: m.department,
        Room: acc.rooms.find(r => r.id === m.roomId)?.name || '',
        Phone: m.mobile,
        Arrival: m.arrivalStatus,
      })),
    );
    addSheet(
      'Meal Plans',
      acc.meals.map(m => ({
        Date: m.date,
        Meal: m.label,
        Start: m.start,
        End: m.end,
        Status: m.status,
        Items: m.items,
      })),
    );
    addSheet('Events', extraReports.events || []);
    addSheet('Event Requirements', extraReports.requirements || []);
    addSheet('Event Tasks', extraReports.eventTasks || []);
    addSheet('Event Attendance', extraReports.attendance || []);
    addSheet('Event Reviews', extraReports.eventReviews || []);
    addSheet('Volunteer Tasks', extraReports.memberTasks || []);
    addSheet('Volunteer Calls', extraReports.calls || []);
    addSheet('Issues & Feedback', extraReports.issues || []);
    addSheet('Announcements & Lessons', extraReports.updates || []);
    addSheet('Radio Returns', extraReports.radioReturns || []);
    // The meeting context supplies only rows visible to this signed-in user, preserving meeting and minutes access rules.
    addSheet(
      'Meetings visible to you',
      [...meetings.meetings, ...meetings.emergencies].map(m => ({
        Title: m.title,
        Kind: m.kind,
        StartsAt: m.startsAt,
        Status: m.status,
        Event: eventScope.events.find(e => e.id === m.eventId)?.name || '',
        Agenda: m.agenda,
        Minutes: m.minutes,
      })),
    );
    XLSX.writeFile(workbook, 'organization-reports.xlsx');
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-mute max-w-2xl">
          Central reports collected across requests, finance, inventory, IT, events, volunteers, accommodation, and
          department updates.
        </p>
        <div className="flex flex-wrap gap-2">
          <button className={btnGhost} onClick={printLight}>
            <Printer size={14} />
            Print
          </button>
          <button className={btnGhost} onClick={exportCsv}>
            <Download size={14} />
            Export this report
          </button>
          <button className={btnPrimary} onClick={exportAllReports}>
            <Download size={14} />
            Export all Excel
          </button>
        </div>
      </div>
      <Tabs
        label="Reports"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'requests', label: 'Requests' },
          { id: 'purchase', label: 'Purchase' },
          { id: 'inventory', label: 'Inventory' },
          { id: 'wifi', label: 'Wi-Fi usage' },
          { id: 'people', label: 'People' },
          { id: 'accommodation', label: 'Accommodation' },
          { id: 'events', label: 'Events' },
          { id: 'meetings', label: 'Meetings & minutes' },
          { id: 'tasks', label: 'Tasks' },
          { id: 'issues', label: 'Issues & feedback' },
          { id: 'radio', label: 'Radio returns' },
        ]}
      />
      {extraErrors.length > 0 && (
        <p role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
          Some report sources could not be loaded: {extraErrors.join(' · ')}
        </p>
      )}

      <Swap k={tab} indexOf={k => REPORT_TABS.indexOf(k)}>
        {tab === 'requests' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Stat label="Raised" value={req.requests.length} />
              <Stat
                label="With approvers"
                value={(reqByStatus.pending_sub || 0) + (reqByStatus.pending_owner || 0)}
                warn={(reqByStatus.pending_owner || 0) > 0}
              />
              <Stat label="Being arranged" value={reqByStatus.approved || 0} />
              <Stat label="Handed over" value={reqByStatus.fulfilled || 0} />
            </div>
            <Card title="By status">
              <ul className="divide-y divide-line">
                {Object.entries(STATUS_LABEL).map(([k, l]) => (
                  <li key={k} className="py-2 flex justify-between text-sm">
                    <span className="text-ink-soft">{l}</span>
                    <span className="tabular-nums text-ink">{reqByStatus[k] || 0}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        )}

        {tab === 'purchase' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Stat label="Orders" value={pur.orders.length} />
              <Stat label="Committed" value={inr(committed)} />
              <Stat label="Paid" value={inr(paid)} />
              <Stat label="Still due" value={inr(due)} warn={due > 0} />
            </div>
            <div className="rounded-xl border border-line bg-surface overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-canvas">
                    <th className={th}>Order</th>
                    <th className={th}>Vendor</th>
                    <th className={th}>Status</th>
                    <th className={th + ' text-right'}>Total</th>
                    <th className={th + ' text-right'}>Due</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {pur.orders.map(o => (
                    <tr key={o.id}>
                      <td className="px-4 py-2 text-ink">
                        {o.number}
                        <div className="text-xs text-mute">{o.title}</div>
                      </td>
                      <td className="px-4 py-2 text-ink-soft">{pur.vendorName(o.vendorId) || '—'}</td>
                      <td className="px-4 py-2 text-ink-soft">{PO_STATUS[o.status].label}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{inr(poTotal(o))}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{inr(poDue(o))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!pur.orders.length && <Empty>No purchase orders yet.</Empty>}
            </div>
            <Card title="Goods received">
              <ReportTable
                rows={extraReports.purchaseReceipts || []}
                columns={[
                  ['po_id', 'Purchase order'],
                  ['item_id', 'Item'],
                  ['qty', 'Quantity'],
                  ['location', 'Location'],
                  ['given_by', 'Given by'],
                  ['received_by', 'Received by'],
                  ['done_at', 'Date'],
                ]}
                empty={extraLoading ? 'Loading receipt reports…' : 'No goods receipt reports recorded.'}
              />
            </Card>
            <Card title="Purchase payments">
              <ReportTable
                rows={extraReports.purchasePayments || []}
                columns={[
                  ['po_id', 'Purchase order'],
                  ['amount', 'Amount'],
                  ['note', 'Note'],
                  ['done_by', 'Recorded by'],
                  ['done_at', 'Date'],
                ]}
                empty={extraLoading ? 'Loading payment reports…' : 'No purchase payment reports recorded.'}
              />
            </Card>
          </div>
        )}

        {tab === 'inventory' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Stat label="Items" value={inv.stats.total} />
              <Stat label="Need restock" value={inv.stats.needRestock} warn={inv.stats.needRestock > 0} />
              <Stat label="With damage" value={inv.stats.withDamaged} />
              <Stat label="Out of stock" value={inv.stats.out} warn={inv.stats.out > 0} />
            </div>
            <Card title="Below minimum level">
              <ul className="divide-y divide-line">
                {low.map(i => (
                  <li key={i.id} className="py-2 flex justify-between text-sm">
                    <span className="text-ink">
                      {i.name}
                      <span className="text-xs text-mute"> · {i.category}</span>
                    </span>
                    <span className="tabular-nums text-amber-300">
                      {i.inStock} / min {i.minLevel}
                    </span>
                  </li>
                ))}
                {!low.length && (
                  <li>
                    <Empty>Everything is above its minimum level.</Empty>
                  </li>
                )}
              </ul>
            </Card>
            <Card title="Recent stock movements">
              <ReportTable
                rows={movementRows}
                columns={[
                  ['item_name', 'Item'],
                  ['type', 'Movement'],
                  ['qty', 'Quantity'],
                  ['location', 'Location'],
                  ['given_by', 'Given by'],
                  ['received_by', 'Received by'],
                  ['done_at', 'Date & time'],
                ]}
                empty={extraLoading ? 'Loading inventory movements…' : 'No stock movements recorded.'}
              />
            </Card>
          </div>
        )}

        {tab === 'wifi' &&
          (() => {
            const rows = wifiRows.filter(
              row =>
                wifiReportEventId === 'all' ||
                (wifiReportEventId === 'none' ? !row.event_id : row.event_id === wifiReportEventId),
            );
            const counts = rows.reduce(
              (totals, row) => {
                const status = wifiStatus(row);
                totals[status] += 1;
                return totals;
              },
              { active: 0, expired: 0, revoked: 0 },
            );
            const departments = new Map<string, number>();
            const networks = new Map<string, number>();
            rows.forEach(row => {
              const department = row.department || 'Unassigned';
              departments.set(department, (departments.get(department) || 0) + 1);
              networks.set(
                row.network_name || 'Unnamed network',
                (networks.get(row.network_name || 'Unnamed network') || 0) + 1,
              );
            });
            return (
              <div className="space-y-4">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <p className="max-w-2xl text-sm text-mute">
                    Counts access credentials issued for an event. This is issuance usage, not live connected-device or
                    bandwidth telemetry.
                  </p>
                  <label className="text-xs text-mute">
                    Event
                    <Select
                      aria-label="Wi-Fi report event"
                      value={wifiReportEventId}
                      onChange={e => {
                        setWifiReportEventId(e.target.value);
                        if (e.target.value !== 'all' && e.target.value !== 'none')
                          eventScope.setScopeFor('wifi', e.target.value);
                      }}
                      className="mt-1 min-w-52 rounded-lg border border-line bg-field px-3 py-2 text-sm text-ink"
                    >
                      <option value="all">All events</option>
                      <option value="none">General / no event</option>
                      {eventScope.events.map(event => (
                        <option key={event.id} value={event.id}>
                          {event.name}
                        </option>
                      ))}
                    </Select>
                  </label>
                </div>
                {wifiError && (
                  <div
                    role="alert"
                    className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300"
                  >
                    Could not load Wi-Fi usage: {wifiError}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <Stat label="Access issued" value={rows.length} />
                  <Stat label="Active" value={counts.active} />
                  <Stat label="Expired" value={counts.expired} warn={counts.expired > 0} />
                  <Stat label="Revoked" value={counts.revoked} />
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <Card title="Access by Walkie department">
                    <ul className="divide-y divide-line">
                      {Array.from(departments)
                        .sort((a, b) => a[0].localeCompare(b[0]))
                        .map(([name, count]) => (
                          <li key={name} className="flex justify-between py-2 text-sm">
                            <span className="text-ink-soft">{name}</span>
                            <span className="tabular-nums text-ink">{count}</span>
                          </li>
                        ))}
                      {!departments.size && (
                        <li>
                          <Empty>No issued access in this scope.</Empty>
                        </li>
                      )}
                    </ul>
                  </Card>
                  <Card title="Access by network">
                    <ul className="divide-y divide-line">
                      {Array.from(networks)
                        .sort((a, b) => a[0].localeCompare(b[0]))
                        .map(([name, count]) => (
                          <li key={name} className="flex justify-between py-2 text-sm">
                            <span className="text-ink-soft">{name}</span>
                            <span className="tabular-nums text-ink">{count}</span>
                          </li>
                        ))}
                      {!networks.size && (
                        <li>
                          <Empty>No network usage to report.</Empty>
                        </li>
                      )}
                    </ul>
                  </Card>
                </div>
                <div className="overflow-x-auto rounded-xl border border-line bg-surface">
                  <table className="w-full min-w-[900px] text-sm">
                    <thead>
                      <tr className="bg-canvas">
                        <th className={th}>Event</th>
                        <th className={th}>Network</th>
                        <th className={th}>AP / location</th>
                        <th className={th}>Recipient</th>
                        <th className={th}>Department</th>
                        <th className={th}>Issued</th>
                        <th className={th}>Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {rows.map(row => (
                        <tr key={row.id}>
                          <td className="px-4 py-2 text-ink">
                            {eventScope.events.find(event => event.id === row.event_id)?.name ||
                              (row.event_id ? 'Archived event' : 'General / no event')}
                          </td>
                          <td className="px-4 py-2 text-ink-soft">{row.network_name}</td>
                          <td className="px-4 py-2 text-ink-soft">{row.access_point || '—'}</td>
                          <td className="px-4 py-2 text-ink-soft">{row.recipient_name}</td>
                          <td className="px-4 py-2 text-ink-soft">{row.department || 'Unassigned'}</td>
                          <td className="px-4 py-2 text-ink-soft">{row.created_at.slice(0, 10)}</td>
                          <td className="px-4 py-2 capitalize text-ink-soft">{wifiStatus(row)}</td>
                        </tr>
                      ))}
                      {!rows.length && (
                        <tr>
                          <td colSpan={7} className="p-8 text-center text-sm text-mute">
                            {wifiLoading ? 'Loading Wi-Fi usage…' : 'No Wi-Fi access issued in this scope.'}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}

        {tab === 'people' && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Sewadars" value={mp.stats.total} />
            <Stat label="Arrived" value={mp.stats.arrived} />
            <Stat label="Still to call" value={mp.stats.toCall} warn={mp.stats.toCall > 0} />
            <Stat label="Badge pending" value={mp.stats.badgePending} warn={mp.stats.badgePending > 0} />
            <Stat label="Beds" value={beds} />
            <Stat label="Beds filled" value={placed} />
            <Stat
              label="Members without a room"
              value={acc.members.length - placed}
              warn={acc.members.length - placed > 0}
            />
          </div>
        )}

        {tab === 'accommodation' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Rooms" value={acc.rooms.length} />
              <Stat label="Bed capacity" value={beds} />
              <Stat label="Members placed" value={placed} />
              <Stat label="Unassigned members" value={acc.members.length - placed} warn={acc.members.length > placed} />
            </div>
            <Card title="Room occupancy">
              <ReportTable
                rows={acc.rooms.map(r => ({ ...r, assigned: acc.members.filter(m => m.roomId === r.id).length }))}
                columns={[
                  ['name', 'Room'],
                  ['category', 'Category'],
                  ['block', 'Block'],
                  ['capacity', 'Capacity'],
                  ['assigned', 'Assigned'],
                  ['responsibleTeam', 'Responsible team'],
                ]}
                empty="No accommodation rooms recorded."
              />
            </Card>
            <Card title="Accommodation members">
              <ReportTable
                rows={acc.members.map(m => ({
                  ...m,
                  room: acc.rooms.find(r => r.id === m.roomId)?.name || 'Unassigned',
                }))}
                columns={[
                  ['name', 'Member'],
                  ['department', 'Department'],
                  ['room', 'Room'],
                  ['mobile', 'Mobile'],
                  ['arrivalStatus', 'Arrival'],
                ]}
                empty="No accommodation members recorded."
              />
            </Card>
            <Card title="Meal plans">
              <ReportTable
                rows={acc.meals}
                columns={[
                  ['date', 'Date'],
                  ['label', 'Meal'],
                  ['start', 'Start'],
                  ['end', 'End'],
                  ['status', 'Status'],
                  ['items', 'Menu'],
                ]}
                empty="No meal plans recorded."
              />
            </Card>
          </div>
        )}

        {tab === 'events' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Events" value={(extraReports.events || []).length} />
              <Stat label="Requirements" value={(extraReports.requirements || []).length} />
              <Stat label="Event tasks" value={(extraReports.eventTasks || []).length} />
              <Stat label="Reviews submitted" value={(extraReports.eventReviews || []).length} />
            </div>
            <Card title="Event register">
              <ReportTable
                rows={(extraReports.events || []).map(e => ({
                  ...e,
                  requirement_count: (extraReports.requirements || []).filter(r => r.event_id === e.id).length,
                  task_count: (extraReports.eventTasks || []).filter(t => t.event_id === e.id).length,
                  attendance_count: (extraReports.attendance || []).filter(a => a.event_id === e.id).length,
                  review: (extraReports.eventReviews || []).some(r => r.event_id === e.id) ? 'Submitted' : 'Pending',
                }))}
                columns={[
                  ['name', 'Event'],
                  ['starts_at', 'Starts'],
                  ['location', 'Location'],
                  ['status', 'Status'],
                  ['requirement_count', 'Requirements'],
                  ['task_count', 'Tasks'],
                  ['attendance_count', 'Attendance'],
                  ['review', 'Review'],
                ]}
                empty={extraLoading ? 'Loading event reports…' : 'No events recorded.'}
              />
            </Card>
            <Card title="Event reviews and lessons">
              <ReportTable
                rows={(extraReports.eventReviews || []).map(r => ({
                  ...r,
                  event_name: eventScope.events.find(e => e.id === r.event_id)?.name || 'Archived event',
                }))}
                columns={[
                  ['event_name', 'Event'],
                  ['lessons_learned', 'Lessons learned'],
                  ['issues_faced', 'Issues faced'],
                  ['recommendations', 'Recommendations'],
                  ['closure_report', 'Closure report'],
                ]}
                empty="No event reviews submitted yet."
              />
            </Card>
          </div>
        )}

        {tab === 'meetings' && (
          <div className="space-y-4">
            <p className="text-xs text-mute">
              Only meetings and minutes visible to your signed-in account are included.
            </p>
            <Stat label="Visible meetings" value={meetings.meetings.length + meetings.emergencies.length} />
            <ReportTable
              rows={[...meetings.meetings, ...meetings.emergencies].map(m => ({
                ...m,
                event: eventScope.events.find(e => e.id === m.eventId)?.name || '',
              }))}
              columns={[
                ['title', 'Meeting'],
                ['kind', 'Type'],
                ['startsAt', 'Starts'],
                ['status', 'Status'],
                ['event', 'Event'],
                ['agenda', 'Agenda'],
                ['minutes', 'Minutes'],
              ]}
              empty="No meetings visible to your account."
            />
          </div>
        )}

        {tab === 'tasks' &&
          (() => {
            const rows = [
              ...(extraReports.eventTasks || []).map(t => ({
                ...t,
                source: 'Event task',
                assigned: t.assigned_to,
                priority: t.priority_level,
              })),
              ...(extraReports.memberTasks || []).map(t => ({
                ...t,
                source: 'Volunteer task',
                assigned: t.assigned_to || t.member_name,
                priority: t.priority,
              })),
            ];
            return (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <Stat label="All tasks" value={rows.length} />
                  <Stat
                    label="Open"
                    value={
                      rows.filter(t => !['done', 'completed', 'cancelled'].includes(String(t.status).toLowerCase()))
                        .length
                    }
                  />
                  <Stat label="Event tasks" value={(extraReports.eventTasks || []).length} />
                  <Stat label="Volunteer tasks" value={(extraReports.memberTasks || []).length} />
                </div>
                <ReportTable
                  rows={rows}
                  columns={[
                    ['source', 'Source'],
                    ['title', 'Task'],
                    ['assigned', 'Assigned to'],
                    ['department_name', 'Department'],
                    ['priority', 'Priority'],
                    ['due_date', 'Due'],
                    ['status', 'Status'],
                  ]}
                  empty={extraLoading ? 'Loading task reports…' : 'No tasks recorded.'}
                />
              </div>
            );
          })()}

        {tab === 'issues' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Issues and feedback" value={(extraReports.issues || []).length} />
              <Stat label="Open issues" value={(extraReports.issues || []).filter(i => i.status === 'open').length} />
              <Stat label="Department posts" value={(extraReports.updates || []).length} />
              <Stat label="Event reviews" value={(extraReports.eventReviews || []).length} />
            </div>
            <Card title="Issues and feedback">
              <ReportTable
                rows={(extraReports.issues || []).map(i => ({
                  ...i,
                  event_name: eventScope.events.find(e => e.id === i.event_id)?.name || 'Unlinked',
                }))}
                columns={[
                  ['kind', 'Type'],
                  ['event_name', 'Event'],
                  ['sub_department', 'Department'],
                  ['title', 'Title'],
                  ['details', 'Details'],
                  ['reporter_name', 'Reported by'],
                  ['status', 'Status'],
                  ['created_at', 'Created'],
                ]}
                empty={extraLoading ? 'Loading issue reports…' : 'No issues or feedback recorded.'}
              />
            </Card>
            <Card title="Announcements and lessons learned">
              <ReportTable
                rows={extraReports.updates || []}
                columns={[
                  ['kind', 'Type'],
                  ['department', 'Department'],
                  ['title', 'Title'],
                  ['body', 'Details'],
                  ['author_name', 'Posted by'],
                  ['created_at', 'Created'],
                ]}
                empty="No announcements or lessons learned recorded."
              />
            </Card>
          </div>
        )}

        {tab === 'radio' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Return reports" value={(extraReports.radioReturns || []).length} />
              <Stat
                label="Walkies returned"
                value={(extraReports.radioReturns || []).reduce((n, r) => n + Number(r.returned_walkies || 0), 0)}
              />
              <Stat
                label="Chargers returned"
                value={(extraReports.radioReturns || []).reduce((n, r) => n + Number(r.returned_chargers || 0), 0)}
              />
              <Stat
                label="Earphones returned"
                value={(extraReports.radioReturns || []).reduce((n, r) => n + Number(r.returned_earphones || 0), 0)}
              />
            </div>
            <ReportTable
              rows={(extraReports.radioReturns || []).map(r => ({
                ...r,
                event_name: eventScope.events.find(e => e.id === r.event_id)?.name || 'General / no event',
              }))}
              columns={[
                ['event_name', 'Event'],
                ['department_name', 'Department'],
                ['returned_walkies', 'Walkies'],
                ['returned_chargers', 'Chargers'],
                ['returned_earphones', 'Earphones'],
                ['return_feedback', 'Feedback'],
                ['status', 'Status'],
                ['updated_at', 'Updated'],
              ]}
              empty={extraLoading ? 'Loading radio reports…' : 'No radio return reports recorded.'}
            />
          </div>
        )}
      </Swap>
    </div>
  );
};
