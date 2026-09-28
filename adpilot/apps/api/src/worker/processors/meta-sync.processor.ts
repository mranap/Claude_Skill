import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import { JOBS, MetaSyncJob, QUEUES, TokenCheckJob } from '../../infra/queue/queues';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { SettingsService } from '../../modules/settings/settings.service';
import { NotificationsService } from '../../modules/notifications/notifications.service';
import { MetaConnectionFactory } from '../../modules/meta/meta-connection.factory';
import { AssetSyncResult, MetaAssetsService } from '../../modules/meta/meta-assets.service';
import { MetaProfileStatusService } from '../../modules/meta/meta-profile-status.service';
import { TokenInspectorService } from '../../modules/meta/token-inspector.service';
import { MetaApiError } from '../../modules/meta/graph/meta-errors';
import { QueueProcessor } from '../processor';
import { handleMetaJobError } from '../meta-job-errors';
import { deferJob } from '../job-errors';
import { LockService } from '../../infra/locks/lock.service';
import { RedisService } from '../../infra/redis/redis.service';

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
    private readonly locks: LockService,
    private readonly redis: RedisService,
  ) {}

  async process(job: Job, token?: string): Promise<unknown> {
    if (job.name === JOBS.TOKEN_CHECK) return this.tokenCheck(job as Job<TokenCheckJob>);
    return this.assetSync(job as Job<MetaSyncJob>, token);
  }

  private async loadProfile(profileId: string) {
    return this.prisma.metaProfile.findFirst({ where: { id: profileId, deletedAt: null, isEnabled: true }, include: { proxy: true } });
  }

  /**
   * Every sync request is its own job; runs are serialised per profile and coalesced: a request is skipped
   * when a sync that *started after the request was made* already succeeded (it saw the same or newer state).
   * Only a successful run records its start, so the retry, deferral or stalled re-run of a job whose run failed
   * is never mistaken for a covered request. A request made while a sync is running waits for it and then runs,
   * so changes made meanwhile (e.g. an ad account connected mid-sync) are always picked up.
   */
  private async assetSync(job: Job<MetaSyncJob>, token?: string) {
    const { profileId } = job.data;
    const startedKey = this.redis.key('meta-sync', 'started', profileId);
    const lastStarted = Number((await this.redis.client.get(startedKey)) ?? 0);
    if (lastStarted >= job.timestamp) return { skipped: 'covered by a newer sync' };
    // The lock is renewed while the run lasts: discovery of a large profile can outlast any fixed TTL.
    const run = await this.locks.withLock(`meta-sync:${profileId}`, 5 * 60_000, () => this.runAssetSync(job, token, startedKey));
    if (!run.acquired) return deferJob(job, token, 10_000);
    return run.result;
  }

  private async runAssetSync(job: Job<MetaSyncJob>, token: string | undefined, startedKey: string) {
    const startedAt = Date.now();
    const { profileId, userId } = job.data;
    const profile = await this.loadProfile(profileId);
    if (!profile || profile.userId !== userId) return { skipped: 'profile not found' };
    if (profile.status !== 'ACTIVE') {
      await this.prisma.metaProfile.update({ where: { id: profileId }, data: { syncStatus: 'IDLE' } });
      return { skipped: `profile status ${profile.status}` };
    }
    const { assetSyncIntervalHours } = await this.settings.get('meta');
    await this.prisma.metaProfile.update({ where: { id: profileId }, data: { syncStatus: 'RUNNING' } });
    let result: AssetSyncResult;
    try {
      const conn = await this.connections.forProfile(profile);
      result = await this.assets.syncProfile(profileId, userId, conn);
      await this.prisma.metaProfile.update({
        where: { id: profileId },
        data: {
          syncStatus: 'SUCCESS',
          lastSyncAt: new Date(),
          syncError: result.warnings.length ? result.warnings.slice(0, 10).join('\n').slice(0, 2000) : null,
          nextAssetSyncAt: new Date(Date.now() + assetSyncIntervalHours * 3600_000),
        },
      });
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
      return handleMetaJobError(err, job, token, { profileId, profileStatus: this.profileStatus, tokenFingerprint: profile.tokenFingerprint });
    }
    // Covers every request made before this run started (see assetSync); if it is lost, a later request only
    // runs one redundant sync.
    await this.redis.client.set(startedKey, String(startedAt), 'EX', 7 * 24 * 3600).catch(() => undefined);
    return result;
  }

  private async tokenCheck(job: Job<TokenCheckJob>) {
    const { profileId } = job.data;
    const profile = await this.loadProfile(profileId);
    if (!profile || !profile.tokenEnc) return { skipped: true };
    const conn = await this.connections.forProfile(profile);
    // Every write below is conditional on the inspected token: the user may replace it during the check.
    const inspected = { id: profileId, tokenFingerprint: profile.tokenFingerprint };
    const inspection = await this.inspector.inspect(conn);
    if (inspection.status === 'ERROR') {
      // Network/proxy problem — not a token problem; keep the current status and retry later.
      await this.prisma.metaProfile.updateMany({ where: inspected, data: { lastValidationError: inspection.message, lastValidatedAt: new Date() } });
      throw new Error(inspection.message);
    }
    await this.profileStatus.applyInspection(profileId, inspection, profile.tokenFingerprint);

    // "Expiring soon" warning, once per token (expiryWarnedAt is reset when the token is replaced). The claim
    // commits together with the notification, so a failure in between cannot use the warning up.
    const expiresAt = inspection.expiresAt ? new Date(inspection.expiresAt) : null;
    if (inspection.valid && expiresAt && expiresAt.getTime() - Date.now() < 7 * DAY) {
      const pending = await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.metaProfile.updateMany({ where: { ...inspected, expiryWarnedAt: null }, data: { expiryWarnedAt: new Date() } });
        if (claimed.count !== 1) return null;
        return this.notifications.notifyInTx(tx, {
          userId: profile.userId,
          type: 'TOKEN_EXPIRING_SOON',
          severity: 'WARNING',
          title: `Meta token of "${profile.name}" expires soon`,
          body: `The access token expires on ${expiresAt.toISOString().slice(0, 16).replace('T', ' ')} UTC. Replace it to avoid interruptions.`,
          link: `/meta-profiles/${profileId}`,
          dedupeKey: `token-expiring:${profileId}:${expiresAt.getTime()}`,
        });
      });
      if (pending) await this.notifications.dispatch(pending);
    }
    return { status: inspection.status };
  }
}
