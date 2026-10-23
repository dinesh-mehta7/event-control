import React, { useEffect, useRef, useState } from 'react';

// Keep the outgoing view mounted until its soft directional transition finishes.
export const Swap: React.FC<{
  k: string;
  indexOf?: (k: string) => number;
  className?: string;
  children: React.ReactNode;
}> = ({ k, indexOf, className = '', children }) => {
  const [current, setCurrent] = useState({ key: k, children });
  const [phase, setPhase] = useState<'visible' | 'exiting' | 'entering'>('visible');
  const [direction, setDirection] = useState<'next' | 'previous'>('next');
  const latestChildren = useRef(children);
  latestChildren.current = children;

  useEffect(() => {
    if (k === current.key) return;

    const from = indexOf?.(current.key) ?? -1;
    const to = indexOf?.(k) ?? -1;
    setDirection(from < 0 || to < 0 || to >= from ? 'next' : 'previous');
    setPhase('exiting');
    const exitTimer = window.setTimeout(() => {
      setCurrent({ key: k, children: latestChildren.current });
      setPhase('entering');
    }, 200);

    return () => window.clearTimeout(exitTimer);
  }, [k, current.key]);

  useEffect(() => {
    if (phase !== 'entering' || current.key !== k) return;
    const enterTimer = window.setTimeout(() => setPhase('visible'), 300);
    return () => window.clearTimeout(enterTimer);
  }, [phase, current.key, k]);

  return (
    <div
      className={`${className} ${
        phase === 'exiting'
          ? `module-transition-out-${direction}`
          : phase === 'entering'
            ? `module-transition-in-${direction}`
            : ''
      }`}
    >
      {/* Same view: render live children so filters/state inside it still update. Only the outgoing view is a snapshot. */}
      {current.key === k ? children : current.children}
    </div>
  );
};
