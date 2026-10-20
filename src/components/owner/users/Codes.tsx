import React, { useState } from 'react';
import { KeyRound, RefreshCw, Copy } from 'lucide-react';
import { useAccess } from '../../../context/AccessContext';
import { DEPTS } from '../../../views/orgData';
import { Empty } from '../../ui';
import type { SubDepartmentId } from '../../../types';

export const Codes: React.FC = () => {
  const { codes, regenerate, isOwner } = useAccess();
  const [msg, setMsg] = useState('');
  const copy = async (c: string) => {
    try {
      await navigator.clipboard.writeText(c);
      setMsg('Copied.');
    } catch {
      setMsg('Copy failed.');
    }
    setTimeout(() => setMsg(''), 1500);
  };
  const keys = (Object.keys(DEPTS) as SubDepartmentId[]).filter(k => codes[k]);
  return (
    <div className="rounded-xl border border-line bg-surface overflow-hidden">
      <div className="px-4 py-3 border-b border-line flex items-center justify-between">
        <div className="text-sm font-semibold text-ink flex items-center gap-2">
          <KeyRound size={15} className="text-blue-400" />
          Sign-up codes
        </div>
        <span className="text-xs text-mute">{msg}</span>
      </div>
      <p className="px-4 pt-3 text-xs text-mute">
        Give a department its code. A new person enters it when signing up and then waits for the owner's approval.
        Regenerate a code if it leaks.
      </p>
      <ul className="divide-y divide-line">
        {keys.map(k => (
          <li key={k} className="px-4 py-2.5 flex items-center justify-between gap-3">
            <span className="text-sm text-ink">{DEPTS[k]}</span>
            <span className="flex items-center gap-2">
              <code className="text-sm tabular-nums tracking-wider text-ink-soft bg-raised px-2 py-0.5 rounded">
                {codes[k]}
              </code>
              <button
                className="p-1.5 rounded-lg text-mute hover:bg-raised hover:text-ink"
                aria-label={`Copy ${DEPTS[k]} code`}
                onClick={() => copy(codes[k]!)}
              >
                <Copy size={14} />
              </button>
              {isOwner && (
                <button
                  className="p-1.5 rounded-lg text-mute hover:bg-raised hover:text-ink"
                  aria-label={`New code for ${DEPTS[k]}`}
                  onClick={async () => {
                    const e = await regenerate(k);
                    setMsg(e || 'New code created.');
                  }}
                >
                  <RefreshCw size={14} />
                </button>
              )}
            </span>
          </li>
        ))}
        {!keys.length && (
          <li>
            <Empty>No codes yet. Run migration_v15 in the Supabase SQL Editor.</Empty>
          </li>
        )}
      </ul>
    </div>
  );
};
