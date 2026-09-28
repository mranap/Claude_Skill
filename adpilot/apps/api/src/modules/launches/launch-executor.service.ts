import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import type { LaunchJobStatus } from '@adpilot/shared';
import { AppConfig } from '../../config/app-config';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AppLogger } from '../../infra/logger/logger';
import { MetaConnectionFactory } from '../meta/meta-connection.factory';
import { MetaConnection, MetaGraphClient } from '../meta/graph/meta-graph.client';
import { MetaApiError, MetaNetworkError, isMissingOrInaccessible } from '../meta/graph/meta-errors';
import { MetaProfileStatusService } from '../meta/meta-profile-status.service';
import { MAX_PROCESSING_WAIT_MS, MetaMediaService, type MediaStepResult } from '../creatives/meta-media.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ActivityService } from '../activity/activity.service';
import { AuditService } from '../audit/audit.service';
import { EntitySyncService } from '../campaigns/entity-sync.service';
import { actId } from '../meta/meta-fields';
import { resolveRefs } from './meta-payloads';
import type { PlanRef } from './launch.types';
import { Prisma, type CreativeFile, type CreativeMetaAsset, type LaunchJob, type LaunchJobItem } from '../../generated/prisma/client';

const LEASE_MS = 10 * 60_000;
/**
 * Longest time the Graph client can hold a request before sending it: rate-limit pacing (at most 5 s,
 * MetaRateLimitService.beforeRequest) plus the wait for a per-account concurrency slot (60 s and one
 * back-off sleep, MetaGraphClient.acquireSlot).
 */
const MAX_PRE_SEND_WAIT_MS = 66_000;
/** Meta may still finish a request this long after the client stopped waiting for its answer. */
const LATE_PROCESSING_MARGIN_MS = 30_000;
const MAX_WAIT_LABEL = `${MAX_PROCESSING_WAIT_MS / 3600_000} hours`;
/** Error 613 with this subcode: Meta's daily limit on ad creation for an ad account (Rate Limiting docs). */
const AD_CREATION_LIMIT_SUBCODE = 1487225;
const AD_CREATION_LIMIT_MESSAGE =
  "Meta's daily limit for creating ads in this ad account was reached (it depends on the account's daily spending limit). Retry the launch tomorrow or raise the daily spending limit.";

/**
 * How long after `inFlightSince` Meta may still process a create request (pre-send waits, the configured
 * request timeout, then a margin). Until then an object that cannot be found yet must not be created again.
 */
export function inFlightAmbiguityMs(requestTimeoutMs: number): number {
  return MAX_PRE_SEND_WAIT_MS + requestTimeoutMs + LATE_PROCESSING_MARGIN_MS;
}

export type ExecutorOutcome =
  | { kind: 'done'; status: LaunchJobStatus }
  | { kind: 'defer'; delayMs: number; reason: string }
  | { kind: 'busy' };

class DeferSignal extends Error {
  constructor(
    readonly delayMs: number,
    readonly reason: string,
  ) {
    super(reason);
  }
}

/** Another run owns the launch now (this run's lease expired or was reset): this run stops without writing. */
class LeaseLostSignal extends Error {}

/** Ends the launch as FAILED with this message; items keep their state, so a retry continues from there. */
class GiveUpSignal extends Error {}

type Item = LaunchJobItem;
type CreatedItem = Pick<Item, 'key' | 'metaId' | 'response'>;
type MediaStep = Exclude<MediaStepResult, { state: 'READY' }> | { state: 'NO_THUMBNAIL' } | { state: 'READY'; asset: CreativeMetaAsset };

/** Resolves plan references against the items created so far (`metaId` or a field of their stored response). */
function refResolver(created: CreatedItem[]): (r: PlanRef) => string | null {
  const byKey = new Map(created.map((i) => [i.key, i]));
  return (r) => {
    const item = byKey.get(r.$ref);
    if (!item) return null;
    if (r.field === 'metaId') return item.metaId ?? null;
    return ((item.response ?? {}) as Record<string, string | null>)[r.field] ?? null;
  };
}

/** A FAILED item refused by Meta's daily ad-creation limit (the only throttling error that fails an item). */
const hitCreationLimit = (i: Item) => i.status === 'FAILED' && i.errorCategory === 'RATE_LIMIT';

