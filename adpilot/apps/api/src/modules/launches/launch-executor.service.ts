import { Injectable } from '@nestjs/common';
import { hostname } from 'node:os';
import type { LaunchJobStatus } from '@adpilot/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AppLogger } from '../../infra/logger/logger';
import { MetaConnectionFactory } from '../meta/meta-connection.factory';
import { MetaConnection, MetaGraphClient } from '../meta/graph/meta-graph.client';
import { MetaApiError, MetaNetworkError } from '../meta/graph/meta-errors';
import { MetaProfileStatusService } from '../meta/meta-profile-status.service';
import { MetaMediaService } from '../creatives/meta-media.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ActivityService } from '../activity/activity.service';
import { AuditService } from '../audit/audit.service';
import { EntitySyncService } from '../campaigns/entity-sync.service';
import { actId } from '../meta/meta-fields';
import { resolveRefs } from './meta-payloads';
import type { PlanRef } from './launch.types';
import { Prisma, type LaunchJob, type LaunchJobItem } from '../../generated/prisma/client';

const LEASE_MS = 10 * 60_000;
/** A request may still be processed by Meta this long after it was sent (HTTP timeout + margin). */
const IN_FLIGHT_AMBIGUITY_MS = 2 * 60_000 + 30_000;

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

type Item = LaunchJobItem;

/**
 * Launch state machine: QUEUED → VALIDATING → UPLOADING_CREATIVES → CREATING_CAMPAIGN → CREATING_ADSETS →
 * CREATING_ADS → VERIFYING → ACTIVATING → COMPLETED | PARTIAL_FAILURE | FAILED | CANCELLED.
 *
 * Duplicate prevention (double submit, worker restart, API timeout, retries):
 *  - one job per idempotency key (unique index) and one BullMQ job id per launch round;
 *  - a database lease: only one worker executes a launch at a time;
 *  - every Meta object is an item with its own state. Before a create request the item is marked IN_FLIGHT
 *    (committed); after success it is CREATED with the Meta id. If a worker dies or the request times out,
 *    the next attempt finds IN_FLIGHT and first *reconciles* — looks the object up in Meta by its unique
 *    name (names contain the launch code) under the parent — and only re-creates when it provably does not
 *    exist. Re-creation of an ambiguous request waits until the original request can no longer be processed.
 *  - VERIFYING re-reads the campaign tree and removes untracked duplicates that carry this launch's code.
 */
@Injectable()
export class LaunchExecutorService {
  private readonly logger = new AppLogger('LaunchExecutor');
  private readonly workerId = `${hostname()}:${process.pid}`;

  constructor(
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
    if (!(await this.acquireLease(launchJobId))) return { kind: 'busy' };
    try {
      return await this.execute(launchJobId);
    } finally {
      for (const key of [...this.refCache.keys()]) if (key.startsWith(`${launchJobId}:`)) this.refCache.delete(key);
      await this.prisma.launchJob.updateMany({ where: { id: launchJobId, leaseOwner: this.workerId }, data: { leaseOwner: null, leaseExpiresAt: null } });
    }
  }

  /** Used by the worker when a launch ran out of retries for a temporary error. */
  async markFailed(launchJobId: string, message: string): Promise<void> {
    const job = await this.prisma.launchJob.findUnique({ where: { id: launchJobId } });
    if (!job || ['COMPLETED', 'PARTIAL_FAILURE', 'FAILED', 'CANCELLED'].includes(job.status)) return;
    await this.finish(job, 'FAILED', { message });
  }

  private async acquireLease(id: string): Promise<boolean> {
    const now = new Date();
    const res = await this.prisma.launchJob.updateMany({
      where: {
        id,
        status: { notIn: ['COMPLETED', 'PARTIAL_FAILURE', 'FAILED', 'CANCELLED'] },
        OR: [{ leaseOwner: null }, { leaseExpiresAt: { lt: now } }, { leaseOwner: this.workerId }],
      },
      data: { leaseOwner: this.workerId, leaseExpiresAt: new Date(now.getTime() + LEASE_MS), attempt: { increment: 1 } },
    });
    return res.count === 1;
  }

  private async renewLease(id: string): Promise<void> {
    await this.prisma.launchJob.updateMany({ where: { id, leaseOwner: this.workerId }, data: { leaseExpiresAt: new Date(Date.now() + LEASE_MS) } });
  }

