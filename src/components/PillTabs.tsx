import React, { useLayoutEffect, useRef, useState } from 'react';

// Pill-style switcher whose highlight slides from the old choice to the new one
// (the pill counterpart of the underline in <Tabs>).
//   solid     → blue pill, white text (module switchers)
//   segmented → raised white pill on a grey track (two/three-way view toggles)
export const PillTabs: React.FC<{
  tabs: { id: string; label: React.ReactNode; icon?: React.ComponentType<{ className?: string }> }[];
  value: string;
  onChange: (id: string) => void;
  label: string;
  variant?: 'solid' | 'segmented';
  className?: string;
  itemClassName?: string;
}> = ({ tabs, value, onChange, label, variant = 'solid', className = 'gap-1', itemClassName = 'px-3 py-2 text-xs' }) => {
  const root = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState({ x: 0, y: 0, w: 0, h: 0 });
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    const measure = () => {
      const active = node.querySelector<HTMLElement>(`[data-pill-id="${CSS.escape(value)}"]`);
      if (active) setPill({ x: active.offsetLeft, y: active.offsetTop, w: active.offsetWidth, h: active.offsetHeight });
    };
    measure();
    const frame = requestAnimationFrame(() => setReady(true));
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [value, tabs.length]);
  const solid = variant === 'solid';
  return (
    <div ref={root} role="tablist" aria-label={label} className={`relative flex flex-wrap ${className}`}>
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute left-0 top-0 ${solid ? 'rounded-lg bg-blue-600 shadow-sm' : 'rounded-md bg-surface shadow-sm ring-1 ring-line/60'} ${ready ? 'transition-[transform,width,height] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]' : ''}`}
        style={{ width: pill.w, height: pill.h, transform: `translate(${pill.x}px, ${pill.y}px)` }}
      />
      {tabs.map(({ id, label: text, icon: Icon }) => {
        const on = id === value;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={on}
            data-pill-id={id}
            onClick={() => onChange(id)}
            className={`relative z-[1] inline-flex items-center justify-center gap-1.5 font-medium transition-colors duration-200 ${solid ? 'rounded-lg' : 'rounded-md'} ${itemClassName} ${
              on ? (solid ? 'text-white' : 'text-ink') : 'text-mute hover:text-ink'
            }`}
          >
            {Icon && <Icon className="h-3.5 w-3.5" />}
            {text}
          </button>
        );
      })}
    </div>
  );
};
