import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

// Switches between pages or tab panels the way the sign-in card does: the old view slides out
// and blurs away, then the new one slides in from the side of the tab you picked, its sections
// arriving in a short cascade. The old view keeps its state while it leaves.
const OUT_MS = 200;

const reduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const Swap: React.FC<{
  k: string;
  // Position of a key in its tab bar / menu, so the slide comes from the right side. -1 = unknown.
  indexOf?: (k: string) => number;
  className?: string;
  children: React.ReactNode;
}> = ({ k, indexOf, className = '', children }) => {
  const [settled, setSettled] = useState(k);
  const [dx, setDx] = useState(1);
  const live = useRef<React.ReactNode>(children);
  const leaving = k !== settled;
  if (!leaving) live.current = children;

  useLayoutEffect(() => {
    if (!leaving || !indexOf) return;
    const a = indexOf(settled), b = indexOf(k);
    setDx(a >= 0 && b >= 0 && b < a ? -1 : 1);
  }, [k, settled, leaving, indexOf]);

  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => setSettled(k), reduced() ? 0 : OUT_MS);
    return () => clearTimeout(t);
  }, [k, leaving]);

  return (
    <div key={settled} className={`${leaving ? 'vt-out' : 'vt-in'} ${className}`} style={{ '--dx': dx } as React.CSSProperties}>
      {leaving ? live.current : children}
    </div>
  );
};