/**
 * Launch state machine: QUEUED → VALIDATING → UPLOADING_CREATIVES → CREATING_CAMPAIGN → CREATING_ADSETS →
 * CREATING_ADS → VERIFYING → ACTIVATING → COMPLETED | PARTIAL_FAILURE | FAILED | CANCELLED.
 *
 * Duplicate prevention (double submit, worker restart, API timeout, retries):
 *  - one job per idempotency key (unique index) and one BullMQ job id per launch round;
 *  - a database lease with a token per run: only one run executes a launch at a time (also within one
 *    process), and a run whose lease was taken over stops at its next step;
 *  - every Meta object is an item with its own state. Before a create request the item is marked IN_FLIGHT
 *    (compare-and-set, committed); after success it is CREATED with the Meta id. If a worker dies or the
 *    request times out, the next attempt finds IN_FLIGHT and first *reconciles* — looks the object up in
 *    Meta by its unique name (names contain the launch code) under the parent — and only re-creates when it
 *    provably does not exist. Re-creation of an ambiguous request waits until the original request can no
 *    longer be processed (`inFlightAmbiguityMs`).
 *  - media uploads run under the per-asset lock shared with the library pre-upload job;
 *  - VERIFYING re-reads the campaign tree and removes untracked duplicates that carry this launch's code.
 * Every wait for Meta on behalf of one item (video processing, thumbnail, verifying an interrupted request)
 * is bounded by MAX_PROCESSING_WAIT_MS; then the item or the launch fails instead of waiting forever.
 */
@Injectable()
export class LaunchExecutorService {
  private readonly logger = new AppLogger('LaunchExecutor');

  constructor(
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly connections: MetaConnectionFactory,
    private readonly graph: MetaGraphClient,
    private readonly media: MetaMediaService,
    private readonly profileStatus: MetaProfileStatusService,
    private readonly notifications: NotificationsService,
    private readonly activity: ActivityService,
    private readonly audit: AuditService,
    private readonly entitySync: EntitySyncService,
  ) {}

  async run(launchJobId: string): Promise<ExecutorOutcome> {
    // A token per run, not per process: a second delivery of the same job in this process cannot join in.
    const lease = `${hostname()}:${process.pid}:${randomUUID()}`;
    if (!(await this.acquireLease(launchJobId, lease))) return { kind: 'busy' };
    // Keeps the lease through long steps (large uploads); a lease lost anyway is noticed at the next step.
    const keepAlive = setInterval(() => void this.renewLease(launchJobId, lease).catch(() => undefined), LEASE_MS / 3);
    try {
      return await this.execute(launchJobId, lease);
    } catch (err) {
      if (err instanceof LeaseLostSignal) return { kind: 'busy' };
      throw err;
    } finally {
      clearInterval(keepAlive);
      await this.prisma.launchJob.updateMany({ where: { id: launchJobId, leaseOwner: lease }, data: { leaseOwner: null, leaseExpiresAt: null } });
    }
  }

  /** Used by the worker when a launch ran out of retries for a temporary error. */
  async markFailed(launchJobId: string, message: string): Promise<void> {
    const job = await this.prisma.launchJob.findUnique({ where: { id: launchJobId } });
    if (!job || ['COMPLETED', 'PARTIAL_FAILURE', 'FAILED', 'CANCELLED'].includes(job.status)) return;
    await this.finish(job, 'FAILED', { message });
  }

  private async acquireLease(id: string, lease: string): Promise<boolean> {
    const now = new Date();
    const res = await this.prisma.launchJob.updateMany({
      where: {
        id,
        status: { notIn: ['COMPLETED', 'PARTIAL_FAILURE', 'FAILED', 'CANCELLED'] },
        OR: [{ leaseOwner: null }, { leaseExpiresAt: { lt: now } }],
      },
      data: { leaseOwner: lease, leaseExpiresAt: new Date(now.getTime() + LEASE_MS), attempt: { increment: 1 } },
    });
    return res.count === 1;
  }

  /** Extends this run's lease; stops the run (LeaseLostSignal) when another run owns the launch now. */
  private async renewLease(id: string, lease: string): Promise<void> {
    const res = await this.prisma.launchJob.updateMany({ where: { id, leaseOwner: lease }, data: { leaseExpiresAt: new Date(Date.now() + LEASE_MS) } });
    if (res.count !== 1) throw new LeaseLostSignal();
  }

