import React, { useEffect, useState } from 'react';
import { Edit3, Eye, EyeOff, KeyRound, Plus, RefreshCw, ShieldCheck } from 'lucide-react';
import { supabase } from '../../modules/walkie/lib/supabaseClient';
import { inputCls, btnGhost, btnPrimary } from '../ui';

type AccessRow = { id: string; network_name: string; access_point: string; login_id: string; login_password: string; recipient_name: string; recipient_email: string; department: string; valid_until: string | null; notes: string; status: 'active' | 'expired' | 'revoked' };
const DEPARTMENTS = ['Security', 'Medical', 'Operations', 'Media', 'Logistics', 'Other'];

export const WiFiAccessRegister: React.FC<{ organizationId?: string; canManage: boolean }> = ({ organizationId, canManage }) => {
  const [rows, setRows] = useState<AccessRow[]>([]);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ network_name: '', access_point: '', login_id: '', login_password: '', recipient_name: '', recipient_email: '', department: '', valid_until: '', notes: '' });
  const load = async () => {
    if (!organizationId) return;
    const { data, error: e } = await supabase.from('wifi_access_accounts').select('*').order('created_at', { ascending: false });
    if (e) setError(e.message); else { setError(''); setRows(data || []); }
  };
  useEffect(() => {
    load();
    if (!organizationId) return;
    const ch = supabase.channel(`wifi-access-${organizationId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'wifi_access_accounts', filter: `organization_id=eq.${organizationId}` }, load).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [organizationId]); // eslint-disable-line
  const set = (k: keyof typeof form, v: string) => setForm(p => ({ ...p, [k]: v }));
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); if (!organizationId) return;
    setBusy(true); setError('');
    const payload = { ...form, valid_until: form.valid_until || null, updated_at: new Date().toISOString() };
    const result = editingId
      ? await supabase.from('wifi_access_accounts').update(payload).eq('id', editingId)
      : await supabase.from('wifi_access_accounts').insert({ ...payload, id: `wifi-${Date.now()}`, organization_id: organizationId });
    setBusy(false);
    if (result.error) { setError(result.error.message); return; }
    setEditingId(null); setForm({ network_name: '', access_point: '', login_id: '', login_password: '', recipient_name: '', recipient_email: '', department: '', valid_until: '', notes: '' }); setOpen(false); await load();
  };
  const edit = (r: AccessRow) => {
    setEditingId(r.id);
    setForm({ network_name: r.network_name, access_point: r.access_point || '', login_id: r.login_id, login_password: r.login_password, recipient_name: r.recipient_name, recipient_email: r.recipient_email || '', department: r.department || '', valid_until: r.valid_until || '', notes: r.notes || '' });
    setError(''); setOpen(true);
  };
  const revoke = async (r: AccessRow) => {
    const { error: e } = await supabase.from('wifi_access_accounts').update({ status: 'revoked', updated_at: new Date().toISOString() }).eq('id', r.id);
    if (e) setError(e.message); else await load();
  };
  const toggleReveal = (id: string) => setRevealed(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  const effective = (r: AccessRow) => r.status === 'active' && r.valid_until && r.valid_until < new Date().toISOString().slice(0, 10) ? 'expired' : r.status;

  return <section className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold text-ink flex items-center gap-2"><KeyRound size={18} className="text-blue-400" />Wi-Fi access register</h2><p className="text-sm text-mute mt-1">Track credentials issued to departments, named recipients, and access expiry.</p></div>
      {canManage && <button className={btnPrimary} onClick={() => { setEditingId(null); setForm({ network_name: '', access_point: '', login_id: '', login_password: '', recipient_name: '', recipient_email: '', department: '', valid_until: '', notes: '' }); setOpen(x => !x); }}><Plus size={15} />Issue access</button>}
    </div>
    {error && <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}<div className="mt-2"><button className={btnGhost} onClick={load}><RefreshCw size={14} />Retry</button></div></div>}
    {open && <form onSubmit={save} className="rounded-xl border border-line bg-surface p-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
      <div className="sm:col-span-2 xl:col-span-4"><h3 className="font-semibold text-ink">{editingId ? 'Edit Wi-Fi access' : 'Issue Wi-Fi access'}</h3></div>
      <label className="text-xs text-mute">Network name<input required value={form.network_name} onChange={e => set('network_name', e.target.value)} className={inputCls + ' mt-1'} /></label>
      <label className="text-xs text-mute">AP / location<input value={form.access_point} onChange={e => set('access_point', e.target.value)} className={inputCls + ' mt-1'} /></label>
      <label className="text-xs text-mute">Login ID<input required value={form.login_id} onChange={e => set('login_id', e.target.value)} className={inputCls + ' mt-1'} /></label>
      <label className="text-xs text-mute">Password<input required type="password" value={form.login_password} onChange={e => set('login_password', e.target.value)} className={inputCls + ' mt-1'} /></label>
      <label className="text-xs text-mute">Recipient name<input required value={form.recipient_name} onChange={e => set('recipient_name', e.target.value)} className={inputCls + ' mt-1'} /></label>
      <label className="text-xs text-mute">Recipient email (for private access)<input type="email" value={form.recipient_email} onChange={e => set('recipient_email', e.target.value)} className={inputCls + ' mt-1'} /></label>
      <label className="text-xs text-mute">Department<input value={form.department} onChange={e => set('department', e.target.value)} list="wifi-departments" className={inputCls + ' mt-1'} /><datalist id="wifi-departments">{DEPARTMENTS.map(d => <option key={d} value={d} />)}</datalist></label>
      <label className="text-xs text-mute">Access valid through<input type="date" value={form.valid_until} onChange={e => set('valid_until', e.target.value)} className={inputCls + ' mt-1'} /></label>
      <label className="text-xs text-mute sm:col-span-2 xl:col-span-4">Notes<input value={form.notes} onChange={e => set('notes', e.target.value)} className={inputCls + ' mt-1'} /></label>
      <div className="sm:col-span-2 xl:col-span-4 flex justify-end gap-2"><button type="button" className={btnGhost} onClick={() => { setOpen(false); setEditingId(null); }}>Cancel</button><button disabled={busy} className={btnPrimary}>{busy ? 'Saving…' : editingId ? 'Save changes' : 'Save access'}</button></div>
    </form>}
    <div className="rounded-xl border border-line bg-surface overflow-x-auto"><table className="w-full min-w-[52rem] text-sm"><thead className="text-xs text-faint border-b border-line"><tr className="text-left"><th className="px-4 py-3">Network / location</th><th className="px-4 py-3">Issued to</th><th className="px-4 py-3">Login</th><th className="px-4 py-3">Password</th><th className="px-4 py-3">Valid through</th><th className="px-4 py-3">Status</th>{canManage && <th className="px-4 py-3" />}</tr></thead>
      <tbody className="divide-y divide-line">{rows.map(r => <tr key={r.id} className="align-top"><td className="px-4 py-3"><div className="font-medium text-ink">{r.network_name}</div><div className="text-xs text-mute">{r.access_point || r.notes || '—'}</div></td><td className="px-4 py-3"><div>{r.recipient_name}</div><div className="text-xs text-mute">{[r.department, r.recipient_email].filter(Boolean).join(' · ')}</div></td><td className="px-4 py-3 font-mono text-xs">{r.login_id}</td><td className="px-4 py-3"><span className="font-mono text-xs">{revealed.includes(r.id) ? r.login_password : '••••••••'}</span><button className="ml-2 text-mute hover:text-ink" aria-label="Show password" onClick={() => toggleReveal(r.id)}>{revealed.includes(r.id) ? <EyeOff size={14} /> : <Eye size={14} />}</button></td><td className="px-4 py-3 text-xs">{r.valid_until || 'No expiry'}</td><td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs ${effective(r) === 'active' ? 'bg-emerald-500/10 text-emerald-300' : effective(r) === 'expired' ? 'bg-amber-500/10 text-amber-300' : 'bg-raised text-mute'}`}>{effective(r)}</span></td>{canManage && <td className="px-4 py-3"><div className="flex items-center gap-3">{r.status === 'active' && <button aria-label={`Edit access for ${r.recipient_name}`} className="text-xs text-blue-300 hover:underline" onClick={() => edit(r)}><Edit3 size={13} className="mr-1 inline" />Edit</button>}{r.status === 'active' && <button className="text-xs text-red-300 hover:underline" onClick={() => revoke(r)}>Revoke</button>}</div></td>}</tr>)}
      {!rows.length && <tr><td colSpan={canManage ? 7 : 6} className="px-4 py-12 text-center text-sm text-mute"><ShieldCheck className="mx-auto mb-2 text-faint" size={20} />No Wi-Fi access has been issued yet.</td></tr>}</tbody></table></div>
  </section>;
};
