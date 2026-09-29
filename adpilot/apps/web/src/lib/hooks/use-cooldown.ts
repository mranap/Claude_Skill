'use client';

import { useCallback, useState } from 'react';
import { isApiError } from '@/lib/api/errors';
import { formatCountdown } from '@/lib/utils/format';
import { useNow } from './use-now';

export interface Cooldown {
  /** True while the countdown is running. */
  active: boolean;
  remainingMs: number;
  /** "m:ss" */
  label: string;
  start: (seconds: number) => void;
  /** Starts the countdown from a `COOLDOWN` / `RATE_LIMITED` error; returns true when it did. */
  fromError: (error: unknown) => boolean;
  clear: () => void;
}

/**
 * Countdown for actions the server rate-limits per object (manual status checks, statistics refresh,
 * "run rule now"). The server is the source of truth: the countdown only mirrors `retryAfterSeconds`.
 */
export function useCooldown(): Cooldown {
  const [until, setUntil] = useState<number | null>(null);
  const now = useNow(500, until !== null);
  if (until !== null && now >= until) setUntil(null);
  const remainingMs = until === null ? 0 : Math.max(0, until - now);
  const active = remainingMs > 0;

  const start = useCallback((seconds: number) => setUntil(Date.now() + Math.max(1, seconds) * 1000), []);
  const fromError = useCallback(
    (error: unknown) => {
      if (isApiError(error, 'COOLDOWN', 'RATE_LIMITED') && error.retryAfterSeconds) {
        start(error.retryAfterSeconds);
        return true;
      }
      return false;
    },
    [start],
  );
  const clear = useCallback(() => setUntil(null), []);

  return { active, remainingMs, label: formatCountdown(remainingMs), start, fromError, clear };
}
