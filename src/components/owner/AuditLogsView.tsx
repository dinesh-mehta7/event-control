import React, { useCallback, useEffect, useState } from 'react';
import { Search, Download, RefreshCw } from 'lucide-react';
import { supabase } from '../../modules/walkie/lib/supabaseClient';
import { Empty, Pill, btnGhost, inputCls, th } from '../ui';

interface Entry { id: string; action: string; details: string; type: string; at: string }
const TONE: Record<string, string> = { success: 'bg-emerald-500/15 text-emerald-300', warning: 'bg-amber-500/15 text-amber-300', error: 'bg-red-500/15 text-red-300', info: 'bg-blue-500/15 text-blue-300' };
const csvCell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

// Who did what, across every module. Read from the organization's real history table
// (Walkie, Inventory, Purchase, Accommodation, Manpower and Requests all write to it). Filters apply to the CSV too.
export const AuditLogsView: React.FC = () => {
  const [rows, setRows] = useState<Entry[]>([]); const [loading, setLoading] = useState(true); const [err, setErr] = useState('');
  const [search, setSearch] = useState(''); const [type, setType] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('history').select('id, action, details, type, created_at').order('created_at', { ascending: false }).limit(500);
    if (error) setErr(error.message); else { setErr(''); setRows((data || []).map((r: any) => ({ id: r.id, action: r.action, details: r.details || '', type: r.type || 'info', at: r.created_at }))); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const q = search.trim().toLowerCase();
  const shown = rows.filter(l => (!q || l.action.toLowerCase().includes(q) || l.details.toLowerCase().includes(q)) && (type === 'all' || l.type === type));
  const exportCsv = () => {
    const body = shown.map(l => [new Date(l.at).toISOString(), l.action, l.details, l.type].map(csvCell).join(','));
    const url = URL.createObjectURL(new Blob([['Time,Action,Details,Type', ...body].join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = 'audit-log.csv'; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px] max-w-sm"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input className={inputCls + ' pl-9'} placeholder="Search action or detail" aria-label="Search audit log" value={search} onChange={e => setSearch(e.target.value)} /></div>
        <select className={inputCls + ' !w-auto'} aria-label="Type" value={type} onChange={e => setType(e.target.value)}>
          <option value="all">All types</option><option value="info">Info</option><option value="success">Success</option><option value="warning">Warning</option><option value="error">Error</option></select>
        <div className="ml-auto flex gap-2"><button className={btnGhost} onClick={load}><RefreshCw size={14} />Refresh</button><button className={btnGhost} onClick={exportCsv}><Download size={14} />CSV</button></div>
      </div>
      {err && <div role="alert" className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{err}</div>}
      <div className="rounded-xl border border-line bg-surface overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="bg-canvas"><th className={th}>Time</th><th className={th}>Action</th><th className={th}>Details</th><th className={th}>Type</th></tr></thead>
          <tbody className="divide-y divide-line">
            {shown.map(l => (
              <tr key={l.id} className="align-top hover:bg-raised/50">
                <td className="px-4 py-2 text-xs text-mute whitespace-nowrap">{when(l.at)}</td>
                <td className="px-4 py-2 text-ink whitespace-nowrap">{l.action}</td>
                <td className="px-4 py-2 text-ink-soft">{l.details}</td>
                <td className="px-4 py-2"><Pill c={TONE[l.type] || TONE.info}>{l.type}</Pill></td>
              </tr>))}
          </tbody>
        </table>
        {!shown.length && <Empty>{loading ? 'Loading…' : 'Nothing recorded yet.'}</Empty>}
      </div>
      <p className="text-xs text-faint">Showing the latest {rows.length} entries.</p>
    </div>
  );
};
