import { BeforeApplicationShutdown, Injectable } from '@nestjs/common';
import { JobsOptions, Queue } from 'bullmq';
import { RedisService } from '../redis/redis.service';
import { AppConfig } from '../../config/app-config';
import { ALL_QUEUES, JobName, QueueName } from './queues';

/** Default retention of finished jobs in Redis (history lives in the database). */
const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 6,
  backoff: { type: 'custom' },
  removeOnComplete: { age: 24 * 3600, count: 5000 },
  removeOnFail: { age: 7 * 24 * 3600, count: 5000 },
};

/**
 * Job producer used by the API, scheduler and workers. Deduplication is done with deterministic job ids
 * (BullMQ ignores `add` when a job with the same id already exists).
 */
@Injectable()
export class QueueService implements BeforeApplicationShutdown {
  private readonly queues = new Map<QueueName, Queue>();

  constructor(
    private readonly redis: RedisService,
    private readonly config: AppConfig,
  ) {}

  get prefix(): string {
    return this.config.env.QUEUE_PREFIX;
  }

  queue(name: QueueName): Queue {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, {
        connection: this.redis.bullConnection(`producer-${name}`),
        prefix: `${this.prefix}:bull`,
        defaultJobOptions: DEFAULT_JOB_OPTIONS,
      });
      this.queues.set(name, q);
    }
    return q;
  }

  all(): { name: QueueName; queue: Queue }[] {
    return ALL_QUEUES.map((name) => ({ name, queue: this.queue(name) }));
  }

  async add<T extends object>(
    queue: QueueName,
    name: JobName,
    data: T,
    opts: JobsOptions = {},
  ): Promise<string | undefined> {
    const job = await this.queue(queue).add(name, data, opts);
    return job.id;
  }

  /**
   * `add` for work that must run again although an earlier job with the same deterministic id has finished:
   * BullMQ ignores an id that still exists (failed jobs are kept for 7 days), so a finished job is removed
   * first. A job that is still waiting, delayed or active is kept and the add is a no-op.
   */
  async addReplacingFinished<T extends object>(
    queue: QueueName,
    name: JobName,
    data: T,
    opts: JobsOptions & { jobId: string },
  ): Promise<string | undefined> {
    const existing = await this.queue(queue).getJob(opts.jobId);
    const state = existing ? await existing.getState() : null;
    // A concurrent caller may have removed it already; the add below is idempotent either way.
    if (existing && (state === 'completed' || state === 'failed'))
      await existing.remove().catch(() => undefined);
    return this.add(queue, name, data, opts);
  }

  /** Shutdown phase 2: running jobs (phase 1) may still enqueue follow-up jobs until they finish. */
  async beforeApplicationShutdown(): Promise<void> {
    await Promise.allSettled([...this.queues.values()].map((q) => q.close()));
  }
}

/** Builds a BullMQ-safe job id (no ':' allowed in custom ids). */
export function jobId(...parts: (string | number)[]): string {
  return parts.join('__').replace(/:/g, '_');
}
