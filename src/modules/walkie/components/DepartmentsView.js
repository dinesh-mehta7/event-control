import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import {
  Plus,
  Edit3,
  Trash2,
  Search,
  Building2,
  Radio,
  AlertTriangle,
  Lock,
  UserRound,
  Phone
} from 'lucide-react';

export default function DepartmentsView() {
  const {
    departments,
    walkies,
    addDepartment,
    editDepartment,
    deleteDepartment,
    departmentHeads,
    addDepartmentHead,
    editDepartmentHead,
    deleteDepartmentHead,
    settings,
    currentUser,
    addToast
  } = useApp();

  const isDark = settings.theme === 'dark';
  const isAdmin = currentUser?.role === 'Admin';
  const isClient = currentUser?.role === 'Client';

  // State
  const [search, setSearch] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  
  const [newDept, setNewDept] = useState({ name: '', description: '', channelNumber: '' });
  const [editingDept, setEditingDept] = useState(null);
  const [deptToDelete, setDeptToDelete] = useState(null);

  // Department Head management (inside the Edit Department modal)
  const [newHeadName, setNewHeadName] = useState('');
  const [newHeadMobile, setNewHeadMobile] = useState('');
  const [editingHeadId, setEditingHeadId] = useState(null);
  const [editingHeadName, setEditingHeadName] = useState('');
  const [editingHeadMobile, setEditingHeadMobile] = useState('');

  // Filter
  const filteredDepts = useMemo(() => departments.filter(d => 
    d.name.toLowerCase().includes(search.toLowerCase()) ||
    d.description.toLowerCase().includes(search.toLowerCase()) ||
    (d.channelNumber || '').toLowerCase().includes(search.toLowerCase())
  ), [departments, search]);

  // Submit Handlers
  const handleAddSubmit = async (e) => {
    e.preventDefault();
    if (isClient) {
      addToast('Unauthorized: Clients cannot add departments.', 'error');
      return;
    }
    const success = await addDepartment(newDept);
    if (success) {
      setShowAddModal(false);
      setNewDept({ name: '', description: '', channelNumber: '' });
    }
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    if (isClient) {
      addToast('Unauthorized: Clients cannot edit departments.', 'error');
      return;
    }
    const success = await editDepartment(editingDept.id, editingDept);
    if (success) {
      setShowEditModal(false);
    }
  };

  const handleAddHead = async (e) => {
    e.preventDefault();
    if (isClient) {
      addToast('Unauthorized: Clients cannot manage department heads.', 'error');
      return;
    }
    const success = await addDepartmentHead(editingDept.id, newHeadName, newHeadMobile);
    if (success) {
      setNewHeadName('');
      setNewHeadMobile('');
    }
  };

  const startEditHead = (head) => {
    setEditingHeadId(head.id);
    setEditingHeadName(head.name);
    setEditingHeadMobile(head.mobileNumber);
  };

  const handleSaveHeadEdit = async () => {
    const success = await editDepartmentHead(editingHeadId, { name: editingHeadName, mobileNumber: editingHeadMobile });
    if (success) {
      setEditingHeadId(null);
    }
  };

  const handleDeleteClick = (dept) => {
    if (!isAdmin) {
      addToast('Unauthorized: Only Administrators can delete departments.', 'error');
      return;
    }
    const allocatedCount = walkies.filter(w => w.departmentId === dept.id && w.status === 'Allocated').length;
    setDeptToDelete({ ...dept, allocatedCount });
    setShowDeleteConfirm(true);
  };

  const downloadDepartmentCsv = () => {
    const reportRows = filteredDepts.map((dept) => {
      const allocatedWalkies = walkies.filter(w => w.departmentId === dept.id && w.status === 'Allocated');
      const modelCounts = allocatedWalkies.reduce((acc, w) => {
        const model = w.model || 'Unknown';
        acc[model] = (acc[model] || 0) + 1;
        return acc;
      }, {});
      const modelList = Object.entries(modelCounts).sort((a, b) => b[1] - a[1]);
      const topModels = modelList.slice(0, 4);
      const otherCount = modelList.slice(4).reduce((sum, [, count]) => sum + count, 0);
      const modelLines = topModels.map(([model, count]) => `${model}: ${count}`);
      if (otherCount > 0) modelLines.push(`Other: ${otherCount}`);
      const modelField = modelLines.length > 0 ? modelLines.join('\n') : 'No allocated walkie talkies';
      return {
        name: dept.name,
        total: allocatedWalkies.length,
        models: modelField
      };
    });

    const escapeCsv = (value) => `"${String(value).replace(/"/g, '""')}"`;
    const headers = ['Department Name', 'Total Walkie Talkies', 'Walkie Model Breakdown'];
    const csvRows = [headers.map(escapeCsv).join(',')];

    reportRows.forEach((row) => {
      csvRows.push([
        escapeCsv(row.name),
        escapeCsv(row.total),
        escapeCsv(row.models)
      ].join(','));
    });

    const csvContent = csvRows.join('\r\n');
    const encodedUri = encodeURI('data:text/csv;charset=utf-8,' + csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `department_inventory_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const confirmDelete = async (force = false) => {
    const res = await deleteDepartment(deptToDelete.id, force);
    if (!res.error || force) {
      setShowDeleteConfirm(false);
      setDeptToDelete(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Department Management</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Organize radio allocations by teams or custom operational units.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={downloadDepartmentCsv}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-slate-800 hover:bg-slate-900 text-white shadow-lg shadow-slate-500/20"
          >
            Download CSV
          </button>
          <button
            onClick={() => {
              if (isClient) {
                addToast('Access Denied: Read-only guest accounts cannot add departments.', 'error');
                return;
              }
              setShowAddModal(true);
            }}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold shadow-lg transition-all
              ${isClient
                ? 'bg-slate-200 text-slate-400 dark:bg-slate-800 dark:text-slate-600 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-500/20'}`}
          >
            {isClient ? <Lock className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            Add Department
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <div className={`p-4 rounded-xl border flex items-center justify-between
        ${isDark ? 'bg-slate-950 border-slate-800' : 'bg-white border-slate-100 shadow-sm'}`}>
        <div className="relative w-full max-w-md">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search departments..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={`w-full pl-9 pr-4 py-2 text-sm rounded-xl border outline-none transition-all
              ${isDark ? 'bg-slate-900 border-slate-800 focus:border-blue-500' : 'bg-slate-50 border-slate-200 focus:bg-white focus:border-blue-500'}`}
          />
        </div>
      </div>

      {/* Department Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredDepts.length === 0 ? (
          <div className="col-span-full py-12 text-center text-slate-500">
            No departments found. Create one to start allocating radios.
          </div>
        ) : (
          filteredDepts.map((dept) => {
            const allocatedCount = walkies.filter(w => w.departmentId === dept.id && w.status === 'Allocated').length;
            return (
              <div
                key={dept.id}
                className={`p-6 rounded-xl border flex flex-col justify-between hover:shadow-lg transition-all duration-300
                  ${isDark ? 'bg-slate-950 border-slate-800' : 'bg-white border-slate-100 shadow-sm'}`}
              >
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div className="p-3 rounded-xl bg-blue-500/10 text-blue-500">
                      <Building2 className="w-6 h-6" />
                    </div>
                    <div className="flex gap-1">
                      {/* Edit Department Button */}
                      <button
                        onClick={() => {
                          if (isClient) {
                            addToast('Unauthorized: Clients cannot edit departments.', 'error');
                            return;
                          }
                          setEditingDept(dept);
                          setShowEditModal(true);
                        }}
                        className={`p-1.5 rounded-lg transition-all
                          ${isClient 
                            ? 'text-slate-300 dark:text-slate-750 cursor-not-allowed' 
                            : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-blue-500'}`}
                        title={isClient ? 'Locked' : 'Edit'}
                      >
                        {isClient ? <Lock className="w-3.5 h-3.5" /> : <Edit3 className="w-4.5 h-4.5" />}
                      </button>
                      
                      {/* Delete Department Button (Admin only) */}
                      <button
                        onClick={() => handleDeleteClick(dept)}
                        className={`p-1.5 rounded-lg transition-all
                          ${isAdmin 
                            ? 'hover:bg-slate-100 dark:hover:bg-slate-800 text-rose-500' 
                            : 'text-slate-300 dark:text-slate-700 cursor-not-allowed'}`}
                        title={isAdmin ? "Delete" : "Locked for Operators/Clients"}
                      >
                        {isAdmin ? <Trash2 className="w-4.5 h-4.5" /> : <Lock className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                  <h3 className="text-lg font-bold mb-1 tracking-tight">{dept.name}</h3>
                  {dept.channelNumber && (
                    <span className="inline-flex items-center gap-1 mb-2 px-2 py-0.5 rounded-md text-xs font-bold uppercase tracking-wider bg-blue-500/10 text-blue-500">
                      <Radio className="w-3 h-3" />
                      Channel {dept.channelNumber}
                    </span>
                  )}
                  <p className="text-xs text-slate-400 dark:text-slate-500 min-h-[32px] line-clamp-2">{dept.description || 'No description provided.'}</p>
                  {(() => {
                    const heads = departmentHeads.filter(h => h.departmentId === dept.id);
                    return heads.length > 0 ? (
                      <div className="mt-3 space-y-1">
                        {heads.map(h => (
                          <div key={h.id} className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                            <UserRound className="w-3 h-3 shrink-0" />
                            <span className="font-semibold truncate">{h.name}</span>
                            <span className="text-slate-400">· {h.mobileNumber}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-3 text-xs text-amber-500">No department head on file yet.</p>
                    );
                  })()}
                </div>

                <div className={`mt-6 pt-4 border-t flex items-center justify-between text-xs font-semibold
                  ${isDark ? 'border-slate-800' : 'border-slate-100'}`}>
                  <span className="text-slate-400">Allocated Radios</span>
                  <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold
                    ${allocatedCount > 0 
                      ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-400' 
                      : 'bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-400'}`}>
                    <Radio className="w-3.5 h-3.5" />
                    {allocatedCount} active
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Add Department Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className={`w-full max-w-md rounded-xl shadow-2xl p-6 transition-all ${isDark ? 'bg-slate-900 text-slate-100' : 'bg-white text-slate-800'}`}>
            <h3 className="text-lg font-bold mb-4">Add New Department</h3>
            <form onSubmit={handleAddSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Department Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Security Shift B"
                  value={newDept.name}
                  onChange={(e) => setNewDept({ ...newDept, name: e.target.value })}
                  className={`w-full p-2.5 rounded-xl border outline-none text-sm ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-slate-50 border-slate-200'}`}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Channel Number</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. CH-05"
                  value={newDept.channelNumber}
                  onChange={(e) => setNewDept({ ...newDept, channelNumber: e.target.value })}
                  className={`w-full p-2.5 rounded-xl border outline-none text-sm ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-slate-50 border-slate-200'}`}
                />
                <p className="text-xs text-slate-400 mt-1">Every radio allocated to this department will be set to this channel automatically.</p>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Description</label>
                <textarea
                  placeholder="Operational role, team leaders, or zone..."
                  value={newDept.description}
                  onChange={(e) => setNewDept({ ...newDept, description: e.target.value })}
                  className={`w-full p-2.5 rounded-xl border outline-none text-sm h-24 ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-slate-50 border-slate-200'}`}
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
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Department Modal */}
      {showEditModal && editingDept && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className={`w-full max-w-md rounded-xl shadow-2xl p-6 transition-all ${isDark ? 'bg-slate-900 text-slate-100' : 'bg-white text-slate-800'}`}>
            <h3 className="text-lg font-bold mb-4">Edit Department Details</h3>
            <form onSubmit={handleEditSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Department Name</label>
                <input
                  type="text"
                  required
                  value={editingDept.name}
                  onChange={(e) => setEditingDept({ ...editingDept, name: e.target.value })}
                  className={`w-full p-2.5 rounded-xl border outline-none text-sm ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-slate-50 border-slate-200'}`}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Channel Number</label>
                <input
                  type="text"
                  required
                  value={editingDept.channelNumber || ''}
                  onChange={(e) => setEditingDept({ ...editingDept, channelNumber: e.target.value })}
                  className={`w-full p-2.5 rounded-xl border outline-none text-sm ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-slate-50 border-slate-200'}`}
                />
                <p className="text-xs text-slate-400 mt-1">Changing this updates every radio currently allocated to this department.</p>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Description</label>
                <textarea
                  value={editingDept.description}
                  onChange={(e) => setEditingDept({ ...editingDept, description: e.target.value })}
                  className={`w-full p-2.5 rounded-xl border outline-none text-sm h-24 ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-slate-50 border-slate-200'}`}
                />
              </div>

              {/* Department Heads Management */}
              <div className={`pt-4 border-t ${isDark ? 'border-slate-800' : 'border-slate-100'}`}>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                  Department Heads <span className="normal-case font-normal">(can have more than one, editable any time)</span>
                </label>

                <div className="space-y-2 mb-3">
                  {departmentHeads.filter(h => h.departmentId === editingDept.id).map(head => (
                    <div key={head.id} className={`p-2.5 rounded-xl border flex items-center gap-2 ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
                      {editingHeadId === head.id ? (
                        <>
                          <UserRound className="w-4 h-4 text-slate-400 shrink-0" />
                          <input
                            type="text"
                            value={editingHeadName}
                            onChange={(e) => setEditingHeadName(e.target.value)}
                            className={`flex-1 min-w-0 p-1.5 rounded-lg border outline-none text-xs ${isDark ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-200'}`}
                          />
                          <Phone className="w-4 h-4 text-slate-400 shrink-0" />
                          <input
                            type="text"
                            value={editingHeadMobile}
                            onChange={(e) => setEditingHeadMobile(e.target.value)}
                            className={`w-32 shrink-0 p-1.5 rounded-lg border outline-none text-xs ${isDark ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-200'}`}
                          />
                          <button type="button" onClick={handleSaveHeadEdit} className="text-xs font-bold text-emerald-500 shrink-0">Save</button>
                          <button type="button" onClick={() => setEditingHeadId(null)} className="text-xs font-bold text-slate-400 shrink-0">Cancel</button>
                        </>
                      ) : (
                        <>
                          <UserRound className="w-4 h-4 text-blue-500 shrink-0" />
                          <span className="flex-1 min-w-0 text-xs font-semibold truncate">{head.name}</span>
                          <span className="text-xs text-slate-400 shrink-0">{head.mobileNumber}</span>
                          <button type="button" onClick={() => startEditHead(head)} className="p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 shrink-0">
                            <Edit3 className="w-3.5 h-3.5 text-blue-500" />
                          </button>
                          <button type="button" onClick={() => deleteDepartmentHead(head.id)} className="p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 shrink-0">
                            <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                  {departmentHeads.filter(h => h.departmentId === editingDept.id).length === 0 && (
                    <p className="text-xs text-slate-400">No heads added yet.</p>
                  )}
                </div>

                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Head name"
                    value={newHeadName}
                    onChange={(e) => setNewHeadName(e.target.value)}
                    className={`flex-1 min-w-0 p-2 rounded-xl border outline-none text-xs ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-slate-50 border-slate-200'}`}
                  />
                  <input
                    type="text"
                    placeholder="Mobile number"
                    value={newHeadMobile}
                    onChange={(e) => setNewHeadMobile(e.target.value)}
                    className={`w-32 shrink-0 p-2 rounded-xl border outline-none text-xs ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-slate-50 border-slate-200'}`}
                  />
                  <button
                    type="button"
                    onClick={handleAddHead}
                    className="shrink-0 px-3 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    Add
                  </button>
                </div>
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

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && deptToDelete && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className={`w-full max-w-md rounded-xl shadow-2xl p-6 transition-all ${isDark ? 'bg-slate-900 text-slate-100' : 'bg-white text-slate-800'}`}>
            <div className="flex items-center gap-3 text-amber-500 mb-4">
              <AlertTriangle className="w-8 h-8 shrink-0" />
              <h3 className="text-lg font-bold">Confirm Department Deletion</h3>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
              Are you sure you want to delete <span className="font-bold text-slate-800 dark:text-slate-200">"{deptToDelete.name}"</span>?
            </p>

            {deptToDelete.allocatedCount > 0 ? (
              <div className="p-4 bg-rose-500/10 text-rose-600 rounded-xl text-xs space-y-2 mb-6">
                <p className="font-bold">Warning: Active Allocations</p>
                <p>This department currently has {deptToDelete.allocatedCount} walkies allocated to it.</p>
                <p>Deleting will automatically return these walkie talkies to the available pool.</p>
              </div>
            ) : (
              <p className="text-xs text-slate-400 mb-6">This department has no active allocations. Deletion is safe.</p>
            )}

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => { setShowDeleteConfirm(false); setDeptToDelete(null); }}
                className="px-4 py-2 text-sm font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"
              >
                Cancel
              </button>
              {deptToDelete.allocatedCount > 0 ? (
                <button
                  type="button"
                  onClick={() => confirmDelete(true)}
                  className="px-4 py-2 text-sm font-semibold bg-rose-600 text-white rounded-xl hover:bg-rose-700"
                >
                  Force Delete & Return Radios
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => confirmDelete(false)}
                  className="px-4 py-2 text-sm font-semibold bg-rose-600 text-white rounded-xl hover:bg-rose-700"
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
