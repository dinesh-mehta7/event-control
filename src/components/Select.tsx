import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { useHoverMenu } from '../hooks/useHoverMenu';
import { useAnimatedPresence } from '../hooks/useAnimatedPresence';

// Drop-in for <select> that opens on hover. Takes the same props and <option>/<optgroup> children.
// A hidden native <select> stays underneath, so `required`, `name`, form submit and
// onChange handlers reading e.target.value keep working unchanged.
// The list is portaled to <body>, so modals and tables with overflow never clip it.

type Opt = { value: string; label: React.ReactNode; disabled?: boolean; group?: string };

const readOptions = (children: React.ReactNode, group?: string, out: Opt[] = []) => {
  React.Children.forEach(children, child => {
    if (!React.isValidElement(child)) return;
    const el = child as React.ReactElement<any>;
    if (el.type === React.Fragment) readOptions(el.props.children, group, out);
    else if (el.type === 'optgroup') readOptions(el.props.children, el.props.label, out);
    else if (el.type === 'option') {
      if (el.props.hidden) return;
      const text = el.props.children;
      out.push({
        value: String(el.props.value ?? (typeof text === 'string' || typeof text === 'number' ? text : '')),
        label: text,
        disabled: el.props.disabled,
        group,
      });
    }
  });
  return out;
};

type Props = Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'multiple'> & {
  openOnHover?: boolean;
  smoothMotion?: boolean;
};

// Plain text of an option label, for type-to-jump.
const textOf = (node: React.ReactNode): string =>
  typeof node === 'string' || typeof node === 'number'
    ? String(node)
    : Array.isArray(node)
      ? node.map(textOf).join('')
      : React.isValidElement(node)
        ? textOf((node.props as any).children)
        : '';

