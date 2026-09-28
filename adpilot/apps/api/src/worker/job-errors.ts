import { DelayedError, Job, UnrecoverableError } from 'bullmq';

/**
 * Job error conventions:
 *  - `throw new UnrecoverableError()` → the job fails immediately (invalid token, permission, validation...).
 *  - any other error → retried with exponential backoff + jitter (see `computeBackoff`).
 *  - `await deferJob(job, token, ms)` → re-schedules the job without consuming an attempt (Meta rate
 *    limits, waiting for video processing). Must be the last statement of the processor.
 */
export { UnrecoverableError };

export async function deferJob(job: Job, token: string | undefined, delayMs: number): Promise<never> {
  await job.moveToDelayed(Date.now() + Math.max(1000, Math.round(delayMs)), token);
  throw new DelayedError();
}

/** Exponential backoff with ±20 % jitter: 30 s, 60 s, 2 min, 4 min … capped at 30 min. */
export function computeBackoff(attemptsMade: number, baseMs = 30_000, capMs = 30 * 60_000): number {
  const exp = Math.min(capMs, baseMs * 2 ** Math.max(0, attemptsMade - 1));
  const jitter = exp * 0.2 * (Math.random() * 2 - 1);
  return Math.round(exp + jitter);
}
