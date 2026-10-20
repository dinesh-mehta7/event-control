import React, { useState } from 'react';
import { KeyRound, RefreshCw, Copy } from 'lucide-react';
import { useAccess } from '../../../context/AccessContext';
import type { JoinCode } from '../../../context/AccessContext';
import { useApp as useWalkie } from '../../../modules/walkie/context/AppContext';
import { DEPTS } from '../../../views/orgData';
import { Empty } from '../../ui';

// Sign-up codes, one per department + sub-department. The database shows the Super Admin every
// department's codes, a Department Head their own department's, a Sub-department Head their own code.
export const Codes: React.FC = () => {
  const { codes, regenerate, isOwner } = useAccess();
  const departments: { id: string; name: string }[] = (useWalkie() as any).departments || [];
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
  const order = Object.keys(DEPTS);
  const rank = (c: JoinCode) => (order.includes(c.sub) ? order.indexOf(c.sub) : order.length);
  const groups = departments
    .map(d => ({ d, rows: codes.filter(c => c.departmentId === d.id).sort((a, b) => rank(a) - rank(b)) }))
    .filter(g => g.rows.length);

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
        Each code joins one department and one of its sub-departments. A new person enters it when signing up and then
        waits for the Super Admin's approval. Regenerate a code if it leaks.
      </p>
      {groups.map(({ d, rows }) => (
        <section key={d.id} className="mt-3">
          <h3 className="border-y border-line bg-raised/40 px-4 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-faint">
            {d.name}
          </h3>
          <ul className="divide-y divide-line">
            {rows.map(c => {
              const label = (DEPTS as Record<string, string>)[c.sub] || c.sub;
              return (
                <li key={c.sub} className="px-4 py-2.5 flex items-center justify-between gap-3">
                  <span className="text-sm text-ink">{label}</span>
                  <span className="flex items-center gap-2">
                    <code className="text-sm tabular-nums tracking-wider text-ink-soft bg-raised px-2 py-0.5 rounded">
                      {c.code}
                    </code>
                    <button
                      className="p-1.5 rounded-lg text-mute hover:bg-raised hover:text-ink"
                      aria-label={`Copy ${d.name} ${label} code`}
                      onClick={() => copy(c.code)}
                    >
                      <Copy size={14} />
                    </button>
                    {isOwner && (
                      <button
                        className="p-1.5 rounded-lg text-mute hover:bg-raised hover:text-ink"
                        aria-label={`New code for ${d.name} ${label}`}
                        onClick={async () => {
                          const e = await regenerate(c.sub, d.id);
                          setMsg(e || 'New code created.');
                        }}
                      >
                        <RefreshCw size={14} />
                      </button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {!groups.length && (
        <Empty>No codes yet. Run migration_v99_department_membership.sql in the Supabase SQL Editor.</Empty>
      )}
    </div>
  );
};