export const Select: React.FC<Props> = ({
  value,
  defaultValue,
  onChange,
  children,
  className = '',
  disabled,
  required,
  name,
  id,
  style,
  openOnHover = true,
  smoothMotion = false,
  title,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledby,
  'aria-describedby': ariaDescribedby,
}) => {
  const options = readOptions(children);
  const [inner, setInner] = useState(() => String(defaultValue ?? options[0]?.value ?? ''));
  const current = value !== undefined && value !== null ? String(value) : inner;
  // Same as React's native select: with no matching option, the first enabled option shows.
  const selected = options.find(o => o.value === current) ?? options.find(o => !o.disabled);
  const native = useRef<HTMLSelectElement>(null);
  const { open, setOpen, ref, panelRef, hover, trigger } = useHoverMenu<HTMLButtonElement>(150, openOnHover);
  const present = useAnimatedPresence(open, smoothMotion ? 280 : 200);
  const [pos, setPos] = useState<React.CSSProperties>({});
  const [forceDark, setForceDark] = useState(false);

  const choose = (v: string) => {
    setOpen(false);
    if (v === current) return;
    setInner(v);
    const el = native.current;
    if (el) el.value = v;
    onChange?.({ target: el, currentTarget: el } as unknown as React.ChangeEvent<HTMLSelectElement>);
  };

  // Place the list under the button (above it when there is no room below) and follow scrolling.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const btn = ref.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      const below = window.innerHeight - r.bottom;
      const up = below < 260 && r.top > below;
      const maxHeight = Math.min(288, (up ? r.top : below) - 16);
      setPos({
        left: Math.max(8, Math.min(r.left, window.innerWidth - Math.max(r.width, 176) - 8)),
        minWidth: Math.max(r.width, 176),
        maxWidth: Math.max(window.innerWidth - 16, 176),
        maxHeight,
        ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
      });
    };
    place();
    // A dark-only dialog inside a light theme keeps its dark look for the list too.
    setForceDark(!!ref.current?.closest('.dark') && !document.documentElement.classList.contains('dark'));
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  // Keyboard: arrows on the closed button step through options like a native select;
  // inside the open list they move focus between options.
  const step = (dir: 1 | -1) => {
    const usable = options.filter(o => !o.disabled);
    const i = usable.findIndex(o => o.value === current);
    const next = usable[Math.min(usable.length - 1, Math.max(0, i + dir))];
    if (next) choose(next.value);
  };
  // Type-to-jump like a native select: letters typed within 700ms build one search.
  const typed = useRef({ text: '', at: 0 });
  const findTyped = (key: string) => {
    if (key.length !== 1 || !key.trim()) return null;
    const now = Date.now();
    typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : '') + key.toLowerCase(), at: now };
    return options.find(o => !o.disabled && textOf(o.label).trim().toLowerCase().startsWith(typed.current.text)) ?? null;
  };
  const onListKey = (e: React.KeyboardEvent) => {
    const hit = !e.ctrlKey && !e.metaKey && !e.altKey ? findTyped(e.key) : null;
    if (hit) {
      e.preventDefault();
      panelRef.current
        ?.querySelector<HTMLButtonElement>(`[data-value="${CSS.escape(hit.value)}"]`)
        ?.focus();
      return;
    }
    if (e.key === 'Escape' || e.key === 'Tab') {
      setOpen(false);
      ref.current?.focus();
      if (e.key === 'Escape') e.preventDefault();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = Array.from(panelRef.current?.querySelectorAll<HTMLButtonElement>('[role=option]:not(:disabled)') || []);
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    items[Math.min(items.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
  };
  // Opened from the keyboard: move focus to the chosen option.
  useLayoutEffect(() => {
    if (!open || document.activeElement !== ref.current) return;
    const id = requestAnimationFrame(() =>
      panelRef.current?.querySelector<HTMLButtonElement>('[aria-selected=true], [role=option]:not(:disabled)')?.focus(),
    );
    return () => cancelAnimationFrame(id);
  }, [open]);

  let lastGroup: string | undefined;
  return (
    <>
      <button
        ref={ref}
        type="button"
        id={id}
        data-select=""
        disabled={disabled}
        title={title}
        style={style}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledby}
        aria-describedby={ariaDescribedby}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`text-left ${className}`}
        {...hover}
        {...trigger}
        onKeyDown={e => {
          if (open) return;
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            step(e.key === 'ArrowDown' ? 1 : -1);
            return;
          }
          const hit = !e.ctrlKey && !e.metaKey && !e.altKey ? findTyped(e.key) : null;
          if (hit) {
            e.preventDefault();
            choose(hit.value);
          }
        }}
      >
        <span className="flex w-full min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate">{selected?.label ?? ''}</span>
          <ChevronDown
            size={14}
            className={`shrink-0 opacity-60 transition-transform ${smoothMotion ? 'duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)]' : 'duration-200'} ${open ? 'rotate-180' : ''}`}
          />
        </span>
      </button>
      <select
        ref={native}
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        name={name}
        required={required}
        disabled={disabled}
        value={current}
        onChange={() => {}}
        onInvalid={() => ref.current?.focus()}
      >
        {children}
      </select>
      {present &&
        createPortal(
          <div
            ref={panelRef}
            role="listbox"
            aria-label={ariaLabel}
            aria-hidden={!open}
            {...({ inert: !open } as any)}
            {...hover}
            onKeyDown={onListKey}
            style={pos}
            className={`${forceDark ? 'dark ' : ''}fixed z-[200] overflow-y-auto rounded-xl border border-line bg-surface p-1.5 text-ink shadow-2xl transition-[opacity,transform] ${smoothMotion ? 'duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)]' : 'duration-200 ease-out'} ${
              open ? 'translate-y-0 scale-100 opacity-100' : 'pointer-events-none -translate-y-1 scale-95 opacity-0'
            }`}
          >
            {options.map(o => {
              const heading = o.group !== lastGroup && o.group ? o.group : null;
              lastGroup = o.group;
              const on = o.value === current;
              return (
                <React.Fragment key={`${o.group ?? ''}:${o.value}`}>
                  {heading && (
                    <div className="px-2.5 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wider text-faint">
                      {heading}
                    </div>
                  )}
                  <button
                    type="button"
                    role="option"
                    aria-selected={on}
                    data-value={o.value}
                    disabled={o.disabled}
                    onClick={() => choose(o.value)}
                    className={`flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-xs transition-colors hover:bg-raised hover:text-ink focus-visible:bg-raised disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent ${on ? 'bg-raised font-medium text-ink' : 'text-ink-soft'}`}
                  >
                    <span className="min-w-0 truncate">{o.label}</span>
                    {on && <Check size={13} className="shrink-0 text-blue-400" />}
                  </button>
                </React.Fragment>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
};