  private async execute(id: string, lease: string): Promise<ExecutorOutcome> {
    const job = await this.prisma.launchJob.findUniqueOrThrow({
      where: { id },
      include: { profile: { include: { proxy: true } }, adAccount: true },
    });
    if (job.status === 'QUEUED') await this.setStatus(job.id, lease, 'VALIDATING', { startedAt: job.startedAt ?? new Date() });

    const conn = await this.connections.forProfile(job.profile);
    const metaAccountId = job.adAccount.metaAccountId;
    try {
      if (job.profile.status !== 'ACTIVE' || job.profile.deletedAt) {
        return this.finish(job, 'FAILED', { message: 'The Meta profile token is not active. Fix the token and retry the launch.' });
      }
      if (!job.adAccount.isConnected) return this.finish(job, 'FAILED', { message: 'The ad account was disconnected.' });

      // UPLOADING_CREATIVES — media first: nothing is created in Meta if a video fails processing.
      await this.setStatus(job.id, lease, 'UPLOADING_CREATIVES');
      for (const item of await this.items(job.id, ['MEDIA_IMAGE', 'MEDIA_VIDEO'])) {
        await this.checkCancel(job);
        await this.processMedia(job, lease, conn, item, metaAccountId);
      }
      const mediaFailed = (await this.items(job.id, ['MEDIA_IMAGE', 'MEDIA_VIDEO'])).filter((i) => i.status === 'FAILED');
      if (mediaFailed.length) {
        await this.skipAll(job.id, ['CAMPAIGN', 'ADSET', 'CREATIVE', 'AD'], 'A creative could not be uploaded to Meta');
        return this.finish(job, 'FAILED', { message: `${mediaFailed.length} creative(s) could not be uploaded or processed by Meta.` });
      }

      // CREATING_CAMPAIGN
      await this.setStatus(job.id, lease, 'CREATING_CAMPAIGN');
      const [campaign] = await this.items(job.id, ['CAMPAIGN']);
      if (!campaign) return this.finish(job, 'FAILED', { message: 'Invalid plan: no campaign' });
      await this.checkCancel(job);
      await this.createObject(job, lease, conn, campaign, `/${actId(metaAccountId)}/campaigns`, 'campaign.create', metaAccountId);
      const campaignItem = await this.prisma.launchJobItem.findUniqueOrThrow({ where: { id: campaign.id } });
      if (campaignItem.status === 'FAILED') {
        await this.skipAll(job.id, ['ADSET', 'CREATIVE', 'AD'], 'Campaign creation failed');
        const message = hitCreationLimit(campaignItem) ? AD_CREATION_LIMIT_MESSAGE : 'The campaign could not be created.';
        return this.finish(job, 'FAILED', { message, details: campaignItem.lastError });
      }
      await this.prisma.launchJob.update({ where: { id: job.id }, data: { metaCampaignId: campaignItem.metaId } });

      // CREATING_ADSETS
      await this.setStatus(job.id, lease, 'CREATING_ADSETS');
      for (const item of await this.items(job.id, ['ADSET'])) {
        await this.checkCancel(job);
        await this.createObject(job, lease, conn, item, `/${actId(metaAccountId)}/adsets`, 'adset.create', metaAccountId);
        const after = await this.prisma.launchJobItem.findUniqueOrThrow({ where: { id: item.id } });
        if (after.status === 'FAILED') {
          await this.prisma.launchJobItem.updateMany({
            where: { launchJobId: job.id, parentKey: item.key, status: { in: ['PENDING'] } },
            data: { status: 'SKIPPED', lastError: { message: 'The ad set was not created' } },
          });
        }
      }

      // CREATING_ADS (creative, then the ad that uses it)
      await this.setStatus(job.id, lease, 'CREATING_ADS');
      const creatives = await this.items(job.id, ['CREATIVE']);
      for (const creative of creatives) {
        await this.checkCancel(job);
        if (creative.status === 'SKIPPED') continue;
        await this.createObject(job, lease, conn, creative, `/${actId(metaAccountId)}/adcreatives`, 'creative.create', metaAccountId);
        const adKey = creative.key.replace(/^creative:/, 'ad:');
        const ad = await this.prisma.launchJobItem.findUnique({ where: { launchJobId_key: { launchJobId: job.id, key: adKey } } });
        const creativeAfter = await this.prisma.launchJobItem.findUniqueOrThrow({ where: { id: creative.id } });
        if (!ad) continue;
        if (creativeAfter.status === 'FAILED') {
          await this.prisma.launchJobItem.updateMany({ where: { id: ad.id, status: 'PENDING' }, data: { status: 'SKIPPED', lastError: { message: 'The ad creative was not created' } } });
          continue;
        }
        await this.createObject(job, lease, conn, ad, `/${actId(metaAccountId)}/ads`, 'ad.create', metaAccountId);
      }

      // VERIFYING
      await this.setStatus(job.id, lease, 'VERIFYING');
      await this.verify(job, conn, campaignItem.metaId!);

      const all = await this.items(job.id);
      const failed = all.filter((i) => i.status === 'FAILED' || i.status === 'SKIPPED');
      const createdAds = all.filter((i) => i.kind === 'AD' && (i.status === 'CREATED' || i.status === 'VERIFIED'));

      // ACTIVATING — only when everything was created and the user asked for it.
      let notActivated: string | undefined;
      if (job.activateOnSuccess && failed.length === 0) {
        await this.setStatus(job.id, lease, 'ACTIVATING');
        notActivated = await this.activate(job, conn, campaignItem.metaId!, metaAccountId);
      }
      await this.entitySync.syncCampaignTree(job.adAccount, conn, campaignItem.metaId!, { launchJobId: job.id, templateId: job.templateId });

      if (failed.length === 0) return this.finish(job, 'COMPLETED', undefined, { notActivated });
      const limit = failed.some(hitCreationLimit) ? `${AD_CREATION_LIMIT_MESSAGE} ` : '';
      return this.finish(job, createdAds.length ? 'PARTIAL_FAILURE' : 'FAILED', {
        message: `${failed.length} object(s) could not be created. ${limit}The campaign was left paused.`,
      });
    } catch (err) {
      if (err instanceof DeferSignal) return { kind: 'defer', delayMs: err.delayMs, reason: err.reason };
      if (err instanceof CancelSignal) return this.finish(job, 'CANCELLED', { message: 'The launch was cancelled. Objects already created were left paused.' });
      if (err instanceof GiveUpSignal) return this.finish(job, 'FAILED', { message: err.message });
      if (err instanceof MetaApiError && err.category === 'RATE_LIMIT') {
        return { kind: 'defer', delayMs: err.details.retryAfterMs ?? 60_000, reason: 'Meta rate limit' };
      }
      if (err instanceof MetaApiError && (err.category === 'AUTH' || err.category === 'PERMISSION')) {
        await this.profileStatus.onApiError(job.profileId, err, job.profile.tokenFingerprint);
        return this.finish(job, 'FAILED', { message: err.details.friendlyMessage, meta: err.details });
      }
      throw err; // transient: BullMQ retries with backoff, state is preserved in the items
    }
  }

