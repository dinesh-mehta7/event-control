import React from 'react';
import { useApp as useWalkie } from '../modules/walkie/context/AppContext';

// One dropdown of the organization's departments, used wherever a department is picked or filtered.
// `emptyOption` adds a first option with value '' (e.g. "Choose a department"); `allOption` adds one with
// value 'all' (e.g. "All departments").
export const DepartmentSelect: React.FC<{
  value: string;
  onChange: (departmentId: string) => void;
  className?: string;
  emptyOption?: string;
  allOption?: string;
  id?: string;
  required?: boolean;
  disabled?: boolean;
  'aria-label'?: string;
}> = ({ value, onChange, className = filterCls, emptyOption, allOption, ...rest }) => {
  const departments: { id: string; name: string }[] = (useWalkie() as any).departments || [];
  return (
    <select
      aria-label={rest['aria-label'] || 'Department'}
      id={rest.id}
      required={rest.required}
      disabled={rest.disabled}
      value={value}
      onChange={e => onChange(e.target.value)}
      className={className}
    >
      {emptyOption !== undefined && <option value="">{emptyOption}</option>}
      {allOption !== undefined && <option value="all">{allOption}</option>}
      {departments.map(d => (
        <option key={d.id} value={d.id}>
          {d.name}
        </option>
      ))}
    </select>
  );
};

// The compact filter look used in page headers (Inventory, Procurement, staffing).
export const filterCls =
  'h-8 max-w-[14rem] rounded-md border border-line bg-field px-2 text-xs font-medium text-ink outline-none focus:border-blue-500';
