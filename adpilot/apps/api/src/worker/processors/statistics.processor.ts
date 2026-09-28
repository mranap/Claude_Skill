import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QUEUES, StatisticsSyncJob } from '../../infra/queue/queues';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { SettingsService } from '../../modules/settings/settings.service';
import { NotificationsService } from '../../modules/notifications/notifications.service';
import { MetaConnectionFactory } from '../../modules/meta/meta-connection.factory';
import { MetaProfileStatusService } from '../../modules/meta/meta-profile-status.service';
import { MetaApiError } from '../../modules/meta/graph/meta-errors';
import { EntitySyncService } from '../../modules/campaigns/entity-sync.service';
import { InsightsSyncService } from '../../modules/statistics/insights-sync.service';
import { QueueProcessor } from '../processor';
import { handleMetaJobError } from '../meta-job-errors';

/** STATISTICS_SYNC: campaigns/ad sets/ads mirror + daily Insights for one ad account. */
@Injectable()
export class StatisticsProcessor implements QueueProcessor {
  readonly queue = QUEUES.STATISTICS;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly connections: MetaConnectionFactory,
    private readonly profileStatus: MetaProfileStatusService,
    private readonly entities: EntitySyncService,
    private readonly insights: InsightsSyncService,
  ) {}

  async process(job: Job<StatisticsSyncJob>, token?: string): Promise<unknown> {
    const account = await this.prisma.adAccount.findFirst({
      where: { id: job.data.adAccountId, userId: job.data.userId, isConnected: true },
      include: { profile: { include: { proxy: true } } },
    });
    if (!account || account.profile.deletedAt || !account.profile.isEnabled || account.profile.status !== 'ACTIVE') return { skipped: 'inactive' };
    await this.prisma.adAccount.update({ where: { id: account.id }, data: { statsSyncStatus: 'RUNNING' } });
    const conn = await this.connections.forProfile(account.profile);
    try {
      const { entitySyncIntervalMinutes } = await this.settings.get('meta');
      const entitiesDue = !account.entitiesSyncedAt || Date.now() - account.entitiesSyncedAt.getTime() > entitySyncIntervalMinutes * 60_000 || job.data.reason !== 'scheduled';
      const entities = entitiesDue ? await this.entities.syncAccount(account, conn) : null;
      const result = await this.insights.syncAccount(account, conn, { backfill: job.data.reason === 'backfill' });
      await this.prisma.adAccount.update({
        where: { id: account.id },
        data: { statsSyncStatus: 'SUCCESS', statsSyncError: null, lastStatsSyncAt: new Date(), statsBackfilledAt: account.statsBackfilledAt ?? new Date() },
      });
      return { entities, ...result };
    } catch (err) {
      const rateLimited = err instanceof MetaApiError && err.category === 'RATE_LIMIT';
      const final = !rateLimited && (job.attemptsMade + 1 >= (job.opts.attempts ?? 1) || (err instanceof MetaApiError && !err.retryable));
      await this.prisma.adAccount.update({
        where: { id: account.id },
        data: {
          statsSyncStatus: rateLimited ? 'QUEUED' : 'FAILED',
          statsSyncError: err instanceof MetaApiError ? err.details.friendlyMessage : (err as Error).message,
        },
      });
      if (final) {
        await this.notifications.notify({
          userId: account.userId,
          type: 'STATISTICS_SYNC_FAILED',
          severity: 'WARNING',
          title: `Statistics sync failed: ${account.name}`,
          body: err instanceof MetaApiError ? err.details.friendlyMessage : 'Statistics could not be synchronised. The platform will try again at the next interval.',
          link: `/ad-accounts/${account.id}`,
          dedupeKey: `stats-failed:${account.id}:${new Date().toISOString().slice(0, 10)}`,
        });
      }
      return handleMetaJobError(err, job, token, { profileId: account.profileId, profileStatus: this.profileStatus });
    }
  }
}