  /**
   * Activates the campaign; returns Meta's reason when it refuses. Every object exists at this point, so a
   * refusal (validation, policy) completes the launch with a warning instead of being retried for an hour
   * and reported as a failed creation.
   */
  private async activate(job: LaunchJob, conn: MetaConnection, campaignMetaId: string, metaAccountId: string): Promise<string | undefined> {
    try {
      await this.graph.call(conn, { method: 'POST', path: `/${campaignMetaId}`, params: { status: 'ACTIVE' }, category: 'campaign.activate', metaAccountId, safeToRetry: true });
      return undefined;
    } catch (err) {
      if (!(err instanceof MetaApiError) || err.retryable || err.category === 'AUTH' || err.category === 'PERMISSION') throw err;
      const message = err.details.friendlyMessage.trim();
      const reason = /[.!?]$/.test(message) ? message : `${message}.`;
      await this.addWarning(job.id, { path: 'activation', message: `The campaign was created but not activated: ${reason}` });
      return reason;
    }
  }

  // ───────────────────────── media ─────────────────────────

  private async processMedia(job: LaunchJob, lease: string, conn: MetaConnection, item: Item, metaAccountId: string): Promise<void> {
    if (item.status === 'CREATED' || item.status === 'VERIFIED' || item.status === 'FAILED') return;
    await this.renewLease(job.id, lease);
    const fileId = (item.request as { creativeFileId: string }).creativeFileId;
    const file = await this.prisma.creativeFile.findFirst({ where: { id: fileId, userId: job.userId } });
    if (!file || file.deletedAt) {
      await this.failItem(item, { message: 'The creative file was deleted from the library' }, 'VALIDATION');
      return;
    }
    const asset = await this.prisma.creativeMetaAsset.upsert({
      where: { creativeFileId_adAccountId: { creativeFileId: fileId, adAccountId: job.adAccountId } },
      create: { userId: job.userId, creativeFileId: fileId, adAccountId: job.adAccountId },
      update: {},
    });
    await this.prisma.launchJobItem.update({ where: { id: item.id }, data: { status: 'IN_FLIGHT', inFlightSince: item.inFlightSince ?? new Date(), attemptCount: { increment: 1 } } });
    try {
      // The library pre-upload job and other launches take the same lock: one upload per file and ad account.
      const locked = await this.media.withAssetLock(asset.id, () => this.mediaStep(conn, asset.id, file, metaAccountId));
      const step: MediaStep | { state: 'LOCKED' } = locked.acquired ? locked.result : { state: 'LOCKED' };
      if (step.state === 'LOCKED') {
        await this.waitOrFail(item, 20_000, 'Another upload of this creative is in progress', `The creative was locked by another upload for ${MAX_WAIT_LABEL}.`);
        return;
      }
      if (step.state === 'PROCESSING') {
        await this.waitOrFail(item, step.recheckInMs, 'Waiting for Meta to process the video', `Meta did not finish processing the video within ${MAX_WAIT_LABEL}.`);
        return;
      }
      if (step.state === 'NO_THUMBNAIL') {
        await this.waitOrFail(item, 15_000, 'Waiting for the video thumbnail', `Meta did not provide a thumbnail for the video within ${MAX_WAIT_LABEL}.`);
        return;
      }
      if (step.state === 'FAILED') {
        await this.failItem(item, { message: step.error }, 'MEDIA');
        return;
      }
      const ready = step.asset;
      await this.prisma.launchJobItem.update({
        where: { id: item.id },
        data: {
          status: 'CREATED',
          metaId: ready.metaImageHash ?? ready.metaVideoId,
          response: { imageHash: ready.metaImageHash, videoId: ready.metaVideoId, thumbnailUrl: ready.thumbnailUrl },
          lastError: Prisma.DbNull,
          deferredSince: null,
        },
      });
      await this.bumpProgress(job.id);
    } catch (err) {
      if (err instanceof DeferSignal) throw err;
      if (err instanceof MetaApiError && !err.retryable && err.category !== 'AUTH' && err.category !== 'PERMISSION') {
        await this.failItem(item, { message: err.details.friendlyMessage, meta: err.details }, err.category);
        return;
      }
      throw err;
    }
  }

