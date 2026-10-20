import { supabase } from '../../../modules/walkie/lib/supabaseClient';

export const REPORT_TABS = [
  'requests',
  'purchase',
  'inventory',
  'wifi',
  'people',
  'accommodation',
  'events',
  'meetings',
  'tasks',
  'issues',
  'radio',
];

const csvCell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

export const download = (name: string, rows: (string | number)[][]) => {
  const url = URL.createObjectURL(new Blob([rows.map(r => r.map(csvCell).join(',')).join('\n')], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
};

export type WifiUsageRow = {
  id: string;
  event_id: string | null;
  network_name: string;
  access_point: string;
  recipient_name: string;
  department: string;
  valid_until: string | null;
  status: 'active' | 'expired' | 'revoked';
  created_at: string;
};

export const wifiStatus = (row: WifiUsageRow) =>
  row.status === 'active' && row.valid_until && row.valid_until < new Date().toISOString().slice(0, 10)
    ? 'expired'
    : row.status;

export const wifiUsageError = (error: any) =>
  /event_id|schema cache/i.test(error?.message || '')
    ? `${error.message} — run supabase/migration_v74_wifi_event_usage.sql, then reload.`
    : error?.message || 'Could not load Wi-Fi usage.';

export type ExtraReports = Record<string, any[]>;

export const extraReportTables = [
  ['events', 'event_plans'],
  ['requirements', 'event_requirements'],
  ['eventTasks', 'manpower_tasks'],
  ['eventReviews', 'event_reviews'],
  ['attendance', 'event_attendance'],
  ['issues', 'member_issues'],
  ['updates', 'department_updates'],
  ['memberTasks', 'accommodation_member_tasks'],
  ['calls', 'accommodation_member_calls'],
  ['radioReturns', 'event_radio_requests'],
  ['inventoryMovements', 'inventory_movements'],
  ['requestEvents', 'request_events'],
  ['requestFulfilments', 'request_fulfilments'],
  ['purchaseReceipts', 'purchase_receipts'],
  ['purchasePayments', 'purchase_payments'],
] as const;

export const fetchOrgReportRows = async (table: string, organizationId: string) => {
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const result = await supabase
      .from(table)
      .select('*')
      .eq('organization_id', organizationId)
      .range(from, from + 999);
    if (result.error) return { rows: [], error: result.error.message };
    rows.push(...(result.data || []));
    if (!result.data || result.data.length < 1000) return { rows, error: '' };
  }
};

export const reportValue = (value: any) =>
  value == null || value === '' ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value);
