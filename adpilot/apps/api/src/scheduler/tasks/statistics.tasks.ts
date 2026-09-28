import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { QueueService, jobId } from '../../infra/queue/queue.service';
import { JOBS, QUEUES } from '../../infra/queue/queues';
import { SettingsService } from '../../modules/settings/settings.service';
import { SchedulerTask, slot } from '../scheduler-task';

const MINUTE = 60_000;

/**
 * Automatic statistics sync at each account's interval. The interval is clamped to the global minimum
 * (35 minutes by default, Super Admin configurable) even if an older value is stored.
 */
@Injectable()
export class StatisticsSyncTask implements SchedulerTask {
  readonly name = 'statistics-sync';
  readonly everyMs = MINUTE;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly queue: QueueService,
  ) {}

  async run(): Promise<void> {
    const { minSyncIntervalMinutes } = await this.settings.get('statistics');
    const rows = await this.prisma.$queryRaw<{ id: string; userId: string; backfilled: boolean }[]>`
      UPDATE ad_accounts
      SET "nextStatsSyncAt" = now() + make_interval(mins => GREATEST("statsSyncIntervalMinutes", ${minSyncIntervalMinutes}::int)),
          "statsSyncStatus" = 'QUEUED'
      WHERE id IN (
        SELECT a.id FROM ad_accounts a JOIN meta_profiles p ON p.id = a."profileId"
        WHERE a."isConnected" AND a."statsSyncEnabled" AND p."deletedAt" IS NULL AND p."isEnabled" AND p.status = 'ACTIVE'
          AND (a."nextStatsSyncAt" IS NULL OR a."nextStatsSyncAt" <= now())
        ORDER BY a."nextStatsSyncAt" NULLS FIRST LIMIT 500
        FOR UPDATE OF a SKIP LOCKED)
      RETURNING id, "userId", ("statsBackfilledAt" IS NOT NULL) AS backfilled`;
    const s = slot(new Date(), MINUTE);
    for (const r of rows) {
      await this.queue.add(
        QUEUES.STATISTICS,
        JOBS.STATISTICS_SYNC,
        { adAccountId: r.id, userId: r.userId, reason: r.backfilled ? 'scheduled' : 'backfill' },
        { jobId: jobId('stats', r.id, s), attempts: 4 },
      );
    }
  }
}

/** Re-queues launches whose worker job was lost (e.g. Redis restarted without persistence). */
@Injectable()
export class LaunchRecoveryTask implements SchedulerTask {
  readonly name = 'launch-recovery';
  readonly everyMs = 5 * MINUTE;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
  ) {}

  async run(): Promise<void> {
    const stale = await this.prisma.launchJob.findMany({
      where: {
        status: { notIn: ['COMPLETED', 'PARTIAL_FAILURE', 'FAILED', 'CANCELLED'] },
        updatedAt: { lt: new Date(Date.now() - 15 * MINUTE) },
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: new Date() } }],
      },
      select: { id: true, userId: true },
      take: 100,
    });
    if (!stale.length) return;
    const bullJobs = await this.queue.queue(QUEUES.CAMPAIGN_LAUNCH).getJobs(['waiting', 'active', 'delayed', 'prioritized'], 0, 5000);
    const pending = new Set(bullJobs.filter(Boolean).map((b) => (b.data as { launchJobId?: string }).launchJobId));
    for (const j of stale) {
      if (pending.has(j.id)) continue;
      await this.queue.add(QUEUES.CAMPAIGN_LAUNCH, JOBS.CAMPAIGN_CREATE, { launchJobId: j.id, userId: j.userId }, { jobId: jobId('launch', j.id, 'recover', slot(new Date(), 15 * MINUTE)), attempts: 8 });
    }
  }
}
