import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import { BulkActionJob, QUEUES } from '../../infra/queue/queues';
import { BulkActionsService } from '../../modules/campaigns/bulk-actions.service';
import { QueueProcessor } from '../processor';
import { deferJob } from '../job-errors';

/** BULK_ACTION: large pause/start batches; resumes where it stopped after rate limits or restarts. */
@Injectable()
export class BulkActionsProcessor implements QueueProcessor {
  readonly queue = QUEUES.BULK_ACTIONS;

  constructor(private readonly bulk: BulkActionsService) {}

  async process(job: Job<BulkActionJob>, token?: string): Promise<unknown> {
    const res = await this.bulk.process(job.data.bulkOperationId);
    if (res.rateLimitedMs) return deferJob(job, token, res.rateLimitedMs);
    return { ok: true };
  }
}
