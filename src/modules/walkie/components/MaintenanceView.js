import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  Wrench,
  CheckCircle,
  Calendar,
  User,
  Plus,
  Clock,
  RotateCcw,
  Lock,
  Search
} from 'lucide-react';

export default function MaintenanceView() {
  const {
    walkies,
    maintenance,
    sendToMaintenance,
    completeMaintenance,
    settings,
    currentUser,
    addToast
  } = useApp();

  const isDark = settings.theme === 'dark';
  const isClient = currentUser?.role === 'Client';

  // State
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedWalkie, setSelectedWalkie] = useState('');
  const [issue, setIssue] = useState('');
  const [technician, setTechnician] = useState('');
  const [search, setSearch] = useState('');
  const [popupSearch, setPopupSearch] = useState('');

  // Filter for walkies that can be sent to maintenance
  const availableForMaint = walkies.filter(w => w.status !== 'Under Maintenance');
  const filteredAvailableForMaint = availableForMaint.filter((w) => {
    const term = popupSearch.toLowerCase().trim();
    if (!term) return true;
    return [w.id, w.label, w.status].join(' ').toLowerCase().includes(term);
  });
  const activeMaint = maintenance.filter(m => m.status === 'In Progress');
  const completedMaint = maintenance.filter(m => m.status === 'Completed');
  const searchTerm = search.toLowerCase().trim();

  const filteredActiveMaint = activeMaint.filter((m) => {
    const walkie = walkies.find(w => w.id === m.walkieId);
    const haystack = [m.walkieId, walkie?.label, m.issue, m.technician]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(searchTerm);
  });

  const filteredCompletedMaint = completedMaint.filter((m) => {
    const walkie = walkies.find(w => w.id === m.walkieId);
    const haystack = [m.walkieId, walkie?.label, m.issue, m.technician]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(searchTerm);
  });

  const handleSendSubmit = async (e) => {
    e.preventDefault();
    if (isClient) {
      addToast('Unauthorized: Clients cannot send units to maintenance.', 'error');
      return;
    }
    const success = await sendToMaintenance(selectedWalkie, issue, technician);
    if (success) {
      setShowAddModal(false);
      setSelectedWalkie('');
      setIssue('');
      setTechnician('');
      setPopupSearch('');
    }
  };

  return (
    <div className="space-y-6 relative">
      
      {/* Read-Only Client Overlay Lock */}
      {isClient && (
        <div className="absolute inset-0 bg-slate-100/50 dark:bg-slate-900/60 backdrop-blur-[1px] rounded-xl z-30 flex flex-col items-center justify-center p-6 text-center">
          <Lock className="w-12 h-12 text-blue-500 mb-2 animate-bounce" />
          <h4 className="font-bold text-lg">Maintenance Panel Locked</h4>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs mt-1">
            Your current Client account is authorized for read-only tracking. Only Administrators and Operators can manage repairs.
          </p>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Maintenance & Repairs</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Track broken hardware, manage repair statuses, and restore devices to inventory.</p>
        </div>
        <button
          onClick={() => {
            if (isClient) {
              addToast('Access Denied: Read-only guest accounts cannot initiate repairs.', 'error');
              return;
            }
            setPopupSearch('');
            setSelectedWalkie('');
            setIssue('');
            setTechnician('');
            setShowAddModal(true);
          }}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all shadow-lg
            ${isClient 
              ? 'bg-slate-200 text-slate-400 dark:bg-slate-800 dark:text-slate-600 cursor-not-allowed'
              : 'bg-amber-500 hover:bg-amber-600 text-white shadow-amber-500/20'}`}
        >
          {isClient ? <Lock className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          Send to Maintenance
        </button>
      </div>

      {/* Search Bar */}
      <div className="relative">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
        <input
          type="text"
          placeholder="Search maintenance records..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={`w-full pl-10 pr-4 py-2.5 rounded-xl border outline-none text-sm ${isDark ? 'bg-slate-900 border-slate-800 text-slate-100' : 'bg-white border-slate-200 text-slate-700'}`}
        />
      </div>

      {/* Grid: Active & History */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Active Maintenance (Left 2 cols) */}
        <div className={`p-6 rounded-xl border lg:col-span-2 
          ${isDark ? 'bg-slate-950 border-slate-800' : 'bg-white border-slate-100 shadow-sm'}`}>
          <h3 className="font-bold text-lg mb-4 text-amber-500 flex items-center gap-2">
            <Clock className="w-5 h-5" />
            Active Repairs ({filteredActiveMaint.length})
          </h3>

          {filteredActiveMaint.length === 0 ? (
            <div className="text-center py-12 text-slate-500">
              {searchTerm ? `No active repairs match "${search}".` : 'No walkie talkies are currently under maintenance. Good job!'}
            </div>
          ) : (
            <div className="space-y-4">
              {filteredActiveMaint.map((m) => {
                const walkie = walkies.find(w => w.id === m.walkieId);
                return (
                  <div 
                    key={m.id}
                    className={`p-4 rounded-xl border flex flex-col md:flex-row justify-between items-start md:items-center gap-4 transition-all
                      ${isDark ? 'border-slate-850 bg-slate-900/30' : 'border-slate-100 bg-slate-50/50'}`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-blue-600 dark:text-blue-400">{m.walkieId}</span>
                        <span className="text-xs text-slate-400 font-medium">({walkie?.label})</span>
                      </div>
                      <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Issue: {m.issue}</p>
                      <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400 pt-1">
                        <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> {m.date}</span>
                        <span className="flex items-center gap-1"><User className="w-3.5 h-3.5" /> Tech: {m.technician}</span>
                      </div>
                    </div>
                    <div className="flex gap-2 self-end md:self-center">
                      <button
                        disabled={isClient}
                        onClick={() => completeMaintenance(m.id, 'Fixed', 'Battery or antenna replaced')}
                        className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-all disabled:opacity-40"
                      >
                        <CheckCircle className="w-3.5 h-3.5" />
                        Mark Available
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Maintenance History (Right 1 col) */}
        <div className={`p-6 rounded-xl border 
          ${isDark ? 'bg-slate-950 border-slate-800' : 'bg-white border-slate-100 shadow-sm'}`}>
          <h3 className="font-bold text-lg mb-4 text-slate-400 flex items-center gap-2">
            <RotateCcw className="w-5 h-5" />
            Repair History
          </h3>

          {filteredCompletedMaint.length === 0 ? (
            <p className="text-slate-500 text-xs">
              {searchTerm ? `No completed repairs match "${search}".` : 'No completed maintenance records in this session.'}
            </p>
          ) : (
            <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
              {filteredCompletedMaint.map((m) => (
                <div 
                  key={m.id} 
                  className={`p-3 rounded-xl border text-xs space-y-1
                    ${isDark ? 'border-slate-850 bg-slate-900/10' : 'border-slate-50 bg-slate-100/20'}`}
                >
                  <div className="flex justify-between font-bold">
                    <span className="text-blue-500">{m.walkieId}</span>
                    <span className="text-emerald-500">Completed</span>
                  </div>
                  <p className="text-slate-400">{m.issue}</p>
                  <p className="text-xs text-slate-500">Tech: {m.technician}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Send to Maintenance Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className={`w-full max-w-md rounded-xl shadow-2xl p-6 transition-all ${isDark ? 'bg-slate-900 text-slate-100' : 'bg-white text-slate-800'}`}>
            <h3 className="text-lg font-bold mb-4">Flag Walkie for Maintenance</h3>
            <form onSubmit={handleSendSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Select Walkie Talkie</label>
                <input
                  type="text"
                  placeholder="Search by ID, name, or status"
                  value={popupSearch}
                  onChange={(e) => setPopupSearch(e.target.value)}
                  className={`w-full p-2.5 rounded-xl border outline-none text-sm mb-2 ${isDark ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-slate-50 border-slate-200 text-slate-800'}`}
                />
                <div className={`max-h-48 overflow-y-auto rounded-xl border ${isDark ? 'border-slate-700 bg-slate-800' : 'border-slate-200 bg-slate-50'}`}>
                  {filteredAvailableForMaint.length === 0 ? (
                    <p className="px-3 py-3 text-sm text-slate-500">No matching walkies found.</p>
                  ) : (
                    filteredAvailableForMaint.map((w) => {
                      const isSelected = selectedWalkie === w.id;
                      return (
                        <button
                          key={w.id}
                          type="button"
                          onClick={() => setSelectedWalkie(w.id)}
                          className={`w-full text-left px-3 py-2.5 text-sm border-b last:border-b-0 transition-colors ${
                            isSelected
                              ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                              : isDark
                                ? 'text-slate-200 hover:bg-slate-700'
                                : 'text-slate-700 hover:bg-slate-100'
                          } ${isDark ? 'border-slate-700' : 'border-slate-200'}`}
                        >
                          <div className="font-semibold">{w.id} - {w.label}</div>
                          <div className="text-xs text-slate-400">{w.status}</div>
                        </button>
                      );
                    })
                  )}
                </div>
                {!selectedWalkie && popupSearch && (
                  <p className="mt-2 text-xs text-slate-400">Type to search and click a device to select it.</p>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Issue Description</label>
                <textarea
                  required
                  placeholder="e.g. Audio static, broken belt clip, screen cracked..."
                  value={issue}
                  onChange={(e) => setIssue(e.target.value)}
                  className={`w-full p-2.5 rounded-xl border outline-none text-sm h-24 ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-slate-50 border-slate-200'}`}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Assigned Technician / Shop</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Alex Mercer (Hardware Ops)"
                  value={technician}
                  onChange={(e) => setTechnician(e.target.value)}
                  className={`w-full p-2.5 rounded-xl border outline-none text-sm ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-slate-50 border-slate-200'}`}
                />
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddModal(false);
                    setPopupSearch('');
                  }}
                  className="px-4 py-2 text-sm font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-semibold bg-amber-500 text-white rounded-xl hover:bg-amber-600"
                >
                  Confirm Send
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
