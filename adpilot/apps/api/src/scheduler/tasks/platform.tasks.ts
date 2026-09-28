import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { QueueService, jobId } from '../../infra/queue/queue.service';
import { JOBS, QUEUES } from '../../infra/queue/queues';
import { NotificationsService } from '../../modules/notifications/notifications.service';
import { SettingsService } from '../../modules/settings/settings.service';
import { SchedulerTask } from '../scheduler-task';

/** Outbox relay: re-queues deliveries whose job was lost and resolves deliveries stuck in SENDING. */
@Injectable()
export class OutboxSweepTask implements SchedulerTask {
  readonly name = 'notification-outbox-sweep';
  readonly everyMs = 60_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async run(): Promise<void> {
    const stale = await this.prisma.notificationDelivery.findMany({
      where: { status: 'PENDING', updatedAt: { lt: new Date(Date.now() - 2 * 60_000) } },
      select: { id: true, channel: true },
      take: 500,
    });
    for (const d of stale) await this.notifications.enqueueDelivery(d.id, d.channel);
    // A worker died between claiming and finishing: we cannot know whether the message went out, so we do
    // not resend it (no duplicates) and mark it UNCERTAIN for visibility.
    await this.prisma.notificationDelivery.updateMany({
      where: { status: 'SENDING', claimedAt: { lt: new Date(Date.now() - 10 * 60_000) } },
      data: { status: 'UNCERTAIN', lastError: 'Worker stopped while sending' },
    });
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
    await this.queue.add(QUEUES.MAINTENANCE, JOBS.RETENTION_CLEANUP, { kind: 'retention' }, { jobId: jobId('retention', day), attempts: 2 });
  }
}

/** Scheduled database backup at the hour configured by the Super Admin. */
@Injectable()
export class BackupTask implements SchedulerTask {
  readonly name = 'database-backup';
  readonly everyMs = 10 * 60_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly queue: QueueService,
  ) {}

  async run(): Promise<void> {
    const cfg = await this.settings.get('backups');
    const now = new Date();
    if (!cfg.enabled || now.getUTCHours() !== cfg.hourUtc) return;
    const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const existing = await this.prisma.backup.findFirst({ where: { startedAt: { gte: startOfDay }, triggeredById: null } });
    if (existing) return;
    const backup = await this.prisma.backup.create({ data: { kind: 'DATABASE', status: 'QUEUED' } });
    await this.queue.add(QUEUES.MAINTENANCE, JOBS.DATABASE_BACKUP, { kind: 'backup', backupId: backup.id }, { jobId: jobId('backup', backup.id), attempts: 1 });
  }
}
