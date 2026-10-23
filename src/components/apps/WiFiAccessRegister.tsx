import React, { useEffect, useState } from 'react';
import { Edit3, Eye, EyeOff, KeyRound, Plus, RefreshCw, ShieldCheck } from 'lucide-react';
import { supabase } from '../../modules/walkie/lib/supabaseClient';
import { useEventScope } from '../../context/EventScopeContext';
import { inputCls, btnGhost, btnPrimary } from '../ui';
import { Select } from '../Select';

type AccessRow = {
  id: string;
  event_id: string | null;
  network_name: string;
  access_point: string;
  login_id: string;
  login_password: string;
  recipient_name: string;
  recipient_email: string;
  department: string;
  source: string;
  contact: string;
  device_model: string;
  valid_until: string | null;
  notes: string;
  status: 'active' | 'expired' | 'revoked';
};
const accessError = (error: any) =>
  /event_id|schema cache/i.test(error?.message || '')
    ? `${error.message} — run supabase/migration_v74_wifi_event_usage.sql and supabase/migration_v80_wifi_register_fields.sql, then reload.`
    : error?.message || 'Could not load Wi-Fi access.';

export const WiFiAccessRegister: React.FC<{
  organizationId?: string;
  canManage: boolean;
  departments: { id: string; name: string }[];
}> = ({ organizationId, canManage, departments }) => {
  const eventScope = useEventScope();
  const eventId = eventScope.scopeFor('wifi');
  const [rows, setRows] = useState<AccessRow[]>([]);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const EMPTY_FORM = {
    network_name: '',
    access_point: '',
    login_id: '',
    login_password: '',
    recipient_name: '',
    recipient_email: '',
    department: '',
    source: '',
    contact: '',
    device_model: '',
    valid_until: '',
    notes: '',
  };
  const [form, setForm] = useState(EMPTY_FORM);
  const load = async () => {
    if (!organizationId) return;
    let query = supabase.from('wifi_access_accounts').select('*').order('created_at', { ascending: false });
    query = eventId ? query.eq('event_id', eventId) : query.is('event_id', null);
    const { data, error: e } = await query;
    if (e) setError(accessError(e));
    else {
      setError('');
      setRows(data || []);
    }
  };
  useEffect(() => {
    load();
    if (!organizationId) return;
    const ch = supabase
      .channel(`wifi-access-${organizationId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'wifi_access_accounts', filter: `organization_id=eq.${organizationId}` },
        load,
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [organizationId, eventId]); // eslint-disable-line
  const set = (k: keyof typeof form, v: string) => setForm(p => ({ ...p, [k]: v }));
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organizationId) return;
    setBusy(true);
    setError('');
    const payload = {
      ...form,
      event_id: eventId || null,
      valid_until: form.valid_until || null,
      updated_at: new Date().toISOString(),
    };
    const result = editingId
      ? await supabase.from('wifi_access_accounts').update(payload).eq('id', editingId)
      : await supabase
          .from('wifi_access_accounts')
          .insert({ ...payload, id: `wifi-${Date.now()}`, organization_id: organizationId });
    setBusy(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    setEditingId(null);
    setForm(EMPTY_FORM);
    setOpen(false);
    await load();
  };
  const edit = (r: AccessRow) => {
    setEditingId(r.id);
    setForm({
      network_name: r.network_name,
      access_point: r.access_point || '',
      login_id: r.login_id,
      login_password: r.login_password,
      recipient_name: r.recipient_name,
      recipient_email: r.recipient_email || '',
      department: r.department || '',
      source: r.source || '',
      contact: r.contact || '',
      device_model: r.device_model || '',
      valid_until: r.valid_until || '',
      notes: r.notes || '',
    });
    setError('');
    setOpen(true);
  };
  const revoke = async (r: AccessRow) => {
    const { error: e } = await supabase
      .from('wifi_access_accounts')
      .update({ status: 'revoked', updated_at: new Date().toISOString() })
      .eq('id', r.id);
    if (e) setError(e.message);
    else await load();
  };
  const toggleReveal = (id: string) => setRevealed(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]));
  const effective = (r: AccessRow) =>
    r.status === 'active' && r.valid_until && r.valid_until < new Date().toISOString().slice(0, 10)
      ? 'expired'
      : r.status;
  const departmentOptions = Array.from(
    new Set([...departments.map(d => d.name), form.department].filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b));

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink flex items-center gap-2">
            <KeyRound size={18} className="text-blue-400" />
            Wi-Fi access register
          </h2>
          <p className="text-sm text-mute mt-1">
            Track event access, recipients, and expiry. Departments sync with Walkie.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {canManage && (
            <button
              className={btnPrimary}
              onClick={() => {
                setEditingId(null);
                setForm(EMPTY_FORM);
                setOpen(x => !x);
              }}
            >
              <Plus size={15} />
              Issue access
            </button>
          )}
        </div>
      </div>
      {error && (
        <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          {error}
          <div className="mt-2">
            <button className={btnGhost} onClick={load}>
              <RefreshCw size={14} />
              Retry
            </button>
          </div>
        </div>
      )}
      {open && (
        <form
          onSubmit={save}
          className="rounded-xl border border-line bg-surface p-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3"
        >
          <div className="sm:col-span-2 xl:col-span-4">
            <h3 className="font-semibold text-ink">{editingId ? 'Edit Wi-Fi access' : 'Issue Wi-Fi access'}</h3>
          </div>
          <label className="text-xs text-mute">
            Network name
            <input
              required
              value={form.network_name}
              onChange={e => set('network_name', e.target.value)}
              className={inputCls + ' mt-1'}
            />
          </label>
          <label className="text-xs text-mute">
            AP / location
            <input
              value={form.access_point}
              onChange={e => set('access_point', e.target.value)}
              className={inputCls + ' mt-1'}
            />
          </label>
          <label className="text-xs text-mute">
            Login ID
            <input
              required
              value={form.login_id}
              onChange={e => set('login_id', e.target.value)}
              className={inputCls + ' mt-1'}
            />
          </label>
          <label className="text-xs text-mute">
            Password
            <input
              required
              type="password"
              value={form.login_password}
              onChange={e => set('login_password', e.target.value)}
              className={inputCls + ' mt-1'}
            />
          </label>
          <label className="text-xs text-mute">
            Recipient name
            <input
              required
              value={form.recipient_name}
              onChange={e => set('recipient_name', e.target.value)}
              className={inputCls + ' mt-1'}
            />
          </label>
          <label className="text-xs text-mute">
            From
            <input value={form.source} onChange={e => set('source', e.target.value)} className={inputCls + ' mt-1'} />
          </label>
          <label className="text-xs text-mute">
            Contact
            <input value={form.contact} onChange={e => set('contact', e.target.value)} className={inputCls + ' mt-1'} />
          </label>
          <label className="text-xs text-mute">
            Device model
            <input
              value={form.device_model}
              onChange={e => set('device_model', e.target.value)}
              className={inputCls + ' mt-1'}
            />
          </label>
          <label className="text-xs text-mute">
            Recipient email (for private access)
            <input
              type="email"
              value={form.recipient_email}
              onChange={e => set('recipient_email', e.target.value)}
              className={inputCls + ' mt-1'}
            />
          </label>
          <label className="text-xs text-mute">
            Department
            <Select
              value={form.department}
              onChange={e => set('department', e.target.value)}
              className={inputCls + ' mt-1'}
            >
              <option value="">Choose a Walkie department…</option>
              {departmentOptions.map(name => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>
          </label>
          <label className="text-xs text-mute">
            Access valid through
            <input
              type="date"
              value={form.valid_until}
              onChange={e => set('valid_until', e.target.value)}
              className={inputCls + ' mt-1'}
            />
          </label>
          <label className="text-xs text-mute sm:col-span-2 xl:col-span-4">
            Notes
            <input value={form.notes} onChange={e => set('notes', e.target.value)} className={inputCls + ' mt-1'} />
          </label>
          <div className="sm:col-span-2 xl:col-span-4 flex justify-end gap-2">
            <button
              type="button"
              className={btnGhost}
              onClick={() => {
                setOpen(false);
                setEditingId(null);
              }}
            >
              Cancel
            </button>
            <button disabled={busy} className={btnPrimary}>
              {busy ? 'Saving…' : editingId ? 'Save changes' : 'Save access'}
            </button>
          </div>
        </form>
      )}
      <div className="rounded-xl border border-line bg-surface overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="text-xs text-faint border-b border-line">
            <tr className="text-left">
              <th className="px-4 py-3">SR.</th>
              <th className="px-4 py-3">DEPARTMENT</th>
              <th className="px-4 py-3">USER ID</th>
              <th className="px-4 py-3">NAME</th>
              <th className="px-4 py-3">FROM</th>
              <th className="px-4 py-3">CONTACT</th>
              <th className="px-4 py-3">DEVICE MODEL</th>
              <th className="px-4 py-3">STATUS</th>
              {canManage && <th className="px-4 py-3">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r, index) => (
              <tr key={r.id} className="align-top">
                <td className="px-4 py-3 text-ink-soft">{index + 1}</td>
                <td className="px-4 py-3 text-ink-soft">{r.department || '—'}</td>
                <td className="px-4 py-3 font-mono text-xs text-ink">{r.login_id}</td>
                <td className="px-4 py-3 text-ink">{r.recipient_name}</td>
                <td className="px-4 py-3 text-ink-soft">{r.source || '—'}</td>
                <td className="px-4 py-3 text-ink-soft">{r.contact || r.recipient_email || '—'}</td>
                <td className="px-4 py-3 text-ink-soft">{r.device_model || '—'}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-1 text-xs ${effective(r) === 'active' ? 'bg-emerald-500/10 text-emerald-300' : effective(r) === 'expired' ? 'bg-amber-500/10 text-amber-300' : 'bg-raised text-mute'}`}
                  >
                    {effective(r)}
                  </span>
                </td>
                {canManage && (
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {r.status === 'active' && (
                        <button
                          aria-label={`Edit access for ${r.recipient_name}`}
                          className="text-xs text-blue-300 hover:underline"
                          onClick={() => edit(r)}
                        >
                          <Edit3 size={13} className="mr-1 inline" />
                          Edit
                        </button>
                      )}
                      {r.status === 'active' && (
                        <button className="text-xs text-red-300 hover:underline" onClick={() => revoke(r)}>
                          Revoke
                        </button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={canManage ? 9 : 8} className="px-4 py-12 text-center text-sm text-mute">
                  <ShieldCheck className="mx-auto mb-2 text-faint" size={20} />
                  No Wi-Fi access has been issued yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
};