  /** One upload/processing step under the asset lock, on the asset row as it is now. */
  private async mediaStep(conn: MetaConnection, assetId: string, file: CreativeFile, metaAccountId: string): Promise<MediaStep> {
    let asset = await this.prisma.creativeMetaAsset.findUniqueOrThrow({ where: { id: assetId } });
    if (asset.status === 'FAILED') asset = await this.prisma.creativeMetaAsset.update({ where: { id: assetId }, data: { status: 'PENDING', error: null } });
    const result = await this.media.process(conn, asset, file, metaAccountId);
    if (result.state !== 'READY') return result;
    asset = await this.prisma.creativeMetaAsset.findUniqueOrThrow({ where: { id: assetId } });
    if (file.type === 'VIDEO' && !asset.thumbnailUrl) {
      const thumb = await this.media.preferredThumbnail(conn, asset.metaVideoId!);
      if (!thumb) return { state: 'NO_THUMBNAIL' };
      asset = await this.prisma.creativeMetaAsset.update({ where: { id: assetId }, data: { thumbnailUrl: thumb } });
    }
    return { state: 'READY', asset };
  }

  // ───────────────────────── waiting for Meta ─────────────────────────

  /**
   * Re-schedules the launch while `item` waits for Meta, or — once the item has waited MAX_PROCESSING_WAIT_MS
   * in a row — returns null so that the caller gives up instead of waiting forever.
   */
  private async startWait(item: Item, delayMs: number, reason: string): Promise<DeferSignal | null> {
    const since = item.deferredSince ?? new Date();
    if (Date.now() - since.getTime() > MAX_PROCESSING_WAIT_MS) return null;
    if (!item.deferredSince) await this.prisma.launchJobItem.update({ where: { id: item.id }, data: { deferredSince: since } });
    return new DeferSignal(delayMs, reason);
  }

  private async waitOrFail(item: Item, delayMs: number, reason: string, giveUp: string): Promise<void> {
    const wait = await this.startWait(item, delayMs, reason);
    if (wait) throw wait;
    await this.failItem(item, { message: giveUp }, 'MEDIA');
  }

  // ───────────────────────── object creation ─────────────────────────

  private async createObject(job: LaunchJob, lease: string, conn: MetaConnection, item: Item, endpoint: string, category: string, metaAccountId: string): Promise<void> {
    await this.renewLease(job.id, lease);
    const current = await this.prisma.launchJobItem.findUniqueOrThrow({ where: { id: item.id } });
    if (current.status === 'CREATED' || current.status === 'VERIFIED' || current.status === 'FAILED' || current.status === 'SKIPPED') return;

    if (current.status === 'IN_FLIGHT') {
      let found: string | null;
      try {
        found = await this.reconcile(job, conn, current, metaAccountId);
      } catch (err) {
        if (!(err instanceof MetaApiError) || !isMissingOrInaccessible(err.details)) throw err;
        if (current.kind === 'ADSET' || current.kind === 'AD') {
          // The parent is gone (e.g. deleted in Ads Manager): the object cannot exist there nor be created.
          await this.failItem(current, { message: err.details.friendlyMessage, meta: err.details }, err.category);
          return;
        }
        // The ad account cannot be read: stop; the item stays IN_FLIGHT so that a retry verifies it first.
        throw new GiveUpSignal(err.details.friendlyMessage);
      }
      if (found) {
        await this.markCreated(job.id, current, found, { reconciled: true });
        return;
      }
      const since = current.inFlightSince?.getTime() ?? 0;
      const wait = since + inFlightAmbiguityMs(this.config.meta.timeoutMs) - Date.now();
      if (wait > 0) throw new DeferSignal(wait + 1000, `Checking whether "${current.name}" was created before re-trying`);
    }

    const payload = resolveRefs(current.request, refResolver(await this.createdItems(job.id))) as Record<string, unknown>;
    // Compare-and-set on the version read above: when another run of this launch changed the item, that run
    // owns it and this one stops.
    const claimed = await this.prisma.launchJobItem.updateMany({
      where: { id: current.id, status: current.status, updatedAt: current.updatedAt },
      data: { status: 'IN_FLIGHT', inFlightSince: new Date(), deferredSince: null, attemptCount: { increment: 1 } },
    });
    if (claimed.count !== 1) throw new LeaseLostSignal();
    try {
      const res = await this.graph.call<{ id: string }>(conn, { method: 'POST', path: endpoint, params: payload, category, metaAccountId });
      await this.markCreated(job.id, current, res.data.id, res.data);
    } catch (err) {
      if (err instanceof MetaNetworkError) {
        if (!err.sent) {
          // Never reached Meta: safe to send again later.
          await this.prisma.launchJobItem.update({ where: { id: current.id }, data: { status: 'PENDING', inFlightSince: null, lastError: { message: err.message } } });
        }
        throw err; // ambiguous → stays IN_FLIGHT → reconciled on the next attempt
      }
      if (err instanceof MetaApiError) {
        if (err.metaCode === 613 && err.metaSubcode === AD_CREATION_LIMIT_SUBCODE) {
          // The limit is per ad account and day: every further create request would be refused the same way.
          await this.failItem(current, { message: AD_CREATION_LIMIT_MESSAGE, meta: err.details }, 'RATE_LIMIT');
          await this.skipAll(job.id, ['CAMPAIGN', 'ADSET', 'CREATIVE', 'AD'], AD_CREATION_LIMIT_MESSAGE);
          return;
        }
        if (err.category === 'RATE_LIMIT') {
          // Throttled requests are rejected before processing.
          await this.prisma.launchJobItem.update({ where: { id: current.id }, data: { status: 'PENDING', inFlightSince: null } });
          throw err;
        }
        if (err.category === 'TRANSIENT' || err.category === 'UNKNOWN') throw err; // may have been processed → reconcile
        if (err.category === 'AUTH' || err.category === 'PERMISSION') {
          await this.failItem(current, { message: err.details.friendlyMessage, meta: err.details }, err.category);
          throw err;
        }
        await this.failItem(current, { message: err.details.friendlyMessage, meta: err.details }, err.category);
        return;
      }
      throw err;
    }
  }

