import React, { useState } from 'react';
import { Check, X } from 'lucide-react';
import { Card, Field, btnGhost, btnPrimary, inputCls } from '../../../components/ui';
import { useRequests } from '../RequestsContext';
import type { Req } from '../types';
import { Err } from './shared';

// ── Sub Admin review ───────────────────────────────────────────────────────────────────────────
export const SubReviewPanel: React.FC<{ r: Req }> = ({ r }) => {
  const { subReview } = useRequests();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = async (approve: boolean) => {
    if (!approve && !note.trim()) return setErr('Say why you are rejecting it.');
    setBusy(true);
    setErr('');
    const e = await subReview(r.id, approve, note.trim());
    setBusy(false);
    if (e) setErr(e);
  };
  return (
    <Card title="Your decision" tone="text-amber-300">
      <p className="text-sm text-mute mb-3">
        Approving forwards this request to the Department Head, who can approve it or escalate it to the Super Admin.
      </p>
      <Field label="Comment for the Department Head (required if you reject)">
        <textarea className={inputCls} rows={2} value={note} onChange={e => setNote(e.target.value)} />
      </Field>
      <div className="mt-3">
        <Err msg={err} />
      </div>
      <div className="flex gap-2 justify-end mt-3">
        <button className={btnGhost} disabled={busy} onClick={() => go(false)}>
          <X size={14} />
          Reject
        </button>
        <button className={btnPrimary} disabled={busy} onClick={() => go(true)}>
          <Check size={14} />
          Approve and send to Department Head
        </button>
      </div>
    </Card>
  );
};
