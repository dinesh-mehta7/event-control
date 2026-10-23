import React from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { hoverMenuList, hoverMenuPanel, useHoverMenu } from '../hooks/useHoverMenu';

// Pick-one list that opens on hover, used in place of a native <select> (which cannot open on hover).
export const HoverSelect: React.FC<{
  value: string;
  options: readonly (readonly [string, string])[];
  onChange: (value: string) => void;
  label: string;
  className?: string;
  align?: 'left' | 'right';
}> = ({ value, options, onChange, label, className = '', align = 'right' }) => {
  const { open, setOpen, ref, hover, trigger } = useHoverMenu();
  const current = options.find(([id]) => id === value)?.[1] ?? options[0]?.[1] ?? '';
  return (
    <div className="relative min-w-0" ref={ref} {...hover}>
      <button
        type="button"
        className={`flex min-w-0 items-center gap-1.5 ${className}`}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        {...trigger}
      >
        <span className="truncate">{current}</span>
        <ChevronDown size={14} className={`shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      <div className={hoverMenuPanel(open, align)}>
        <div role="listbox" aria-label={label} className={hoverMenuList + ' max-h-80 overflow-y-auto'}>
          {options.map(([id, text]) => (
            <button
              key={id}
              type="button"
              role="option"
              aria-selected={id === value}
              onClick={() => {
                onChange(id);
                setOpen(false);
              }}
              className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors hover:bg-raised hover:text-ink ${id === value ? 'bg-raised text-ink' : 'text-ink-soft'}`}
            >
              <span className="truncate">{text}</span>
              {id === value && <Check size={13} className="shrink-0 text-blue-400" />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
