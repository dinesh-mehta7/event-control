import React, { useState, useMemo, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import {
  Plus,
  Edit3,
  Trash2,
  Search,
  ChevronLeft,
  ChevronRight,
  Lock,
  UserCog,
  Download,
  Radio,
  X,
  CheckSquare,
  Square,
  Building2,
  LayoutGrid
} from 'lucide-react';

const STATUS_STYLES = {
  Available: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400',
  Allocated: 'bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-400',
  'Under Maintenance': 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-400'
};

const DOT_STYLES = {
  Available: 'bg-emerald-500',
  Allocated: 'bg-blue-500',
  'Under Maintenance': 'bg-amber-500'
};

const PAGE_SIZE_OPTIONS = [12, 24, 48, 'All'];

export default function WalkiesView() {
  const {
    walkies,
    addWalkie,
    editWalkie,
    deleteWalkie,
    bulkAddWalkies,
    bulkDeleteWalkies,
    departments,
    assignPersonToWalkie,
    settings,
    currentUser,
    addToast
  } = useApp();

  const isDark = settings.theme === 'dark';
  const isAdmin = currentUser?.role === 'Admin';
  const isClient = currentUser?.role === 'Client';

  // Search and Filter State
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [deptFilter, setDeptFilter] = useState('All');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);
  const [selectedWalkies, setSelectedWalkies] = useState([]);

  // Modal States
  const [showAddModal, setShowAddModal] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);

  // Form States
  const [newWalkie, setNewWalkie] = useState({ id: '', label: '', model: '', status: 'Available', notes: '' });
  const [bulkConfig, setBulkConfig] = useState({ prefix: 'WT', startNum: '1', count: 5, model: 'Motorola CP200', notes: 'Bulk Warehouse Batch' });
  const [editingWalkie, setEditingWalkie] = useState(null);
  const [assigningWalkie, setAssigningWalkie] = useState(null);
  const [assignForm, setAssignForm] = useState({ name: '', contact: '' });

  const collator = useMemo(() => new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }), []);
  const compareByName = (a, b) => collator.compare(a.label || '', b.label || '');

  const sortedWalkies = useMemo(() => [...walkies].sort(compareByName), [walkies, collator]);

  const statusCounts = useMemo(() => ({
    All: sortedWalkies.length,
    Available: sortedWalkies.filter(w => w.status === 'Available').length,
    Allocated: sortedWalkies.filter(w => w.status === 'Allocated').length,
    'Under Maintenance': sortedWalkies.filter(w => w.status === 'Under Maintenance').length
  }), [sortedWalkies]);

  // Filter, Search, and Sort Logic
  const filteredWalkies = useMemo(() => sortedWalkies.filter(w => {
    const term = search.toLowerCase();
    const matchesSearch = w.id.toLowerCase().includes(term) ||
      w.label.toLowerCase().includes(term) ||
      w.model.toLowerCase().includes(term) ||
      (w.channel || '').toLowerCase().includes(term) ||
      (w.assignedPerson?.name || '').toLowerCase().includes(term);
    const matchesStatus = statusFilter === 'All' || w.status === statusFilter;
    const matchesDept = deptFilter === 'All' ||
      (deptFilter === 'Unassigned' ? !w.departmentId : w.departmentId === deptFilter);
    return matchesSearch && matchesStatus && matchesDept;
  }), [sortedWalkies, search, statusFilter, deptFilter]);

  // Pagination
  const effectivePageSize = pageSize === 'All' ? filteredWalkies.length || 1 : pageSize;
  const totalPages = Math.ceil(filteredWalkies.length / effectivePageSize) || 1;
  const paginatedWalkies = useMemo(
    () => pageSize === 'All'
      ? filteredWalkies
      : filteredWalkies.slice((currentPage - 1) * effectivePageSize, currentPage * effectivePageSize),
    [filteredWalkies, currentPage, effectivePageSize, pageSize]
  );

  // Reset to page 1 whenever filters or page size change so users don't land on an empty page
  useEffect(() => {
    setCurrentPage(1);
  }, [search, statusFilter, deptFilter, pageSize]);

  // Clamp current page if filtering or page size change makes it out of range
  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const handleAddSubmit = async (e) => {
    e.preventDefault();
    if (isClient) {
      addToast('Unauthorized: Clients cannot add walkies.', 'error');
      return;
    }
    const success = await addWalkie(newWalkie);
    if (success) {
      setShowAddModal(false);
      setNewWalkie({ id: '', label: '', model: '', status: 'Available', notes: '' });
    }
  };

  const handleBulkSubmit = async (e) => {
    e.preventDefault();
    if (!isAdmin) {
      addToast('Only Administrators can bulk generate devices.', 'error');
      return;
    }
    const success = await bulkAddWalkies(bulkConfig.prefix, bulkConfig.startNum, bulkConfig.count, bulkConfig.model, bulkConfig.notes);
    if (success) {
      setShowBulkModal(false);
    }
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    if (isClient) {
      addToast('Unauthorized: Clients cannot edit walkies.', 'error');
      return;
    }
    const success = await editWalkie(editingWalkie.id, editingWalkie);
    if (success) {
      setShowEditModal(false);
    }
  };

  const handleBulkDelete = async () => {
    if (!isAdmin) {
      addToast('Unauthorized: Only Administrators can delete assets.', 'error');
      return;
    }
    if (selectedWalkies.length === 0) {
      addToast('Please select walkies to delete.', 'error');
      return;
    }
    const confirmDelete = window.confirm(`Are you sure you want to delete ${selectedWalkies.length} walkies?`);
    if (confirmDelete) {
      await bulkDeleteWalkies(selectedWalkies);
      setSelectedWalkies([]);
    }
  };

  const toggleSelectAllVisible = () => {
    const visibleIds = paginatedWalkies.map(w => w.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every(id => selectedWalkies.includes(id));
    if (allSelected) {
      setSelectedWalkies(prev => prev.filter(id => !visibleIds.includes(id)));
    } else {
      setSelectedWalkies(prev => [...new Set([...prev, ...visibleIds])]);
    }
  };

  const toggleSelect = (id) => {
    setSelectedWalkies(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const openAssignModal = (walkie) => {
    if (currentUser?.role === 'Client') {
      addToast('Unauthorized: Clients cannot assign personnel.', 'error');
      return;
    }
    setAssigningWalkie(walkie);
    setAssignForm({ name: walkie.assignedPerson?.name || '', contact: walkie.assignedPerson?.contact || '' });
    setShowAssignModal(true);
  };

  const handleAssignSubmit = async (e) => {
    e.preventDefault();
    const success = await assignPersonToWalkie(assigningWalkie.id, assignForm.name, assignForm.contact);
    if (success) {
      setShowAssignModal(false);
      setAssigningWalkie(null);
    }
  };

  const exportCSV = () => {
    const headers = ['Walkie ID', 'Unit Name', 'Model', 'Status', 'Rental', 'Department', 'Channel', 'Assigned To', 'Contact', 'Notes'];
    const exportSource = selectedWalkies.length > 0
      ? walkies.filter(w => selectedWalkies.includes(w.id))
      : filteredWalkies;

    const rows = exportSource.map(w => {
      const dept = departments.find(d => d.id === w.departmentId);
      return [
        w.id, w.label, w.model, w.status, w.isRented ? 'Rented' : 'Owned',
        dept ? dept.name : '',
        w.channel || '',
        w.assignedPerson?.name || '',
        w.assignedPerson?.contact || '',
        (w.notes || '').replace(/,/g, ';')
      ];
    });
    const csvContent = "data:text/csv;charset=utf-8,"
      + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `walkie_inventory_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const inputCls = `w-full p-2.5 rounded-xl border outline-none text-sm ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-slate-50 border-slate-200'}`;
  const labelCls = 'block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1';

  return (
    <div className="space-y-6">
      {/* Header: title left, actions right */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Walkie Talkie Inventory</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Add, edit, and keep track of your active radio assets.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={exportCSV} title="Export CSV"
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-semibold border transition-all ${isDark ? 'border-slate-700 text-slate-200 hover:bg-slate-800' : 'border-slate-200 text-slate-700 hover:bg-slate-100'}`}>
            <Download className="w-4 h-4" />Export
          </button>
          <button
            onClick={() => {
              if (!isAdmin) { addToast('Access Denied: Only Admins can execute bulk additions.', 'error'); return; }
              setShowBulkModal(true);
            }}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-semibold border transition-all ${isAdmin
              ? (isDark ? 'border-slate-700 text-slate-200 hover:bg-slate-800' : 'border-slate-200 text-slate-700 hover:bg-slate-100')
              : 'border-transparent bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-600 cursor-not-allowed'}`}>
            {!isAdmin && <Lock className="w-3.5 h-3.5" />}Bulk Add
          </button>
          {isAdmin && selectedWalkies.length > 0 && (
            <button onClick={handleBulkDelete}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-semibold bg-rose-600 hover:bg-rose-700 text-white transition-all">
              <Trash2 className="w-4 h-4" />Delete ({selectedWalkies.length})
            </button>
          )}
          <button
            onClick={() => {
              if (isClient) { addToast('Access Denied: Read-only guest accounts cannot add radios.', 'error'); return; }
              setShowAddModal(true);
            }}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all shadow-lg ${isClient
              ? 'bg-slate-200 text-slate-400 dark:bg-slate-800 dark:text-slate-600 cursor-not-allowed shadow-none'
              : 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-500/20'}`}>
            {isClient ? <Lock className="w-4 h-4" /> : <Plus className="w-4 h-4" />}Add Walkie
          </button>
        </div>
      </div>

      {/* One panel: status summary + distribution bar + search/filters */}
      <section className={`rounded-xl border overflow-hidden ${isDark ? 'bg-slate-950 border-slate-800' : 'bg-white border-slate-100 shadow-sm'}`}>
        <div className={`grid grid-cols-2 md:grid-cols-4 ${isDark ? 'divide-slate-800' : 'divide-slate-100'} md:divide-x`}>
          {['All', 'Available', 'Allocated', 'Under Maintenance'].map(status => {
            const on = statusFilter === status;
            const total = statusCounts.All || 0;
            const pct = status === 'All' || !total ? null : Math.round((statusCounts[status] / total) * 100);
            return (
              <button key={status} onClick={() => setStatusFilter(status)} aria-pressed={on}
                className={`px-5 py-4 text-left transition-colors border-b-2 ${on ? 'border-blue-500 bg-blue-500/5' : 'border-transparent hover:bg-slate-500/5'}`}>
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  {status !== 'All' && <span className={`w-2 h-2 rounded-full ${DOT_STYLES[status]}`}></span>}
                  {status}
                </div>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-2xl font-bold">{statusCounts[status]}</span>
                  {pct !== null && <span className="text-xs text-slate-400">{pct}%</span>}
                </div>
              </button>
            );
          })}
        </div>

        {/* proportional bar: available / allocated / maintenance */}
        <div className="flex h-1.5 bg-slate-500/10" aria-hidden="true">
          {['Available', 'Allocated', 'Under Maintenance'].map(st => (
            <div key={st} className={DOT_STYLES[st]} style={{ width: `${statusCounts.All ? (statusCounts[st] / statusCounts.All) * 100 : 0}%` }} />
          ))}
        </div>

        <div className={`p-4 flex flex-col lg:flex-row gap-3 lg:items-center lg:justify-between border-t ${isDark ? 'border-slate-800' : 'border-slate-100'}`}>
          <div className="relative w-full lg:max-w-sm">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search walkies..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={`w-full pl-9 pr-4 py-2 text-sm rounded-xl border outline-none transition-all
                ${isDark ? 'bg-slate-900 border-slate-800 focus:border-blue-500' : 'bg-slate-50 border-slate-200 focus:bg-white focus:border-blue-500'}`}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <Building2 className="absolute left-3 top-2.5 h-4 w-4 text-slate-400 pointer-events-none" />
              <select
                value={deptFilter}
                onChange={(e) => setDeptFilter(e.target.value)}
                className={`pl-9 pr-8 py-2 text-sm rounded-xl border outline-none appearance-none font-semibold
                  ${isDark ? 'bg-slate-900 border-slate-800' : 'bg-slate-50 border-slate-200'}`}
              >
                <option value="All">All Departments</option>
                <option value="Unassigned">Unassigned</option>
                {departments.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-1.5">
              <LayoutGrid className="w-4 h-4 text-slate-400 shrink-0" />
              {PAGE_SIZE_OPTIONS.map(size => (
                <button
                  key={size}
                  onClick={() => setPageSize(size)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all
                    ${pageSize === size
                      ? 'bg-blue-600 text-white'
                      : isDark ? 'bg-slate-900 hover:bg-slate-800 text-slate-300' : 'bg-slate-100 hover:bg-slate-200 text-slate-600'}`}
                >
                  {size}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Select-all bar (only shows once a filtered set is in view) */}
      {paginatedWalkies.length > 0 && (
        <div className="flex items-center justify-between px-1">
          <button
            onClick={toggleSelectAllVisible}
            className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
          >
            {paginatedWalkies.every(w => selectedWalkies.includes(w.id))
              ? <CheckSquare className="w-4 h-4 text-blue-600" />
              : <Square className="w-4 h-4" />}
            Select all visible ({paginatedWalkies.length})
          </button>
          <p className="text-xs font-semibold text-slate-400">
            Showing {paginatedWalkies.length} of {filteredWalkies.length} radios
          </p>
        </div>
      )}

      {/* Inventory Grid */}
      {paginatedWalkies.length === 0 ? (
        <div className={`py-16 text-center rounded-xl border ${isDark ? 'bg-slate-950 border-slate-800 text-slate-400' : 'bg-white border-slate-100 text-slate-500 shadow-sm'}`}>
          No walkie talkies found matching your criteria.
        </div>
      ) : (
        <div className={`overflow-x-auto rounded-xl border ${isDark ? 'border-slate-800 bg-slate-950' : 'border-slate-200 bg-white shadow-sm'}`}>
          <table className="w-full min-w-[800px] text-left text-sm">
            <thead className={`${isDark ? 'bg-slate-900 text-slate-400' : 'bg-slate-50 text-slate-500'} text-xs uppercase tracking-wide`}>
              <tr>
                <th className="w-10 px-4 py-3"><span className="sr-only">Select</span></th>
                <th className="px-3 py-3">Device</th><th className="px-3 py-3">Source</th><th className="px-3 py-3">Model</th>
                <th className="px-3 py-3">Status</th><th className="px-3 py-3">Department</th><th className="px-3 py-3">Channel</th><th className="px-3 py-3">Holder</th><th className="px-3 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${isDark ? 'divide-slate-800' : 'divide-slate-100'}`}>
              {paginatedWalkies.map(walkie => {
                const dept = departments.find(d => d.id === walkie.departmentId);
                const isSelected = selectedWalkies.includes(walkie.id);
                return <tr key={walkie.id} className={`${isSelected ? 'bg-blue-500/5' : ''} ${isDark ? 'hover:bg-white/[0.025]' : 'hover:bg-slate-50'}`}>
                  <td className="px-4 py-3"><input type="checkbox" checked={isSelected} onChange={() => toggleSelect(walkie.id)} aria-label={`Select ${walkie.id}`} className="h-4 w-4 rounded text-blue-600 focus:ring-blue-500" /></td>
                  <td className="px-3 py-3"><div className="font-semibold text-ink">{walkie.label || walkie.id}</div><div className="mt-0.5 text-[11.5px] text-mute">ID: {walkie.id}</div></td>
                  <td className="px-3 py-3"><span className={`rounded-full px-2 py-1 text-[10.5px] ${walkie.isRented ? 'bg-violet-500/10 text-violet-300' : 'bg-slate-500/10 text-mute'}`}>{walkie.isRented ? 'Rented' : 'Owned'}</span></td>
                  <td className="px-3 py-3 text-ink-soft">{walkie.model || '—'}</td>
                  <td className="px-3 py-3"><span className={`inline-flex rounded-full px-2.5 py-1 text-[10.5px] font-semibold ${STATUS_STYLES[walkie.status]}`}>{walkie.status}</span></td>
                  <td className="max-w-44 truncate px-3 py-3 text-ink-soft" title={dept?.name}>{walkie.status === 'Allocated' && dept ? dept.name : '—'}</td>
                  <td className="px-3 py-3">{walkie.channel ? <span className="inline-flex items-center gap-1 rounded-md bg-blue-500/10 px-2 py-1 text-xs font-semibold text-blue-400"><Radio className="h-3 w-3" />{walkie.channel}</span> : <span className="text-mute">—</span>}</td>
                  <td className="max-w-40 truncate px-3 py-3 text-ink-soft" title={walkie.assignedPerson?.name}>{walkie.assignedPerson?.name || 'Unassigned'}</td>
                  <td className="px-3 py-3"><div className="flex justify-end gap-1">
                    <button type="button" onClick={() => openAssignModal(walkie)} className="rounded-md p-2 text-blue-400 hover:bg-raised" title={isClient ? 'Locked' : 'Assign to person'} aria-label={`Assign ${walkie.id}`}>
                      {isClient ? <Lock className="h-4 w-4" /> : <UserCog className="h-4 w-4" />}
                    </button>
                    <button type="button" onClick={() => { if (isClient) { addToast('Unauthorized: Clients cannot edit walkies.', 'error'); return; } setEditingWalkie(walkie); setShowEditModal(true); }} className="rounded-md p-2 text-blue-400 hover:bg-raised" title={isClient ? 'Locked' : 'Edit device'} aria-label={`Edit ${walkie.id}`}>
                      {isClient ? <Lock className="h-4 w-4" /> : <Edit3 className="h-4 w-4" />}
                    </button>
                    <button type="button" onClick={() => { if (!isAdmin) { addToast('Unauthorized: Only Administrators can delete assets.', 'error'); return; } deleteWalkie(walkie.id); }} className="rounded-md p-2 text-rose-400 hover:bg-rose-500/10" title={isAdmin ? 'Delete' : 'Locked'} aria-label={`Delete ${walkie.id}`}>
                      {isAdmin ? <Trash2 className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                    </button>
                  </div></td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination Controls */}
      {pageSize !== 'All' && (
        <div className={`p-4 border rounded-xl flex items-center justify-between text-xs font-semibold
          ${isDark ? 'bg-slate-950 border-slate-800 text-slate-400' : 'bg-white border-slate-100 text-slate-500 shadow-sm'}`}>
          <p>Showing {paginatedWalkies.length} of {filteredWalkies.length} entries</p>
          <div className="flex gap-2 items-center">
            <button
              disabled={currentPage === 1}
              onClick={() => setCurrentPage(prev => prev - 1)}
              className="p-1.5 rounded-lg border dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-900 disabled:opacity-40 transition-all"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="flex items-center px-2">Page {currentPage} of {totalPages}</span>
            <button
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage(prev => prev + 1)}
              className="p-1.5 rounded-lg border dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-900 disabled:opacity-40 transition-all"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Add Walkie Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className={`w-full max-w-md rounded-xl shadow-2xl p-6 transition-all ${isDark ? 'bg-slate-900 text-slate-100' : 'bg-white text-slate-800'}`}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">Add New Walkie Talkie</h3>
              <button onClick={() => setShowAddModal(false)} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleAddSubmit} className="space-y-4">
              <div>
                <label className={labelCls}>Walkie ID (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. WT-107 (leave empty for auto-gen)"
                  value={newWalkie.id}
                  onChange={(e) => setNewWalkie({ ...newWalkie, id: e.target.value })}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Unit Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Logistics Alpha"
                  value={newWalkie.label}
                  onChange={(e) => setNewWalkie({ ...newWalkie, label: e.target.value })}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Model</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Motorola CP200"
                  value={newWalkie.model}
                  onChange={(e) => setNewWalkie({ ...newWalkie, model: e.target.value })}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Notes</label>
                <textarea
                  placeholder="Additional details..."
                  value={newWalkie.notes}
                  onChange={(e) => setNewWalkie({ ...newWalkie, notes: e.target.value })}
                  className={`${inputCls} h-20`}
                />
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 text-sm font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-semibold bg-blue-600 text-white rounded-xl hover:bg-blue-700"
                >
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bulk Add Modal */}
      {showBulkModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className={`w-full max-w-md rounded-xl shadow-2xl p-6 transition-all ${isDark ? 'bg-slate-900 text-slate-100' : 'bg-white text-slate-800'}`}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-lg font-bold">Bulk Add Walkie Talkies</h3>
              <button onClick={() => setShowBulkModal(false)} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-400 mb-4">Generates multiple walkies sequentially with unique IDs.</p>
            <form onSubmit={handleBulkSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>ID Prefix</label>
                  <input
                    type="text"
                    required
                    value={bulkConfig.prefix}
                    onChange={(e) => setBulkConfig({ ...bulkConfig, prefix: e.target.value })}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Starting Number</label>
                  <input
                    type="number"
                    required
                    value={bulkConfig.startNum}
                    onChange={(e) => setBulkConfig({ ...bulkConfig, startNum: e.target.value })}
                    className={inputCls}
                  />
                </div>
              </div>
              <div>
                <label className={labelCls}>How many to generate?</label>
                <input
                  type="number"
                  min="1"
                  max="500"
                  required
                  value={bulkConfig.count}
                  onChange={(e) => setBulkConfig({ ...bulkConfig, count: parseInt(e.target.value, 10) })}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Model</label>
                <input
                  type="text"
                  required
                  value={bulkConfig.model}
                  onChange={(e) => setBulkConfig({ ...bulkConfig, model: e.target.value })}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Notes</label>
                <input
                  type="text"
                  value={bulkConfig.notes}
                  onChange={(e) => setBulkConfig({ ...bulkConfig, notes: e.target.value })}
                  className={inputCls}
                />
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowBulkModal(false)}
                  className="px-4 py-2 text-sm font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-semibold bg-blue-600 text-white rounded-xl hover:bg-blue-700"
                >
                  Generate
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Walkie Modal */}
      {showEditModal && editingWalkie && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className={`w-full max-w-md rounded-xl shadow-2xl p-6 transition-all ${isDark ? 'bg-slate-900 text-slate-100' : 'bg-white text-slate-800'}`}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">Edit Walkie Details</h3>
              <button onClick={() => setShowEditModal(false)} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleEditSubmit} className="space-y-4">
              <div>
                <label className={labelCls}>Walkie ID (Read Only)</label>
                <input
                  type="text"
                  disabled
                  value={editingWalkie.id}
                  className={`${inputCls} opacity-60`}
                />
              </div>
              <div>
                <label className={labelCls}>Unit Name</label>
                <input
                  type="text"
                  required
                  value={editingWalkie.label}
                  onChange={(e) => setEditingWalkie({ ...editingWalkie, label: e.target.value })}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Model</label>
                <input
                  type="text"
                  required
                  value={editingWalkie.model}
                  onChange={(e) => setEditingWalkie({ ...editingWalkie, model: e.target.value })}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Notes</label>
                <textarea
                  value={editingWalkie.notes}
                  onChange={(e) => setEditingWalkie({ ...editingWalkie, notes: e.target.value })}
                  className={`${inputCls} h-20`}
                />
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="px-4 py-2 text-sm font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-semibold bg-blue-600 text-white rounded-xl hover:bg-blue-700"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Assign to Person Modal */}
      {showAssignModal && assigningWalkie && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className={`w-full max-w-md rounded-xl shadow-2xl p-6 transition-all ${isDark ? 'bg-slate-900 text-slate-100' : 'bg-white text-slate-800'}`}>
            <h3 className="text-lg font-bold mb-1">Assign to Person</h3>
            <p className="text-xs text-slate-400 mb-4">
              Track who is physically holding <span className="font-bold">{assigningWalkie.id} — {assigningWalkie.label}</span>.
            </p>
            <form onSubmit={handleAssignSubmit} className="space-y-4">
              <div>
                <label className={labelCls}>Person Name</label>
                <input
                  type="text"
                  placeholder="e.g. Jordan Blake (leave empty to unassign)"
                  value={assignForm.name}
                  onChange={(e) => setAssignForm({ ...assignForm, name: e.target.value })}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Contact (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. Ext. 204 or phone number"
                  value={assignForm.contact}
                  onChange={(e) => setAssignForm({ ...assignForm, contact: e.target.value })}
                  className={inputCls}
                />
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => { setShowAssignModal(false); setAssigningWalkie(null); }}
                  className="px-4 py-2 text-sm font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-semibold bg-blue-600 text-white rounded-xl hover:bg-blue-700"
                >
                  Save Assignment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
