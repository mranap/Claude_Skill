import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { QueueService, jobId } from '../../infra/queue/queue.service';
import { BulkActionJob, JOBS, QUEUES } from '../../infra/queue/queues';
import { NotificationsService } from '../../modules/notifications/notifications.service';
import { SettingsService } from '../../modules/settings/settings.service';
import { SystemLogService } from '../../modules/system-log/system-log.service';
import {
  BULK_JOB_ATTEMPTS,
  bulkJobId,
  closeBulkOperation,
} from '../../modules/campaigns/bulk-actions.service';
import { failAbandonedBackups, queueBackup } from '../../modules/maintenance/backup.service';
import { SchedulerTask } from '../scheduler-task';

const MINUTE = 60_000;
const SWEEP_BATCH = 500;
/** Bulk operations younger than this may still be running inline in the API request that created them. */
const BULK_GRACE_MS = 5 * MINUTE;

/**
 * Outbox relay: re-queues work whose job was lost or ran out of attempts — notification deliveries and bulk
 * operations — and resolves deliveries stuck in SENDING.
 */
@Injectable()
export class OutboxSweepTask implements SchedulerTask {
  readonly name = 'notification-outbox-sweep';
  readonly everyMs = MINUTE;
  /** Keyset position in the PENDING backlog: each run continues where the previous one stopped. */
  private cursor: { createdAt: Date; id: string } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly queue: QueueService,
  ) {}

  async run(): Promise<void> {
    await this.sweepDeliveries();
    await this.sweepBulkOperations();
  }

  /**
   * Walks the stale PENDING deliveries oldest first, one batch per run, so a large legitimate backlog (a
   * broadcast) cannot hide the deliveries whose job was really lost.
   */
  private async sweepDeliveries(): Promise<void> {
    const c = this.cursor;
    const stale = await this.prisma.notificationDelivery.findMany({
      where: {
        status: 'PENDING',
        updatedAt: { lt: new Date(Date.now() - 2 * MINUTE) },
        ...(c
          ? { OR: [{ createdAt: { gt: c.createdAt } }, { createdAt: c.createdAt, id: { gt: c.id } }] }
          : {}),
      },
      select: { id: true, channel: true, createdAt: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: SWEEP_BATCH,
    });
    this.cursor =
      stale.length === SWEEP_BATCH
        ? { createdAt: stale[stale.length - 1].createdAt, id: stale[stale.length - 1].id }
        : null;
    for (const d of stale) await this.notifications.enqueueDelivery(d.id, d.channel);
    // A worker died between claiming and finishing: we cannot know whether the message went out, so we do
    // not resend it (no duplicates) and mark it UNCERTAIN for visibility.
    await this.prisma.notificationDelivery.updateMany({
      where: { status: 'SENDING', claimedAt: { lt: new Date(Date.now() - 10 * MINUTE) } },
      data: { status: 'UNCERTAIN', lastError: 'Worker stopped while sending' },
    });
  }

  /**
   * Bulk operations left QUEUED/RUNNING without a live job: the job was lost (API stopped during an inline run,
   * Redis data loss) → it is queued again (processing resumes after the confirmed targets); the job ran out of
   * attempts → the operation is closed with the remaining targets reported as failed.
   */
  private async sweepBulkOperations(): Promise<void> {
    const ops = await this.prisma.bulkOperation.findMany({
      where: {
        status: { in: ['QUEUED', 'RUNNING'] },
        createdAt: { lt: new Date(Date.now() - BULK_GRACE_MS) },
      },
      orderBy: { createdAt: 'asc' },
      take: SWEEP_BATCH,
    });
    for (const op of ops) {
      const job = await this.queue.queue(QUEUES.BULK_ACTIONS).getJob(bulkJobId(op.id));
      const state = job ? await job.getState() : 'missing';
      if (state === 'failed') {
        await closeBulkOperation(this.prisma, op);
      } else if (state === 'missing' || state === 'completed') {
        const data: BulkActionJob = { bulkOperationId: op.id, userId: op.userId };
        await this.queue.addReplacingFinished(QUEUES.BULK_ACTIONS, JOBS.BULK_ACTION, data, {
          jobId: bulkJobId(op.id),
          attempts: BULK_JOB_ATTEMPTS,
        });
      }
    }
  }
}

/** Daily data retention cleanup (02:30 UTC), deduplicated per day. */
@Injectable()
export class RetentionTask implements SchedulerTask {
  readonly name = 'retention-cleanup';
  readonly everyMs = 10 * 60_000;

  constructor(private readonly queue: QueueService) {}

  async run(): Promise<void> {
    const now = new Date();
    if (now.getUTCHours() !== 2) return;
    const day = now.toISOString().slice(0, 10);
    await this.queue.add(
      QUEUES.MAINTENANCE,
      JOBS.RETENTION_CLEANUP,
      { kind: 'retention' },
      { jobId: jobId('retention', day), attempts: 2 },
    );
  }
}

/**
 * Scheduled database backup at the hour configured by the Super Admin (at most one per day, never next to
 * another running backup). Also fails backups whose worker died, so they stop blocking manual backups.
 */
@Injectable()
export class BackupTask implements SchedulerTask {
  readonly name = 'database-backup';
  readonly everyMs = 10 * 60_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly queue: QueueService,
    private readonly systemLog: SystemLogService,
  ) {}

  async run(): Promise<void> {
    const abandoned = await failAbandonedBackups(this.prisma);
    if (abandoned) await this.systemLog.warn('backup', `${abandoned} abandoned backup(s) marked as failed`);
    const cfg = await this.settings.get('backups');
    const now = new Date();
    if (!cfg.enabled || now.getUTCHours() !== cfg.hourUtc) return;
    const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    await queueBackup(this.prisma, this.queue, { triggeredById: null, scheduledSince: startOfDay });
  }
}
