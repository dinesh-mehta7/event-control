import { useApp as useWalkie } from '../../walkie/context/AppContext';
import React, { useState } from 'react';
import { Edit3, Plus, Trash2 } from 'lucide-react';
import { Modal, ConfirmModal, btnGhost, cx, inputCls, labelCls } from '../../accommodation/ui';
import { useRequests } from '../../requests/RequestsContext';
import { STATUS_LABEL as REQUEST_STATUS_LABEL } from '../../requests/types';
import { usePurchase } from '../PurchaseContext';
import type { VendorInput } from '../PurchaseContext';
import { STATUS, poTotal } from '../types';
import type { Vendor, VendorMode } from '../types';
import { digitsOnly, phoneInputProps } from '../../../lib/phone';
import { D, Empty, money, panel, primary, vendorModeLabel } from './shared';

export const VendorsView: React.FC = () => {
  const { vendors, orders, canManage, addVendor, updateVendor, deleteVendor, departmentName } = usePurchase();
  const { requests } = useRequests();
  const [form, setForm] = useState<Vendor | 'new' | null>(null);
  const [del, setDel] = useState<Vendor | null>(null);
  const stat = (id: string) => {
    const os = orders.filter(o => o.vendorId === id && o.status !== 'cancelled' && o.status !== 'rejected');
    return { orders: os, count: os.length, spend: os.reduce((a, o) => a + poTotal(o), 0) };
  };
  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        {canManage && (
          <button className={primary} onClick={() => setForm('new')}>
            <Plus className="w-4 h-4" />
            Add vendor
          </button>
        )}
      </div>
      <section className={cx(panel, 'overflow-x-auto')}>
        {vendors.length === 0 ? (
          <Empty>No vendors yet.</Empty>
        ) : (
          <table className="w-full min-w-[1250px] text-xs">
            <thead className="bg-raised/40 text-left text-[10.5px] uppercase tracking-wide text-mute">
              <tr>
                {[
                  'Vendor',
                  'Category',
                  'Contact person',
                  'Phone',
                  'Email',
                  'Total orders',
                  'Total spend',
                  'Requests · status',
                  'Address',
                  '',
                ].map((heading, i) => (
                  <th key={i} className="px-3 py-2.5 font-semibold">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70">
              {vendors.map(v => {
                const s = stat(v.id);
                const linked = new Map<string, string>();
                s.orders.forEach(order =>
                  order.items.forEach(item => {
                    if (!item.requestNumber || linked.has(item.requestNumber)) return;
                    const request = requests.find(r => r.number === item.requestNumber);
                    linked.set(
                      item.requestNumber,
                      request ? REQUEST_STATUS_LABEL[request.status] : STATUS[order.status]?.label || order.status,
                    );
                  }),
                );
                return (
                  <tr key={v.id} className="hover:bg-raised/30">
                    <td className="px-3 py-3 font-semibold text-ink">
                      {v.name}
                      <span className="block text-[10.5px] font-normal text-faint">
                        {v.departmentId ? `Only ${departmentName(v.departmentId) || 'one department'}` : 'Shared'}
                      </span>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">{vendorModeLabel(v.vendorMode)}</td>
                    <td className="px-3 py-3">{v.contact || '—'}</td>
                    <td className="px-3 py-3 whitespace-nowrap">{v.phone || '—'}</td>
                    <td className="px-3 py-3">{v.email || '—'}</td>
                    <td className="px-3 py-3 whitespace-nowrap tabular-nums">{s.count}</td>
                    <td className="px-3 py-3 whitespace-nowrap tabular-nums font-semibold">{money(s.spend)}</td>
                    <td className="px-3 py-3 min-w-48">
                      {linked.size ? (
                        <div className="space-y-1">
                          {Array.from(linked, ([number, status]) => (
                            <div key={number} className="whitespace-nowrap">
                              <span className="font-mono text-blue-300">{number}</span>
                              <span className="text-mute"> · {status}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-3 py-3 max-w-56 truncate">{v.address || '—'}</td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        {canManage && (
                          <>
                            <button className={btnGhost(D)} onClick={() => setForm(v)} aria-label={`Edit ${v.name}`}>
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              className={cx(btnGhost(D), 'text-rose-400')}
                              onClick={() => setDel(v)}
                              aria-label={`Delete ${v.name}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
      {form && (
        <VendorForm
          initial={form === 'new' ? null : form}
          onClose={() => setForm(null)}
          onSave={v => (form === 'new' ? addVendor(v) : updateVendor(form.id, v))}
        />
      )}
      {del && (
        <ConfirmModal
          dark={D}
          title={`Delete ${del.name}?`}
          body="Only possible if no order uses this vendor."
          confirmLabel="Delete"
          onConfirm={() => {
            deleteVendor(del.id);
          }}
          onClose={() => setDel(null)}
        />
      )}
    </div>
  );
};

const VendorForm: React.FC<{
  initial: Vendor | null;
  onClose: () => void;
  onSave: (v: VendorInput) => Promise<boolean>;
}> = ({ initial, onClose, onSave }) => {
  const w: any = useWalkie();
  const departments: { id: string; name: string }[] = w.departments || [];
  const isOwner = w.currentUser?.level === 'owner';
  const myDepartment: string = w.currentUser?.departmentId || '';
  const [f, setF] = useState<VendorInput>({
    name: initial?.name || '',
    departmentId: initial?.departmentId || '',
    vendorMode: initial?.vendorMode || '',
    contact: initial?.contact || '',
    phone: initial?.phone || '',
    email: initial?.email || '',
    address: initial?.address || '',
    accountHolder: initial?.accountHolder || '',
    bankName: initial?.bankName || '',
    accountNumber: initial?.accountNumber || '',
    ifsc: initial?.ifsc || '',
    bankBranch: initial?.bankBranch || '',
    upiId: initial?.upiId || '',
    notes: initial?.notes || '',
  });
  const [busy, setBusy] = useState(false);
  const setText = (k: keyof Omit<VendorInput, 'vendorMode' | 'departmentId'>, v: string) =>
    setF(p => ({ ...p, [k]: v }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const ok = await onSave(f);
    setBusy(false);
    if (ok) onClose();
  };
  const field = (
    id: string,
    label: string,
    k: keyof Omit<VendorInput, 'vendorMode' | 'name' | 'departmentId'>,
    type = 'text',
    required = false,
  ) => (
    <div>
      <label className={labelCls(D)} htmlFor={id}>
        {label}
        {required && <span className="ml-1 text-rose-300">*</span>}
      </label>
      <input
        id={id}
        required={required}
        type={type}
        inputMode={k === 'accountNumber' ? 'numeric' : undefined}
        {...(type === 'tel' ? phoneInputProps : {})}
        value={f[k]}
        onChange={e => setText(k, type === 'tel' ? digitsOnly(e.target.value) : e.target.value)}
        className={inputCls(D)}
      />
    </div>
  );
  return (
    <Modal title={initial ? 'Edit vendor' : 'Add vendor'} dark={D} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className={labelCls(D)} htmlFor="vn-n">
              Vendor name
            </label>
            <input
              id="vn-n"
              autoFocus
              required
              value={f.name}
              onChange={e => setText('name', e.target.value)}
              className={inputCls(D)}
            />
          </div>
          <div>
            <label className={labelCls(D)} htmlFor="vn-mode">
              Vendor category
            </label>
            <select
              id="vn-mode"
              required
              value={f.vendorMode}
              onChange={e => setF(p => ({ ...p, vendorMode: e.target.value as VendorMode | '' }))}
              className={inputCls(D)}
            >
              <option value="">Choose category…</option>
              <option value="online">Online marketplace</option>
              <option value="offline">Offline / local vendor</option>
            </select>
            <p className="mt-1 text-[10.5px] text-mute">Amazon / Flipkart or local supplier</p>
          </div>
        </div>
        <div>
          <label className={labelCls(D)} htmlFor="vn-dept">
            Visible to
          </label>
          <select
            id="vn-dept"
            value={f.departmentId}
            onChange={e => setF(p => ({ ...p, departmentId: e.target.value }))}
            className={inputCls(D)}
          >
            <option value="">Shared · every department</option>
            {departments
              .filter(d => isOwner || d.id === myDepartment || d.id === f.departmentId)
              .map(d => (
                <option key={d.id} value={d.id}>
                  Only {d.name}
                </option>
              ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {field('vn-c', 'Contact person', 'contact', 'text', f.vendorMode === 'offline')}
          {field('vn-p', 'Phone', 'phone', 'tel', f.vendorMode === 'offline')}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {field('vn-e', 'Email', 'email', 'email')}
          {f.vendorMode === 'offline' && field('vn-a', 'Vendor address', 'address', 'text', true)}
        </div>
        {f.vendorMode === 'offline' && (
          <section className="space-y-3 rounded-lg border border-line bg-raised/30 p-3">
            <div>
              <h3 className="text-xs font-semibold text-ink">Bank details for offline payments</h3>
              <p className="mt-1 text-[10.5px] text-mute">
                Complete the payee and bank information before saving this local vendor.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {field('vn-holder', 'Account holder', 'accountHolder', 'text', true)}
              {field('vn-bank', 'Bank name', 'bankName', 'text', true)}
              {field('vn-account', 'Account number', 'accountNumber', 'text', true)}
              {field('vn-ifsc', 'IFSC code', 'ifsc', 'text', true)}
              {field('vn-branch', 'Bank branch', 'bankBranch', 'text', true)}
              {field('vn-upi', 'UPI ID', 'upiId')}
            </div>
          </section>
        )}
        {field('vn-t', 'Notes', 'notes')}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnGhost(D)}>
            Cancel
          </button>
          <button type="submit" disabled={busy || !f.name.trim()} className={primary}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
};
