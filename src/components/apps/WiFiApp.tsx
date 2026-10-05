import React, { useMemo, useState } from 'react';
import { Edit3, Plus, Search, Trash2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import type { WiFiAPInput } from '../../context/AppContext';
import type { WiFiAccessPoint } from '../../types';
import { useWalkie } from '../../modules/walkie';
import { Tabs } from '../ui';
import { WiFiAccessRegister } from './WiFiAccessRegister';

const EMPTY: WiFiAPInput = { apCode: '', model: '', location: '', status: 'online' };

export const WiFiApp: React.FC = () => {
  const { wifiAPs, assetsLoading, assetsError, currentUser, subAppActiveTab, setSubAppActiveTab, addWiFiAP, updateWiFiAP, deleteWiFiAP } = useApp();
  const auth: any = useWalkie();
  const tabs = ['Access Points', 'Access Accounts'];
  const savedTab = subAppActiveTab.wifi;
  const currentTab = tabs.includes(savedTab) ? savedTab : 'Access Points';
  const setCurrentTab = (t: string) => setSubAppActiveTab('wifi', t);
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<WiFiAPInput>(EMPTY);
  const [deleting, setDeleting] = useState<{ id: string; apCode: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const canManage = ['owner', 'dept_head'].includes(auth.currentUser?.level) || currentUser?.subDepartmentId === 'wifi';
  const locations = useMemo(() => Array.from(new Set(wifiAPs.map(ap => ap.location))).filter(Boolean).sort(), [wifiAPs]);
  const rows = wifiAPs.filter(ap => [ap.apCode, ap.model, ap.location].some(v => (v || '').toLowerCase().includes(search.trim().toLowerCase())));

  const startAdd = () => { setEditingId(null); setForm(EMPTY); setError(''); setFormOpen(true); };
  const startEdit = (ap: WiFiAccessPoint) => { setEditingId(ap.id); setForm({ apCode: ap.apCode, model: ap.model, location: ap.location, status: ap.status }); setError(''); setFormOpen(true); };
  const set = <K extends keyof WiFiAPInput>(key: K, value: WiFiAPInput[K]) => setForm(p => ({ ...p, [key]: value }));
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    const failure = editingId ? await updateWiFiAP(editingId, form) : await addWiFiAP(form);
    setBusy(false);
    if (failure) { setError(failure); return; }
    setFormOpen(false); setEditingId(null); setForm(EMPTY);
  };
  const remove = async () => {
    if (!deleting) return;
    const failure = await deleteWiFiAP(deleting.id);
    if (failure) { setError(failure); return; }
    setDeleting(null); setError('');
  };

  return <div className="space-y-4">
    <p className="text-sm text-mute">Track access point ID, type/model, location and operational status. Wi-Fi logins issued to people are in Access Accounts.</p>
    <Tabs value={currentTab} onChange={setCurrentTab} tabs={tabs.map(t => ({ id: t, label: t }))} />
    {assetsError && <div role="alert" className="rounded-md border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">{assetsError}</div>}
    {currentTab === 'Access Points' && <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid grid-cols-3 gap-2">
          {[['Access points', wifiAPs.length], ['Locations', locations.length], ['Online', wifiAPs.filter(ap => ap.status === 'online').length]].map(([label, value]) => <div key={label as string} className="min-w-24 rounded-md border border-line bg-surface px-3 py-2"><div className="text-[11px] text-mute">{label}</div><div className="text-lg font-semibold text-ink tabular-nums">{value}</div></div>)}
        </div>
        {canManage && <button onClick={startAdd} className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500"><Plus size={16} />Add access point</button>}
      </div>
      {error && !formOpen && <div role="alert" className="rounded-md border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">{error}</div>}
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        <div className="border-b border-line p-3"><label className="flex max-w-md items-center gap-2 rounded-md border border-line bg-canvas px-3 py-2 text-xs text-mute"><Search size={14} /><input aria-label="Search access points" placeholder="Search ID, model or location" value={search} onChange={e => setSearch(e.target.value)} className="w-full bg-transparent text-ink outline-none" /></label></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm"><thead className="border-b border-line text-xs text-faint"><tr><th className="px-4 py-3">Access point ID</th><th className="px-4 py-3">Type / Model</th><th className="px-4 py-3">Location</th><th className="px-4 py-3">Status</th>{canManage && <th className="px-4 py-3">Actions</th>}</tr></thead>
          <tbody className="divide-y divide-line">{rows.map(ap => <tr key={ap.id}><td className="px-4 py-3 font-medium text-ink">{ap.apCode}</td><td className="px-4 py-3 text-ink-soft">{ap.model || '—'}</td><td className="px-4 py-3 text-ink-soft">{ap.location}</td><td className="px-4 py-3 capitalize text-ink-soft">{ap.status.replace('_', ' ')}</td>{canManage && <td className="px-4 py-2"><div className="flex gap-1"><button onClick={() => startEdit(ap)} aria-label={`Edit ${ap.apCode}`} className="rounded p-1.5 text-mute hover:bg-raised hover:text-ink"><Edit3 size={15} /></button><button onClick={() => { setDeleting({ id: ap.id, apCode: ap.apCode }); setError(''); }} aria-label={`Delete ${ap.apCode}`} className="rounded p-1.5 text-rose-400 hover:bg-rose-500/10"><Trash2 size={15} /></button></div></td>}</tr>)}
            {!rows.length && <tr><td colSpan={canManage ? 5 : 4} className="p-8 text-center text-sm text-mute">{assetsLoading ? 'Loading access points…' : search ? 'No access points match your search.' : 'No access points registered yet.'}</td></tr>}
          </tbody></table></div>
      </div>
    </div>}
    {currentTab === 'Access Accounts' && <WiFiAccessRegister organizationId={auth.currentUser?.organizationId} canManage={canManage} />}

    {formOpen && <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"><form onSubmit={save} className="w-full max-w-lg space-y-4 rounded-lg border border-line bg-surface p-5">
      <div><h3 className="text-lg font-semibold text-ink">{editingId ? 'Edit access point' : 'Add access point'}</h3><p className="text-sm text-mute">Record the access point and where it is installed.</p></div>
      {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-mute">Access point ID<input required value={form.apCode} onChange={e => set('apCode', e.target.value)} className="mt-1 w-full rounded-md border border-line bg-field px-3 py-2 text-sm text-ink" /></label>
        <label className="text-xs text-mute">Type / Model<input value={form.model} onChange={e => set('model', e.target.value)} className="mt-1 w-full rounded-md border border-line bg-field px-3 py-2 text-sm text-ink" /></label>
        <label className="text-xs text-mute">Location<input required value={form.location} onChange={e => set('location', e.target.value)} className="mt-1 w-full rounded-md border border-line bg-field px-3 py-2 text-sm text-ink" /></label>
        <label className="text-xs text-mute">Status<select value={form.status} onChange={e => set('status', e.target.value as WiFiAPInput['status'])} className="mt-1 w-full rounded-md border border-line bg-field px-3 py-2 text-sm text-ink"><option value="online">Online</option><option value="offline">Offline</option><option value="high_latency">High latency</option></select></label>
      </div>
      <div className="flex justify-end gap-2"><button type="button" onClick={() => { setFormOpen(false); setEditingId(null); setForm(EMPTY); setError(''); }} className="rounded-md border border-line px-3 py-2 text-sm text-ink">Cancel</button><button disabled={busy} className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">{busy ? 'Saving…' : 'Save access point'}</button></div>
    </form></div>}
    {deleting && <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"><div role="dialog" aria-modal="true" aria-labelledby="delete-ap-title" className="w-full max-w-sm rounded-lg border border-line bg-surface p-5"><h3 id="delete-ap-title" className="font-semibold text-ink">Delete {deleting.apCode}?</h3><p className="mt-2 text-sm text-mute">This removes the access point from the shared Wi-Fi register.</p>{error && <p role="alert" className="mt-2 text-sm text-rose-300">{error}</p>}<div className="mt-4 flex justify-end gap-2"><button onClick={() => setDeleting(null)} className="rounded-md border border-line px-3 py-2 text-sm text-ink">Cancel</button><button onClick={remove} className="rounded-md bg-rose-600 px-3 py-2 text-sm font-medium text-white">Delete</button></div></div></div>}
  </div>;
};
