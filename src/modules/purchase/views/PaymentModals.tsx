import React, { useState } from 'react';
import { Modal, btnGhost, cx, inputCls, labelCls } from '../../accommodation/ui';
import { usePurchase } from '../PurchaseContext';
import { PAY_MODES, poDue, poTotal } from '../types';
import { supabase } from '../../walkie/lib/supabaseClient';
import { useWalkie } from '../../walkie';
import { D, good, money, primary } from './shared';

// ---- record payment ----------------------------------------------------------

// ---- a reason box (reject an order / a payment) ---------------------------------
export const ReasonModal: React.FC<{
  title: string;
  body: string;
  confirm: string;
  onSubmit: (note: string) => Promise<boolean>;
  onClose: () => void;
}> = ({ title, body, confirm, onSubmit, onClose }) => {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!note.trim()) return setErr('Please write the reason. The other person will read it.');
    setBusy(true);
    const ok = await onSubmit(note.trim());
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <Modal title={title} dark={D} onClose={onClose}>
      <form onSubmit={go} className="space-y-3">
        <p className="text-sm text-mute">{body}</p>
        <textarea
          autoFocus
          rows={3}
          aria-label="Reason"
          className={inputCls(D)}
          value={note}
          onChange={e => {
            setNote(e.target.value);
            setErr('');
          }}
        />
        {err && (
          <p role="alert" className="text-xs text-rose-400">
            {err}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnGhost(D)}>
            Cancel
          </button>
          <button type="submit" disabled={busy} className={cx(primary, 'bg-rose-600 hover:bg-rose-500')}>
            {busy ? 'Saving…' : confirm}
          </button>
        </div>
      </form>
    </Modal>
  );
};

