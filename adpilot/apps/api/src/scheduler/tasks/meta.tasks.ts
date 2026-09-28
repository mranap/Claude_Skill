import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { QueueService, jobId } from '../../infra/queue/queue.service';
import { JOBS, QUEUES } from '../../infra/queue/queues';
import { SettingsService } from '../../modules/settings/settings.service';
import { SchedulerTask, slot } from '../scheduler-task';

const MINUTE = 60_000;

/** Periodic token validation (expiry, revocation, permissions). */
@Injectable()
export class TokenCheckTask implements SchedulerTask {
  readonly name = 'meta-token-check';
  readonly everyMs = 5 * MINUTE;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly queue: QueueService,
  ) {}

  async run(): Promise<void> {
    const { tokenCheckIntervalHours } = await this.settings.get('meta');
    const rows = await this.prisma.$queryRaw<{ id: string; userId: string }[]>`
      UPDATE meta_profiles SET "nextTokenCheckAt" = now() + make_interval(hours => ${tokenCheckIntervalHours}::int)
      WHERE id IN (
        SELECT id FROM meta_profiles
        WHERE "deletedAt" IS NULL AND "isEnabled" AND "tokenEnc" IS NOT NULL
          AND status IN ('ACTIVE', 'ERROR', 'UNCHECKED')
          AND ("nextTokenCheckAt" IS NULL OR "nextTokenCheckAt" <= now())
        ORDER BY "nextTokenCheckAt" NULLS FIRST LIMIT 500
        FOR UPDATE SKIP LOCKED)
      RETURNING id, "userId"`;
    const s = slot(new Date(), 60 * MINUTE);
    for (const r of rows) {
      await this.queue.add(QUEUES.META_SYNC, JOBS.TOKEN_CHECK, { profileId: r.id, userId: r.userId }, { jobId: jobId('token', r.id, s), attempts: 3 });
    }
  }
}

/** Periodic re-discovery of businesses, ad accounts, pages, pixels and audiences. */
@Injectable()
export class AssetSyncTask implements SchedulerTask {
  readonly name = 'meta-asset-sync';
  readonly everyMs = 10 * MINUTE;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly queue: QueueService,
  ) {}

  async run(): Promise<void> {
    const { assetSyncIntervalHours } = await this.settings.get('meta');
    const rows = await this.prisma.$queryRaw<{ id: string; userId: string }[]>`
      UPDATE meta_profiles SET "nextAssetSyncAt" = now() + make_interval(hours => ${assetSyncIntervalHours}::int)
      WHERE id IN (
        SELECT id FROM meta_profiles
        WHERE "deletedAt" IS NULL AND "isEnabled" AND status = 'ACTIVE'
          AND ("nextAssetSyncAt" IS NULL OR "nextAssetSyncAt" <= now())
        ORDER BY "nextAssetSyncAt" NULLS FIRST LIMIT 200
        FOR UPDATE SKIP LOCKED)
      RETURNING id, "userId"`;
    const s = slot(new Date(), 60 * MINUTE);
    for (const r of rows) {
      await this.queue.add(QUEUES.META_SYNC, JOBS.META_SYNC, { profileId: r.id, userId: r.userId, reason: 'scheduled' }, { jobId: jobId('meta-sync', r.id, s) });
    }
  }
}

/**
 * Ad account status checks at the interval chosen per account. Due accounts are claimed atomically
 * (next check moved forward in the same statement) and batched per profile, 50 accounts per request.
 */
@Injectable()
export class AccountStatusTask implements SchedulerTask {
  readonly name = 'ad-account-status-check';
  readonly everyMs = MINUTE;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
  ) {}

  async run(): Promise<void> {
    const rows = await this.prisma.$queryRaw<{ id: string; profileId: string; userId: string }[]>`
      UPDATE ad_accounts SET "nextStatusCheckAt" = now() + make_interval(mins => "statusCheckIntervalMinutes")
      WHERE id IN (
        SELECT a.id FROM ad_accounts a JOIN meta_profiles p ON p.id = a."profileId"
        WHERE a."isConnected" AND p."deletedAt" IS NULL AND p."isEnabled" AND p.status = 'ACTIVE'
          AND (a."nextStatusCheckAt" IS NULL OR a."nextStatusCheckAt" <= now())
        ORDER BY a."nextStatusCheckAt" NULLS FIRST LIMIT 2000
        FOR UPDATE OF a SKIP LOCKED)
      RETURNING id, "profileId", "userId"`;
    const byProfile = new Map<string, { userId: string; ids: string[] }>();
    for (const r of rows) {
      const entry = byProfile.get(r.profileId) ?? { userId: r.userId, ids: [] };
      entry.ids.push(r.id);
      byProfile.set(r.profileId, entry);
    }
    const s = slot(new Date(), MINUTE);
    for (const [profileId, { userId, ids }] of byProfile) {
      for (let i = 0; i < ids.length; i += 50) {
        await this.queue.add(
          QUEUES.ACCOUNT_STATUS,
          JOBS.ACCOUNT_STATUS_CHECK,
          { profileId, userId, adAccountIds: ids.slice(i, i + 50) },
          { jobId: jobId('status', profileId, s, i / 50), attempts: 3 },
        );
      }
    }
  }
}
