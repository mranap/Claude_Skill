import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import { CreativeUploadJob, QUEUES } from '../../infra/queue/queues';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { MetaConnectionFactory } from '../../modules/meta/meta-connection.factory';
import { MetaProfileStatusService } from '../../modules/meta/meta-profile-status.service';
import { MAX_PROCESSING_WAIT_MS, MetaMediaService } from '../../modules/creatives/meta-media.service';
import { MetaApiError } from '../../modules/meta/graph/meta-errors';
import { QueueProcessor } from '../processor';
import { deferJob } from '../job-errors';
import { handleMetaJobError } from '../meta-job-errors';

/**
 * CREATIVE_UPLOAD: uploads one library file to one ad account and waits (by re-scheduling itself, never
 * by blocking a worker slot) until Meta finished processing a video. The per-asset lock (shared with the
 * launches, renewed while held) guarantees that the same asset is never uploaded twice in parallel.
 */
@Injectable()
export class CreativeUploadProcessor implements QueueProcessor {
  readonly queue = QUEUES.CREATIVE_UPLOAD;

  constructor(
    private readonly prisma: PrismaService,
    private readonly connections: MetaConnectionFactory,
    private readonly media: MetaMediaService,
    private readonly profileStatus: MetaProfileStatusService,
  ) {}

  async process(job: Job<CreativeUploadJob>, token?: string): Promise<unknown> {
    const locked = await this.media.withAssetLock(job.data.creativeMetaAssetId, () => this.run(job, token));
    if (!locked.acquired) return deferJob(job, token, 20_000);
    return locked.result;
  }

  private async run(job: Job<CreativeUploadJob>, token?: string): Promise<unknown> {
    const asset = await this.prisma.creativeMetaAsset.findUnique({
      where: { id: job.data.creativeMetaAssetId },
      include: { creativeFile: true, adAccount: { include: { profile: { include: { proxy: true } } } } },
    });
    if (!asset || asset.userId !== job.data.userId) return { skipped: 'not found' };
    if (asset.status === 'READY') return { state: 'READY' };
    if (asset.creativeFile.deletedAt) return { skipped: 'file deleted' };
    const profile = asset.adAccount.profile;
    if (profile.deletedAt || profile.status !== 'ACTIVE') {
      await this.prisma.creativeMetaAsset.update({
        where: { id: asset.id },
        data: { status: 'FAILED', error: 'The Meta profile of this ad account is not active' },
      });
      return { state: 'FAILED' };
    }
    if (asset.status === 'PROCESSING' && Date.now() - job.timestamp > MAX_PROCESSING_WAIT_MS) {
      await this.prisma.creativeMetaAsset.update({
        where: { id: asset.id },
        data: { status: 'FAILED', error: 'Meta did not finish processing the video within 2 hours' },
      });
      return { state: 'FAILED' };
    }
    try {
      const conn = await this.connections.forProfile(profile);
      const result = await this.media.process(conn, asset, asset.creativeFile, asset.adAccount.metaAccountId);
      if (result.state === 'PROCESSING') return deferJob(job, token, result.recheckInMs);
      if (result.state === 'FAILED') {
        await this.prisma.creativeMetaAsset.update({
          where: { id: asset.id },
          data: { status: 'FAILED', error: result.error },
        });
      }
      return result;
    } catch (err) {
      if (err instanceof MetaApiError && !err.retryable) {
        await this.prisma.creativeMetaAsset.update({
          where: { id: asset.id },
          data: { status: 'FAILED', error: err.details.friendlyMessage, errorCode: err.metaCode ?? null },
        });
      }
      return handleMetaJobError(err, job, token, {
        profileId: profile.id,
        profileStatus: this.profileStatus,
        tokenFingerprint: profile.tokenFingerprint,
      });
    }
  }
}
