import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { z } from 'zod';
import { statsQuerySchema, type MetricsDto } from '@adpilot/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { QueueService, jobId } from '../../infra/queue/queue.service';
import { JOBS, QUEUES } from '../../infra/queue/queues';
import { SettingsService } from '../settings/settings.service';
import { AppError } from '../../common/errors/app-error';
import { StatsQueryService } from './stats-query.service';
import { toMetrics } from './metrics';

type Query = z.infer<typeof statsQuerySchema>;

const SORTABLE: (keyof MetricsDto)[] = [
  'spend',
  'impressions',
  'clicks',
  'linkClicks',
  'ctr',
  'cpc',
  'cpm',
  'leads',
  'cpl',
  'purchases',
  'roas',
  'results',
  'costPerResult',
];

@Injectable()
export class StatisticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stats: StatsQueryService,
    private readonly queue: QueueService,
    private readonly settings: SettingsService,
  ) {}

  private async accounts(userId: string, adAccountId?: string) {
    const accounts = await this.prisma.adAccount.findMany({
      where: {
        userId,
        isConnected: true,
        profile: { deletedAt: null },
        ...(adAccountId ? { id: adAccountId } : {}),
      },
      select: {
        id: true,
        name: true,
        timezoneName: true,
        currency: true,
        lastStatsSyncAt: true,
        statsSyncStatus: true,
        statsSyncError: true,
        lastManualRefreshAt: true,
      },
    });
    if (adAccountId && !accounts.length) throw AppError.notFound('Ad account');
    return accounts;
  }

  async table(userId: string, q: Query) {
    const accounts = await this.accounts(userId, q.adAccountId);
    const { manualRefreshCooldownMinutes } = await this.settings.get('statistics');
    const byObject = await this.stats.byObject(accounts, q.range, q.level, {
      custom: { from: q.from, to: q.to },
      metaCampaignId: q.campaignId,
    });
    const accountName = new Map(accounts.map((a) => [a.id, a.name]));
    let rows = [...byObject.values()].map((o) => ({
      metaObjectId: o.metaObjectId,
      name: o.name,
      adAccountId: o.adAccountId,
      adAccountName: accountName.get(o.adAccountId) ?? null,
      metaCampaignId: o.metaCampaignId,
      metaAdSetId: o.metaAdSetId,
      metrics: toMetrics(o.counters, o.currency),
    }));
    if (q.q) {
      const needle = q.q.toLowerCase();
      rows = rows.filter(
        (r) => (r.name ?? '').toLowerCase().includes(needle) || r.metaObjectId.includes(needle),
      );
    }
    const [field, dir] = (q.sort ?? 'spend:desc').split(':') as [keyof MetricsDto, 'asc' | 'desc'];
    const sortField = SORTABLE.includes(field) ? field : 'spend';
    rows.sort((a, b) => {
      const av = a.metrics[sortField];
      const bv = b.metrics[sortField];
      const cmp = av === null ? -1 : bv === null ? 1 : new Decimal(String(av)).cmp(String(bv));
      return dir === 'asc' ? cmp : -cmp;
    });
    const total = rows.length;
    const pageRows = rows.slice((q.page - 1) * q.pageSize, q.page * q.pageSize);

    // Status/budget context for campaign-level rows.
    const enriched = await this.enrich(userId, q.level, pageRows);
    const totals = await this.stats.totals(accounts, q.range, { from: q.from, to: q.to });
    const perCurrency = [...totals.byCurrency.entries()].map(([currency, c]) => toMetrics(c, currency));
    const primary =
      perCurrency.sort((a, b) => new Decimal(b.spend).cmp(a.spend))[0]?.currency ??
      accounts[0]?.currency ??
      'USD';
    return {
      items: enriched,
      total,
      page: q.page,
      pageSize: q.pageSize,
      totals: perCurrency,
      series: totals.days.map((date) => {
        const c = totals.byDay.get(date)?.get(primary);
        const m = c ? toMetrics(c, primary) : null;
        return {
          date,
          spend: m?.spend ?? '0',
          leads: m?.leads ?? 0,
          cpl: m?.cpl ?? null,
          clicks: m?.linkClicks ?? 0,
          impressions: m?.impressions ?? 0,
        };
      }),
      primaryCurrency: primary,
      sync: accounts.map((a) => ({
        adAccountId: a.id,
        name: a.name,
        timezoneName: a.timezoneName,
        lastStatsSyncAt: a.lastStatsSyncAt,
        status: a.statsSyncStatus,
        error: a.statsSyncError,
        lastManualRefreshAt: a.lastManualRefreshAt,
        // When "Refresh" is allowed again (the backend enforces it; this only drives the countdown).
        nextManualRefreshAt: a.lastManualRefreshAt
          ? new Date(a.lastManualRefreshAt.getTime() + manualRefreshCooldownMinutes * 60_000)
          : null,
      })),
    };
  }

  private async enrich<T extends { metaObjectId: string }>(
    userId: string,
    level: 'CAMPAIGN' | 'ADSET' | 'AD',
    rows: T[],
  ) {
    const ids = rows.map((r) => r.metaObjectId);
    if (!ids.length) return rows.map((r) => ({ ...r, entity: null }));
    if (level === 'CAMPAIGN') {
      const list = await this.prisma.campaign.findMany({
        where: { userId, metaCampaignId: { in: ids } },
        select: {
          id: true,
          metaCampaignId: true,
          effectiveStatus: true,
          status: true,
          dailyBudget: true,
          lifetimeBudget: true,
        },
      });
      const map = new Map(list.map((c) => [c.metaCampaignId, c]));
      return rows.map((r) => ({ ...r, entity: map.get(r.metaObjectId) ?? null }));
    }
    if (level === 'ADSET') {
      const list = await this.prisma.adSet.findMany({
        where: { userId, metaAdSetId: { in: ids } },
        select: {
          id: true,
          metaAdSetId: true,
          campaignId: true,
          effectiveStatus: true,
          status: true,
          dailyBudget: true,
          lifetimeBudget: true,
        },
      });
      const map = new Map(list.map((c) => [c.metaAdSetId, c]));
      return rows.map((r) => ({ ...r, entity: map.get(r.metaObjectId) ?? null }));
    }
    const list = await this.prisma.ad.findMany({
      where: { userId, metaAdId: { in: ids } },
      select: { id: true, metaAdId: true, campaignId: true, effectiveStatus: true, status: true },
    });
    const map = new Map(list.map((c) => [c.metaAdId, c]));
    return rows.map((r) => ({ ...r, entity: map.get(r.metaObjectId) ?? null }));
  }

  /**
   * Manual "Refresh statistics". The cooldown is enforced here with an atomic compare-and-set on
   * lastManualRefreshAt — disabling the button in the UI is only a convenience.
   */
  async refresh(userId: string, adAccountId?: string) {
    const { manualRefreshCooldownMinutes } = await this.settings.get('statistics');
    const accounts = await this.accounts(userId, adAccountId);
    const cutoff = new Date(Date.now() - manualRefreshCooldownMinutes * 60_000);
    const results: { adAccountId: string; queued: boolean; retryAfterSeconds?: number }[] = [];
    for (const a of accounts) {
      const claimed = await this.prisma.adAccount.updateMany({
        where: {
          id: a.id,
          userId,
          OR: [{ lastManualRefreshAt: null }, { lastManualRefreshAt: { lt: cutoff } }],
        },
        data: { lastManualRefreshAt: new Date(), statsSyncStatus: 'QUEUED' },
      });
      if (claimed.count === 1) {
        await this.queue.add(
          QUEUES.STATISTICS,
          JOBS.STATISTICS_SYNC,
          { adAccountId: a.id, userId, reason: 'manual' },
          { jobId: jobId('stats-manual', a.id, Date.now()), priority: 1, attempts: 3 },
        );
        results.push({ adAccountId: a.id, queued: true });
      } else {
        const retry = Math.ceil(
          ((a.lastManualRefreshAt?.getTime() ?? 0) + manualRefreshCooldownMinutes * 60_000 - Date.now()) /
            1000,
        );
        results.push({ adAccountId: a.id, queued: false, retryAfterSeconds: Math.max(retry, 1) });
      }
    }
    if (adAccountId && !results[0]?.queued) {
      throw AppError.cooldown(
        `Statistics were refreshed recently. You can refresh again in ${Math.ceil((results[0]?.retryAfterSeconds ?? 60) / 60)} min.`,
        results[0]?.retryAfterSeconds ?? 60,
      );
    }
    return { results, cooldownMinutes: manualRefreshCooldownMinutes };
  }
}
