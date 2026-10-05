import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import {
  RotateCcw,
  Building2,
  Radio,
  CheckSquare,
  Square,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  Lock,
  MessageCircle,
  X
} from 'lucide-react';

export default function ReturnsView() {
  const {
    walkies,
    departments,
    returnWalkies,
    getWhatsAppLinksForDepartment,
    settings,
    currentUser,
    addToast
  } = useApp();

  const isDark = settings.theme === 'dark';
  const isClient = currentUser?.role === 'Client';

  // Accordion open/close state
  const [openDepts, setOpenDepts] = useState({});
  const [sortBy, setSortBy] = useState('name');
  
  // Selected Walkies for return
  const [selectedToReturn, setSelectedToReturn] = useState([]);

  const collator = useMemo(() => new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }), []);
  const compareWalkies = (a, b) => {
    switch (sortBy) {
      case 'id':
        return collator.compare(a.id || '', b.id || '');
      case 'serial':
        return collator.compare(a.serial || '', b.serial || '');
      case 'name':
      default:
        return collator.compare(a.label || '', b.label || '');
    }
  };

  const sortedDepartments = useMemo(
    () => [...departments].sort((a, b) => collator.compare(a.name || '', b.name || '')),
    [departments, collator]
  );
  
  // Confirmation Modal
  const [showConfirm, setShowConfirm] = useState(false);
  const [returnRemarks, setReturnRemarks] = useState('');
  const [bulkReturnMode, setBulkReturnMode] = useState(false);
  const [targetDeptId, setTargetDeptId] = useState(null);

  // WhatsApp send panel — shown right after a return is confirmed
  const [whatsappPanel, setWhatsappPanel] = useState(null); // { title, links: [] }

  const toggleDept = (id) => {
    setOpenDepts(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleSelectWalkie = (id) => {
    if (isClient) {
      addToast('Client Mode: Checkboxes are read-only.', 'info');
      return;
    }
    if (selectedToReturn.includes(id)) {
      setSelectedToReturn(prev => prev.filter(item => item !== id));
    } else {
      setSelectedToReturn(prev => [...prev, id]);
    }
  };

  const handleReturnSelectedClick = () => {
    if (isClient) return;
    if (selectedToReturn.length === 0) return;
    setBulkReturnMode(false);
    setShowConfirm(true);
  };

  const handleReturnAllClick = (deptId) => {
    if (isClient) return;
    const deptWalkieIds = walkies
      .filter(w => w.departmentId === deptId && w.status === 'Allocated')
      .map(w => w.id);
    
    if (deptWalkieIds.length === 0) return;
    
    setTargetDeptId(deptId);
    setSelectedToReturn(deptWalkieIds);
    setBulkReturnMode(true);
    setShowConfirm(true);
  };

  const confirmReturn = async () => {
    // Capture which department(s) these walkies belong to BEFORE they're
    // returned (returning clears each walkie's departmentId).
    const countsByDept = {};
    selectedToReturn.forEach((id) => {
      const w = walkies.find(x => x.id === id);
      if (w && w.departmentId) {
        countsByDept[w.departmentId] = (countsByDept[w.departmentId] || 0) + 1;
      }
    });

    const success = await returnWalkies(selectedToReturn, returnRemarks);
    if (success) {
      setSelectedToReturn([]);
      setReturnRemarks('');
      setShowConfirm(false);
      setTargetDeptId(null);

      // Build WhatsApp notices for every department head involved in this return.
      const links = Object.entries(countsByDept).flatMap(([deptId, count]) => {
        const dept = departments.find(d => d.id === deptId);
        const deptName = dept ? dept.name : 'Unknown Department';
        const message = `Return notice: ${count} walkie talkie(s) have been returned by ${deptName}${returnRemarks ? `. Remarks: ${returnRemarks}` : ''}.`;
        return getWhatsAppLinksForDepartment(deptId, message);
      });
      if (links.length > 0) {
        setWhatsappPanel({ title: 'Notify department head(s) about this return', links });
      }
    }
  };

  return (
    <div className="space-y-6 relative">
      
      {/* Read-Only Client Overlay Lock */}
      {isClient && (
        <div className="absolute inset-0 bg-slate-100/50 dark:bg-slate-900/60 backdrop-blur-[1px] rounded-xl z-30 flex flex-col items-center justify-center p-6 text-center">
          <Lock className="w-12 h-12 text-blue-500 mb-2 animate-bounce" />
          <h4 className="font-bold text-lg">Returns Panel Locked</h4>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs mt-1">
            Your current Client account is authorized for read-only tracking. Only Administrators and Operators can process returns.
          </p>
        </div>
      )}

      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Return Walkie Talkies</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Manage check-ins, return single or multiple devices, and clean active logs.</p>
        </div>
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <label className="text-sm font-medium text-slate-500 dark:text-slate-400 flex items-center gap-2">
            <span>Sort by</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className={`rounded-lg border px-3 py-2 text-sm outline-none ${isDark ? 'bg-slate-900 border-slate-800 text-slate-100' : 'bg-white border-slate-200 text-slate-700'}`}
            >
              <option value="name">Name</option>
              <option value="id">Walkie ID</option>
              <option value="serial">Serial</option>
            </select>
          </label>
          {selectedToReturn.length > 0 && !isClient && (
            <button
              onClick={handleReturnSelectedClick}
              className="flex items-center gap-2 bg-rose-600 hover:bg-rose-700 text-white px-5 py-2.5 rounded-xl text-sm font-bold transition-all shadow-lg shadow-rose-500/20"
            >
              <RotateCcw className="w-4 h-4" />
              Return Selected ({selectedToReturn.length})
            </button>
          )}
        </div>
      </div>

      {/* Expandable Department Accordions */}
      <div className="space-y-4">
        {sortedDepartments.map((dept) => {
          const deptWalkies = [...walkies.filter(w => w.departmentId === dept.id && w.status === 'Allocated')].sort(compareWalkies);
          const isOpen = !!openDepts[dept.id];

          return (
            <div
              key={dept.id}
              className={`border rounded-xl overflow-hidden transition-all duration-300
                ${isDark ? 'bg-slate-950 border-slate-800' : 'bg-white border-slate-100 shadow-sm'}`}
            >
              {/* Accordion Header */}
              <div 
                onClick={() => toggleDept(dept.id)}
                className={`p-5 flex items-center justify-between cursor-pointer select-none transition-colors
                  ${isDark ? 'hover:bg-slate-900/40' : 'hover:bg-slate-50/50'}`}
              >
                <div className="flex items-center gap-4">
                  <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-500">
                    <Building2 className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-base">{dept.name}</h3>
                    <p className="text-xs text-slate-400">{deptWalkies.length} active allocations</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {deptWalkies.length > 0 && !isClient && (() => {
                    const selectedInDept = deptWalkies.filter(w => selectedToReturn.includes(w.id)).map(w => w.id);
                    const buttonLabel = selectedInDept.length > 0 ? `Return Selected (${selectedInDept.length})` : 'Return All';
                    return (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (selectedInDept.length > 0) {
                            setSelectedToReturn(selectedInDept);
                            setBulkReturnMode(false);
                            setTargetDeptId(null);
                            setShowConfirm(true);
                          } else {
                            handleReturnAllClick(dept.id);
                          }
                        }}
                        className="text-xs font-bold text-rose-500 hover:bg-rose-500/10 px-3 py-1.5 rounded-lg transition-all border border-rose-500/20"
                      >
                        {buttonLabel}
                      </button>
                    );
                  })()}
                  {isOpen ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
                </div>
              </div>

              {/* Accordion Content */}
              {isOpen && (
                <div className={`p-5 border-t divide-y divide-slate-100 dark:divide-slate-850 bg-slate-50/30 dark:bg-slate-900/10
                  ${isDark ? 'border-slate-850' : 'border-slate-100'}`}>
                  {deptWalkies.length === 0 ? (
                    <p className="text-sm text-slate-500 text-center py-4">No walkie talkies currently allocated to this department.</p>
                  ) : (
                    <div className="space-y-3">
                      {deptWalkies.map((w) => {
                        const isChecked = selectedToReturn.includes(w.id);
                        return (
                          <div 
                            key={w.id}
                            onClick={() => handleSelectWalkie(w.id)}
                            className={`p-3 rounded-xl border flex items-center justify-between cursor-pointer transition-all
                              ${isChecked 
                                ? 'border-rose-500/40 bg-rose-500/5 text-rose-950 dark:text-rose-200' 
                                : 'border-slate-100 dark:border-slate-850 hover:bg-slate-100/50 dark:hover:bg-slate-900/50 text-slate-700 dark:text-slate-300'}`}
                          >
                            <div className="flex items-center gap-3">
                              {isChecked ? (
                                <CheckSquare className="w-5 h-5 text-rose-500 shrink-0" />
                              ) : (
                                <Square className="w-5 h-5 text-slate-300 dark:text-slate-600 shrink-0" />
                              )}
                              <div>
                                <p className="font-semibold text-sm">{w.id} - {w.label}</p>
                                <p className="text-xs text-slate-400 font-mono">Serial: {w.serial}</p>
                              </div>
                            </div>
                            <div className="text-right text-xs">
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-400">
                                <Radio className="w-3 h-3" />
                                Allocated
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Confirmation Modal */}
      {showConfirm && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className={`w-full max-w-md rounded-xl shadow-2xl p-6 transition-all ${isDark ? 'bg-slate-900 text-slate-100' : 'bg-white text-slate-800'}`}>
            <div className="flex items-center gap-3 text-rose-500 mb-4">
              <ShieldAlert className="w-8 h-8 shrink-0" />
              <h3 className="text-lg font-bold">Confirm Return Action</h3>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
              You are about to return <span className="font-bold text-slate-800 dark:text-slate-100">{selectedToReturn.length}</span> walkie talkie(s) to the available stock pool.
            </p>

            <div className="mb-6">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">Return Remarks (Optional)</label>
              <input
                type="text"
                placeholder="e.g. Returned clean, battery fully functional"
                value={returnRemarks}
                onChange={(e) => setReturnRemarks(e.target.value)}
                className={`w-full p-2.5 rounded-xl border outline-none text-sm ${isDark ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-slate-50 border-slate-200 text-slate-800'}`}
              />
            </div>

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => { setShowConfirm(false); setSelectedToReturn([]); setReturnRemarks(''); }}
                className="px-4 py-2 text-sm font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmReturn}
                className="px-4 py-2 text-sm font-semibold bg-rose-600 text-white rounded-xl hover:bg-rose-700"
              >
                Confirm Check-in
              </button>
            </div>
          </div>
        </div>
      )}

      {/* WhatsApp Send Panel */}
      {whatsappPanel && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className={`w-full max-w-md rounded-xl shadow-2xl p-6 ${isDark ? 'bg-slate-900 text-slate-100' : 'bg-white text-slate-800'}`}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold flex items-center gap-2">
                <MessageCircle className="w-5 h-5 text-emerald-500" />
                Send Notice
              </h3>
              <button onClick={() => setWhatsappPanel(null)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-400 mb-4">{whatsappPanel.title}</p>
            <div className="space-y-2">
              {whatsappPanel.links.map(link => (
                <a
                  key={link.id}
                  href={link.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between p-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold"
                >
                  <span>{link.name} ({link.mobileNumber})</span>
                  <MessageCircle className="w-4 h-4" />
                </a>
              ))}
            </div>
            <div className="flex justify-end pt-4">
              <button onClick={() => setWhatsappPanel(null)} className="px-4 py-2 text-sm font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl">Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
