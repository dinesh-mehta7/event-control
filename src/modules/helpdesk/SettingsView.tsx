import React, { useEffect, useState } from 'react';
import { Edit3, Plus, Trash2, X } from 'lucide-react';
import { inputCls, labelCls } from '../accommodation/ui';
import { D, Section, cx, ghost, iconBtn, primary } from '../inventory/ui/kit';
import type { Helpdesk } from './useHelpdesk';
import { PRIORITIES } from './types';
import type { Settings } from './types';

export const SettingsView: React.FC<{ hd: Helpdesk }> = ({ hd }) => {
  const [s, setS] = useState<Settings>(hd.settings);
  const [newCat, setNewCat] = useState('');
  const [busy, setBusy] = useState(false);
  const [canned, setCanned] = useState<{ id?: string; title: string; body: string } | null>(null);
  useEffect(() => {
    setS(hd.settings);
  }, [hd.settings]);
  const dirty = JSON.stringify(s) !== JSON.stringify(hd.settings);
  const ro = !hd.canConfigure;
  const save = async () => {
    setBusy(true);
    await hd.saveSettings(s);
    setBusy(false);
  };
  const implicit = (level: string) => level === 'owner' || level === 'dept_head';

  return (
    <div className="space-y-4">
      {ro && (
        <p className="rounded-lg border border-line bg-raised/40 p-3 text-xs text-mute">
          Only the Super Admin and Department Heads can change SLA, categories and technicians. You can manage canned
          replies.
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Section
          title="SLA (hours to resolve)"
          hint="Sets each new ticket's due time. Changing a ticket's priority re-plans its due time."
        >
          <div className="grid grid-cols-2 gap-3 p-4">
            {PRIORITIES.map(p => (
              <div key={p.key}>
                <label className={labelCls(D)} htmlFor={`sla-${p.key}`}>
                  {p.label}
                </label>
                <input
                  id={`sla-${p.key}`}
                  type="number"
                  min={1}
                  disabled={ro}
                  value={s.slaHours[p.key]}
                  onChange={e =>
                    setS(x => ({
                      ...x,
                      slaHours: { ...x.slaHours, [p.key]: Math.max(1, Number(e.target.value) || 1) },
                    }))
                  }
                  className={inputCls(D)}
                />
              </div>
            ))}
          </div>
        </Section>
        <Section title="Categories" hint="Shown on the submit form and used in filters and reports.">
          <div className="p-4">
            <div className="flex flex-wrap gap-1.5">
              {s.categories.map(c => (
                <span
                  key={c}
                  className="inline-flex items-center gap-1 rounded-full border border-line-strong bg-raised px-2.5 py-1 text-xs text-ink-soft"
                >
                  {c}
                  {!ro && (
                    <button
                      type="button"
                      aria-label={`Remove ${c}`}
                      onClick={() => setS(x => ({ ...x, categories: x.categories.filter(y => y !== c) }))}
                      className="text-mute hover:text-rose-300"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </span>
              ))}
            </div>
            {!ro && (
              <form
                className="mt-3 flex gap-2"
                onSubmit={e => {
                  e.preventDefault();
                  const n = newCat.trim();
                  if (n && !s.categories.some(c => c.toLowerCase() === n.toLowerCase()))
                    setS(x => ({ ...x, categories: [...x.categories, n] }));
                  setNewCat('');
                }}
              >
                <input
                  value={newCat}
                  onChange={e => setNewCat(e.target.value)}
                  placeholder="New category"
                  aria-label="New category"
                  className={inputCls(D)}
                />
                <button className={ghost} disabled={!newCat.trim()}>
                  <Plus className="h-3.5 w-3.5" />
                  Add
                </button>
              </form>
            )}
          </div>
        </Section>
      </div>
      <Section
        title="Technicians"
        hint="Who can work tickets. The Super Admin and Department Heads are always technicians."
      >
        <ul className="grid gap-1 p-3 sm:grid-cols-2 xl:grid-cols-3">
          {hd.people.map(p => {
            const on = implicit(p.level) || s.technicianIds.includes(p.id);
            return (
              <li key={p.id}>
                <label
                  className={cx(
                    'flex items-center gap-2 rounded-md px-2 py-1.5 text-xs',
                    on ? 'text-ink' : 'text-mute',
                    !ro && !implicit(p.level) && 'cursor-pointer hover:bg-raised',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={ro || implicit(p.level)}
                    onChange={() =>
                      setS(x => ({
                        ...x,
                        technicianIds: x.technicianIds.includes(p.id)
                          ? x.technicianIds.filter(i => i !== p.id)
                          : [...x.technicianIds, p.id],
                      }))
                    }
                    className="h-3.5 w-3.5 accent-blue-600"
                  />
                  <span className="truncate">{p.name}</span>
                  {implicit(p.level) && <span className="text-[10.5px] text-faint">· always</span>}
                </label>
              </li>
            );
          })}
        </ul>
      </Section>
      <Section
        title="Auto-assignment rules"
        hint="New tickets in a category go straight to its technician. Leave a category on Nobody to keep it Unassigned."
      >
        <ul className="grid gap-x-6 gap-y-2 p-4 sm:grid-cols-2">
          {s.categories.map(c => (
            <li key={c} className="grid grid-cols-[minmax(0,1fr)_12rem] items-center gap-3 text-xs">
              <span className="truncate text-ink-soft" title={c}>
                {c}
              </span>
              <select
                value={s.categoryRules[c] || ''}
                disabled={ro}
                onChange={e =>
                  setS(x => {
                    const rules = { ...x.categoryRules };
                    if (e.target.value) rules[c] = e.target.value;
                    else delete rules[c];
                    return { ...x, categoryRules: rules };
                  })
                }
                aria-label={`Technician for ${c}`}
                className="h-8 rounded-md border border-line bg-field px-2 text-xs text-ink outline-none focus:border-blue-500 disabled:opacity-60"
              >
                <option value="">Nobody (Unassigned)</option>
                {hd.people
                  .filter(p => implicit(p.level) || s.technicianIds.includes(p.id))
                  .map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </li>
          ))}
        </ul>
      </Section>
      {!ro && (
        <div className="flex justify-end gap-2">
          <button className={ghost} disabled={!dirty} onClick={() => setS(hd.settings)}>
            Discard
          </button>
          <button className={primary} disabled={!dirty || busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      )}

      <Section
        title="Canned replies"
        hint="Insert them from the reply box on any ticket."
        action={
          <button className={ghost} onClick={() => setCanned({ title: '', body: '' })}>
            <Plus className="h-3.5 w-3.5" />
            Add reply
          </button>
        }
      >
        {canned && (
          <form
            className="space-y-2 border-b border-line p-4"
            onSubmit={async e => {
              e.preventDefault();
              if (await hd.saveCanned(canned)) setCanned(null);
            }}
          >
            <div>
              <label className={labelCls(D)} htmlFor="cr-t">
                Title
              </label>
              <input
                id="cr-t"
                required
                autoFocus
                value={canned.title}
                onChange={e => setCanned(c => c && { ...c, title: e.target.value })}
                className={inputCls(D)}
              />
            </div>
            <div>
              <label className={labelCls(D)} htmlFor="cr-b">
                Message
              </label>
              <textarea
                id="cr-b"
                rows={3}
                required
                value={canned.body}
                onChange={e => setCanned(c => c && { ...c, body: e.target.value })}
                className={inputCls(D)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className={ghost} onClick={() => setCanned(null)}>
                Cancel
              </button>
              <button className={primary}>Save reply</button>
            </div>
          </form>
        )}
        {!hd.canned.length && !canned ? (
          <p className="p-6 text-center text-xs text-faint">
            No canned replies yet — e.g. "Restart the device", "Need more details".
          </p>
        ) : (
          <ul className="divide-y divide-line/70">
            {hd.canned.map(c => (
              <li key={c.id} className="flex items-start gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-ink">{c.title}</div>
                  <p className="line-clamp-2 text-xs text-mute">{c.body}</p>
                </div>
                <button className={iconBtn} aria-label={`Edit ${c.title}`} onClick={() => setCanned(c)}>
                  <Edit3 className="h-3.5 w-3.5" />
                </button>
                <button
                  className={cx(iconBtn, 'hover:text-rose-400')}
                  aria-label={`Delete ${c.title}`}
                  onClick={() => void hd.deleteCanned(c.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
};
