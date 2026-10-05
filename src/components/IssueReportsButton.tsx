import React, { useEffect, useState } from 'react';
import { CircleAlert, X } from 'lucide-react';
import { useApp as useWalkie } from '../modules/walkie/context/AppContext';
import { supabase } from '../modules/walkie/lib/supabaseClient';

type Kind = 'material' | 'site_event';
type Issue = { id: string; kind: Kind; material: string; location: string; title: string; details: string; status: 'open' | 'in_progress' | 'resolved'; reporter_name: string; created_at: string };
const statusLabel: Record<Issue['status'], string> = { open: 'Open', in_progress: 'In progress', resolved: 'Resolved' };

export const IssueReportsButton: React.FC = () => {
  const auth: any = useWalkie();
  const user = auth.currentUser;
  const canManage = ['owner', 'dept_head', 'sub_dept_head'].includes(user?.level);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>('material');
  const [material, setMaterial] = useState('');
  const [location, setLocation] = useState('');
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [issues, setIssues] = useState<Issue[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = async () => {
    const { data, error: loadError } = await supabase.from('member_issues').select('*').order('created_at', { ascending: false }).limit(80);
    if (loadError) setError(/does not exist|schema cache/i.test(loadError.message) ? 'Run migration_v32_member_issue_reports.sql in Supabase to enable issue reports.' : loadError.message);
    else setIssues((data || []) as Issue[]);
  };
  useEffect(() => {
    const openFromNotification = () => { setOpen(true); setError(''); void load(); };
    window.addEventListener('open-issue-reports', openFromNotification);
    return () => window.removeEventListener('open-issue-reports', openFromNotification);
  }, []);
  useEffect(() => { if (open) { setError(''); void load(); } }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.id || !user?.organizationId || !title.trim() || (kind === 'material' && !material.trim())) return;
    setBusy(true); setError(''); setNotice('');
    const { error: saveError } = await supabase.from('member_issues').insert({
      organization_id: user.organizationId, reporter_id: user.id, reporter_name: user.name || user.email || 'Member',
      kind, material: material.trim(), location: location.trim(), title: title.trim(), details: details.trim(),
    });
    setBusy(false);
    if (saveError) { setError(/does not exist|schema cache/i.test(saveError.message) ? 'Run migration_v32_member_issue_reports.sql in Supabase to enable issue reports.' : saveError.message); return; }
    setMaterial(''); setLocation(''); setTitle(''); setDetails(''); setNotice('Report sent. Team leads will follow up.');
    await load();
  };
  const updateStatus = async (issue: Issue, status: Issue['status']) => {
    const { error: statusError } = await supabase.rpc('set_member_issue_status', { p_id: issue.id, p_status: status });
    if (statusError) setError(statusError.message); else await load();
  };

  return <>
    <button type="button" onClick={() => setOpen(true)} aria-label="Report an issue or complaint" title="Report an issue"
      className="p-2 rounded-lg text-mute transition-colors hover:bg-raised hover:text-ink"><CircleAlert size={18} /></button>
    {open && <div className="fixed inset-0 z-[70] grid place-items-center bg-black/60 p-4" onMouseDown={e => { if (e.target === e.currentTarget) setOpen(false); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="issue-report-title" className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-2xl">
        <header className="flex items-center justify-between border-b border-line px-4 py-3"><div><h2 id="issue-report-title" className="font-semibold text-ink">Report an issue</h2><p className="text-xs text-mute">Quickly report a material problem or a site/event complaint.</p></div><button type="button" onClick={() => setOpen(false)} aria-label="Close issue reports" className="rounded-md p-1.5 text-mute hover:bg-raised"><X size={17} /></button></header>
        <div className="overflow-y-auto p-4 space-y-4">
          <form onSubmit={submit} className="space-y-3 rounded-lg border border-line bg-raised/30 p-3">
            <div className="flex gap-2"><button type="button" onClick={() => setKind('material')} aria-pressed={kind === 'material'} className={`rounded-md px-3 py-2 text-xs font-semibold ${kind === 'material' ? 'bg-blue-600 text-white' : 'text-mute hover:bg-raised'}`}>Material issue</button><button type="button" onClick={() => setKind('site_event')} aria-pressed={kind === 'site_event'} className={`rounded-md px-3 py-2 text-xs font-semibold ${kind === 'site_event' ? 'bg-blue-600 text-white' : 'text-mute hover:bg-raised'}`}>Site / event complaint</button></div>
            <div className="grid gap-2 sm:grid-cols-2">{kind === 'material' && <input required value={material} onChange={e => setMaterial(e.target.value)} placeholder="Material or equipment" aria-label="Material or equipment" className="w-full rounded-md border border-line bg-field px-3 py-2 text-sm text-ink placeholder:text-faint" />}<input value={location} onChange={e => setLocation(e.target.value)} placeholder="Site or location (optional)" aria-label="Site or location" className="w-full rounded-md border border-line bg-field px-3 py-2 text-sm text-ink placeholder:text-faint" /><input required value={title} onChange={e => setTitle(e.target.value)} placeholder="What is the issue?" aria-label="Issue summary" maxLength={160} className="w-full rounded-md border border-line bg-field px-3 py-2 text-sm text-ink placeholder:text-faint sm:col-span-2" /></div>
            <textarea value={details} onChange={e => setDetails(e.target.value)} placeholder="Add details (optional)" aria-label="Issue details" rows={2} maxLength={4000} className="w-full rounded-md border border-line bg-field px-3 py-2 text-sm text-ink placeholder:text-faint" />
            {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}{notice && <p role="status" className="text-xs text-emerald-300">{notice}</p>}
            <div className="flex justify-end"><button type="submit" disabled={busy} className="rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50">{busy ? 'Sending…' : 'Send report'}</button></div>
          </form>
          <div><h3 className="mb-2 text-sm font-semibold text-ink">{canManage ? 'Issue inbox' : 'My reports'}</h3><ul className="divide-y divide-line rounded-lg border border-line">
            {issues.map(issue => <li key={issue.id} className="flex flex-wrap items-start justify-between gap-3 p-3"><div className="min-w-0 flex-1"><div className="text-sm font-medium text-ink">{issue.title}</div><div className="mt-0.5 text-xs text-mute">{issue.kind === 'material' ? `Material · ${issue.material}` : 'Site / event'}{issue.location ? ` · ${issue.location}` : ''} · {canManage ? `${issue.reporter_name} · ` : ''}{new Date(issue.created_at).toLocaleString('en-IN')}</div>{issue.details && <p className="mt-1 whitespace-pre-wrap text-xs text-ink-soft">{issue.details}</p>}</div>{canManage ? <select aria-label={`Status for ${issue.title}`} value={issue.status} onChange={e => void updateStatus(issue, e.target.value as Issue['status'])} className="rounded-md border border-line bg-field px-2 py-1.5 text-xs text-ink">{Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select> : <span className="rounded-full bg-raised px-2 py-1 text-[10px] text-mute">{statusLabel[issue.status]}</span>}</li>)}
            {!issues.length && <li className="p-5 text-center text-xs text-mute">{error ? 'Reports are not available yet.' : 'No reports yet.'}</li>}
          </ul></div>
        </div>
      </section>
    </div>}
  </>;
};
