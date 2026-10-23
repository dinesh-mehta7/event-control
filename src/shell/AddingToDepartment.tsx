import React, { useEffect, useState } from 'react';
import { supabase } from '../modules/walkie/lib/supabaseClient';
import { useApp as useWalkie } from '../modules/walkie/context/AppContext';
import { Select } from '../components/Select';

// Super Admin only. The Super Admin belongs to no department, so this says which department the sewadars,
// rooms, meals, teams, tasks, events and meetings they create go to. "Organisation-wide" makes events, meetings
// and tasks visible to every department (sewadars, rooms, meals and teams always need a department).
export const AddingToDepartment: React.FC<{ dark: boolean }> = ({ dark }) => {
  const w: any = useWalkie();
  const u = w.currentUser;
  const departments: { id: string; name: string }[] = w.departments || [];
  const [value, setValue] = useState<string>(u?.workingDepartmentId || '');
  const [busy, setBusy] = useState(false);
  useEffect(() => setValue(u?.workingDepartmentId || ''), [u?.workingDepartmentId]);
  if (u?.level !== 'owner' || !departments.length) return null;

  const choose = async (id: string) => {
    const before = value;
    setValue(id);
    setBusy(true);
    const { error } = await supabase
      .from('profiles')
      .update({ working_department_id: id || null })
      .eq('id', u.id);
    setBusy(false);
    if (error) {
      setValue(before);
      w.addToast?.(
        /working_department_id/i.test(error.message)
          ? 'Run supabase/migration_v102_department_people_tasks_events.sql in the Supabase SQL Editor, then reload.'
          : `Could not save: ${error.message}`,
        'error',
      );
    }
  };

  return (
    <label className="flex min-w-0 items-center gap-1.5 rounded-full border border-line bg-raised/60 px-2 py-1.5 text-[11.5px] text-mute sm:gap-2 sm:px-3 sm:text-xs">
      <span className="hidden whitespace-nowrap sm:inline">Adding to</span>
      <Select
        aria-label="Department new records go to"
        className="max-w-[24vw] cursor-pointer rounded-md border-0 bg-transparent py-0.5 pl-1 pr-5 font-semibold text-ink outline-none focus:ring-1 focus:ring-blue-500 sm:max-w-[14rem]"
        style={{ colorScheme: dark ? 'dark' : 'light' }}
        value={value}
        disabled={busy}
        onChange={e => void choose(e.target.value)}
      >
        <option className="bg-surface text-ink" value="">
          Organisation-wide
        </option>
        {departments.map(d => (
          <option className="bg-surface text-ink" key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </Select>
    </label>
  );
};