  private async markCreated(jobId: string, item: Item, metaId: string, response: Record<string, unknown>) {
    await this.prisma.launchJobItem.update({
      where: { id: item.id },
      data: { status: 'CREATED', metaId, response: response as Prisma.InputJsonValue, lastError: Prisma.DbNull, errorCategory: null, deferredSince: null },
    });
    await this.bumpProgress(jobId);
  }

  private async failItem(item: Item, error: Record<string, unknown>, category: string) {
    await this.prisma.launchJobItem.update({
      where: { id: item.id },
      data: { status: 'FAILED', lastError: error as Prisma.InputJsonValue, errorCategory: category },
    });
    await this.prisma.launchJob.update({ where: { id: item.launchJobId }, data: { failedItems: { increment: 1 } } });
  }

  /** Items created so far, read fresh: references never come from state another run may have changed. */
  private createdItems(jobId: string): Promise<CreatedItem[]> {
    return this.prisma.launchJobItem.findMany({ where: { launchJobId: jobId, status: { in: ['CREATED', 'VERIFIED'] } }, select: { key: true, metaId: true, response: true } });
  }

  private async items(jobId: string, kinds?: Item['kind'][]): Promise<Item[]> {
    return this.prisma.launchJobItem.findMany({
      where: { launchJobId: jobId, ...(kinds ? { kind: { in: kinds } } : {}) },
      orderBy: { position: 'asc' },
    });
  }

  // ───────────────────────── reconciliation ─────────────────────────

  /**
   * Looks for an object created by an earlier (interrupted/timed-out) request with exactly this name.
   * Throttling, token, permission and not-found errors are thrown to the caller; any other lookup failure
   * re-schedules the lookup — for at most MAX_PROCESSING_WAIT_MS, then the launch stops as FAILED.
   */
  private async reconcile(job: LaunchJob, conn: MetaConnection, item: Item, metaAccountId: string): Promise<string | null> {
    const name = (item.request as { name?: string }).name ?? item.name;
    const since = (item.inFlightSince?.getTime() ?? job.createdAt.getTime()) - 5 * 60_000;
    const known = new Set((await this.prisma.launchJobItem.findMany({ where: { launchJobId: job.id, metaId: { not: null } }, select: { metaId: true } })).map((i) => i.metaId));
    const parent = item.parentKey
      ? await this.prisma.launchJobItem.findUnique({ where: { launchJobId_key: { launchJobId: job.id, key: item.parentKey } }, select: { metaId: true } })
      : null;
    const pick = (list: { id: string; name?: string; created_time?: string }[]) =>
      list.find((o) => o.name === name && !known.has(o.id) && (!o.created_time || new Date(o.created_time).getTime() >= since))?.id ?? null;
    type Row = { id: string; name: string; created_time?: string };
    /** Account-level lookup: name filter first; if Meta rejects the filter, scan the most recent objects. */
    const accountLookup = async (edge: 'campaigns', fields: string, category: string): Promise<Row[]> => {
      const needle = name.includes(job.code) ? job.code : name.slice(0, 100);
      try {
        return await this.graph.paginate<Row>(conn, `/${actId(metaAccountId)}/${edge}`, { fields, filtering: [{ field: 'name', operator: 'CONTAIN', value: needle }] }, category, { metaAccountId }, 500);
      } catch (err) {
        if (!(err instanceof MetaApiError) || err.category !== 'VALIDATION') throw err;
        return this.graph.paginate<Row>(conn, `/${actId(metaAccountId)}/${edge}`, { fields }, category, { metaAccountId }, 500);
      }
    };
    try {
      if (item.kind === 'CAMPAIGN') return pick(await accountLookup('campaigns', 'id,name,created_time', 'reconcile.campaign'));
      if (item.kind === 'CREATIVE') {
        // Name filtering is not documented for /adcreatives: scan the most recent creatives instead. A creative
        // missed here only leaves an unused creative behind (it cannot deliver), never a duplicate ad.
        return pick(await this.graph.paginate<Row>(conn, `/${actId(metaAccountId)}/adcreatives`, { fields: 'id,name' }, 'reconcile.creative', { metaAccountId }, 500));
      }
      const parentMetaId = parent?.metaId;
      if (!parentMetaId) return null;
      if (item.kind === 'ADSET') {
        return pick(await this.graph.paginate<Row>(conn, `/${parentMetaId}/adsets`, { fields: 'id,name,created_time' }, 'reconcile.adset', { metaAccountId }, 1000));
      }
      if (item.kind === 'AD') {
        return pick(await this.graph.paginate<Row>(conn, `/${parentMetaId}/ads`, { fields: 'id,name,created_time' }, 'reconcile.ad', { metaAccountId }, 1000));
      }
    } catch (err) {
      if (err instanceof MetaApiError && (['RATE_LIMIT', 'AUTH', 'PERMISSION'].includes(err.category) || isMissingOrInaccessible(err.details))) throw err;
      this.logger.warn('Reconciliation lookup failed', { item: item.key, err: String(err) });
      // Unknown state: do not risk a duplicate — wait and retry the lookup, but not forever.
      const wait = await this.startWait(item, 60_000, 'Could not verify an interrupted request yet');
      if (wait) throw wait;
      throw new GiveUpSignal(`Could not verify within ${MAX_WAIT_LABEL} whether "${item.name}" was created by an interrupted request. Retry the launch to check again.`);
    }
    return null;
  }

