import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Pencil, Radio, Search, Wrench, X } from 'lucide-react';
import { useApp as useWalkie } from '../modules/walkie/context/AppContext';
import { supabase } from '../modules/walkie/lib/supabaseClient';
import { homeDepartmentOf } from './orgData';
import { btnGhost, btnPrimary, inputCls } from '../components/ui';
import { Select } from '../components/Select';

const KINDS: [string, string][] = [
  ['repair', 'Not working / needs repair'],
  ['lost', 'Lost or damaged'],
  ['other', 'Other issue'],
];
const STATUS: Record<string, [string, string]> = {
  open: ['Reported · waiting for Walkie team', 'bg-amber-500/15 text-amber-300'],
  in_repair: ['In repair', 'bg-blue-500/15 text-blue-300'],
  resolved: ['Resolved', 'bg-emerald-500/15 text-emerald-300'],
  dismissed: ['Closed', 'bg-raised text-mute'],
};
const th = 'px-3 py-2.5 text-left font-medium';
const td = 'px-3 py-3 align-middle';

// A department's own walkies: the radios allocated to it, who holds each one (the department decides),
// and problems reported to the Walkie team. The Super Admin sees the department chosen in "Adding to",
// or every department.
export const MyWalkies: React.FC = () => {
  const w: any = useWalkie();
  const { walkies, departments, currentUser, addToast } = w;
  const isOwner = currentUser?.level === 'owner';
  const myDept = homeDepartmentOf(currentUser);
  const deptName = (id: string) => departments.find((d: any) => d.id === id)?.name || 'Department';
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string; contact: string } | null>(null);
  const [reporting, setReporting] = useState<{ id: string; kind: string; issue: string } | null>(null);
  const [issues, setIssues] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const orgId = currentUser?.organizationId;

  const mine = useMemo(
    () =>
      (walkies as any[])
        .filter(r => r.status === 'Allocated' && (myDept ? r.departmentId === myDept : isOwner))
        .sort((a, b) => (a.label || '').localeCompare(b.label || '', undefined, { numeric: true })),
    [walkies, myDept, isOwner],
  );
  const term = query.trim().toLowerCase();
  const shown = mine.filter(
    r =>
      !term ||
      (r.label || '').toLowerCase().includes(term) ||
      (r.assignedPerson?.name || '').toLowerCase().includes(term) ||
      deptName(r.departmentId).toLowerCase().includes(term),
  );

  const loadIssues = useCallback(async () => {
    if (!orgId) return;
    let q = supabase.from('walkie_issues').select('*').eq('organization_id', orgId);
    if (myDept) q = q.eq('department_id', myDept);
    const { data, error } = await q.order('created_at', { ascending: false }).limit(100);
    if (!error) setIssues(data || []);
  }, [orgId, myDept]);
  useEffect(() => {
    void loadIssues();
    if (!orgId) return;
    const ch = supabase
      .channel(`my-walkies-${orgId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'walkie_issues', filter: `organization_id=eq.${orgId}` },
        () => void loadIssues(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [loadIssues, orgId]);
  const openIssue = (id: string) => issues.find(i => i.walkie_id === id && ['open', 'in_repair'].includes(i.status));
  const migrationHint = (msg: string) =>
    /walkie_set_holder|walkie_report_issue|walkie_issues|schema cache/i.test(msg)
      ? 'Run supabase/migration_v118_department_walkies.sql in the Supabase SQL Editor, then reload.'
      : msg;

  const saveHolder = async () => {
    if (!editing) return;
    setBusy(true);
    const { error } = await supabase.rpc('walkie_set_holder', {
      p_walkie: editing.id,
      p_name: editing.name.trim(),
      p_contact: editing.contact.trim(),
    });
    setBusy(false);
    if (error) return addToast?.(migrationHint(error.message), 'error');
    // Realtime updates the radio list; reflect it right away as well.
    w.setWalkies?.((prev: any[]) =>
      prev.map(r =>
        r.id === editing.id
          ? {
              ...r,
              assignedPerson: editing.name.trim()
                ? { name: editing.name.trim(), contact: editing.contact.trim() }
                : null,
            }
          : r,
      ),
    );
    addToast?.(editing.name.trim() ? `Holder saved: ${editing.name.trim()}` : 'Holder cleared.');
    setEditing(null);
  };

  const sendReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reporting || !reporting.issue.trim()) return;
    setBusy(true);
    const { error } = await supabase.rpc('walkie_report_issue', {
      p_walkie: reporting.id,
      p_kind: reporting.kind,
      p_issue: reporting.issue.trim(),
    });
    setBusy(false);
    if (error) return addToast?.(migrationHint(error.message), 'error');
    addToast?.('Reported to the Walkie team.');
    setReporting(null);
    void loadIssues();
  };

  const label = (id: string) => (walkies as any[]).find(r => r.id === id)?.label || id;
  const reportingRadio = reporting ? (walkies as any[]).find(r => r.id === reporting.id) : null;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-blue-500/10 text-blue-400">
              <Radio size={16} />
            </span>
            <h1 className="text-lg font-semibold text-ink">
              {myDept ? `${deptName(myDept)} walkies` : 'Walkies with departments'}
            </h1>
          </div>
          <p className="mt-1 text-xs text-mute">
            Radios given to your department. Choose who holds each one, and report a problem to the Walkie team.
            {isOwner && !myDept && ' Pick a department in “Adding to” to see just one.'}
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input
            className={`${inputCls} pl-8`}
            placeholder="Search radio or holder"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          ['Radios', mine.length, 'text-ink'],
          ['With a holder', mine.filter(r => r.assignedPerson?.name).length, 'text-emerald-300'],
          ['Open reports', issues.filter(i => ['open', 'in_repair'].includes(i.status)).length, 'text-amber-300'],
        ].map(([name, n, tone]) => (
          <div key={name as string} className="rounded-xl border border-line bg-surface px-4 py-3">
            <div className="text-[10.5px] font-semibold uppercase tracking-wider text-faint">{name}</div>
            <div className={`mt-1 text-2xl font-semibold tabular-nums ${tone}`}>{n}</div>
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        {shown.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-xs">
              <thead>
                <tr className="bg-raised/40 text-[10.5px] uppercase tracking-wide text-mute">
                  <th className={th}>Radio</th>
                  {!myDept && <th className={th}>Department</th>}
                  <th className={th}>Channel</th>
                  <th className={th}>Holder</th>
                  <th className={th}>Report</th>
                  <th className={`${th} text-right`}>Action</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(r => {
                  const edit = editing?.id === r.id ? editing : null;
                  const open = openIssue(r.id);
                  return (
                    <tr key={r.id} className="border-t border-line/80 hover:bg-raised/20">
                      <td className={td}>
                        <div className="font-semibold text-ink">{r.label || r.id}</div>
                        <div className="text-[10.5px] text-faint">{r.model || '—'}</div>
                      </td>
                      {!myDept && <td className={`${td} text-ink-soft`}>{deptName(r.departmentId)}</td>}
                      <td className={td}>
                        {r.channel ? (
                          <span className="rounded-md bg-blue-500/10 px-2 py-1 font-semibold text-blue-300">
                            {r.channel}
                          </span>
                        ) : (
                          <span className="text-faint">—</span>
                        )}
                      </td>
                      <td className={td}>
                        {edit ? (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <input
                              autoFocus
                              aria-label="Holder name"
                              className={`${inputCls} !h-8 !w-36 !py-0 text-xs`}
                              placeholder="Name"
                              value={edit.name}
                              onChange={e => setEditing({ ...edit, name: e.target.value })}
                            />
                            <input
                              aria-label="Holder mobile"
                              inputMode="tel"
                              className={`${inputCls} !h-8 !w-32 !py-0 text-xs`}
                              placeholder="Mobile"
                              value={edit.contact}
                              onChange={e => setEditing({ ...edit, contact: e.target.value.replace(/[^\d+ ]/g, '') })}
                            />
                            <button
                              className="rounded-md p-1.5 text-emerald-300 hover:bg-emerald-500/10"
                              disabled={busy}
                              onClick={() => void saveHolder()}
                              aria-label="Save holder"
                            >
                              <Check size={15} />
                            </button>
                            <button
                              className="rounded-md p-1.5 text-mute hover:bg-raised"
                              onClick={() => setEditing(null)}
                              aria-label="Cancel"
                            >
                              <X size={15} />
                            </button>
                          </div>
                        ) : (
                          <button
                            className="group inline-flex items-center gap-1.5 text-left"
                            onClick={() =>
                              setEditing({
                                id: r.id,
                                name: r.assignedPerson?.name || '',
                                contact: r.assignedPerson?.contact || '',
                              })
                            }
                          >
                            {r.assignedPerson?.name ? (
                              <span>
                                <span className="font-medium text-ink">{r.assignedPerson.name}</span>
                                {r.assignedPerson.contact && (
                                  <span className="block text-[10.5px] text-mute">{r.assignedPerson.contact}</span>
                                )}
                              </span>
                            ) : (
                              <span className="text-amber-300">Choose holder</span>
                            )}
                            <Pencil
                              size={11}
                              className="text-faint opacity-0 transition-opacity group-hover:opacity-100"
                            />
                          </button>
                        )}
                      </td>
                      <td className={td}>
                        {open ? (
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${STATUS[open.status][1]}`}
                          >
                            {STATUS[open.status][0]}
                          </span>
                        ) : (
                          <span className="text-faint">—</span>
                        )}
                      </td>
                      <td className={`${td} text-right`}>
                        <button
                          className={btnGhost}
                          disabled={!!open}
                          title={open ? 'Already reported' : 'Report a problem to the Walkie team'}
                          onClick={() => setReporting({ id: r.id, kind: 'repair', issue: '' })}
                        >
                          <Wrench size={13} />
                          Report problem
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-4 py-12 text-center text-xs text-mute">
            {mine.length
              ? 'No radio matches.'
              : 'No walkies are with your department right now. Ask for them from Requests → New request → Event walkies.'}
          </div>
        )}
      </div>

      {issues.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          <div className="border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold text-ink">Reported problems</h2>
            <p className="mt-0.5 text-[11.5px] text-mute">
              What your department reported and what the Walkie team did.
            </p>
          </div>
          <ul className="divide-y divide-line/80">
            {issues.map(i => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-xs">
                <div className="min-w-0">
                  <div className="font-medium text-ink">
                    {label(i.walkie_id)}
                    <span className="ml-1.5 font-normal text-mute">
                      · {KINDS.find(([k]) => k === i.kind)?.[1] || i.kind}
                      {!myDept && ` · ${deptName(i.department_id)}`}
                    </span>
                  </div>
                  <div className="mt-0.5 text-mute">
                    “{i.issue}” — {i.reported_by_name || 'someone'},{' '}
                    {new Date(i.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    {i.note && <span className="text-ink-soft"> · Walkie team: {i.note}</span>}
                  </div>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${STATUS[i.status]?.[1]}`}>
                  {STATUS[i.status]?.[0] || i.status}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {reporting && (
        <div
          className="fixed inset-0 z-50 flex justify-center overflow-y-auto bg-black/60 p-4 [&>*]:my-auto"
          role="dialog"
          aria-modal="true"
          aria-label="Report a walkie problem"
          onClick={() => setReporting(null)}
        >
          <form
            onSubmit={sendReport}
            onClick={e => e.stopPropagation()}
            className="w-full max-w-md space-y-4 rounded-2xl border border-line bg-surface p-5 shadow-2xl"
          >
            <h3 className="flex items-center gap-2 text-base font-semibold text-ink">
              <AlertTriangle size={16} className="text-amber-300" />
              Report a problem · {reportingRadio?.label || reporting.id}
            </h3>
            <label className="block text-xs text-mute">
              What happened?
              <Select
                className={`${inputCls} mt-1`}
                value={reporting.kind}
                onChange={e => setReporting({ ...reporting, kind: e.target.value })}
              >
                {KINDS.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block text-xs text-mute">
              Details *
              <textarea
                autoFocus
                rows={3}
                className={`${inputCls} mt-1`}
                placeholder="e.g. No sound since this morning; battery drains in an hour"
                value={reporting.issue}
                onChange={e => setReporting({ ...reporting, issue: e.target.value })}
              />
            </label>
            <p className="text-[11.5px] text-mute">
              The Walkie team is notified. If it needs repair they take the radio back and fix it.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" className={btnGhost} onClick={() => setReporting(null)}>
                Cancel
              </button>
              <button type="submit" className={btnPrimary} disabled={busy || !reporting.issue.trim()}>
                <Wrench size={13} />
                {busy ? 'Sending…' : 'Send report'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
