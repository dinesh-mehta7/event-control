import React, { useLayoutEffect, useRef, useState } from 'react';

// A tab bar whose highlight glides to the active tab with a soft spring, like the sign-in tabs.
// Mark the active child with aria-current="page", aria-pressed="true", aria-selected="true" or data-active="true".
const ACTIVE = ':scope > [aria-current="page"], :scope > [aria-pressed="true"], :scope > [aria-selected="true"], :scope > [data-active="true"]';

export const SlideNav: React.FC<React.HTMLAttributes<HTMLElement> & {
  variant?: 'pill' | 'underline';
  as?: 'nav' | 'div';
}> = ({ variant = 'pill', as = 'nav', className = '', children, ...rest }) => {
  const ref = useRef<HTMLElement>(null);
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => {
      const a = node.querySelector<HTMLElement>(ACTIVE);
      setBox(a ? { x: a.offsetLeft, y: a.offsetTop, w: a.offsetWidth, h: a.offsetHeight } : null);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    Array.from(node.children).forEach(c => ro.observe(c));
    const mo = new MutationObserver(measure);
    mo.observe(node, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-current', 'aria-pressed', 'aria-selected', 'data-active'] });
    const r = requestAnimationFrame(() => requestAnimationFrame(() => setReady(true)));
    return () => { ro.disconnect(); mo.disconnect(); cancelAnimationFrame(r); };
  }, []);

  const Tag = as as any;
  const style: React.CSSProperties = box
    ? variant === 'pill'
      ? { width: box.w, height: box.h, transform: `translate(${box.x}px, ${box.y}px)` }
      : { width: box.w, transform: `translateX(${box.x}px)` }
    : { opacity: 0 };
  return (
    <Tag ref={ref} className={`slide-nav relative ${className}`} {...rest}>
      <span aria-hidden className={`slide-ind slide-ind-${variant} ${ready ? 'ready' : ''}`} style={style} />
      {children}
    </Tag>
  );
};
