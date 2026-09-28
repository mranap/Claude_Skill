import { Inject, Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { hostname } from 'node:os';
import type { SettingValue } from '@adpilot/shared';
import { AppConfig } from '../config/app-config';
import { RedisService } from '../infra/redis/redis.service';
import { SettingsService } from '../modules/settings/settings.service';
import { SystemLogService } from '../modules/system-log/system-log.service';
import { RequestContext } from '../common/context/request-context';
import { AppLogger, serializeError } from '../infra/logger/logger';
import { QUEUES, QueueName } from '../infra/queue/queues';
import { QUEUE_PROCESSORS, QueueProcessor } from './processor';
import { computeBackoff } from './job-errors';

type QueueSettings = SettingValue<'queue'>;

/**
 * Hosts the BullMQ workers of this process. Which queues a process consumes is controlled by
 * WORKER_QUEUES ("*" or a comma separated list), so heavy queues (campaign-launch, statistics) can be
 * scaled on dedicated containers. Concurrency comes from Super Admin → Queue settings.
 */
@Injectable()
export class WorkerHostService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new AppLogger('WorkerHost');
  private readonly workers: Worker[] = [];
  private heartbeat: NodeJS.Timeout | null = null;
  private readonly stats = { processed: 0, failed: 0, startedAt: new Date().toISOString() };
  private readonly id = `${hostname()}:${process.pid}`;

  constructor(
    @Inject(QUEUE_PROCESSORS) private readonly processors: QueueProcessor[],
    private readonly config: AppConfig,
    private readonly redis: RedisService,
    private readonly settings: SettingsService,
    private readonly systemLog: SystemLogService,
  ) {}

  private enabledQueues(): QueueName[] {
    const raw = this.config.env.WORKER_QUEUES.trim();
    const all = Object.values(QUEUES);
    if (raw === '*' || raw === '') return all;
    const wanted = raw.split(',').map((s) => s.trim());
    return all.filter((q) => wanted.includes(q));
  }

  private concurrencyFor(queue: QueueName, s: QueueSettings): number {
    const map: Record<QueueName, number> = {
      'campaign-launch': s.launchConcurrency,
      statistics: s.statisticsConcurrency,
      'account-status': s.accountStatusConcurrency,
      'meta-sync': s.metaSyncConcurrency,
      'creative-upload': s.creativeUploadConcurrency,
      'auto-rules': s.rulesConcurrency,
      email: s.notificationConcurrency,
      telegram: s.notificationConcurrency,
      'bulk-actions': s.bulkConcurrency,
      maintenance: 1,
    };
    return Math.max(1, Math.round((map[queue] ?? 1) * this.config.env.WORKER_CONCURRENCY_SCALE));
  }

  async onApplicationBootstrap(): Promise<void> {
    const queueSettings = await this.settings.get('queue');
    const byQueue = new Map(this.processors.map((p) => [p.queue, p]));
    for (const queue of this.enabledQueues()) {
      const processor = byQueue.get(queue);
      if (!processor) continue;
      const concurrency = this.concurrencyFor(queue, queueSettings);
      const worker = new Worker(
        queue,
        async (job: Job, token?: string) =>
          RequestContext.run({ requestId: `job:${job.id}`, jobId: job.id, queue }, () => processor.process(job, token)),
        {
          connection: this.redis.bullConnection(`worker-${queue}`),
          prefix: `${this.config.env.QUEUE_PREFIX}:bull`,
          concurrency,
          lockDuration: 120_000,
          stalledInterval: 60_000,
          maxStalledCount: 2,
          settings: { backoffStrategy: (attemptsMade: number) => computeBackoff(attemptsMade) },
        },
      );
      worker.on('completed', () => this.stats.processed++);
      worker.on('failed', (job, err) => {
        this.stats.failed++;
        if (!job) return;
        const final = job.attemptsMade >= (job.opts.attempts ?? 1) || err.name === 'UnrecoverableError';
        const data = { queue, jobName: job.name, jobId: job.id, attemptsMade: job.attemptsMade, final, err: serializeError(err) };
        if (final) void this.systemLog.error(`worker:${queue}`, `Job ${job.name} failed permanently: ${err.message}`, data);
        else this.logger.warn('Job attempt failed, will retry', data);
      });
      worker.on('error', (err) => this.logger.error('Worker error', { queue, err }));
      this.workers.push(worker);
      this.logger.info('Worker started', { queue, concurrency });
    }
    await this.beat();
    this.heartbeat = setInterval(() => void this.beat().catch(() => undefined), 15_000);
  }

  private async beat(): Promise<void> {
    const key = this.redis.key('workers', 'hb', this.id);
    const payload = {
      id: this.id,
      host: hostname(),
      pid: process.pid,
      queues: this.workers.map((w) => ({ name: w.name, concurrency: w.opts.concurrency, running: w.isRunning() })),
      ...this.stats,
      memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      at: new Date().toISOString(),
    };
    await this.redis.client.set(key, JSON.stringify(payload), 'EX', 45);
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    // close() waits for active jobs to finish (graceful shutdown on SIGTERM).
    await Promise.allSettled(this.workers.map((w) => w.close()));
    await this.redis.client.del(this.redis.key('workers', 'hb', this.id)).catch(() => undefined);
  }
}
