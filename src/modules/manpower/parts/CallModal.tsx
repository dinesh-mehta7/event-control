import React, { useEffect, useState } from 'react';
import { History, Phone } from 'lucide-react';
import { Modal, btnPrimary, cx, inputCls } from '../../accommodation/ui';
import { useManpower } from '../ManpowerContext';
import { OUTCOMES, OUTCOME_LABEL, OUTCOME_TONE } from '../types';
import type { CallLog, Sewadar } from '../types';
import { D } from './shared';

const TONE: Record<string, string> = {
  ok: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  warn: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  bad: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  mute: 'bg-raised text-mute border-line-strong',
};

export const CallModal: React.FC<{ s: Sewadar; onClose: () => void }> = ({ s, onClose }) => {
  const { logCall, fetchCalls, canManage, sewadars } = useManpower();
  const live = sewadars.find(x => x.id === s.id) || s;
  const [outcome, setOutcome] = useState<string>('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [hist, setHist] = useState<CallLog[] | null>(null);
  useEffect(() => {
    let on = true;
    fetchCalls(s.id).then(h => on && setHist(h));
    return () => {
      on = false;
    };
  }, [s.id, live.callCount]); // eslint-disable-line
  const save = async () => {
    if (!outcome) return;
    setBusy(true);
    const ok = await logCall(s.id, outcome as any, note);
    setBusy(false);
    if (ok) {
      setOutcome('');
      setNote('');
    }
  };
  return (
    <Modal title={live.name} dark={D} onClose={onClose} wide>
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="text-sm text-mute">
          {live.callCount} call{live.callCount === 1 ? '' : 's'} so far
        </div>
        {live.phone && (
          <a href={`tel:${live.phone}`} className={cx(btnPrimary, 'bg-emerald-600 hover:bg-emerald-500')}>
            <Phone className="w-4 h-4" />
            Call {live.phone}
          </a>
        )}
      </div>
      {canManage && (
        <div className="space-y-3 mb-5">
          <div className="text-xs font-semibold text-mute">What happened on the call?</div>
          <div className="flex flex-wrap gap-2">
            {OUTCOMES.map(o => (
              <button
                key={o.key}
                type="button"
                aria-pressed={outcome === o.key}
                onClick={() => setOutcome(o.key)}
                className={cx(
                  'text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors',
                  outcome === o.key ? 'bg-blue-600 border-blue-500 text-white' : TONE[o.tone],
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
          <input
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Note (optional) — e.g. reaching by 6 PM"
            className={inputCls(D)}
          />
          <div className="flex justify-end">
            <button className={btnPrimary} disabled={!outcome || busy} onClick={save}>
              {busy ? 'Saving…' : 'Log call'}
            </button>
          </div>
        </div>
      )}
      <div className="flex items-center gap-2 text-xs font-semibold text-mute mb-2">
        <History className="w-3.5 h-3.5" />
        Call history
      </div>
      {hist === null ? (
        <p className="text-sm text-faint">Loading…</p>
      ) : hist.length === 0 ? (
        <p className="text-sm text-faint">No calls logged yet.</p>
      ) : (
        <ul className="divide-y divide-line max-h-56 overflow-y-auto">
          {hist.map(h => (
            <li key={h.id} className="py-2 flex items-start justify-between gap-3 text-sm">
              <div>
                <span
                  className={cx('text-xs font-semibold px-2 py-0.5 rounded-full border', TONE[OUTCOME_TONE[h.outcome]])}
                >
                  {OUTCOME_LABEL[h.outcome]}
                </span>
                {h.note && <div className="text-xs text-mute mt-1">{h.note}</div>}
              </div>
              <div className="text-xs text-faint text-right shrink-0">
                {new Date(h.calledAt).toLocaleString('en-IN', {
                  day: 'numeric',
                  month: 'short',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
                <br />
                {h.calledBy}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
};
