import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import { JOBS, MetaSyncJob, QUEUES, TokenCheckJob } from '../../infra/queue/queues';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { SettingsService } from '../../modules/settings/settings.service';
import { NotificationsService } from '../../modules/notifications/notifications.service';
import { MetaConnectionFactory } from '../../modules/meta/meta-connection.factory';
import { MetaAssetsService } from '../../modules/meta/meta-assets.service';
import { MetaProfileStatusService } from '../../modules/meta/meta-profile-status.service';
import { TokenInspectorService } from '../../modules/meta/token-inspector.service';
import { MetaApiError } from '../../modules/meta/graph/meta-errors';
import { QueueProcessor } from '../processor';
import { handleMetaJobError } from '../meta-job-errors';

const DAY = 86400_000;

/** META_SYNC (asset discovery) and TOKEN_CHECK (periodic token validation) jobs. */
@Injectable()
export class MetaSyncProcessor implements QueueProcessor {
  readonly queue = QUEUES.META_SYNC;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly connections: MetaConnectionFactory,
    private readonly assets: MetaAssetsService,
    private readonly profileStatus: MetaProfileStatusService,
    private readonly inspector: TokenInspectorService,
  ) {}

  async process(job: Job, token?: string): Promise<unknown> {
    if (job.name === JOBS.TOKEN_CHECK) return this.tokenCheck(job as Job<TokenCheckJob>);
    return this.assetSync(job as Job<MetaSyncJob>, token);
  }

  private async loadProfile(profileId: string) {
    return this.prisma.metaProfile.findFirst({ where: { id: profileId, deletedAt: null, isEnabled: true }, include: { proxy: true } });
  }

  private async assetSync(job: Job<MetaSyncJob>, token?: string) {
    const { profileId, userId } = job.data;
    const profile = await this.loadProfile(profileId);
    if (!profile || profile.userId !== userId) return { skipped: 'profile not found' };
    if (profile.status !== 'ACTIVE') {
      await this.prisma.metaProfile.update({ where: { id: profileId }, data: { syncStatus: 'IDLE' } });
      return { skipped: `profile status ${profile.status}` };
    }
    const { assetSyncIntervalHours } = await this.settings.get('meta');
    await this.prisma.metaProfile.update({ where: { id: profileId }, data: { syncStatus: 'RUNNING' } });
    try {
      const conn = await this.connections.forProfile(profile);
      const result = await this.assets.syncProfile(profileId, userId, conn);
      await this.prisma.metaProfile.update({
        where: { id: profileId },
        data: {
          syncStatus: 'SUCCESS',
          lastSyncAt: new Date(),
          syncError: result.warnings.length ? result.warnings.slice(0, 10).join('\n').slice(0, 2000) : null,
          nextAssetSyncAt: new Date(Date.now() + assetSyncIntervalHours * 3600_000),
        },
      });
      return result;
    } catch (err) {
      const final = !(err instanceof MetaApiError && err.category === 'RATE_LIMIT') && job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      await this.prisma.metaProfile.update({
        where: { id: profileId },
        data: {
          syncStatus: err instanceof MetaApiError && err.category === 'RATE_LIMIT' ? 'QUEUED' : 'FAILED',
          syncError: err instanceof MetaApiError ? err.details.friendlyMessage : (err as Error).message,
        },
      });
      if (final || (err instanceof MetaApiError && !err.retryable)) {
        await this.notifications.notify({
          userId,
          type: 'ACCOUNT_SYNC_FAILED',
          severity: 'WARNING',
          title: `Sync failed for Meta profile "${profile.name}"`,
          body: err instanceof MetaApiError ? err.details.friendlyMessage : 'The ad accounts and pages of this profile could not be synchronised.',
          link: `/meta-profiles/${profileId}`,
          dedupeKey: `profile-sync-failed:${profileId}:${Math.floor(Date.now() / DAY)}`,
        });
      }
      return handleMetaJobError(err, job, token, { profileId, profileStatus: this.profileStatus });
    }
  }

  private async tokenCheck(job: Job<TokenCheckJob>) {
    const { profileId } = job.data;
    const profile = await this.loadProfile(profileId);
    if (!profile || !profile.tokenEnc) return { skipped: true };
    const conn = await this.connections.forProfile(profile);
    const inspection = await this.inspector.inspect(conn);
    if (inspection.status === 'ERROR') {
      // Network/proxy problem — not a token problem; keep the current status and retry later.
      await this.prisma.metaProfile.update({ where: { id: profileId }, data: { lastValidationError: inspection.message, lastValidatedAt: new Date() } });
      throw new Error(inspection.message);
    }
    await this.profileStatus.applyInspection(profileId, inspection);

    // "Expiring soon" warning, once per token (expiryWarnedAt is reset when the token is replaced).
    const expiresAt = inspection.expiresAt ? new Date(inspection.expiresAt) : null;
    if (inspection.valid && expiresAt && expiresAt.getTime() - Date.now() < 7 * DAY) {
      const claimed = await this.prisma.metaProfile.updateMany({ where: { id: profileId, expiryWarnedAt: null }, data: { expiryWarnedAt: new Date() } });
      if (claimed.count === 1) {
        await this.notifications.notify({
          userId: profile.userId,
          type: 'TOKEN_EXPIRING_SOON',
          severity: 'WARNING',
          title: `Meta token of "${profile.name}" expires soon`,
          body: `The access token expires on ${expiresAt.toISOString().slice(0, 16).replace('T', ' ')} UTC. Replace it to avoid interruptions.`,
          link: `/meta-profiles/${profileId}`,
          dedupeKey: `token-expiring:${profileId}:${expiresAt.getTime()}`,
        });
      }
    }
    return { status: inspection.status };
  }
}