  // ───────────────────────── verification ─────────────────────────

  private async verify(job: LaunchJob, conn: MetaConnection, campaignMetaId: string): Promise<void> {
    const metaAccountId = (await this.prisma.adAccount.findUniqueOrThrow({ where: { id: job.adAccountId } })).metaAccountId;
    const [adSets, ads] = await Promise.all([
      this.graph.paginate<{ id: string; name: string; created_time?: string }>(conn, `/${campaignMetaId}/adsets`, { fields: 'id,name,created_time,effective_status' }, 'verify.adsets', { metaAccountId }, 2000),
      this.graph.paginate<{ id: string; name: string; created_time?: string; adset_id?: string }>(conn, `/${campaignMetaId}/ads`, { fields: 'id,name,created_time,adset_id,effective_status' }, 'verify.ads', { metaAccountId }, 5000),
    ]);
    const items = await this.items(job.id, ['ADSET', 'AD']);
    const tracked = new Set(items.map((i) => i.metaId).filter(Boolean));
    const existing = new Set([...adSets, ...ads].map((o) => o.id));
    for (const item of items) {
      if (item.status !== 'CREATED') continue;
      if (item.metaId && existing.has(item.metaId)) {
        await this.prisma.launchJobItem.update({ where: { id: item.id }, data: { status: 'VERIFIED' } });
      } else {
        await this.failItem(item, { message: 'The object was not found in Meta during verification' }, 'VERIFY');
      }
    }
    // Duplicates created by an interrupted request that could not be reconciled in time: same name as a
    // tracked item, created by this launch, not tracked. They are deleted (they never delivered: the
    // campaign is still paused at this point).
    const trackedNames = new Set(items.map((i) => i.name));
    const orphans = [...adSets, ...ads].filter((o) => !tracked.has(o.id) && trackedNames.has(o.name));
    for (const o of orphans) {
      try {
        await this.graph.call(conn, { method: 'POST', path: `/${o.id}`, params: { status: 'DELETED' }, category: 'verify.remove_duplicate', metaAccountId, safeToRetry: true });
        this.logger.warn('Removed duplicate object created by an interrupted request', { launchJobId: job.id, metaId: o.id });
      } catch (err) {
        this.logger.warn('Could not remove duplicate object', { metaId: o.id, err: String(err) });
      }
    }
    if (orphans.length) await this.addWarning(job.id, { path: 'verify', message: `${orphans.length} duplicate object(s) from an interrupted request were removed` });
  }

  // ───────────────────────── helpers ─────────────────────────

  /** Appends a warning to the launch (once: repeating a step does not repeat its warning). */
  private async addWarning(jobId: string, warning: { path: string; message: string }): Promise<void> {
    const { warnings } = await this.prisma.launchJob.findUniqueOrThrow({ where: { id: jobId }, select: { warnings: true } });
    const list = Array.isArray(warnings) ? (warnings as { path?: string; message?: string }[]) : [];
    if (list.some((w) => w.path === warning.path && w.message === warning.message)) return;
    await this.prisma.launchJob.update({ where: { id: jobId }, data: { warnings: [...list, warning] as Prisma.InputJsonValue } });
  }