// ---- Purchase asks for a payment -------------------------------------------------
export const AskPayModal: React.FC<{ id: string; onClose: () => void }> = ({ id, onClose }) => {
  const { orders, payRequests, askPayment } = usePurchase();
  const o = orders.find(x => x.id === id);
  const asked = payRequests
    .filter(r => r.poId === id && (r.status === 'pending' || r.status === 'approved'))
    .reduce((a, r) => a + r.amount, 0);
  const left = o ? Math.max(0, Math.round((poDue(o) - asked) * 100) / 100) : 0;
  const [amount, setAmount] = useState(left ? String(left) : '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  if (!o) return null;
  const amt = parseFloat(amount) || 0;
  const problem = amt > left + 0.009 ? `Only ${money(left)} can still be asked for.` : '';
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!(amt > 0) || problem) return;
    setBusy(true);
    const ok = await askPayment(o.id, amt, note.trim());
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <Modal title={`Ask for a payment · ${o.number}`} dark={D} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <div className="rounded-xl border border-line bg-canvas/60 px-4 py-3 text-xs grid grid-cols-3 gap-3 text-center">
          {(
            [
              ['Order total', poTotal(o), ''],
              ['Paid', o.paid, 'text-emerald-400'],
              ['Can still ask', left, 'text-amber-300'],
            ] as const
          ).map(([l, v, c]) => (
            <div key={l}>
              <div className="text-faint">{l}</div>
              <div className={cx('font-bold tabular-nums', c)}>{money(v)}</div>
            </div>
          ))}
        </div>
        <div>
          <label className={labelCls(D)} htmlFor="ap-a">
            Amount (₹)
          </label>
          <input
            id="ap-a"
            autoFocus
            inputMode="decimal"
            value={amount}
            onChange={e => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
            className={inputCls(D)}
          />
        </div>
        <div>
          <label className={labelCls(D)} htmlFor="ap-n">
            What is it for? (advance, balance on delivery…)
          </label>
          <input id="ap-n" value={note} onChange={e => setNote(e.target.value)} className={inputCls(D)} />
        </div>
        <p className="text-xs text-mute">
          Save the payment request here, then record it after the payment is made. No further approval is needed.
        </p>
        {problem && (
          <p role="alert" className="text-xs text-rose-400">
            {problem}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnGhost(D)}>
            Cancel
          </button>
          <button type="submit" disabled={!(amt > 0) || !!problem || busy} className={primary}>
            {busy ? 'Saving…' : 'Save payment request'}
          </button>
        </div>
      </form>
    </Modal>
  );
};

// ---- Purchase pays an approved request -----------------------------------------------
export const PayNowModal: React.FC<{ id: string; onClose: () => void }> = ({ id, onClose }) => {
  const { payRequests, orders, vendors, payNow, userName, canPay } = usePurchase();
  const auth: any = useWalkie();
  const r = payRequests.find(x => x.id === id);
  const o = r ? orders.find(x => x.id === r.poId) : undefined;
  const vendor = o?.vendorId ? vendors.find(row => row.id === o.vendorId) : undefined;
  const [mode, setMode] = useState('bank');
  const [ref, setRef] = useState('');
  const [paidBy, setPaidBy] = useState(userName);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [billFile, setBillFile] = useState<File | null>(null);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState('');
  if (!r || !o) return null;
  const uploadFile = async (file: File | null, kind: 'bill' | 'proof') => {
    if (!file) return '';
    const organizationId = auth.currentUser?.organizationId;
    if (!organizationId) throw new Error('Organization could not be identified.');
    const ext =
      file.name
        .split('.')
        .pop()
        ?.toLowerCase()
        .replace(/[^a-z0-9]/g, '') || 'file';
    const path = `${organizationId}/${r.id}/${kind}-${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage
      .from('purchase-payment-documents')
      .upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
    if (error) throw error;
    return path;
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canPay) return;
    setFileError('');
    setBusy(true);
    const uploaded: string[] = [];
    try {
      const billPath = await uploadFile(billFile, 'bill');
      if (billPath) uploaded.push(billPath);
      const proofPath = await uploadFile(proofFile, 'proof');
      if (proofPath) uploaded.push(proofPath);
      const ok = await payNow(r.id, { mode, ref, paidBy, note, billPath, proofPath });
      if (!ok && uploaded.length) await supabase.storage.from('purchase-payment-documents').remove(uploaded);
      if (ok) onClose();
    } catch (error: any) {
      if (uploaded.length) await supabase.storage.from('purchase-payment-documents').remove(uploaded);
      setFileError(error?.message || 'Could not upload the payment attachments.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`Pay · ${o.number}`} dark={D} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          Record the payment of <b className="tabular-nums">{money(r.amount)}</b>
          {r.note ? ` (${r.note})` : ''}.
        </div>
        {vendor?.vendorMode === 'offline' && (
          <section className="rounded-lg border border-line bg-raised/30 p-3">
            <h3 className="text-xs font-semibold text-ink">Offline vendor payment details · {vendor.name}</h3>
            <dl className="mt-2 grid gap-x-4 gap-y-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
              {[
                ['Account holder', vendor.accountHolder],
                ['Account number', vendor.accountNumber],
                ['Bank', vendor.bankName],
                ['IFSC', vendor.ifsc],
                ['Branch', vendor.bankBranch],
                ['UPI ID', vendor.upiId],
                ['Contact', vendor.contact],
                ['Phone', vendor.phone],
                ['Address', vendor.address],
              ]
                .filter(([, value]) => value)
                .map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-[10.5px] text-mute">{label}</dt>
                    <dd className="break-words font-medium text-ink">{value}</dd>
                  </div>
                ))}
            </dl>
          </section>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls(D)} htmlFor="pn-m">
              Paid via
            </label>
            <select id="pn-m" value={mode} onChange={e => setMode(e.target.value)} className={inputCls(D)}>
              {PAY_MODES.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls(D)} htmlFor="pn-r">
              UTR / cheque / voucher no.
            </label>
            <input id="pn-r" autoFocus value={ref} onChange={e => setRef(e.target.value)} className={inputCls(D)} />
          </div>
          <div>
            <label className={labelCls(D)} htmlFor="pn-p">
              Paid by
            </label>
            <input id="pn-p" value={paidBy} onChange={e => setPaidBy(e.target.value)} className={inputCls(D)} />
          </div>
          <div>
            <label className={labelCls(D)} htmlFor="pn-n">
              Note (optional)
            </label>
            <input id="pn-n" value={note} onChange={e => setNote(e.target.value)} className={inputCls(D)} />
          </div>
        </div>
        <div className="rounded-lg border border-line bg-raised/30 p-3">
          <div className="mb-2">
            <h3 className="text-xs font-semibold text-ink">
              Payment attachments <span className="font-normal text-mute">· optional</span>
            </h3>
            <p className="mt-1 text-[10.5px] text-mute">
              Attach a bill, payment proof, or both. PDF, JPG, PNG, or WebP files up to 10 MB each.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={labelCls(D)}>
              Bill
              <input
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                onChange={e => {
                  const file = e.target.files?.[0] || null;
                  if (file && file.size > 10 * 1024 * 1024) {
                    setFileError('Each attachment must be 10 MB or smaller.');
                    e.target.value = '';
                    return;
                  }
                  if (file && !['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
                    setFileError('Choose a PDF, JPG, PNG, or WebP file.');
                    e.target.value = '';
                    return;
                  }
                  setBillFile(file);
                  setFileError('');
                }}
                className="mt-1 block w-full text-xs file:mr-2 file:rounded-md file:border-0 file:bg-raised file:px-2 file:py-1.5 file:text-ink"
              />
            </label>
            <label className={labelCls(D)}>
              Payment proof
              <input
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                onChange={e => {
                  const file = e.target.files?.[0] || null;
                  if (file && file.size > 10 * 1024 * 1024) {
                    setFileError('Each attachment must be 10 MB or smaller.');
                    e.target.value = '';
                    return;
                  }
                  if (file && !['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
                    setFileError('Choose a PDF, JPG, PNG, or WebP file.');
                    e.target.value = '';
                    return;
                  }
                  setProofFile(file);
                  setFileError('');
                }}
                className="mt-1 block w-full text-xs file:mr-2 file:rounded-md file:border-0 file:bg-raised file:px-2 file:py-1.5 file:text-ink"
              />
            </label>
          </div>
          {fileError && (
            <p role="alert" className="mt-2 text-xs text-rose-300">
              {fileError}
            </p>
          )}
        </div>
        {!canPay && (
          <p role="alert" className="text-xs text-rose-300">
            Only Accounts team members can record payments.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnGhost(D)}>
            Cancel
          </button>
          <button type="submit" disabled={busy || !canPay || !!fileError} className={good}>
            {busy ? 'Saving payment…' : 'Record payment'}
          </button>
        </div>
      </form>
    </Modal>
  );
};
