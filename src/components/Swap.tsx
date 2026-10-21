import React from 'react';

// Holds the current page or tab panel. Switching shows the new view instantly — no fade, slide or
// blur (those read as a blink). `k` and `indexOf` stay so existing callers don't change.
export const Swap: React.FC<{
  k: string;
  indexOf?: (k: string) => number;
  className?: string;
  children: React.ReactNode;
}> = ({ className = '', children }) => <div className={className}>{children}</div>;
