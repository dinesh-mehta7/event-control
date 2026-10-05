import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  Search,
  Filter,
  Download
} from 'lucide-react';

export default function HistoryView() {
  const { history, settings } = useApp();
  const isDark = settings.theme === 'dark';

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('All');

  const filteredHistory = history.filter(h => {
    const matchesSearch = h.action.toLowerCase().includes(search.toLowerCase()) ||
                          h.details.toLowerCase().includes(search.toLowerCase());
    const matchesType = typeFilter === 'All' || h.type === typeFilter;
    return matchesSearch && matchesType;
  });

  const exportCSV = () => {
    const headers = ['ID', 'Action', 'Details', 'Timestamp', 'Type'];
    const rows = filteredHistory.map(h => [h.id, h.action, h.details, h.timestamp, h.type]);
    const csvContent = "data:text/csv;charset=utf-8,"
      + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `walkie_talkie_history_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">System Activity History</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">A comprehensive audit log of all allocations, returns, updates, and maintenance.</p>
        </div>
        <button
          onClick={exportCSV}
          className="flex items-center gap-2 bg-slate-800 dark:bg-slate-700 hover:bg-slate-700 text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition-all"
        >
          <Download className="w-4 h-4" />
          Export Audit Log (CSV)
        </button>
      </div>

      {/* Search & Filter bar */}
      <div className={`p-4 rounded-xl border flex flex-col md:flex-row gap-4 justify-between items-center
        ${isDark ? 'bg-slate-950 border-slate-800' : 'bg-white border-slate-100 shadow-sm'}`}>
        
        <div className="relative w-full md:max-w-xs">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search logs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={`w-full pl-9 pr-4 py-2 text-sm rounded-xl border outline-none transition-all
              ${isDark ? 'bg-slate-900 border-slate-800 focus:border-blue-500' : 'bg-slate-50 border-slate-200 focus:bg-white focus:border-blue-500'}`}
          />
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto">
          <Filter className="w-4 h-4 text-slate-400 shrink-0" />
          {['All', 'success', 'info', 'warning'].map((type) => (
            <button
              key={type}
              onClick={() => setTypeFilter(type)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all capitalize
                ${typeFilter === type 
                  ? 'bg-blue-600 text-white' 
                  : isDark 
                    ? 'bg-slate-900 hover:bg-slate-800 text-slate-300' 
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-600'}`}
            >
              {type === 'All' ? 'All Logs' : type}
            </button>
          ))}
        </div>
      </div>

      {/* Activity Timeline Table */}
      <div className={`border rounded-xl overflow-hidden ${isDark ? 'bg-slate-950 border-slate-800' : 'bg-white border-slate-100 shadow-sm'}`}>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className={`border-b text-xs font-semibold uppercase tracking-wider ${isDark ? 'bg-slate-900/50 border-slate-800 text-slate-400' : 'bg-slate-50 border-slate-100 text-slate-500'}`}>
                <th className="py-4 px-6">Log ID</th>
                <th className="py-4 px-6">Action</th>
                <th className="py-4 px-6">Details</th>
                <th className="py-4 px-6">Timestamp</th>
                <th className="py-4 px-6">Type</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredHistory.length === 0 ? (
                <tr>
                  <td colSpan="5" className="py-12 text-center text-slate-500">
                    No history logs found.
                  </td>
                </tr>
              ) : (
                filteredHistory.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-900/50 transition-colors text-sm">
                    <td className="py-4 px-6 text-slate-400 font-mono text-xs">{log.id}</td>
                    <td className="py-4 px-6 font-semibold text-slate-800 dark:text-slate-200">{log.action}</td>
                    <td className="py-4 px-6 text-slate-500 dark:text-slate-400">{log.details}</td>
                    <td className="py-4 px-6 text-xs text-slate-400">{log.timestamp}</td>
                    <td className="py-4 px-6">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold capitalize
                        ${log.type === 'success' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400'
                          : log.type === 'warning' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-400'
                          : 'bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-400'}`}>
                        {log.type}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
