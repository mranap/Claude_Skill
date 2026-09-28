import { Injectable, OnModuleDestroy } from '@nestjs/common';
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
export class QueueService implements OnModuleDestroy {
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

  async add<T extends object>(queue: QueueName, name: JobName, data: T, opts: JobsOptions = {}): Promise<string | undefined> {
    const job = await this.queue(queue).add(name, data, opts);
    return job.id;
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([...this.queues.values()].map((q) => q.close()));
  }
}

/** Builds a BullMQ-safe job id (no ':' allowed in custom ids). */
export function jobId(...parts: (string | number)[]): string {
  return parts.join('__').replace(/:/g, '_');
}
