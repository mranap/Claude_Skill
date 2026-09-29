import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import {
  AD_ACCOUNT_STATUS_DISPLAY,
  DATE_RANGE_LABELS,
  META_PROFILE_STATUS_LABELS,
  type DateRangeKey,
} from '@adpilot/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { StatsQueryService } from '../statistics/stats-query.service';
import { toMetrics } from '../statistics/metrics';

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stats: StatsQueryService,
  ) {}

  async get(userId: string, key: DateRangeKey, custom?: { from?: string; to?: string }) {
    const since24h = new Date(Date.now() - 86400_000);
    const [profiles, accounts, activeCampaigns, apiErrors24h, recentEvents] = await Promise.all([
      this.prisma.metaProfile.findMany({
        where: { userId, deletedAt: null },
        select: { id: true, name: true, status: true, lastValidationError: true },
      }),
      this.prisma.adAccount.findMany({
        where: { userId, isConnected: true, profile: { deletedAt: null } },
        select: {
          id: true,
          name: true,
          metaAccountId: true,
          currency: true,
          timezoneName: true,
          statusKey: true,
          statusCheckError: true,
        },
      }),
      this.prisma.campaign.count({ where: { userId, isDeleted: false, effectiveStatus: 'ACTIVE' } }),
      this.prisma.metaApiLog.count({
        where: {
          userId,
          createdAt: { gte: since24h },
          OR: [{ errorCode: { not: null } }, { httpStatus: { gte: 400 } }],
        },
      }),
      this.prisma.activityEvent.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 15 }),
    ]);

    const totals = await this.stats.totals(accounts, key, custom);
    const perCurrency = [...totals.byCurrency.entries()].map(([currency, c]) => toMetrics(c, currency));
    perCurrency.sort((a, b) => new Decimal(b.spend).cmp(a.spend));
    const primaryCurrency = perCurrency[0]?.currency ?? accounts[0]?.currency ?? 'USD';

    const series = totals.days.map((date) => {
      const c = totals.byDay.get(date)?.get(primaryCurrency);
      const m = c ? toMetrics(c, primaryCurrency) : null;
      return {
        date,
        spend: m?.spend ?? '0',
        leads: m?.leads ?? 0,
        cpl: m?.cpl ?? null,
        impressions: m?.impressions ?? 0,
        clicks: m?.linkClicks ?? 0,
      };
    });

    const accountAlerts = accounts
      .filter((a) => a.statusKey !== 'ACTIVE' && a.statusKey !== 'ANY_ACTIVE')
      .map((a) => ({
        kind: 'AD_ACCOUNT' as const,
        id: a.id,
        name: a.name,
        status: AD_ACCOUNT_STATUS_DISPLAY[a.statusKey].label,
        tone: AD_ACCOUNT_STATUS_DISPLAY[a.statusKey].tone,
        message: a.statusCheckError,
      }));
    const profileAlerts = profiles
      .filter((p) => p.status !== 'ACTIVE')
      .map((p) => ({
        kind: 'META_PROFILE' as const,
        id: p.id,
        name: p.name,
        status: META_PROFILE_STATUS_LABELS[p.status],
        tone: 'danger' as const,
        message: p.lastValidationError,
      }));

    const leads = perCurrency.reduce((s, m) => s + m.leads, 0);
    return {
      range: { key, label: DATE_RANGE_LABELS[key], perAccount: Object.fromEntries(totals.ranges) },
      cards: {
        metaProfiles: {
          total: profiles.length,
          active: profiles.filter((p) => p.status === 'ACTIVE').length,
        },
        adAccounts: {
          connected: accounts.length,
          active: accounts.filter((a) => a.statusKey === 'ACTIVE').length,
        },
        activeCampaigns,
        spend: perCurrency.map((m) => ({ currency: m.currency, value: m.spend })),
        leads,
        cpl: perCurrency.filter((m) => m.cpl !== null).map((m) => ({ currency: m.currency, value: m.cpl })),
        apiErrors24h,
        accountAlerts: accountAlerts.length + profileAlerts.length,
      },
      metrics: perCurrency,
      primaryCurrency,
      series,
      alerts: [...profileAlerts, ...accountAlerts],
      recentEvents,
    };
  }
}
