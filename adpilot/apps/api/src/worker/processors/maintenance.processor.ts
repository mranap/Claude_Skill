import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import { BroadcastJob, JOBS, MaintenanceJob, QUEUES } from '../../infra/queue/queues';
import { RetentionService } from '../../modules/maintenance/retention.service';
import { BackupService } from '../../modules/maintenance/backup.service';
import { BroadcastService } from '../../modules/admin/broadcast.service';
import { QueueProcessor } from '../processor';

/** Maintenance queue: retention cleanup, database backups and administrator broadcasts. */
@Injectable()
export class MaintenanceProcessor implements QueueProcessor {
  readonly queue = QUEUES.MAINTENANCE;

  constructor(
    private readonly retention: RetentionService,
    private readonly backups: BackupService,
    private readonly broadcasts: BroadcastService,
  ) {}

  async process(job: Job<MaintenanceJob | BroadcastJob>): Promise<unknown> {
    if (job.name === JOBS.BROADCAST) {
      await this.broadcasts.process((job.data as BroadcastJob).broadcastId);
      return { ok: true };
    }
    const data = job.data as MaintenanceJob;
    if (data.kind === 'retention') return this.retention.run();
    if (data.kind === 'backup') {
      await this.backups.run(data.backupId);
      return { ok: true };
    }
    return { ignored: true };
  }
}