  private async checkCancel(job: LaunchJob): Promise<void> {
    const row = await this.prisma.launchJob.findUniqueOrThrow({ where: { id: job.id }, select: { cancelRequestedAt: true } });
    if (row.cancelRequestedAt) throw new CancelSignal();
  }

  private async skipAll(jobId: string, kinds: Item['kind'][], message: string) {
    await this.prisma.launchJobItem.updateMany({
      where: { launchJobId: jobId, kind: { in: kinds }, status: { in: ['PENDING'] } },
      data: { status: 'SKIPPED', lastError: { message } },
    });
  }

  private async setStatus(id: string, lease: string, status: LaunchJobStatus, extra: Prisma.LaunchJobUpdateInput = {}) {
    await this.renewLease(id, lease);
    await this.prisma.launchJob.update({ where: { id }, data: { status, currentStep: status, ...extra } });
  }

  private async bumpProgress(jobId: string) {
    const [total, done] = await Promise.all([
      this.prisma.launchJobItem.count({ where: { launchJobId: jobId } }),
      this.prisma.launchJobItem.count({ where: { launchJobId: jobId, status: { in: ['CREATED', 'VERIFIED'] } } }),
    ]);
    await this.prisma.launchJob.update({
      where: { id: jobId },
      data: { createdItems: done, progress: total ? Math.min(99, Math.round((done / total) * 100)) : 0 },
    });
  }

  private async finish(job: LaunchJob, status: LaunchJobStatus, error?: Record<string, unknown>, opts: { notActivated?: string } = {}): Promise<ExecutorOutcome> {
    const items = await this.items(job.id);
    const failed = items.filter((i) => i.status === 'FAILED' || i.status === 'SKIPPED').length;
    const created = items.filter((i) => i.status === 'CREATED' || i.status === 'VERIFIED').length;
    const campaign = items.find((i) => i.kind === 'CAMPAIGN');
    const adCount = items.filter((i) => i.kind === 'AD' && (i.status === 'CREATED' || i.status === 'VERIFIED')).length;
    // The notification is created before the terminal status is written: if the run stops in between, a
    // later run finishes the launch again and repeats the alert, instead of the alert being lost.
    if (status === 'COMPLETED') {
      const activation = !job.activateOnSuccess
        ? '; the campaign is paused until you start it'
        : opts.notActivated
          ? `, but Meta did not activate the campaign: ${opts.notActivated} It is paused until you start it`
          : ' and the campaign was activated';
      await this.notifications.notify({
        userId: job.userId,
        type: 'CAMPAIGN_LAUNCHED',
        severity: opts.notActivated ? 'WARNING' : 'SUCCESS',
        title: `Campaign "${job.name}" created`,
        body: `${adCount} ad(s) were created${activation}. Launch code ${job.code}.`,
        link: `/launch/jobs/${job.id}`,
        dedupeKey: `launch-finished:${job.id}:${job.attempt}`,
      });
    } else if (status !== 'CANCELLED') {
      await this.notifications.notify({
        userId: job.userId,
        type: 'CAMPAIGN_CREATION_FAILED',
        severity: status === 'PARTIAL_FAILURE' ? 'WARNING' : 'ERROR',
        title: `Campaign "${job.name}": ${status === 'PARTIAL_FAILURE' ? 'partially created' : 'creation failed'}`,
        body: `${typeof error?.message === 'string' ? error.message : 'Some objects could not be created.'} Open the launch to see the details and retry.`,
        link: `/launch/jobs/${job.id}`,
        dedupeKey: `launch-finished:${job.id}:${job.attempt}`,
      });
    }
    await this.prisma.launchJob.update({
      where: { id: job.id },
      data: {
        status,
        currentStep: status,
        finishedAt: new Date(),
        progress: status === 'COMPLETED' ? 100 : Math.round((created / Math.max(1, items.length)) * 100),
        createdItems: created,
        failedItems: failed,
        error: error ? (error as Prisma.InputJsonValue) : Prisma.DbNull,
      },
    });
    await this.activity.record({
      userId: job.userId,
      type: status === 'COMPLETED' ? 'LAUNCH_COMPLETED' : 'LAUNCH_FAILED',
      title: `Launch ${job.code} "${job.name}": ${status.replace('_', ' ').toLowerCase()}`,
      source: 'LAUNCH',
      adAccountId: job.adAccountId,
      entityLevel: campaign?.metaId ? 'CAMPAIGN' : null,
      entityMetaId: campaign?.metaId ?? null,
      entityName: campaign?.name ?? null,
      details: { launchJobId: job.id, status, created, failed },
    });
    await this.audit.log({
      action: status === 'COMPLETED' ? 'campaign.created' : 'campaign.creation_failed',
      actorUserId: job.userId,
      actorType: 'SYSTEM',
      subjectUserId: job.userId,
      targetType: 'launch_job',
      targetId: job.id,
      metadata: { code: job.code, status, metaCampaignId: campaign?.metaId, created, failed },
    });
    return { kind: 'done', status };
  }
}

class CancelSignal extends Error {}
