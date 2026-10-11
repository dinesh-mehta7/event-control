import { useEffect, useState } from 'react';

// Keep conditional UI mounted briefly after close so its CSS opacity/transform
// transition can finish. Keep this duration aligned with the shared 200ms UI motion.
export function useAnimatedPresence(open: boolean, duration = 200) {
  const [present, setPresent] = useState(open);
  useEffect(() => {
    if (open) {
      setPresent(true);
      return;
    }
    const timer = window.setTimeout(() => setPresent(false), duration);
    return () => window.clearTimeout(timer);
  }, [open, duration]);
  return present;
}
