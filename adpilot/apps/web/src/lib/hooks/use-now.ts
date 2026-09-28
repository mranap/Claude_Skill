'use client';

import { useEffect, useState } from 'react';

/** Current timestamp, refreshed every `intervalMs` while `enabled` (for countdowns and relative times). */
export function useNow(intervalMs = 1000, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    // Refresh right away as well: the value may be stale if the hook was disabled for a while.
    const first = window.setTimeout(() => setNow(Date.now()), 0);
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [intervalMs, enabled]);
  return now;
}
