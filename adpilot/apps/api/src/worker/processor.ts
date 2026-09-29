import type { Job } from 'bullmq';
import type { QueueName } from '../infra/queue/queues';

/** A queue processor. `token` is needed to defer the job (moveToDelayed). */
export interface QueueProcessor {
  readonly queue: QueueName;
  process(job: Job, token?: string): Promise<unknown>;
}

export const QUEUE_PROCESSORS = Symbol('QUEUE_PROCESSORS');