  private async execute(id: string): Promise<ExecutorOutcome> {
    const job = await this.prisma.launchJob.findUniqueOrThrow({
      where: { id },
      include: { profile: { include: { proxy: true } }, adAccount: true },
    });
    if (job.status === 'QUEUED') await this.setStatus(job.id, 'VALIDATING', { startedAt: job.startedAt ?? new Date() });

    const conn = await this.connections.forProfile(job.profile);
    const metaAccountId = job.adAccount.metaAccountId;
    try {
      if (job.profile.status !== 'ACTIVE' || job.profile.deletedAt) {
        return this.finish(job, 'FAILED', { message: 'The Meta profile token is not active. Fix the token and retry the launch.' });
      }
      if (!job.adAccount.isConnected) return this.finish(job, 'FAILED', { message: 'The ad account was disconnected.' });

      // UPLOADING_CREATIVES — media first: nothing is created in Meta if a video fails processing.
      await this.setStatus(job.id, 'UPLOADING_CREATIVES');
      for (const item of await this.items(job.id, ['MEDIA_IMAGE', 'MEDIA_VIDEO'])) {
        await this.checkCancel(job);
        await this.processMedia(job, conn, item, metaAccountId);
      }
      const mediaFailed = (await this.items(job.id, ['MEDIA_IMAGE', 'MEDIA_VIDEO'])).filter((i) => i.status === 'FAILED');
      if (mediaFailed.length) {
        await this.skipAll(job.id, ['CAMPAIGN', 'ADSET', 'CREATIVE', 'AD'], 'A creative could not be uploaded to Meta');
        return this.finish(job, 'FAILED', { message: `${mediaFailed.length} creative(s) could not be uploaded or processed by Meta.` });
      }

      // CREATING_CAMPAIGN
      await this.setStatus(job.id, 'CREATING_CAMPAIGN');
      const [campaign] = await this.items(job.id, ['CAMPAIGN']);
      if (!campaign) return this.finish(job, 'FAILED', { message: 'Invalid plan: no campaign' });
      await this.checkCancel(job);
      await this.createObject(job, conn, campaign, `/${actId(metaAccountId)}/campaigns`, 'campaign.create', metaAccountId);
      const campaignItem = await this.prisma.launchJobItem.findUniqueOrThrow({ where: { id: campaign.id } });
      if (campaignItem.status === 'FAILED') {
        await this.skipAll(job.id, ['ADSET', 'CREATIVE', 'AD'], 'Campaign creation failed');
        return this.finish(job, 'FAILED', { message: 'The campaign could not be created.', details: campaignItem.lastError });
      }
      await this.prisma.launchJob.update({ where: { id: job.id }, data: { metaCampaignId: campaignItem.metaId } });

      // CREATING_ADSETS
      await this.setStatus(job.id, 'CREATING_ADSETS');
      for (const item of await this.items(job.id, ['ADSET'])) {
        await this.checkCancel(job);
        await this.createObject(job, conn, item, `/${actId(metaAccountId)}/adsets`, 'adset.create', metaAccountId);
        const after = await this.prisma.launchJobItem.findUniqueOrThrow({ where: { id: item.id } });
        if (after.status === 'FAILED') {
          await this.prisma.launchJobItem.updateMany({
            where: { launchJobId: job.id, parentKey: item.key, status: { in: ['PENDING'] } },
            data: { status: 'SKIPPED', lastError: { message: 'The ad set was not created' } as Prisma.InputJsonValue },
          });
        }
      }

      // CREATING_ADS (creative, then the ad that uses it)
      await this.setStatus(job.id, 'CREATING_ADS');
      const creatives = await this.items(job.id, ['CREATIVE']);
      for (const creative of creatives) {
        await this.checkCancel(job);
        if (creative.status === 'SKIPPED') continue;
        await this.createObject(job, conn, creative, `/${actId(metaAccountId)}/adcreatives`, 'creative.create', metaAccountId);
        const adKey = creative.key.replace(/^creative:/, 'ad:');
        const ad = await this.prisma.launchJobItem.findUnique({ where: { launchJobId_key: { launchJobId: job.id, key: adKey } } });
        const creativeAfter = await this.prisma.launchJobItem.findUniqueOrThrow({ where: { id: creative.id } });
        if (!ad) continue;
        if (creativeAfter.status === 'FAILED') {
          await this.prisma.launchJobItem.updateMany({ where: { id: ad.id, status: 'PENDING' }, data: { status: 'SKIPPED', lastError: { message: 'The ad creative was not created' } as Prisma.InputJsonValue } });
          continue;
        }
        await this.createObject(job, conn, ad, `/${actId(metaAccountId)}/ads`, 'ad.create', metaAccountId);
      }

      // VERIFYING
      await this.setStatus(job.id, 'VERIFYING');
      await this.verify(job, conn, campaignItem.metaId!);

      const all = await this.items(job.id);
      const failed = all.filter((i) => i.status === 'FAILED' || i.status === 'SKIPPED');
      const createdAds = all.filter((i) => i.kind === 'AD' && (i.status === 'CREATED' || i.status === 'VERIFIED'));

      // ACTIVATING — only when everything was created and the user asked for it.
      if (job.activateOnSuccess && failed.length === 0) {
        await this.setStatus(job.id, 'ACTIVATING');
        await this.graph.call(conn, { method: 'POST', path: `/${campaignItem.metaId}`, params: { status: 'ACTIVE' }, category: 'campaign.activate', metaAccountId, safeToRetry: true });
      }
      await this.entitySync.syncCampaignTree(job.adAccount, conn, campaignItem.metaId!, { launchJobId: job.id, templateId: job.templateId });

      if (failed.length === 0) return this.finish(job, 'COMPLETED');
      return this.finish(job, createdAds.length ? 'PARTIAL_FAILURE' : 'FAILED', {
        message: `${failed.length} object(s) could not be created. The campaign was left paused.`,
      });
    } catch (err) {
      if (err instanceof DeferSignal) return { kind: 'defer', delayMs: err.delayMs, reason: err.reason };
      if (err instanceof CancelSignal) return this.finish(job, 'CANCELLED', { message: 'The launch was cancelled. Objects already created were left paused.' });
      if (err instanceof MetaApiError && err.category === 'RATE_LIMIT') {
        return { kind: 'defer', delayMs: err.details.retryAfterMs ?? 60_000, reason: 'Meta rate limit' };
      }
      if (err instanceof MetaApiError && (err.category === 'AUTH' || err.category === 'PERMISSION')) {
        await this.profileStatus.onApiError(job.profileId, err);
        return this.finish(job, 'FAILED', { message: err.details.friendlyMessage, meta: err.details });
      }
      throw err; // transient: BullMQ retries with backoff, state is preserved in the items
    }
  }

