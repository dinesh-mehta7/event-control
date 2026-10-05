import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import {
  Send,
  Radio,
  CheckCircle,
  Printer,
  ArrowRightLeft,
  Lock,
  Hash,
  ListChecks,
  Search,
  PackageCheck,
  Users,
  Building2,
  X
} from 'lucide-react';

export default function AllocationsView() {
  const {
    walkies,
    departments,
    allocations,
    allocateWalkies,
    availableChargers,
    availableEarphones,
    allocateByCount,
    transferWalkie,
    settings,
    currentUser,
    addToast
  } = useApp();

  const isDark = settings.theme === 'dark';
  const isClient = currentUser?.role === 'Client';

  // Allocation mode: 'pick' (choose individual units) or 'count' (bulk allocate by quantity)
  const [allocMode, setAllocMode] = useState('pick');

  // Shared Allocation Form State
  const [selectedDept, setSelectedDept] = useState('');
  const [selectedWalkies, setSelectedWalkies] = useState([]);
  const [allocatedBy, setAllocatedBy] = useState(currentUser?.name || '');
  const [remarks, setRemarks] = useState('');
  const [holderName, setHolderName] = useState('');
  const [holderContact, setHolderContact] = useState('');
  const [chargers, setChargers] = useState(0);
  const [earphones, setEarphones] = useState(0);
  const [pickSearch, setPickSearch] = useState('');

  // Bulk-by-number State
  const [bulkModel, setBulkModel] = useState('');
  const [bulkCount, setBulkCount] = useState(1);

  // Transfer Form States
  const [transferWalkieId, setTransferWalkieId] = useState('');
  const [transferTargetDept, setTransferTargetDept] = useState('');
  const [transferRemarks, setTransferRemarks] = useState('');
  const [transferSearch, setTransferSearch] = useState('');
  const [transferChargers, setTransferChargers] = useState(0);
  const [transferEarphones, setTransferEarphones] = useState(0);

  // Print Slip State
  const [showSlip, setShowSlip] = useState(false);
  const [lastAllocatedRecord, setLastAllocatedRecord] = useState(null);

  const availableWalkies = walkies.filter(w => w.status === 'Available');
  const allocatedWalkies = walkies.filter(w => w.status === 'Allocated');

  const collator = useMemo(() => new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }), []);
  const compareByName = (a, b) => collator.compare(a.label || '', b.label || '');
  const sortedAvailableWalkies = useMemo(() => [...availableWalkies].sort(compareByName), [availableWalkies, collator]);

  const availableModels = useMemo(
    () => [...new Set(availableWalkies.map(w => w.model))].sort(),
    [availableWalkies]
  );

  const matchingForBulk = useMemo(
    () => sortedAvailableWalkies.filter(w => !bulkModel || w.model === bulkModel),
    [sortedAvailableWalkies, bulkModel]
  );

  const filteredPickList = useMemo(() => {
    const term = pickSearch.toLowerCase();
    return sortedAvailableWalkies.filter(w =>
      w.id.toLowerCase().includes(term) ||
      w.label.toLowerCase().includes(term) ||
      (w.serial || '').toLowerCase().includes(term) ||
      w.model.toLowerCase().includes(term)
    );
  }, [sortedAvailableWalkies, pickSearch]);

  const filteredTransferWalkies = useMemo(() => {
    const term = transferSearch.toLowerCase();
    return allocatedWalkies.filter(w => {
      const currentDept = departments.find(d => d.id === w.departmentId);
      return (
        w.id.toLowerCase().includes(term) ||
        w.label.toLowerCase().includes(term) ||
        (w.serial || '').toLowerCase().includes(term) ||
        (currentDept?.name || '').toLowerCase().includes(term)
      );
    });
  }, [allocatedWalkies, departments, transferSearch]);

  // The allocation batch the selected radio currently belongs to — this is
  // where transferred chargers / earphones are taken from.
  const transferSourceAlloc = useMemo(
    () => (transferWalkieId
      ? allocations.find(a => a.status === 'Active' && a.walkieIds.includes(transferWalkieId))
      : null),
    [allocations, transferWalkieId]
  );
  const heldChargers = transferSourceAlloc?.chargerCount || 0;
  const heldEarphones = transferSourceAlloc?.earphoneCount || 0;
  const isLastInBatch = !!transferSourceAlloc && transferSourceAlloc.walkieIds.length === 1;
  const leftoverChargers = Math.max(0, heldChargers - (Number(transferChargers) || 0));
  const leftoverEarphones = Math.max(0, heldEarphones - (Number(transferEarphones) || 0));
  const transferAccessoriesValid =
    (Number(transferChargers) || 0) >= 0 && (Number(transferChargers) || 0) <= heldChargers &&
    (Number(transferEarphones) || 0) >= 0 && (Number(transferEarphones) || 0) <= heldEarphones;

  const selectTransferWalkie = (id) => {
    setTransferWalkieId(id);
    setTransferChargers(0);
    setTransferEarphones(0);
  };

  const resetSharedFields = () => {
    setSelectedWalkies([]);
    setRemarks('');
    setHolderName('');
    setHolderContact('');
    setChargers(0);
    setEarphones(0);
    setBulkCount(1);
    setBulkModel('');
    setPickSearch('');
  };

  const handleAllocationSubmit = async (e) => {
    e.preventDefault();
    if (isClient) {
      addToast('Access Denied: Clients cannot allocate radios.', 'error');
      return;
    }

    let record;
    if (allocMode === 'count') {
      record = await allocateByCount(selectedDept, Number(bulkCount), allocatedBy, remarks, holderName, holderContact, bulkModel, chargers, earphones);
    } else {
      record = await allocateWalkies(selectedDept, selectedWalkies, allocatedBy, remarks, holderName, holderContact, chargers, earphones);
    }

    if (record) {
      setLastAllocatedRecord(record);
      setShowSlip(true);
      resetSharedFields();
    }
  };

  const handleTransferSubmit = async (e) => {
    e.preventDefault();
    if (isClient) {
      addToast('Access Denied: Clients cannot transfer radios.', 'error');
      return;
    }
    const success = await transferWalkie(
      transferWalkieId,
      transferTargetDept,
      transferRemarks,
      Number(transferChargers) || 0,
      Number(transferEarphones) || 0
    );
    if (success) {
      setTransferWalkieId('');
      setTransferTargetDept('');
      setTransferRemarks('');
      setTransferChargers(0);
      setTransferEarphones(0);
    }
  };

  const handleWalkieSelect = (id) => {
    setSelectedWalkies(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]);
  };

  const getWalkieDisplayName = (walkie) => {
    return walkie?.label?.trim() || walkie?.id?.trim() || 'Untitled walkie';
  };

  const getWalkieDetailLine = (walkie) => {
    return walkie?.model?.trim() || '';
  };

  const getWalkieSerialLine = (walkie) => {
    return walkie?.serial?.trim() ? `S/N ${walkie.serial.trim()}` : '';
  };

  const handleSelectAllFiltered = () => {
    const filteredIds = filteredPickList.map(w => w.id);

    setSelectedWalkies(prev => {
      const selectedSet = new Set(prev);
      const allVisibleSelected = filteredIds.every(id => selectedSet.has(id));

      if (allVisibleSelected) {
        filteredIds.forEach(id => selectedSet.delete(id));
      } else {
        filteredIds.forEach(id => selectedSet.add(id));
      }

      return Array.from(selectedSet);
    });
  };

  const inputCls = `w-full p-2.5 rounded-xl border outline-none text-sm ${isDark ? 'bg-slate-900 border-slate-800' : 'bg-slate-50 border-slate-200'}`;
  const labelCls = 'block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5';

  const canSubmitAllocation = allocMode === 'count'
    ? selectedDept && Number(bulkCount) > 0 && Number(bulkCount) <= matchingForBulk.length
    : selectedDept && selectedWalkies.length > 0;

  return (
    <div className="space-y-8 relative">

      {/* Read-Only Client Overlay Lock */}
      {isClient && (
        <div className="absolute inset-0 bg-slate-100/50 dark:bg-slate-900/60 backdrop-blur-[1px] rounded-xl z-30 flex flex-col items-center justify-center p-6 text-center">
          <Lock className="w-12 h-12 text-blue-500 mb-2 animate-bounce" />
          <h4 className="font-bold text-lg">Allocations Panel Locked</h4>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs mt-1">
            Your current Client account is authorized for read-only tracking. Only Administrators and Operators can dispatch assets.
          </p>
        </div>
      )}

      <div>
        <h1 className="text-2xl font-bold tracking-tight">Allocate & Dispatch Radios</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Assign walkie talkies to a department individually or in bulk by quantity, or transfer active units.</p>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className={`p-3.5 rounded-xl border ${isDark ? 'bg-slate-950 border-slate-800' : 'bg-white border-slate-100 shadow-sm'}`}>
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 uppercase tracking-wider">
            <PackageCheck className="w-3.5 h-3.5 text-emerald-500" /> Available
          </div>
          <p className="text-2xl font-bold mt-1">{availableWalkies.length}</p>
        </div>
        <div className={`p-3.5 rounded-xl border ${isDark ? 'bg-slate-950 border-slate-800' : 'bg-white border-slate-100 shadow-sm'}`}>
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 uppercase tracking-wider">
            <Radio className="w-3.5 h-3.5 text-blue-500" /> Allocated
          </div>
          <p className="text-2xl font-bold mt-1">{allocatedWalkies.length}</p>
        </div>
        <div className={`p-3.5 rounded-xl border ${isDark ? 'bg-slate-950 border-slate-800' : 'bg-white border-slate-100 shadow-sm'}`}>
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 uppercase tracking-wider">
            <Building2 className="w-3.5 h-3.5 text-blue-500" /> Departments
          </div>
          <p className="text-2xl font-bold mt-1">{departments.length}</p>
        </div>
        <div className={`p-3.5 rounded-xl border ${isDark ? 'bg-slate-950 border-slate-800' : 'bg-white border-slate-100 shadow-sm'}`}>
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 uppercase tracking-wider">
            <Users className="w-3.5 h-3.5 text-amber-500" /> Currently Held
          </div>
          <p className="text-2xl font-bold mt-1">{walkies.filter(w => w.assignedPerson?.name).length}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

        {/* New Allocation Panel */}
        <div className={`p-6 rounded-xl border flex flex-col justify-between
          ${isDark ? 'bg-slate-950 border-slate-800' : 'bg-white border-slate-100 shadow-sm'}`}>
          <div>
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2 text-blue-600">
              <Send className="w-5 h-5" />
              New Allocation Dispatch
            </h2>

            {/* Mode Toggle */}
            <div className={`flex p-1 rounded-xl mb-4 ${isDark ? 'bg-slate-900' : 'bg-slate-100'}`}>
              <button
                type="button"
                onClick={() => setAllocMode('pick')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold transition-all
                  ${allocMode === 'pick' ? 'bg-blue-600 text-white shadow' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
              >
                <ListChecks className="w-3.5 h-3.5" />
                Pick Individually
              </button>
              <button
                type="button"
                onClick={() => setAllocMode('count')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold transition-all
                  ${allocMode === 'count' ? 'bg-blue-600 text-white shadow' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
              >
                <Hash className="w-3.5 h-3.5" />
                Bulk by Number
              </button>
            </div>

            <form onSubmit={handleAllocationSubmit} className="space-y-4">
              <div>
                <label className={labelCls}>Target Department</label>
                <select
                  required
                  disabled={isClient}
                  value={selectedDept}
                  onChange={(e) => setSelectedDept(e.target.value)}
                  className={`${inputCls} ${isDark ? 'text-slate-100' : ''}`}
                >
                  <option value="">-- Select Department --</option>
                  {departments.map(d => (
                    <option key={d.id} value={d.id}>{d.name}{d.channelNumber ? ` — Channel ${d.channelNumber}` : ''}</option>
                  ))}
                </select>
              </div>

              {selectedDept && (
                <div className="p-3 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 text-xs font-semibold flex items-center gap-2">
                  <Radio className="w-4 h-4" />
                  Selected radios will be set to Channel {departments.find(d => d.id === selectedDept)?.channelNumber || 'N/A'}
                </div>
              )}

              {allocMode === 'count' ? (
                <div className="space-y-4">
                  <div>
                    <label className={labelCls}>Model Filter (Optional)</label>
                    <select
                      disabled={isClient}
                      value={bulkModel}
                      onChange={(e) => { setBulkModel(e.target.value); setBulkCount(1); }}
                      className={`${inputCls} ${isDark ? 'text-slate-100' : ''}`}
                    >
                      <option value="">Any model</option>
                      {availableModels.map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>
                      Quantity to Allocate ({matchingForBulk.length} available)
                    </label>
                    {matchingForBulk.length === 0 ? (
                      <div className="p-4 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs">
                        No available walkies match that model. Return some units or pick another model.
                      </div>
                    ) : (
                      <input
                        type="number"
                        min="1"
                        max={matchingForBulk.length}
                        required
                        disabled={isClient}
                        value={bulkCount}
                        onChange={(e) => setBulkCount(e.target.value)}
                        className={inputCls}
                      />
                    )}
                    <p className="text-xs text-slate-400 mt-1">
                      The system automatically picks the oldest {Number(bulkCount) || 0} available units{bulkModel ? ` of ${bulkModel}` : ''} — no need to select each one by hand.
                    </p>
                  </div>
                </div>
              ) : (
                <div>
                  <label className={labelCls}>
                    Select Available Walkies ({selectedWalkies.length} selected of {availableWalkies.length})
                  </label>
                  {availableWalkies.length === 0 ? (
                    <div className="p-4 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs">
                      No available walkies left in inventory. Return some units first!
                    </div>
                  ) : (
                    <>
                      <div className="relative mb-2">
                        <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                        <input
                          type="text"
                          placeholder="Filter available units..."
                          value={pickSearch}
                          onChange={(e) => setPickSearch(e.target.value)}
                          className={`w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border outline-none ${isDark ? 'bg-slate-900 border-slate-800' : 'bg-slate-50 border-slate-200'}`}
                        />
                      </div>
                      <div className="flex items-center gap-2 mb-2 px-0.5">
                        <input
                          type="checkbox"
                          id="select-all-visible"
                          disabled={isClient || filteredPickList.length === 0}
                          checked={filteredPickList.length > 0 && filteredPickList.every(w => selectedWalkies.includes(w.id))}
                          onChange={handleSelectAllFiltered}
                          className="rounded text-blue-600 focus:ring-blue-500 h-4 w-4"
                        />
                        <label htmlFor="select-all-visible" className="text-xs font-semibold text-slate-600 dark:text-slate-300 cursor-pointer">
                          Select all
                        </label>
                        <span className="ml-auto text-xs text-slate-400">
                          {filteredPickList.length} visible
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 max-h-44 overflow-y-auto border p-3 rounded-xl dark:border-slate-800">
                        {filteredPickList.map(w => (
                          <label
                            key={w.id}
                            className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors text-xs font-semibold
                              ${selectedWalkies.includes(w.id)
                                ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                                : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500'}`}
                          >
                            <input
                              type="checkbox"
                              disabled={isClient}
                              checked={selectedWalkies.includes(w.id)}
                              onChange={() => handleWalkieSelect(w.id)}
                              className="rounded text-blue-600 focus:ring-blue-500 h-4 w-4"
                            />
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-bold text-slate-700 dark:text-slate-200">{getWalkieDisplayName(w)}</p>
                              {getWalkieSerialLine(w) ? (
                                <p className="text-xs font-mono text-slate-400 mt-0.5 truncate">{getWalkieSerialLine(w)}</p>
                              ) : null}
                              {getWalkieDetailLine(w) ? (
                                <p className="text-xs text-slate-400 truncate">{getWalkieDetailLine(w)}</p>
                              ) : null}
                            </div>
                          </label>
                        ))}
                        {filteredPickList.length === 0 && (
                          <p className="col-span-2 text-center text-xs text-slate-400 py-4">No matches for "{pickSearch}"</p>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}

              <div>
                <label className={labelCls}>Authorized Allocator Name</label>
                <input
                  type="text"
                  required
                  disabled={isClient}
                  value={allocatedBy}
                  onChange={(e) => setAllocatedBy(e.target.value)}
                  className={inputCls}
                />
              </div>

              <div>
                <label className={labelCls}>Accessories</label>
                <div className="grid grid-cols-2 gap-3">
                  <input type="number" min="0" max={Math.max(0, availableChargers)} disabled={isClient} value={chargers}
                    onChange={(e) => setChargers(e.target.value)} className={inputCls} placeholder="Chargers" />
                  <input type="number" min="0" max={Math.max(0, availableEarphones)} disabled={isClient} value={earphones}
                    onChange={(e) => setEarphones(e.target.value)} className={inputCls} placeholder="Earphones" />
                </div>
                <p className="text-xs text-slate-400 mt-1">Chargers available: {availableChargers} · Earphones available: {availableEarphones}</p>
              </div>

              <div>
                <label className={labelCls}>Assign to Person (Optional)</label>
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="text"
                    disabled={isClient}
                    placeholder="Holder name"
                    value={holderName}
                    onChange={(e) => setHolderName(e.target.value)}
                    className={inputCls}
                  />
                  <input
                    type="text"
                    disabled={isClient}
                    placeholder="Contact (optional)"
                    value={holderContact}
                    onChange={(e) => setHolderContact(e.target.value)}
                    className={inputCls}
                  />
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  {allocMode === 'count'
                    ? 'Applies to every radio in this batch. For per-person tracking on a bulk batch, assign individually afterward from the Walkies page.'
                    : 'Applies to every radio selected above. You can also assign radios to people individually from the Walkies page.'}
                </p>
              </div>

              <div>
                <label className={labelCls}>Remarks</label>
                <input
                  type="text"
                  disabled={isClient}
                  placeholder="e.g. For outdoor concert event shift"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  className={inputCls}
                />
              </div>

              <button
                type="submit"
                disabled={!canSubmitAllocation || isClient}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-lg shadow-blue-500/20 disabled:opacity-50 disabled:shadow-none transition-all text-sm flex items-center justify-center gap-2"
              >
                <CheckCircle className="w-4 h-4" />
                {allocMode === 'count' && Number(bulkCount) > 0
                  ? `Confirm & Dispatch ${bulkCount} Radio${Number(bulkCount) === 1 ? '' : 's'}`
                  : 'Confirm & Dispatch'}
              </button>
            </form>
          </div>
        </div>

        {/* Transfer Radios Panel */}
        <div className={`p-6 rounded-xl border flex flex-col justify-between
          ${isDark ? 'bg-slate-950 border-slate-800' : 'bg-white border-slate-100 shadow-sm'}`}>
          <div>
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2 text-blue-600">
              <ArrowRightLeft className="w-5 h-5" />
              Transfer Active Radio
            </h2>
            <p className="text-xs text-slate-400 mb-4">Shift an active walkie talkie — and, if needed, some of its chargers and earphones — directly to another department without returning it first.</p>

            <form onSubmit={handleTransferSubmit} className="space-y-4">
              <div>
                <label className={labelCls}>Select Active Walkie</label>
                <div className="relative mb-2">
                  <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search active radios..."
                    value={transferSearch}
                    onChange={(e) => setTransferSearch(e.target.value)}
                    disabled={isClient}
                    className={`w-full pl-8 pr-3 py-2 text-sm rounded-lg border outline-none ${isDark ? 'bg-slate-900 border-slate-800 text-slate-100' : 'bg-slate-50 border-slate-200 text-slate-700'}`}
                  />
                </div>
                <div className="max-h-44 overflow-y-auto border rounded-xl p-2 space-y-2 dark:border-slate-800">
                  {filteredTransferWalkies.length === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-3">
                      {transferSearch ? `No active radios match "${transferSearch}"` : 'No active radios available for transfer'}
                    </p>
                  ) : (
                    filteredTransferWalkies.map(w => {
                      const currentDept = departments.find(d => d.id === w.departmentId);
                      const isSelected = transferWalkieId === w.id;
                      return (
                        <button
                          key={w.id}
                          type="button"
                          disabled={isClient}
                          onClick={() => selectTransferWalkie(w.id)}
                          className={`w-full text-left p-2.5 rounded-lg border transition-colors ${isSelected
                            ? 'border-blue-500 bg-blue-500/10 text-blue-700 dark:text-blue-400'
                            : 'border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-900 text-slate-700 dark:text-slate-300'}`}
                        >
                          <div className="font-semibold text-sm">{getWalkieDisplayName(w)}</div>
                          {getWalkieSerialLine(w) ? (
                            <div className="text-xs font-mono text-slate-400 mt-0.5">{getWalkieSerialLine(w)}</div>
                          ) : null}
                          <div className="text-xs text-slate-400 mt-0.5">
                            {currentDept ? currentDept.name : 'Unknown'}{w.channel ? ` • CH ${w.channel}` : ''}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              <div>
                <label className={labelCls}>Target Department</label>
                <select
                  required
                  disabled={isClient}
                  value={transferTargetDept}
                  onChange={(e) => setTransferTargetDept(e.target.value)}
                  className={`${inputCls} ${isDark ? 'text-slate-100' : ''}`}
                >
                  <option value="">-- Select Target Department --</option>
                  {departments.map(d => (
                    <option key={d.id} value={d.id}>{d.name}{d.channelNumber ? ` — Channel ${d.channelNumber}` : ''}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className={labelCls}>Accessories to move along (optional)</label>
                <div className="grid grid-cols-2 gap-3">
                  <input type="number" min="0" max={heldChargers} disabled={isClient || !transferWalkieId}
                    value={transferChargers} onChange={(e) => setTransferChargers(e.target.value)}
                    className={inputCls} placeholder="Chargers" />
                  <input type="number" min="0" max={heldEarphones} disabled={isClient || !transferWalkieId}
                    value={transferEarphones} onChange={(e) => setTransferEarphones(e.target.value)}
                    className={inputCls} placeholder="Earphones" />
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  {transferWalkieId
                    ? `This radio's batch holds ${heldChargers} charger${heldChargers === 1 ? '' : 's'} · ${heldEarphones} earphone${heldEarphones === 1 ? '' : 's'}. They are taken from that batch and handed to the target department.`
                    : 'Select a radio to see how many chargers and earphones its batch holds.'}
                </p>
                {transferWalkieId && !transferAccessoriesValid && (
                  <p className="text-xs text-rose-500 mt-1">You can move at most {heldChargers} chargers and {heldEarphones} earphones.</p>
                )}
                {transferWalkieId && isLastInBatch && (leftoverChargers > 0 || leftoverEarphones > 0) && transferAccessoriesValid && (
                  <p className="text-xs text-amber-500 mt-1">
                    This is the last radio in its batch — the {leftoverChargers} charger(s) and {leftoverEarphones} earphone(s) not moved will go back to stock.
                  </p>
                )}
              </div>

              <div>
                <label className={labelCls}>Transfer Reason / Remarks</label>
                <input
                  type="text"
                  required
                  disabled={isClient}
                  placeholder="e.g. Reinforcing Security shift due to high crowd"
                  value={transferRemarks}
                  onChange={(e) => setTransferRemarks(e.target.value)}
                  className={inputCls}
                />
              </div>

              <button
                type="submit"
                disabled={!transferWalkieId || !transferTargetDept || isClient || !transferAccessoriesValid}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-lg shadow-blue-500/20 disabled:opacity-50 disabled:shadow-none transition-all text-sm flex items-center justify-center gap-2"
              >
                <ArrowRightLeft className="w-4 h-4" />
                Execute Transfer
              </button>
            </form>
          </div>

          {/* Currently Allocated Snapshot */}
          <div className="mt-6 pt-6 border-t dark:border-slate-800">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Active in the Field ({allocatedWalkies.length})</p>
            {allocatedWalkies.length === 0 ? (
              <p className="text-xs text-slate-400">No radios are currently deployed.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                {allocatedWalkies.map(w => {
                  const dept = departments.find(d => d.id === w.departmentId);
                  return (
                    <span key={w.id} className="px-2 py-1 rounded-lg text-xs font-bold bg-blue-500/10 text-blue-600 dark:text-blue-400">
                      {getWalkieDisplayName(w)} → {dept ? dept.name : 'Unknown'}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Print Slip Modal */}
      {showSlip && lastAllocatedRecord && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className={`w-full max-w-md rounded-xl shadow-2xl p-6 transition-all ${isDark ? 'bg-slate-900 text-slate-100' : 'bg-white text-slate-800'}`}>
            <div className="flex justify-end -mt-2 -mr-2">
              <button onClick={() => setShowSlip(false)} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="text-center border-b pb-4 mb-4 -mt-4">
              <span className="text-4xl">{settings.logo}</span>
              <h3 className="text-lg font-bold uppercase tracking-wide mt-2">{settings.orgName}</h3>
              <p className="text-xs text-slate-400">Official Radio Allocation Slip</p>
            </div>

            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="font-semibold text-slate-400">Slip ID:</span>
                <span className="font-bold font-mono">{lastAllocatedRecord.id}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-semibold text-slate-400">Department:</span>
                <span className="font-bold">
                  {departments.find(d => d.id === lastAllocatedRecord.departmentId)?.name}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="font-semibold text-slate-400">Channel:</span>
                <span className="font-bold">
                  {departments.find(d => d.id === lastAllocatedRecord.departmentId)?.channelNumber || 'N/A'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="font-semibold text-slate-400">Allocated By:</span>
                <span className="font-bold">{lastAllocatedRecord.allocatedBy}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-semibold text-slate-400">Dispatch Date:</span>
                <span className="font-bold">{lastAllocatedRecord.date}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-semibold text-slate-400">Chargers / Earphones:</span>
                <span className="font-bold">{lastAllocatedRecord.chargerCount || 0} / {lastAllocatedRecord.earphoneCount || 0}</span>
              </div>
              <div className="border-t pt-3">
                <p className="font-semibold text-slate-400 mb-1">Allocated Radios ({lastAllocatedRecord.walkieIds.length}):</p>
                <ul className="list-disc list-inside text-xs space-y-1 max-h-40 overflow-y-auto">
                  {lastAllocatedRecord.walkieIds.map(id => {
                    const walkie = walkies.find(w => w.id === id);
                    return (
                      <li key={id} className="font-semibold">
                        {walkie ? `${getWalkieDisplayName(walkie)}${walkie.serial ? ` • S/N ${walkie.serial}` : ''}${walkie.model ? ` • ${walkie.model}` : ''}` : id}
                        {walkie?.assignedPerson?.name ? ` — Held by ${walkie.assignedPerson.name}` : ''}
                      </li>
                    );
                  })}
                </ul>
              </div>
              {lastAllocatedRecord.remarks && (
                <div className="border-t pt-3">
                  <p className="font-semibold text-slate-400 text-xs">Remarks:</p>
                  <p className="text-xs italic">"{lastAllocatedRecord.remarks}"</p>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 pt-6 border-t mt-6">
              <button
                onClick={() => window.print()}
                className="px-4 py-2 text-xs font-bold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 rounded-lg flex items-center gap-1.5"
              >
                <Printer className="w-4 h-4" />
                Print Slip
              </button>
              <button
                onClick={() => setShowSlip(false)}
                className="px-4 py-2 text-xs font-bold bg-blue-600 text-white hover:bg-blue-700 rounded-lg"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
