import type { Job } from 'bullmq';
import { MetaApiError } from '../modules/meta/graph/meta-errors';
import { MetaProfileStatusService } from '../modules/meta/meta-profile-status.service';
import { UnrecoverableError, deferJob } from './job-errors';

/**
 * Uniform handling of Meta errors inside jobs:
 *  - rate limits → the job is re-scheduled after the computed delay (no attempt consumed, no API spam);
 *  - auth → the profile status is updated (one notification) and the job stops (no retries);
 *  - permission → the token is re-checked soon (the error may concern one object only) and the job stops;
 *  - validation/policy/not found → no retries (repeating the same request cannot succeed);
 *  - transient/network/proxy → normal retry with exponential backoff + jitter.
 * `tokenFingerprint` is the one of the token the job used (MetaConnection.tokenFingerprint): an error seen with a
 * token that was replaced meanwhile leaves the profile alone.
 */
export async function handleMetaJobError(
  err: unknown,
  job: Job,
  token: string | undefined,
  opts: { profileId?: string; profileStatus?: MetaProfileStatusService; tokenFingerprint?: string },
): Promise<never> {
  if (err instanceof MetaApiError) {
    if (err.category === 'RATE_LIMIT') {
      return deferJob(job, token, err.details.retryAfterMs ?? 60_000);
    }
    if (err.category === 'AUTH' || err.category === 'PERMISSION') {
      if (opts.profileId && opts.profileStatus)
        await opts.profileStatus.onApiError(opts.profileId, err, opts.tokenFingerprint);
      throw new UnrecoverableError(err.details.friendlyMessage);
    }
    if (err.category === 'VALIDATION' || err.category === 'POLICY' || err.category === 'NOT_FOUND') {
      throw new UnrecoverableError(err.details.friendlyMessage);
    }
  }
  throw err;
}
