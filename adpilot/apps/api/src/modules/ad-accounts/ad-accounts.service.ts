import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  AD_ACCOUNT_STATUS_DISPLAY,
  adAccountListQuerySchema,
  adAccountUpdateSchema,
  disableReasonLabel,
  minorToMajor,
} from '@adpilot/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { QueueService, jobId } from '../../infra/queue/queue.service';
import { JOBS, QUEUES } from '../../infra/queue/queues';
import { SettingsService } from '../settings/settings.service';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../../common/errors/app-error';
import { Prisma, type AdAccount } from '../../generated/prisma/client';

type ListQuery = z.infer<typeof adAccountListQuerySchema>;
type UpdateInput = z.infer<typeof adAccountUpdateSchema>;

const MANUAL_STATUS_CHECK_COOLDOWN_MS = 2 * 60_000;

@Injectable()
export class AdAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string, q: ListQuery) {
    const where: Prisma.AdAccountWhereInput = {
      userId,
      profile: { deletedAt: null },
      ...(q.profileId ? { profileId: q.profileId } : {}),
      ...(q.connected === 'true' ? { isConnected: true } : q.connected === 'false' ? { isConnected: false } : {}),
      ...(q.status ? { statusKey: q.status as AdAccount['statusKey'] } : {}),
      ...(q.q
        ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { metaAccountId: { contains: q.q.replace(/^act_/, '') } }, { metaBusinessName: { contains: q.q, mode: 'insensitive' } }] }
        : {}),
    };
    const [field, dir] = (q.sort ?? 'name:asc').split(':') as [string, 'asc' | 'desc'];
    const sortable = new Set(['name', 'statusKey', 'lastStatusCheckAt', 'createdAt', 'currency', 'amountSpent']);
    const [rows, total] = await Promise.all([
      this.prisma.adAccount.findMany({
        where,
        orderBy: { [sortable.has(field) ? field : 'name']: dir },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { profile: { select: { id: true, name: true, status: true } } },
      }),
      this.prisma.adAccount.count({ where }),
    ]);
    return { items: rows.map((r) => this.toDto(r)), total, page: q.page, pageSize: q.pageSize };
  }

  async findOwned(userId: string, id: string) {
    const row = await this.prisma.adAccount.findFirst({
      where: { id, userId, profile: { deletedAt: null } },
      include: { profile: { select: { id: true, name: true, status: true } } },
    });
    if (!row) throw AppError.notFound('Ad account');
    return row;
  }

  async get(userId: string, id: string) {
    const row = await this.findOwned(userId, id);
    const [pixels, audiences, campaigns] = await Promise.all([
      this.prisma.pixel.count({ where: { adAccountId: id } }),
      this.prisma.customAudience.count({ where: { adAccountId: id } }),
      this.prisma.campaign.count({ where: { adAccountId: id, isDeleted: false } }),
    ]);
    return { ...this.toDto(row), counts: { pixels, audiences, campaigns } };
  }

  async update(userId: string, id: string, input: UpdateInput) {
    const account = await this.findOwned(userId, id);
    const data: Prisma.AdAccountUpdateInput = {};
    if (input.statusCheckIntervalMinutes !== undefined) {
      const { allowedIntervalsMinutes } = await this.settings.get('accountChecks');
      if (!allowedIntervalsMinutes.includes(input.statusCheckIntervalMinutes)) {
        throw AppError.validation(`Allowed check intervals: ${allowedIntervalsMinutes.map((m) => (m % 60 === 0 ? `${m / 60} h` : `${m} min`)).join(', ')}`, [
          { path: 'statusCheckIntervalMinutes', message: 'This interval is not allowed' },
        ]);
      }
      data.statusCheckIntervalMinutes = input.statusCheckIntervalMinutes;
      data.nextStatusCheckAt = new Date(Date.now() + input.statusCheckIntervalMinutes * 60_000);
    }
    if (input.statsSyncIntervalMinutes !== undefined) {
      const { minSyncIntervalMinutes } = await this.settings.get('statistics');
      if (input.statsSyncIntervalMinutes < minSyncIntervalMinutes) {
        throw AppError.validation(`Minimum statistics sync interval is ${minSyncIntervalMinutes} minutes.`, [
          { path: 'statsSyncIntervalMinutes', message: `Minimum statistics sync interval is ${minSyncIntervalMinutes} minutes.` },
        ]);
      }
      data.statsSyncIntervalMinutes = input.statsSyncIntervalMinutes;
      data.nextStatsSyncAt = new Date(Date.now() + input.statsSyncIntervalMinutes * 60_000);
    }
    if (input.statsSyncEnabled !== undefined) data.statsSyncEnabled = input.statsSyncEnabled;
    if (input.isConnected !== undefined && input.isConnected !== account.isConnected) {
      Object.assign(data, this.connectionChange(input.isConnected));
    }
    await this.prisma.adAccount.update({ where: { id }, data });
    await this.audit.log({ action: 'ad_account.settings_updated', actorUserId: userId, subjectUserId: userId, targetType: 'ad_account', targetId: id, metadata: input });
    if (input.isConnected === true && !account.isConnected) await this.afterConnect(userId, [id], account.profileId);
    return this.get(userId, id);
  }

  async bulkConnect(userId: string, profileId: string, connect: string[], disconnect: string[]) {
    const profile = await this.prisma.metaProfile.findFirst({ where: { id: profileId, userId, deletedAt: null } });
    if (!profile) throw AppError.notFound('Meta profile');
    const toConnect = await this.prisma.adAccount.findMany({ where: { profileId, userId, metaAccountId: { in: connect }, isConnected: false }, select: { id: true } });
    for (const a of toConnect) await this.prisma.adAccount.update({ where: { id: a.id }, data: this.connectionChange(true) });
    const disc = await this.prisma.adAccount.updateMany({ where: { profileId, userId, metaAccountId: { in: disconnect }, isConnected: true }, data: { isConnected: false } });
    if (toConnect.length) await this.afterConnect(userId, toConnect.map((a) => a.id), profileId);
    await this.audit.log({
      action: 'ad_account.connection_changed',
      actorUserId: userId,
      subjectUserId: userId,
      targetType: 'meta_profile',
      targetId: profileId,
      metadata: { connected: connect, disconnected: disconnect },
    });
    return { connected: toConnect.length, disconnected: disc.count };
  }

  /** Manual status check with a backend-enforced cooldown. */
  async checkNow(userId: string, id: string) {
    const account = await this.findOwned(userId, id);
    if (!account.isConnected) throw AppError.conflict('Connect the ad account first');
    const since = new Date(Date.now() - MANUAL_STATUS_CHECK_COOLDOWN_MS);
    const claimed = await this.prisma.adAccount.updateMany({
      where: { id, OR: [{ lastStatusCheckAt: null }, { lastStatusCheckAt: { lt: since } }] },
      data: { lastStatusCheckAt: new Date() },
    });
    if (claimed.count !== 1) {
      const wait = Math.ceil(((account.lastStatusCheckAt?.getTime() ?? 0) + MANUAL_STATUS_CHECK_COOLDOWN_MS - Date.now()) / 1000);
      throw AppError.cooldown(`The status was checked moments ago. Try again in ${Math.max(wait, 1)} s.`, Math.max(wait, 1));
    }
    await this.queue.add(
      QUEUES.ACCOUNT_STATUS,
      JOBS.ACCOUNT_STATUS_CHECK,
      { profileId: account.profileId, userId, adAccountIds: [id] },
      { jobId: jobId('status-manual', id, Math.floor(Date.now() / 60_000)), priority: 1 },
    );
    return { queued: true };
  }

  async statusHistory(userId: string, id: string) {
    await this.findOwned(userId, id);
    return this.prisma.accountStatusHistory.findMany({ where: { adAccountId: id }, orderBy: { detectedAt: 'desc' }, take: 100 });
  }

  async pixels(userId: string, id: string) {
    await this.findOwned(userId, id);
    return this.prisma.pixel.findMany({ where: { adAccountId: id }, orderBy: { name: 'asc' } });
  }

  async audiences(userId: string, id: string) {
    await this.findOwned(userId, id);
    return this.prisma.customAudience.findMany({ where: { adAccountId: id }, orderBy: { name: 'asc' } });
  }

  async pages(userId: string, id: string) {
    const account = await this.findOwned(userId, id);
    return this.prisma.page.findMany({ where: { profileId: account.profileId, userId }, orderBy: { name: 'asc' } });
  }

  private connectionChange(connect: boolean): Prisma.AdAccountUpdateInput {
    if (!connect) return { isConnected: false };
    // Spread the first checks over a few minutes so many accounts don't hit Meta at the same second.
    return {
      isConnected: true,
      nextStatusCheckAt: new Date(Date.now() + Math.round(Math.random() * 5 * 60_000)),
      nextStatsSyncAt: new Date(Date.now() + Math.round(Math.random() * 60_000)),
    };
  }

  /** Pixels/audiences/pages for newly connected accounts are fetched by an asset sync. */
  private async afterConnect(userId: string, _accountIds: string[], profileId: string) {
    // Unique job per request: the worker coalesces redundant syncs (see MetaSyncProcessor).
    await this.queue.add(QUEUES.META_SYNC, JOBS.META_SYNC, { profileId, userId, reason: 'manual' }, { jobId: jobId('meta-sync', profileId, randomUUID()) });
  }

  toDto(r: AdAccount & { profile: { id: string; name: string; status: string } }) {
    const display = AD_ACCOUNT_STATUS_DISPLAY[r.statusKey];
    return {
      id: r.id,
      profileId: r.profileId,
      profileName: r.profile.name,
      profileStatus: r.profile.status,
      metaAccountId: r.metaAccountId,
      name: r.name,
      currency: r.currency,
      timezoneName: r.timezoneName,
      accountStatus: r.accountStatus,
      statusKey: r.statusKey,
      statusLabel: display.label,
      statusGroup: display.group,
      statusTone: display.tone,
      disableReason: r.disableReason,
      disableReasonLabel: disableReasonLabel(r.disableReason),
      amountSpent: minorToMajor(r.amountSpent, r.currency),
      balance: minorToMajor(r.balance, r.currency),
      spendCap: r.spendCap && r.spendCap > 0n ? minorToMajor(r.spendCap, r.currency) : null,
      minDailyBudget: minorToMajor(r.minDailyBudget, r.currency),
      business: r.metaBusinessId ? { id: r.metaBusinessId, name: r.metaBusinessName } : null,
      isConnected: r.isConnected,
      statusCheckIntervalMinutes: r.statusCheckIntervalMinutes,
      lastStatusCheckAt: r.lastStatusCheckAt,
      nextStatusCheckAt: r.nextStatusCheckAt,
      statusCheckError: r.statusCheckError,
      statsSyncEnabled: r.statsSyncEnabled,
      statsSyncIntervalMinutes: r.statsSyncIntervalMinutes,
      lastStatsSyncAt: r.lastStatsSyncAt,
      nextStatsSyncAt: r.nextStatsSyncAt,
      statsSyncStatus: r.statsSyncStatus,
      statsSyncError: r.statsSyncError,
      lastManualRefreshAt: r.lastManualRefreshAt,
      lastSyncAt: r.lastSyncAt,
      defaultDsaPayor: r.defaultDsaPayor,
      defaultDsaBeneficiary: r.defaultDsaBeneficiary,
    };
  }
}
