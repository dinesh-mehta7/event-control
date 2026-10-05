import React, { useMemo, useState } from 'react';
import { ArrowLeft, ChevronRight, Edit3, Plus, Search, Trash2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import type { CameraItem } from '../../types';
import type { CameraInput } from '../../context/AppContext';

const EMPTY: CameraInput = { cameraCode: '', location: '', type: '', nvrId: '', switchId: '', status: 'online' };
const STATUS_LABEL: Record<CameraItem['status'], string> = { online: 'Active', offline: 'Not working', maintenance: 'Needs orientation' };
const STATUS_CLASS: Record<CameraItem['status'], string> = {
  online: 'bg-emerald-500/10 text-emerald-300', offline: 'bg-rose-500/10 text-rose-300', maintenance: 'bg-amber-500/10 text-amber-300',
};

export const CCTVApp: React.FC = () => {
  const { cameras, assetsLoading, assetsError, currentUser, addCamera, updateCamera, deleteCamera } = useApp();
  const canManage = currentUser.role === 'owner' || currentUser.role === 'dept_head' || currentUser.subDepartmentId === 'cctv';
  const [search, setSearch] = useState('');
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<CameraInput>(EMPTY);
  const [deleting, setDeleting] = useState<CameraItem | null>(null);
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  const groups = useMemo(() => {
    const grouped = new Map<string, CameraItem[]>();
    cameras.forEach(c => grouped.set(c.zone || 'Unassigned location', [...(grouped.get(c.zone || 'Unassigned location') || []), c]));
    const term = search.trim().toLowerCase();
    return Array.from(grouped.entries()).map(([location, allRows]) => ({
      location,
      cameras: allRows,
      shown: allRows.filter(c => [c.cameraCode, c.zone, c.type, c.nvrId || '', c.switchId || ''].some(v => v.toLowerCase().includes(term))),
      nvrs: Array.from(new Set(allRows.map(c => c.nvrId).filter(Boolean))),
      equipment: Array.from(new Set(allRows.map(c => c.switchId).filter(Boolean))),
    })).filter(group => group.shown.length > 0).sort((a, b) => a.location.localeCompare(b.location));
  }, [cameras, search]);

  const startAdd = () => {
    const atLocation = selectedLocation ? cameras.filter(c => (c.zone || 'Unassigned location') === selectedLocation) : [];
    setEditingId(null);
    setForm({ ...EMPTY, location: selectedLocation || '', nvrId: atLocation.find(c => c.nvrId)?.nvrId || '', switchId: atLocation.find(c => c.switchId)?.switchId || '' });
    setFormError(''); setFormOpen(true);
  };
  const startEdit = (camera: CameraItem) => {
    setEditingId(camera.id);
    setForm({ cameraCode: camera.cameraCode, location: camera.zone, type: camera.type, nvrId: camera.nvrId || '', switchId: camera.switchId || '', status: camera.status });
    setFormError('');
    setFormOpen(true);
  };
  const set = <K extends keyof CameraInput,>(key: K, value: CameraInput[K]) => setForm(current => ({ ...current, [key]: value }));
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setFormError('');
    const error = editingId ? await updateCamera(editingId, form) : await addCamera(form);
    setBusy(false);
    if (error) { setFormError(error); return; }
    setEditingId(null); setFormOpen(false); setForm(EMPTY);
  };
  const remove = async () => {
    if (!deleting) return;
    const error = await deleteCamera(deleting.id);
    if (error) { setFormError(error); return; }
    setDeleting(null); setFormError('');
  };
  const locationCount = new Set(cameras.map(c => c.zone || 'Unassigned location')).size;

  return <div className="space-y-4">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-lg font-semibold text-ink">CCTV</h2><p className="text-sm text-mute">{cameras.length} cameras across {locationCount} locations</p></div>
      {canManage && <button onClick={startAdd} className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500"><Plus size={16} />Add camera</button>}
    </header>
    {(assetsError || formError) && <div role="alert" className="rounded-md border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">{formError || assetsError}</div>}
    <label className="flex max-w-md items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-sm text-mute"><Search size={15} /><input aria-label="Search cameras or locations" placeholder={selectedLocation ? 'Search camera, type, NVR or switch' : 'Search location, camera or equipment'} value={search} onChange={e => setSearch(e.target.value)} className="w-full bg-transparent text-ink outline-none" /></label>

    {selectedLocation ? <section className="overflow-hidden rounded-lg border border-line bg-surface">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <button onClick={() => { setSelectedLocation(null); setSearch(''); }} className="rounded-md p-1.5 text-mute hover:bg-raised hover:text-ink" aria-label="Back to CCTV locations"><ArrowLeft size={16} /></button>
          <div className="min-w-0"><h3 className="truncate text-sm font-semibold text-ink">{selectedLocation}</h3><p className="text-[11px] text-mute">Camera register · {cameras.filter(c => (c.zone || 'Unassigned location') === selectedLocation).length} cameras</p></div>
        </div>
        {canManage && <button onClick={startAdd} className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-500"><Plus size={14} />Add camera here</button>}
      </header>
      {(() => {
        const atLocation = cameras.filter(c => (c.zone || 'Unassigned location') === selectedLocation);
        const nvrs = Array.from(new Set(atLocation.map(c => c.nvrId).filter(Boolean)));
        const equipment = Array.from(new Set(atLocation.map(c => c.switchId).filter(Boolean)));
        const matched = atLocation.filter(c => [c.cameraCode, c.zone, c.type, c.nvrId || '', c.switchId || ''].some(v => v.toLowerCase().includes(search.trim().toLowerCase())));
        return <>
          <div className="flex flex-wrap gap-x-5 gap-y-1 border-b border-line bg-raised/30 px-4 py-2 text-[11px] text-mute"><span><b className="text-ink">{atLocation.filter(c => c.status === 'online').length}</b> active</span><span><b className="text-amber-300">{atLocation.filter(c => c.status === 'maintenance').length}</b> need orientation</span><span><b className="text-rose-300">{atLocation.filter(c => c.status === 'offline').length}</b> not working</span>{nvrs.length > 0 && <span>NVR: <b className="text-ink-soft">{nvrs.join(', ')}</b></span>}{equipment.length > 0 && <span>Other equipment: <b className="text-ink-soft">{equipment.join(', ')}</b></span>}</div>
          <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-left text-xs"><thead className="bg-raised/50 text-[10px] uppercase tracking-wide text-faint"><tr><th className="px-3 py-2">Camera name / ID</th><th className="px-3 py-2">Camera type</th><th className="px-3 py-2">Status</th>{canManage && <th className="px-3 py-2">Actions</th>}</tr></thead>
            <tbody className="divide-y divide-line">{matched.map(camera => <tr key={camera.id} className="hover:bg-raised/30"><td className="px-3 py-2.5 font-medium text-ink">{camera.name || camera.cameraCode}</td><td className="px-3 py-2.5 text-ink-soft">{camera.type || '—'}</td><td className="px-3 py-2.5"><span className={`rounded px-2 py-1 text-[10px] ${STATUS_CLASS[camera.status]}`}>{STATUS_LABEL[camera.status]}</span></td>{canManage && <td className="px-3 py-2.5"><div className="flex gap-1"><button onClick={() => startEdit(camera)} aria-label={`Edit ${camera.cameraCode}`} className="rounded p-1.5 text-mute hover:bg-raised hover:text-ink"><Edit3 size={14} /></button><button onClick={() => { setDeleting(camera); setFormError(''); }} aria-label={`Delete ${camera.cameraCode}`} className="rounded p-1.5 text-rose-400 hover:bg-rose-500/10"><Trash2 size={14} /></button></div></td>}</tr>)}</tbody>
          </table>{!matched.length && <p className="px-4 py-8 text-center text-xs text-mute">{search ? 'No cameras match this search.' : 'No cameras are registered at this location.'}</p>}</div>
        </>;
      })()}
    </section> : <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
      {groups.map(group => {
        const all = group.cameras;
        const active = all.filter(c => c.status === 'online').length;
        const orient = all.filter(c => c.status === 'maintenance').length;
        const down = all.filter(c => c.status === 'offline').length;
        return <button key={group.location} type="button" onClick={() => { setSelectedLocation(group.location); setSearch(''); }} className="rounded-lg border border-line bg-surface p-3 text-left transition-colors hover:border-blue-500/50 hover:bg-raised/30">
          <div className="flex items-start gap-2"><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-ink">{group.location}</span><span className="mt-0.5 block text-[11px] text-mute">{all.length} {all.length === 1 ? 'camera' : 'cameras'} · {active} active</span></span><span className="grid h-7 min-w-7 place-items-center rounded-md bg-blue-500/10 px-1.5 text-xs font-semibold text-blue-300">{all.length}</span><ChevronRight size={15} className="mt-1 shrink-0 text-faint" /></div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-mute">{group.nvrs.length ? <span>NVR {group.nvrs.join(', ')}</span> : <span>No NVR listed</span>}{group.equipment.length ? <span>Switch/equipment {group.equipment.join(', ')}</span> : null}</div>
          {(orient > 0 || down > 0) && <div className="mt-2 flex gap-2 text-[10px]">{orient > 0 && <span className="text-amber-300">{orient} need orientation</span>}{down > 0 && <span className="text-rose-300">{down} not working</span>}</div>}
        </button>;
      })}
      {!assetsLoading && !assetsError && !groups.length && <div className="col-span-full rounded-md border border-line bg-surface p-8 text-center text-sm text-mute">{search ? 'No locations or cameras match this search.' : 'No cameras registered yet.'}</div>}
    </div>}

    {assetsLoading && <div className="rounded-md border border-line bg-surface p-8 text-center text-sm text-mute">Loading camera register…</div>}

    {deleting && <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"><div role="dialog" aria-modal="true" aria-labelledby="delete-camera-title" className="w-full max-w-sm rounded-lg border border-line bg-surface p-5"><h3 id="delete-camera-title" className="font-semibold text-ink">Delete {deleting.cameraCode}?</h3><p className="mt-2 text-sm text-mute">This removes the camera from the shared CCTV register.</p><div className="mt-4 flex justify-end gap-2"><button onClick={() => setDeleting(null)} className="rounded-md border border-line px-3 py-2 text-sm text-ink">Cancel</button><button onClick={remove} className="rounded-md bg-rose-600 px-3 py-2 text-sm font-medium text-white">Delete</button></div></div></div>}
    {formOpen && <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"><form onSubmit={save} className="w-full max-w-lg space-y-4 rounded-lg border border-line bg-surface p-5">
      <div><h3 className="text-lg font-semibold text-ink">{editingId ? 'Edit camera' : 'Add camera'}</h3><p className="text-sm text-mute">Camera ID, location, type and connected equipment.</p></div>
      {formError && <p role="alert" className="text-sm text-rose-300">{formError}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-mute">Camera name / ID<input required value={form.cameraCode} onChange={e => set('cameraCode', e.target.value)} placeholder="Gate 2 · CAM-014" className="mt-1 w-full rounded-md border border-line bg-field px-3 py-2 text-sm text-ink" /></label>
        <label className="text-xs text-mute">Location<input required value={form.location} onChange={e => set('location', e.target.value)} className="mt-1 w-full rounded-md border border-line bg-field px-3 py-2 text-sm text-ink" /></label>
        <label className="text-xs text-mute">Camera type<input required value={form.type} onChange={e => set('type', e.target.value)} placeholder="PTZ, fixed, dome…" className="mt-1 w-full rounded-md border border-line bg-field px-3 py-2 text-sm text-ink" /></label>
        <label className="text-xs text-mute">NVR ID<input value={form.nvrId} onChange={e => set('nvrId', e.target.value)} className="mt-1 w-full rounded-md border border-line bg-field px-3 py-2 text-sm text-ink" /></label>
        <label className="text-xs text-mute">Switch ID<input value={form.switchId} onChange={e => set('switchId', e.target.value)} className="mt-1 w-full rounded-md border border-line bg-field px-3 py-2 text-sm text-ink" /></label>
        <label className="text-xs text-mute">Status<select value={form.status} onChange={e => set('status', e.target.value as CameraInput['status'])} className="mt-1 w-full rounded-md border border-line bg-field px-3 py-2 text-sm text-ink"><option value="online">Active</option><option value="maintenance">Needs orientation</option><option value="offline">Not working</option></select></label>
      </div>
      <div className="flex justify-end gap-2"><button type="button" onClick={() => { setFormOpen(false); setEditingId(null); setForm(EMPTY); setFormError(''); }} className="rounded-md border border-line px-3 py-2 text-sm text-ink">Cancel</button><button disabled={busy} className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">{busy ? 'Saving…' : 'Save camera'}</button></div>
    </form></div>}
  </div>;
};