  // ───────────────────────── media ─────────────────────────

  private async processMedia(job: LaunchJob, conn: MetaConnection, item: Item, metaAccountId: string): Promise<void> {
    if (item.status === 'CREATED' || item.status === 'VERIFIED' || item.status === 'FAILED') return;
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
    if (asset.status === 'FAILED') {
      await this.prisma.creativeMetaAsset.update({ where: { id: asset.id }, data: { status: 'PENDING', error: null } });
      asset.status = 'PENDING';
    }
    await this.prisma.launchJobItem.update({ where: { id: item.id }, data: { status: 'IN_FLIGHT', inFlightSince: item.inFlightSince ?? new Date(), attemptCount: { increment: 1 } } });
    try {
      const result = await this.media.process(conn, asset, file, metaAccountId);
      if (result.state === 'PROCESSING') throw new DeferSignal(result.recheckInMs, 'Waiting for Meta to process the video');
      if (result.state === 'FAILED') {
        await this.failItem(item, { message: result.error }, 'MEDIA');
        return;
      }
      const ready = await this.prisma.creativeMetaAsset.findUniqueOrThrow({ where: { id: asset.id } });
      if (file.type === 'VIDEO' && !ready.thumbnailUrl) {
        const thumb = await this.media.preferredThumbnail(conn, ready.metaVideoId!);
        if (!thumb) throw new DeferSignal(15_000, 'Waiting for the video thumbnail');
        await this.prisma.creativeMetaAsset.update({ where: { id: asset.id }, data: { thumbnailUrl: thumb } });
        ready.thumbnailUrl = thumb;
      }
      const updated = await this.prisma.launchJobItem.update({
        where: { id: item.id },
        data: {
          status: 'CREATED',
          metaId: ready.metaImageHash ?? ready.metaVideoId,
          response: { imageHash: ready.metaImageHash, videoId: ready.metaVideoId, thumbnailUrl: ready.thumbnailUrl } as Prisma.InputJsonValue,
          lastError: Prisma.DbNull,
        },
      });
      this.refCache.set(`${job.id}:${updated.key}`, updated);
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

  // ───────────────────────── object creation ─────────────────────────

  private async createObject(job: LaunchJob, conn: MetaConnection, item: Item, endpoint: string, category: string, metaAccountId: string): Promise<void> {
    await this.renewLease(job.id);
    const current = await this.prisma.launchJobItem.findUniqueOrThrow({ where: { id: item.id } });
    if (current.status === 'CREATED' || current.status === 'VERIFIED' || current.status === 'FAILED' || current.status === 'SKIPPED') return;

    if (current.status === 'IN_FLIGHT') {
      const found = await this.reconcile(job, conn, current, metaAccountId);
      if (found) {
        await this.markCreated(job.id, current, found, { reconciled: true });
        return;
      }
      const since = current.inFlightSince?.getTime() ?? 0;
      const wait = since + IN_FLIGHT_AMBIGUITY_MS - Date.now();
      if (wait > 0) throw new DeferSignal(wait + 1000, `Checking whether "${current.name}" was created before re-trying`);
    }

    const payload = resolveRefs(current.request, (r) => this.resolveRef(job.id, r)) as Record<string, unknown>;
    await this.prisma.launchJobItem.update({
      where: { id: current.id },
      data: { status: 'IN_FLIGHT', inFlightSince: new Date(), attemptCount: { increment: 1 } },
    });
    try {
      const res = await this.graph.call<{ id: string }>(conn, { method: 'POST', path: endpoint, params: payload, category, metaAccountId });
      await this.markCreated(job.id, current, res.data.id, res.data as unknown as Record<string, unknown>);
    } catch (err) {
      if (err instanceof MetaNetworkError) {
        if (!err.sent) {
          // Never reached Meta: safe to send again later.
          await this.prisma.launchJobItem.update({ where: { id: current.id }, data: { status: 'PENDING', inFlightSince: null, lastError: { message: err.message } as Prisma.InputJsonValue } });
        }
        throw err; // ambiguous → stays IN_FLIGHT → reconciled on the next attempt
      }
      if (err instanceof MetaApiError) {
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
    const updated = await this.prisma.launchJobItem.update({
      where: { id: item.id },
      data: { status: 'CREATED', metaId, response: response as Prisma.InputJsonValue, lastError: Prisma.DbNull, errorCategory: null },
    });
    this.refCache.set(`${jobId}:${updated.key}`, updated);
    await this.bumpProgress(jobId);
  }

  private async failItem(item: Item, error: Record<string, unknown>, category: string) {
    await this.prisma.launchJobItem.update({
      where: { id: item.id },
      data: { status: 'FAILED', lastError: error as Prisma.InputJsonValue, errorCategory: category },
    });
    await this.prisma.launchJob.update({ where: { id: item.launchJobId }, data: { failedItems: { increment: 1 } } });
  }

  private resolveRef(jobId: string, r: PlanRef): string | null {
    const item = this.refCache.get(`${jobId}:${r.$ref}`);
    if (!item) return null;
    if (r.field === 'metaId') return item.metaId ?? null;
    const resp = (item.response ?? {}) as Record<string, string | null>;
    return resp[r.field] ?? null;
  }

  private readonly refCache = new Map<string, Item>();

  private async items(jobId: string, kinds?: Item['kind'][]): Promise<Item[]> {
    const rows = await this.prisma.launchJobItem.findMany({
      where: { launchJobId: jobId, ...(kinds ? { kind: { in: kinds } } : {}) },
      orderBy: { position: 'asc' },
    });
    // Keep the resolver cache fresh with every read (refs always point to earlier, created items).
    for (const r of await this.prisma.launchJobItem.findMany({ where: { launchJobId: jobId, status: { in: ['CREATED', 'VERIFIED'] } } })) {
      this.refCache.set(`${jobId}:${r.key}`, r);
    }
    return rows;
  }

  // ───────────────────────── reconciliation ─────────────────────────

  /** Looks for an object created by an earlier (interrupted/timed-out) request with exactly this name. */
  private async reconcile(job: LaunchJob, conn: MetaConnection, item: Item, metaAccountId: string): Promise<string | null> {
    const name = (item.request as { name?: string }).name ?? item.name;
    const since = (item.inFlightSince?.getTime() ?? job.createdAt.getTime()) - 5 * 60_000;
    const known = new Set((await this.prisma.launchJobItem.findMany({ where: { launchJobId: job.id, metaId: { not: null } }, select: { metaId: true } })).map((i) => i.metaId));
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
      const parentMetaId = item.parentKey ? this.refCache.get(`${job.id}:${item.parentKey}`)?.metaId : undefined;
      if (!parentMetaId) return null;
      if (item.kind === 'ADSET') {
        return pick(await this.graph.paginate<Row>(conn, `/${parentMetaId}/adsets`, { fields: 'id,name,created_time' }, 'reconcile.adset', { metaAccountId }, 1000));
      }
      if (item.kind === 'AD') {
        return pick(await this.graph.paginate<Row>(conn, `/${parentMetaId}/ads`, { fields: 'id,name,created_time' }, 'reconcile.ad', { metaAccountId }, 1000));
      }
    } catch (err) {
      if (err instanceof MetaApiError && (err.category === 'RATE_LIMIT' || err.category === 'AUTH')) throw err;
      this.logger.warn('Reconciliation lookup failed', { item: item.key, err: String(err) });
      // Unknown state: do not risk a duplicate — wait and retry the lookup.
      throw new DeferSignal(60_000, 'Could not verify an interrupted request yet');
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
    if (orphans.length) {
      await this.prisma.launchJob.update({
        where: { id: job.id },
        data: { warnings: [...(((job.warnings as unknown[]) ?? []) as object[]), { path: 'verify', message: `${orphans.length} duplicate object(s) from an interrupted request were removed` }] as Prisma.InputJsonValue },
      });
    }
  }

  // ───────────────────────── helpers ─────────────────────────

  private async checkCancel(job: LaunchJob): Promise<void> {
    const row = await this.prisma.launchJob.findUniqueOrThrow({ where: { id: job.id }, select: { cancelRequestedAt: true } });
    if (row.cancelRequestedAt) throw new CancelSignal();
  }

  private async skipAll(jobId: string, kinds: Item['kind'][], message: string) {
    await this.prisma.launchJobItem.updateMany({
      where: { launchJobId: jobId, kind: { in: kinds }, status: { in: ['PENDING'] } },
      data: { status: 'SKIPPED', lastError: { message } as Prisma.InputJsonValue },
    });
  }

  private async setStatus(id: string, status: LaunchJobStatus, extra: Prisma.LaunchJobUpdateInput = {}) {
    await this.prisma.launchJob.update({ where: { id }, data: { status, currentStep: status, ...extra } });
    await this.renewLease(id);
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

  private async finish(job: LaunchJob, status: LaunchJobStatus, error?: Record<string, unknown>): Promise<ExecutorOutcome> {
    const items = await this.items(job.id);
    const failed = items.filter((i) => i.status === 'FAILED' || i.status === 'SKIPPED').length;
    const created = items.filter((i) => i.status === 'CREATED' || i.status === 'VERIFIED').length;
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
    const campaign = items.find((i) => i.kind === 'CAMPAIGN');
    const adCount = items.filter((i) => i.kind === 'AD' && (i.status === 'CREATED' || i.status === 'VERIFIED')).length;
    if (status === 'COMPLETED') {
      await this.notifications.notify({
        userId: job.userId,
        type: 'CAMPAIGN_LAUNCHED',
        severity: 'SUCCESS',
        title: `Campaign "${job.name}" created`,
        body: `${adCount} ad(s) were created${job.activateOnSuccess ? ' and the campaign was activated' : '; the campaign is paused until you start it'}. Launch code ${job.code}.`,
        link: `/launch/jobs/${job.id}`,
        dedupeKey: `launch-finished:${job.id}:${job.attempt}`,
      });
    } else if (status !== 'CANCELLED') {
      await this.notifications.notify({
        userId: job.userId,
        type: 'CAMPAIGN_CREATION_FAILED',
        severity: status === 'PARTIAL_FAILURE' ? 'WARNING' : 'ERROR',
        title: `Campaign "${job.name}": ${status === 'PARTIAL_FAILURE' ? 'partially created' : 'creation failed'}`,
        body: `${String(error?.message ?? 'Some objects could not be created.')} Open the launch to see the details and retry.`,
        link: `/launch/jobs/${job.id}`,
        dedupeKey: `launch-finished:${job.id}:${job.attempt}`,
      });
    }
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
