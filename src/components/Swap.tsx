import React, { useEffect, useRef, useState } from 'react';

// Keep the outgoing view mounted until its soft fade finishes, then fade in the next view.
export const Swap: React.FC<{
  k: string;
  indexOf?: (k: string) => number;
  className?: string;
  children: React.ReactNode;
}> = ({ k, className = '', children }) => {
  const [current, setCurrent] = useState({ key: k, children });
  const [phase, setPhase] = useState<'visible' | 'exiting' | 'entering'>('visible');
  const latestChildren = useRef(children);
  latestChildren.current = children;

  useEffect(() => {
    if (k === current.key) return;

    setPhase('exiting');
    const exitTimer = window.setTimeout(() => {
      setCurrent({ key: k, children: latestChildren.current });
      setPhase('entering');
    }, 200);

    return () => window.clearTimeout(exitTimer);
  }, [k, current.key]);

  useEffect(() => {
    if (phase !== 'entering' || current.key !== k) return;
    const enterTimer = window.setTimeout(() => setPhase('visible'), 280);
    return () => window.clearTimeout(enterTimer);
  }, [phase, current.key, k]);

  return (
    <div
      className={`${className} ${
        phase === 'exiting' ? 'module-fade-out' : phase === 'entering' ? 'module-fade-in' : ''
      }`}
    >
      {current.children}
    </div>
  );
};
