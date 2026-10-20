import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronLeft, Download, Search, Trash2 } from 'lucide-react';
import { DEPT_OPTIONS } from '../../accommodation/types';
import { Modal, ConfirmModal, btnGhost, btnPrimary, cx, inputCls } from '../../accommodation/ui';
import { useManpower } from '../ManpowerContext';
import type { SewadarInput } from '../ManpowerContext';
import { DEVICES, OUTCOME_LABEL } from '../types';
import type { Arrival, ArrivalTimeOfDay, DeviceType, Sewadar, SewadarMemberType } from '../types';
import { digitsOnly, phoneInputProps } from '../../../lib/phone';
import { D, emptySewadar, panel } from './shared';

const clock = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '';

// Tag input for skills: type one and press Enter or comma (or pick a suggestion) to add it; × or Backspace removes.
const SkillsInput: React.FC<{ value: string[]; onChange: (skills: string[]) => void }> = ({ value, onChange }) => {
  const { sewadars } = useManpower();
  const [draft, setDraft] = useState('');
  const known = useMemo(() => {
    const seen = new Map<string, string>();
    sewadars.forEach(s =>
      (s.skills || []).forEach(skill => {
        const k = skill.trim().toLocaleLowerCase();
        if (k && !seen.has(k)) seen.set(k, skill.trim());
      }),
    );
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [sewadars]);
  const has = (skill: string) => value.some(v => v.toLocaleLowerCase() === skill.toLocaleLowerCase());
  const add = (raw: string) => {
    const next = raw
      .split(/[,;]/)
      .map(s => s.trim())
      .filter(s => s && !has(s));
    if (next.length)
      onChange([
        ...value,
        ...next.filter((s, i) => next.findIndex(o => o.toLocaleLowerCase() === s.toLocaleLowerCase()) === i),
      ]);
    setDraft('');
  };
  const suggestions = known.filter(s => !has(s));
  return (
    <div className="text-xs text-mute sm:col-span-2 lg:col-span-3">
      Skills
      <div className={cx(inputCls(D), 'mt-1 flex flex-wrap items-center gap-1.5 !py-1.5')}>
        {value.map(skill => (
          <span
            key={skill}
            className="inline-flex items-center gap-1 rounded-md bg-blue-500/15 px-2 py-0.5 text-xs font-medium text-blue-300"
          >
            {skill}
            <button
              type="button"
              className="rounded text-blue-300/80 hover:text-white"
              aria-label={`Remove ${skill}`}
              onClick={() => onChange(value.filter(v => v !== skill))}
            >
              ×
            </button>
          </span>
        ))}
        <input
          list="sewadar-skill-suggestions"
          value={draft}
          aria-label="Add a skill"
          placeholder={value.length ? 'Add another skill…' : 'e.g. First aid — press Enter to add'}
          onChange={e => {
            const v = e.target.value;
            if (/[,;]/.test(v)) add(v);
            else if (suggestions.some(s => s === v)) add(v);
            else setDraft(v);
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (draft.trim()) add(draft);
            } else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
          }}
          onBlur={() => {
            if (draft.trim()) add(draft);
          }}
          className="min-w-[10rem] flex-1 bg-transparent py-0.5 text-sm text-ink outline-none placeholder:text-faint"
        />
        <datalist id="sewadar-skill-suggestions">
          {suggestions.map(s => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </div>
      <span className="mt-1 block text-[11px] text-faint">
        Add as many as you need. Press Enter or comma after each skill.
      </span>
    </div>
  );
};

export const SewadarForm: React.FC<{
  initial: Sewadar | null;
  defaultMemberType?: SewadarMemberType;
  teams: { id: string; name: string; lead: string; members: Sewadar[] }[];
  onClose: () => void;
  onSave: (i: SewadarInput) => Promise<boolean>;
  onDelete?: () => Promise<boolean>;
  fullPage?: boolean;
  showArrivalSchedule?: boolean;
  onSetArrival?: (arrival: Arrival) => Promise<boolean>;
  onSetBadge?: (issued: boolean) => Promise<boolean>;
  onSetBadgeReturned?: (returned: boolean) => Promise<boolean>;
  onCallHistory?: () => void;
}> = ({
  initial,
  defaultMemberType = 'monthly',
  teams,
  onClose,
  onSave,
  onDelete,
  fullPage = false,
  showArrivalSchedule = false,
  onSetArrival,
  onSetBadge,
  onSetBadgeReturned,
  onCallHistory,
}) => {
  const [f, setF] = useState<SewadarInput>(() =>
    initial
      ? {
          name: initial.name,
          memberType: initial.memberType,
          serialNo: initial.serialNo,
          batchNo: initial.batchNo,
          phone: initial.phone,
          department: initial.department,
          relation: initial.relation,
          relationName: initial.relationName,
          villageCity: initial.villageCity,
          branch: initial.branch,
          occupation: initial.occupation,
          remarks: initial.remarks,
          joiningDate: initial.joiningDate,
          employeeCode: initial.employeeCode,
          employeeId: initial.employeeId,
          address: initial.address,
          address2: initial.address2,
          expectedArrival: initial.expectedArrival,
          expectedArrivalPeriod: initial.expectedArrivalPeriod,
          skills: initial.skills || [],
          teamName: initial.teamName,
          teamLead: initial.teamLead,
          teams: initial.teams || (initial.teamName ? [initial.teamName] : []),
          shift: initial.shift,
          deviceType: initial.deviceType,
          deviceRef: initial.deviceRef,
        }
      : { ...emptySewadar(), memberType: defaultMemberType },
  );
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState(false);
  const [teamPickerOpen, setTeamPickerOpen] = useState(false);
  const [teamQuery, setTeamQuery] = useState('');
  const ownLeaderTeams = teams.filter(
    team => team.lead.trim().toLocaleLowerCase() === f.name.trim().toLocaleLowerCase(),
  );
  const filteredTeams = teams.filter(
    team =>
      team.name.toLowerCase().includes(teamQuery.trim().toLowerCase()) &&
      (!ownLeaderTeams.length || ownLeaderTeams.some(own => own.id === team.id)),
  );
  const set = <K extends keyof SewadarInput>(k: K, v: SewadarInput[K]) => setF(p => ({ ...p, [k]: v }));
  const field = (
    k: Exclude<keyof SewadarInput, 'memberType' | 'deviceType' | 'skills'>,
    label: string,
    type = 'text',
  ) => (
    <label key={k} className="text-xs text-mute">
      {label}
      <input
        required={k === 'name'}
        autoFocus={k === 'name' && !initial}
        type={type}
        {...(type === 'tel' ? phoneInputProps : {})}
        value={f[k]}
        onChange={e => set(k, type === 'tel' ? digitsOnly(e.target.value) : e.target.value)}
        className={cx(inputCls(D), 'mt-1')}
      />
    </label>
  );
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const saved = ownLeaderTeams.length
      ? {
          ...f,
          teams: (f.teams || []).filter(name =>
            ownLeaderTeams.some(team => team.name.toLocaleLowerCase() === name.toLocaleLowerCase()),
          ),
          teamName: ownLeaderTeams[0].name,
          teamLead: ownLeaderTeams[0].lead,
        }
      : f;
    const ok = await onSave(saved);
    setBusy(false);
    if (ok) onClose();
  };
  const downloadRecord = () => {
    if (!initial) return;
    const record: Record<string, string> = {
      ...Object.fromEntries(Object.entries(f).map(([key, value]) => [key, String(value ?? '')])),
      arrival: initial.arrival,
      arrived_at: initial.arrivedAt || '',
      badge: initial.badgeIssued ? 'Issued' : 'Pending',
      badge_at: initial.badgeAt || '',
      call_count: String(initial.callCount),
      last_call_outcome: initial.lastCallOutcome ? OUTCOME_LABEL[initial.lastCallOutcome] : '',
      last_call_at: initial.lastCallAt || '',
    };
    const csv = [['Field', 'Value'], ...Object.entries(record)]
      .map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${
      initial.name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_') || 'member'
    }_record.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  const formContent = (
    <form onSubmit={submit} className="space-y-4">
      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-mute">Member record</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {field('name', 'Full name')}
          <label className="text-xs text-mute">
            Member type
            {f.memberType === 'salary_based' ? (
              <div className={cx(inputCls(D), 'mt-1 flex items-center')}>Permanent</div>
            ) : (
              <select
                value={f.memberType}
                onChange={e => set('memberType', e.target.value as SewadarMemberType)}
                className={cx(inputCls(D), 'mt-1')}
              >
                <option value="monthly">Regular</option>
                <option value="annual">Annual</option>
              </select>
            )}
          </label>
          {field('serialNo', 'Sr. No.')}
          {field('batchNo', 'Badge no.')}
          {field('relation', 'Relation')}
          {field('relationName', 'Relation name')}
          {field('phone', 'Mobile', 'tel')}
          {field('villageCity', 'Village / city')}
          {field('branch', 'Branch')}
          {field('occupation', 'Occupation')}
          {field('employeeCode', 'Employee code')}
          {field('employeeId', 'Employee ID')}
          {field('address', 'Address')}
          {field('address2', 'Address 2')}
          {field('remarks', 'Remarks')}
          <SkillsInput value={f.skills || []} onChange={skills => set('skills', skills)} />
        </div>
      </section>
      <section className="space-y-3 border-t border-line pt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-mute">Sewa and team assignment</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-xs text-mute">
            Sub-department
            <select
              value={f.department}
              onChange={e => set('department', e.target.value)}
              className={cx(inputCls(D), 'mt-1')}
            >
              <option value="">Not assigned</option>
              {DEPT_OPTIONS.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          {showArrivalSchedule && f.memberType !== 'salary_based' && (
            <>
              {field('expectedArrival', 'Expected arrival date', 'date')}
              <label className="text-xs text-mute">
                Expected arrival time
                <select
                  value={f.expectedArrivalPeriod}
                  onChange={e => set('expectedArrivalPeriod', e.target.value as ArrivalTimeOfDay)}
                  className={cx(inputCls(D), 'mt-1')}
                >
                  <option value="">Not set</option>
                  <option value="morning">Morning</option>
                  <option value="noon">Noon</option>
                  <option value="evening">Evening</option>
                  <option value="night">Night</option>
                </select>
              </label>
            </>
          )}
          <fieldset className="text-xs text-mute sm:col-span-2">
            <legend className="mb-1">Teams (choose any that apply)</legend>
            <button
              type="button"
              aria-expanded={teamPickerOpen}
              onClick={() => {
                setTeamPickerOpen(open => !open);
                setTeamQuery('');
              }}
              className={cx(inputCls(D), 'mt-1 flex min-h-10 items-center justify-between gap-2 text-left')}
            >
              <span className="truncate">
                {(f.teams || []).length ? (f.teams || []).join(', ') : 'Search and choose teams…'}
              </span>
              <ChevronDown className={cx('h-4 w-4 shrink-0 transition-transform', teamPickerOpen && 'rotate-180')} />
            </button>
            {teamPickerOpen && (
              <div className="mt-1 overflow-hidden rounded-md border border-line bg-surface shadow-lg">
                <div className="relative border-b border-line p-2">
                  <Search className="absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
                  <input
                    autoFocus
                    value={teamQuery}
                    onChange={e => setTeamQuery(e.target.value)}
                    placeholder="Search teams…"
                    aria-label="Search teams"
                    className="h-9 w-full rounded-md border border-line bg-field pl-8 pr-3 text-xs text-ink outline-none placeholder:text-faint focus:border-blue-500"
                  />
                </div>
                <div role="group" aria-label="Available teams" className="max-h-40 overflow-y-auto p-1.5">
                  {filteredTeams.map(team => (
                    <label
                      key={team.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-2 hover:bg-raised"
                    >
                      <input
                        type="checkbox"
                        checked={(f.teams || []).some(n => n.toLowerCase() === team.name.toLowerCase())}
                        onChange={e =>
                          setF(p => {
                            const next = e.target.checked
                              ? Array.from(new Set([...(p.teams || []), team.name]))
                              : (p.teams || []).filter(n => n.toLowerCase() !== team.name.toLowerCase());
                            return {
                              ...p,
                              teams: next,
                              teamName: next[0] || '',
                              teamLead: teams.find(t => t.name === next[0])?.lead || '',
                            };
                          })
                        }
                      />
                      <span className="min-w-0 flex-1 truncate text-ink">{team.name}</span>
                      {team.lead && (
                        <span className="max-w-32 truncate text-[10.5px] text-faint">Lead: {team.lead}</span>
                      )}
                    </label>
                  ))}
                  {!teams.length && (
                    <span className="block px-2 py-3 text-center text-faint">Create teams in the Teams tab first.</span>
                  )}
                  {!!teams.length && !filteredTeams.length && (
                    <span className="block px-2 py-3 text-center text-faint">No teams match that search.</span>
                  )}
                </div>
                {!!(f.teams || []).length && (
                  <div className="flex items-center justify-between border-t border-line px-2 py-1.5">
                    <span className="text-[10.5px] text-mute">{f.teams.length} selected</span>
                    <button
                      type="button"
                      className="text-[10.5px] font-medium text-blue-300 hover:text-blue-200"
                      onClick={() => setF(p => ({ ...p, teams: [], teamName: '', teamLead: '' }))}
                    >
                      Clear selection
                    </button>
                  </div>
                )}
              </div>
            )}
          </fieldset>
          <label className="text-xs text-mute">
            Issued device
            <select
              value={f.deviceType}
              onChange={e => set('deviceType', e.target.value as DeviceType)}
              className={cx(inputCls(D), 'mt-1')}
            >
              {DEVICES.map(d => (
                <option key={d.key} value={d.key}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          {field('deviceRef', 'Device ID / serial')}
        </div>
      </section>
      <div className="flex items-center justify-between gap-2 pt-1">
        {onDelete ? (
          <button type="button" className={cx(btnGhost(D), 'text-rose-400')} onClick={() => setDel(true)}>
            <Trash2 className="w-3.5 h-3.5" />
            Delete
          </button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className={btnGhost(D)}>
            Cancel
          </button>
          <button type="submit" disabled={busy} className={btnPrimary}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </form>
  );
  const deleteDialog = del && onDelete && (
    <ConfirmModal
      dark={D}
      title={`Delete ${initial?.name}?`}
      body="Their call history is removed too."
      confirmLabel="Delete"
      onConfirm={async () => {
        if (await onDelete()) onClose();
      }}
      onClose={() => setDel(false)}
    />
  );
  if (fullPage && initial)
    return (
      <section className="mx-auto w-full max-w-6xl space-y-3">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <button
              type="button"
              onClick={onClose}
              className="mb-1 inline-flex items-center gap-1 text-xs font-medium text-blue-300 hover:text-blue-200"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Back to Sewadars
            </button>
            <h1 className="truncate text-lg font-bold text-ink">{f.name || initial.name}</h1>
            <p className="text-xs text-mute">Member record · edit full details and download this member’s record</p>
          </div>
          <button type="button" onClick={downloadRecord} className={cx(btnGhost(D), 'px-2.5 py-1.5 text-xs')}>
            <Download className="h-3.5 w-3.5" />
            Download record
          </button>
        </header>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <label className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface/50 px-3 py-2 text-xs">
            <span className="text-mute">Arrival</span>
            <select
              value={initial.arrival}
              onChange={e => onSetArrival?.(e.target.value as Arrival)}
              className="max-w-[150px] rounded border border-line bg-field px-2 py-1 text-xs text-ink"
            >
              <option value="pending">Expected</option>
              <option value="arrived">Arrived</option>
              <option value="not_coming">Not coming</option>
            </select>
          </label>
          <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface/50 px-3 py-2 text-xs">
            <span className="text-mute">Arrived at</span>
            <span className="font-medium text-ink">{clock(initial.arrivedAt) || '—'}</span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface/50 px-3 py-2 text-xs">
            <span className="text-mute">Badge</span>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cx(
                  'font-medium',
                  initial.badgeReturned ? 'text-cyan-300' : initial.badgeIssued ? 'text-emerald-300' : 'text-amber-300',
                )}
              >
                {initial.badgeReturned ? 'Returned' : initial.badgeIssued ? 'Issued' : 'Pending'}
              </span>
              {!initial.badgeIssued && (
                <button
                  type="button"
                  onClick={() => onSetBadge?.(true)}
                  className="rounded-md bg-amber-500/10 px-2 py-1 text-xs font-semibold text-amber-300"
                >
                  Issue badge
                </button>
              )}
              {initial.badgeIssued && !initial.badgeReturned && (
                <button
                  type="button"
                  onClick={() => onSetBadgeReturned?.(true)}
                  className="rounded-md bg-cyan-500/10 px-2 py-1 text-xs font-semibold text-cyan-300"
                >
                  Mark returned
                </button>
              )}
              {initial.badgeIssued && (
                <button
                  type="button"
                  onClick={() => onSetBadge?.(false)}
                  className="rounded-md px-2 py-1 text-xs font-semibold text-ink-soft hover:bg-raised"
                >
                  Reset
                </button>
              )}
            </div>
          </div>
          {onCallHistory && (
            <button
              type="button"
              onClick={onCallHistory}
              className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface/50 px-3 py-2 text-left text-xs hover:bg-raised"
            >
              <span className="text-mute">Call history</span>
              <span className="font-medium text-blue-300">
                {initial.callCount} call{initial.callCount === 1 ? '' : 's'} · View
              </span>
            </button>
          )}
        </div>
        <div className={cx(panel, 'p-3 sm:p-4')}>{formContent}</div>
        {deleteDialog}
      </section>
    );
  return (
    <Modal title={initial ? `Edit ${initial.name}` : 'Add sewadar'} dark={D} onClose={onClose} xl>
      {formContent}
      {deleteDialog}
    </Modal>
  );
};
