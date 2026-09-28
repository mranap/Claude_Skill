import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import { CampaignCreateJob, QUEUES } from '../../infra/queue/queues';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { LaunchExecutorService } from '../../modules/launches/launch-executor.service';
import { QueueProcessor } from '../processor';
import { deferJob } from '../job-errors';

/**
 * CAMPAIGN_CREATE: runs the launch state machine. Waiting (video processing, rate limits, ambiguity windows)
 * re-schedules the job instead of blocking a worker slot; transient errors are retried by BullMQ with
 * exponential backoff while all progress is kept in the launch items.
 */
@Injectable()
export class CampaignLaunchProcessor implements QueueProcessor {
  readonly queue = QUEUES.CAMPAIGN_LAUNCH;

  constructor(
    private readonly executor: LaunchExecutorService,
    private readonly prisma: PrismaService,
  ) {}

  async process(job: Job<CampaignCreateJob>, token?: string): Promise<unknown> {
    const launch = await this.prisma.launchJob.findUnique({ where: { id: job.data.launchJobId }, select: { userId: true, status: true } });
    if (!launch || launch.userId !== job.data.userId) return { skipped: 'not found' };
    try {
      const outcome = await this.executor.run(job.data.launchJobId);
      if (outcome.kind === 'busy') return deferJob(job, token, 30_000);
      if (outcome.kind === 'defer') {
        await job.log(`Deferred ${Math.round(outcome.delayMs / 1000)} s: ${outcome.reason}`);
        return deferJob(job, token, outcome.delayMs);
      }
      return outcome;
    } catch (err) {
      const lastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      if (lastAttempt) {
        // Out of retries for a temporary problem: mark the launch failed (items keep their state → retryable).
        await this.executor.markFailed(job.data.launchJobId, `Stopped after repeated temporary errors: ${(err as Error).message}`);
      }
      throw err;
    }
  }
}
